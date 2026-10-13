import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";
import { crawl, crawlEntries } from "../src/batch/crawler.js";
import { type PageList, pageName, parsePageList, writePageList } from "../src/batch/pagelist.js";
import { type LoginDecision, RunWriter, type RunEvent, entryKey, navigationChecks, readManifest, runPageList } from "../src/batch/runner.js";
import { capture } from "../src/core/capture.js";
import { findChrome } from "../src/core/chrome.js";
import { BrowserSession } from "../src/core/session.js";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/core/settings.js";
import { type TestSite, startSite } from "./site.js";

describe.skipIf(!findChrome())("batch run against a real Chrome", () => {
  let site: TestSite;
  let session: BrowserSession;
  const tmp = mkdtempSync(join(tmpdir(), "pagestill-batch-"));
  const out = join(tmp, "out");

  beforeAll(async () => {
    site = await startSite();
    session = await BrowserSession.connect({ port: 9000 + Math.floor(Math.random() * 900), profileDir: join(tmp, "profile") });
  }, 120_000);

  afterAll(async () => {
    await session?.browser.close().catch(() => {});
    site?.close();
  });

  const list = (pages: unknown[], extra: Record<string, unknown> = {}): PageList =>
    parsePageList(
      {
        name: "Site Run",
        base: `${site.base}site/`,
        concurrency: 2,
        matrix: { viewport: ["800x600", "390x844m"] },
        settings: { area: "viewport", dpr: 1, out },
        pages,
        ...extra,
      },
      "test.pages.yaml",
      () => {},
    );

  const clearCookies = async () => {
    const s = await session.browser.target().createCDPSession();
    await s.send("Storage.clearCookies");
    await s.detach();
  };
  const logIn = async (): Promise<LoginDecision> => {
    await session.browser.defaultBrowserContext().setCookie({ name: "auth", value: "1", domain: "localhost", path: "/" });
    return "retry";
  };

  it("captures pages × variants, pauses for login, flags suspicious pages, writes manifest + gallery", async () => {
    await clearCookies();
    const logins: string[] = [];
    const events: RunEvent[] = [];
    const r = await runPageList({
      session,
      list: list(["./", "a", { url: "b?x=1", name: "bee" }, "private", "old", "nope", { url: "users/1", skip: true }]),
      config: {},
      onEvent: (e) => events.push(e),
      onLogin: async ({ url, finalUrl }) => {
        logins.push(`${url} -> ${finalUrl}`);
        return logIn();
      },
    });
    const m = r.manifest;
    expect(r.runDir.startsWith(join(out, "runs", "site-run-"))).toBe(true);
    expect(Object.values(m.entries)).toHaveLength(12); // 6 pages × 2 variants, users/1 skipped
    expect(r).toMatchObject({ ok: 8, check: 4, failed: 0, skipped: 0, aborted: false });
    expect(m.entries["old/800x600"]).toMatchObject({ status: "check", checks: [expect.stringMatching(/^ended on .*\/site\/a$/)] });
    expect(m.entries["nope/390x844m"]).toMatchObject({ status: "check", checks: ["HTTP 404"] });
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatch(/\/site\/private -> .*\/site\/login/);

    expect(m.entries["bee/390x844m"]!.files.find((f) => f.kind === "image")).toMatchObject({ width: 390, height: 844 });
    expect(m.entries["index/800x600"]!.files.map((f) => f.path).sort()).toEqual(["index/800x600.html", "index/800x600.png"]);
    expect(readFileSync(join(r.runDir, "private/800x600.html"), "utf8")).toContain("secret dashboard");
    expect(site.hits.get("/site/users/1")).toBeUndefined();
    expect(m.entries["bee/390x844m"]!.thumb).toBe(".thumbs/bee--390x844m.jpg");
    const gallery = readFileSync(join(r.runDir, "index.html"), "utf8");
    expect(gallery).toContain('src=".thumbs/bee--390x844m.jpg"');
    expect(gallery).toContain("4 to check");
    expect(gallery).toContain("check: HTTP 404");
    expect(events.at(-1)).toMatchObject({ type: "done", check: 4 });
  }, 120_000);

  it("lets a flag replace a matrix axis and --only pick pages", async () => {
    const r = await runPageList({
      session,
      list: list(["a", "b?x=1", "./"]),
      config: {},
      flags: { viewport: { width: 1024, height: 700 } },
      only: "/site/a",
      onEvent: () => {},
      onLogin: async () => "skip",
    });
    expect(Object.keys(r.manifest.entries)).toEqual(["a/capture"]);
    expect(r.manifest.entries["a/capture"]!.files.find((f) => f.kind === "image")).toMatchObject({ width: 1024, height: 700 });
  }, 120_000);

  it("resumes a run, redoing only what isn't finished", async () => {
    const first = await runPageList({ session, list: list(["a"]), config: {}, onEvent: () => {}, onLogin: async () => "skip" });
    const before = site.hits.get("/site/a") ?? 0;
    const events: RunEvent[] = [];
    await runPageList({
      session,
      list: list(["a", "b?x=1"]),
      config: {},
      runDir: first.runDir,
      onEvent: (e) => events.push(e),
      onLogin: async () => "skip",
    });
    expect(events.find((e) => e.type === "start")).toMatchObject({ total: 4, alreadyDone: 2 });
    expect(site.hits.get("/site/a")).toBe(before); // a was not visited again
    expect(Object.keys(readManifest(first.runDir)!.entries).sort()).toEqual(["a/390x844m", "a/800x600", "b--x-1/390x844m", "b--x-1/800x600"]);
  }, 120_000);

  it("crawls the logged-in site into an editable page list", async () => {
    await clearCookies();
    const logins: string[] = [];
    const result = await crawl({
      session,
      start: `${site.base}site/`,
      maxDepth: 5,
      onLogin: async ({ url }) => {
        logins.push(url);
        return logIn();
      },
    });
    const paths = result.pages.map((p) => new URL(p.url).pathname + new URL(p.url).search).sort();
    expect(paths).toEqual(["/site", "/site/a", "/site/b?x=1", "/site/private", "/site/users/1"]);
    expect(result.pages.every((p) => p.status === "ok")).toBe(true);
    expect(logins).toEqual([`${site.base}site/private`]);
    expect(result.discovered.get(`${site.base.slice(0, -1)}/site/users/:id`)).toHaveLength(2);
    for (const never of ["/site/logout", "/site/report.pdf", "/site/users/2"]) expect(site.hits.get(never), never).toBeUndefined();

    const file = join(tmp, "site.pages.yaml");
    writePageList(file, { header: " test", base: site.base, entries: crawlEntries(result) });
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/# \/site\/users\/:id — 2 URLs found\n\s+- \/site\/users\/1 # User 1/);
    const listed = YAML.parse(text).pages as string[];
    expect(listed[0]).toBe("/site"); // start page first
    expect([...listed].sort()).toEqual(["/site", "/site/a", "/site/b?x=1", "/site/private", "/site/users/1"]);
  }, 120_000);

  it("captures while crawling (crawl --capture)", async () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, { html: false, area: "viewport", viewport: { width: 640, height: 480 }, dpr: 1 });
    const writer = new RunWriter(join(out, "runs", "crawl-test"), { listName: "crawl test" });
    const { applyEmulation, emulationKey } = await import("../src/core/emulation.js");
    await crawl({
      session,
      start: `${site.base}site/a`,
      maxDepth: 1,
      onLogin: async () => "skip",
      onWindow: async (page) => applyEmulation(await session.cdp(page), settings),
      onPage: async (page, visited, nav) => {
        const name = pageName(visited.finalUrl, site.base);
        const res = await capture(session, page, settings, { keepEmulation: true, appliedEmulation: emulationKey(settings), dir: writer.dir, name: `${name}/capture` });
        await writer.record(
          writer.entryFrom({ key: entryKey(name, "capture"), page: name, url: visited.url, variant: "capture" }, res, { finalUrl: nav.finalUrl, checks: navigationChecks(visited.url, nav), warnings: [] }, Date.now()),
        );
      },
    });
    const s = writer.finish(false);
    expect(s.ok).toBe(2); // /site/a and /site/b?x=1
    expect(writer.manifest.entries["site-a/capture"]!.files[0]).toMatchObject({ kind: "image", width: 640, height: 480 });
    expect(existsSync(join(writer.dir, "index.html"))).toBe(true);
  }, 120_000);
});
