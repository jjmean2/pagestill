import type { Page } from "puppeteer-core";
import { gotoAndWait, type WaitSpec } from "../core/navigate.js";
import type { BrowserSession } from "../core/session.js";
import { DEFAULT_EXCLUDES, isLoginRedirect, matchesAnyGlob, normalizeUrl, urlPattern } from "../core/urls.js";
import type { JobFileEntry } from "./job.js";
import type { LoginDecision } from "./runner.js";

export interface CrawlOptions {
  session: BrowserSession;
  start: string;
  /** Link hops from the start page (default 3). */
  maxDepth?: number;
  /** Pages visited at most (default 200). */
  maxPages?: number;
  /** Pages visited (and listed) per URL pattern, e.g. /users/:id (default 1). */
  sample?: number;
  /** Only follow URLs matching one of these globs (pathname + query). */
  include?: string[];
  /** Never follow URLs matching these globs (added to the built-in safety list). */
  exclude?: string[];
  /** Drop the built-in exclusions (logout, delete, files...). */
  noDefaultExcludes?: boolean;
  /** Only follow URLs under this path prefix (default: the whole origin). */
  scope?: string;
  /** Also seed the queue from /sitemap.xml. */
  sitemap?: boolean;
  wait?: WaitSpec;
  concurrency?: number;
  loginPattern?: string;
  onLogin: (info: { url: string; finalUrl: string }) => Promise<LoginDecision>;
  onEvent?: (e: CrawlEvent) => void;
}

export type CrawlEvent =
  | { type: "visit"; url: string; depth: number; visited: number; queued: number }
  | { type: "page"; page: CrawledPage; visited: number; queued: number }
  | { type: "info"; message: string };

export interface CrawledPage {
  url: string;
  finalUrl: string;
  depth: number;
  title: string;
  pattern: string;
  status: "ok" | "failed" | "login" | "redirected";
  links: number;
  error?: string;
}

export interface CrawlResult {
  start: string;
  pages: CrawledPage[];
  /** Every in-scope URL seen, grouped by pattern, in discovery order. */
  discovered: Map<string, string[]>;
  aborted: boolean;
  truncated: boolean;
}

/**
 * Breadth-first crawl in the user's own (logged-in) browser, reading links from the
 * rendered DOM, so client-rendered navigation and authenticated areas are covered.
 */
export async function crawl(o: CrawlOptions): Promise<CrawlResult> {
  const start = normalizeUrl(o.start);
  if (!start) throw new Error(`Invalid start URL: ${o.start}`);
  const origin = new URL(start).origin;
  const maxDepth = o.maxDepth ?? 3;
  const maxPages = o.maxPages ?? 200;
  const sample = Math.max(1, o.sample ?? 1);
  const excludes = [...(o.noDefaultExcludes ? [] : DEFAULT_EXCLUDES), ...(o.exclude ?? [])];
  const wait: WaitSpec = { until: "networkidle", timeout: 20_000, ...o.wait };

  const seen = new Set<string>();
  const discovered = new Map<string, string[]>();
  const planned = new Map<string, number>(); // pattern -> pages queued or visited
  const queue: { url: string; depth: number }[] = [];
  const pages: CrawledPage[] = [];
  let inFlight = 0;
  let aborted = false;
  let truncated = false;
  let loginPending: Promise<LoginDecision> | undefined;

  const inScope = (url: string) => {
    const u = new URL(url);
    if (u.origin !== origin) return false;
    if (o.scope && !u.pathname.startsWith(o.scope)) return false;
    if (matchesAnyGlob(url, excludes)) return false;
    if (o.include?.length && url !== start && !matchesAnyGlob(url, o.include)) return false;
    return true;
  };

  const enqueue = (raw: string, depth: number) => {
    const url = normalizeUrl(raw);
    if (!url || seen.has(url) || !inScope(url)) return;
    seen.add(url);
    const pattern = urlPattern(url);
    discovered.set(pattern, [...(discovered.get(pattern) ?? []), url]);
    if (depth > maxDepth) return;
    const n = planned.get(pattern) ?? 0;
    if (n >= sample) return;
    planned.set(pattern, n + 1);
    queue.push({ url, depth });
  };

  async function login(page: Page, url: string, finalUrl: string) {
    if (!loginPending) {
      await page.bringToFront().catch(() => {});
      loginPending = o.onLogin({ url, finalUrl }).finally(() => (loginPending = undefined));
    }
    return loginPending;
  }

  async function visit(page: Page, url: string, depth: number): Promise<CrawledPage> {
    const pattern = urlPattern(url);
    for (let attempt = 0; ; attempt++) {
      while (loginPending) await loginPending.catch(() => {});
      const nav = await gotoAndWait(page, url, wait);
      if (isLoginRedirect(url, nav.finalUrl, o.loginPattern)) {
        const decision = attempt < 3 ? await login(page, url, nav.finalUrl) : "skip";
        if (decision === "abort") aborted = true;
        if (decision === "retry") continue;
        return { url, finalUrl: nav.finalUrl, depth, title: "", pattern, status: "login", links: 0 };
      }
      const finalUrl = normalizeUrl(nav.finalUrl) ?? nav.finalUrl;
      if (finalUrl !== url && !inScope(finalUrl)) {
        return { url, finalUrl, depth, title: "", pattern, status: "redirected", links: 0 };
      }
      if (finalUrl !== url) seen.add(finalUrl);
      const { title, links } = await page.evaluate(collectLinks);
      for (const l of links) enqueue(l, depth + 1);
      return { url, finalUrl, depth, title, pattern, status: "ok", links: links.length };
    }
  }

  async function seedSitemap(page: Page) {
    const xml = await page
      .evaluate(async (u) => {
        const r = await fetch(u);
        return r.ok ? r.text() : "";
      }, `${origin}/sitemap.xml`)
      .catch(() => "");
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
    for (const l of locs) enqueue(l, 1);
    o.onEvent?.({ type: "info", message: `sitemap.xml: ${locs.length} URLs` });
  }

  async function worker(first: boolean) {
    const page = await o.session.browser.newPage({ type: "window" });
    try {
      if (first && o.sitemap) await seedSitemap(page);
      for (;;) {
        if (aborted) return;
        const next = queue.shift();
        if (!next) {
          if (inFlight === 0) return;
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        if (pages.length + inFlight >= maxPages) {
          truncated = true;
          return;
        }
        inFlight++;
        o.onEvent?.({ type: "visit", url: next.url, depth: next.depth, visited: pages.length, queued: queue.length });
        let result: CrawledPage;
        try {
          result = await visit(page, next.url, next.depth);
        } catch (e) {
          result = {
            url: next.url,
            finalUrl: next.url,
            depth: next.depth,
            title: "",
            pattern: urlPattern(next.url),
            status: "failed",
            links: 0,
            error: e instanceof Error ? e.message : String(e),
          };
        }
        pages.push(result);
        inFlight--;
        o.onEvent?.({ type: "page", page: result, visited: pages.length, queued: queue.length });
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  enqueue(start, 0);
  const n = Math.max(1, o.concurrency ?? 2);
  // The first worker seeds the queue; start the rest once there is something to share.
  const workers = [worker(true)];
  for (let i = 1; i < n; i++) {
    await new Promise((r) => setTimeout(r, 300));
    workers.push(worker(false));
  }
  await Promise.all(workers);
  if (queue.length) truncated = true;
  return { start, pages, discovered, aborted, truncated };
}

/** Runs in the page: every link in the rendered DOM, including open shadow roots. */
function collectLinks(): { title: string; links: string[] } {
  const links = new Set<string>();
  const walk = (root: Document | ShadowRoot) => {
    root.querySelectorAll<HTMLAnchorElement | HTMLAreaElement>("a[href], area[href]").forEach((a) => {
      if (a.href && !a.hasAttribute("download")) links.add(a.href);
    });
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  };
  walk(document);
  return { title: document.title, links: [...links] };
}

/**
 * Job file entries for a crawl: visited pages in visit order, grouped by pattern with a comment
 * saying how many URLs share it. Pages that failed or needed login are included as `skip: true`
 * so they're easy to re-enable.
 */
export function crawlEntries(r: CrawlResult): JobFileEntry[] {
  const entries: JobFileEntry[] = [];
  const byPattern = new Map<string, CrawledPage[]>();
  for (const p of [...r.pages].sort((a, b) => a.depth - b.depth)) {
    if (p.status === "redirected") continue;
    byPattern.set(p.pattern, [...(byPattern.get(p.pattern) ?? []), p]);
  }
  const listed = new Set<string>();
  for (const [pattern, group] of byPattern) {
    const found = r.discovered.get(pattern)?.length ?? group.length;
    group.forEach((p, i) => {
      const url = p.status === "ok" ? p.finalUrl : p.url;
      if (listed.has(url)) return;
      listed.add(url);
      const path = new URL(pattern.startsWith("http") ? pattern : `http://x${pattern}`).pathname;
      entries.push({
        url,
        skip: p.status !== "ok",
        comment: i === 0 && found > 1 ? ` ${decodeSafe(path)}${new URL(url).search ? "?…" : ""} — ${found} URLs found` : undefined,
        note: p.status === "ok" ? p.title || undefined : p.status === "login" ? "login required" : `failed: ${p.error}`,
      });
    });
  }
  return entries;
}

function decodeSafe(s: string) {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}
