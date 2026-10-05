import { Command, Option } from "commander";
import { createRequire } from "node:module";
import { relative } from "node:path";
import { archiverIds, getArchiver } from "./archivers/index.js";
import { capture } from "./core/capture.js";
import { DEFAULT_PORT, DEFAULT_PROFILE_DIR } from "./core/chrome.js";
import { CONFIG_PATH, initialSettings, loadConfig } from "./core/config.js";
import { formatBytes } from "./core/format.js";
import { BrowserSession, type ConnectOptions } from "./core/session.js";
import { AREAS, type CaptureSettings, FORMATS, THEMES, parseDpr, parseViewport } from "./core/settings.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

interface ConnectionFlags {
  port?: string;
  launch?: boolean;
  chrome?: string;
  profile?: string;
  ws?: string;
  autoConnect?: boolean;
}

interface CaptureFlags {
  preset?: string;
  out?: string;
  image?: boolean;
  html?: boolean;
  viewport?: string;
  dpr?: string;
  format?: CaptureSettings["format"];
  quality?: string;
  area?: CaptureSettings["area"];
  selector?: string;
  theme?: CaptureSettings["theme"];
  wait?: string;
  hide?: string[];
  lazy?: boolean;
  archiver?: string;
}

function withConnection(cmd: Command): Command {
  return cmd
    .option("--port <n>", `remote debugging port (default: ${DEFAULT_PORT})`)
    .option("--no-launch", "don't launch Chrome if nothing is listening; fail instead")
    .option("--chrome <path>", "Chrome/Chromium executable (or $PAGESTILL_CHROME)")
    .option("--profile <dir>", `profile dir for the launched Chrome (default: ${DEFAULT_PROFILE_DIR})`)
    .option("--ws <url>", "connect to this DevTools websocket endpoint")
    .option("--auto-connect", "experimental: attach to your everyday Chrome (enable chrome://inspect/#remote-debugging)");
}

function withCapture(cmd: Command): Command {
  return cmd
    .option("-p, --preset <name>", "start from a saved preset")
    .option("-o, --out <dir>", "output directory")
    .option("--no-image", "skip the image")
    .option("--no-html", "skip the HTML snapshot")
    .option("--viewport <WxH|as-is>", "emulated viewport, e.g. 1440x900 or 390x844m (mobile)")
    .option("--dpr <n|as-is>", "device pixel ratio, e.g. 2")
    .addOption(new Option("--format <fmt>", "image format").choices(FORMATS))
    .option("--quality <1-100>", "jpeg/webp quality")
    .addOption(new Option("--area <area>", "image area").choices(AREAS))
    .option("--selector <css>", "element to capture (implies --area element)")
    .addOption(new Option("--theme <theme>", "prefers-color-scheme").choices(THEMES))
    .option("--wait <ms>", "delay before capturing")
    .option("--hide <selectors...>", "CSS selectors to hide (cookie banners, chat widgets...)")
    .option("--lazy", "scroll through the page first to load lazy content")
    .addOption(new Option("--archiver <id>", "HTML snapshot engine").choices(archiverIds()));
}

function connectOptions(f: ConnectionFlags, url?: string): ConnectOptions {
  const browser = loadConfig().browser ?? {};
  return {
    port: f.port ? Number(f.port) : browser.port,
    launch: f.launch,
    chromePath: f.chrome ?? browser.chromePath,
    profileDir: f.profile ?? browser.profileDir,
    wsEndpoint: f.ws,
    autoConnect: f.autoConnect,
    url,
  };
}

function settingsFrom(f: CaptureFlags): CaptureSettings {
  const s = initialSettings(loadConfig(), f.preset);
  if (f.out) s.outDir = f.out;
  if (f.image === false) s.image = false;
  if (f.html === false) s.html = false;
  if (f.viewport) s.viewport = parseViewport(f.viewport);
  if (f.dpr) s.dpr = parseDpr(f.dpr);
  if (f.format) s.format = f.format;
  if (f.quality) s.quality = Number(f.quality);
  if (f.area) s.area = f.area;
  if (f.selector) {
    s.selector = f.selector;
    s.area = "element";
  }
  if (f.theme) s.theme = f.theme;
  if (f.wait) s.waitMs = Number(f.wait);
  if (f.hide) s.hideSelectors = f.hide;
  if (f.lazy) s.loadLazy = true;
  if (f.archiver) s.htmlOptions = { ...s.htmlOptions, archiver: f.archiver };
  return s;
}

async function connect(f: ConnectionFlags, archiver: string, url?: string) {
  const engine = await getArchiver(archiver);
  return BrowserSession.connect(connectOptions(f, url), (page) => engine.prepare?.(page));
}

const program = new Command()
  .name("pagestill")
  .description("Capture the page you're looking at: screenshots and single-file HTML snapshots from a live Chrome.")
  .version(version)
  .showHelpAfterError()
  .enablePositionalOptions();

withCapture(withConnection(program))
  .addHelpText(
    "after",
    `
With no command, starts the interactive TUI. pagestill opens (or attaches to) a Chrome with
remote debugging; browse and log in there, then capture from the terminal or press
Alt+Shift+S in the page.

Config and presets: ${CONFIG_PATH}`,
  )
  .action(async (flags: ConnectionFlags & CaptureFlags) => {
    const settings = settingsFrom(flags);
    const { runTui } = await import("./tui/run.js");
    await runTui({ settings, version, connect: () => connect(flags, settings.htmlOptions.archiver) });
  });

withCapture(withConnection(program.command("shot")))
  .description("capture the active tab once and exit")
  .option("--tab <n|text>", "tab index (from `pagestill tabs`) or a substring of its URL/title")
  .action(async (flags: ConnectionFlags & CaptureFlags & { tab?: string }) => {
    const settings = settingsFrom(flags);
    const session = await connect(flags, settings.htmlOptions.archiver);
    try {
      const page = pickTab(session, flags.tab);
      if (!page) throw new Error("No tab to capture");
      const res = await capture(session, page, settings, { log: (m) => process.stderr.write(`· ${m}\n`) });
      for (const w of res.warnings) process.stderr.write(`! ${w}\n`);
      for (const f of res.files) {
        const dims = f.width ? ` ${f.width}×${f.height}` : "";
        process.stdout.write(`${relative(process.cwd(), f.path) || f.path}${dims} ${formatBytes(f.bytes)}\n`);
      }
    } finally {
      await session.disconnect();
    }
  });

withConnection(program.command("tabs"))
  .description("list open tabs (★ = the one pagestill would capture)")
  .action(async (flags: ConnectionFlags) => {
    const session = await BrowserSession.connect(connectOptions(flags));
    try {
      session.listTabs().forEach((t, i) => {
        const mark = t.page === session.active ? "★" : " ";
        process.stdout.write(`${mark} ${i}  ${t.title || "(untitled)"}\n     ${t.url}\n`);
      });
    } finally {
      await session.disconnect();
    }
  });

withConnection(program.command("open"))
  .description("open the pagestill Chrome (dedicated profile with remote debugging) and exit")
  .argument("[url]", "page to open")
  .action(async (url: string | undefined, flags: ConnectionFlags) => {
    const session = await BrowserSession.connect(connectOptions(flags, url));
    if (url && !session.launched) await (await session.browser.newPage()).goto(url).catch(() => {});
    process.stdout.write(`Chrome ready at ${session.endpoint}\n`);
    await session.disconnect();
  });

function pickTab(session: BrowserSession, query?: string) {
  if (!query) return session.active;
  const tabs = session.listTabs();
  if (/^\d+$/.test(query)) return tabs[Number(query)]?.page;
  const q = query.toLowerCase();
  return tabs.find((t) => t.url.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))?.page;
}

program.parseAsync().catch((e: unknown) => {
  process.stderr.write(`pagestill: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
