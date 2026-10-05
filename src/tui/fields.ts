import { archiverIds } from "../archivers/index.js";
import {
  AREAS,
  type CaptureSettings,
  DPR_PRESETS,
  FORMATS,
  type HtmlOptions,
  OUTPUT_MODES,
  THEMES,
  VIEWPORT_PRESETS,
  WAIT_PRESETS,
  formatDpr,
  formatViewport,
  outputMode,
  parseDpr,
  parseViewport,
  withOutputMode,
} from "../core/settings.js";

type S = CaptureSettings;

export interface Field {
  label: string;
  group: "Capture" | "Image" | "HTML snapshot" | "Files";
  show: (s: S) => string;
  /** Cycle/toggle; dir is +1 (→, space, hotkey) or -1 (←). */
  step?: (s: S, dir: 1 | -1) => S;
  /** Free-form edit via prompt. */
  edit?: { hint: string; initial: (s: S) => string; apply: (s: S, text: string) => S };
  /** Main-screen hotkey that steps the field; Shift+hotkey opens the edit prompt. */
  hotkey?: string;
}

function rotate<T>(list: readonly T[], current: T, dir: 1 | -1): T {
  const key = JSON.stringify(current);
  const i = list.findIndex((v) => JSON.stringify(v) === key);
  const n = list.length;
  // Not in the list (custom value): → goes to the first item, ← to the last.
  if (i === -1) return dir === 1 ? list[0]! : list[n - 1]!;
  return list[(i + dir + n) % n]!;
}

const bool = (get: (s: S) => boolean, set: (s: S, v: boolean) => S) => ({
  show: (s: S) => (get(s) ? "on" : "off"),
  step: (s: S) => set(s, !get(s)),
});

const html = <K extends keyof HtmlOptions>(s: S, k: K, v: HtmlOptions[K]): S => ({
  ...s,
  htmlOptions: { ...s.htmlOptions, [k]: v },
});

const num = (text: string, min: number, max: number) => {
  const n = Number(text.trim());
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Enter a number between ${min} and ${max}`);
  return n;
};

const OUTPUT_LABEL = { both: "image + HTML", image: "image only", html: "HTML only" } as const;

export const FIELDS: Field[] = [
  {
    label: "Output",
    group: "Capture",
    hotkey: "o",
    show: (s) => OUTPUT_LABEL[outputMode(s)],
    step: (s, d) => withOutputMode(s, rotate(OUTPUT_MODES, outputMode(s), d)),
  },
  {
    label: "Viewport",
    group: "Capture",
    hotkey: "v",
    show: (s) => formatViewport(s.viewport),
    step: (s, d) => ({ ...s, viewport: rotate(VIEWPORT_PRESETS, s.viewport, d) }),
    edit: {
      hint: "WIDTHxHEIGHT, add m for mobile (390x844m), or as-is",
      initial: (s) => (s.viewport === "as-is" ? "" : `${s.viewport.width}x${s.viewport.height}${s.viewport.mobile ? "m" : ""}`),
      apply: (s, t) => ({ ...s, viewport: parseViewport(t) }),
    },
  },
  {
    label: "DPR",
    group: "Capture",
    hotkey: "d",
    show: (s) => formatDpr(s.dpr),
    step: (s, d) => ({ ...s, dpr: rotate(DPR_PRESETS, s.dpr, d) }),
    edit: { hint: "e.g. 1.5, or as-is", initial: (s) => String(s.dpr), apply: (s, t) => ({ ...s, dpr: parseDpr(t) }) },
  },
  {
    label: "Theme",
    group: "Capture",
    hotkey: "m",
    show: (s) => s.theme,
    step: (s, d) => ({ ...s, theme: rotate(THEMES, s.theme, d) }),
  },
  {
    label: "Wait",
    group: "Capture",
    hotkey: "w",
    show: (s) => `${s.waitMs}ms`,
    step: (s, d) => ({ ...s, waitMs: rotate(WAIT_PRESETS, s.waitMs, d) }),
    edit: { hint: "milliseconds", initial: (s) => String(s.waitMs), apply: (s, t) => ({ ...s, waitMs: num(t, 0, 600_000) }) },
  },
  {
    label: "Hide",
    group: "Capture",
    hotkey: "x",
    show: (s) => (s.hideSelectors.length ? s.hideSelectors.join(", ") : "none"),
    edit: {
      hint: "comma-separated CSS selectors, e.g. .cookie-banner, #intercom",
      initial: (s) => s.hideSelectors.join(", "),
      apply: (s, t) => ({ ...s, hideSelectors: t.split(",").map((x) => x.trim()).filter(Boolean) }),
    },
  },
  { label: "Lazy-load scroll", group: "Capture", hotkey: "l", ...bool((s) => s.loadLazy, (s, v) => ({ ...s, loadLazy: v })) },
  { label: "Reduced motion", group: "Capture", ...bool((s) => s.reducedMotion, (s, v) => ({ ...s, reducedMotion: v })) },
  { label: "Freeze animations", group: "Capture", ...bool((s) => s.freezeAnimations, (s, v) => ({ ...s, freezeAnimations: v })) },
  { label: "Hide scrollbars", group: "Capture", ...bool((s) => s.hideScrollbars, (s, v) => ({ ...s, hideScrollbars: v })) },
  {
    label: "Area",
    group: "Image",
    hotkey: "a",
    show: (s) => (s.area === "element" ? `element ${s.selector || "(no selector)"}` : s.area === "full" ? "full page" : "viewport"),
    step: (s, d) => ({ ...s, area: rotate(AREAS, s.area, d) }),
    edit: {
      hint: "CSS selector of the element to capture",
      initial: (s) => s.selector,
      apply: (s, t) => ({ ...s, selector: t.trim(), area: t.trim() ? "element" : s.area }),
    },
  },
  {
    label: "Format",
    group: "Image",
    hotkey: "f",
    show: (s) => (s.format === "png" ? "png" : `${s.format} q${s.quality}`),
    step: (s, d) => ({ ...s, format: rotate(FORMATS, s.format, d) }),
  },
  {
    label: "Quality",
    group: "Image",
    show: (s) => String(s.quality),
    step: (s, d) => ({ ...s, quality: Math.min(100, Math.max(10, s.quality + d * 5)) }),
    edit: { hint: "1-100 (jpeg/webp)", initial: (s) => String(s.quality), apply: (s, t) => ({ ...s, quality: num(t, 1, 100) }) },
  },
  {
    label: "Transparent background",
    group: "Image",
    ...bool((s) => s.omitBackground, (s, v) => ({ ...s, omitBackground: v })),
  },
  {
    label: "Engine",
    group: "HTML snapshot",
    show: (s) => s.htmlOptions.archiver,
    step: (s, d) => html(s, "archiver", rotate(archiverIds(), s.htmlOptions.archiver, d)),
  },
  { label: "Keep scripts", group: "HTML snapshot", ...bool((s) => s.htmlOptions.keepScripts, (s, v) => html(s, "keepScripts", v)) },
  {
    label: "Remove hidden elements",
    group: "HTML snapshot",
    ...bool((s) => s.htmlOptions.removeHiddenElements, (s, v) => html(s, "removeHiddenElements", v)),
  },
  {
    label: "Remove unused CSS",
    group: "HTML snapshot",
    ...bool((s) => s.htmlOptions.removeUnusedStyles, (s, v) => html(s, "removeUnusedStyles", v)),
  },
  { label: "Include frames", group: "HTML snapshot", ...bool((s) => s.htmlOptions.includeFrames, (s, v) => html(s, "includeFrames", v)) },
  { label: "Minify HTML", group: "HTML snapshot", ...bool((s) => s.htmlOptions.compressHTML, (s, v) => html(s, "compressHTML", v)) },
  {
    label: "Max resource size",
    group: "HTML snapshot",
    show: (s) => (s.htmlOptions.maxResourceSizeMB ? `${s.htmlOptions.maxResourceSizeMB}MB` : "no limit"),
    edit: {
      hint: "MB, 0 = no limit",
      initial: (s) => String(s.htmlOptions.maxResourceSizeMB),
      apply: (s, t) => html(s, "maxResourceSizeMB", num(t, 0, 1024)),
    },
  },
  {
    label: "Output folder",
    group: "Files",
    show: (s) => s.outDir,
    edit: { hint: "relative to the current directory, or absolute", initial: (s) => s.outDir, apply: (s, t) => ({ ...s, outDir: t.trim() || s.outDir }) },
  },
  {
    label: "Filename",
    group: "Files",
    show: (s) => s.filename,
    edit: {
      hint: "{date} {time} {host} {slug} {title} {w} {h} {dpr}; / makes folders",
      initial: (s) => s.filename,
      apply: (s, t) => ({ ...s, filename: t.trim() || s.filename }),
    },
  },
];

export const HOTKEY_FIELDS = FIELDS.filter((f) => f.hotkey);
