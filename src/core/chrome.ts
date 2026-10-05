import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 9222;
export const DEFAULT_PROFILE_DIR = join(homedir(), ".pagestill", "chrome-profile");

const CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
  ],
  win32: [
    join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
  ],
};

export function findChrome(): string | undefined {
  if (process.env.PAGESTILL_CHROME && existsSync(process.env.PAGESTILL_CHROME)) return process.env.PAGESTILL_CHROME;
  return (CANDIDATES[platform()] ?? []).find((p) => existsSync(p));
}

/** Returns the DevTools websocket URL if something answers on the port. */
export async function probe(port: number): Promise<string | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return undefined;
    const info = (await res.json()) as { webSocketDebuggerUrl?: string };
    return info.webSocketDebuggerUrl;
  } catch {
    return undefined;
  }
}

export interface LaunchOptions {
  port: number;
  chromePath?: string;
  profileDir: string;
  url?: string;
}

/**
 * Launch a detached Chrome with remote debugging on a dedicated profile.
 * Chrome 136+ refuses --remote-debugging-port on the default profile, so a separate
 * --user-data-dir is required; logins made there persist across runs.
 * The browser outlives pagestill on purpose: it is the user's working window.
 */
export async function launchChrome(opts: LaunchOptions): Promise<string> {
  const exe = opts.chromePath ?? findChrome();
  if (!exe) throw new Error("Chrome not found. Pass --chrome <path> or set PAGESTILL_CHROME.");
  mkdirSync(opts.profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    // keep background tabs rendering (batch capture, tab switching)
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    // extra flags, e.g. "--headless=new --no-sandbox" on CI or "--proxy-server=..."
    ...(process.env.PAGESTILL_CHROME_ARGS ?? "").split(/\s+/).filter(Boolean),
    opts.url ?? "about:blank",
  ];
  const child = spawn(exe, args, { detached: true, stdio: "ignore" });
  child.unref();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const ws = await probe(opts.port);
    if (ws) return ws;
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Chrome did not open a debugging port on ${opts.port}. If a Chrome using the same profile is already ` +
      `running without remote debugging, quit it first.`,
  );
}

/**
 * Experimental: connect to the user's everyday Chrome after they enabled remote debugging at
 * chrome://inspect/#remote-debugging (recent Chrome versions). Chrome writes the port and path
 * to DevToolsActivePort in its user data dir.
 */
export function readDevToolsActivePort(userDataDir = defaultChromeUserDataDir()): string | undefined {
  try {
    const [port, path] = readFileSync(join(userDataDir, "DevToolsActivePort"), "utf8").split("\n");
    if (!port || !path) return undefined;
    return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
  } catch {
    return undefined;
  }
}

export function defaultChromeUserDataDir(): string {
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Google", "Chrome");
    case "win32":
      return join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data");
    default:
      return join(homedir(), ".config", "google-chrome");
  }
}
