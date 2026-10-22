import { describe, expect, it } from "vitest";
import { keysTopic, MAIN_KEYS, VIEW_KEYS } from "../src/tui/keys.js";
import { appendLog, type LogEntry, matchesFilter } from "../src/tui/log.js";
import { padTo, sw, truncEnd, truncMiddle, wrapCells } from "../src/tui/ui/text.js";
import { mainLayout } from "../src/tui/views/MainView.js";

describe("text cells", () => {
  it("counts wide characters as two cells", () => {
    expect(sw("abc")).toBe(3);
    expect(sw("설정")).toBe(4);
    expect(padTo("설정", 6)).toBe("설정  ");
  });

  it("truncates at the end or in the middle", () => {
    expect(truncEnd("pagestill-out", 8)).toBe("pagesti…");
    expect(truncMiddle("pagestill-out/shots/users.png", 15)).toBe("pagesti…ers.png");
    expect(sw(truncMiddle("대시보드/설정/사용자/목록", 9))).toBeLessThanOrEqual(9);
  });

  it("wraps long names over a fixed number of lines", () => {
    expect(wrapCells("abcdefghij", 4, 2)).toEqual(["abcd", "efg…"]);
    expect(wrapCells("abcdef", 4, 2)).toEqual(["abcd", "ef"]);
  });
});

describe("main layout", () => {
  it("puts settings and output side by side from 100 columns", () => {
    expect(mainLayout(100, 30, { emulating: false, recording: false, recCount: 0 }).wide).toBe(true);
    expect(mainLayout(99, 30, { emulating: false, recording: false, recCount: 0 }).wide).toBe(false);
  });

  it("gives the log the rest of the height", () => {
    const l = mainLayout(100, 30, { emulating: true, recording: false, recCount: 0 });
    expect(l.tabH + l.settingsH + l.logH).toBe(30);
  });

  it("shrinks recording, then the emulation line, then the tab when short", () => {
    const tall = mainLayout(80, 40, { emulating: true, recording: true, recCount: 5 });
    expect(tall).toMatchObject({ recLines: 3, showEmulation: true, tabOneLine: false });
    const short = mainLayout(60, 16, { emulating: true, recording: true, recCount: 5 });
    expect(short).toMatchObject({ recLines: 1, showEmulation: false, tabOneLine: true });
  });
});

describe("keys", () => {
  it("documents every main-screen key and setting key", () => {
    const text = keysTopic();
    for (const k of MAIN_KEYS) expect(text).toContain(k.key);
    expect(text).toMatch(/L\s+Lazy load/);
    expect(text).toMatch(/l\s+log/);
    expect(VIEW_KEYS.settings.map((k) => k.key)).toContain("/");
  });
});

describe("log", () => {
  const add = (log: LogEntry[], kind: LogEntry["kind"], text: string) => appendLog(log, { kind, text });

  it("folds consecutive tab changes into the latest", () => {
    let log: LogEntry[] = [];
    log = add(log, "tab", "following A");
    log = add(log, "tab", "following B");
    log = add(log, "capture", "a.png");
    log = add(log, "tab", "following C");
    expect(log.map((e) => e.text)).toEqual(["following B", "a.png", "following C"]);
  });

  it("filters captures and problems", () => {
    const log = add(add(add([], "capture", "a"), "error", "b"), "check", "c");
    expect(log.filter((e) => matchesFilter(e, "captures")).map((e) => e.text)).toEqual(["a", "c"]);
    expect(log.filter((e) => matchesFilter(e, "problems")).map((e) => e.text)).toEqual(["b", "c"]);
  });
});
