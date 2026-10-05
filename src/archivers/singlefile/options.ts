import type { HtmlOptions } from "../../core/settings.js";

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
    blockScripts: !o.keepScripts,
    blockAudios: true,
    blockVideos: true,
    blockAlternativeImages: true,
    blockStylesheets: false,
    removeHiddenElements: o.removeHiddenElements,
    removeUnusedStyles: o.removeUnusedStyles,
    removeUnusedFonts: o.removeUnusedStyles,
    removeAlternativeFonts: true,
    removeAlternativeMedias: true,
    removeAlternativeImages: true,
    removeNoScriptTags: !o.keepScripts,
    removeFrames: !o.includeFrames,
    compressHTML: o.compressHTML,
    groupDuplicateImages: true,
    maxSizeDuplicateImages: 512 * 1024,
    maxResourceSizeEnabled: o.maxResourceSizeMB > 0,
    maxResourceSize: o.maxResourceSizeMB || 10,
    // the page is already loaded and possibly scrolled by the user: don't touch it
    loadDeferredContent: false,
    // output
    compressContent: false,
    selfExtractingArchive: false,
    insertCanonicalLink: true,
    insertMetaCSP: true,
    insertSingleFileComment: true,
    resolveLinks: true,
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
