/**
 * ~/.pagestill/config.yaml
 *
 *   defaults:            settings every command starts from
 *     format: webp
 *   presets:             named settings, applied with --preset a,b
 *     mobile-dark: { viewport: 390x844m, dpr: 3, theme: dark }
 *   browser:             how to reach Chrome
 *     port: 9222
 *
 * The interactive screen keeps its last session in tui-state.yaml next to it. Nothing else
 * reads that file, so `shot` and `run` never depend on what was done interactively.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";
import {
  type CaptureSettings,
  DEFAULT_SETTINGS,
  type SettingsPatch,
  type Warn,
  mergeSettings,
  normalizeSettings,
  toYamlSettings,
} from "./settings.js";
import { warnOnce } from "./warn.js";

export interface BrowserConfig {
  port?: number;
  chrome?: string;
  profile?: string;
}

export interface Config {
  defaults?: SettingsPatch;
  presets?: Record<string, SettingsPatch>;
  browser?: BrowserConfig;
}

export const HOME = process.env.PAGESTILL_HOME ?? join(homedir(), ".pagestill");
export const CONFIG_PATH = join(HOME, "config.yaml");
export const TUI_STATE_PATH = join(HOME, "tui-state.yaml");

function readYaml(path: string): Record<string, unknown> | undefined {
  try {
    const v = YAML.parse(readFileSync(path, "utf8")) as unknown;
    if (v == null) return {};
    if (typeof v !== "object" || Array.isArray(v)) throw new Error("expected a mapping");
    return v as Record<string, unknown>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Cannot read ${path}: ${(e as Error).message}`);
  }
}

function writeYaml(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, YAML.stringify(value));
}

export function loadConfig(path = CONFIG_PATH, warn: Warn = warnOnce): Config {
  const raw = readYaml(path) ?? {};
  const where = path.replace(homedir(), "~");
  const config: Config = {};
  if (raw.defaults !== undefined) config.defaults = normalizeSettings(raw.defaults, `${where} defaults`, warn);
  if (raw.presets !== undefined) {
    if (!raw.presets || typeof raw.presets !== "object") throw new Error(`${where}: presets must be a mapping`);
    config.presets = {};
    for (const [name, p] of Object.entries(raw.presets as Record<string, unknown>)) {
      config.presets[name] = normalizeSettings(p, `${where} preset "${name}"`, warn);
    }
  }
  if (raw.browser && typeof raw.browser === "object") {
    const b = raw.browser as Record<string, unknown>;
    config.browser = {
      port: b.port === undefined ? undefined : Number(b.port),
      chrome: (b.chrome ?? b.chromePath) as string | undefined,
      profile: (b.profile ?? b.profileDir) as string | undefined,
    };
    if (b.chromePath !== undefined || b.profileDir !== undefined) {
      warn(`${where}: browser.chromePath/profileDir are now browser.chrome/profile (old names work until v0.5)`);
    }
  }
  for (const k of Object.keys(raw)) {
    if (!["defaults", "presets", "browser", "settings"].includes(k)) warn(`${where}: unknown key "${k}" ignored`);
  }
  return config;
}

/** Write config.yaml (used when saving presets). Drops the pre-0.4 `settings:` key, now tui-state. */
export function saveConfig(config: Config, path = CONFIG_PATH): void {
  const out: Record<string, unknown> = {};
  if (config.defaults && Object.keys(config.defaults).length) out.defaults = toYamlSettings(config.defaults);
  if (config.presets && Object.keys(config.presets).length) {
    out.presets = Object.fromEntries(Object.entries(config.presets).map(([k, v]) => [k, toYamlSettings(v)]));
  }
  if (config.browser && Object.values(config.browser).some((v) => v !== undefined)) out.browser = config.browser;
  writeYaml(path, out);
}

/** "a,b" / ["a", "b"] → ["a", "b"] */
export function presetNames(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : value.split(",")).map((s) => s.trim()).filter(Boolean);
}

export function presetPatches(config: Config, names: string[]): SettingsPatch[] {
  return names.map((name) => {
    const p = config.presets?.[name];
    if (!p) {
      const known = Object.keys(config.presets ?? {});
      throw new Error(`Unknown preset "${name}". ${known.length ? `Known: ${known.join(", ")}` : `No presets in ${CONFIG_PATH} yet.`}`);
    }
    return p;
  });
}

/**
 * The one resolution order every command uses:
 *   built-in defaults → config defaults → presets → ...layers (list, page, matrix, flags)
 */
export function resolveSettings(config: Config, presets: string[], ...layers: (SettingsPatch | undefined)[]): CaptureSettings {
  return mergeSettings(DEFAULT_SETTINGS, config.defaults, ...presetPatches(config, presets), ...layers);
}

/** Settings the interactive screen restores (only it reads this). */
export function loadTuiState(warn: Warn = warnOnce): SettingsPatch {
  const state = readYaml(TUI_STATE_PATH);
  if (state) return normalizeSettings(state.settings, "tui-state.yaml", () => {});
  // Before 0.4 the last session lived in config.yaml `settings:`; take it over once.
  const legacy = readYaml(CONFIG_PATH)?.settings;
  return legacy ? normalizeSettings(legacy, "config.yaml settings (last session)", warn) : {};
}

export function saveTuiState(settings: SettingsPatch): void {
  writeYaml(TUI_STATE_PATH, { settings: toYamlSettings(settings) });
  // finish the migration from config.yaml `settings:`
  const raw = existsSync(CONFIG_PATH) ? readYaml(CONFIG_PATH) : undefined;
  if (raw && "settings" in raw) {
    delete raw.settings;
    writeYaml(CONFIG_PATH, raw);
  }
}
