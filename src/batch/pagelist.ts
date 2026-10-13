/**
 * Page lists (*.pages.yaml): what to capture. Made by `crawl`, by Record in the interactive
 * screen, or by hand; consumed by `run`. Only `pages:` is required:
 *
 *   base: https://admin.acme.com/
 *   pages:
 *     - /dashboard
 *     - /users
 *
 * See `pagestill help lists` for the full format.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import YAML, { type Document, isMap, isScalar, isSeq } from "yaml";
import { parseDuration } from "../core/duration.js";
import { slugify } from "../core/filename.js";
import type { LoadSpec, Step } from "../core/navigate.js";
import {
  type DprSetting,
  type SettingKey,
  type SettingsPatch,
  type Theme,
  type ViewportSetting,
  type Warn,
  formatDpr,
  normalizeSettings,
  parseDpr,
  viewportId,
  SETTING_BY_KEY,
} from "../core/settings.js";
import { globToRegExp, normalizeUrl } from "../core/urls.js";
import { warnOnce } from "../core/warn.js";

export const LIST_SUFFIX = ".pages.yaml";

export interface Matrix {
  viewport?: ViewportSetting[];
  theme?: Theme[];
  dpr?: DprSetting[];
}

export interface ListPage {
  url: string;
  /** Folder name for this page's files (default: from the URL). */
  name?: string;
  skip?: boolean;
  load?: LoadSpec;
  steps: Step[];
  settings?: SettingsPatch;
}

export interface PageList {
  name: string;
  base?: string;
  presets: string[];
  settings: SettingsPatch;
  matrix: Matrix;
  load: LoadSpec;
  /** Final URLs matching this (text or /regex/) mean "logged out". */
  login?: string;
  concurrency?: number;
  /** Reload the page for every matrix combination instead of re-emulating in place. */
  reload: boolean;
  pages: ListPage[];
}

export interface Variant {
  id: string;
  patch: SettingsPatch;
}

export interface ResolvedPage {
  url: string;
  name: string;
  load: LoadSpec;
  steps: Step[];
  settings?: SettingsPatch;
}

/** "admin.pages.yaml" → "admin" */
export function listName(path: string): string {
  return basename(path).replace(/\.pages\.ya?ml$|\.ya?ml$/i, "");
}

// ---------------------------------------------------------------------------------------------
// Reading

const TOP_KEYS = ["name", "base", "preset", "settings", "matrix", "load", "login", "concurrency", "reload", "pages"];
const PAGE_KEYS = ["url", "name", "skip", "load", "steps", "settings"];

export function loadPageList(path: string, warn: Warn = warnOnce): PageList {
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read ${path}: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).pages)) {
    throw new Error(`${path}: expected a "pages:" list (see: pagestill help lists)`);
  }
  return parsePageList(raw as Record<string, unknown>, path, warn);
}

export function parsePageList(raw: Record<string, unknown>, where: string, warn: Warn = warnOnce): PageList {
  const top = { ...raw };
  const legacy = (from: string, to: string) => {
    if (top[from] === undefined) return;
    warn(`${where}: "${from}:" is now "${to}:" (the old name works until v0.5)`);
    top[to] ??= top[from];
    delete top[from];
  };
  legacy("loginPattern", "login");
  legacy("actions", "steps"); // never valid at the top, but be forgiving

  // settings first: legacy keys below may add to them
  const settings: SettingsPatch = normalizeSettings(top.settings, `${where} settings`, warn);
  if (top.out !== undefined) {
    warn(`${where}: "out:" is now "settings: { out: ... }" (the old form works until v0.5)`);
    settings.out ??= String(top.out);
    delete top.out;
  }
  const load = normalizeLoad(top.load, top.wait, `${where}`, settings, warn);
  delete top.wait;

  for (const k of Object.keys(top)) {
    if (!TOP_KEYS.includes(k)) warn(`${where}: unknown key "${k}" ignored (see: pagestill help lists)`);
  }

  const pages = (top.pages as unknown[]).map((entry, i) => normalizePage(entry, `${where} pages[${i}]`, warn));
  return {
    name: typeof top.name === "string" && top.name ? top.name : listName(where),
    base: top.base === undefined ? undefined : String(top.base),
    presets: normalizePresets(top.preset),
    settings,
    matrix: normalizeMatrix(top.matrix, where),
    load,
    login: top.login === undefined ? undefined : String(top.login),
    concurrency: top.concurrency === undefined ? undefined : Number(top.concurrency),
    reload: top.reload === true,
    pages,
  };
}

function normalizePresets(v: unknown): string[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean);
}

/** `load:` plus the pre-0.4 `wait:` (whose `delay` moves into the `delay` setting). */
function normalizeLoad(load: unknown, oldWait: unknown, where: string, settings: SettingsPatch, warn: Warn): LoadSpec {
  const out: LoadSpec = {};
  const take = (o: Record<string, unknown>) => {
    if (o.until !== undefined) {
      const u = String(o.until);
      if (!["load", "domcontentloaded", "networkidle"].includes(u)) throw new Error(`${where}: load.until must be load, domcontentloaded or networkidle`);
      out.until = u as LoadSpec["until"];
    }
    if (o.waitFor !== undefined) out.waitFor = String(o.waitFor);
    if (o.timeout !== undefined) out.timeout = parseDuration(o.timeout);
  };
  if (oldWait && typeof oldWait === "object") {
    warn(`${where}: "wait:" is now "load:" with "waitFor:"; its "delay" is the "delay" setting (old form works until v0.5)`);
    const w = oldWait as Record<string, unknown>;
    take({ until: w.until, waitFor: w.selector, timeout: w.timeout });
    if (w.delay !== undefined) settings.delay ??= parseDuration(w.delay);
  }
  if (load && typeof load === "object") take(load as Record<string, unknown>);
  return out;
}

function normalizePage(entry: unknown, where: string, warn: Warn): ListPage {
  if (typeof entry === "string") return { url: entry, skip: false, steps: [] };
  if (!entry || typeof entry !== "object") throw new Error(`${where}: expected a URL or a mapping with url:`);
  const e = { ...(entry as Record<string, unknown>) };
  if (!e.url) throw new Error(`${where}: missing url:`);
  if (e.actions !== undefined) {
    warn(`${where}: "actions:" is now "steps:" (the old name works until v0.5)`);
    e.steps ??= e.actions;
    delete e.actions;
  }
  const settings = normalizeSettings(e.settings, `${where} settings`, warn);
  const load = normalizeLoad(e.load, e.wait, where, settings, warn);
  delete e.wait;
  for (const k of Object.keys(e)) if (!PAGE_KEYS.includes(k)) warn(`${where}: unknown key "${k}" ignored`);
  return {
    url: String(e.url),
    name: e.name === undefined ? undefined : String(e.name),
    skip: e.skip === true,
    load: Object.keys(load).length ? load : undefined,
    steps: normalizeSteps(e.steps, where, warn),
    settings: Object.keys(settings).length ? settings : undefined,
  };
}

const STEP_KEYS = ["click", "type", "press", "hover", "wait", "waitFor", "scroll", "eval"];

function normalizeSteps(raw: unknown, where: string, warn: Warn): Step[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error(`${where}: steps must be a list`);
  return raw.map((st, i) => {
    const at = `${where} steps[${i}]`;
    if (!st || typeof st !== "object" || Object.keys(st).length !== 1) throw new Error(`${at}: each step is one of ${STEP_KEYS.join(", ")}`);
    const [k, v] = Object.entries(st as Record<string, unknown>)[0]!;
    if (!STEP_KEYS.includes(k)) throw new Error(`${at}: unknown step "${k}" (use ${STEP_KEYS.join(", ")})`);
    if (k === "wait") return { wait: parseDuration(v) };
    if (k === "type") {
      const t = (v ?? {}) as Record<string, unknown>;
      if (t.selector !== undefined && t.into === undefined) {
        warn(`${at}: type.selector is now type.into (the old name works until v0.5)`);
        t.into = t.selector;
      }
      if (typeof t.into !== "string" || typeof t.text !== "string") throw new Error(`${at}: type needs { into: <css>, text: <text> }`);
      return { type: { into: t.into, text: t.text } };
    }
    return { [k]: String(v) } as Step;
  });
}

function normalizeMatrix(raw: unknown, where: string): Matrix {
  if (raw == null) return {};
  if (typeof raw !== "object") throw new Error(`${where}: matrix must be a mapping`);
  const m = raw as Record<string, unknown>;
  const list = (key: SettingKey) => {
    const v = m[key];
    if (v == null) return undefined;
    const arr = Array.isArray(v) ? v : [v];
    const def = SETTING_BY_KEY.get(key)!;
    return arr.map((x, i) => {
      try {
        return def.normalize(x);
      } catch (e) {
        throw new Error(`${where}: matrix.${key}[${i}]: ${(e as Error).message}`);
      }
    });
  };
  for (const k of Object.keys(m)) if (!["viewport", "theme", "dpr"].includes(k)) throw new Error(`${where}: matrix supports viewport, theme and dpr (got "${k}")`);
  return {
    viewport: list("viewport") as ViewportSetting[] | undefined,
    theme: list("theme") as Theme[] | undefined,
    dpr: list("dpr") as DprSetting[] | undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Expanding

/**
 * Every combination of the matrix. Axes set by a flag are dropped: a flag replaces that axis
 * for the run (e.g. `run list --theme dark` captures dark only instead of dark twice).
 */
export function variants(matrix: Matrix = {}, overridden: Set<SettingKey> = new Set()): Variant[] {
  const axes: Variant[][] = [];
  if (matrix.viewport?.length && !overridden.has("viewport")) {
    axes.push(matrix.viewport.map((viewport) => ({ id: viewportId(viewport), patch: { viewport } })));
  }
  if (matrix.theme?.length && !overridden.has("theme")) axes.push(matrix.theme.map((theme) => ({ id: theme, patch: { theme } })));
  if (matrix.dpr?.length && !overridden.has("dpr")) {
    axes.push(matrix.dpr.map((dpr) => ({ id: dpr === "as-is" ? "dpr-as-is" : formatDpr(dpr), patch: { dpr } })));
  }
  if (!axes.length) return [{ id: "capture", patch: {} }];
  return axes
    .reduce<Variant[]>(
      (acc, axis) => acc.flatMap((a) => axis.map((b) => ({ id: `${a.id}.${b.id}`, patch: { ...a.patch, ...b.patch } }))),
      [{ id: "", patch: {} }],
    )
    .map((v) => ({ ...v, id: v.id.replace(/^\./, "") }));
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

/**
 * Absolute URLs, unique folder names, merged load specs; skipped pages dropped.
 * `only` (a glob) keeps pages whose URL path or name matches.
 */
export function resolvePages(list: PageList, only?: string): ResolvedPage[] {
  const onlyRe = only ? globToRegExp(only) : undefined;
  const used = new Set<string>();
  const out: ResolvedPage[] = [];
  for (const p of list.pages) {
    if (p.skip) continue;
    let url: string;
    try {
      url = new URL(p.url, list.base).toString();
    } catch {
      throw new Error(`Cannot resolve "${p.url}"${list.base ? ` against ${list.base}` : " (a relative URL needs base:)"}`);
    }
    const wanted = slugify(p.name ?? "") || pageName(url, list.base);
    if (onlyRe) {
      const u = new URL(url);
      if (![u.pathname + u.search, u.pathname, wanted, p.url].some((t) => onlyRe.test(t))) continue;
    }
    let name = wanted;
    for (let i = 2; used.has(name); i++) name = `${wanted}-${i}`;
    used.add(name);
    out.push({ url, name, load: { ...list.load, ...p.load }, steps: p.steps, settings: p.settings });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Writing (crawl, Record) and editing (edit)

export interface ListEntry {
  url: string;
  skip?: boolean;
  /** Comment written above the entry (e.g. the URL pattern group). */
  comment?: string;
  /** Comment after the entry on the same line (e.g. the page title). */
  note?: string;
}

function relativeTo(base: string | undefined, url: string): string {
  if (!base) return url;
  const b = new URL(base);
  const u = new URL(url);
  return u.origin === b.origin ? u.pathname + u.search : url;
}

function entryNode(doc: Document, base: string | undefined, e: ListEntry) {
  const url = relativeTo(base, e.url);
  const node = doc.createNode(e.skip ? { url, skip: true } : url);
  if (e.comment) node.commentBefore = e.comment;
  if (e.note) {
    const note = ` ${e.note.replace(/\s+/g, " ")}`;
    // keep the note next to the url: `- url: /x # Title`
    if (isMap(node)) {
      const u = node.get("url", true);
      if (isScalar(u)) u.comment = note;
    } else node.comment = note;
  }
  return node;
}

/** Write a new commented, hand-editable page list. */
export function writePageList(path: string, opts: { header: string; base?: string; entries: ListEntry[] }): void {
  const doc = new YAML.Document({ base: opts.base, pages: [] as unknown[] });
  doc.commentBefore = opts.header;
  if (!opts.base) doc.delete("base");
  const pages = doc.get("pages", true);
  if (isSeq(pages)) for (const e of opts.entries) pages.items.push(entryNode(doc, opts.base, e));
  writeFileSync(path, doc.toString({ lineWidth: 0 }));
}

/**
 * Add entries to a page list, creating it if needed. Existing content, settings and comments are
 * kept; URLs already in the list are skipped. Returns how many entries were added.
 */
export function appendToPageList(path: string, opts: { header: string; base?: string; entries: ListEntry[] }): number {
  if (!existsSync(path)) {
    writePageList(path, opts);
    return opts.entries.length;
  }
  const doc = YAML.parseDocument(readFileSync(path, "utf8"));
  const pages = doc.get("pages", true);
  if (!isSeq(pages)) throw new Error(`${path}: expected a "pages:" list`);
  const base = (doc.get("base") as string | undefined) ?? undefined;
  const present = new Set<string>();
  for (const item of pages.items) {
    const raw = isScalar(item) ? String(item.value) : isMap(item) ? String(item.get("url") ?? "") : "";
    const abs = normalizeUrl(raw, base);
    if (abs) present.add(abs);
  }
  let added = 0;
  for (const e of opts.entries) {
    const key = normalizeUrl(e.url);
    if (key && present.has(key)) continue;
    if (key) present.add(key);
    pages.items.push(entryNode(doc, base, e));
    added++;
  }
  writeFileSync(path, doc.toString({ lineWidth: 0 }));
  return added;
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
    const urlNode = map.get("url", true);
    if (isScalar(urlNode)) urlNode.comment = item.comment;
    pages.items[index] = map;
  } else if (isMap(item)) {
    if (skip) {
      item.set("skip", true);
      return;
    }
    item.delete("skip");
    // back to the short form when only the url is left
    const urlNode = item.get("url", true);
    if (item.items.length === 1 && isScalar(urlNode)) {
      urlNode.commentBefore = item.commentBefore;
      urlNode.comment ??= item.comment;
      pages.items[index] = urlNode;
    }
  }
}
