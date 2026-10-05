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

/** Archiver-agnostic HTML snapshot options. Each archiver maps these to its own engine. */
export interface HtmlOptions {
  /** Engine id from the archiver registry. */
  archiver: string;
  /** Keep <script> elements. Off by default: replaying JS over a frozen DOM usually breaks it. */
  keepScripts: boolean;
  /** Drop elements that are not rendered (display:none etc.) to shrink the file. */
  removeHiddenElements: boolean;
  /** Drop CSS rules that match nothing in the current DOM. */
  removeUnusedStyles: boolean;
  /** Serialize iframe contents (including cross-origin ones when reachable). */
  includeFrames: boolean;
  /** Resources above this size (MB) are left out. 0 = no limit. */
  maxResourceSizeMB: number;
  /** Minify the HTML whitespace. */
  compressHTML: boolean;
}

export interface CaptureSettings {
  image: boolean;
  html: boolean;
  viewport: ViewportSetting;
  dpr: DprSetting;
  theme: Theme;
  reducedMotion: boolean;
  area: Area;
  /** CSS selector used when area is "element". */
  selector: string;
  format: ImageFormat;
  /** 1-100, jpeg/webp only. */
  quality: number;
  /** Transparent background (png/webp). */
  omitBackground: boolean;
  /** Delay (ms) after emulation is applied and before capturing. */
  waitMs: number;
  /** Elements hidden (visibility:hidden) in both image and HTML, e.g. cookie banners. */
  hideSelectors: string[];
  /** Pause CSS animations/transitions and hide the caret. */
  freezeAnimations: boolean;
  hideScrollbars: boolean;
  /** Scroll through the page before capturing so lazy-loaded content appears. */
  loadLazy: boolean;
  htmlOptions: HtmlOptions;
  outDir: string;
  /** See core/filename.ts for variables. */
  filename: string;
}

export const DEFAULT_SETTINGS: CaptureSettings = {
  image: true,
  html: true,
  viewport: "as-is",
  dpr: "as-is",
  theme: "as-is",
  reducedMotion: false,
  area: "full",
  selector: "",
  format: "png",
  quality: 90,
  omitBackground: false,
  waitMs: 0,
  hideSelectors: [],
  freezeAnimations: true,
  hideScrollbars: true,
  loadLazy: false,
  htmlOptions: {
    archiver: "singlefile",
    keepScripts: false,
    removeHiddenElements: false,
    removeUnusedStyles: true,
    includeFrames: true,
    maxResourceSizeMB: 10,
    compressHTML: true,
  },
  outDir: "pagestill-out",
  filename: "{date}-{time}_{host}_{slug}",
};

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
export const WAIT_PRESETS = [0, 500, 1000, 2000, 5000];
export type OutputMode = "both" | "image" | "html";
export const OUTPUT_MODES: OutputMode[] = ["both", "image", "html"];

export function outputMode(s: CaptureSettings): OutputMode {
  if (s.image && s.html) return "both";
  return s.image ? "image" : "html";
}

export function withOutputMode(s: CaptureSettings, mode: OutputMode): CaptureSettings {
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

export function parseViewport(text: string): ViewportSetting {
  const t = text.trim().toLowerCase();
  if (t === "" || t === "as-is" || t === "asis") return "as-is";
  const m = /^(\d+)\s*[x×*]\s*(\d+)\s*(m|mobile)?$/.exec(t);
  if (!m) throw new Error(`Invalid viewport "${text}". Use WIDTHxHEIGHT, e.g. 1440x900 or 390x844m`);
  return { width: Number(m[1]), height: Number(m[2]), ...(m[3] ? { mobile: true } : {}) };
}

export function parseDpr(text: string): DprSetting {
  const t = text.trim().toLowerCase();
  if (t === "" || t === "as-is" || t === "asis") return "as-is";
  const n = Number(t.replace(/x$/, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 8) throw new Error(`Invalid DPR "${text}"`);
  return n;
}

export function formatDpr(d: DprSetting): string {
  return d === "as-is" ? "as-is" : `${d}x`;
}

/** Deep-merge a partial (e.g. a preset or config file) onto settings. */
/** Always returns a fresh object, so callers may mutate the result. */
export function mergeSettings(base: CaptureSettings, patch: Partial<CaptureSettings> | undefined): CaptureSettings {
  return {
    ...base,
    ...patch,
    hideSelectors: [...(patch?.hideSelectors ?? base.hideSelectors)],
    htmlOptions: { ...base.htmlOptions, ...(patch?.htmlOptions ?? {}) },
  };
}
