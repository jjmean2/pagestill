import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Page } from "puppeteer-core";
import { type CaptureResult, capture } from "../core/capture.js";
import { type Config, diffFromDefaults, saveConfig } from "../core/config.js";
import { PASSTHROUGH_KEY, applyEmulation, clearEmulation, emulationKey } from "../core/emulation.js";
import { formatBytes } from "../core/format.js";
import type { BrowserSession } from "../core/session.js";
import { type CaptureSettings, mergeSettings, withOutputMode } from "../core/settings.js";
import { type Field, HOTKEY_FIELDS } from "./fields.js";
import { PresetsView } from "./PresetsView.js";
import { Prompt } from "./Prompt.js";
import { SettingsView } from "./SettingsView.js";
import { TabsView } from "./TabsView.js";

type View = "main" | "tabs" | "settings" | "presets";
type PromptState = { label: string; hint?: string; initial: string; submit: (text: string) => void };

export interface AppProps {
  session: BrowserSession;
  initialSettings: CaptureSettings;
  config: Config;
  version: string;
  onSettings: (s: CaptureSettings) => void;
}

export function App({ session, initialSettings, config, version, onSettings }: AppProps) {
  const { exit } = useApp();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [settings, setSettingsState] = useState(initialSettings);
  const [view, setView] = useState<View>("main");
  const [prompt, setPrompt] = useState<PromptState>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [recent, setRecent] = useState<CaptureResult[]>([]);
  const [presets, setPresets] = useState(config.presets ?? {});
  const busyRef = useRef(false);
  const settingsRef = useRef(settings);
  /** Emulation key currently applied per page (WYSIWYG: the browser shows what will be captured). */
  const applied = useRef(new Map<Page, string>());
  const emuChain = useRef(Promise.resolve());

  const setSettings = useCallback(
    (s: CaptureSettings) => {
      settingsRef.current = s;
      setSettingsState(s);
      onSettings(s);
    },
    [onSettings],
  );

  const fail = (e: unknown) => setMessage({ text: e instanceof Error ? e.message : String(e), error: true });

  // Re-render on tab/focus changes; capture on the in-page hotkey.
  useEffect(() => {
    const onChange = () => rerender();
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

  function persistPresets(next: Record<string, Partial<CaptureSettings>>) {
    setPresets(next);
    config.presets = next;
    try {
      saveConfig(config);
    } catch (e) {
      fail(e);
    }
  }

  useInput(
    (input, key) => {
      if (input === "q") return exit();
      if (key.return) return void runCapture(settings);
      if (input === "s") return void runCapture(withOutputMode(settings, "image"));
      if (input === "h") return void runCapture(withOutputMode(settings, "html"));
      if (input === "t") return setView("tabs");
      if (input === "e") return setView("settings");
      if (input === "p") return setView("presets");
      if (input === "O") return openFolder(settings.outDir);
      const field = HOTKEY_FIELDS.find((f) => f.hotkey === input || f.hotkey?.toUpperCase() === input);
      if (!field) return;
      const shifted = input !== field.hotkey;
      if (shifted || !field.step) return edit(field);
      setSettings(field.step(settings, 1));
    },
    { isActive: view === "main" && !prompt },
  );

  const tab = session.activeTab;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color="cyan">
          pagestill
        </Text>
        <Text dimColor> v{version} </Text>
        <Text color="green">● </Text>
        <Text dimColor>{session.launched ? "launched Chrome" : "attached"} · tab: </Text>
        {session.follow ? <Text color="green">follows focus</Text> : <Text color="yellow">pinned</Text>}
      </Text>
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
      ) : view === "tabs" ? (
        <TabsView session={session} onDone={() => setView("main")} />
      ) : view === "settings" ? (
        <SettingsView settings={settings} onChange={setSettings} onEdit={edit} onDone={() => setView("main")} />
      ) : view === "presets" ? (
        <PresetsView
          presets={presets}
          onDone={() => setView("main")}
          onLoad={(name) => {
            setSettings(mergeSettings(settings, presets[name]));
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
              initial: "",
              submit: (name) => {
                const n = name.trim();
                if (!n) throw new Error("Name is required");
                persistPresets({ ...presets, [n]: diffFromDefaults(settings) });
                setMessage({ text: `Saved preset "${n}"` });
              },
            })
          }
        />
      ) : (
        <SettingsGrid settings={settings} />
      )}

      {view === "main" && !prompt && (
        <>
          <Rule />
          <Text dimColor>RECENT</Text>
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
        <Text dimColor wrap="wrap">
          <Text color="white">⏎</Text> capture  <Text color="white">s</Text> image  <Text color="white">h</Text> html  <Text color="white">t</Text> tab  <Text color="white">e</Text> settings  <Text color="white">p</Text> presets  <Text color="white">O</Text> folder  <Text color="white">q</Text> quit  · in browser: Alt+Shift+S
        </Text>
      )}
    </Box>
  );
}

function Rule() {
  return <Text dimColor>{"─".repeat(Math.min(process.stdout.columns || 80, 100))}</Text>;
}

function SettingsGrid({ settings }: { settings: CaptureSettings }) {
  const cols = 3;
  const rows: Field[][] = [];
  HOTKEY_FIELDS.forEach((f, i) => (rows[i % Math.ceil(HOTKEY_FIELDS.length / cols)] ??= []).push(f));
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Box key={i}>
          {row.map((f) => (
            <Box key={f.label} width={32}>
              <Text wrap="truncate-end">
                <Text color="cyan">[{f.hotkey}]</Text> {f.label.padEnd(8)} <Text bold>{f.show(settings)}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      ))}
      <Text dimColor>lowercase key cycles · Shift+key types a value · e for all settings</Text>
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

function openFolder(dir: string) {
  const path = resolve(dir);
  mkdirSync(path, { recursive: true });
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [path], { detached: true, stdio: "ignore" }).unref();
}
