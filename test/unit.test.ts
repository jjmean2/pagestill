import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { settingsFromFlags } from "../src/cli/options.js";
import { settingsTopic } from "../src/cli/topics.js";
import { loadConfig, presetNames, resolveSettings } from "../src/core/config.js";
import { parseDuration } from "../src/core/duration.js";
import { captureCss, emulationKey, isPassthrough } from "../src/core/emulation.js";
import { pathSlug, renderFilename, slugify } from "../src/core/filename.js";
import {
  DEFAULT_SETTINGS,
  SETTINGS,
  VIEWPORT_PRESETS,
  cycle,
  diffSettings,
  flagName,
  mergeSettings,
  normalizeSettings,
  parseDpr,
  parseViewport,
  saveMode,
  withSaveMode,
} from "../src/core/settings.js";
import { workspace } from "../src/core/workspace.js";

const collect = () => {
  const warnings: string[] = [];
  return { warnings, warn: (m: string) => warnings.push(m) };
};

describe("settings registry", () => {
  it("defines every setting once, with a flag that matches its YAML key", () => {
    expect(SETTINGS.map((d) => d.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(flagName("lazyLoad")).toBe("lazy-load");
    expect(flagName("htmlRemoveUnusedCss")).toBe("html-remove-unused-css");
  });

  it("uses each screen key once", () => {
    const keys = SETTINGS.flatMap((d) => [d.key1, d.keyType]).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lists every setting in `help settings`", () => {
    const text = settingsTopic();
    for (const d of SETTINGS) expect(text).toContain(` ${d.key} `);
  });

  it("parses viewports and DPR", () => {
    expect(parseViewport("1440x900")).toEqual({ width: 1440, height: 900 });
    expect(parseViewport("390×844m")).toEqual({ width: 390, height: 844, mobile: true });
    expect(parseViewport("as-is")).toBe("as-is");
    expect(() => parseViewport("wide")).toThrow();
    expect(parseDpr("2x")).toBe(2);
    expect(() => parseDpr("0")).toThrow();
  });

  it("cycles structurally and wraps", () => {
    expect(cycle(VIEWPORT_PRESETS, "as-is")).toEqual({ width: 1440, height: 900 });
    expect(cycle(VIEWPORT_PRESETS, VIEWPORT_PRESETS.at(-1)!)).toBe("as-is");
  });

  it("maps the Save field to image/html", () => {
    expect(saveMode(withSaveMode(DEFAULT_SETTINGS, "html"))).toBe("html");
    expect(withSaveMode(DEFAULT_SETTINGS, "image")).toMatchObject({ image: true, html: false });
  });
});

describe("reading settings from YAML", () => {
  it("accepts values as YAML writes them", () => {
    const { warn, warnings } = collect();
    expect(
      normalizeSettings({ viewport: "390x844m", dpr: 2, delay: "2s", hide: ".a, .b", lazyLoad: true, format: "WEBP" }, "t", warn),
    ).toEqual({ viewport: { width: 390, height: 844, mobile: true }, dpr: 2, delay: 2000, hide: [".a", ".b"], lazyLoad: true, format: "webp" });
    expect(normalizeSettings({ viewport: { width: 800, height: 600 } }, "t", warn).viewport).toEqual({ width: 800, height: 600 });
    expect(warnings).toEqual([]);
  });

  it("takes pre-0.4 names with a warning", () => {
    const { warn, warnings } = collect();
    const p = normalizeSettings(
      { loadLazy: true, hideSelectors: [".x"], waitMs: 300, outDir: "o", htmlOptions: { keepScripts: true, maxResourceSizeMB: 2 } },
      "config.yaml",
      warn,
    );
    expect(p).toEqual({ lazyLoad: true, hide: [".x"], delay: 300, out: "o", htmlScripts: true, htmlMaxResourceMb: 2 });
    expect(warnings).toContain('config.yaml: "loadLazy" is now "lazyLoad" (the old name works until v0.5)');
    expect(warnings).toHaveLength(5 + 1);
  });

  it("reports unknown keys and rejects bad values with their location", () => {
    const { warn, warnings } = collect();
    expect(normalizeSettings({ zoom: 2 }, "list.pages.yaml settings", warn)).toEqual({});
    expect(warnings[0]).toMatch(/unknown setting "zoom"/);
    expect(() => normalizeSettings({ theme: "sepia" }, "list.pages.yaml settings", warn)).toThrow(
      /list\.pages\.yaml settings: theme: expected one of as-is, light, dark/,
    );
  });

  it("parses durations", () => {
    expect(parseDuration(500)).toBe(500);
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("1.5s")).toBe(1500);
    expect(() => parseDuration("soon")).toThrow();
  });
});

describe("resolution order", () => {
  const config = {
    defaults: { format: "webp" as const, dpr: 2 },
    presets: { mobile: { viewport: { width: 390, height: 844, mobile: true }, dpr: 3 }, dark: { theme: "dark" as const } },
  };

  it("applies defaults → config → presets → layers, later wins", () => {
    const s = resolveSettings(config, ["mobile", "dark"], { dpr: 1 });
    expect(s).toMatchObject({ format: "webp", theme: "dark", dpr: 1, viewport: { width: 390 } });
    expect(resolveSettings(config, [])).toMatchObject({ format: "webp", dpr: 2, theme: "as-is" });
  });

  it("names unknown presets", () => {
    expect(() => resolveSettings(config, ["nope"])).toThrow(/Unknown preset "nope". Known: mobile, dark/);
    expect(presetNames("a, b")).toEqual(["a", "b"]);
  });

  it("never hands out the defaults object itself", () => {
    const s = mergeSettings(DEFAULT_SETTINGS);
    s.out = "elsewhere";
    s.hide.push(".x");
    expect(DEFAULT_SETTINGS.out).toBe("pagestill-out");
    expect(DEFAULT_SETTINGS.hide).toEqual([]);
  });

  it("choosing an element captures it", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { element: "#chart" }).area).toBe("element");
    expect(mergeSettings(DEFAULT_SETTINGS, { element: "#chart", area: "full" }).area).toBe("full");
  });

  it("keeps diffs small", () => {
    expect(diffSettings(mergeSettings(DEFAULT_SETTINGS, { theme: "dark" }))).toEqual({ theme: "dark" });
  });
});

describe("flags", () => {
  it("turns given flags into settings and leaves the rest alone", () => {
    expect(settingsFromFlags({ viewport: "390x844m", lazyLoad: true, image: false, hide: [".a"], quality: "80" })).toEqual({
      viewport: { width: 390, height: 844, mobile: true },
      lazyLoad: true,
      image: false,
      hide: [".a"],
      quality: 80,
    });
    expect(settingsFromFlags({})).toEqual({});
  });

  it("accepts pre-0.4 flags", () => {
    expect(settingsFromFlags({ wait: "500", selector: "#x", lazy: true })).toEqual({ delay: 500, element: "#x", lazyLoad: true });
  });

  it("explains bad values with the flag name", () => {
    expect(() => settingsFromFlags({ format: "gif" })).toThrow(/--format: expected one of png, jpeg, webp/);
  });
});

describe("config file", () => {
  it("reads defaults, presets and browser, and maps old browser keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "pagestill-config-"));
    const path = join(dir, "config.yaml");
    writeFileSync(path, "defaults:\n  format: webp\npresets:\n  m: { viewport: 390x844m }\nbrowser:\n  chromePath: /x/chrome\nsettings:\n  dpr: 3\n");
    const { warn, warnings } = collect();
    const c = loadConfig(path, warn);
    expect(c.defaults).toEqual({ format: "webp" });
    expect(c.presets?.m?.viewport).toEqual({ width: 390, height: 844, mobile: true });
    expect(c.browser?.chrome).toBe("/x/chrome");
    expect(warnings.join("\n")).toMatch(/chromePath/);
    // `settings:` (the pre-0.4 last session) is not a default for shot/run
    expect(resolveSettings(c, []).dpr).toBe("as-is");
  });
});

describe("workspace", () => {
  it("keeps shots, lists and runs in one folder", () => {
    const w = workspace("/tmp/ws");
    expect([w.shots, w.lists, w.runs]).toEqual(["/tmp/ws/shots", "/tmp/ws/lists", "/tmp/ws/runs"]);
  });
});

describe("filename", () => {
  const date = new Date(2026, 9, 5, 9, 3, 7);

  it("renders the default template", () => {
    expect(renderFilename(DEFAULT_SETTINGS.name, { url: "https://admin.acme.com/users/42?tab=1", title: "Users", date })).toBe(
      "20261005-090307_admin-acme-com_users-42",
    );
  });

  it("supports subfolders and size variables", () => {
    expect(renderFilename("{host}/{slug}@{w}x{h}", { url: "https://a.b/", title: "", date, width: 1440, height: 900 })).toBe(
      "a-b/index@1440x900",
    );
  });

  it("keeps non-ASCII letters", () => {
    expect(slugify("대시보드 · 설정")).toBe("대시보드-·-설정");
    expect(pathSlug("https://x.kr/%EC%84%A4%EC%A0%95")).toBe("설정");
  });
});

describe("emulation", () => {
  it("is passthrough by default", () => {
    expect(isPassthrough(DEFAULT_SETTINGS)).toBe(true);
    expect(isPassthrough({ ...DEFAULT_SETTINGS, theme: "dark" })).toBe(false);
    expect(emulationKey(DEFAULT_SETTINGS)).not.toBe(emulationKey({ ...DEFAULT_SETTINGS, dpr: 2 }));
  });

  it("builds capture CSS", () => {
    expect(captureCss({ hide: [" .a ", ""], freezeAnimations: false, hideScrollbars: false })).toBe(".a{visibility:hidden!important}");
    expect(captureCss({ hide: [], freezeAnimations: false, hideScrollbars: false })).toBe("");
  });
});
