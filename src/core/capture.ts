import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Page } from "puppeteer-core";
import { getArchiver, htmlOptionsOf } from "../archivers/index.js";
import { applyEmulation, clearEmulation, emulationKey, isPassthrough, prepareDom, settle } from "./emulation.js";
import { renderFilename, uniqueBase } from "./filename.js";
import { captureImage } from "./screenshot.js";
import type { BrowserSession } from "./session.js";
import type { CaptureSettings } from "./settings.js";
import { workspace } from "./workspace.js";

export interface CapturedFile {
  kind: "image" | "html";
  path: string;
  bytes: number;
  width?: number;
  height?: number;
}

export interface CaptureResult {
  url: string;
  title: string;
  files: CapturedFile[];
  warnings: string[];
  durationMs: number;
}

export interface CaptureOptions {
  /**
   * Keep emulation applied after capture (TUI "what you see is what you get" mode).
   * When false, overrides are removed afterwards if this call applied them.
   */
  keepEmulation?: boolean;
  /** Emulation key already applied on this page, to skip re-applying + settling. */
  appliedEmulation?: string;
  /** Folder to write into (default: <out>/shots). */
  dir?: string;
  /** File name template relative to `dir`, without extension (default: the `name` setting). */
  name?: string;
  log?: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * Capture the page as it is now. Order matters: the HTML snapshot is taken first because it
 * doesn't disturb the page, while a full-page screenshot temporarily grows the viewport
 * (which can re-layout `100vh` elements and fire resize handlers).
 */
export async function capture(
  session: BrowserSession,
  page: Page,
  s: CaptureSettings,
  opts: CaptureOptions = {},
): Promise<CaptureResult> {
  if (!s.image && !s.html) throw new Error("Nothing to save: image and HTML are both off");
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const cdp = await session.cdp(page);
  const warnings: string[] = [];

  const key = emulationKey(s);
  const emulate = !isPassthrough(s);
  if (opts.appliedEmulation !== key) {
    await applyEmulation(cdp, s);
    if (emulate) await settle(page, 300);
  }
  if (s.delay > 0) {
    log(`Waiting ${s.delay}ms`);
    await new Promise((r) => setTimeout(r, s.delay));
  }

  const url = page.url();
  const title = await page.title().catch(() => "");
  const date = new Date();
  const outDir = resolve(opts.dir ?? workspace(s.out).shots);
  const files: CapturedFile[] = [];
  const restoreDom = await prepareDom(page, s);
  try {
    let html: string | undefined;
    if (s.html) {
      log("Capturing HTML");
      const archiver = await getArchiver(s.htmlEngine);
      const res = await archiver.archive(page, htmlOptionsOf(s), { log, signal: opts.signal });
      html = res.html;
      warnings.push(...res.warnings);
    }
    let image: Awaited<ReturnType<typeof captureImage>> | undefined;
    if (s.image) {
      log("Capturing image");
      image = await captureImage(cdp, page, s);
    }

    const dpr = await page.evaluate(() => devicePixelRatio).catch(() => undefined);
    const rel = renderFilename(opts.name ?? s.name, {
      url,
      title,
      date,
      width: image ? Math.round(image.width / (dpr ?? 1)) : undefined,
      height: image ? Math.round(image.height / (dpr ?? 1)) : undefined,
      dpr,
    });
    const target = join(outDir, rel);
    const dir = dirname(target);
    await mkdir(dir, { recursive: true });
    const imageExt = `.${s.format === "jpeg" ? "jpg" : s.format}`;
    const base = uniqueBase(dir, target.slice(dir.length + 1), [imageExt, ".html"]);
    if (html !== undefined) {
      const path = join(dir, `${base}.html`);
      await writeFile(path, html);
      files.push({ kind: "html", path, bytes: Buffer.byteLength(html) });
    }
    if (image) {
      const path = join(dir, base + imageExt);
      await writeFile(path, image.buffer);
      files.push({ kind: "image", path, bytes: image.buffer.length, width: image.width, height: image.height });
    }
  } finally {
    await restoreDom();
    if (!opts.keepEmulation && emulate && opts.appliedEmulation !== key) await clearEmulation(cdp);
  }
  await toast(page, files.length ? `pagestill ✓ saved ${files.map((f) => (f.kind === "image" ? s.format.toUpperCase() : "HTML")).join(" + ")}` : "");
  return { url, title, files, warnings, durationMs: Date.now() - started };
}

/** Brief confirmation in the page itself, shown only after capture so it never ends up in the output. */
async function toast(page: Page, text: string) {
  if (!text) return;
  await page
    .evaluate((text) => {
      const host = document.createElement("div");
      host.setAttribute("data-pagestill-toast", "");
      const root = host.attachShadow({ mode: "closed" });
      const box = document.createElement("div");
      box.textContent = text;
      box.style.cssText =
        "position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:8px 14px;border-radius:8px;" +
        "background:#111c;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px #0004;" +
        "pointer-events:none;transition:opacity .3s";
      root.appendChild(box);
      document.documentElement.appendChild(host);
      setTimeout(() => (box.style.opacity = "0"), 1400);
      setTimeout(() => host.remove(), 1800);
    }, text)
    .catch(() => {});
}
