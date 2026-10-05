import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { capture } from "../core/capture.js";
import type { Config } from "../core/config.js";
import { applyEmulation, emulationKey, settle } from "../core/emulation.js";
import { slugify } from "../core/filename.js";
import { gotoAndWait, runActions } from "../core/navigate.js";
import type { BrowserSession } from "../core/session.js";
import { type CaptureSettings, DEFAULT_SETTINGS, mergeSettings } from "../core/settings.js";
import { isLoginRedirect } from "../core/urls.js";
import { writeGallery } from "./gallery.js";
import { type Job, type ResolvedPage, type Variant, resolvePages, variants } from "./job.js";

export type EntryStatus = "ok" | "failed" | "skipped";

export interface ManifestEntry {
  key: string;
  page: string;
  url: string;
  variant: string;
  status: EntryStatus;
  finalUrl?: string;
  title?: string;
  /** Paths relative to the run folder. */
  files: { kind: "image" | "html"; path: string; bytes: number; width?: number; height?: number }[];
  warnings: string[];
  error?: string;
  durationMs: number;
  at: string;
}

export interface Manifest {
  version: 1;
  job?: string;
  jobName: string;
  startedAt: string;
  updatedAt: string;
  entries: Record<string, ManifestEntry>;
}

export type LoginDecision = "retry" | "skip" | "abort";

export type RunEvent =
  | { type: "start"; runDir: string; total: number; alreadyDone: number }
  | { type: "task"; page: string; variant: string; url: string; worker: number }
  | { type: "entry"; entry: ManifestEntry; done: number; total: number }
  | { type: "info"; message: string }
  | { type: "done"; runDir: string; ok: number; failed: number; skipped: number; aborted: boolean };

export interface RunOptions {
  session: BrowserSession;
  job: Job;
  jobPath?: string;
  config: Config;
  /** Resume into this run folder (entries already "ok" are skipped). */
  runDir?: string;
  concurrency?: number;
  onEvent: (e: RunEvent) => void;
  /**
   * Called when a page landed on a login screen. The batch window is brought to the front;
   * every worker waits until this resolves.
   */
  onLogin: (info: { url: string; finalUrl: string }) => Promise<LoginDecision>;
}

const MANIFEST = "manifest.json";

export function entryKey(page: string, variant: string): string {
  return `${page}/${variant}`;
}

export function baseSettings(job: Job, config: Config): CaptureSettings {
  let s = mergeSettings(DEFAULT_SETTINGS, undefined);
  if (job.preset) {
    const p = config.presets?.[job.preset];
    if (!p) throw new Error(`Unknown preset "${job.preset}"`);
    s = mergeSettings(s, p);
  }
  return mergeSettings(s, job.settings);
}

export function readManifest(runDir: string): Manifest | undefined {
  const path = join(runDir, MANIFEST);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Manifest) : undefined;
}

function writeManifest(runDir: string, m: Manifest) {
  m.updatedAt = new Date().toISOString();
  const tmp = join(runDir, `${MANIFEST}.tmp`);
  writeFileSync(tmp, JSON.stringify(m, null, 2));
  renameSync(tmp, join(runDir, MANIFEST));
}

function timestamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function runJob(opts: RunOptions): Promise<{ runDir: string; manifest: Manifest }> {
  const { session, job, onEvent } = opts;
  const base = baseSettings(job, opts.config);
  const pages = resolvePages(job);
  const vars = variants(job.matrix);
  if (!pages.length) throw new Error("The job has no pages to capture (all skipped?)");

  const runDir = resolve(opts.runDir ?? join(job.out ?? base.outDir, `${slugify(job.name ?? "job") || "job"}-${timestamp()}`));
  mkdirSync(runDir, { recursive: true });
  const manifest: Manifest = readManifest(runDir) ?? {
    version: 1,
    job: opts.jobPath ? resolve(opts.jobPath) : undefined,
    jobName: job.name ?? "job",
    startedAt: new Date().toISOString(),
    updatedAt: "",
    entries: {},
  };
  const total = pages.length * vars.length;
  const isDone = (p: ResolvedPage, v: Variant) => manifest.entries[entryKey(p.name, v.id)]?.status === "ok";
  let done = pages.reduce((n, p) => n + vars.filter((v) => isDone(p, v)).length, 0);
  onEvent({ type: "start", runDir, total, alreadyDone: done });

  const queue = pages.filter((p) => vars.some((v) => !isDone(p, v)));
  let aborted = false;
  let loginPending: Promise<LoginDecision> | undefined;

  const skipReason = () => (aborted ? "aborted" : "login required");
  const record = (entry: ManifestEntry) => {
    manifest.entries[entry.key] = entry;
    writeManifest(runDir, manifest);
    done++;
    onEvent({ type: "entry", entry, done, total });
  };

  async function login(page: Page, url: string, finalUrl: string): Promise<LoginDecision> {
    if (!loginPending) {
      await page.bringToFront().catch(() => {});
      loginPending = opts.onLogin({ url, finalUrl }).finally(() => (loginPending = undefined));
    }
    return loginPending;
  }

  /** Navigate (with emulation already applied), handling login walls. Returns false to skip the page. */
  async function open(page: Page, p: ResolvedPage): Promise<{ ok: boolean; finalUrl: string; warnings: string[] }> {
    for (let attempt = 0; ; attempt++) {
      while (loginPending) await loginPending.catch(() => {});
      if (aborted) return { ok: false, finalUrl: p.url, warnings: [] };
      const nav = await gotoAndWait(page, p.url, p.wait);
      if (isLoginRedirect(p.url, nav.finalUrl, job.loginPattern)) {
        if (attempt >= 3) throw new Error(`still redirected to login (${nav.finalUrl})`);
        const decision = await login(page, p.url, nav.finalUrl);
        if (decision === "abort") aborted = true;
        if (decision !== "retry") return { ok: false, finalUrl: nav.finalUrl, warnings: [] };
        continue;
      }
      if (p.actions.length) await runActions(page, p.actions);
      return { ok: true, finalUrl: nav.finalUrl, warnings: nav.warnings };
    }
  }

  async function worker(index: number) {
    const page = await session.browser.newPage({ type: "window" });
    const cdp = await session.cdp(page);
    let applied: string | undefined;
    try {
      for (let p = queue.shift(); p && !aborted; p = queue.shift()) {
        let opened: Awaited<ReturnType<typeof open>> | undefined;
        for (const v of vars) {
          if (aborted) break;
          if (isDone(p, v)) continue;
          onEvent({ type: "task", page: p.name, variant: v.id, url: p.url, worker: index });
          const settings = mergeSettings(mergeSettings(base, p.settings), v.patch);
          settings.outDir = runDir;
          settings.filename = `${p.name}/${v.id}`;
          const started = Date.now();
          const entry: Omit<ManifestEntry, "status"> = {
            key: entryKey(p.name, v.id),
            page: p.name,
            url: p.url,
            variant: v.id,
            files: [],
            warnings: [],
            durationMs: 0,
            at: "",
          };
          let error: unknown;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              // Emulate before loading so responsive JS sees the right viewport from the start.
              const key = emulationKey(settings);
              if (applied !== key) {
                await applyEmulation(cdp, settings);
                applied = key;
                if (opened && !job.reload) await settle(page, 300);
              }
              if (!opened || job.reload || attempt > 0) {
                opened = await open(page, p);
                if (!opened.ok) break;
              }
              const res = await capture(session, page, settings, { keepEmulation: true, appliedEmulation: applied });
              entry.finalUrl = opened.finalUrl;
              entry.title = res.title;
              entry.warnings = [...opened.warnings, ...res.warnings];
              entry.files = res.files.map((f) => ({ ...f, path: relative(runDir, f.path) }));
              error = undefined;
              break;
            } catch (e) {
              error = e;
              opened = undefined;
            }
          }
          const status: EntryStatus = error ? "failed" : opened?.ok === false ? "skipped" : "ok";
          record({
            ...entry,
            status,
            finalUrl: entry.finalUrl ?? opened?.finalUrl,
            error: error ? (error instanceof Error ? error.message : String(error)) : status === "skipped" ? skipReason() : undefined,
            durationMs: Date.now() - started,
            at: new Date().toISOString(),
          });
          if (status === "skipped") {
            // the whole page is unreachable; don't try its other variants
            for (const rest of vars) {
              if (rest.id !== v.id && !manifest.entries[entryKey(p.name, rest.id)] && !aborted) {
                record({ ...entry, key: entryKey(p.name, rest.id), variant: rest.id, status, error: skipReason(), durationMs: 0, at: new Date().toISOString() });
              }
            }
            break;
          }
        }
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  const n = Math.max(1, Math.min(opts.concurrency ?? job.concurrency ?? 1, queue.length || 1));
  await Promise.all(Array.from({ length: n }, (_, i) => worker(i)));

  writeManifest(runDir, manifest);
  writeGallery(runDir, manifest);
  const list = Object.values(manifest.entries);
  onEvent({
    type: "done",
    runDir,
    ok: list.filter((e) => e.status === "ok").length,
    failed: list.filter((e) => e.status === "failed").length,
    skipped: list.filter((e) => e.status === "skipped").length,
    aborted,
  });
  return { runDir, manifest };
}
