import { homedir } from "node:os";
import stringWidth from "string-width";

/** Display width in terminal cells (wide characters such as Korean count as 2). */
export const sw = (s: string): number => stringWidth(s);

/** The first characters of `s` that fit in `n` cells (no ellipsis). */
export function cutCells(s: string, n: number): string {
  let out = "";
  for (const ch of s) {
    if (sw(out + ch) > n) break;
    out += ch;
  }
  return out;
}

/** Cut to `max` cells, ending with "…" when shortened. */
export function truncEnd(s: string, max: number): string {
  if (max <= 0) return "";
  if (sw(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (sw(out + ch) > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

/** Keep both ends, drop the middle: "~/work/pagestill-out/…/users.png". */
export function truncMiddle(s: string, max: number): string {
  if (max <= 0) return "";
  if (sw(s) <= max) return s;
  const chars = [...s];
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  let left = "";
  for (const ch of chars) {
    if (sw(left + ch) > head) break;
    left += ch;
  }
  let right = "";
  for (let i = chars.length - 1; i >= 0; i--) {
    if (sw(chars[i]! + right) > keep - sw(left)) break;
    right = chars[i]! + right;
  }
  return `${left}…${right}`;
}

/** Pad with spaces to exactly `n` cells (truncating if longer). */
export function padTo(s: string, n: number): string {
  const t = truncEnd(s, n);
  return t + " ".repeat(Math.max(0, n - sw(t)));
}

/** Inside the current directory: relative ("pagestill-out/shots"); else with ~ for home. */
export function displayPath(path: string): string {
  const cwd = process.cwd();
  if (path === cwd) return ".";
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return tilde(path);
}

/** Split into lines of at most `width` cells (for long file names). */
export function wrapCells(s: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (sw(cur + ch) > width) {
      lines.push(cur);
      cur = "";
      if (lines.length === maxLines) break;
    }
    cur += ch;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  // cut short: make room for "…" on the last line
  if (lines.length === maxLines && sw(lines.join("")) < sw(s)) {
    const last = lines[maxLines - 1]!;
    lines[maxLines - 1] = `${cutCells(last, width - 1)}…`;
  }
  return lines;
}

/** "/Users/me/work" → "~/work" */
export function tilde(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 8);
}
