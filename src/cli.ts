import { Command, Option } from "commander";
import { createRequire } from "node:module";
import { relative } from "node:path";
import { archiverIds, getArchiver } from "./archivers/index.js";
import { capture } from "./core/capture.js";
import { DEFAULT_PORT, DEFAULT_PROFILE_DIR } from "./core/chrome.js";
import { CONFIG_PATH, initialSettings, loadConfig } from "./core/config.js";
import { localDateTime, localStamp } from "./core/filename.js";
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

withConnection(program.command("run"))
  .description("capture every page listed in a job file (see README: Batch capture)")
  .argument("<job>", "job YAML file")
  .option("--resume <runDir>", "continue a previous run; pages already captured are skipped")
  .option("-c, --concurrency <n>", "pages captured in parallel, each in its own window")
  .option("-o, --out <dir>", "output root (a run folder is created inside)")
  .action(async (jobPath: string, flags: ConnectionFlags & { resume?: string; concurrency?: string; out?: string }) => {
    const { loadJob } = await import("./batch/job.js");
    const { runJob } = await import("./batch/runner.js");
    const { reportRun, askLogin } = await import("./batch/console.js");
    const job = loadJob(jobPath);
    if (flags.out) job.out = flags.out;
    const config = loadConfig();
    const session = await connect(flags, job.settings?.htmlOptions?.archiver ?? "singlefile");
    try {
      const { manifest } = await runJob({
        session,
        job,
        jobPath,
        config,
        runDir: flags.resume,
        concurrency: flags.concurrency ? Number(flags.concurrency) : undefined,
        onEvent: reportRun,
        onLogin: askLogin,
      });
      if (Object.values(manifest.entries).some((e) => e.status !== "ok")) process.exitCode = 2;
    } finally {
      await session.disconnect();
    }
  });

withConnection(program.command("crawl"))
  .description("crawl a site in your logged-in browser and write an editable job file")
  .argument("[url]", "start URL (default: the active tab)")
  .option("-d, --depth <n>", "link hops from the start page", "3")
  .option("-m, --max <n>", "pages to visit at most", "200")
  .option("-s, --sample <n>", "pages kept per URL pattern such as /users/:id", "1")
  .option("--scope <path>", "only follow URLs under this path prefix")
  .option("--include <globs...>", "only follow matching URLs (e.g. '/admin/**')")
  .option("--exclude <globs...>", "never follow matching URLs (logout/delete/files are always excluded)")
  .option("--no-default-excludes", "also follow logout/delete/download links (careful)")
  .option("--sitemap", "also read /sitemap.xml")
  .option("--login-pattern <text|/re/>", "final URLs that mean 'logged out'")
  .option("-c, --concurrency <n>", "pages loaded in parallel", "2")
  .option("-o, --out <file>", "job file to write (default: pages-<host>-<time>.yaml)")
  .action(
    async (
      url: string | undefined,
      flags: ConnectionFlags & {
        depth: string;
        max: string;
        sample: string;
        scope?: string;
        include?: string[];
        exclude?: string[];
        defaultExcludes: boolean;
        sitemap?: boolean;
        loginPattern?: string;
        concurrency: string;
        out?: string;
      },
    ) => {
      const { crawl, crawlEntries } = await import("./batch/crawler.js");
      const { writeJobFile } = await import("./batch/job.js");
      const { askLogin } = await import("./batch/console.js");
      const session = await BrowserSession.connect(connectOptions(flags));
      try {
        const start = url ?? session.active?.url();
        if (!start || !/^https?:/.test(start)) throw new Error("Give a start URL, or open the site in the active tab");
        process.stderr.write(`Crawling ${start}\n`);
        const result = await crawl({
          session,
          start,
          maxDepth: Number(flags.depth),
          maxPages: Number(flags.max),
          sample: Number(flags.sample),
          scope: flags.scope,
          include: flags.include,
          exclude: flags.exclude,
          noDefaultExcludes: !flags.defaultExcludes,
          sitemap: flags.sitemap,
          loginPattern: flags.loginPattern,
          concurrency: Number(flags.concurrency),
          onLogin: askLogin,
          onEvent: (e) => {
            if (e.type === "page") {
              const p = e.page;
              const mark = p.status === "ok" ? "✓" : p.status === "redirected" ? "↪" : "✗";
              const extra = p.status === "ok" ? `${p.links} links` : (p.error ?? p.status);
              process.stderr.write(`[${e.visited}] ${mark} ${new URL(p.url).pathname}${new URL(p.url).search}  ${extra}\n`);
            } else if (e.type === "info") process.stderr.write(`${e.message}\n`);
          },
        });
        const host = new URL(result.start).hostname;
        const file = flags.out ?? `pages-${host}-${localStamp()}.yaml`;
        const entries = crawlEntries(result);
        const total = [...result.discovered.values()].reduce((n, l) => n + l.length, 0);
        writeJobFile(file, {
          base: `${new URL(result.start).origin}/`,
          header: [
            ` Generated by pagestill crawl ${result.start} on ${localDateTime()}`,
            ` ${result.pages.length} pages visited, ${total} URLs in ${result.discovered.size} patterns${result.truncated ? " (stopped at --max)" : ""}.`,
            " Edit freely: delete entries or mark them `skip: true` (or use `pagestill edit`).",
            " Add matrix:/settings:/wait: as needed, then: pagestill run <this file>",
          ].join("\n"),
          entries,
        });
        process.stdout.write(`${file}\n`);
        process.stderr.write(`${entries.filter((e) => !e.skip).length} pages listed${result.aborted ? " (aborted)" : ""}\n`);
      } finally {
        await session.disconnect();
      }
    },
  );

program
  .command("edit")
  .description("tick which pages of a job file to capture (keeps comments; E opens $EDITOR)")
  .argument("<job>", "job YAML file")
  .action(async (jobPath: string) => {
    const { runEditJob } = await import("./tui/EditJob.js");
    await runEditJob(jobPath);
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
