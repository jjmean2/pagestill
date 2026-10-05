import type { Page } from "puppeteer-core";

export interface WaitSpec {
  /** Load milestone to wait for. networkidle = no more than 0 requests for 500ms. */
  until?: "load" | "domcontentloaded" | "networkidle";
  /** CSS selector that must appear before capturing. */
  selector?: string;
  /** Extra delay (ms) after everything else. */
  delay?: number;
  /** Navigation timeout (ms). On timeout the page is used as-is if it got past DOMContentLoaded. */
  timeout?: number;
}

export type Action =
  | { click: string }
  | { type: { selector: string; text: string } }
  | { press: string }
  | { hover: string }
  | { wait: number }
  | { waitFor: string }
  | { scroll: "top" | "bottom" | string }
  | { eval: string };

export interface NavigationResult {
  finalUrl: string;
  status?: number;
  warnings: string[];
}

const UNTIL = { load: "load", domcontentloaded: "domcontentloaded", networkidle: "networkidle0" } as const;

/** Navigate and wait like a person would before looking: load, settle, selector, delay. */
export async function gotoAndWait(page: Page, url: string, wait: WaitSpec = {}): Promise<NavigationResult> {
  const warnings: string[] = [];
  const timeout = wait.timeout ?? 30_000;
  let status: number | undefined;
  try {
    const res = await page.goto(url, { waitUntil: UNTIL[wait.until ?? "networkidle"], timeout });
    status = res?.status();
  } catch (e) {
    if (!/timeout/i.test(String(e))) throw e;
    const ready = await page.evaluate(() => document.readyState).catch(() => "loading");
    if (ready === "loading") throw e;
    warnings.push(`did not reach ${wait.until ?? "networkidle"} within ${timeout}ms; captured as is`);
  }
  await afterLoad(page, wait, warnings);
  return { finalUrl: page.url(), status, warnings };
}

/** The part of waiting that doesn't involve navigation (also used after actions/login). */
export async function afterLoad(page: Page, wait: WaitSpec, warnings: string[] = []): Promise<string[]> {
  if (wait.selector) {
    await page
      .waitForSelector(wait.selector, { visible: true, timeout: Math.min(wait.timeout ?? 30_000, 15_000) })
      .catch(() => warnings.push(`selector "${wait.selector}" did not appear`));
  }
  if (wait.delay) await new Promise((r) => setTimeout(r, wait.delay));
  return warnings;
}

export async function runActions(page: Page, actions: Action[]): Promise<void> {
  for (const a of actions) {
    if ("click" in a) await page.locator(a.click).click();
    else if ("type" in a) await page.locator(a.type.selector).fill(a.type.text);
    else if ("press" in a) await page.keyboard.press(a.press as Parameters<Page["keyboard"]["press"]>[0]);
    else if ("hover" in a) await page.locator(a.hover).hover();
    else if ("wait" in a) await new Promise((r) => setTimeout(r, a.wait));
    else if ("waitFor" in a) await page.waitForSelector(a.waitFor, { visible: true, timeout: 15_000 });
    else if ("scroll" in a) {
      await page.evaluate((to) => {
        if (to === "top") scrollTo(0, 0);
        else if (to === "bottom") scrollTo(0, document.documentElement.scrollHeight);
        else document.querySelector(to)?.scrollIntoView({ block: "start" });
      }, a.scroll);
    } else if ("eval" in a) await page.evaluate(a.eval);
    else throw new Error(`Unknown action: ${JSON.stringify(a)}`);
    // let the UI react before the next step
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Wait until the network has been quiet for a moment (best effort). */
export async function quiet(page: Page, idleMs = 500, timeout = 10_000): Promise<void> {
  await page.waitForNetworkIdle({ idleTime: idleMs, timeout }).catch(() => {});
}
