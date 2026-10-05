import { Box, Text, useInput } from "ink";
import { useState } from "react";

export interface PromptProps {
  label: string;
  initial?: string;
  hint?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Single-line text input: Enter submits, Esc cancels, Ctrl+U clears. */
export function Prompt({ label, initial = "", hint, onSubmit, onCancel }: PromptProps) {
  const [value, setValue] = useState(initial);
  useInput((input, key) => {
    if (key.return) return onSubmit(value);
    if (key.escape) return onCancel();
    if (key.backspace || key.delete) return setValue((v) => v.slice(0, -1));
    if (key.ctrl && input === "u") return setValue("");
    if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) return;
    if (input) setValue((v) => v + input.replace(/[\r\n]/g, ""));
  });
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">{label} </Text>
        {value}
        <Text inverse> </Text>
      </Text>
      <Text dimColor>{hint ? `${hint} · ` : ""}⏎ ok · esc cancel · ctrl+u clear</Text>
    </Box>
  );
}
