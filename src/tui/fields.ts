/**
 * Settings as the interactive screen shows them. Generated from the settings registry, so labels
 * and keys match `pagestill help settings`; only "Save" (image + html in one field) is special.
 */
import { archiverIds } from "../archivers/index.js";
import {
  type CaptureSettings,
  SAVE_MODES,
  SETTINGS,
  type SettingDef,
  type SettingGroup,
  saveMode,
  viewportId,
  withSaveMode,
} from "../core/settings.js";

type S = CaptureSettings;

export interface Field {
  id: string;
  label: string;
  group: SettingGroup;
  show: (s: S) => string;
  /** Cycle/toggle; dir is +1 (→, space, key) or -1 (←). */
  step?: (s: S, dir: 1 | -1) => S;
  /** Free-form value typed in a prompt. */
  edit?: { hint: string; initial: (s: S) => string; apply: (s: S, text: string) => S };
  /** Main-screen key that cycles the value. */
  key1?: string;
  /** Main-screen key (uppercase) that types a value. */
  keyType?: string;
}

function rotate<T>(list: readonly T[], current: T, dir: 1 | -1): T {
  const key = JSON.stringify(current);
  const i = list.findIndex((v) => JSON.stringify(v) === key);
  const n = list.length;
  // Not in the list (a typed value): → goes to the first item, ← to the last.
  if (i === -1) return dir === 1 ? list[0]! : list[n - 1]!;
  return list[(i + dir + n) % n]!;
}

const SAVE_LABEL = { both: "image + HTML", image: "image", html: "HTML" } as const;

/** Text to prefill when typing a value. */
function typedForm(d: SettingDef, v: unknown): string {
  if (d.key === "viewport") return v === "as-is" ? "" : viewportId(v as S["viewport"]);
  if (d.key === "hide") return (v as string[]).join(", ");
  return String(v);
}

/** Enums are cycled, never typed. */
const CYCLE_ONLY = new Set(["theme", "area", "format", "htmlEngine"]);

function fromDef(d: SettingDef): Field {
  const get = (s: S) => s[d.key] as never;
  const set = (s: S, v: unknown): S => {
    const next = { ...s, [d.key]: v } as S;
    // Choosing an element means capturing it.
    if (d.key === "element" && v) next.area = "element";
    return next;
  };
  const field: Field = {
    id: d.key,
    label: d.label,
    group: d.group,
    show: (s) => d.show(get(s)),
    key1: d.key1,
    keyType: d.keyType,
  };
  const choices = d.key === "htmlEngine" ? archiverIds() : d.cycle;
  if (choices) field.step = (s, dir) => set(s, rotate(choices as readonly unknown[], get(s), dir));
  else if (!d.arg) field.step = (s) => set(s, !get(s));
  if (d.arg && !CYCLE_ONLY.has(d.key)) {
    field.edit = {
      hint: d.typeHint ?? d.description,
      initial: (s) => typedForm(d, get(s)),
      apply: (s, text) => set(s, d.normalize(text)),
    };
  }
  return field;
}

export const FIELDS: Field[] = [
  {
    id: "save",
    label: "Save",
    group: "Save",
    show: (s) => SAVE_LABEL[saveMode(s)],
    step: (s, dir) => withSaveMode(s, rotate(SAVE_MODES, saveMode(s), dir)),
    key1: "o",
  },
  ...SETTINGS.filter((d) => d.key !== "image" && d.key !== "html").map(fromDef),
];

/** Fields shown on the main screen, in screen order. */
export const MAIN_GROUPS: { title: string; group: SettingGroup }[] = [
  { title: "SAVE", group: "Save" },
  { title: "EMULATE", group: "Emulate" },
  { title: "PREPARE", group: "Prepare" },
  { title: "IMAGE", group: "Image" },
];

export function mainFields(group: SettingGroup): Field[] {
  return FIELDS.filter((f) => f.group === group && (f.key1 || f.keyType));
}

export function fieldForKey(input: string): { field: Field; typed: boolean } | undefined {
  const typed = FIELDS.find((f) => f.keyType === input);
  if (typed) return { field: typed, typed: true };
  const cycled = FIELDS.find((f) => f.key1 === input);
  return cycled ? { field: cycled, typed: false } : undefined;
}

/** A Shift+key whose setting has fixed choices: tell the user how to change it instead. */
export function fixedChoiceField(input: string): Field | undefined {
  if (input.length !== 1 || input === input.toLowerCase()) return undefined;
  return FIELDS.find((f) => f.key1 === input.toLowerCase() && !f.keyType);
}
