import type { Page } from "puppeteer-core";

/** How to wait after opening a page (page list `load:`). */
export interface LoadSpec {
  /** Load milestone to wait for. networkidle = no requests for 500ms. */
  until?: "load" | "domcontentloaded" | "networkidle";
  /** CSS selector that must be visible before capturing. */
  waitFor?: string;
  /** Navigation timeout (ms). On timeout the page is used as is if it got past DOMContentLoaded. */
  timeout?: number;
}

/** One preparation step run after loading and before capturing (page list `steps:`). */
export type Step =
  | { click: string }
  | { type: { into: string; text: string } }
  | { press: string }
  | { hover: string }
  | { wait: number }
  | { waitFor: string }
  | { scroll: "top" | "bottom" | string }
  | { eval: string };

export interface NavigationResult {
  finalUrl: string;
  /** HTTP status of the main document, when known. */
  status?: number;
  warnings: string[];
}

const UNTIL = { load: "load", domcontentloaded: "domcontentloaded", networkidle: "networkidle0" } as const;

/** Navigate and wait like a person would before looking: load, settle, wait for the selector. */
export async function gotoAndWait(page: Page, url: string, load: LoadSpec = {}): Promise<NavigationResult> {
  const warnings: string[] = [];
  const timeout = load.timeout ?? 30_000;
  let status: number | undefined;
  try {
    const res = await page.goto(url, { waitUntil: UNTIL[load.until ?? "networkidle"], timeout });
    status = res?.status();
  } catch (e) {
    if (!/timeout/i.test(String(e))) throw e;
    const ready = await page.evaluate(() => document.readyState).catch(() => "loading");
    if (ready === "loading") throw e;
    warnings.push(`did not reach ${load.until ?? "networkidle"} within ${timeout}ms; captured as is`);
  }
  if (load.waitFor) {
    await page
      .waitForSelector(load.waitFor, { visible: true, timeout: Math.min(timeout, 15_000) })
      .catch(() => warnings.push(`"${load.waitFor}" did not appear`));
  }
  return { finalUrl: page.url(), status, warnings };
}

export async function runSteps(page: Page, steps: Step[]): Promise<void> {
  for (const st of steps) {
    if ("click" in st) await page.locator(st.click).click();
    else if ("type" in st) await page.locator(st.type.into).fill(st.type.text);
    else if ("press" in st) await page.keyboard.press(st.press as Parameters<Page["keyboard"]["press"]>[0]);
    else if ("hover" in st) await page.locator(st.hover).hover();
    else if ("wait" in st) await new Promise((r) => setTimeout(r, st.wait));
    else if ("waitFor" in st) await page.waitForSelector(st.waitFor, { visible: true, timeout: 15_000 });
    else if ("scroll" in st) {
      await page.evaluate((to) => {
        if (to === "top") scrollTo(0, 0);
        else if (to === "bottom") scrollTo(0, document.documentElement.scrollHeight);
        else document.querySelector(to)?.scrollIntoView({ block: "start" });
      }, st.scroll);
    } else if ("eval" in st) await page.evaluate(st.eval);
    else throw new Error(`Unknown step: ${JSON.stringify(st)}`);
    // let the UI react before the next step
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Wait until the network has been quiet for a moment (best effort). */
export async function quiet(page: Page, idleMs = 500, timeout = 10_000): Promise<void> {
  await page.waitForNetworkIdle({ idleTime: idleMs, timeout }).catch(() => {});
}
