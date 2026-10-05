import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import YAML, { isMap, isScalar, isSeq, type Document } from "yaml";
import { slugify } from "../core/filename.js";
import type { Action, WaitSpec } from "../core/navigate.js";
import {
  type CaptureSettings,
  type DprSetting,
  type Theme,
  type ViewportSetting,
  formatDpr,
  parseDpr,
  parseViewport,
} from "../core/settings.js";

/**
 * A job file lists pages to capture automatically. Minimal form:
 *
 *   base: https://admin.acme.com
 *   pages:
 *     - /dashboard
 *     - /users
 */
export interface JobPage {
  url: string;
  /** Folder name for this page's files (default: from the URL). */
  name?: string;
  /** Keep the entry in the file but don't capture it. */
  skip?: boolean;
  wait?: WaitSpec;
  /** Steps run after loading and before capturing (open a tab, close a modal...). */
  actions?: Action[];
  settings?: Partial<CaptureSettings>;
}

export interface JobMatrix {
  viewport?: (string | ViewportSetting)[];
  dpr?: (string | number)[];
  theme?: Theme[];
}

export interface Job {
  name?: string;
  /** Relative page URLs are resolved against this. */
  base?: string;
  /** Preset from ~/.pagestill/config.yaml applied before `settings`. */
  preset?: string;
  settings?: Partial<CaptureSettings>;
  /** Every page is captured once per combination. */
  matrix?: JobMatrix;
  wait?: WaitSpec;
  /** Final URLs matching this (substring or /regex/) mean "logged out": pause for a human. */
  loginPattern?: string;
  /** Pages captured in parallel, each in its own window (default 1). */
  concurrency?: number;
  /** Output root (default: settings.outDir). A run folder is created inside. */
  out?: string;
  /** Reload the page for every matrix variant instead of re-emulating in place. */
  reload?: boolean;
  pages: (string | JobPage)[];
}

export interface Variant {
  id: string;
  patch: Partial<CaptureSettings>;
}

export interface ResolvedPage {
  url: string;
  name: string;
  wait: WaitSpec;
  actions: Action[];
  settings?: Partial<CaptureSettings>;
}

export function loadJob(path: string): Job {
  const job = YAML.parse(readFileSync(path, "utf8")) as Job | null;
  if (!job || !Array.isArray(job.pages)) throw new Error(`${path}: expected a "pages:" list`);
  job.name ??= basename(path, extname(path));
  return job;
}

export function variants(matrix: JobMatrix = {}): Variant[] {
  const axes: Variant[][] = [];
  if (matrix.viewport?.length) {
    axes.push(
      matrix.viewport.map((v) => {
        const viewport = typeof v === "string" ? parseViewport(v) : v;
        const id = viewport === "as-is" ? "as-is" : `${viewport.width}x${viewport.height}${viewport.mobile ? "m" : ""}`;
        return { id, patch: { viewport } };
      }),
    );
  }
  if (matrix.theme?.length) axes.push(matrix.theme.map((theme) => ({ id: theme, patch: { theme } })));
  if (matrix.dpr?.length) {
    axes.push(
      matrix.dpr.map((d) => {
        const dpr: DprSetting = typeof d === "number" ? d : parseDpr(d);
        return { id: dpr === "as-is" ? "dpr-as-is" : formatDpr(dpr), patch: { dpr } };
      }),
    );
  }
  if (!axes.length) return [{ id: "capture", patch: {} }];
  return axes.reduce<Variant[]>(
    (acc, axis) => acc.flatMap((a) => axis.map((b) => ({ id: `${a.id}.${b.id}`, patch: { ...a.patch, ...b.patch } }))),
    [{ id: "", patch: {} }],
  ).map((v) => ({ ...v, id: v.id.replace(/^\./, "") }));
}

/** Folder-friendly name from the URL path (relative to `base`'s path when under it) and query. */
export function pageName(url: string, base?: string): string {
  const u = new URL(url);
  let pathname = u.pathname;
  if (base) {
    const b = new URL(base);
    const prefix = b.pathname.replace(/[^/]*$/, "");
    if (b.origin === u.origin && pathname.startsWith(prefix)) pathname = pathname.slice(prefix.length);
  }
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {}
  const path = slugify(decoded);
  const query = slugify([...u.searchParams].map(([k, v]) => `${k}-${v}`).join("-"));
  return [path || "index", query].filter(Boolean).join("--").slice(0, 100);
}

/** Absolute URLs, unique folder names, merged waits; skipped pages dropped. */
export function resolvePages(job: Job): ResolvedPage[] {
  const used = new Set<string>();
  const out: ResolvedPage[] = [];
  for (const entry of job.pages) {
    const p: JobPage = typeof entry === "string" ? { url: entry } : entry;
    if (p.skip) continue;
    if (!p.url) throw new Error(`Page entry without url: ${JSON.stringify(entry)}`);
    let url: string;
    try {
      url = new URL(p.url, job.base).toString();
    } catch {
      throw new Error(`Cannot resolve "${p.url}"${job.base ? ` against ${job.base}` : " (relative URL needs base:)"}`);
    }
    const wanted = slugify(p.name ?? "") || pageName(url, job.base);
    let name = wanted;
    for (let i = 2; used.has(name); i++) name = `${wanted}-${i}`;
    used.add(name);
    out.push({ url, name, wait: { ...job.wait, ...p.wait }, actions: p.actions ?? [], settings: p.settings });
  }
  return out;
}

export interface JobFileEntry {
  url: string;
  skip?: boolean;
  /** Comment written above the entry (e.g. the URL pattern group). */
  comment?: string;
  /** Comment after the entry on the same line (e.g. page title). */
  note?: string;
}

/** Write a commented, hand-editable job file. Relative URLs are used when they share `base`. */
export function writeJobFile(path: string, opts: { header: string; base?: string; entries: JobFileEntry[] }): void {
  const rel = (url: string) => {
    if (!opts.base) return url;
    const b = new URL(opts.base);
    const u = new URL(url);
    return u.origin === b.origin ? u.pathname + u.search : url;
  };
  const doc = new YAML.Document({
    base: opts.base,
    settings: {},
    pages: opts.entries.map((e) => (e.skip ? { url: rel(e.url), skip: true } : rel(e.url))),
  });
  doc.commentBefore = opts.header;
  const pages = doc.get("pages", true);
  if (isSeq(pages)) {
    pages.items.forEach((item, i) => {
      const e = opts.entries[i]!;
      if (e.comment && (isScalar(item) || isMap(item))) item.commentBefore = e.comment;
      if (e.note && (isScalar(item) || isMap(item))) item.comment = e.note;
    });
  }
  if (!opts.base) doc.delete("base");
  writeFileSync(path, doc.toString({ lineWidth: 0 }));
}

/** Toggle `skip` on page entries in place, keeping comments and formatting. */
export function setSkipped(doc: Document, index: number, skip: boolean): void {
  const pages = doc.get("pages", true);
  if (!isSeq(pages)) return;
  const item = pages.items[index];
  if (isScalar(item)) {
    if (!skip) return;
    const map = doc.createNode({ url: item.value, skip: true });
    map.commentBefore = item.commentBefore;
    map.comment = item.comment;
    pages.items[index] = map;
  } else if (isMap(item)) {
    if (skip) item.set("skip", true);
    else item.delete("skip");
  }
}
