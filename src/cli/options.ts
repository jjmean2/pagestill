import { type Command, Option } from "commander";
import { DEFAULT_PORT, DEFAULT_PROFILE_DIR } from "../core/chrome.js";
import type { BrowserConfig } from "../core/config.js";
import type { ConnectOptions } from "../core/session.js";
import { DEFAULT_SETTINGS, SETTINGS, type SettingKey, type SettingsPatch, flagName } from "../core/settings.js";
import { warnOnce } from "../core/warn.js";

export const CAPTURE_GROUP = "Capture options:";
export const BROWSER_GROUP = "Browser options:";

/** Pre-0.4 flag names, still accepted with a warning until v0.5. */
const LEGACY_FLAGS: { flag: string; key: SettingKey; arg?: string }[] = [
  { flag: "wait", key: "delay", arg: "ms" },
  { flag: "selector", key: "element", arg: "css" },
  { flag: "lazy", key: "lazyLoad" },
  { flag: "archiver", key: "htmlEngine", arg: "id" },
];

/**
 * Every setting as a flag, generated from the settings registry so flag names always match the
 * YAML keys. Booleans get both --x and --no-x (neither set = "not given", so lower layers win).
 * `full` shows every setting in --help; otherwise only the common ones are listed.
 */
export function addCaptureOptions(cmd: Command, { full = false } = {}): Command {
  cmd.addOption(new Option("-p, --preset <names>", "start from saved presets, e.g. retina,dark").helpGroup(CAPTURE_GROUP));
  for (const d of SETTINGS) {
    const flag = flagName(d.key);
    const hidden = !full && !d.common;
    if (!d.arg) {
      const on = new Option(`--${flag}`, d.description).helpGroup(CAPTURE_GROUP);
      const off = new Option(`--no-${flag}`, `don't ${d.description}`).helpGroup(CAPTURE_GROUP);
      // show the form that changes the default
      const defaultOn = DEFAULT_SETTINGS[d.key] === true;
      on.hideHelp(hidden || defaultOn);
      off.hideHelp(hidden || !defaultOn);
      cmd.addOption(on).addOption(off);
    } else {
      const variadic = d.key === "hide" ? "..." : "";
      const short = d.key === "out" ? "-o, " : "";
      const arg = d.key === "hide" ? "css" : d.arg;
      cmd.addOption(new Option(`${short}--${flag} <${arg}${variadic}>`, d.description).helpGroup(CAPTURE_GROUP).hideHelp(hidden));
    }
  }
  for (const l of LEGACY_FLAGS) {
    cmd.addOption(new Option(l.arg ? `--${l.flag} <${l.arg}>` : `--${l.flag}`).hideHelp());
  }
  return cmd;
}

/** Turn parsed flags into a settings patch (only what was given). */
export function settingsFromFlags(flags: Record<string, unknown>): SettingsPatch {
  const out: Record<string, unknown> = {};
  for (const l of LEGACY_FLAGS) {
    if (flags[l.flag] === undefined) continue;
    warnOnce(`--${l.flag} is now --${flagName(l.key)} (the old flag works until v0.5)`);
    flags[l.key] ??= flags[l.flag];
  }
  for (const d of SETTINGS) {
    const v = flags[d.key];
    if (v === undefined) continue;
    try {
      out[d.key] = d.normalize(v);
    } catch (e) {
      throw new Error(`--${flagName(d.key)}: ${(e as Error).message}`);
    }
  }
  return out as SettingsPatch;
}

export interface BrowserFlags {
  port?: string;
  launch?: boolean;
  chrome?: string;
  profile?: string;
  ws?: string;
  autoConnect?: boolean;
}

export function addBrowserOptions(cmd: Command, { full = false } = {}): Command {
  const opt = (flags: string, description: string, common = false) =>
    cmd.addOption(new Option(flags, description).helpGroup(BROWSER_GROUP).hideHelp(!full && !common));
  opt("--port <n>", `DevTools port (default: ${DEFAULT_PORT})`, true);
  opt("--ws <url>", "connect to this DevTools WebSocket URL");
  opt(
    "--auto-connect",
    "use your everyday Chrome (experimental). Turn on remote debugging at chrome://inspect/#remote-debugging and allow the prompt; on macOS your terminal needs Full Disk Access",
    true,
  );
  opt("--no-launch", "fail instead of starting Chrome");
  opt("--chrome <path>", "Chrome executable (or $PAGESTILL_CHROME)");
  opt("--profile <dir>", `profile folder for the pagestill Chrome (default: ${DEFAULT_PROFILE_DIR})`);
  return cmd;
}

export function connectOptions(f: BrowserFlags, browser: BrowserConfig = {}, url?: string): ConnectOptions {
  return {
    port: f.port ? Number(f.port) : browser.port,
    launch: f.launch,
    chromePath: f.chrome ?? browser.chrome,
    profileDir: f.profile ?? browser.profile,
    wsEndpoint: f.ws,
    autoConnect: f.autoConnect,
    url,
    log: (m) => process.stderr.write(`${m}\n`),
  };
}
