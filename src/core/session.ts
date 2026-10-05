import { EventEmitter } from "node:events";
import puppeteer, { type Browser, type CDPSession, type Page, type Target } from "puppeteer-core";
import { DEFAULT_PORT, DEFAULT_PROFILE_DIR, launchChrome, probe, readDevToolsActivePort } from "./chrome.js";

export interface ConnectOptions {
  port?: number;
  /** Launch a dedicated Chrome if nothing answers on the port (default true). */
  launch?: boolean;
  chromePath?: string;
  profileDir?: string;
  /** Explicit DevTools websocket endpoint; skips probing/launching. */
  wsEndpoint?: string;
  /** Experimental: attach to the everyday Chrome via its DevToolsActivePort file. */
  autoConnect?: boolean;
  /** URL to open when launching Chrome. */
  url?: string;
}

export interface TabInfo {
  page: Page;
  url: string;
  title: string;
}

export type SessionEvents = {
  change: [];
  /** The in-page hotkey (Alt+Shift+S) was pressed on this page. */
  hotkey: [Page];
  disconnected: [];
};

const SIGNAL_BINDING = "__pagestillSignal";
// Runs in each top-level document: reports focus/visibility so pagestill can follow the tab the
// user is looking at, and turns Alt+Shift+S into a capture request.
const SIGNAL_SCRIPT = `(() => {
  if (window.top !== window || window.__pagestillInstalled) return;
  window.__pagestillInstalled = true;
  const send = (t) => { try { window.${SIGNAL_BINDING}(t); } catch {} };
  addEventListener("focus", () => send("focus"));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") send("visible"); });
  addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyS") { e.preventDefault(); e.stopImmediatePropagation(); send("capture"); }
  }, true);
})();`;

export class BrowserSession extends EventEmitter<SessionEvents> {
  readonly browser: Browser;
  readonly endpoint: string;
  /** True when pagestill launched Chrome itself (vs attaching to one already running). */
  readonly launched: boolean;
  private tabs = new Map<Page, TabInfo>();
  private sessions = new Map<Page, Promise<CDPSession>>();
  private installed = new WeakSet<Page>();
  private _active: Page | undefined;
  /** When true the active tab follows browser focus; false once the user pins a tab. */
  follow = true;
  /** Called once for every page pagestill sees (used by archivers' prepare hook). */
  onPageAdded?: (page: Page) => Promise<void> | void;

  private constructor(browser: Browser, endpoint: string, launched: boolean) {
    super();
    this.browser = browser;
    this.endpoint = endpoint;
    this.launched = launched;
  }

  static async connect(opts: ConnectOptions = {}, onPageAdded?: (page: Page) => Promise<void> | void): Promise<BrowserSession> {
    const port = opts.port ?? DEFAULT_PORT;
    let endpoint = opts.wsEndpoint;
    let launched = false;
    if (!endpoint && opts.autoConnect) {
      endpoint = readDevToolsActivePort();
      if (!endpoint) {
        throw new Error("No DevToolsActivePort found. Enable remote debugging at chrome://inspect/#remote-debugging first.");
      }
    }
    if (!endpoint) endpoint = await probe(port);
    if (!endpoint) {
      if (opts.launch === false) throw new Error(`Nothing is listening on port ${port} (and --no-launch was given).`);
      endpoint = await launchChrome({
        port,
        chromePath: opts.chromePath,
        profileDir: opts.profileDir ?? DEFAULT_PROFILE_DIR,
        url: opts.url,
      });
      launched = true;
    }
    const browser = await puppeteer.connect({
      browserWSEndpoint: endpoint,
      // Never resize the user's tabs on connect.
      defaultViewport: null,
      protocolTimeout: 180_000,
    });
    const session = new BrowserSession(browser, endpoint, launched);
    session.onPageAdded = onPageAdded;
    await session.init();
    return session;
  }

  private async init() {
    this.browser.on("disconnected", () => this.emit("disconnected"));
    this.browser.on("targetcreated", (t: Target) => void this.onTarget(t));
    this.browser.on("targetchanged", (t: Target) => void this.onTargetChanged(t));
    this.browser.on("targetdestroyed", (t: Target) => this.onTargetDestroyed(t));
    const pages = await this.browser.pages();
    await Promise.all(pages.map((p) => this.addPage(p)));
    await this.pickInitialActive();
  }

  get active(): Page | undefined {
    return this._active;
  }

  get activeTab(): TabInfo | undefined {
    return this._active ? this.tabs.get(this._active) : undefined;
  }

  listTabs(): TabInfo[] {
    return [...this.tabs.values()];
  }

  /** Pin a tab (stops following focus). Pass undefined to go back to auto-follow. */
  pin(page: Page | undefined) {
    if (page) {
      this.follow = false;
      this._active = page;
    } else {
      this.follow = true;
    }
    this.emit("change");
  }

  /** A CDP session per page, reused for emulation and screenshots. */
  cdp(page: Page): Promise<CDPSession> {
    let s = this.sessions.get(page);
    if (!s) {
      s = page.createCDPSession();
      this.sessions.set(page, s);
    }
    return s;
  }

  async disconnect() {
    for (const s of this.sessions.values()) await (await s).detach().catch(() => {});
    await this.browser.disconnect();
  }

  private async onTarget(t: Target) {
    if (t.type() !== "page") return;
    const page = await t.page().catch(() => null);
    if (page) await this.addPage(page);
  }

  private async onTargetChanged(t: Target) {
    if (t.type() !== "page") return;
    const page = await t.page().catch(() => null);
    if (!page) return;
    const info = this.tabs.get(page);
    if (!info) return this.addPage(page);
    info.url = page.url();
    info.title = await page.title().catch(() => info.title);
    this.emit("change");
  }

  private onTargetDestroyed(t: Target) {
    for (const page of this.tabs.keys()) {
      if (page.target() === t) {
        this.tabs.delete(page);
        this.sessions.delete(page);
        if (this._active === page) {
          this._active = this.tabs.keys().next().value;
          this.follow = true;
        }
        this.emit("change");
        return;
      }
    }
  }

  private async addPage(page: Page) {
    if (this.tabs.has(page)) return;
    const info: TabInfo = { page, url: page.url(), title: await page.title().catch(() => "") };
    this.tabs.set(page, info);
    page.on("close", () => this.onTargetDestroyed(page.target()));
    await this.install(page);
    this.emit("change");
  }

  private async install(page: Page) {
    if (this.installed.has(page)) return;
    this.installed.add(page);
    const url = page.url();
    // chrome://, devtools:// and extension pages can't be scripted
    if (/^(chrome|devtools|chrome-extension|edge|about:(?!blank))/.test(url)) return;
    try {
      await page.exposeFunction(SIGNAL_BINDING, (type: string) => this.onSignal(page, type));
      await page.evaluateOnNewDocument(SIGNAL_SCRIPT);
      await page.evaluate(SIGNAL_SCRIPT).catch(() => {});
      await this.onPageAdded?.(page);
    } catch {
      // not scriptable; still listed and capturable as an image
    }
  }

  private onSignal(page: Page, type: string) {
    if (this.follow && this._active !== page) {
      this._active = page;
      this.emit("change");
    }
    if (type === "capture") this.emit("hotkey", page);
  }

  private async pickInitialActive() {
    const states = await Promise.all(
      [...this.tabs.keys()].map(async (page) => {
        const s = await page
          .evaluate(() => ({ focus: document.hasFocus(), visible: document.visibilityState === "visible" }))
          .catch(() => ({ focus: false, visible: false }));
        return { page, ...s };
      }),
    );
    const isWeb = (p: Page) => /^https?:|^file:/.test(p.url());
    this._active =
      states.find((s) => s.focus)?.page ??
      states.find((s) => s.visible && isWeb(s.page))?.page ??
      states.find((s) => s.visible)?.page ??
      states[0]?.page;
    this.emit("change");
  }
}
