import type { HtmlOptions } from "../types.js";

/**
 * Options passed to `singlefile.getPageData()`. Based on single-file-cli's defaults (v2.16),
 * minus the browser/CLI-only ones, with pagestill's choices layered on top:
 * plain HTML output (no self-extracting zip), no lazy-load scrolling (pagestill does that
 * itself, and only when asked, so the user's scroll position is left alone).
 */
export function toSingleFileOptions(o: HtmlOptions, url: string): Record<string, unknown> {
  return {
    url,
    // content processing
    blockScripts: !o.scripts,
    blockAudios: true,
    blockVideos: true,
    blockAlternativeImages: true,
    blockStylesheets: false,
    removeHiddenElements: o.removeHidden,
    removeUnusedStyles: o.removeUnusedCss,
    removeUnusedFonts: o.removeUnusedCss,
    removeAlternativeFonts: true,
    removeAlternativeMedias: true,
    removeAlternativeImages: true,
    removeNoScriptTags: !o.scripts,
    removeFrames: !o.frames,
    compressHTML: o.minify,
    groupDuplicateImages: true,
    maxSizeDuplicateImages: 512 * 1024,
    maxResourceSizeEnabled: o.maxResourceMb > 0,
    maxResourceSize: o.maxResourceMb || 10,
    // the page is already loaded and possibly scrolled by the user: don't touch it
    loadDeferredContent: false,
    // output
    compressContent: false,
    selfExtractingArchive: false,
    insertCanonicalLink: true,
    insertMetaCSP: true,
    insertSingleFileComment: true,
    // Keep href values as written: CSS attribute selectors must match exactly as they did live.
    resolveLinks: o.absoluteLinks,
    saveFavicon: true,
    userScriptEnabled: false,
    includeInfobar: false,
    acceptHeaders: {
      font: "application/font-woff2;q=1.0,application/font-woff;q=0.9,*/*;q=0.8",
      image: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      stylesheet: "text/css,*/*;q=0.1",
      script: "*/*",
      document: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    filenameTemplate: "{page-title}.html",
    filenameReplacementCharacter: "_",
    filenameMaxLength: 192,
    filenameMaxLengthUnit: "bytes",
  };
}
