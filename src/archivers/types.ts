import type { Page } from "puppeteer-core";
import type { CaptureSettings } from "../core/settings.js";

/** What every engine is asked for; derived from the html* settings. */
export interface HtmlOptions {
  /** Keep <script> elements. */
  scripts: boolean;
  /** Drop elements that are not rendered. */
  removeHidden: boolean;
  /** Drop CSS rules that match nothing in the current DOM. */
  removeUnusedCss: boolean;
  /** Serialize iframe contents (including cross-origin ones when reachable). */
  frames: boolean;
  minify: boolean;
  /** Rewrite relative hrefs to absolute URLs. */
  absoluteLinks: boolean;
  /** Resources above this size (MB) are left out. 0 = no limit. */
  maxResourceMb: number;
}

export function htmlOptionsOf(s: CaptureSettings): HtmlOptions {
  return {
    scripts: s.htmlScripts,
    removeHidden: s.htmlRemoveHidden,
    removeUnusedCss: s.htmlRemoveUnusedCss,
    frames: s.htmlFrames,
    minify: s.htmlMinify,
    absoluteLinks: s.htmlAbsoluteLinks,
    maxResourceMb: s.htmlMaxResourceMb,
  };
}

/**
 * An Archiver turns the *current* state of a live page into one self-contained HTML string.
 *
 * Contract:
 * - Must not reload or navigate the page; it serializes what is there right now.
 * - Must leave the page as it found it (no lasting DOM changes, no lingering injected scripts).
 * - Output must open from the filesystem with no network access.
 *
 * Implementations live in their own folder under src/archivers/ and are registered in
 * src/archivers/index.ts. Nothing outside that folder may import engine-specific code,
 * so an engine can be swapped by adding a folder and changing the default id.
 */
export interface Archiver {
  readonly id: string;
  readonly name: string;
  /** SPDX id of the engine, surfaced in `pagestill --version` / docs. */
  readonly license: string;

  /**
   * Optional early hook, run once per page when pagestill first sees it.
   * Lets an engine install hooks that must exist before page scripts run
   * (they only take effect on the page's next navigation).
   */
  prepare?(page: Page): Promise<void>;

  archive(page: Page, options: HtmlOptions, ctx: ArchiveContext): Promise<ArchiveResult>;
}

export interface ArchiveContext {
  signal?: AbortSignal;
  /** Progress/diagnostic messages for the UI. */
  log?: (message: string) => void;
}

export interface ArchiveResult {
  html: string;
  title?: string;
  warnings: string[];
}
