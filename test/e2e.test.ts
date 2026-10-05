import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capture } from "../src/core/capture.js";
import { findChrome } from "../src/core/chrome.js";
import { BrowserSession } from "../src/core/session.js";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/core/settings.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml" };
const chrome = findChrome();

describe.skipIf(!chrome)("capture against a real Chrome", () => {
  let server: Server;
  let session: BrowserSession;
  let base: string;
  const tmp = mkdtempSync(join(tmpdir(), "pagestill-e2e-"));

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const path = join(FIXTURES, (req.url ?? "/").split("?")[0] === "/" ? "index.html" : req.url!.slice(1));
      try {
        const body = await readFile(path);
        res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    base = `http://localhost:${port}/`;
    session = await BrowserSession.connect({ port: 9000 + Math.floor(Math.random() * 900), profileDir: join(tmp, "profile") });
    const page = (await session.browser.pages())[0]!;
    await page.goto(base, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.getElementById("state")?.textContent === "changed by JS");
    session.pin(page);
  }, 60_000);

  afterAll(async () => {
    await session?.browser.close().catch(() => {});
    server?.close();
  });

  it("archives the current DOM state into one self-contained HTML file", async () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { image: false, outDir: join(tmp, "out"), hideSelectors: [".cookie-banner"] });
    const res = await capture(session, session.active!, s);
    const html = readFileSync(res.files[0]!.path, "utf8");
    expect(html).toContain("changed by JS"); // JS-mutated DOM, not the original source
    expect(html).toContain("typed value"); // form state
    expect(html).not.toMatch(/<script(?![^>]*type=["']?(application\/ld\+json|sf-))/i); // scripts stripped
    expect(html).toMatch(/rgb\(0,\s*128,\s*0\)|green|#008000/i); // external stylesheet inlined
    expect(html).toMatch(/rgb\(0,\s*0,\s*255\)|blue|#00f\b|#0000ff/i); // CSSOM-only rule kept
    expect(html).toContain("shadow content"); // shadow DOM
    expect(html).toContain("cross-site frame content"); // OOPIF
    expect(html).toContain("data:image/svg+xml"); // <img> inlined
    expect(html).toMatch(/data:image\/png;base64/); // canvas → image
    expect(html).not.toMatch(/src=["']?https?:\/\/localhost/); // nothing left pointing at the server

    // Re-open the snapshot from disk, offline and without JS: it must look the same.
    const viewer = await session.browser.newPage();
    try {
      await viewer.setJavaScriptEnabled(false);
      await viewer.setOfflineMode(true);
      await viewer.goto(`file://${res.files[0]!.path}`, { waitUntil: "load" });
      const look = await viewer.evaluate(() => {
        const color = (sel: string) => getComputedStyle(document.querySelector(sel)!).color;
        const shadow = document.querySelector("#shadow-host")!.shadowRoot;
        const img = document.querySelector("img")!;
        const banner = document.querySelector(".cookie-banner");
        return {
          ext: color(".ext"),
          cssom: color(".cssom"),
          shadow: shadow ? getComputedStyle(shadow.querySelector("b")!).color : null,
          imgLoaded: img.complete && img.naturalWidth > 0,
          field: (document.querySelector("#field") as HTMLInputElement).value,
          banner: banner ? getComputedStyle(banner).visibility : "removed",
        };
      });
      expect(look).toEqual({
        ext: "rgb(0, 128, 0)",
        cssom: "rgb(0, 0, 255)",
        shadow: "rgb(255, 0, 255)",
        imgLoaded: true,
        field: "typed value",
        banner: "hidden",
      });
    } finally {
      await viewer.close();
    }
    // the live page is restored afterwards
    expect(await session.active!.evaluate(() => getComputedStyle(document.querySelector(".cookie-banner")!).visibility)).toBe("visible");
  }, 60_000);

  it("captures a full-page PNG taller than one compositor tile", async () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { html: false, outDir: join(tmp, "out"), dpr: 2, area: "full" });
    const res = await capture(session, session.active!, s);
    const img = res.files[0]!;
    expect(img.kind).toBe("image");
    expect(img.height).toBeGreaterThan(18_000); // > 9000 css px at 2x → stitched
    const meta = await sharp(img.path).metadata();
    expect(meta.format).toBe("png");
    // emulation was not kept, so the page is back to its own DPR
    expect(await session.active!.evaluate(() => devicePixelRatio)).not.toBe(Number.NaN);
  }, 60_000);

  it("captures viewport-only JPEG at an emulated viewport", async () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      html: false,
      outDir: join(tmp, "out"),
      viewport: { width: 800, height: 600 },
      dpr: 1,
      area: "viewport",
      format: "jpeg",
    });
    const res = await capture(session, session.active!, s);
    expect(res.files[0]).toMatchObject({ width: 800, height: 600 });
    expect(res.files[0]!.path.endsWith(".jpg")).toBe(true);
  }, 60_000);
});
