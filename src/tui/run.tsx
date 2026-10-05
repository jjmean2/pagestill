import { render } from "ink";
import { loadConfig, saveConfig, diffFromDefaults } from "../core/config.js";
import type { BrowserSession } from "../core/session.js";
import type { CaptureSettings } from "../core/settings.js";
import { App } from "./App.js";

export interface RunTuiOptions {
  settings: CaptureSettings;
  connect: () => Promise<BrowserSession>;
  version: string;
}

export async function runTui({ settings, connect, version }: RunTuiOptions): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("The interactive UI needs a terminal. Use `pagestill shot` in scripts.");
  process.stderr.write("Connecting to Chrome…\n");
  const session = await connect();
  const config = loadConfig();
  let latest = settings;
  const app = render(
    <App session={session} initialSettings={settings} config={config} version={version} onSettings={(s) => (latest = s)} />,
  );
  try {
    await app.waitUntilExit();
  } finally {
    // Detaching our CDP sessions also drops any emulation still applied to the user's tabs.
    await session.disconnect().catch(() => {});
    const fresh = loadConfig();
    fresh.settings = diffFromDefaults(latest);
    saveConfig(fresh);
  }
}
