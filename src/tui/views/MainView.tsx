import { Box, Text, useAnimation } from "ink";
import type { CaptureSettings } from "../../core/settings.js";
import { type Field, FIELDS } from "../fields.js";
import { type LogEntry, MARK } from "../log.js";
import { Line, Panel } from "../ui/Frame.js";
import { formatTime, padTo, sw, truncEnd, truncMiddle, wrapCells } from "../ui/text.js";

/** The settings shown on the main screen, in two columns. */
const LEFT = ["save", "viewport", "dpr", "theme"];
const RIGHT = ["delay", "hide", "lazyLoad", "area", "format"];
const byId = (id: string) => FIELDS.find((f) => f.id === id)!;

/** Which settings each main-screen field stands for (for the "changed" dot). */
const KEYS_OF: Record<string, (keyof CaptureSettings)[]> = {
  save: ["image", "html"],
  area: ["area", "element"],
  format: ["format", "quality"],
};

export function changed(f: Field, s: CaptureSettings, base: CaptureSettings): boolean {
  const keys = KEYS_OF[f.id] ?? [f.id as keyof CaptureSettings];
  return keys.some((k) => JSON.stringify(s[k]) !== JSON.stringify(base[k]));
}

/** Main-screen value: area shows the element, format shows the quality when it matters. */
export function mainShow(f: Field, s: CaptureSettings): string {
  if (f.id === "area" && s.area === "element") return `element ${s.element || "(none: A)"}`;
  if (f.id === "format" && s.format !== "png") return `${s.format} q${s.quality}`;
  return f.show(s);
}

export interface RecordedPage {
  url: string;
  path: string;
  title: string;
  inPage?: boolean;
}

export interface Busy {
  label: string;
  started: number;
}

export interface MainLayout {
  wide: boolean;
  twoColumns: boolean;
  /** Title and URL on one line (very short terminals). */
  tabOneLine: boolean;
  tabH: number;
  showEmulation: boolean;
  settingsH: number;
  outputH: number;
  recLines: number;
  logH: number;
}

/** Heights of every panel for the available space; shrinks Log, then Recording, Output, the emulation line. */
export function mainLayout(width: number, height: number, o: { emulating: boolean; recording: boolean; recCount: number }): MainLayout {
  const wide = width >= 100;
  // two columns fit down to the 60-column minimum; one column would need 9 rows
  const twoColumns = width >= 60;
  const settingsH = (twoColumns ? Math.max(LEFT.length, RIGHT.length) : LEFT.length + RIGHT.length) + 2;
  let showEmulation = o.emulating;
  let outputH = wide ? settingsH : 3;
  let recLines = o.recording ? Math.max(1, Math.min(3, o.recCount)) : 0;
  let tabOneLine = false;
  const total = () => {
    const tabH = (tabOneLine ? 1 : 2) + (showEmulation ? 1 : 0) + 2;
    const rec = o.recording ? recLines + 2 : 0;
    return { tabH, used: tabH + (wide ? settingsH : settingsH + outputH) + rec };
  };
  const MIN_LOG = 5;
  if (height - total().used < MIN_LOG && recLines > 1) recLines = 1;
  if (height - total().used < MIN_LOG && !wide) outputH = 3;
  if (height - total().used < MIN_LOG) showEmulation = false;
  if (height - total().used < 3) tabOneLine = true;
  const { tabH, used } = total();
  return { wide, twoColumns, tabOneLine, tabH, showEmulation, settingsH, outputH, recLines, logH: Math.max(3, height - used) };
}

export interface MainViewProps {
  width: number;
  height: number;
  layout: MainLayout;
  tab?: { title: string; url: string; follow: boolean };
  emulation?: string;
  settings: CaptureSettings;
  base: CaptureSettings;
  preset?: string;
  output: { dir: string; next: string; count: number; bytes: number };
  recording: boolean;
  recorded: RecordedPage[];
  log: LogEntry[];
  totalLog: number;
  busy?: Busy;
}

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)}MB`;
}

export function MainView(p: MainViewProps) {
  const { width, layout: L } = p;
  // 66: room for the longest common value ("390×844 mobile") in each column
  const settingsW = L.wide ? 66 : width;
  const outputW = L.wide ? width - settingsW : width;
  const changedCount = FIELDS.filter((f) => changed(f, p.settings, p.base)).length;
  const presetRight = [p.preset, changedCount ? `${changedCount} changed` : undefined].filter(Boolean).join(" · ") || undefined;

  const cell = (id: string, w: number) => {
    const f = byId(id);
    const dot = changed(f, p.settings, p.base);
    const key = f.key1 ?? f.keyType ?? " ";
    const value = truncEnd(mainShow(f, p.settings), Math.max(4, w - 17));
    return (
      <Text key={id}>
        {padTo(f.label, 10)}
        <Text color="cyan">[{key}]</Text> <Text bold>{value}</Text>
        <Text color="yellow">{dot ? " •" : "  "}</Text>
        {/* label 10 + "[k] " 4 + value + dot 2 = the column width */}
        {" ".repeat(Math.max(1, w - 16 - sw(value)))}
      </Text>
    );
  };
  const inner = settingsW - 4;
  const colW = L.twoColumns ? Math.floor(inner / 2) : inner;
  const settingRows = L.twoColumns
    ? Array.from({ length: Math.max(LEFT.length, RIGHT.length) }, (_, i) => (
        <Text key={i} wrap="truncate-end">
          {LEFT[i] ? cell(LEFT[i]!, colW) : " ".repeat(colW)}
          {RIGHT[i] ? cell(RIGHT[i]!, colW) : null}
        </Text>
      ))
    : [...LEFT, ...RIGHT].map((id) => (
        <Text key={id} wrap="truncate-end">
          {cell(id, colW)}
        </Text>
      ));

  const outInner = outputW - 4;
  const outputBody = L.wide ? (
    <>
      <Text wrap="truncate-end">{truncMiddle(p.output.dir, outInner)}</Text>
      {wrapCells(p.output.next, outInner - 5, 2).map((l, i) => (
        <Text key={i} wrap="truncate-end">
          <Text dimColor>{i === 0 ? "next " : "     "}</Text>
          {l}
        </Text>
      ))}
      {wrapCells(p.output.next, outInner - 5, 2).length < 2 ? <Text> </Text> : null}
      <Line
        width={outInner}
        left={<Text dimColor>{p.output.count ? `${p.output.count} saved · ${bytes(p.output.bytes)}` : "nothing saved yet"}</Text>}
        right={
          <Text>
            <Text color="cyan">[g]</Text> open
          </Text>
        }
      />
    </>
  ) : (
    <Line
      width={outInner}
      left={
        <Text>
          {truncMiddle(p.output.dir, Math.floor(outInner * 0.45))}
          <Text dimColor> · next </Text>
          {truncMiddle(p.output.next, Math.floor(outInner * 0.45))}
        </Text>
      }
      right={
        <Text>
          <Text color="cyan">[g]</Text> open
        </Text>
      }
    />
  );

  const logLines = Math.max(1, L.logH - 2);
  const fit = p.busy ? logLines - 1 : logLines;
  const tail = fit > 0 ? p.log.slice(-fit) : [];

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="Tab" right={p.tab ? (p.tab.follow ? "following" : "pinned") : undefined} width={width} height={L.tabH}>
        {p.tab ? (
          <>
            <Text bold wrap="truncate-end">
              {p.tab.title || "(untitled)"}
              {L.tabOneLine ? <Text dimColor> · {p.tab.url}</Text> : null}
            </Text>
            {L.tabOneLine ? null : (
              <Text dimColor wrap="truncate-end">
                {p.tab.url}
              </Text>
            )}
            {L.showEmulation && p.emulation ? (
              <Line
                width={width - 4}
                left={<Text color="yellow">! Chrome shows {p.emulation} (applied live)</Text>}
                right={
                  <Text>
                    <Text color="cyan">R</Text> reset
                  </Text>
                }
              />
            ) : null}
          </>
        ) : (
          <>
            <Text color="yellow">No tab.</Text>
            <Text dimColor>Open a page in the pagestill Chrome window.</Text>
          </>
        )}
      </Panel>
      <Box>
        <Panel title="Capture settings" right={presetRight} width={settingsW} height={L.settingsH}>
          {settingRows}
        </Panel>
        {L.wide ? (
          <Panel title="Output" width={outputW} height={L.settingsH}>
            {outputBody}
          </Panel>
        ) : null}
      </Box>
      {!L.wide ? (
        <Panel title="Output" width={width} height={L.outputH}>
          {outputBody}
        </Panel>
      ) : null}
      {p.recording ? (
        <Panel title="Recording" right={`● ${p.recorded.length} page${p.recorded.length === 1 ? "" : "s"} · r stop and save`} width={width} height={L.recLines + 2} accent="red">
          {p.recorded.slice(-L.recLines).map((r, i, arr) => (
            <Text key={r.url} wrap="truncate-end">
              <Text dimColor>{String(p.recorded.length - arr.length + i + 1).padStart(2)} </Text>
              {padTo(r.path, Math.min(32, Math.floor((width - 10) / 2)))} <Text dimColor>{r.title}</Text>
              {r.inPage ? <Text color="yellow"> · reached in-page</Text> : null}
            </Text>
          ))}
        </Panel>
      ) : null}
      <Panel title="Log" right={p.totalLog ? `${p.totalLog} entries · l full log` : "l full log"} width={width} height={L.logH}>
        {tail.length === 0 && !p.busy ? <Text dimColor>Nothing yet. Press ⏎ to capture this tab.</Text> : null}
        {tail.map((e) => (
          <LogLine key={e.id} entry={e} width={width - 4} />
        ))}
        {p.busy ? <BusyLine busy={p.busy} width={width - 4} /> : null}
      </Panel>
    </Box>
  );
}

export function LogLine({ entry: e, width, selected }: { entry: LogEntry; width: number; selected?: boolean }) {
  const m = MARK[e.kind];
  return (
    <Line
      width={width}
      left={
        <Text inverse={selected}>
          {selected ? "▸ " : ""}
          <Text dimColor>{formatTime(e.time)} </Text>
          <Text color={m.color}>{m.symbol}</Text> {e.text}
        </Text>
      }
      right={e.right ? <Text dimColor>{e.right}</Text> : undefined}
    />
  );
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function BusyLine({ busy, width }: { busy: Busy; width: number }) {
  const { frame } = useAnimation({ interval: 80 });
  const secs = ((Date.now() - busy.started) / 1000).toFixed(1);
  return (
    <Line
      width={width}
      left={
        <Text color="yellow">
          <Text dimColor>{formatTime(new Date())} </Text>
          {FRAMES[frame % FRAMES.length]} {busy.label}…
        </Text>
      }
      right={<Text dimColor>{secs}s</Text>}
    />
  );
}
