// Typings for the prebuilt SingleFile browser bundle shipped in single-file-cli (AGPL-3.0-or-later).
declare module "single-file-cli/lib/single-file-bundle.js" {
  /** Main SingleFile script; defines `var singlefile` in the world it is evaluated in. */
  export const script: string;
  /** Main-world hooks (fonts, shadow roots, ...) meant to run before page scripts. */
  export const hookScript: string;
  export const zipScript: string;
}
