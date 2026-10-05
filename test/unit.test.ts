import { describe, expect, it } from "vitest";
import { captureCss, emulationKey, isPassthrough } from "../src/core/emulation.js";
import { pathSlug, renderFilename, slugify } from "../src/core/filename.js";
import {
  DEFAULT_SETTINGS,
  VIEWPORT_PRESETS,
  cycle,
  mergeSettings,
  outputMode,
  parseDpr,
  parseViewport,
  withOutputMode,
} from "../src/core/settings.js";

describe("settings", () => {
  it("parses viewports", () => {
    expect(parseViewport("1440x900")).toEqual({ width: 1440, height: 900 });
    expect(parseViewport("390×844m")).toEqual({ width: 390, height: 844, mobile: true });
    expect(parseViewport("as-is")).toBe("as-is");
    expect(() => parseViewport("wide")).toThrow();
  });

  it("parses DPR", () => {
    expect(parseDpr("2x")).toBe(2);
    expect(parseDpr("as-is")).toBe("as-is");
    expect(() => parseDpr("0")).toThrow();
  });

  it("cycles structurally and wraps", () => {
    expect(cycle(VIEWPORT_PRESETS, "as-is")).toEqual({ width: 1440, height: 900 });
    expect(cycle(VIEWPORT_PRESETS, { width: 1440, height: 900 })).toEqual({ width: 1920, height: 1080 });
    expect(cycle(VIEWPORT_PRESETS, VIEWPORT_PRESETS.at(-1)!)).toBe("as-is");
  });

  it("maps output modes", () => {
    expect(outputMode(withOutputMode(DEFAULT_SETTINGS, "html"))).toBe("html");
    expect(withOutputMode(DEFAULT_SETTINGS, "image")).toMatchObject({ image: true, html: false });
  });

  it("deep-merges html options", () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { htmlOptions: { keepScripts: true } as never });
    expect(s.htmlOptions.keepScripts).toBe(true);
    expect(s.htmlOptions.archiver).toBe("singlefile");
  });
});

describe("filename", () => {
  const date = new Date(2026, 9, 5, 9, 3, 7);

  it("renders the default template", () => {
    expect(renderFilename(DEFAULT_SETTINGS.filename, { url: "https://admin.acme.com/users/42?tab=1", title: "Users", date })).toBe(
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
    const css = captureCss({ hideSelectors: [" .a ", ""], freezeAnimations: false, hideScrollbars: false });
    expect(css).toBe(".a{visibility:hidden!important}");
    expect(captureCss({ hideSelectors: [], freezeAnimations: false, hideScrollbars: false })).toBe("");
  });
});
