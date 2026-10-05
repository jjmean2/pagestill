import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { CaptureSettings } from "../core/settings.js";
import { FIELDS, type Field } from "./fields.js";

export interface SettingsViewProps {
  settings: CaptureSettings;
  onChange: (s: CaptureSettings) => void;
  onEdit: (field: Field) => void;
  onDone: () => void;
}

export function SettingsView({ settings, onChange, onEdit, onDone }: SettingsViewProps) {
  const [cursor, setCursor] = useState(0);
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

  let lastGroup = "";
  return (
    <Box flexDirection="column">
      <Text bold>Settings</Text>
      {FIELDS.map((f, i) => {
        const header = f.group !== lastGroup ? f.group : undefined;
        lastGroup = f.group;
        return (
          <Box key={f.label} flexDirection="column">
            {header && <Text color="cyan">{header}</Text>}
            <Text inverse={i === cursor} wrap="truncate-end">
              {"  "}
              {f.label.padEnd(24)}
              {f.show(settings)}
              {f.hotkey ? <Text dimColor>{`  [${f.hotkey}]`}</Text> : null}
            </Text>
          </Box>
        );
      })}
      <Text dimColor>
        ↑↓ move · ←→/space change{field.edit ? " · ⏎ edit" : ""} · esc back
      </Text>
    </Box>
  );
}
