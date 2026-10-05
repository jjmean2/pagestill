import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { CaptureSettings } from "../core/settings.js";

export interface PresetsViewProps {
  presets: Record<string, Partial<CaptureSettings>>;
  onLoad: (name: string) => void;
  onSaveAs: () => void;
  onDelete: (name: string) => void;
  onDone: () => void;
}

export function PresetsView({ presets, onLoad, onSaveAs, onDelete, onDone }: PresetsViewProps) {
  const names = Object.keys(presets).sort();
  const [cursor, setCursor] = useState(0);
  const [confirm, setConfirm] = useState<string>();
  const current = names[Math.min(cursor, names.length - 1)];
  useInput((input, key) => {
    if (confirm) {
      if (input === "y") onDelete(confirm);
      setConfirm(undefined);
      return;
    }
    if (key.escape || input === "p" || input === "q") return onDone();
    if (input === "n" || input === "s") return onSaveAs();
    if (!names.length) return;
    if (key.upArrow || input === "k") setCursor((c) => (c - 1 + names.length) % names.length);
    if (key.downArrow || input === "j") setCursor((c) => (c + 1) % names.length);
    if (key.return && current) onLoad(current);
    if (input === "d" && current) setConfirm(current);
  });
  return (
    <Box flexDirection="column">
      <Text bold>Presets</Text>
      {names.length === 0 && <Text dimColor>  No presets yet. Press n to save the current settings as one.</Text>}
      {names.map((name) => (
        <Text key={name} inverse={name === current} wrap="truncate-end">
          {"  "}
          {name.padEnd(18)}
          <Text dimColor>{summarize(presets[name]!)}</Text>
        </Text>
      ))}
      {confirm ? (
        <Text color="yellow">Delete preset "{confirm}"? y/n</Text>
      ) : (
        <Text dimColor>↑↓ move · ⏎ load · n save current as… · d delete · esc back</Text>
      )}
    </Box>
  );
}

function summarize(p: Partial<CaptureSettings>): string {
  return Object.entries(p)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
}
