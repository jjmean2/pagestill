import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { type CaptureResult, capture } from "../core/capture.js";
import { type Config, resolveSettings } from "../core/config.js";
import { applyEmulation, emulationKey, settle } from "../core/emulation.js";
import { localStamp, slugify } from "../core/filename.js";
import { type NavigationResult, gotoAndWait, runSteps } from "../core/navigate.js";
import type { BrowserSession } from "../core/session.js";
import { type SettingKey, type SettingsPatch, mergeSettings } from "../core/settings.js";
import { isLoginRedirect, normalizeUrl } from "../core/urls.js";
import { workspace } from "../core/workspace.js";
import { writeGallery, writeThumbnail } from "./gallery.js";
import { type PageList, type ResolvedPage, type Variant, resolvePages, variants } from "./pagelist.js";

/** ok: captured · check: captured, but the page may not be the one listed · failed · skipped */
export type EntryStatus = "ok" | "check" | "failed" | "skipped";

export interface ManifestEntry {
  key: string;
  page: string;
  url: string;
  variant: string;
  status: EntryStatus;
  finalUrl?: string;
  title?: string;
  /** Why the entry needs checking (HTTP error, ended on another URL). */
  checks?: string[];
  /** Paths relative to the run folder. */
  files: { kind: "image" | "html"; path: string; bytes: number; width?: number; height?: number }[];
  warnings: string[];
  error?: string;
  /** Gallery thumbnail, relative to the run folder. */
  thumb?: string;
  durationMs: number;
  at: string;
}

export interface Manifest {
  version: 1;
  /** Page list the run came from. */
  list?: string;
  listName: string;
  startedAt: string;
  updatedAt: string;
  entries: Record<string, ManifestEntry>;
}

export type LoginDecision = "retry" | "skip" | "abort";

export interface RunSummary {
  runDir: string;
  ok: number;
  check: number;
  failed: number;
  skipped: number;
  aborted: boolean;
}

export type RunEvent =
  | { type: "start"; runDir: string; total: number; alreadyDone: number }
  | { type: "task"; page: string; variant: string; url: string; worker: number }
  | { type: "entry"; entry: ManifestEntry; done: number; total: number }
  | { type: "info"; message: string }
  | ({ type: "done" } & RunSummary);

const MANIFEST = "manifest.json";

export function entryKey(page: string, variant: string): string {
  return `${page}/${variant}`;
}

export function readManifest(runDir: string): Manifest | undefined {
  const path = join(runDir, MANIFEST);
  if (!existsSync(path)) return undefined;
  const m = JSON.parse(readFileSync(path, "utf8")) as Manifest & { jobName?: string; job?: string };
  // runs made before 0.4 called the list a "job"
  m.listName ??= m.jobName ?? "run";
  m.list ??= m.job;
  return m;
}

/**
 * A run folder: manifest.json (rewritten after every capture, so a run can be resumed),
 * thumbnails and the index.html gallery. Shared by `run` and `crawl --capture`.
 */
export class RunWriter {
  readonly manifest: Manifest;

  constructor(
    readonly dir: string,
    init: { list?: string; listName: string },
  ) {
    mkdirSync(dir, { recursive: true });
    this.manifest = readManifest(dir) ?? {
      version: 1,
      list: init.list,
      listName: init.listName,
      startedAt: new Date().toISOString(),
      updatedAt: "",
      entries: {},
    };
  }

  /** Finished captures (ok or check) are kept when resuming. */
  isDone(key: string): boolean {
    const s = this.manifest.entries[key]?.status;
    return s === "ok" || s === "check";
  }

  has(key: string): boolean {
    return key in this.manifest.entries;
  }

  async record(entry: ManifestEntry): Promise<ManifestEntry> {
    const image = entry.files.find((f) => f.kind === "image");
    if (image && entry.status !== "failed") {
      const thumb = join(".thumbs", `${entry.key.replace(/\//g, "--")}.jpg`);
      await writeThumbnail(join(this.dir, image.path), join(this.dir, thumb))
        .then(() => (entry.thumb = thumb))
        .catch(() => {});
    }
    this.manifest.entries[entry.key] = entry;
    this.save();
    return entry;
  }

  /** Turn a capture into a manifest entry (paths relative to the run folder). */
  entryFrom(
    base: Pick<ManifestEntry, "key" | "page" | "url" | "variant">,
    res: CaptureResult,
    nav: { finalUrl: string; checks: string[]; warnings: string[] },
    started: number,
  ): ManifestEntry {
    return {
      ...base,
      status: nav.checks.length ? "check" : "ok",
      finalUrl: nav.finalUrl,
      title: res.title,
      checks: nav.checks.length ? nav.checks : undefined,
      files: res.files.map((f) => ({ ...f, path: relative(this.dir, f.path) })),
      warnings: [...nav.warnings, ...res.warnings],
      durationMs: Date.now() - started,
      at: new Date().toISOString(),
    };
  }

  save(): void {
    this.manifest.updatedAt = new Date().toISOString();
    const tmp = join(this.dir, `${MANIFEST}.tmp`);
    writeFileSync(tmp, JSON.stringify(this.manifest, null, 2));
    renameSync(tmp, join(this.dir, MANIFEST));
  }

  finish(aborted: boolean): RunSummary {
    this.save();
    writeGallery(this.dir, this.manifest);
    const list = Object.values(this.manifest.entries);
    const count = (s: EntryStatus) => list.filter((e) => e.status === s).length;
    return { runDir: this.dir, ok: count("ok"), check: count("check"), failed: count("failed"), skipped: count("skipped"), aborted };
  }
}

/** Reasons a loaded page may not be the one that was asked for. */
export function navigationChecks(requested: string, nav: NavigationResult): string[] {
  const checks: string[] = [];
  if (nav.status !== undefined && nav.status >= 400) checks.push(`HTTP ${nav.status}`);
  const a = normalizeUrl(requested);
  const b = normalizeUrl(nav.finalUrl);
  if (a && b && a !== b) checks.push(`ended on ${nav.finalUrl}`);
  return checks;
}

export interface RunOptions {
  session: BrowserSession;
  list: PageList;
  listPath?: string;
  config: Config;
  /** Presets from the command line, applied after the list's own presets. */
  presets?: string[];
  /** Settings from command-line flags: override the list (and replace matrix axes they set). */
  flags?: SettingsPatch;
  /** Only pages whose URL path or name match this glob. */
  only?: string;
  /** Resume into this run folder (finished captures are kept). */
  runDir?: string;
  concurrency?: number;
  onEvent: (e: RunEvent) => void;
  /**
   * Called when a page landed on a login screen. That window is brought to the front;
   * every worker waits until this resolves.
   */
  onLogin: (info: { url: string; finalUrl: string }) => Promise<LoginDecision>;
}

export async function runPageList(opts: RunOptions): Promise<RunSummary & { manifest: Manifest }> {
  const { session, list, onEvent } = opts;
  const flags = opts.flags ?? {};
  const presets = [...list.presets, ...(opts.presets ?? [])];
  const base = resolveSettings(opts.config, presets, list.settings, flags);
  const pages = resolvePages(list, opts.only);
  const vars = variants(list.matrix, new Set(Object.keys(flags) as SettingKey[]));
  if (!pages.length) {
    throw new Error(opts.only ? `No page in the list matches --only ${opts.only}` : "The list has no pages to capture (all skipped?)");
  }

  const runDir = resolve(opts.runDir ?? join(workspace(base.out).runs, `${slugify(list.name) || "run"}-${localStamp()}`));
  const writer = new RunWriter(runDir, { list: opts.listPath ? resolve(opts.listPath) : undefined, listName: list.name });
  const total = pages.length * vars.length;
  let done = pages.reduce((n, p) => n + vars.filter((v) => writer.isDone(entryKey(p.name, v.id))).length, 0);
  onEvent({ type: "start", runDir, total, alreadyDone: done });

  const queue = pages.filter((p) => vars.some((v) => !writer.isDone(entryKey(p.name, v.id))));
  let aborted = false;
  let loginPending: Promise<LoginDecision> | undefined;
  const skipReason = () => (aborted ? "aborted" : "login required");

  const record = async (entry: ManifestEntry) => {
    await writer.record(entry);
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

  /** Navigate (with emulation already applied), handling login walls. */
  async function open(page: Page, p: ResolvedPage): Promise<{ ok: boolean; finalUrl: string; checks: string[]; warnings: string[] }> {
    for (let attempt = 0; ; attempt++) {
      while (loginPending) await loginPending.catch(() => {});
      if (aborted) return { ok: false, finalUrl: p.url, checks: [], warnings: [] };
      const nav = await gotoAndWait(page, p.url, p.load);
      if (isLoginRedirect(p.url, nav.finalUrl, list.login)) {
        if (attempt >= 3) throw new Error(`still redirected to login (${nav.finalUrl})`);
        const decision = await login(page, p.url, nav.finalUrl);
        if (decision === "abort") aborted = true;
        if (decision !== "retry") return { ok: false, finalUrl: nav.finalUrl, checks: [], warnings: [] };
        continue;
      }
      const checks = navigationChecks(p.url, nav);
      if (p.steps.length) await runSteps(page, p.steps);
      return { ok: true, finalUrl: nav.finalUrl, checks, warnings: nav.warnings };
    }
  }

  async function worker(index: number) {
    // In the background: a focused window would pull the interactive screen's "follow the
    // tab in front" (and Record/Auto) over to the run.
    const page = await session.browser.newPage({ type: "window", background: true });
    const cdp = await session.cdp(page);
    let applied: string | undefined;
    try {
      for (let p = queue.shift(); p && !aborted; p = queue.shift()) {
        let opened: Awaited<ReturnType<typeof open>> | undefined;
        for (const v of vars) {
          if (aborted) break;
          const key = entryKey(p.name, v.id);
          if (writer.isDone(key)) continue;
          onEvent({ type: "task", page: p.name, variant: v.id, url: p.url, worker: index });
          // list → page → matrix → flags
          const settings = mergeSettings(base, p.settings, v.patch, flags);
          const started = Date.now();
          const head = { key, page: p.name, url: p.url, variant: v.id };
          let entry: ManifestEntry | undefined;
          let error: unknown;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              // Emulate before loading so responsive JS sees the right viewport from the start.
              const ek = emulationKey(settings);
              if (applied !== ek) {
                await applyEmulation(cdp, settings);
                applied = ek;
                if (opened && !list.reload) await settle(page, 300);
              }
              if (!opened || list.reload || attempt > 0) {
                opened = await open(page, p);
                if (!opened.ok) break;
              }
              const res = await capture(session, page, settings, {
                keepEmulation: true,
                appliedEmulation: applied,
                dir: runDir,
                name: `${p.name}/${v.id}`,
              });
              entry = writer.entryFrom(head, res, opened, started);
              error = undefined;
              break;
            } catch (e) {
              error = e;
              opened = undefined;
            }
          }
          if (entry) {
            await record(entry);
            continue;
          }
          const status: EntryStatus = error ? "failed" : "skipped";
          await record({
            ...head,
            status,
            finalUrl: opened?.finalUrl,
            files: [],
            warnings: [],
            error: error ? (error instanceof Error ? error.message : String(error)) : skipReason(),
            durationMs: Date.now() - started,
            at: new Date().toISOString(),
          });
          if (status === "skipped") {
            // the whole page is unreachable; don't try its other variants
            for (const rest of vars) {
              const k = entryKey(p.name, rest.id);
              if (k !== key && !writer.has(k) && !aborted) {
                await record({ ...head, key: k, variant: rest.id, status, files: [], warnings: [], error: skipReason(), durationMs: 0, at: new Date().toISOString() });
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

  const n = Math.max(1, Math.min(opts.concurrency ?? list.concurrency ?? 1, queue.length || 1));
  await Promise.all(Array.from({ length: n }, (_, i) => worker(i)));

  const summary = writer.finish(aborted);
  onEvent({ type: "done", ...summary });
  return { ...summary, manifest: writer.manifest };
}
