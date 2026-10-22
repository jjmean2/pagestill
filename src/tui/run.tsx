import { render } from "ink";
import { type Config, loadTuiState, presetPatches, saveTuiState } from "../core/config.js";
import type { BrowserSession } from "../core/session.js";
import { DEFAULT_SETTINGS, type SettingsPatch, mergeSettings } from "../core/settings.js";
import { App } from "./App.js";

export interface RunTuiOptions {
  config: Config;
  /** Presets from --preset. */
  presets: string[];
  /** Settings from command-line flags (applied, never saved). */
  flags: SettingsPatch;
  connect: () => Promise<BrowserSession>;
  version: string;
}

export async function runTui({ config, presets, flags, connect, version }: RunTuiOptions): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("The interactive screen needs a terminal. Use `pagestill shot` in scripts.");
  const restored = loadTuiState();
  const presetLayers = presetPatches(config, presets);
  // R resets to this: the same order shot and run use.
  const base = mergeSettings(DEFAULT_SETTINGS, config.defaults, ...presetLayers, flags);
  // The screen starts from the last session; presets and flags given now still win.
  const initial = mergeSettings(DEFAULT_SETTINGS, config.defaults, restored, ...presetLayers, flags);

  process.stderr.write("Connecting to Chrome…\n");
  const session = await connect();
  let latest: SettingsPatch = restored;
  let current = session;
  const app = render(
    <App
      session={session}
      reconnect={async () => {
        current = await connect();
        return current;
      }}
      config={config}
      version={version}
      base={base}
      initial={initial}
      restored={restored}
      presetLabel={presets.length ? presets.join(",") : undefined}
      onSession={(p) => (latest = p)}
    />,
    // Full screen like lazygit or htop; the terminal's own screen comes back on exit.
    { alternateScreen: true },
  );
  try {
    await app.waitUntilExit();
  } finally {
    // Detaching our CDP sessions also drops any emulation still applied to the user's tabs.
    await current.disconnect().catch(() => {});
    saveTuiState(latest);
  }
}
