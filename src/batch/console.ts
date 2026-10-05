import { createInterface } from "node:readline/promises";
import { relative } from "node:path";
import type { LoginDecision, RunEvent } from "./runner.js";

const isTTY = !!process.stdin.isTTY && !!process.stderr.isTTY;
const c = (code: number, s: string) => (process.stderr.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const out = (s: string) => process.stderr.write(`${s}\n`);
/** Relative to cwd when inside it, absolute otherwise. */
const show = (p: string) => {
  const r = relative(process.cwd(), p);
  return !r || r.startsWith("..") ? p : r;
};

/** Line-based progress for `pagestill run` (stderr, so stdout stays clean for scripts). */
export function reportRun(e: RunEvent): void {
  switch (e.type) {
    case "start":
      out(`${c(1, "pagestill run")} → ${show(e.runDir)}`);
      out(`${e.total} captures${e.alreadyDone ? `, ${e.alreadyDone} already done (resume)` : ""}`);
      break;
    case "task":
      if (isTTY) process.stderr.write(c(2, `  … ${e.page} ${e.variant}\r`));
      break;
    case "entry": {
      const { entry: x } = e;
      const mark = x.status === "ok" ? c(32, "✓") : x.status === "skipped" ? c(33, "–") : c(31, "✗");
      const detail = x.status === "ok" ? c(2, `${(x.durationMs / 1000).toFixed(1)}s`) : c(x.status === "failed" ? 31 : 33, x.error ?? "");
      if (isTTY) process.stderr.write("\x1b[2K");
      out(`${c(2, `[${e.done}/${e.total}]`)} ${mark} ${x.page} ${c(36, x.variant)} ${detail}`);
      for (const w of x.warnings) out(c(33, `      ! ${w}`));
      break;
    }
    case "info":
      out(c(2, e.message));
      break;
    case "done":
      out(
        `${e.aborted ? c(33, "Aborted") : c(1, "Done")}: ${c(32, `${e.ok} ok`)}, ${e.failed ? c(31, `${e.failed} failed`) : "0 failed"}, ${e.skipped} skipped`,
      );
      out(`Gallery: ${show(`${e.runDir}/index.html`)}`);
      if (e.failed || e.skipped) out(c(2, `Retry the rest with: --resume ${show(e.runDir)}`));
      break;
  }
}

/** Ask a human to log in. Without a terminal there is nobody to ask: skip the page. */
export async function askLogin(info: { url: string; finalUrl: string }): Promise<LoginDecision> {
  if (!isTTY) {
    out(c(33, `Login required for ${info.url} (landed on ${info.finalUrl}); no terminal to ask, skipping.`));
    return "skip";
  }
  if (process.stderr.isTTY) process.stderr.write("\x07\x1b[2K");
  out(c(33, `\nLogin required: ${info.url} redirected to ${info.finalUrl}`));
  out("Log in in the Chrome window that just came to the front, then:");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question("  ⏎ continue · s skip this page · q stop the run > ")).trim().toLowerCase();
    return answer === "q" ? "abort" : answer === "s" ? "skip" : "retry";
  } finally {
    rl.close();
  }
}
