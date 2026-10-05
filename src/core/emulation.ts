import type { CDPSession, Page } from "puppeteer-core";
import type { CaptureSettings } from "./settings.js";

type EmulationKeys = "viewport" | "dpr" | "theme" | "reducedMotion";
export type EmulationSettings = Pick<CaptureSettings, EmulationKeys>;

export function emulationKey(s: EmulationSettings): string {
  return JSON.stringify([s.viewport, s.dpr, s.theme, s.reducedMotion]);
}

export function isPassthrough(s: EmulationSettings): boolean {
  return s.viewport === "as-is" && s.dpr === "as-is" && s.theme === "as-is" && !s.reducedMotion;
}

/**
 * Apply viewport/DPR/media emulation to the page through `cdp`. Overrides are owned by that
 * session, so Chrome drops them by itself if pagestill exits or crashes.
 * Width/height 0 and deviceScaleFactor 0 mean "keep the real value", which lets DPR be
 * overridden while the viewport follows the actual window.
 */
export async function applyEmulation(cdp: CDPSession, s: EmulationSettings): Promise<void> {
  const vp = s.viewport === "as-is" ? undefined : s.viewport;
  if (vp || s.dpr !== "as-is") {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: vp?.width ?? 0,
      height: vp?.height ?? 0,
      deviceScaleFactor: s.dpr === "as-is" ? 0 : s.dpr,
      mobile: vp?.mobile ?? false,
    });
  } else {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  }
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: !!vp?.mobile });
  const features = [];
  if (s.theme !== "as-is") features.push({ name: "prefers-color-scheme", value: s.theme });
  if (s.reducedMotion) features.push({ name: "prefers-reduced-motion", value: "reduce" });
  await cdp.send("Emulation.setEmulatedMedia", { features });
}

export async function clearEmulation(cdp: CDPSession): Promise<void> {
  await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
  await cdp.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
}

/** Wait for layout to settle after an emulation change (two frames + a short grace period). */
export async function settle(page: Page, extraMs = 150): Promise<void> {
  await page
    .evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
    .catch(() => {});
  if (extraMs) await new Promise((r) => setTimeout(r, extraMs));
}

const STYLE_ID = "__pagestill-capture-style";

export function captureCss(s: Pick<CaptureSettings, "hideSelectors" | "freezeAnimations" | "hideScrollbars">): string {
  const rules: string[] = [];
  for (const sel of s.hideSelectors.map((x) => x.trim()).filter(Boolean)) {
    rules.push(`${sel}{visibility:hidden!important}`);
  }
  if (s.freezeAnimations) {
    rules.push(
      "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}",
    );
  }
  if (s.hideScrollbars) {
    rules.push("*{scrollbar-width:none!important}", "::-webkit-scrollbar{display:none!important}");
  }
  return rules.join("\n");
}

/**
 * Temporarily adjust the live page for capture (hidden elements, frozen animations,
 * lazy-load scroll). Returns a function that undoes it.
 */
export async function prepareDom(page: Page, s: CaptureSettings): Promise<() => Promise<void>> {
  // A toast from the previous capture must not end up in this one.
  await page.evaluate(() => document.querySelectorAll("[data-pagestill-toast]").forEach((e) => e.remove())).catch(() => {});
  const css = captureCss(s);
  if (css) {
    await page.evaluate(
      (css, id) => {
        const el = document.createElement("style");
        el.id = id;
        el.textContent = css;
        (document.head ?? document.documentElement).appendChild(el);
        if (el.sheet && el.sheet.cssRules.length) return;
        // Inline <style> blocked by CSP: constructed stylesheets aren't subject to it.
        el.remove();
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        (sheet as CSSStyleSheet & { __pagestill?: true }).__pagestill = true;
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      },
      css,
      STYLE_ID,
    );
  }
  if (s.loadLazy) await scrollThrough(page);
  return async () => {
    if (!css) return;
    await page
      .evaluate((id) => {
        document.getElementById(id)?.remove();
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
          (x) => !(x as CSSStyleSheet & { __pagestill?: true }).__pagestill,
        );
      }, STYLE_ID)
      .catch(() => {});
  };
}

/** Scroll to the bottom in viewport-sized steps so lazy content loads, then restore the position. */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const start = { x: scrollX, y: scrollY };
    const deadline = Date.now() + 15_000;
    let y = 0;
    while (y < document.documentElement.scrollHeight && Date.now() < deadline) {
      y += Math.max(200, innerHeight * 0.8);
      scrollTo(0, y);
      await sleep(120);
    }
    await sleep(400);
    scrollTo(start.x, start.y);
    await sleep(100);
  });
}
