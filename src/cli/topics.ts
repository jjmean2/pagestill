/**
 * `pagestill help <topic>`. The settings table is generated from the settings registry so it
 * can't drift from what the code accepts.
 */
import { CONFIG_PATH } from "../core/config.js";
import { DEFAULT_SETTINGS, SETTINGS, SETTING_GROUPS, type SettingDef, flagName, toYamlSettings } from "../core/settings.js";

function flagColumn(d: SettingDef): string {
  const f = flagName(d.key);
  if (!d.arg) return `--[no-]${f}`;
  const short = d.key === "out" ? "-o, " : "";
  return `${short}--${f} <${d.key === "hide" ? "css..." : d.arg}>`;
}

function defaultColumn(d: SettingDef): string {
  const v = toYamlSettings({ [d.key]: DEFAULT_SETTINGS[d.key] })[d.key];
  if (Array.isArray(v)) return v.length ? v.join(", ") : "[]";
  if (v === "") return '""';
  return String(v);
}

export function settingsTopic(): string {
  const rows: string[][] = [];
  for (const g of SETTING_GROUPS) {
    rows.push([g]);
    for (const d of SETTINGS.filter((s) => s.group === g)) {
      const keys = [d.key1, d.keyType].filter(Boolean).join(" ");
      rows.push([`  ${flagColumn(d)}`, d.key, defaultColumn(d), keys]);
    }
  }
  const w = [0, 1, 2].map((i) => Math.max(...rows.filter((r) => r.length > 1).map((r) => r[i]!.length)));
  const table = rows
    .map((r) => (r.length === 1 ? r[0] : `${r[0]!.padEnd(w[0]! + 2)}${r[1]!.padEnd(w[1]! + 2)}${r[2]!.padEnd(w[2]! + 2)}${r[3]}`.trimEnd()))
    .join("\n");
  const header = `${"  FLAG".padEnd(w[0]! + 2)}${"YAML KEY".padEnd(w[1]! + 2)}${"DEFAULT".padEnd(w[2]! + 2)}SCREEN KEY`;
  return `Settings decide how a page is captured. Every setting can be given as a flag,
in config.yaml (defaults: / presets:), in a page list (settings:), or changed in
the interactive screen (e).

Later sources win:
  built-in → config defaults → presets → list settings → page settings
  → matrix → flags

${header}
${table}

  SCREEN KEY: lowercase cycles values, uppercase types a value. Settings without
  a key are changed in the full settings view (e). "Save" (o) sets image + html.

  --name variables: {date} {time} {host} {slug} {title} {w} {h} {dpr}; "/" makes folders
  Durations accept 500, 500ms or 2s.

Presets:
  -p, --preset <a,b>    apply saved presets in order (later wins)
  Saved in ${CONFIG_PATH}:
    defaults:
      format: webp
    presets:
      mobile-dark: { viewport: 390x844m, dpr: 3, theme: dark }
`;
}

export const LISTS_TOPIC = `A page list (*.pages.yaml) says what to capture. Make one with
\`pagestill crawl\`, with Record (r) in the interactive screen, or by hand.
Only \`pages:\` is required.

  base: https://admin.acme.com/
  pages:
    - /dashboard
    - /users

Everything else is optional:

  name: admin-review           # run folder name (default: file name)
  base: https://admin.acme.com/
  preset: retina               # presets applied first (a list or "a,b")
  settings:                    # any setting (pagestill help settings)
    hide: [".cookie-banner"]
  matrix:                      # every page × every combination
    viewport: [1440x900, 390x844m]
    theme: [light, dark]
    dpr: [1, 2]
  load:                        # how to wait after opening a page
    until: networkidle         # load | domcontentloaded | networkidle
    waitFor: "main"            # CSS selector that must be visible
    timeout: 30s
  login: /sso/                 # URLs that mean "logged out" (text or /regex/)
  concurrency: 2               # windows in parallel
  reload: false                # reload for every matrix combination
  pages:
    - /dashboard
    - url: /reports?range=30d
      name: reports-30d        # folder name (default: from the URL)
      load: { waitFor: ".chart canvas" }
      settings: { area: viewport }
      steps:                   # run after loading, before capturing
        - click: "button[aria-controls=billing]"
        - type: { into: "#q", text: "hello" }
        - press: Escape
        - hover: ".menu"
        - waitFor: "#billing-panel"
        - wait: 300ms
        - scroll: bottom       # top | bottom | CSS selector
        - eval: "document.body.classList.add('print')"
    - url: /legacy
      skip: true               # keep in the list, don't capture

A flag given to \`run\` wins over the list and replaces the matching matrix axis
(\`run list --theme dark\` captures dark only).

Comments written by crawl/record (titles, "/users/:id — 480 URLs found",
"reached in-page") are notes only.
`;

export { keysTopic } from "../tui/keys.js";
