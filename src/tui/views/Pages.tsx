/** The smaller pages: Tabs, Presets, Log, Save recording, Help, Disconnected, and the modals. */
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { BrowserSession } from "../../core/session.js";
import { type CaptureSettings, SETTING_BY_KEY, type SettingKey, type SettingsPatch, mergeSettings } from "../../core/settings.js";
import { GLOBAL_KEYS, type KeyHint, MAIN_KEYS, MAIN_MORE, settingKeyHints } from "../keys.js";
import { LOG_FILTERS, type LogEntry, type LogFilter, matchesFilter } from "../log.js";
import { Line, Panel } from "../ui/Frame.js";
import { displayPath, padTo, tilde, truncMiddle } from "../ui/text.js";
import { LogLine, type RecordedPage } from "./MainView.js";

const move = (i: number, d: number, n: number) => (n ? (i + d + n) % n : 0);

// ---- Tabs ---------------------------------------------------------------------------------------

export function TabsView({ session, width, height, active, onDone }: { session: BrowserSession; width: number; height: number; active: boolean; onDone: (msg?: string) => void }) {
  const all = session.listTabs();
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const tabs = all
    .map((t, i) => ({ ...t, n: i + 1 }))
    .filter((t) => !filter || `${t.title} ${t.url}`.toLowerCase().includes(filter.toLowerCase()));
  const [cursor, setCursor] = useState(Math.max(0, tabs.findIndex((t) => t.page === session.active)));
  const pin = (i: number) => {
    const t = tabs[i];
    if (!t) return;
    session.pin(t.page);
    onDone(`→ pinned ${t.title || t.url}`);
  };
  useInput(
    (input, key) => {
      if (filtering) {
        if (key.return || key.escape) {
          if (key.escape) setFilter("");
          return setFiltering(false);
        }
        if (key.backspace || key.delete) return setFilter((v) => v.slice(0, -1));
        if (input && !key.ctrl && !key.meta) return setFilter((v) => v + input);
        return;
      }
      if (key.escape || input === "q" || input === "t") return filter ? setFilter("") : onDone();
      if (input === "/") return setFiltering(true);
      if (key.upArrow || input === "k") setCursor((c) => move(c, -1, tabs.length));
      if (key.downArrow || input === "j") setCursor((c) => move(c, 1, tabs.length));
      if (/^[1-9]$/.test(input)) pin(tabs.findIndex((t) => t.n === Number(input)));
      if (key.return) pin(cursor);
      if (input === "a") {
        session.pin(undefined);
        onDone("→ following the tab in front");
      }
    },
    { isActive: active },
  );
  const right = filtering || filter ? `/ ${filter}${filtering ? "▏" : ""}` : `/ filter · ${session.follow ? "following the tab in front" : "pinned"}`;
  const urlW = Math.floor((width - 4) * 0.45);
  return (
    <Panel title="Tabs" right={right} width={width} height={Math.min(height, Math.max(1, tabs.length) + 2)}>
      {tabs.length === 0 ? <Text dimColor>No tab matches "{filter}".</Text> : null}
      {tabs.map((t, i) => (
        <Line
          key={t.n}
          width={width - 4}
          left={
            <Text inverse={i === cursor}>
              {i === cursor ? "▸" : " "} {String(t.n).padStart(2)} {t.page === session.active ? <Text color="green">★</Text> : " "} {t.title || "(untitled)"}
            </Text>
          }
          right={<Text dimColor>{truncMiddle(t.url.replace(/^https?:\/\//, ""), urlW)}</Text>}
        />
      ))}
    </Panel>
  );
}

// ---- Presets ------------------------------------------------------------------------------------

export function describePatch(p: SettingsPatch): string {
  return Object.entries(p)
    .map(([k, v]) => `${SETTING_BY_KEY.get(k as SettingKey)?.label.toLowerCase() ?? k} ${SETTING_BY_KEY.get(k as SettingKey)?.show(v as never) ?? String(v)}`)
    .join(" · ");
}

export function PresetsView(p: {
  width: number;
  height: number;
  active: boolean;
  presets: Record<string, SettingsPatch>;
  settings: CaptureSettings;
  configPath: string;
  onLoad: (name: string) => void;
  onSaveAs: () => void;
  onDelete: (name: string) => void;
  onDone: () => void;
}) {
  const names = Object.keys(p.presets).sort();
  const [cursor, setCursor] = useState(0);
  const [confirm, setConfirm] = useState<string>();
  const current = names[Math.min(cursor, names.length - 1)];
  useInput(
    (input, key) => {
      if (confirm) {
        if (input === "y") p.onDelete(confirm);
        return setConfirm(undefined);
      }
      if (key.escape || input === "p" || input === "q") return p.onDone();
      if (input === "n") return p.onSaveAs();
      if (!names.length) return;
      if (key.upArrow || input === "k") setCursor((c) => move(c, -1, names.length));
      if (key.downArrow || input === "j") setCursor((c) => move(c, 1, names.length));
      if (key.return && current) p.onLoad(current);
      if (input === "d" && current) setConfirm(current);
    },
    { isActive: p.active },
  );
  const after = current ? mergeSettings(p.settings, p.presets[current]) : undefined;
  const diffs = after
    ? (Object.keys(p.presets[current!] ?? {}) as SettingKey[]).map((k) => {
        const d = SETTING_BY_KEY.get(k)!;
        const was = d.show(p.settings[k] as never);
        const now = d.show(after[k] as never);
        return { label: d.label, was, now, same: was === now };
      })
    : [];
  const listH = Math.min(Math.max(4, names.length + 2), Math.max(4, p.height - 7));
  return (
    <Box flexDirection="column">
      <Panel title="Presets" right={truncMiddle(tilde(p.configPath), Math.floor(p.width / 2))} width={p.width} height={listH}>
        {names.length === 0 ? <Text dimColor>No presets yet. Press n to save the current settings as one.</Text> : null}
        {names.map((n) => (
          <Line
            key={n}
            width={p.width - 4}
            left={
              <Text inverse={n === current}>
                {n === current ? "▸ " : "  "}
                {n}
              </Text>
            }
            right={<Text dimColor>{describePatch(p.presets[n]!)}</Text>}
          />
        ))}
      </Panel>
      {confirm ? (
        <Panel title="Delete preset?" width={p.width} accent="red">
          <Text>
            Delete "{confirm}" from {tilde(p.configPath)}? <Text color="cyan">y</Text> delete · any other key keeps it
          </Text>
        </Panel>
      ) : current ? (
        <Panel title={`Loading ${current} changes`} width={p.width}>
          {diffs.map((d) => (
            <Text key={d.label} wrap="truncate-end">
              {padTo(d.label, 20)}
              {d.same ? (
                <Text dimColor>
                  {padTo(d.was, 22)}   (same)
                </Text>
              ) : (
                <Text>
                  {padTo(d.was, 22)} → <Text bold>{d.now}</Text>
                </Text>
              )}
            </Text>
          ))}
        </Panel>
      ) : null}
    </Box>
  );
}

// ---- Log ----------------------------------------------------------------------------------------

export function LogView(p: { width: number; height: number; active: boolean; log: LogEntry[]; onOpen: (file: string, reveal: boolean) => void; onCopy: (file: string) => void; onDone: () => void }) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const entries = p.log.filter((e) => matchesFilter(e, filter));
  const [cursor, setCursor] = useState(Number.MAX_SAFE_INTEGER);
  const sel = Math.min(cursor, entries.length - 1);
  const current = entries[sel];
  useInput(
    (input, key) => {
      if (key.escape || input === "q" || input === "l") return p.onDone();
      if (key.tab) {
        setFilter((f) => LOG_FILTERS[(LOG_FILTERS.indexOf(f) + 1) % LOG_FILTERS.length]!);
        return setCursor(Number.MAX_SAFE_INTEGER);
      }
      if (key.upArrow || input === "k") setCursor(Math.max(0, sel - 1));
      if (key.downArrow || input === "j") setCursor(Math.min(entries.length - 1, sel + 1));
      const file = current?.files?.[0];
      if (file && key.return) p.onOpen(file, false);
      if (file && input === "f") p.onOpen(file, true);
      if (file && input === "c") p.onCopy(file);
    },
    { isActive: p.active },
  );
  // two lines per entry when it has a detail
  const visible = Math.max(1, p.height - 2);
  const lines: { entry: LogEntry; detail?: boolean }[] = [];
  entries.forEach((e) => {
    lines.push({ entry: e });
    if (e.detail) lines.push({ entry: e, detail: true });
  });
  const at = lines.findIndex((l) => l.entry === current && !l.detail);
  const top = Math.min(Math.max(0, at - Math.floor(visible / 2)), Math.max(0, lines.length - visible));
  const tabs = LOG_FILTERS.map((f) => (f === filter ? `[${f}]` : f)).join(" ");
  return (
    <Panel title="Log" right={`${tabs} · ${entries.length} entries`} width={p.width} height={p.height}>
      {entries.length === 0 ? <Text dimColor>Nothing here yet.</Text> : null}
      {lines.slice(top, top + visible).map((l) =>
        l.detail ? (
          <Text key={`${l.entry.id}d`} dimColor wrap="truncate-end">
            {"           "}
            {l.entry.detail}
          </Text>
        ) : (
          <LogLine key={l.entry.id} entry={l.entry} width={p.width - 4} selected={l.entry === current} />
        ),
      )}
    </Panel>
  );
}

// ---- Save recording -----------------------------------------------------------------------------

export function SaveRecordingView(p: {
  width: number;
  height: number;
  active: boolean;
  recorded: RecordedPage[];
  newPath: string;
  existing?: { path: string; pages: number };
  onSave: (pages: RecordedPage[], path: string) => void;
  onBack: () => void;
}) {
  const [ticked, setTicked] = useState<boolean[]>(() => p.recorded.map(() => true));
  const [cursor, setCursor] = useState(0);
  const [box, setBox] = useState<"pages" | "target">("pages");
  const [target, setTarget] = useState(0);
  const targets = [{ label: "new list", path: p.newPath }, ...(p.existing ? [{ label: "add to", path: p.existing.path }] : [])];
  useInput(
    (input, key) => {
      if (key.escape) return p.onBack();
      if (key.tab) return setBox((b) => (b === "pages" ? "target" : "pages"));
      if (key.return) {
        const pages = p.recorded.filter((_, i) => ticked[i]);
        if (pages.length) p.onSave(pages, targets[target]!.path);
        return;
      }
      if (box === "pages") {
        if (key.upArrow || input === "k") setCursor((c) => move(c, -1, p.recorded.length));
        if (key.downArrow || input === "j") setCursor((c) => move(c, 1, p.recorded.length));
        if (input === " ") setTicked((t) => t.map((v, i) => (i === cursor ? !v : v)));
        if (input === "a") setTicked((t) => t.map(() => !t.every(Boolean)));
      } else {
        if (key.upArrow || key.downArrow || input === "j" || input === "k" || input === " ") setTarget((t) => move(t, 1, targets.length));
      }
    },
    { isActive: p.active },
  );
  const count = ticked.filter(Boolean).length;
  const listH = Math.min(p.recorded.length + 2, Math.max(4, p.height - targets.length - 2));
  const visible = listH - 2;
  const top = Math.min(Math.max(0, cursor - Math.floor(visible / 2)), Math.max(0, p.recorded.length - visible));
  return (
    <Box flexDirection="column">
      <Panel title="Recorded pages" right={`${count} of ${p.recorded.length} ticked`} width={p.width} height={listH} accent={box === "pages" ? "cyan" : undefined}>
        {p.recorded.slice(top, top + visible).map((r, k) => {
          const i = top + k;
          return (
            <Line
              key={r.url}
              width={p.width - 4}
              left={
                <Text inverse={box === "pages" && i === cursor}>
                  {box === "pages" && i === cursor ? "▸ " : "  "}
                  <Text color={ticked[i] ? "green" : "gray"}>{ticked[i] ? "[x]" : "[ ]"}</Text> {r.path}
                </Text>
              }
              right={
                <Text dimColor>
                  {r.title}
                  {r.inPage ? <Text color="yellow"> · reached in-page</Text> : null}
                </Text>
              }
            />
          );
        })}
      </Panel>
      <Panel title="Save to" width={p.width} accent={box === "target" ? "cyan" : undefined}>
        {targets.map((t, i) => (
          <Line
            key={t.path}
            width={p.width - 4}
            left={
              <Text inverse={box === "target" && i === target}>
                {i === target ? "(•)" : "( )"} {padTo(t.label, 9)} {truncMiddle(displayPath(t.path), p.width - 30)}
              </Text>
            }
            right={i === 1 && p.existing ? <Text dimColor>{p.existing.pages} pages</Text> : undefined}
          />
        ))}
      </Panel>
    </Box>
  );
}

// ---- Help ---------------------------------------------------------------------------------------

export function HelpView({ width, active, onDone }: { width: number; active: boolean; onDone: () => void }) {
  useInput(() => onDone(), { isActive: active });
  const col = (hints: KeyHint[]) =>
    hints.map((h) => (
      <Text key={h.key + h.label} wrap="truncate-end">
        <Text color="cyan">{padTo(h.key, 7)}</Text>
        {h.label}
      </Text>
    ));
  const two = width >= 90;
  const half = two ? Math.floor(width / 2) : width;
  const capture = [...MAIN_KEYS, { key: "?", label: "help" }, { key: "q", label: "quit" }, ...MAIN_MORE];
  const settings = settingKeyHints();
  return (
    <Box flexDirection="column">
      <Box>
        <Panel title="Capture screen" width={half}>
          {col(capture)}
        </Panel>
        {two ? (
          <Panel title="Settings on screen" width={width - half}>
            {col(settings)}
            <Text dimColor>lowercase cycles · uppercase types a value</Text>
          </Panel>
        ) : null}
      </Box>
      {!two ? (
        <Panel title="Settings on screen" width={width}>
          {col(settings)}
          <Text dimColor>lowercase cycles · uppercase types a value</Text>
        </Panel>
      ) : null}
      <Panel title="Everywhere" width={width}>
        <Text wrap="truncate-end">{GLOBAL_KEYS.map((k) => `${k.key} ${k.label}`).join("   ")}</Text>
        <Text wrap="truncate-end">In the browser: Alt+Shift+S captures the tab you're on.</Text>
      </Panel>
    </Box>
  );
}

// ---- Disconnected -------------------------------------------------------------------------------

export function DisconnectedView({ width, port, recorded, reconnecting, error }: { width: number; port?: number; recorded: number; reconnecting: boolean; error?: string }) {
  return (
    <Panel title="Chrome" right="disconnected" width={width} accent="red">
      <Text>The pagestill Chrome closed or stopped answering{port ? ` on port ${port}` : ""}.</Text>
      <Text> </Text>
      {reconnecting ? (
        <Text color="yellow">Reconnecting…</Text>
      ) : (
        <>
          <Text>
            <Text color="cyan">⏎</Text> reconnect (starts Chrome if it isn't running)
          </Text>
          <Text>
            <Text color="cyan">q</Text> quit
          </Text>
        </>
      )}
      {error ? <Text color="red">✗ {error}</Text> : null}
      <Text> </Text>
      <Text dimColor>Your settings{recorded ? ` and ${recorded} recorded page${recorded === 1 ? "" : "s"}` : ""} are kept until you quit.</Text>
    </Panel>
  );
}

// ---- Modals -------------------------------------------------------------------------------------

/** Single-line text input. Errors from `submit` stay in the box and keep what was typed. */
export function PromptModal(p: { width: number; title: string; hint?: string; initial: string; submit: (text: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(p.initial);
  const [error, setError] = useState<string>();
  useInput((input, key) => {
    if (key.return) {
      try {
        p.submit(value);
        p.onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (key.escape) return p.onClose();
    setError(undefined);
    if (key.backspace || key.delete) return setValue((v) => v.slice(0, -1));
    if (key.ctrl && input === "u") return setValue("");
    if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) return;
    if (input) setValue((v) => v + input.replace(/[\r\n]/g, ""));
  });
  return (
    <Panel title={p.title} width={p.width} accent="cyan">
      <Text>
        {value}
        <Text inverse> </Text>
      </Text>
      {p.hint ? <Text dimColor>{p.hint}</Text> : null}
      {error ? <Text color="red">✗ {error}</Text> : null}
    </Panel>
  );
}

export function ConfirmModal(p: { width: number; title: string; lines: string[]; choices: KeyHint[]; onChoice: (key: string) => void }) {
  useInput((input, key) => {
    if (key.escape) return p.onChoice("esc");
    if (p.choices.some((c) => c.key === input)) p.onChoice(input);
  });
  return (
    <Panel title={p.title} width={Math.min(p.width, 72)} accent="yellow">
      {p.lines.map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      <Text> </Text>
      <Text>
        {p.choices.map((c) => (
          <Text key={c.key}>
            <Text color="cyan">{c.key}</Text> {c.label}
            {"     "}
          </Text>
        ))}
      </Text>
    </Panel>
  );
}
