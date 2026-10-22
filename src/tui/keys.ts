/**
 * Key hints for every screen. The key bar at the bottom, the help page (?) and
 * `pagestill help keys` are all built from these lists, so what is shown matches what works.
 * Settings keys (v V, d D, ...) come from the settings registry.
 */
import { FIELDS } from "./fields.js";

export interface KeyHint {
  key: string;
  label: string;
}

export type ViewId = "main" | "settings" | "tabs" | "presets" | "log" | "save" | "help" | "disconnected";

export const MAIN_KEYS: KeyHint[] = [
  { key: "⏎", label: "capture" },
  { key: "e", label: "settings" },
  { key: "t", label: "tab" },
  { key: "p", label: "presets" },
  { key: "r", label: "record" },
  { key: "u", label: "auto" },
  { key: "l", label: "log" },
  { key: "g", label: "folder" },
];

/** Shown on the help page only (they don't fit the key bar). */
export const MAIN_MORE: KeyHint[] = [{ key: "R", label: "reset settings to your defaults" }];

export const VIEW_KEYS: Record<ViewId, KeyHint[]> = {
  main: MAIN_KEYS,
  settings: [
    { key: "↑↓", label: "move" },
    { key: "←→", label: "change" },
    { key: "⏎", label: "type a value" },
    { key: "⌫", label: "back to default" },
    { key: "/", label: "filter" },
    { key: "esc", label: "back" },
  ],
  tabs: [
    { key: "⏎", label: "pin this tab" },
    { key: "1-9", label: "jump" },
    { key: "a", label: "follow the tab in front" },
    { key: "/", label: "filter" },
    { key: "esc", label: "back" },
  ],
  presets: [
    { key: "⏎", label: "load" },
    { key: "n", label: "save current as…" },
    { key: "d", label: "delete" },
    { key: "esc", label: "back" },
  ],
  log: [
    { key: "↑↓", label: "move" },
    { key: "⏎", label: "open file" },
    { key: "f", label: "show in folder" },
    { key: "c", label: "copy path" },
    { key: "tab", label: "filter" },
    { key: "esc", label: "back" },
  ],
  save: [
    { key: "space", label: "tick" },
    { key: "a", label: "all/none" },
    { key: "tab", label: "switch box" },
    { key: "⏎", label: "save" },
    { key: "esc", label: "keep recording" },
  ],
  help: [{ key: "any key", label: "back" }],
  disconnected: [
    { key: "⏎", label: "reconnect" },
    { key: "q", label: "quit" },
  ],
};

export const GLOBAL_KEYS: KeyHint[] = [
  { key: "↑↓ j k", label: "move" },
  { key: "←→ h l", label: "change" },
  { key: "⏎", label: "select" },
  { key: "esc", label: "back" },
  { key: "/", label: "filter" },
  { key: "?", label: "help" },
  { key: "q", label: "quit" },
];

/** Main-screen setting keys, from the settings registry: "v V  Viewport". */
export function settingKeyHints(): KeyHint[] {
  return FIELDS.filter((f) => f.key1 || f.keyType).map((f) => ({
    key: [f.key1, f.keyType].filter(Boolean).join(" "),
    label: f.label,
  }));
}

/** Plain-text help, for `pagestill help keys`. */
export function keysTopic(): string {
  const rows = (hints: KeyHint[]) => hints.map((h) => `  ${h.key.padEnd(10)} ${h.label}`).join("\n");
  return `Interactive screen

${rows([...MAIN_KEYS.map((k) => ({ ...k, label: k.key === "⏎" ? "capture now" : k.label })), { key: "?", label: "help" }, { key: "q", label: "quit" }, ...MAIN_MORE])}

Settings on the main screen (lowercase cycles, uppercase types a value
or toggles a less frequent one)
${rows(settingKeyHints())}

In the browser
  Alt+Shift+S  capture the tab you're on

Everywhere
${rows(GLOBAL_KEYS)}
`;
}
