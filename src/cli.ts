// NO_COLOR (no-color.org): the color library used by the interactive screen only checks
// FORCE_COLOR, and reads it when first imported, so set it before anything loads it.
if (process.env.NO_COLOR && process.env.FORCE_COLOR === undefined) process.env.FORCE_COLOR = "0";

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { Command, Option } from "commander";
import { getArchiver } from "./archivers/index.js";
import {
  type BrowserFlags,
  addBrowserOptions,
  addCaptureOptions,
  connectOptions,
  settingsFromFlags,
} from "./cli/options.js";
import { LISTS_TOPIC, keysTopic, settingsTopic } from "./cli/topics.js";
import { capture } from "./core/capture.js";
import { CONFIG_PATH, type Config, loadConfig, presetNames, resolveSettings } from "./core/config.js";
import { applyEmulation, emulationKey } from "./core/emulation.js";
import { localDateTime, localStamp } from "./core/filename.js";
import { formatBytes } from "./core/format.js";
import { BrowserSession } from "./core/session.js";
import { warnOnce } from "./core/warn.js";
import { workspace } from "./core/workspace.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

type CaptureFlags = Record<string, unknown> & { preset?: string };

/** Relative to cwd when inside it, absolute otherwise. */
const show = (p: string) => {
  const r = relative(process.cwd(), p);
  return !r || r.startsWith("..") ? p : r;
};

async function connect(config: Config, flags: BrowserFlags, engine: string, url?: string) {
  const archiver = await getArchiver(engine);
  return BrowserSession.connect(connectOptions(flags, config.browser, url), (page) => archiver.prepare?.(page));
}

const program = new Command()
  .name("pagestill")
  .usage("[options] [command]")
  .description(
    "Capture the page you're looking at, exactly as it is: screenshots and single-file HTML snapshots from a live Chrome session.\n\n" +
      "With no command, opens the interactive screen. Browse and log in in the pagestill Chrome window, then press ⏎ in the terminal (or Alt+Shift+S in the page).",
  )
  .version(version)
  .showHelpAfterError()
  .enablePositionalOptions()
  .helpCommand(false);

const examplesRoot = `
Examples:
  pagestill                              interactive
  pagestill shot --viewport 390x844m --dpr 3
  pagestill crawl https://admin.acme.com --scope /admin
  pagestill run pagestill-out/lists/admin-acme-com-20261014-141500.pages.yaml

More: pagestill help settings | lists | keys | browser
Files: ./pagestill-out/{shots,lists,runs}  ·  config: ${CONFIG_PATH}`;

// ---- interactive (no command)
addBrowserOptions(addCaptureOptions(program))
  .addHelpText("after", examplesRoot)
  .action(async (flags: CaptureFlags & BrowserFlags) => {
    const config = loadConfig();
    const presets = presetNames(flags.preset);
    const patch = settingsFromFlags(flags);
    const engine = resolveSettings(config, presets, patch).htmlEngine;
    const { runTui } = await import("./tui/run.js");
    await runTui({ config, presets, flags: patch, version, connect: () => connect(config, flags, engine) });
  });

// ---- shot
addBrowserOptions(addCaptureOptions(program.command("shot")))
  .description("capture the current tab now")
  .addOption(new Option("--tab <n|text>", "tab number from `pagestill browser tabs`, or part of its URL/title"))
  .addHelpText(
    "after",
    `
Captures the tab the pagestill Chrome window has in front, unless --tab picks another.
All settings have flags: pagestill help settings

Output:
  <out>/shots/<name>.png and .html; the paths are printed on stdout.

Examples:
  pagestill shot
  pagestill shot --no-html --format webp --quality 85
  pagestill shot --element '#chart' --tab dashboard
  pagestill shot --preset mobile,dark -o ~/captures`,
  )
  .action(async (flags: CaptureFlags & BrowserFlags & { tab?: string }) => {
    const config = loadConfig();
    const settings = resolveSettings(config, presetNames(flags.preset), settingsFromFlags(flags));
    const session = await connect(config, flags, settings.htmlEngine);
    try {
      const page = pickTab(session, flags.tab);
      if (!page) throw new Error(flags.tab ? `No tab matches "${flags.tab}" (see: pagestill browser tabs)` : "No tab to capture");
      const res = await capture(session, page, settings, { log: (m) => process.stderr.write(`· ${m}\n`) });
      for (const w of res.warnings) process.stderr.write(`! ${w}\n`);
      for (const f of res.files) {
        const dims = f.width ? ` ${f.width}×${f.height}` : "";
        process.stdout.write(`${show(f.path)}${dims} ${formatBytes(f.bytes)}\n`);
      }
    } finally {
      await session.disconnect();
    }
  });

// ---- run
addBrowserOptions(addCaptureOptions(program.command("run")))
  .description("capture every page in a page list")
  .argument("<list>", "a .pages.yaml file (see: pagestill help lists)")
  .addOption(new Option("-c, --concurrency <n>", "pages captured in parallel (default: from the list, else 1)"))
  .addOption(new Option("--resume <run-dir>", "continue a previous run; finished captures are kept"))
  .addOption(new Option("--only <glob>", "capture only pages whose URL path or name matches, e.g. '/admin/**'"))
  .addHelpText(
    "after",
    `
Capture options override the list's settings for this run; a flag replaces the
matching matrix axis. All settings have flags: pagestill help settings

While running:
  A page that lands on a login screen pauses every window and asks you to log in
  (⏎ continue · s skip page · q stop). Pages that answer with an HTTP error or end
  on a different URL are marked "check" instead of "ok".

Output:
  <out>/runs/<list>-<time>/
    index.html       gallery
    manifest.json    status of every capture (used by --resume)
    <page>/<variant>.png|.html

Exit status: 0 all ok · 2 something failed, was skipped or needs checking

Examples:
  pagestill run admin.pages.yaml
  pagestill run admin.pages.yaml --viewport 390x844m --theme dark
  pagestill run admin.pages.yaml --only '/settings/**'
  pagestill run admin.pages.yaml --resume pagestill-out/runs/admin-20261014-143000`,
  )
  .action(async (listPath: string, flags: CaptureFlags & BrowserFlags & { concurrency?: string; resume?: string; only?: string }) => {
    const { loadPageList } = await import("./batch/pagelist.js");
    const { runPageList } = await import("./batch/runner.js");
    const { reportRun, askLogin } = await import("./batch/console.js");
    const config = loadConfig();
    const list = loadPageList(listPath);
    const presets = presetNames(flags.preset);
    const patch = settingsFromFlags(flags);
    const engine = resolveSettings(config, [...list.presets, ...presets], list.settings, patch).htmlEngine;
    const session = await connect(config, flags, engine);
    try {
      const summary = await runPageList({
        session,
        list,
        listPath,
        config,
        presets,
        flags: patch,
        only: flags.only,
        runDir: flags.resume,
        concurrency: flags.concurrency ? Number(flags.concurrency) : undefined,
        onEvent: reportRun,
        onLogin: askLogin,
      });
      if (summary.check || summary.failed || summary.skipped || summary.aborted) process.exitCode = 2;
    } finally {
      await session.disconnect();
    }
  });

// ---- crawl
interface CrawlFlags extends CaptureFlags, BrowserFlags {
  depth: string;
  max: string;
  sample: string;
  scope?: string;
  include?: string[];
  exclude?: string[];
  sitemap?: boolean;
  login?: string;
  loginPattern?: string;
  concurrency: string;
  save?: string;
  capture?: boolean;
  followUnsafe?: boolean;
  defaultExcludes?: boolean;
}

addBrowserOptions(addCaptureOptions(program.command("crawl")))
  .description("build a page list by following links")
  .argument("[url]", "where to start (default: the current tab)")
  .addOption(new Option("-d, --depth <n>", "link hops from the start page").default("3"))
  .addOption(new Option("-m, --max <n>", "pages to visit at most").default("200"))
  .addOption(new Option("-s, --sample <n>", "pages kept per URL pattern").default("1"))
  .addOption(new Option("--scope <path>", "only follow URLs under this path"))
  .addOption(new Option("--include <globs...>", "only follow matching URLs, e.g. '/admin/**'"))
  .addOption(new Option("--exclude <globs...>", "never follow matching URLs"))
  .addOption(new Option("--sitemap", "also start from /sitemap.xml"))
  .addOption(new Option("--login <text|/re/>", 'URLs that mean "logged out" (default: auto-detect)'))
  .addOption(new Option("-c, --concurrency <n>", "pages loaded in parallel").default("2"))
  .addOption(new Option("--save <file>", "where to write the list (default: <out>/lists/<host>-<time>.pages.yaml)"))
  .addOption(new Option("--capture", "capture every visited page too (like run)"))
  .addOption(new Option("--follow-unsafe", "also follow logout/delete/download links (careful)"))
  .addOption(new Option("--login-pattern <text>").hideHelp())
  .addOption(new Option("--no-default-excludes").hideHelp())
  .addHelpText(
    "after",
    `
Pages that share a URL pattern (/users/42, /users/7 → /users/:id) are sampled,
not all visited. Never followed unless --follow-unsafe: logout, sign-out, delete,
remove, destroy, unsubscribe, and file downloads (.pdf, .zip, images, ...).

Capture options apply with --capture. All settings: pagestill help settings

Output:
  <out>/lists/<host>-<time>.pages.yaml   (path printed on stdout)
  with --capture, also <out>/runs/<host>-<time>/

Examples:
  pagestill crawl
  pagestill crawl https://admin.acme.com --scope /admin --depth 2
  pagestill crawl https://acme.com --include '/docs/**' --capture --viewport 1280x800
  pagestill run "$(pagestill crawl https://acme.com)"`,
  )
  .action(async (url: string | undefined, flags: CrawlFlags) => {
    const { crawl, crawlEntries } = await import("./batch/crawler.js");
    const { LIST_SUFFIX, pageName, writePageList } = await import("./batch/pagelist.js");
    const { RunWriter, entryKey, navigationChecks } = await import("./batch/runner.js");
    const { askLogin } = await import("./batch/console.js");
    if (flags.loginPattern) warnOnce("--login-pattern is now --login (the old flag works until v0.5)");
    if (flags.defaultExcludes === false) warnOnce("--no-default-excludes is now --follow-unsafe (the old flag works until v0.5)");
    // Before 0.4, crawl's -o was the list file; -o is now the workspace everywhere.
    const out = typeof flags.out === "string" ? flags.out : undefined;
    if (out && /\.ya?ml$/i.test(out) && !flags.save) {
      warnOnce(`crawl -o <file> is now --save <file>; -o is the workspace folder (the old form works until v0.5)`);
      flags.save = out;
      delete flags.out;
    }
    const config = loadConfig();
    const settings = resolveSettings(config, presetNames(flags.preset), settingsFromFlags(flags));
    const ws = workspace(settings.out);
    const session = await connect(config, flags, settings.htmlEngine);
    try {
      const start = url ?? session.active?.url();
      if (!start || !/^https?:/.test(start)) throw new Error("Give a start URL, or open the site in the current tab");
      const host = new URL(start).hostname;
      const stamp = localStamp();
      process.stderr.write(`Crawling ${start}\n`);

      let writer: InstanceType<typeof RunWriter> | undefined;
      if (flags.capture) {
        writer = new RunWriter(join(ws.runs, `${host.replace(/\./g, "-")}-${stamp}`), { listName: `crawl ${host}` });
        process.stderr.write(`Capturing into ${show(writer.dir)}\n`);
      }
      const key = emulationKey(settings);
      const used = new Set<string>();

      const result = await crawl({
        session,
        start,
        maxDepth: Number(flags.depth),
        maxPages: Number(flags.max),
        sample: Number(flags.sample),
        scope: flags.scope,
        include: flags.include,
        exclude: flags.exclude,
        followUnsafe: flags.followUnsafe || flags.defaultExcludes === false,
        sitemap: flags.sitemap,
        login: flags.login ?? flags.loginPattern,
        concurrency: Number(flags.concurrency),
        onLogin: askLogin,
        onWindow: writer ? async (page) => applyEmulation(await session.cdp(page), settings) : undefined,
        onPage: writer
          ? async (page, visited, nav) => {
              const wanted = pageName(visited.finalUrl, `${new URL(start).origin}/`);
              let name = wanted;
              for (let i = 2; used.has(name); i++) name = `${wanted}-${i}`;
              used.add(name);
              const started = Date.now();
              const res = await capture(session, page, settings, { keepEmulation: true, appliedEmulation: key, dir: writer!.dir, name: `${name}/capture` });
              await writer!.record(
                writer!.entryFrom({ key: entryKey(name, "capture"), page: name, url: visited.url, variant: "capture" }, res, {
                  finalUrl: nav.finalUrl,
                  checks: navigationChecks(visited.url, nav).filter((c) => c.startsWith("HTTP")),
                  warnings: nav.warnings,
                }, started),
              );
            }
          : undefined,
        onEvent: (e) => {
          if (e.type === "page") {
            const p = e.page;
            const mark = p.status === "ok" ? (p.error ? "!" : "✓") : p.status === "redirected" ? "↪" : "✗";
            const extra = p.status === "ok" ? `${p.links} links${p.error ? ` · ${p.error}` : ""}` : (p.error ?? p.status);
            process.stderr.write(`[${e.visited}] ${mark} ${new URL(p.url).pathname}${new URL(p.url).search}  ${extra}\n`);
          } else if (e.type === "info") process.stderr.write(`${e.message}\n`);
        },
      });

      const file = flags.save ?? join(ws.lists, `${host.replace(/\./g, "-")}-${stamp}${LIST_SUFFIX}`);
      mkdirSync(join(file, ".."), { recursive: true });
      const entries = crawlEntries(result);
      const total = [...result.discovered.values()].reduce((n, l) => n + l.length, 0);
      writePageList(file, {
        base: `${new URL(result.start).origin}/`,
        header: [
          ` Generated by pagestill crawl ${result.start} on ${localDateTime()}`,
          ` ${result.pages.length} pages visited, ${total} URLs in ${result.discovered.size} patterns${result.truncated ? " (stopped at --max)" : ""}.`,
          " Untick pages with `pagestill edit <this file>` (or set `skip: true`),",
          " add matrix:/settings:/load: as needed (pagestill help lists), then: pagestill run <this file>",
        ].join("\n"),
        entries,
      });
      process.stdout.write(`${show(file)}\n`);
      process.stderr.write(`${entries.filter((e) => !e.skip).length} pages listed${result.aborted ? " (aborted)" : ""}\n`);
      if (writer) {
        const s = writer.finish(result.aborted);
        process.stderr.write(`${s.ok} captured${s.check ? `, ${s.check} to check` : ""} · gallery: ${show(join(s.runDir, "index.html"))}\n`);
      }
    } finally {
      await session.disconnect();
    }
  });

// ---- edit
program
  .command("edit")
  .description("choose which pages of a list to capture")
  .argument("<list>", "a .pages.yaml file")
  .addHelpText(
    "after",
    `
Unticked pages stay in the file with \`skip: true\`; comments and formatting are kept.

Keys:
  ↑ ↓ / j k     move               space   tick / untick
  g             tick / untick the whole pattern group
  a             tick all / untick all
  E             open the file in $EDITOR, reload when it closes
  w             save               q       quit (asks if unsaved)`,
  )
  .action(async (listPath: string) => {
    const { runEditList } = await import("./tui/EditList.js");
    await runEditList(listPath);
  });

// ---- browser
async function browserOpen(url: string | undefined, flags: BrowserFlags) {
  const config = loadConfig();
  const session = await BrowserSession.connect(connectOptions(flags, config.browser, url));
  if (url && !session.launched) await (await session.browser.newPage()).goto(url).catch(() => {});
  process.stdout.write(`Chrome ready at ${session.endpoint}\n`);
  await session.disconnect();
}

async function browserTabs(flags: BrowserFlags) {
  const config = loadConfig();
  const session = await BrowserSession.connect(connectOptions(flags, config.browser));
  try {
    session.listTabs().forEach((t, i) => {
      const mark = t.page === session.active ? "★" : " ";
      process.stdout.write(`${mark} ${i}  ${t.title || "(untitled)"}\n     ${t.url}\n`);
    });
  } finally {
    await session.disconnect();
  }
}

const browserHelp = `
By default pagestill starts its own Chrome with a separate profile
(~/.pagestill/chrome-profile) where your logins persist, or attaches to it if it's
already running. The browser options work with every command.

Environment:
  PAGESTILL_CHROME_ARGS   extra flags for the launched Chrome, e.g. --proxy-server=...`;

const browser = program
  .command("browser")
  .description("open the pagestill Chrome, list its tabs")
  .usage("<command> [options]")
  .addHelpText("after", browserHelp);
addBrowserOptions(browser.command("open").description("open the pagestill Chrome (and a URL), then exit").argument("[url]"), { full: true }).action(
  browserOpen,
);
addBrowserOptions(browser.command("tabs").description("list its tabs; ★ = the tab `shot` would capture"), { full: true }).action(browserTabs);
browser.action(() => browser.help());

// pre-0.4 names
addBrowserOptions(program.command("open", { hidden: true }).argument("[url]")).action(async (url: string | undefined, flags: BrowserFlags) => {
  warnOnce("`pagestill open` is now `pagestill browser open` (the old name works until v0.5)");
  await browserOpen(url, flags);
});
addBrowserOptions(program.command("tabs", { hidden: true })).action(async (flags: BrowserFlags) => {
  warnOnce("`pagestill tabs` is now `pagestill browser tabs` (the old name works until v0.5)");
  await browserTabs(flags);
});

// ---- help [topic]
program
  .command("help")
  .description("settings | lists | keys | browser")
  .argument("[topic]", "a topic, or a command name")
  .action((topic?: string) => {
    const topics: Record<string, () => string> = {
      settings: settingsTopic,
      lists: () => LISTS_TOPIC,
      keys: keysTopic,
    };
    if (!topic) return program.help();
    if (topics[topic]) return void process.stdout.write(topics[topic]!());
    const cmd = program.commands.find((c) => c.name() === topic);
    if (cmd) return cmd.help();
    throw new Error(`No help for "${topic}". Topics: settings, lists, keys, browser; or a command name.`);
  });

// group the root help's commands like help.md
for (const c of program.commands) c.helpGroup("Commands:");

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
