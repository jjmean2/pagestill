/*
 * SingleFile archiver adapter.
 *
 * Uses the prebuilt browser bundle from single-file-cli (by Gildas Lormeau, AGPL-3.0-or-later)
 * and drives it over CDP against the page that is already open, instead of letting
 * single-file-cli load the URL itself. This is the only module that knows about SingleFile.
 */
import type { CDPSession, Page } from "puppeteer-core";
import type { Archiver, ArchiveResult } from "../types.js";
import type { HtmlOptions } from "../../core/settings.js";
import { toSingleFileOptions } from "./options.js";

const WORLD = "pagestill:singlefile";
const NS = "__pagestillSF";
const SET_PAGE_DATA = `${NS}SetPageData`;
const FETCH = `${NS}Fetch`;
const RESOLVE = `${NS}Resolve`;
const REJECT = `${NS}Reject`;
const READY = `${NS}Ready`;
const CHUNK_SIZE = 8 * 1024 * 1024;
const CAPTURE_TIMEOUT_MS = 120_000;

/**
 * Runs inside the isolated world right after the SingleFile bundle. Fetches go through the
 * page's own fetch first (cookies, same-origin); when that throws (typically CORS) the request
 * is handed to pagestill through a binding and answered with the bytes.
 */
const PAGE_INIT = `(() => {
  const nativeFetch = globalThis.fetch;
  const pending = new Map();
  let lastId = 0;
  globalThis.${RESOLVE} = (id, result) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    const bin = atob(result.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    p.resolve({ status: result.status, headers: new Headers(result.headers), arrayBuffer: () => Promise.resolve(bytes.buffer) });
  };
  globalThis.${REJECT} = (id, message) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.reject(new Error(message));
  };
  const fetchFn = async (url, options) => {
    try {
      return await nativeFetch(url, options);
    } catch {
      const id = lastId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        globalThis.${FETCH}(JSON.stringify({ id, url, headers: (options && options.headers) || {} }));
      });
    }
  };
  singlefile.init({ fetch: fetchFn, frameFetch: fetchFn });
  globalThis.${READY} = true;
})();`;

const CAPTURE_FN = `async (options, setName, chunkSize) => {
  const data = await globalThis.singlefile.getPageData(options);
  const json = JSON.stringify({ content: data.content, title: data.title });
  for (let i = 0; i < json.length; i += chunkSize) globalThis[setName](json.slice(i, i + chunkSize));
  globalThis[setName]("");
}`;

let bundlePromise: Promise<{ main: string; hook: string }> | undefined;
function loadBundle() {
  bundlePromise ??= import("single-file-cli/lib/single-file-bundle.js").then((b) => ({
    main: `${b.script}\n${PAGE_INIT}`,
    hook: b.hookScript,
  }));
  return bundlePromise;
}

interface BindingCalled {
  name: string;
  payload: string;
  executionContextId: number;
}

/** Answer SingleFile's fallback fetches: first through the browser (keeps cookies), then from Node. */
async function handleFetch(session: CDPSession, frameId: string, ev: BindingCalled, userAgent: string) {
  const { id, url, headers } = JSON.parse(ev.payload) as { id: number; url: string; headers: Record<string, string> };
  let expression: string;
  try {
    const result = await loadViaBrowser(session, frameId, url).catch(() => loadViaNode(url, headers, userAgent));
    expression = `globalThis.${RESOLVE}(${id}, ${JSON.stringify(result)})`;
  } catch (error) {
    expression = `globalThis.${REJECT}(${id}, ${JSON.stringify(String(error))})`;
  }
  await session.send("Runtime.evaluate", { expression, contextId: ev.executionContextId }).catch(() => {});
}

interface FetchResult {
  status: number;
  headers: Record<string, string>;
  data: string;
}

async function loadViaBrowser(session: CDPSession, frameId: string, url: string): Promise<FetchResult> {
  const { resource } = await session.send("Network.loadNetworkResource", {
    frameId,
    url,
    options: { disableCache: false, includeCredentials: true },
  });
  if (!resource.success || !resource.stream) throw new Error(resource.netErrorName ?? "load failed");
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const r = await session.send("IO.read", { handle: resource.stream, size: 1 << 20 });
      chunks.push(Buffer.from(r.data, r.base64Encoded ? "base64" : "utf8"));
      if (r.eof) break;
    }
  } finally {
    await session.send("IO.close", { handle: resource.stream }).catch(() => {});
  }
  return {
    status: resource.httpStatusCode ?? 200,
    headers: (resource.headers as Record<string, string>) ?? {},
    data: Buffer.concat(chunks).toString("base64"),
  };
}

async function loadViaNode(url: string, headers: Record<string, string>, userAgent: string): Promise<FetchResult> {
  const res = await fetch(url, { headers: { "user-agent": userAgent, ...headers } });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data: Buffer.from(await res.arrayBuffer()).toString("base64"),
  };
}

/** Inject SingleFile into every frame of a target (runImmediately reaches the already-loaded frames). */
async function injectIntoTarget(session: CDPSession, source: string, frameId: string, userAgent: string) {
  session.on("Runtime.bindingCalled", (ev: BindingCalled) => {
    if (ev.name === FETCH) void handleFetch(session, frameId, ev, userAgent);
  });
  await session.send("Runtime.addBinding", { name: FETCH, executionContextName: WORLD });
  await session.send("Runtime.addBinding", { name: SET_PAGE_DATA, executionContextName: WORLD });
  await session.send("Runtime.enable");
  await session.send("Page.enable");
  const { identifier } = await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source,
    worldName: WORLD,
    runImmediately: true,
  });
  // One-shot: don't re-inject on the user's next navigation.
  await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
}

/** Attach to out-of-process (cross-origin) iframes, recursively, and inject into them too. */
async function injectIntoOopifs(
  session: CDPSession,
  source: string,
  userAgent: string,
  children: CDPSession[],
  warnings: string[],
): Promise<void> {
  const pending: Promise<void>[] = [];
  session.on("Target.attachedToTarget", (ev: { sessionId: string; targetInfo: { type: string; targetId: string; url: string } }) => {
    if (ev.targetInfo.type !== "iframe") return;
    const child = session.connection()?.session(ev.sessionId);
    if (!child) return;
    children.push(child);
    pending.push(
      (async () => {
        await injectIntoTarget(child, source, ev.targetInfo.targetId, userAgent);
        await injectIntoOopifs(child, source, userAgent, children, warnings);
      })().catch((e) => {
        warnings.push(`frame ${ev.targetInfo.url}: ${String(e)}`);
      }),
    );
  });
  await session.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  // Attach events for existing targets arrive before the command's response; give stragglers a tick.
  await new Promise((r) => setTimeout(r, 50));
  await Promise.all(pending);
}

async function topContextId(session: CDPSession, source: string): Promise<number> {
  const { frameTree } = await session.send("Page.getFrameTree");
  const { executionContextId } = await session.send("Page.createIsolatedWorld", {
    frameId: frameTree.frame.id,
    worldName: WORLD,
  });
  const ready = await session.send("Runtime.evaluate", {
    expression: `globalThis.${READY} === true`,
    contextId: executionContextId,
    returnByValue: true,
  });
  if (ready.result.value !== true) {
    // A fresh world was returned instead of the one runImmediately populated: inject here.
    const r = await session.send("Runtime.evaluate", { expression: source, contextId: executionContextId });
    if (r.exceptionDetails) throw new Error(`SingleFile injection failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  }
  return executionContextId;
}

const singleFileArchiver: Archiver = {
  id: "singlefile",
  name: "SingleFile",
  license: "AGPL-3.0-or-later",

  async prepare(page: Page) {
    const { hook } = await loadBundle();
    await page.evaluateOnNewDocument(hook);
  },

  async archive(page: Page, options: HtmlOptions, ctx): Promise<ArchiveResult> {
    const { main: source } = await loadBundle();
    const warnings: string[] = [];
    const session = await page.createCDPSession();
    const children: CDPSession[] = [];
    try {
      const userAgent = await page.browser().userAgent();
      const { frameTree } = await session.send("Page.getFrameTree");

      let resolveData!: (v: { content: string; title?: string }) => void;
      let rejectData!: (e: Error) => void;
      const dataPromise = new Promise<{ content: string; title?: string }>((res, rej) => {
        resolveData = res;
        rejectData = rej;
      });
      let buffer = "";
      session.on("Runtime.bindingCalled", (ev: BindingCalled) => {
        if (ev.name !== SET_PAGE_DATA) return;
        if (ev.payload.length) {
          buffer += ev.payload;
          return;
        }
        try {
          resolveData(JSON.parse(buffer));
        } catch (e) {
          rejectData(e as Error);
        }
      });

      ctx.log?.("Injecting SingleFile");
      await injectIntoTarget(session, source, frameTree.frame.id, userAgent);
      if (options.includeFrames) await injectIntoOopifs(session, source, userAgent, children, warnings);
      const contextId = await topContextId(session, source);

      ctx.log?.("Serializing page");
      const sfOptions = toSingleFileOptions(options, page.url());
      const evaluation = session
        .send("Runtime.evaluate", {
          expression: `(${CAPTURE_FN})(${JSON.stringify(sfOptions)}, ${JSON.stringify(SET_PAGE_DATA)}, ${CHUNK_SIZE})`,
          contextId,
          awaitPromise: true,
        })
        .then((r) => {
          if (r.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
          }
        });

      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("HTML capture timed out")), CAPTURE_TIMEOUT_MS);
        ctx.signal?.addEventListener("abort", () => rej(new Error("HTML capture aborted")), { once: true });
      });
      try {
        const [data] = await Promise.race([Promise.all([dataPromise, evaluation]), timeout]);
        return { html: data.content, title: data.title, warnings };
      } finally {
        clearTimeout(timer);
      }
    } finally {
      for (const child of children) await child.detach().catch(() => {});
      await session.detach().catch(() => {});
    }
  },
};

export default singleFileArchiver;
