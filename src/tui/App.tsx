import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Page } from "puppeteer-core";
import { LIST_SUFFIX, appendToPageList, loadPageList } from "../batch/pagelist.js";
import { capture } from "../core/capture.js";
import { CONFIG_PATH, type Config, saveConfig } from "../core/config.js";
import { PASSTHROUGH_KEY, applyEmulation, clearEmulation, emulationKey, isPassthrough } from "../core/emulation.js";
import { localDateTime, localStamp, renderFilename } from "../core/filename.js";
import { formatBytes } from "../core/format.js";
import { quiet } from "../core/navigate.js";
import type { BrowserSession } from "../core/session.js";
import {
  type CaptureSettings,
  DEFAULT_SETTINGS,
  SETTING_BY_KEY,
  type SettingKey,
  type SettingsPatch,
  diffSettings,
  formatDpr,
  formatViewport,
  mergeSettings,
} from "../core/settings.js";
import { normalizeUrl } from "../core/urls.js";
import { setWarningSink } from "../core/warn.js";
import { workspace } from "../core/workspace.js";
import { type Field, fieldForKey, fixedChoiceField } from "./fields.js";
import { VIEW_KEYS, type ViewId } from "./keys.js";
import { type LogEntry, appendLog, onMainLog } from "./log.js";
import { AppBar, KeyBar, type Segment } from "./ui/Frame.js";
import { displayPath, tilde, truncEnd } from "./ui/text.js";
import { type Busy, MainView, type RecordedPage, mainLayout } from "./views/MainView.js";
import {
  ConfirmModal,
  DisconnectedView,
  HelpView,
  LogView,
  PresetsView,
  PromptModal,
  SaveRecordingView,
  TabsView,
  describePatch,
} from "./views/Pages.js";
import { SettingsView } from "./views/SettingsView.js";

type PromptState = { title: string; hint?: string; initial: string; submit: (text: string) => void };
type ConfirmState = { title: string; lines: string[]; choices: { key: string; label: string }[]; onChoice: (key: string) => void };

const MIN_COLS = 60;
const MIN_ROWS = 18;
const PAGE_TITLE: Record<ViewId, string> = {
  main: "Capture",
  settings: "Settings",
  tabs: "Tabs",
  presets: "Presets",
  log: "Log",
  save: "Save recording",
  help: "Help",
  disconnected: "Disconnected",
};

export interface AppProps {
  session: BrowserSession;
  /** Connect again after the browser went away. */
  reconnect: () => Promise<BrowserSession>;
  config: Config;
  version: string;
  /** What R resets to: defaults → config defaults → presets → flags. */
  base: CaptureSettings;
  /** Where the screen starts: base plus the restored session. */
  initial: CaptureSettings;
  /** Settings restored from the last session (tui-state.yaml). */
  restored: SettingsPatch;
  /** Presets given on the command line, for the settings panel title. */
  presetLabel?: string;
  /** Called with the session's own changes (never command-line flags) whenever they change. */
  onSession: (patch: SettingsPatch) => void;
}

export function App(props: AppProps) {
  const { config, version, base, initial, restored, onSession } = props;
  const { exit } = useApp();
  const { columns: cols, rows } = useWindowSize();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [session, setSession] = useState(props.session);
  const [connected, setConnected] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [connError, setConnError] = useState<string>();
  const [settings, setSettingsState] = useState(initial);
  const [view, setView] = useState<ViewId>("main");
  const [prompt, setPrompt] = useState<PromptState>();
  const [confirm, setConfirm] = useState<ConfirmState>();
  const [settingsCursor, setSettingsCursor] = useState(0);
  const [busy, setBusy] = useState<Busy>();
  const [hint, setHint] = useState<string>();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [totals, setTotals] = useState({ count: 0, bytes: 0 });
  const [presets, setPresets] = useState(config.presets ?? {});
  const [preset, setPreset] = useState<{ label: string; snapshot: string } | undefined>(
    props.presetLabel ? { label: props.presetLabel, snapshot: JSON.stringify(initial) } : undefined,
  );
  const [recording, setRecording] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [recorded, setRecorded] = useState<RecordedPage[]>([]);
  const busyRef = useRef(false);
  const settingsRef = useRef(settings);
  const sessionPatch = useRef<SettingsPatch>({ ...restored });
  const applied = useRef(new Map<Page, string>());
  const emuChain = useRef(Promise.resolve());
  const recordingRef = useRef(false);
  const autoRef = useRef(false);
  const recordedUrls = useRef(new Set<string>());
  const hintTimer = useRef<NodeJS.Timeout>(undefined);

  const addLog = useCallback((e: Omit<LogEntry, "id" | "time">) => setLog((l) => appendLog(l, e)), []);
  const flash = (text: string) => {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(undefined), 3000);
  };

  // ---- settings
  const setSettings = useCallback(
    (next: CaptureSettings) => {
      const prev = settingsRef.current;
      for (const k of Object.keys(next) as SettingKey[]) {
        if (JSON.stringify(prev[k]) === JSON.stringify(next[k])) continue;
        (sessionPatch.current as Record<string, unknown>)[k] = next[k];
        const d = SETTING_BY_KEY.get(k);
        if (d) addLog({ kind: "setting", text: `${d.label} → ${d.show(next[k] as never)}` });
      }
      settingsRef.current = next;
      setSettingsState(next);
      onSession({ ...sessionPatch.current });
    },
    [onSession, addLog],
  );

  useEffect(() => {
    if (restored && Object.keys(restored).length) addLog({ kind: "setting", text: `restored last session: ${describePatch(restored)}` });
    setWarningSink((m) => addLog({ kind: "check", text: m }));
    return () => setWarningSink((m) => process.stderr.write(`pagestill: ${m}\n`));
  }, []);

  // ---- recording
  function remember(rawUrl: string) {
    if (!/^(https?|file):/.test(rawUrl)) return;
    const url = normalizeUrl(rawUrl);
    if (!url || recordedUrls.current.has(url)) return;
    recordedUrls.current.add(url);
    const u = new URL(url);
    setRecorded((r) => [...r, { url, path: u.protocol === "file:" ? u.pathname : u.pathname + u.search, title: "" }]);
  }

  async function fillDetails(page: Page) {
    const url = normalizeUrl(page.url());
    if (!url) return;
    const info = await page
      .evaluate(() => ({
        title: document.title,
        loaded: (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.name ?? location.href,
      }))
      .catch(() => undefined);
    if (!info) return;
    const inPage = normalizeUrl(info.loaded) !== url;
    setRecorded((r) => r.map((x) => (x.url === url ? { ...x, title: x.title || info.title, inPage: x.inPage ?? inPage } : x)));
  }

  // ---- browser events
  useEffect(() => {
    let lastActive = session.active;
    const timers = new Map<Page, NodeJS.Timeout>();
    const onChange = () => {
      const now = session.active;
      if (now && now !== lastActive) {
        const tab = session.activeTab;
        addLog({ kind: "tab", text: `${session.follow ? "following" : "pinned"} ${tab?.title || tab?.url || "a tab"}` });
        if (recordingRef.current) {
          remember(now.url());
          void fillDetails(now);
        }
      }
      lastActive = now;
      rerender();
    };
    const onNav = (page: Page, url: string) => {
      if (!recordingRef.current && !autoRef.current) return;
      if (page !== session.active || !/^(https?|file):/.test(url)) return;
      if (recordingRef.current) remember(url);
      clearTimeout(timers.get(page));
      timers.set(
        page,
        setTimeout(async () => {
          if (page !== session.active) return;
          await quiet(page, 500, 8000);
          if (recordingRef.current) await fillDetails(page);
          if (autoRef.current && page === session.active) await runCapture(settingsRef.current, page);
        }, 700),
      );
    };
    const onHotkey = (page: Page) => void runCapture(settingsRef.current, page);
    const onGone = () => {
      setConnected(false);
      applied.current.clear();
      addLog({ kind: "error", text: "Chrome disconnected", detail: "Press ⏎ to reconnect." });
      setView("disconnected");
    };
    session.on("change", onChange);
    session.on("navigated", onNav);
    session.on("hotkey", onHotkey);
    session.on("disconnected", onGone);
    return () => {
      session.off("change", onChange);
      session.off("navigated", onNav);
      session.off("hotkey", onHotkey);
      session.off("disconnected", onGone);
      for (const t of timers.values()) clearTimeout(t);
    };
  }, [session]);

  // ---- live emulation on the tab in front
  const active = connected ? session.active : undefined;
  const key = emulationKey(settings);
  useEffect(() => {
    emuChain.current = emuChain.current.then(async () => {
      try {
        for (const [page, k] of applied.current) {
          if (page !== active) {
            if (k !== PASSTHROUGH_KEY) await clearEmulation(await session.cdp(page));
            applied.current.delete(page);
          }
        }
        if (!active || (applied.current.get(active) ?? PASSTHROUGH_KEY) === key) return;
        await applyEmulation(await session.cdp(active), settings);
        applied.current.set(active, key);
        addLog({ kind: "browser", text: isPassthrough(settings) ? "Chrome back to its own size and theme" : `Chrome now shows ${emulationText(settings)}` });
      } catch (e) {
        addLog({ kind: "error", text: message(e) });
      }
    });
  }, [active, key, session]);

  // ---- capture
  async function runCapture(s: CaptureSettings, page: Page | undefined = session.active) {
    if (!page) return addLog({ kind: "error", text: "No tab to capture", detail: "Open a page in the pagestill Chrome window." });
    if (busyRef.current) return flash("Already capturing");
    busyRef.current = true;
    const name = new URL(page.url()).pathname.split("/").filter(Boolean).pop() || new URL(page.url()).hostname;
    const started = Date.now();
    setBusy({ label: `capturing ${name}`, started });
    try {
      await emuChain.current;
      const res = await capture(session, page, s, {
        keepEmulation: true,
        appliedEmulation: applied.current.get(page) ?? PASSTHROUGH_KEY,
        log: (m) => setBusy({ label: `capturing ${name} · ${m.replace(/^Capturing /, "").toLowerCase()}`, started }),
      });
      applied.current.set(page, emulationKey(s));
      const size = res.files.reduce((n, f) => n + f.bytes, 0);
      setTotals((t) => ({ count: t.count + 1, bytes: t.bytes + size }));
      const files = res.files.sort((a) => (a.kind === "image" ? -1 : 1));
      addLog({
        kind: res.warnings.length ? "check" : "capture",
        // the image and the HTML share a name: show it once
        text: files
          .map((f, i) => `${i === 0 ? f.path.split("/").pop() : `.${f.path.split(".").pop()}`}${f.width ? ` ${f.width}×${f.height}` : ""} ${formatBytes(f.bytes)}`)
          .join(" · "),
        right: `${(res.durationMs / 1000).toFixed(1)}s`,
        detail: [displayPath(dirname(files[0]!.path)), ...res.warnings.map((w) => `? ${w}`)].join("   "),
        files: files.map((f) => f.path),
      });
      process.stdout.write("\x07");
    } catch (e) {
      addLog({ kind: "error", text: message(e), detail: nextStep(e) });
    } finally {
      busyRef.current = false;
      setBusy(undefined);
    }
  }

  // ---- actions
  function edit(field: Field) {
    if (!field.edit) return;
    const e = field.edit;
    setPrompt({ title: field.label, hint: e.hint, initial: e.initial(settingsRef.current), submit: (text) => setSettings(e.apply(settingsRef.current, text)) });
  }

  function persistPresets(next: Record<string, SettingsPatch>, logText: string) {
    setPresets(next);
    config.presets = next;
    try {
      saveConfig(config);
      addLog({ kind: "setting", text: logText });
    } catch (e) {
      addLog({ kind: "error", text: message(e) });
    }
  }

  function reset() {
    sessionPatch.current = {};
    settingsRef.current = base;
    setSettingsState(base);
    onSession({});
    setPreset(props.presetLabel ? { label: props.presetLabel, snapshot: JSON.stringify(base) } : undefined);
    addLog({ kind: "setting", text: "settings reset to your defaults" });
    flash("Reset to your defaults (config, presets and flags still apply)");
  }

  function toggleAuto() {
    autoRef.current = !autoRef.current;
    setAutoCapture(autoRef.current);
    addLog({ kind: "mode", text: autoRef.current ? "auto-capture on: every page you open in the tab in front is captured" : "auto-capture off" });
  }

  function toggleRecording() {
    if (!recordingRef.current) {
      recordingRef.current = true;
      setRecording(true);
      if (session.active) {
        remember(session.active.url());
        void fillDetails(session.active);
      }
      addLog({ kind: "mode", text: "recording: every page you open in the tab in front is added" });
      return;
    }
    if (!recorded.length) {
      recordingRef.current = false;
      setRecording(false);
      return addLog({ kind: "mode", text: "recording stopped (nothing recorded)" });
    }
    setView("save");
  }

  function saveRecording(pages: RecordedPage[], path: string) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const first = new URL(pages[0]!.url);
      const added = appendToPageList(path, {
        header: [
          ` Recorded with pagestill on ${localDateTime()}`,
          ' Pages marked "reached in-page" were opened by clicking inside a page app;',
          " check that they open directly before relying on them in a run.",
          " Untick pages with `pagestill edit <this file>`, then: pagestill run <this file>",
        ].join("\n"),
        base: first.protocol === "file:" ? undefined : `${first.origin}/`,
        entries: pages.map((r) => ({ url: r.url, note: [r.title, r.inPage ? "reached in-page" : ""].filter(Boolean).join(" · ") || undefined })),
      });
      const skipped = pages.length - added;
      addLog({ kind: "mode", text: `saved ${added} page${added === 1 ? "" : "s"} to ${tilde(path)}${skipped ? ` (${skipped} already there)` : ""}`, files: [path] });
      recordingRef.current = false;
      setRecording(false);
      recordedUrls.current.clear();
      setRecorded([]);
      setView("main");
    } catch (e) {
      addLog({ kind: "error", text: message(e) });
    }
  }

  function quit() {
    if (recordingRef.current && recorded.length) {
      return setConfirm({
        title: "Quit?",
        lines: [`${recorded.length} recorded page${recorded.length === 1 ? " is" : "s are"} not saved.`],
        choices: [
          { key: "s", label: "save them first" },
          { key: "q", label: "quit anyway" },
          { key: "esc", label: "stay" },
        ],
        onChoice: (k) => {
          setConfirm(undefined);
          if (k === "q") exit();
          if (k === "s") setView("save");
        },
      });
    }
    exit();
  }

  async function doReconnect() {
    setReconnecting(true);
    setConnError(undefined);
    try {
      const s = await props.reconnect();
      setSession(s);
      setConnected(true);
      setView("main");
      addLog({ kind: "conn", text: "Chrome connected again" });
    } catch (e) {
      setConnError(message(e));
    } finally {
      setReconnecting(false);
    }
  }

  // ---- keys on the main screen (each page handles its own)
  useInput(
    (input, key) => {
      if (input === "q") return quit();
      if (key.return) return void runCapture(settings);
      if (input === "?") return setView("help");
      if (input === "e") return setView("settings");
      if (input === "t") return setView("tabs");
      if (input === "p") return setView("presets");
      if (input === "l") return setView("log");
      if (input === "g") return openPath(workspace(settings.out).shots, "folder");
      if (input === "R") return reset();
      if (input === "r") return toggleRecording();
      if (input === "u") return toggleAuto();
      const hit = fieldForKey(input);
      if (hit) {
        if (hit.typed) return edit(hit.field);
        if (hit.field.step) return setSettings(hit.field.step(settings, 1));
      }
      const fixed = fixedChoiceField(input);
      if (fixed) flash(`${fixed.label} has fixed choices: press ${fixed.key1} to cycle them`);
    },
    { isActive: view === "main" && !prompt && !confirm },
  );
  useInput(
    (input, key) => {
      if (key.return && !reconnecting) void doReconnect();
      // same path as the main screen: unsaved recorded pages are confirmed
      if (input === "q") quit();
    },
    { isActive: view === "disconnected" && !confirm },
  );

  // ---- layout
  if (cols < MIN_COLS || rows < MIN_ROWS) {
    return (
      <Box flexDirection="column">
        <Text>
          pagestill needs at least {MIN_COLS}×{MIN_ROWS}. This terminal is {cols}×{rows}.
        </Text>
        <Text dimColor>Make the window larger (or press Ctrl+C to quit).</Text>
      </Box>
    );
  }

  const tab = connected ? session.activeTab : undefined;
  const modalH = prompt ? 5 + (prompt.hint ? 1 : 0) : confirm ? 4 + confirm.lines.length + 2 : 0;
  const bodyH = rows - 2 - modalH;
  const emulation = isPassthrough(settings) ? undefined : emulationText(settings);
  const layout = mainLayout(cols, bodyH, { emulating: !!emulation, recording, recCount: recorded.length });
  const ws = workspace(settings.out);
  const ext = settings.format === "jpeg" ? "jpg" : settings.format;
  const nextBase = tab ? renderFilename(settings.name, { url: tab.url, title: tab.title, date: new Date() }) : "(open a tab)";
  const next = tab ? `${nextBase}${settings.image ? `.${ext}` : ""}${settings.image && settings.html ? " + .html" : settings.html ? ".html" : ""}` : nextBase;
  const presetChanged = preset && preset.snapshot !== JSON.stringify(settings);
  const lists = ws.lists;
  const keys = VIEW_KEYS[view].map((k) => (view === "main" && k.key === "r" && recording ? { ...k, label: "save recording" } : k));

  const port = /:(\d+)\//.exec(session.endpoint)?.[1];
  // narrow terminals: drop the version and the Chrome label before anything on the right
  const compact = cols < 90;
  const left: Segment[] = [
    { text: compact ? " pagestill · " : ` pagestill ${version} · ` },
    connected ? { text: compact ? "● " : "Chrome ● ", color: "green" } : { text: compact ? "✗ " : "Chrome ✗ ", color: "red" },
    {
      text: `${compact ? "" : `${connected ? (session.launched ? "pagestill" : "attached") : "disconnected"}`}${port ? `${compact ? "" : " "}:${port}` : ""} · ${PAGE_TITLE[view]}`,
    },
  ];
  const right: Segment[] = [
    ...(recording ? [{ text: ` ● REC ${recorded.length} `, color: "red" }] : []),
    ...(autoCapture ? [{ text: " ◉ AUTO ", color: "yellow" }] : []),
    ...(!layout.showEmulation && emulation && view === "main" ? [{ text: ` ! ${truncEnd(emulation, Math.max(8, cols - 60))} `, color: "yellow" }] : []),
    { text: "  ? help  q quit " },
  ];

  const body =
    view === "settings" ? (
      <SettingsView
        width={cols}
        height={bodyH}
        active={!prompt && !confirm}
        settings={settings}
        base={base}
        onChange={setSettings}
        onEdit={edit}
        onDone={() => setView("main")}
        cursor={settingsCursor}
        setCursor={setSettingsCursor}
      />
    ) : view === "tabs" ? (
      <TabsView
        session={session}
        width={cols}
        height={bodyH}
        active={!prompt && !confirm}
        onDone={() => {
          setView("main");
        }}
      />
    ) : view === "presets" ? (
      <PresetsView
        width={cols}
        height={bodyH}
        active={!prompt && !confirm}
        presets={presets}
        settings={settings}
        configPath={CONFIG_PATH}
        onDone={() => setView("main")}
        onLoad={(name) => {
          const next = mergeSettings(settings, presets[name]);
          setSettings(next);
          setPreset({ label: name, snapshot: JSON.stringify(next) });
          addLog({ kind: "setting", text: `preset ${name} loaded` });
          setView("main");
        }}
        onDelete={(name) => {
          const { [name]: _, ...rest } = presets;
          persistPresets(rest, `preset ${name} deleted`);
        }}
        onSaveAs={() =>
          setPrompt({
            title: "Save current settings as preset",
            hint: `saved in ${tilde(CONFIG_PATH)}`,
            initial: preset?.label ?? "",
            submit: (name) => {
              const n = name.trim();
              if (!n) throw new Error("Name is required");
              // the workspace folder belongs to where you work, not to a preset
              const { out: _, ...p } = diffSettings(settings, DEFAULT_SETTINGS);
              persistPresets({ ...presets, [n]: p }, `preset ${n} saved`);
              setPreset({ label: n, snapshot: JSON.stringify(settings) });
            },
          })
        }
      />
    ) : view === "log" ? (
      <LogView
        width={cols}
        height={bodyH}
        active={!prompt && !confirm}
        log={log}
        onDone={() => setView("main")}
        onOpen={(file, reveal) => openPath(file, reveal ? "reveal" : "file")}
        onCopy={(file) => copy(file)}
      />
    ) : view === "save" ? (
      <SaveRecordingView
        width={cols}
        height={bodyH}
        active={!prompt && !confirm}
        recorded={recorded}
        newPath={join(lists, `${(new URL(recorded[0]?.url ?? "http://local").hostname || "local").replace(/\./g, "-")}-${localStamp()}${LIST_SUFFIX}`)}
        existing={latestList(lists)}
        onSave={saveRecording}
        onBack={() => setView("main")}
      />
    ) : view === "help" ? (
      <HelpView width={cols} active={!prompt && !confirm} onDone={() => setView("main")} />
    ) : view === "disconnected" ? (
      <DisconnectedView width={cols} port={port ? Number(port) : undefined} recorded={recorded.length} reconnecting={reconnecting} error={connError} />
    ) : (
      <MainView
        width={cols}
        height={bodyH}
        layout={layout}
        tab={tab ? { title: tab.title, url: tab.url, follow: session.follow } : undefined}
        emulation={emulation}
        settings={settings}
        base={base}
        preset={preset ? `${preset.label}${presetChanged ? " (edited)" : ""}` : undefined}
        output={{ dir: `${displayPath(ws.shots)}/`, next, count: totals.count, bytes: totals.bytes }}
        recording={recording}
        recorded={recorded}
        log={log.filter(onMainLog)}
        totalLog={log.length}
        busy={busy}
      />
    );

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <AppBar width={cols} left={left} right={right} />
      <Box flexDirection="column" height={bodyH} overflow="hidden">
        {body}
      </Box>
      {prompt ? (
        <PromptModal width={cols} title={prompt.title} hint={prompt.hint} initial={prompt.initial} submit={prompt.submit} onClose={() => setPrompt(undefined)} />
      ) : null}
      {confirm ? <ConfirmModal width={cols} title={confirm.title} lines={confirm.lines} choices={confirm.choices} onChoice={confirm.onChoice} /> : null}
      <KeyBar
        width={cols}
        keys={prompt ? [{ key: "⏎", label: "ok" }, { key: "esc", label: "cancel" }, { key: "ctrl+u", label: "clear" }] : confirm ? confirm.choices : keys}
        hint={hint}
      />
    </Box>
  );
}

function emulationText(s: CaptureSettings): string {
  const parts: string[] = [];
  if (s.viewport !== "as-is") parts.push(formatViewport(s.viewport));
  if (s.dpr !== "as-is") parts.push(formatDpr(s.dpr));
  if (s.theme !== "as-is") parts.push(s.theme);
  if (s.reducedMotion) parts.push("reduced motion");
  return parts.join(" · ");
}

function message(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // the protocol's wording means nothing to most people
  if (/Target closed|Session closed|detached/i.test(m)) return "The tab was closed or navigated away during the capture";
  if (/Protocol error/i.test(m)) return `Chrome refused the request (${m.replace(/^Protocol error \(([^)]+)\).*/, "$1")})`;
  return m;
}

function nextStep(e: unknown): string | undefined {
  const m = e instanceof Error ? e.message : String(e);
  if (/No visible element matches/.test(m)) return "Press A to pick another element, or a to capture the full page.";
  if (/both off/.test(m)) return "Press o to choose what to save.";
  if (/Target closed|Session closed|detached/i.test(m)) return "Open the page again and press ⏎.";
  return undefined;
}

/** The most recent page list in lists/, offered as "add to". */
function latestList(dir: string): { path: string; pages: number } | undefined {
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(LIST_SUFFIX))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files[0]) return undefined;
  try {
    return { path: files[0], pages: loadPageList(files[0], () => {}).pages.length };
  } catch {
    return undefined;
  }
}

function openPath(path: string, how: "file" | "folder" | "reveal") {
  if (how === "folder") mkdirSync(path, { recursive: true });
  const mac = process.platform === "darwin";
  const win = process.platform === "win32";
  const args = how === "reveal" ? (mac ? ["-R", path] : win ? [`/select,${path}`] : [dirname(path)]) : [path];
  const cmd = mac ? "open" : win ? "explorer" : "xdg-open";
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

function copy(text: string) {
  const cmd = process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : "xclip";
  const child = execFile(cmd, process.platform === "linux" ? ["-selection", "clipboard"] : [], () => {});
  child.stdin?.end(text);
}
