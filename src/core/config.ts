import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { type CaptureSettings, DEFAULT_SETTINGS, mergeSettings } from "./settings.js";

export interface BrowserConfig {
  port?: number;
  chromePath?: string;
  profileDir?: string;
}

export interface Config {
  /** Last-used settings, restored on the next start. */
  settings?: Partial<CaptureSettings>;
  presets?: Record<string, Partial<CaptureSettings>>;
  browser?: BrowserConfig;
}

export const HOME = process.env.PAGESTILL_HOME ?? join(homedir(), ".pagestill");
export const CONFIG_PATH = join(HOME, "config.yaml");

export function loadConfig(path = CONFIG_PATH): Config {
  try {
    return (YAML.parse(readFileSync(path, "utf8")) as Config | null) ?? {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read ${path}: ${(e as Error).message}`);
  }
}

export function saveConfig(config: Config, path = CONFIG_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, YAML.stringify(config));
}

/** Defaults ← last-used settings ← preset. */
export function initialSettings(config: Config, preset?: string): CaptureSettings {
  let s = mergeSettings(DEFAULT_SETTINGS, config.settings);
  if (preset) {
    const p = config.presets?.[preset];
    if (!p) throw new Error(`Unknown preset "${preset}". Known: ${Object.keys(config.presets ?? {}).join(", ") || "(none)"}`);
    s = mergeSettings(s, p);
  }
  return s;
}

/** Only the keys that differ from the defaults, so presets/config stay small and readable. */
export function diffFromDefaults(s: CaptureSettings): Partial<CaptureSettings> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    const d = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k];
    if (k === "htmlOptions") {
      const h: Record<string, unknown> = {};
      for (const [hk, hv] of Object.entries(v as object)) {
        if (JSON.stringify(hv) !== JSON.stringify((d as Record<string, unknown>)[hk])) h[hk] = hv;
      }
      if (Object.keys(h).length) out[k] = h;
    } else if (JSON.stringify(v) !== JSON.stringify(d)) {
      out[k] = v;
    }
  }
  return out as Partial<CaptureSettings>;
}
