import { existsSync } from "node:fs";
import { join } from "node:path";

export interface FilenameVars {
  url: string;
  title: string;
  date: Date;
  width?: number;
  height?: number;
  dpr?: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Local-time stamp for file names: YYYYMMDD-HHmmss. */
export function localStamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Local date and time for humans: YYYY-MM-DD HH:mm. */
export function localDateTime(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Filesystem-safe, readable slug. Keeps non-ASCII letters (e.g. Korean). */
export function slugify(text: string, max = 80): string {
  const s = text
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#%&{}$!'@`=+\s.,;~^()[\]]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return s.slice(0, max).replace(/-$/, "");
}

export function pathSlug(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return slugify(u.pathname.split("/").pop() ?? "file") || "file";
    const s = slugify(decodeURIComponent(u.pathname));
    return s || "index";
  } catch {
    return "page";
  }
}

/**
 * Variables: {date} YYYYMMDD, {time} HHmmss, {host}, {slug} (URL path), {title},
 * {w} {h} {dpr} (image only; empty for HTML-only captures). Slashes create subfolders.
 */
export function renderFilename(template: string, v: FilenameVars): string {
  let host = "local";
  try {
    host = new URL(v.url).hostname || "local";
  } catch {}
  const d = v.date;
  const map: Record<string, string> = {
    date: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    host: slugify(host),
    slug: pathSlug(v.url),
    title: slugify(v.title) || "untitled",
    w: v.width ? String(v.width) : "",
    h: v.height ? String(v.height) : "",
    dpr: v.dpr ? String(v.dpr) : "",
  };
  return template.replace(/\{(\w+)\}/g, (m, k: string) => map[k] ?? m);
}

/** Return `base` or `base-2`, `base-3`... so that none of base+ext exists in dir. */
export function uniqueBase(dir: string, base: string, exts: string[]): string {
  let candidate = base;
  for (let i = 2; exts.some((e) => existsSync(join(dir, candidate + e))); i++) candidate = `${base}-${i}`;
  return candidate;
}
