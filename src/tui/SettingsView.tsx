import { Box, Text, useInput, useWindowSize } from "ink";
import type { CaptureSettings } from "../core/settings.js";
import { FIELDS, type Field } from "./fields.js";

export interface SettingsViewProps {
  settings: CaptureSettings;
  onChange: (s: CaptureSettings) => void;
  onEdit: (field: Field) => void;
  onDone: () => void;
  /**
   * Selected row, owned by the parent: this view unmounts while a value is being typed in the
   * prompt, and the selection should still be there afterwards (and on the next visit).
   */
  cursor: number;
  setCursor: (update: (c: number) => number) => void;
}

type Row = { header: string } | { field: Field; index: number };

/** Rows taken by the screen around this view (title, tab, rules, status, footer). */
const CHROME_ROWS = 10;

export function SettingsView({ settings, onChange, onEdit, onDone, cursor, setCursor }: SettingsViewProps) {
  const { rows: termRows } = useWindowSize();
  const field = FIELDS[cursor]!;
  useInput((input, key) => {
    if (key.escape || input === "e" || input === "q") return onDone();
    if (key.upArrow || input === "k") setCursor((c) => (c - 1 + FIELDS.length) % FIELDS.length);
    if (key.downArrow || input === "j") setCursor((c) => (c + 1) % FIELDS.length);
    if ((key.rightArrow || input === " " || input === "l") && field.step) onChange(field.step(settings, 1));
    if ((key.leftArrow || input === "h") && field.step) onChange(field.step(settings, -1));
    if (key.return) {
      if (field.edit) onEdit(field);
      else if (field.step) onChange(field.step(settings, 1));
    }
  });

  const rows: Row[] = [];
  let lastGroup = "";
  FIELDS.forEach((f, index) => {
    if (f.group !== lastGroup) rows.push({ header: f.group });
    lastGroup = f.group;
    rows.push({ field: f, index });
  });
  // Scroll so the selection stays visible on short terminals.
  const visible = Math.max(6, (termRows || 24) - CHROME_ROWS - 2);
  const at = rows.findIndex((r) => "field" in r && r.index === cursor);
  const top = Math.min(Math.max(0, at - Math.floor(visible / 2)), Math.max(0, rows.length - visible));
  const keys = (f: Field) => [f.key1, f.keyType].filter(Boolean).join(" ");

  return (
    <Box flexDirection="column">
      <Text bold>
        Settings <Text dimColor>({cursor + 1}/{FIELDS.length})</Text>
      </Text>
      {rows.slice(top, top + visible).map((r, i) =>
        "header" in r ? (
          <Text key={`h${top + i}`} color="cyan">
            {r.header}
          </Text>
        ) : (
          <Text key={r.field.id} inverse={r.index === cursor} wrap="truncate-end">
            {"  "}
            {r.field.label.padEnd(20)}
            {r.field.show(settings)}
            {keys(r.field) ? <Text dimColor>{`  [${keys(r.field)}]`}</Text> : null}
          </Text>
        ),
      )}
      <Text dimColor>
        ↑↓ move · ←→/space change{field.edit ? " · ⏎ type a value" : ""} · esc back
      </Text>
    </Box>
  );
}
