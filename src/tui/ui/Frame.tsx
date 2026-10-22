import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { KeyHint } from "../keys.js";
import { sw, truncEnd } from "./text.js";

export const NO_COLOR = !!process.env.NO_COLOR || process.env.TERM === "dumb";

/**
 * A box with its title in the top border: ╭─ Title ───── right ─╮
 * Ink's Box can't put text in a border, so the top line is drawn here and the box draws
 * the other three sides. `height` is the total height including both borders.
 */
export function Panel({
  title,
  right,
  width,
  height,
  grow,
  accent,
  children,
}: {
  title: string;
  right?: string;
  width: number;
  height?: number;
  grow?: boolean;
  /** Color of the title and border (e.g. red while recording). */
  accent?: string;
  children: ReactNode;
}) {
  const border = accent ?? "gray";
  // ╭─ ␣title␣ ─…─ ␣right␣─ ╮
  const maxTitle = Math.max(4, width - 8);
  const t = truncEnd(title, maxTitle);
  const r = right ? truncEnd(right, Math.max(0, width - 9 - sw(t))) : "";
  const fill = Math.max(1, width - 5 - sw(t) - (r ? sw(r) + 3 : 0));
  return (
    <Box flexDirection="column" width={width} height={height} flexGrow={grow ? 1 : 0} flexShrink={0}>
      <Text wrap="truncate-end">
        <Text color={border}>╭─ </Text>
        <Text bold color={accent}>
          {t}
        </Text>
        <Text color={border}> {"─".repeat(fill)}</Text>
        {r ? (
          <>
            <Text dimColor> {r}</Text>
            <Text color={border}> ─</Text>
          </>
        ) : null}
        <Text color={border}>╮</Text>
      </Text>
      <Box
        borderStyle="round"
        borderTop={false}
        borderColor={border}
        paddingX={1}
        flexDirection="column"
        width={width}
        flexGrow={1}
        overflow="hidden"
      >
        {children}
      </Box>
    </Box>
  );
}

/** One line split into a left part and a right-aligned part. */
export function Line({ left, right, width }: { left: ReactNode; right?: ReactNode; width: number }) {
  return (
    <Box width={width}>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">{left}</Text>
      </Box>
      {right ? (
        <Box flexShrink={0} marginLeft={1}>
          <Text wrap="truncate-end">{right}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export interface Segment {
  text: string;
  color?: string;
}

/** The top line: app state and page on the left; badges and help on the right. Inverted unless NO_COLOR. */
export function AppBar({ width, left, right }: { width: number; left: Segment[]; right: Segment[] }) {
  const lw = left.reduce((n, s) => n + sw(s.text), 0);
  const rw = right.reduce((n, s) => n + sw(s.text), 0);
  const gap = Math.max(1, width - lw - rw);
  const seg = (s: Segment, i: number) => (
    <Text key={i} inverse={!NO_COLOR} bold color={s.color}>
      {s.text}
    </Text>
  );
  return (
    <Text wrap="truncate-end">
      {left.map(seg)}
      <Text inverse={!NO_COLOR}>{" ".repeat(gap)}</Text>
      {right.map(seg)}
    </Text>
  );
}

/** The bottom line: the keys that work on this screen, plus a short-lived hint. */
export function KeyBar({ keys, hint, width }: { keys: KeyHint[]; hint?: string; width: number }) {
  // Show as many as fit; the rest are one "?" away.
  const room = width - (hint ? sw(hint) + 2 : 0) - 8;
  const shown: KeyHint[] = [];
  let used = 0;
  for (const k of keys) {
    const w = sw(k.key) + sw(k.label) + 3;
    if (used + w > room) {
      shown.push({ key: "?", label: "more" });
      break;
    }
    shown.push(k);
    used += w;
  }
  return (
    <Line
      width={width}
      left={shown.map((k, i) => (
        <Text key={i}>
          {" "}
          <Text color="cyan" bold>
            {k.key}
          </Text>
          <Text dimColor> {k.label} </Text>
        </Text>
      ))}
      right={hint ? <Text color="yellow">{hint} </Text> : undefined}
    />
  );
}
