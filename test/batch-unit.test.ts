import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  appendToPageList,
  loadPageList,
  pageName,
  parsePageList,
  resolvePages,
  setSkipped,
  variants,
  writePageList,
} from "../src/batch/pagelist.js";
import { navigationChecks } from "../src/batch/runner.js";
import { DEFAULT_EXCLUDES, isLoginRedirect, matchesAnyGlob, normalizeUrl, urlPattern } from "../src/core/urls.js";

describe("urls", () => {
  it("normalizes for de-duplication", () => {
    expect(normalizeUrl("https://a.com/x/?b=2&utm_source=m&a=1#top")).toBe("https://a.com/x?a=1&b=2");
    expect(normalizeUrl("/p", "https://a.com/base/")).toBe("https://a.com/p");
    expect(normalizeUrl("mailto:a@b.c")).toBeUndefined();
    expect(normalizeUrl("javascript:void(0)")).toBeUndefined();
  });

  it("groups id-like segments into patterns", () => {
    expect(urlPattern("https://a.com/users/42/edit")).toBe("https://a.com/users/:id/edit");
    expect(urlPattern("https://a.com/o/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f")).toBe("https://a.com/o/:uuid");
    expect(urlPattern("https://a.com/list?page=2&sort=x")).toBe("https://a.com/list?page=&sort=");
    expect(urlPattern("https://a.com/blog/hello-world")).toBe("https://a.com/blog/hello-world");
  });

  it("never follows destructive links by default", () => {
    expect(matchesAnyGlob("https://a.com/account/logout", DEFAULT_EXCLUDES)).toBe(true);
    expect(matchesAnyGlob("https://a.com/items/3/delete?x=1", DEFAULT_EXCLUDES)).toBe(true);
    expect(matchesAnyGlob("https://a.com/files/report.pdf", DEFAULT_EXCLUDES)).toBe(true);
    expect(matchesAnyGlob("https://a.com/users", DEFAULT_EXCLUDES)).toBe(false);
    expect(matchesAnyGlob("https://a.com/admin/users/3", ["/admin/**"])).toBe(true);
  });

  it("detects login redirects", () => {
    expect(isLoginRedirect("https://a.com/dash", "https://a.com/login?next=/dash")).toBe(true);
    expect(isLoginRedirect("https://a.com/dash", "https://accounts.google.com/o/oauth2")).toBe(true);
    expect(isLoginRedirect("https://a.com/login", "https://a.com/login")).toBe(false);
    expect(isLoginRedirect("https://a.com/dash", "https://a.com/dash")).toBe(false);
    expect(isLoginRedirect("https://a.com/dash", "https://a.com/gate", "/gate")).toBe(true);
    expect(isLoginRedirect("https://a.com/dash", "https://a.com/Gate", "/\\/gate/i")).toBe(true);
  });
});

describe("page list", () => {
  const collect = () => {
    const warnings: string[] = [];
    return { warnings, warn: (m: string) => warnings.push(m) };
  };
  const list = (raw: Record<string, unknown>) => parsePageList(raw, "t.pages.yaml", () => {});

  it("expands the matrix", () => {
    expect(variants().map((v) => v.id)).toEqual(["capture"]);
    const m = list({ pages: [], matrix: { viewport: ["1440x900", "390x844m"], theme: ["light", "dark"], dpr: [1, "2x"] } }).matrix;
    expect(variants(m).map((v) => v.id).slice(0, 3)).toEqual(["1440x900.light.1x", "1440x900.light.2x", "1440x900.dark.1x"]);
    expect(variants(m)).toHaveLength(8);
    expect(variants(m)[1]!.patch).toEqual({ viewport: { width: 1440, height: 900 }, theme: "light", dpr: 2 });
  });

  it("drops matrix axes a flag sets", () => {
    const m = list({ pages: [], matrix: { viewport: ["1440x900", "390x844m"], theme: ["light", "dark"] } }).matrix;
    expect(variants(m, new Set(["theme"])).map((v) => v.id)).toEqual(["1440x900", "390x844m"]);
  });

  it("resolves pages against base with unique names", () => {
    const pages = resolvePages(
      list({
        base: "https://a.com/app/",
        load: { waitFor: "main" },
        pages: ["./", "users", "/other", { url: "users", load: { timeout: "5s" } }, { url: "gone", skip: true }],
      }),
    );
    expect(pages.map((p) => [p.url, p.name])).toEqual([
      ["https://a.com/app/", "index"],
      ["https://a.com/app/users", "users"],
      ["https://a.com/other", "other"],
      ["https://a.com/app/users", "users-2"],
    ]);
    expect(pages[3]!.load).toEqual({ waitFor: "main", timeout: 5000 });
    expect(pageName("https://a.com/s?q=a b")).toBe("s--q-a-b");
  });

  it("filters with --only on path or name", () => {
    const l = list({ base: "https://a.com/", pages: ["/admin/users", "/admin/roles", "/blog", { url: "/x", name: "special" }] });
    expect(resolvePages(l, "/admin/**").map((p) => p.name)).toEqual(["admin-users", "admin-roles"]);
    expect(resolvePages(l, "special").map((p) => p.name)).toEqual(["special"]);
  });

  it("reads the full format", () => {
    const l = list({
      name: "review",
      preset: "retina, dark",
      settings: { hide: [".cookie"] },
      login: "/sso/",
      concurrency: 2,
      pages: [{ url: "/s", steps: [{ click: "#b" }, { type: { into: "#q", text: "hi" } }, { wait: "300ms" }, { scroll: "bottom" }] }],
    });
    expect(l).toMatchObject({ name: "review", presets: ["retina", "dark"], settings: { hide: [".cookie"] }, login: "/sso/", concurrency: 2 });
    expect(l.pages[0]!.steps).toEqual([{ click: "#b" }, { type: { into: "#q", text: "hi" } }, { wait: 300 }, { scroll: "bottom" }]);
  });

  it("converts the pre-0.4 job format, with warnings", () => {
    const { warn, warnings } = collect();
    const l = parsePageList(
      {
        out: "shots",
        loginPattern: "/sso/",
        wait: { until: "load", selector: "main", delay: 500 },
        settings: { hideSelectors: [".x"] },
        pages: [{ url: "/a", wait: { selector: ".chart" }, actions: [{ type: { selector: "#q", text: "x" } }] }],
      },
      "old.yaml",
      warn,
    );
    expect(l.settings).toEqual({ hide: [".x"], out: "shots", delay: 500 });
    expect(l.load).toEqual({ until: "load", waitFor: "main" });
    expect(l.login).toBe("/sso/");
    expect(l.pages[0]).toMatchObject({ load: { waitFor: ".chart" }, steps: [{ type: { into: "#q", text: "x" } }] });
    expect(warnings.length).toBeGreaterThanOrEqual(6);
    expect(warnings.every((w) => w.startsWith("old.yaml"))).toBe(true);
  });

  it("rejects unknown steps and matrix keys clearly", () => {
    expect(() => list({ pages: [{ url: "/a", steps: [{ tap: "#b" }] }] })).toThrow(/pages\[0\] steps\[0\]: unknown step "tap"/);
    expect(() => list({ pages: [], matrix: { format: ["png"] } })).toThrow(/matrix supports viewport, theme and dpr/);
    expect(() => loadPageList(join(mkdtempSync(join(tmpdir(), "x-")), "missing.pages.yaml"))).toThrow(/Cannot read/);
  });

  it("writes an editable list and toggles skip without losing comments", () => {
    const path = join(mkdtempSync(join(tmpdir(), "pagestill-list-")), "a.pages.yaml");
    writePageList(path, {
      header: " Generated by test",
      base: "https://a.com/",
      entries: [
        { url: "https://a.com/", note: "Home" },
        { url: "https://a.com/users/1", comment: " /users/:id — 3 found", note: "User 1" },
        { url: "https://b.com/x", skip: true },
      ],
    });
    const text = readFileSync(path, "utf8");
    expect(text).toContain("# Generated by test");
    expect(text).toContain("# /users/:id — 3 found");
    expect(text).toContain("- /users/1 # User 1");
    expect(loadPageList(path).pages.map((p) => [p.url, p.skip])).toEqual([["/", false], ["/users/1", false], ["https://b.com/x", true]]);

    const doc = YAML.parseDocument(text);
    setSkipped(doc, 1, true);
    setSkipped(doc, 2, false);
    const after = doc.toString();
    expect(after).toContain("# /users/:id — 3 found");
    expect(after).toContain("- url: /users/1 # User 1");
    expect(YAML.parse(after).pages).toEqual(["/", { url: "/users/1", skip: true }, "https://b.com/x"]);
    const back = YAML.parseDocument(after);
    setSkipped(back, 1, false);
    expect(back.toString()).toContain("- /users/1 # User 1");
  });

  it("appends to an existing list instead of overwriting it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "pagestill-list-")), "a.pages.yaml");
    writeFileSync(path, "# mine\nbase: https://a.com/\nmatrix:\n  theme: [dark]\npages:\n  - /one # kept\n");
    const added = appendToPageList(path, {
      header: " ignored for existing files",
      base: "https://a.com/",
      entries: [{ url: "https://a.com/one" }, { url: "https://a.com/two", note: "Two · reached in-page" }],
    });
    expect(added).toBe(1);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("# mine");
    expect(text).toContain("theme: [ dark ]");
    expect(YAML.parse(text).pages).toEqual(["/one", "/two"]);
    expect(text).toContain("- /two # Two · reached in-page");
  });
});

describe("run checks", () => {
  it("flags HTTP errors and pages that ended elsewhere", () => {
    expect(navigationChecks("https://a.com/x", { finalUrl: "https://a.com/x/", status: 200, warnings: [] })).toEqual([]);
    expect(navigationChecks("https://a.com/x", { finalUrl: "https://a.com/x", status: 404, warnings: [] })).toEqual(["HTTP 404"]);
    expect(navigationChecks("https://a.com/x", { finalUrl: "https://a.com/", status: 200, warnings: [] })).toEqual(["ended on https://a.com/"]);
  });
});
