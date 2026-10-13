/**
 * Capture settings: how a page is captured.
 *
 * Every setting is defined once in SETTINGS below. The YAML key, the CLI flag, the label in the
 * interactive screen, the `pagestill help settings` table and the legacy names accepted from
 * older configs are all derived from that entry, so one setting has one name everywhere:
 *
 *   YAML / config:   lazyLoad: true
 *   CLI flag:        --lazy-load
 *   screen label:    Lazy load
 */
import { parseDuration } from "./duration.js";

export type ImageFormat = "png" | "jpeg" | "webp";
export type Theme = "as-is" | "light" | "dark";
export type Area = "viewport" | "full" | "element";

export interface ViewportSize {
  width: number;
  height: number;
  /** Emulate a touch/mobile device (mobile layout, meta viewport honored). */
  mobile?: boolean;
}

/** "as-is" means: don't override, capture the window exactly as the user sees it. */
export type ViewportSetting = "as-is" | ViewportSize;
export type DprSetting = "as-is" | number;

export interface CaptureSettings {
  // Save
  image: boolean;
  html: boolean;
  // Emulate
  viewport: ViewportSetting;
  dpr: DprSetting;
  theme: Theme;
  reducedMotion: boolean;
  // Prepare
  /** ms to wait after emulation and before capturing. */
  delay: number;
  /** CSS selectors hidden (visibility:hidden) in both image and HTML. */
  hide: string[];
  /** Scroll through the page first so lazy-loaded content appears. */
  lazyLoad: boolean;
  freezeAnimations: boolean;
  hideScrollbars: boolean;
  // Image
  area: Area;
  /** CSS selector captured when area is "element". */
  element: string;
  format: ImageFormat;
  /** 1-100, jpeg/webp only. */
  quality: number;
  /** Transparent background (png/webp). */
  transparent: boolean;
  // HTML snapshot
  htmlEngine: string;
  htmlScripts: boolean;
  htmlRemoveHidden: boolean;
  htmlRemoveUnusedCss: boolean;
  htmlFrames: boolean;
  htmlMinify: boolean;
  /** Rewrite relative hrefs to absolute URLs. Off: it can change how CSS attribute selectors match. */
  htmlAbsoluteLinks: boolean;
  /** Resources above this size are left out. 0 = no limit. */
  htmlMaxResourceMb: number;
  // Files
  /** Workspace folder: shots/, lists/ and runs/ live inside. */
  out: string;
  /** File name template for shots; see core/filename.ts. */
  name: string;
}

export type SettingKey = keyof CaptureSettings;
export type SettingsPatch = Partial<CaptureSettings>;

export const DEFAULT_SETTINGS: CaptureSettings = {
  image: true,
  html: true,
  viewport: "as-is",
  dpr: "as-is",
  theme: "as-is",
  reducedMotion: false,
  delay: 0,
  hide: [],
  lazyLoad: false,
  freezeAnimations: true,
  hideScrollbars: true,
  area: "full",
  element: "",
  format: "png",
  quality: 90,
  transparent: false,
  htmlEngine: "singlefile",
  htmlScripts: false,
  htmlRemoveHidden: false,
  htmlRemoveUnusedCss: true,
  htmlFrames: true,
  htmlMinify: true,
  htmlAbsoluteLinks: false,
  htmlMaxResourceMb: 10,
  out: "pagestill-out",
  name: "{date}-{time}_{host}_{slug}",
};

// ---------------------------------------------------------------------------------------------
// Value helpers

export const VIEWPORT_PRESETS: ViewportSetting[] = [
  "as-is",
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024, mobile: true },
  { width: 390, height: 844, mobile: true },
];
export const DPR_PRESETS: DprSetting[] = ["as-is", 1, 2, 3];
export const FORMATS: ImageFormat[] = ["png", "jpeg", "webp"];
export const AREAS: Area[] = ["viewport", "full", "element"];
export const THEMES: Theme[] = ["as-is", "light", "dark"];
export const DELAY_PRESETS = [0, 500, 1000, 2000, 5000];
export type SaveMode = "both" | "image" | "html";
export const SAVE_MODES: SaveMode[] = ["both", "image", "html"];

export function saveMode(s: Pick<CaptureSettings, "image" | "html">): SaveMode {
  if (s.image && s.html) return "both";
  return s.image ? "image" : "html";
}

export function withSaveMode(s: CaptureSettings, mode: SaveMode): CaptureSettings {
  return { ...s, image: mode !== "html", html: mode !== "image" };
}

/** Next item after `current` in `list` (wrapping), compared structurally. */
export function cycle<T>(list: readonly T[], current: T): T {
  const key = JSON.stringify(current);
  const i = list.findIndex((v) => JSON.stringify(v) === key);
  return list[(i + 1) % list.length]!;
}

export function formatViewport(v: ViewportSetting): string {
  if (v === "as-is") return "as-is";
  return `${v.width}×${v.height}${v.mobile ? " mobile" : ""}`;
}

/** Compact form used in YAML, flags and run folder names: 1440x900, 390x844m. */
export function viewportId(v: ViewportSetting): string {
  return v === "as-is" ? "as-is" : `${v.width}x${v.height}${v.mobile ? "m" : ""}`;
}

export function parseViewport(text: string): ViewportSetting {
  const t = text.trim().toLowerCase();
  if (t === "" || t === "as-is" || t === "asis") return "as-is";
  const m = /^(\d+)\s*[x×*]\s*(\d+)\s*(m|mobile)?$/.exec(t);
  if (!m) throw new Error(`Invalid viewport "${text}". Use WIDTHxHEIGHT, e.g. 1440x900 or 390x844m (mobile)`);
  return { width: Number(m[1]), height: Number(m[2]), ...(m[3] ? { mobile: true } : {}) };
}

export function parseDpr(text: string): DprSetting {
  const t = text.trim().toLowerCase();
  if (t === "" || t === "as-is" || t === "asis") return "as-is";
  const n = Number(t.replace(/x$/, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 8) throw new Error(`Invalid DPR "${text}" (use e.g. 2, 1.5 or as-is)`);
  return n;
}

export function formatDpr(d: DprSetting): string {
  return d === "as-is" ? "as-is" : `${d}x`;
}

// ---------------------------------------------------------------------------------------------
// The registry

export type SettingGroup = "Save" | "Emulate" | "Prepare" | "Image" | "HTML snapshot" | "Files";
export const SETTING_GROUPS: SettingGroup[] = ["Save", "Emulate", "Prepare", "Image", "HTML snapshot", "Files"];

export interface SettingDef<K extends SettingKey = SettingKey> {
  key: K;
  group: SettingGroup;
  /** Label in the interactive screen and in `help settings`. */
  label: string;
  /** Value placeholder for the flag, e.g. "WxH[m]|as-is". Absent for booleans. */
  arg?: string;
  description: string;
  /** Accept a value from YAML or a flag (string, number, boolean, list or object). */
  normalize: (raw: unknown) => CaptureSettings[K];
  /** Short display form. */
  show: (v: CaptureSettings[K]) => string;
  /** Values the interactive screen cycles through. */
  cycle?: readonly CaptureSettings[K][];
  /** Main-screen key that cycles the value (lowercase). */
  key1?: string;
  /** Main-screen key that types a value (uppercase); implies the setting accepts typed input. */
  keyType?: string;
  /** Hint shown when typing a value. */
  typeHint?: string;
  /** Show the flag in the short help of shot/run/the root command. */
  common?: boolean;
  /** Old YAML keys that still map to this setting (warned). */
  legacy?: string[];
}

const bool = (raw: unknown): boolean => {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "on" || raw === "yes" || raw === 1) return true;
  if (raw === "false" || raw === "off" || raw === "no" || raw === 0) return false;
  throw new Error(`expected true or false, got ${JSON.stringify(raw)}`);
};
const num = (min: number, max: number) => (raw: unknown): number => {
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`expected a number from ${min} to ${max}, got ${JSON.stringify(raw)}`);
  return n;
};
const oneOf = <T extends string>(choices: readonly T[]) => (raw: unknown): T => {
  const v = String(raw).trim().toLowerCase() as T;
  if (!choices.includes(v)) throw new Error(`expected one of ${choices.join(", ")}, got ${JSON.stringify(raw)}`);
  return v;
};
const str = (raw: unknown): string => {
  if (typeof raw !== "string") throw new Error(`expected text, got ${JSON.stringify(raw)}`);
  return raw;
};
const onOff = (v: boolean) => (v ? "on" : "off");

const viewport = (raw: unknown): ViewportSetting => {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return { width: num(1, 100_000)(o.width), height: num(1, 100_000)(o.height), ...(o.mobile ? { mobile: true } : {}) };
  }
  return parseViewport(String(raw));
};
const dpr = (raw: unknown): DprSetting => (typeof raw === "number" ? parseDpr(String(raw)) : parseDpr(String(raw)));
const selectors = (raw: unknown): string[] => {
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  return list.map((x) => String(x).trim()).filter(Boolean);
};

export const SETTINGS: SettingDef[] = [
  // Save
  def({ key: "image", group: "Save", label: "Image", description: "save the screenshot", normalize: bool, show: onOff, common: true }),
  def({ key: "html", group: "Save", label: "HTML", description: "save the single-file HTML snapshot", normalize: bool, show: onOff, common: true }),
  // Emulate
  def({
    key: "viewport",
    group: "Emulate",
    label: "Viewport",
    arg: "WxH[m]|as-is",
    description: "emulated viewport, e.g. 1440x900 or 390x844m (m = mobile)",
    normalize: viewport,
    show: formatViewport,
    cycle: VIEWPORT_PRESETS,
    key1: "v",
    keyType: "V",
    typeHint: "WIDTHxHEIGHT, add m for mobile (390x844m), or as-is",
    common: true,
  }),
  def({
    key: "dpr",
    group: "Emulate",
    label: "DPR",
    arg: "n|as-is",
    description: "device pixel ratio, e.g. 2",
    normalize: dpr,
    show: formatDpr,
    cycle: DPR_PRESETS,
    key1: "d",
    keyType: "D",
    typeHint: "e.g. 2 or 1.5, or as-is",
    common: true,
  }),
  def({
    key: "theme",
    group: "Emulate",
    label: "Theme",
    arg: "light|dark|as-is",
    description: "emulate prefers-color-scheme",
    normalize: oneOf(THEMES),
    show: (v) => v,
    cycle: THEMES,
    key1: "m",
    common: true,
  }),
  def({ key: "reducedMotion", group: "Emulate", label: "Reduced motion", description: "emulate prefers-reduced-motion", normalize: bool, show: onOff }),
  // Prepare
  def({
    key: "delay",
    group: "Prepare",
    label: "Delay",
    arg: "ms",
    description: "wait before capturing, e.g. 500 or 2s",
    normalize: (raw) => parseDuration(raw),
    show: (v) => `${v}ms`,
    cycle: DELAY_PRESETS,
    key1: "w",
    keyType: "W",
    typeHint: "milliseconds, or e.g. 2s",
    legacy: ["waitMs"],
  }),
  def({
    key: "hide",
    group: "Prepare",
    label: "Hide",
    arg: "css...",
    description: "hide matching elements (cookie banners, chat widgets...)",
    normalize: selectors,
    show: (v) => (v.length ? v.join(", ") : "none"),
    key1: "x",
    keyType: "X",
    typeHint: "comma-separated CSS selectors, e.g. .cookie-banner, #intercom",
    legacy: ["hideSelectors"],
  }),
  def({
    key: "lazyLoad",
    group: "Prepare",
    label: "Lazy load",
    description: "scroll through the page first so lazy content loads",
    normalize: bool,
    show: onOff,
    cycle: [false, true],
    key1: "l",
    legacy: ["loadLazy"],
  }),
  def({ key: "freezeAnimations", group: "Prepare", label: "Freeze animations", description: "pause CSS animations and transitions", normalize: bool, show: onOff }),
  def({ key: "hideScrollbars", group: "Prepare", label: "Hide scrollbars", description: "hide scrollbars", normalize: bool, show: onOff }),
  // Image
  def({
    key: "area",
    group: "Image",
    label: "Area",
    arg: "viewport|full|element",
    description: "what the image covers",
    normalize: oneOf(AREAS),
    show: (v) => (v === "full" ? "full page" : v),
    cycle: AREAS,
    key1: "a",
    common: true,
  }),
  def({
    key: "element",
    group: "Image",
    label: "Element",
    arg: "css",
    description: "element to capture (sets --area element)",
    normalize: str,
    show: (v) => v || "none",
    keyType: "A",
    typeHint: "CSS selector of the element to capture",
    common: true,
    legacy: ["selector"],
  }),
  def({
    key: "format",
    group: "Image",
    label: "Format",
    arg: "png|jpeg|webp",
    description: "image format",
    normalize: oneOf(FORMATS),
    show: (v) => v,
    cycle: FORMATS,
    key1: "f",
    common: true,
  }),
  def({
    key: "quality",
    group: "Image",
    label: "Quality",
    arg: "1-100",
    description: "jpeg/webp quality",
    normalize: num(1, 100),
    show: String,
    keyType: "F",
    typeHint: "1-100 (jpeg and webp)",
  }),
  def({
    key: "transparent",
    group: "Image",
    label: "Transparent",
    description: "transparent background (png, webp)",
    normalize: bool,
    show: onOff,
    legacy: ["omitBackground"],
  }),
  // HTML snapshot
  def({ key: "htmlEngine", group: "HTML snapshot", label: "Engine", arg: "id", description: "snapshot engine", normalize: str, show: (v) => v, legacy: ["htmlOptions.archiver"] }),
  def({ key: "htmlScripts", group: "HTML snapshot", label: "Keep scripts", description: "keep <script>s (replaying JS usually breaks a frozen page)", normalize: bool, show: onOff, legacy: ["htmlOptions.keepScripts"] }),
  def({ key: "htmlRemoveHidden", group: "HTML snapshot", label: "Remove hidden", description: "drop elements that aren't displayed (smaller, but closed menus are lost)", normalize: bool, show: onOff, legacy: ["htmlOptions.removeHiddenElements"] }),
  def({ key: "htmlRemoveUnusedCss", group: "HTML snapshot", label: "Remove unused CSS", description: "drop CSS rules that match nothing", normalize: bool, show: onOff, legacy: ["htmlOptions.removeUnusedStyles"] }),
  def({ key: "htmlFrames", group: "HTML snapshot", label: "Frames", description: "include iframes, cross-origin ones too", normalize: bool, show: onOff, legacy: ["htmlOptions.includeFrames"] }),
  def({ key: "htmlMinify", group: "HTML snapshot", label: "Minify", description: "minify the HTML", normalize: bool, show: onOff, legacy: ["htmlOptions.compressHTML"] }),
  def({ key: "htmlAbsoluteLinks", group: "HTML snapshot", label: "Absolute links", description: "rewrite relative links to absolute URLs (can change styling)", normalize: bool, show: onOff, legacy: ["htmlOptions.absoluteLinks"] }),
  def({
    key: "htmlMaxResourceMb",
    group: "HTML snapshot",
    label: "Max resource size",
    arg: "n",
    description: "leave out resources larger than n MB (0 = no limit)",
    normalize: num(0, 4096),
    show: (v) => (v ? `${v}MB` : "no limit"),
    legacy: ["htmlOptions.maxResourceSizeMB"],
  }),
  // Files
  def({
    key: "out",
    group: "Files",
    label: "Workspace folder",
    arg: "dir",
    description: "workspace folder; shots/, lists/ and runs/ go inside",
    normalize: str,
    show: (v) => v,
    common: true,
    legacy: ["outDir"],
  }),
  def({
    key: "name",
    group: "Files",
    label: "File name",
    arg: "template",
    description: "shot file name: {date} {time} {host} {slug} {title} {w} {h} {dpr}; / makes folders",
    normalize: str,
    show: (v) => v,
    legacy: ["filename"],
  }),
];

function def<K extends SettingKey>(d: SettingDef<K>): SettingDef {
  return d as unknown as SettingDef;
}

export const SETTING_BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));

/** "lazyLoad" → "lazy-load" */
export function flagName(key: SettingKey): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// ---------------------------------------------------------------------------------------------
// Reading settings from YAML (config defaults, presets, page lists, TUI state)

const LEGACY = new Map<string, SettingKey>();
for (const d of SETTINGS) for (const l of d.legacy ?? []) LEGACY.set(l, d.key);

export type Warn = (message: string) => void;

/**
 * Validate a settings object from YAML. Old key names are accepted with a warning,
 * unknown keys are reported and ignored, invalid values throw with the location.
 */
export function normalizeSettings(raw: unknown, where: string, warn: Warn): SettingsPatch {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${where}: settings must be a mapping`);
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === "htmlOptions" && v && typeof v === "object") {
      for (const [hk, hv] of Object.entries(v as Record<string, unknown>)) flat[`htmlOptions.${hk}`] = hv;
    } else flat[k] = v;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    let key = k as SettingKey;
    if (!SETTING_BY_KEY.has(key)) {
      const renamed = LEGACY.get(k);
      if (!renamed) {
        warn(`${where}: unknown setting "${k}" ignored (see: pagestill help settings)`);
        continue;
      }
      warn(`${where}: "${k}" is now "${renamed}" (the old name works until v0.5)`);
      key = renamed;
    }
    try {
      out[key] = SETTING_BY_KEY.get(key)!.normalize(v);
    } catch (e) {
      throw new Error(`${where}: ${key}: ${(e as Error).message}`);
    }
  }
  return out as SettingsPatch;
}

/** Always returns a fresh object, so callers may mutate the result. */
export function mergeSettings(base: CaptureSettings, ...patches: (SettingsPatch | undefined)[]): CaptureSettings {
  let s: CaptureSettings = { ...base, hide: [...base.hide] };
  for (const p of patches) {
    if (!p) continue;
    s = { ...s, ...p, hide: [...(p.hide ?? s.hide)] };
    // Choosing an element implies capturing that element.
    if (p.element && p.area === undefined) s.area = "element";
  }
  return s;
}

/** Only the keys that differ from `base` (default: built-in defaults); keeps YAML small. */
export function diffSettings(s: CaptureSettings, base: CaptureSettings = DEFAULT_SETTINGS): SettingsPatch {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(s) as SettingKey[]) {
    if (JSON.stringify(s[key]) !== JSON.stringify(base[key])) out[key] = s[key];
  }
  return out as SettingsPatch;
}

/** YAML-friendly form: viewports as "1440x900" strings. */
export function toYamlSettings(p: SettingsPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p };
  if (p.viewport !== undefined) out.viewport = viewportId(p.viewport);
  return out;
}
