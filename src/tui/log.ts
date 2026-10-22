/**
 * The session log: what happened, newest last. Kept in memory only (max 500 entries).
 * The main screen's Log panel shows the tail; the Log page shows everything.
 */
export type LogKind =
  | "capture" // ✓ saved files
  | "check" // ? saved, with warnings
  | "error" // ✗ something failed (text says what to do next)
  | "tab" // → following / pinned another tab
  | "browser" // ! emulation changed what Chrome shows
  | "mode" // ● record / ◉ auto on/off, list saved
  | "conn" // connection lost / back
  | "setting"; // · a setting changed (Log page only)

export interface LogEntry {
  id: number;
  time: Date;
  kind: LogKind;
  text: string;
  /** Second line on the Log page (file path, what to do next). */
  detail?: string;
  /** Right-aligned, e.g. how long a capture took. */
  right?: string;
  /** Files this entry produced (captures): opened from the Log page. */
  files?: string[];
}

export const LOG_LIMIT = 500;

export const MARK: Record<LogKind, { symbol: string; color?: string }> = {
  capture: { symbol: "✓", color: "green" },
  check: { symbol: "?", color: "yellow" },
  error: { symbol: "✗", color: "red" },
  tab: { symbol: "→" },
  browser: { symbol: "!", color: "yellow" },
  mode: { symbol: "●", color: "magenta" },
  conn: { symbol: "●", color: "cyan" },
  setting: { symbol: "·" },
};

/** Kinds shown in the main screen's Log panel (settings changes would drown everything else). */
export function onMainLog(e: LogEntry): boolean {
  return e.kind !== "setting";
}

export type LogFilter = "all" | "captures" | "problems";
export const LOG_FILTERS: LogFilter[] = ["all", "captures", "problems"];

export function matchesFilter(e: LogEntry, f: LogFilter): boolean {
  if (f === "captures") return e.kind === "capture" || e.kind === "check";
  if (f === "problems") return e.kind === "error" || e.kind === "check";
  return true;
}

let nextId = 1;

/** Append, folding a run of tab changes into the latest one, and cap the length. */
export function appendLog(log: LogEntry[], entry: Omit<LogEntry, "id" | "time">): LogEntry[] {
  const e: LogEntry = { ...entry, id: nextId++, time: new Date() };
  const last = log.at(-1);
  const base = last && last.kind === "tab" && e.kind === "tab" ? log.slice(0, -1) : log;
  const next = [...base, e];
  return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
}
