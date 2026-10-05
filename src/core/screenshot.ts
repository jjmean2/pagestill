import type { CDPSession, Page } from "puppeteer-core";
import sharp from "sharp";
import type { CaptureSettings } from "./settings.js";

/** Chrome's compositor tops out around 16k device pixels per side; taller captures are tiled. */
const MAX_TILE_DEVICE_PX = 16_000;

export interface ImageResult {
  buffer: Buffer;
  width: number;
  height: number;
}

interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ImageSettings = Pick<CaptureSettings, "area" | "selector" | "format" | "quality" | "omitBackground">;

export async function captureImage(cdp: CDPSession, page: Page, s: ImageSettings): Promise<ImageResult> {
  const transparent = s.omitBackground && s.format !== "jpeg";
  if (transparent) {
    await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  }
  try {
    if (s.area === "viewport") return await finish(await shoot(cdp, s.format, s.quality), s, true);
    const clip = s.area === "element" ? await elementClip(page, s.selector) : await fullPageClip(cdp);
    const dpr = await page.evaluate(() => devicePixelRatio);
    if (clip.height * dpr <= MAX_TILE_DEVICE_PX) return await finish(await shoot(cdp, s.format, s.quality, clip), s, true);
    return await finish(await stitch(cdp, clip, dpr), s, false);
  } finally {
    if (transparent) await cdp.send("Emulation.setDefaultBackgroundColorOverride").catch(() => {});
  }
}

async function shoot(cdp: CDPSession, format: CaptureSettings["format"], quality: number, clip?: Clip): Promise<Buffer> {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format,
    ...(format !== "png" ? { quality } : {}),
    ...(clip ? { clip: { ...clip, scale: 1 }, captureBeyondViewport: true } : {}),
    fromSurface: true,
  });
  return Buffer.from(data, "base64");
}

async function fullPageClip(cdp: CDPSession): Promise<Clip> {
  const m = await cdp.send("Page.getLayoutMetrics");
  const size = m.cssContentSize;
  return { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height) };
}

async function elementClip(page: Page, selector: string): Promise<Clip> {
  if (!selector.trim()) throw new Error('Area is "element" but no selector is set');
  const rect = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  }, selector);
  if (!rect || rect.width === 0 || rect.height === 0) throw new Error(`No visible element matches "${selector}"`);
  return {
    x: Math.floor(rect.x),
    y: Math.floor(rect.y),
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
  };
}

async function stitch(cdp: CDPSession, clip: Clip, dpr: number): Promise<Buffer> {
  const tileCss = Math.floor(MAX_TILE_DEVICE_PX / dpr);
  const tiles: { input: Buffer; top: number; left: number }[] = [];
  let width = 0;
  let top = 0;
  for (let y = 0; y < clip.height; y += tileCss) {
    const h = Math.min(tileCss, clip.height - y);
    const buf = await shoot(cdp, "png", 100, { ...clip, y: clip.y + y, height: h });
    const meta = await sharp(buf).metadata();
    width = Math.max(width, meta.width ?? 0);
    tiles.push({ input: buf, top, left: 0 });
    top += meta.height ?? 0;
  }
  return sharp({ create: { width, height: top, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }, limitInputPixels: false })
    .composite(tiles)
    .png()
    .toBuffer();
}

/** Re-encode stitched PNGs into the requested format and read the final dimensions. */
async function finish(buffer: Buffer, s: ImageSettings, alreadyEncoded: boolean): Promise<ImageResult> {
  let out = buffer;
  if (!alreadyEncoded && s.format !== "png") {
    const img = sharp(buffer, { limitInputPixels: false });
    out = await (s.format === "jpeg" ? img.jpeg({ quality: s.quality }) : img.webp({ quality: s.quality })).toBuffer();
  }
  const meta = await sharp(out, { limitInputPixels: false }).metadata();
  return { buffer: out, width: meta.width ?? 0, height: meta.height ?? 0 };
}
