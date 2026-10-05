import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";
import { crawl, crawlEntries } from "../src/batch/crawler.js";
import { type Job, writeJobFile } from "../src/batch/job.js";
import { type LoginDecision, type RunEvent, readManifest, runJob } from "../src/batch/runner.js";
import { findChrome } from "../src/core/chrome.js";
import { BrowserSession } from "../src/core/session.js";
import { type TestSite, startSite } from "./site.js";

describe.skipIf(!findChrome())("batch run against a real Chrome", () => {
  let site: TestSite;
  let session: BrowserSession;
  const tmp = mkdtempSync(join(tmpdir(), "pagestill-batch-"));

  beforeAll(async () => {
    site = await startSite();
    session = await BrowserSession.connect({ port: 9000 + Math.floor(Math.random() * 900), profileDir: join(tmp, "profile") });
  }, 120_000);

  afterAll(async () => {
    await session?.browser.close().catch(() => {});
    site?.close();
  });

  const job = (): Job => ({
    name: "Site Run",
    base: `${site.base}site/`,
    out: join(tmp, "out"),
    concurrency: 2,
    matrix: { viewport: ["800x600", "390x844m"] },
    settings: { area: "viewport", dpr: 1 },
    pages: ["./", "a", { url: "b?x=1", name: "bee" }, "private", { url: "users/1", skip: true }],
  });

  it("captures pages × variants, pauses for login, and writes manifest + gallery", async () => {
    const logins: string[] = [];
    const events: RunEvent[] = [];
    const { manifest: m, runDir } = await runJob({
      session,
      job: job(),
      config: {},
      onEvent: (e) => events.push(e),
      onLogin: async ({ url, finalUrl }): Promise<LoginDecision> => {
        logins.push(`${url} -> ${finalUrl}`);
        // "the human logs in"
        await session.browser.defaultBrowserContext().setCookie({ name: "auth", value: "1", domain: "localhost", path: "/" });
        return "retry";
      },
    });
    const entries = Object.values(m.entries);
    expect(entries).toHaveLength(8); // 4 pages × 2 variants, users/1 skipped
    expect(entries.filter((e) => e.status !== "ok")).toEqual([]);
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatch(/\/site\/private -> .*\/site\/login/);

    expect(events.find((e) => e.type === "done")).toMatchObject({ ok: 8, failed: 0, skipped: 0, aborted: false });
    expect(existsSync(join(runDir, "index.html"))).toBe(true);
    const mobile = m.entries["bee/390x844m"]!;
    expect(mobile.files.find((f) => f.kind === "image")).toMatchObject({ width: 390, height: 844 });
    expect(m.entries["index/800x600"]!.files.map((f) => f.path).sort()).toEqual(["index/800x600.html", "index/800x600.png"]);
    expect(readFileSync(join(runDir, "private/800x600.html"), "utf8")).toContain("secret dashboard");
    expect(mobile.thumb).toBe(".thumbs/bee--390x844m.jpg");
    expect(readFileSync(join(runDir, "index.html"), "utf8")).toContain('src=".thumbs/bee--390x844m.jpg"');
    expect(site.hits.get("/site/users/1")).toBeUndefined();
  }, 120_000);

  it("resumes a run, redoing only what isn't ok", async () => {
    const { runDir } = await runJob({ session, job: { ...job(), pages: ["a"] }, config: {}, onEvent: () => {}, onLogin: async () => "skip" });
    const before = site.hits.get("/site/a") ?? 0;
    const events: RunEvent[] = [];
    await runJob({ session, job: { ...job(), pages: ["a", "b?x=1"] }, config: {}, runDir, onEvent: (e) => events.push(e), onLogin: async () => "skip" });
    expect(events.find((e) => e.type === "start")).toMatchObject({ total: 4, alreadyDone: 2 });
    expect(site.hits.get("/site/a")).toBe(before); // a was not visited again
    expect(Object.keys(readManifest(runDir)!.entries).sort()).toEqual(["a/390x844m", "a/800x600", "b--x-1/390x844m", "b--x-1/800x600"]);
  }, 120_000);

  it("crawls the logged-in site into an editable job file", async () => {
    const browserSession = await session.browser.target().createCDPSession();
    await browserSession.send("Storage.clearCookies");
    await browserSession.detach();
    const logins: string[] = [];
    const result = await crawl({
      session,
      start: `${site.base}site/`,
      maxDepth: 5,
      onLogin: async ({ url }) => {
        logins.push(url);
        await session.browser.defaultBrowserContext().setCookie({ name: "auth", value: "1", domain: "localhost", path: "/" });
        return "retry";
      },
    });
    const paths = result.pages.map((p) => new URL(p.url).pathname + new URL(p.url).search).sort();
    expect(paths).toEqual(["/site", "/site/a", "/site/b?x=1", "/site/private", "/site/users/1"]);
    expect(result.pages.every((p) => p.status === "ok")).toBe(true);
    expect(logins).toEqual([`${site.base}site/private`]);
    expect(result.discovered.get(`${site.base.slice(0, -1)}/site/users/:id`)).toHaveLength(2);
    for (const never of ["/site/logout", "/site/report.pdf", "/site/users/2"]) expect(site.hits.get(never), never).toBeUndefined();

    const file = join(tmp, "pages.yaml");
    writeJobFile(file, { header: " test", base: site.base, entries: crawlEntries(result) });
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/# \/site\/users\/:id — 2 URLs found\n\s+- \/site\/users\/1 # User 1/);
    const listed = YAML.parse(text).pages as string[];
    expect(listed[0]).toBe("/site"); // start page first
    expect([...listed].sort()).toEqual(["/site", "/site/a", "/site/b?x=1", "/site/private", "/site/users/1"]);
  }, 120_000);
});
