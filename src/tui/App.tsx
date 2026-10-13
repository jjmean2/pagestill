import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Page } from "puppeteer-core";
import { KEYS_TOPIC } from "../cli/topics.js";
import { LIST_SUFFIX, appendToPageList } from "../batch/pagelist.js";
import { type CaptureResult, capture } from "../core/capture.js";
import { type Config, saveConfig } from "../core/config.js";
import { PASSTHROUGH_KEY, applyEmulation, clearEmulation, emulationKey } from "../core/emulation.js";
import { localDateTime, localStamp } from "../core/filename.js";
import { formatBytes } from "../core/format.js";
import { quiet } from "../core/navigate.js";
import type { BrowserSession } from "../core/session.js";
import { type CaptureSettings, DEFAULT_SETTINGS, type SettingsPatch, diffSettings, mergeSettings } from "../core/settings.js";
import { normalizeUrl } from "../core/urls.js";
import { setWarningSink } from "../core/warn.js";
import { workspace } from "../core/workspace.js";
import { type Field, MAIN_GROUPS, fieldForKey, fixedChoiceField, mainFields } from "./fields.js";
import { PresetsView } from "./PresetsView.js";
import { Prompt } from "./Prompt.js";
import { SettingsView } from "./SettingsView.js";
import { TabsView } from "./TabsView.js";

type View = "main" | "tabs" | "settings" | "presets" | "help";
type PromptState = { label: string; hint?: string; initial: string; submit: (text: string) => void };
type Recorded = { url: string; title: string; inPage?: boolean };

export interface AppProps {
  session: BrowserSession;
  config: Config;
  version: string;
  /** What R resets to: defaults → config defaults → presets → flags. */
  base: CaptureSettings;
  /** Where the screen starts: base plus the restored session. */
  initial: CaptureSettings;
  /** Settings restored from the last session (tui-state.yaml). */
  restored: SettingsPatch;
  /** Presets given on the command line, for the status line. */
  presetLabel?: string;
  /** Called with the session's own changes (never command-line flags) whenever they change. */
  onSession: (patch: SettingsPatch) => void;
}

export function App({ session, config, version, base, initial, restored, presetLabel: startPreset, onSession }: AppProps) {
  const { exit } = useApp();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [settings, setSettingsState] = useState(initial);
  const [view, setView] = useState<View>("main");
  const [prompt, setPrompt] = useState<PromptState>();
  const [settingsCursor, setSettingsCursor] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [recent, setRecent] = useState<CaptureResult[]>([]);
  const [presets, setPresets] = useState(config.presets ?? {});
  const [preset, setPreset] = useState<{ label: string; snapshot: string } | undefined>(
    startPreset ? { label: startPreset, snapshot: JSON.stringify(initial) } : undefined,
  );
  const [isRestored, setIsRestored] = useState(Object.keys(restored).length > 0);
  const busyRef = useRef(false);
  const settingsRef = useRef(settings);
  /** What this session changed: restored state plus edits made here. Saved on exit. */
  const sessionPatch = useRef<SettingsPatch>({ ...restored });
  /** Emulation key currently applied per page (WYSIWYG: the browser shows what will be captured). */
  const applied = useRef(new Map<Page, string>());
  const emuChain = useRef(Promise.resolve());
  // Record: pages visited in the tab in front, saved to a page list. Auto: capture after every
  // navigation in the tab in front, once the page has settled.
  const [recording, setRecording] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [recorded, setRecorded] = useState<Recorded[]>([]);
  const recordingRef = useRef(false);
  const autoRef = useRef(false);
  const recordedUrls = useRef(new Set<string>());

  const setSettings = useCallback(
    (next: CaptureSettings) => {
      const prev = settingsRef.current;
      for (const k of Object.keys(next) as (keyof CaptureSettings)[]) {
        if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) (sessionPatch.current as Record<string, unknown>)[k] = next[k];
      }
      settingsRef.current = next;
      setSettingsState(next);
      onSession({ ...sessionPatch.current });
    },
    [onSession],
  );

  const fail = (e: unknown) => setMessage({ text: e instanceof Error ? e.message : String(e), error: true });

  // Config/list warnings raised while the screen owns the terminal go to the status line.
  useEffect(() => {
    setWarningSink((m) => setMessage({ text: m, error: true }));
    return () => setWarningSink((m) => process.stderr.write(`pagestill: ${m}\n`));
  }, []);

  /** Add a URL to the recording right away (fast clicks must not be lost); the title comes later. */
  function remember(rawUrl: string) {
    if (!/^(https?|file):/.test(rawUrl)) return;
    const url = normalizeUrl(rawUrl);
    if (!url || recordedUrls.current.has(url)) return;
    recordedUrls.current.add(url);
    setRecorded((r) => [...r, { url, title: "" }]);
  }

  /** Title, and whether the page was reached in-page (pushState) rather than loaded at its URL. */
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

  // Navigations in the tab in front drive Record and Auto (debounced: redirects and SPA route
  // changes come in bursts). Other windows (run, crawl) never count.
  useEffect(() => {
    const timers = new Map<Page, NodeJS.Timeout>();
    const onNav = (page: Page, url: string) => {
      if (!recordingRef.current && !autoRef.current) return;
      if (page !== session.active) return;
      if (!/^(https?|file):/.test(url)) return;
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
    session.on("navigated", onNav);
    return () => {
      session.off("navigated", onNav);
      for (const t of timers.values()) clearTimeout(t);
    };
  }, [session]);

  function toggleRecording() {
    if (!recordingRef.current) {
      recordingRef.current = true;
      setRecording(true);
      if (session.active) {
        remember(session.active.url());
        void fillDetails(session.active);
      }
      setMessage({ text: "Recording the tab in front: every page you open is added. r again to stop and save." });
      return;
    }
    recordingRef.current = false;
    setRecording(false);
    if (!recorded.length) return setMessage({ text: "Recording stopped (nothing recorded)" });
    const first = new URL(recorded[0]!.url);
    const lists = workspace(settingsRef.current.out).lists;
    const host = (first.hostname || "local").replace(/\./g, "-");
    setPrompt({
      label: `Save ${recorded.length} recorded pages to:`,
      hint: "an existing list gets the new pages added · esc keeps the recording",
      initial: show(join(lists, `${host}-${localStamp()}${LIST_SUFFIX}`)),
      submit: (path) => {
        const file = path.trim();
        if (!file) throw new Error("File name is required");
        mkdirSync(join(file, ".."), { recursive: true });
        const added = appendToPageList(file, {
          header: [
            ` Recorded with pagestill on ${localDateTime()}`,
            " Pages marked \"reached in-page\" were opened by clicking inside a page app;",
            " check that they open directly before relying on them in a run.",
            " Untick pages with `pagestill edit <this file>`, then: pagestill run <this file>",
          ].join("\n"),
          base: first.protocol === "file:" ? undefined : `${first.origin}/`,
          entries: recorded.map((r) => ({
            url: r.url,
            note: [r.title, r.inPage ? "reached in-page" : ""].filter(Boolean).join(" · ") || undefined,
          })),
        });
        recordedUrls.current.clear();
        setRecorded([]);
        const skipped = recorded.length - added;
        setMessage({ text: `Saved ${added} page${added === 1 ? "" : "s"} to ${file}${skipped ? ` (${skipped} already there)` : ""}` });
      },
    });
  }

  // Re-render on tab/focus changes; capture on the in-page hotkey; keep recording across tabs.
  useEffect(() => {
    let lastActive = session.active;
    const onChange = () => {
      if (recordingRef.current && session.active && session.active !== lastActive) {
        remember(session.active.url());
        void fillDetails(session.active);
      }
      lastActive = session.active;
      rerender();
    };
    const onHotkey = (page: Page) => void runCapture(settingsRef.current, page);
    const onGone = () => {
      setMessage({ text: "Browser disconnected", error: true });
      exit();
    };
    session.on("change", onChange);
    session.on("hotkey", onHotkey);
    session.on("disconnected", onGone);
    return () => {
      session.off("change", onChange);
      session.off("hotkey", onHotkey);
      session.off("disconnected", onGone);
    };
  }, [session]);

  const active = session.active;
  const key = emulationKey(settings);

  // Keep emulation on the active tab in sync with the settings; release it from other tabs.
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
      } catch (e) {
        fail(e);
      }
    });
  }, [active, key]);

  async function runCapture(s: CaptureSettings, page: Page | undefined = session.active) {
    if (!page) return setMessage({ text: "No tab to capture", error: true });
    if (busyRef.current) return;
    busyRef.current = true;
    setMessage(undefined);
    setBusy("Starting");
    try {
      await emuChain.current;
      const res = await capture(session, page, s, {
        keepEmulation: true,
        appliedEmulation: applied.current.get(page) ?? PASSTHROUGH_KEY,
        log: setBusy,
      });
      applied.current.set(page, emulationKey(s));
      setRecent((r) => [res, ...r].slice(0, 5));
      if (res.warnings.length) setMessage({ text: res.warnings.join("; ") });
      process.stdout.write("\x07");
    } catch (e) {
      fail(e);
    } finally {
      busyRef.current = false;
      setBusy(undefined);
    }
  }

  function edit(field: Field) {
    if (!field.edit) return;
    const e = field.edit;
    setPrompt({
      label: `${field.label}:`,
      hint: e.hint,
      initial: e.initial(settingsRef.current),
      submit: (text) => setSettings(e.apply(settingsRef.current, text)),
    });
  }

  function persistPresets(next: Record<string, SettingsPatch>) {
    setPresets(next);
    config.presets = next;
    try {
      saveConfig(config);
    } catch (e) {
      fail(e);
    }
  }

  function reset() {
    sessionPatch.current = {};
    settingsRef.current = base;
    setSettingsState(base);
    onSession({});
    setIsRestored(false);
    setPreset(startPreset ? { label: startPreset, snapshot: JSON.stringify(base) } : undefined);
    setMessage({ text: "Reset to defaults (config defaults, presets and flags still apply)" });
  }

  useInput(
    (input, key) => {
      setMessage(undefined);
      if (input === "q") return exit();
      if (key.return) return void runCapture(settings);
      if (input === "t") return setView("tabs");
      if (input === "e") return setView("settings");
      if (input === "p") return setView("presets");
      if (input === "?") return setView("help");
      if (input === "g") return openFolder(workspace(settings.out).root);
      if (input === "R") return reset();
      if (input === "r") return toggleRecording();
      if (input === "u") {
        autoRef.current = !autoRef.current;
        setAutoCapture(autoRef.current);
        return setMessage({ text: autoRef.current ? "Auto on: every page you open in the tab in front is captured" : "Auto off" });
      }
      const hit = fieldForKey(input);
      if (hit) {
        if (hit.typed) return edit(hit.field);
        if (hit.field.step) return setSettings(hit.field.step(settings, 1));
      }
      const fixed = fixedChoiceField(input);
      if (fixed) setMessage({ text: `${fixed.label} has fixed choices: press ${fixed.key1} to cycle them` });
    },
    { isActive: view === "main" && !prompt },
  );

  useInput(() => setView("main"), { isActive: view === "help" && !prompt });

  const tab = session.activeTab;
  const shots = workspace(settings.out).shots;
  const presetChanged = preset && preset.snapshot !== JSON.stringify(settings);

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>
          <Text bold color="cyan">
            pagestill
          </Text>
          <Text dimColor> {version} · Chrome ({session.launched ? "pagestill" : "attached"}) · </Text>
          {session.follow ? <Text color="green">following the tab in front</Text> : <Text color="yellow">pinned tab</Text>}
        </Text>
        <Text dimColor>? help</Text>
      </Box>
      <Rule />
      {tab ? (
        <>
          <Text bold wrap="truncate-end">
            {tab.title || "(untitled)"}
          </Text>
          <Text dimColor wrap="truncate-end">
            {tab.url}
          </Text>
        </>
      ) : (
        <Text color="yellow">No tab. Open a page in the pagestill Chrome window.</Text>
      )}
      <Rule />

      {prompt ? (
        <Prompt
          label={prompt.label}
          hint={prompt.hint}
          initial={prompt.initial}
          onCancel={() => setPrompt(undefined)}
          onSubmit={(text) => {
            try {
              prompt.submit(text);
              setPrompt(undefined);
            } catch (e) {
              fail(e);
            }
          }}
        />
      ) : view === "help" ? (
        <Box flexDirection="column">
          <Text>{KEYS_TOPIC.trimEnd()}</Text>
          <Text dimColor>any key to go back</Text>
        </Box>
      ) : view === "tabs" ? (
        <TabsView session={session} onDone={() => setView("main")} />
      ) : view === "settings" ? (
        <SettingsView
          settings={settings}
          onChange={setSettings}
          onEdit={edit}
          onDone={() => setView("main")}
          cursor={settingsCursor}
          setCursor={setSettingsCursor}
        />
      ) : view === "presets" ? (
        <PresetsView
          presets={presets}
          onDone={() => setView("main")}
          onLoad={(name) => {
            const next = mergeSettings(settings, presets[name]);
            setSettings(next);
            setPreset({ label: name, snapshot: JSON.stringify(next) });
            setMessage({ text: `Loaded preset "${name}"` });
            setView("main");
          }}
          onDelete={(name) => {
            const { [name]: _, ...rest } = presets;
            persistPresets(rest);
          }}
          onSaveAs={() =>
            setPrompt({
              label: "Preset name:",
              initial: preset?.label ?? "",
              submit: (name) => {
                const n = name.trim();
                if (!n) throw new Error("Name is required");
                // the workspace folder belongs to where you work, not to a preset
                const { out: _, ...p } = diffSettings(settings, DEFAULT_SETTINGS);
                persistPresets({ ...presets, [n]: p });
                setPreset({ label: n, snapshot: JSON.stringify(settings) });
                setMessage({ text: `Saved preset "${n}"` });
              },
            })
          }
        />
      ) : (
        <Box flexDirection="column">
          <SettingsGrid settings={settings} recording={recording} recordedCount={recorded.length} auto={autoCapture} />
          <Text dimColor>
            {preset ? `preset: ${preset.label}${presetChanged ? " (changed)" : ""}` : "no preset"}
            {isRestored ? "   ·   restored last session · R reset" : ""}
          </Text>
        </Box>
      )}

      {view === "main" && !prompt && (
        <>
          {(recording || recorded.length > 0) && (
            <>
              <Rule />
              <Text dimColor>
                RECORDED {recorded.length}
                {recording ? "" : " (paused · r to resume and save)"}
              </Text>
              {recorded.slice(-3).map((r) => (
                <Text key={r.url} wrap="truncate-end">
                  {"  "}
                  {r.url}
                  <Text dimColor>
                    {" "}
                    {r.title}
                    {r.inPage ? " · reached in-page" : ""}
                  </Text>
                </Text>
              ))}
            </>
          )}
          <Rule />
          <Text dimColor>RECENT → {show(shots)}/</Text>
          {recent.length === 0 ? (
            <Text dimColor>  nothing yet</Text>
          ) : (
            recent.map((r, i) => <RecentLine key={i} result={r} />)
          )}
        </>
      )}
      <Rule />
      {busy ? (
        <Text color="yellow">● {busy}…</Text>
      ) : message ? (
        <Text color={message.error ? "red" : "green"} wrap="wrap">
          {message.error ? "✗ " : ""}
          {message.text}
        </Text>
      ) : (
        <Text> </Text>
      )}
      {view === "main" && !prompt && (
        <Text dimColor wrap="truncate-end">
          <K k="⏎" /> capture <K k="t" /> tab <K k="r" /> record <K k="u" /> auto <K k="e" /> settings <K k="p" /> presets <K k="g" /> folder <K k="q" /> quit
        </Text>
      )}
    </Box>
  );
}

function K({ k }: { k: string }) {
  return (
    <Text color="white">
      {"  "}
      {k}
    </Text>
  );
}

function Rule() {
  return <Text dimColor>{"─".repeat(Math.min(process.stdout.columns || 80, 100))}</Text>;
}

/** Main-screen value: area shows the element, format shows the quality when it matters. */
function mainShow(f: Field, s: CaptureSettings): string {
  if (f.id === "area" && s.area === "element") return `element ${s.element || "(none: A)"}`;
  if (f.id === "format" && s.format !== "png") return `${s.format} q${s.quality}`;
  if (f.id === "lazyLoad") return `lazy load ${s.lazyLoad ? "on" : "off"}`;
  return f.show(s);
}

function SettingsGrid({
  settings,
  recording,
  recordedCount,
  auto,
}: {
  settings: CaptureSettings;
  recording: boolean;
  recordedCount: number;
  auto: boolean;
}) {
  const modes = [
    <Text key="r">
      <Text color="cyan">r</Text> Record {recording ? <Text color="red">on · {recordedCount}</Text> : "off"}
    </Text>,
    <Text key="u">
      <Text color="cyan">u</Text> Auto {auto ? <Text color="yellow">on</Text> : "off"}
    </Text>,
  ];
  return (
    <Box flexDirection="column">
      {MAIN_GROUPS.map((g, i) => (
        <Box key={g.title}>
          <Box width={10}>
            <Text dimColor>{g.title}</Text>
          </Box>
          <Box width={56}>
            <Text wrap="truncate-end">
              {mainFields(g.group)
                .filter((f) => f.key1)
                .map((f) => (
                  <Text key={f.id}>
                    <Text color="cyan">{f.key1}</Text> <Text bold>{mainShow(f, settings)}</Text>
                    {"   "}
                  </Text>
                ))}
            </Text>
          </Box>
          <Box width={8}>
            <Text dimColor>{i === 0 ? "MODES" : ""}</Text>
          </Box>
          {modes[i] ?? null}
        </Box>
      ))}
    </Box>
  );
}

function RecentLine({ result }: { result: CaptureResult }) {
  return (
    <Text wrap="truncate-end">
      <Text color="green">  ✓ </Text>
      {result.files
        .map((f) => `${basename(f.path)}${f.width ? ` ${f.width}×${f.height}` : ""} ${formatBytes(f.bytes)}`)
        .join(" · ")}
      <Text dimColor> {(result.durationMs / 1000).toFixed(1)}s</Text>
    </Text>
  );
}

/** Relative to cwd when inside it, absolute otherwise. */
function show(p: string): string {
  const r = relative(process.cwd(), p);
  return !r || r.startsWith("..") ? p : r;
}

function openFolder(dir: string) {
  mkdirSync(dir, { recursive: true });
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
}
