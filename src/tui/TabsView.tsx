import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { BrowserSession } from "../core/session.js";

export function TabsView({ session, onDone }: { session: BrowserSession; onDone: () => void }) {
  const tabs = session.listTabs();
  const [cursor, setCursor] = useState(Math.max(0, tabs.findIndex((t) => t.page === session.active)));
  useInput((input, key) => {
    if (key.escape || input === "t" || input === "q") return onDone();
    if (key.upArrow || input === "k") setCursor((c) => (c - 1 + tabs.length) % tabs.length);
    if (key.downArrow || input === "j") setCursor((c) => (c + 1) % tabs.length);
    if (key.return && tabs[cursor]) {
      session.pin(tabs[cursor].page);
      onDone();
    }
    if (input === "a") {
      session.pin(undefined);
      onDone();
    }
  });
  return (
    <Box flexDirection="column">
      <Text bold>Choose tab {session.follow ? <Text color="green">(following focus)</Text> : <Text color="yellow">(pinned)</Text>}</Text>
      {tabs.map((t, i) => (
        <Box key={i} flexDirection="column">
          <Text inverse={i === cursor} wrap="truncate-end">
            {t.page === session.active ? "★" : " "} {t.title || "(untitled)"}
          </Text>
          <Text dimColor wrap="truncate-end">
            {"   "}
            {t.url}
          </Text>
        </Box>
      ))}
      <Text dimColor>↑↓ move · ⏎ pin this tab · a follow browser focus · esc back</Text>
    </Box>
  );
}
