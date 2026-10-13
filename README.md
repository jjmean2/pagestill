# pagestill

Capture the page you're looking at, exactly as it is right now:

- **Screenshots** (PNG / JPEG / WebP) of the viewport, the full page, or one element, at any viewport size and pixel density.
- **HTML snapshots**: one self-contained `.html` file holding the current DOM, styles, images, fonts and frames. Open it anywhere, offline, and the page looks the same.

pagestill doesn't open URLs on its own to take a picture. It attaches to a Chrome window **you** drive, so it captures pages behind logins, client-side rendering, opened menus, typed-in forms, and anything else that only exists in your live session. When you want many pages, it can also visit a list of URLs for you in that same logged-in browser.

## Install

```sh
pnpm add -g https://github.com/jjmean2/pagestill/releases/download/v0.3.0/pagestill-0.3.0.tgz
```

Pick the latest version on the [releases page](https://github.com/jjmean2/pagestill/releases). Requires Node 22+ and Google Chrome (or Chromium / Edge / Brave).

## Quick start

```sh
pagestill
```

1. pagestill opens a Chrome window with its own profile (`~/.pagestill/chrome-profile`). Logins you make there are kept for next time.
2. Browse to the page you want, log in, click around until it looks right.
3. Press **⏎** in the terminal, or **Alt+Shift+S** in the page.

Files go to `./pagestill-out/shots/`. pagestill follows the tab you're looking at; press `t` to pin one.

## Five ideas

| | |
|---|---|
| **Browser** | The Chrome pagestill reads from. By default its own window and profile; it can also attach to one you started. |
| **Capture** | Saving the current screen as an image and/or an HTML snapshot. |
| **Settings** | *How* to capture: viewport, DPR, theme, format, elements to hide… Named sets are **presets**. |
| **Page list** | *What* to capture: a `*.pages.yaml` file of URLs (made by crawling, recording, or by hand). |
| **Run** | Capturing every page of a list, in every combination you ask for, into one folder with a gallery. |

Three ways to capture:

| | who opens the page | use it for | result |
|---|---|---|---|
| **Shot** (`⏎`, `pagestill shot`) | you | this screen, right now, in whatever state it's in | `shots/` |
| **Auto** (`u` in the screen) | you | capture as you browse | `shots/` |
| **Run** (`pagestill run`) | pagestill | the same pages again and again, in many variants | `runs/<run>/` |

Shot and Auto capture the live state, including things only clicking gets you to. Run reopens each URL, so it can repeat itself, but a state that isn't in the URL (an open modal, a selected tab) needs `steps:` in the page list.

## The interactive screen

```
 pagestill 0.4.0 · Chrome (pagestill) · following the tab in front      ? help
 ─────────────────────────────────────────────────────────────────────────────
 Users – Acme Admin
 https://admin.acme.com/users?page=2
 ─────────────────────────────────────────────────────────────────────────────
 SAVE      o image + HTML                              MODES   r Record off
 EMULATE   v 1440×900   d 2x   m dark                          u Auto off
 PREPARE   w 500ms   x .cookie-banner   l lazy load off
 IMAGE     a full page   f png
 preset: retina (changed)   ·   restored last session · R reset
 ─────────────────────────────────────────────────────────────────────────────
 RECENT → pagestill-out/shots/
   ✓ 20261014-142011_admin-acme-com_users.png 2880×9970 3.1MB · .html 841KB
 ─────────────────────────────────────────────────────────────────────────────
   ⏎ capture   t tab   r record   u auto   e settings   p presets   g folder   q quit
```

- Lowercase keys cycle a setting, **Shift** types a value: `v`/`V` viewport, `d`/`D` DPR, `w`/`W` delay, `x`/`X` elements to hide, `a`/`A` area/element, `f`/`F` format/quality, `m` theme, `l` lazy load, `o` what to save.
- `e` shows every setting, `p` loads or saves presets, `?` lists all keys (`pagestill help keys`).
- Viewport, DPR and theme are **applied live** to the tab, so the browser shows what will be captured.
- The screen remembers your last session (only what you changed there, never command-line flags); `R` resets. Nothing else reads that memory: `shot` and `run` behave the same however you left the screen.

## One-shot CLI

```sh
pagestill shot                                   # current tab, your defaults
pagestill shot --viewport 390x844m --dpr 3 --no-html
pagestill shot --element '#chart' --format webp --quality 85
pagestill shot --theme dark --hide .cookie-banner '#intercom' -o ~/captures
pagestill shot --tab 2                           # or --tab admin.acme (URL/title text)
pagestill browser tabs                           # ★ = what `shot` would capture
pagestill browser open https://admin.acme.com    # just open the pagestill Chrome
```

Every setting is a flag; see `pagestill help settings`.

## Many pages

Make a page list, pick the pages, run it:

```sh
pagestill crawl https://admin.acme.com --scope /admin     # → pagestill-out/lists/admin-acme-com-<time>.pages.yaml
pagestill edit pagestill-out/lists/admin-acme-com-*.pages.yaml
pagestill run  pagestill-out/lists/admin-acme-com-*.pages.yaml --viewport 390x844m
```

**Crawl** follows links in your logged-in browser, reading the rendered DOM (so client-side menus count). URLs that share a pattern (`/users/42`, `/users/7` → `/users/:id`) are sampled instead of all visited. Logout, delete, unsubscribe and download links are never followed unless `--follow-unsafe`. If a page lands on a login screen, the crawl pauses until you log in. Add `--capture` to capture every visited page as you go.

**Record** (`r` in the screen) writes down every page you open in the tab in front, including client-side route changes, and saves them to a page list. Saving into an existing list adds the new pages and keeps everything else. Pages reached by clicking inside an app are marked `reached in-page`; check that they open directly before relying on them in a run.

**Edit** is a checklist over a list: `space` ticks a page, `g` a whole pattern group, `a` all/none, `E` opens `$EDITOR`. Unticked pages stay in the file with `skip: true`, comments intact.

**Run** opens every page in its own background window, once per combination, and writes:

```
pagestill-out/runs/<list>-<time>/
  index.html      gallery with thumbnails
  manifest.json   status of every capture; --resume continues from it
  <page>/<variant>.png|.html
```

Each capture is **ok**, **check** (it answered with an HTTP error or ended on a different URL, so look at it), **failed** or **skipped**. A login wall pauses every window and asks you to log in. Flags override the list for one run, and a flag replaces the matching matrix axis (`--theme dark` on a light/dark matrix captures dark only). `--only '/settings/**'` runs part of a list. The exit code is 2 unless everything is ok.

A page list in full (`pagestill help lists`):

```yaml
name: admin-review
base: https://admin.acme.com/
preset: retina
settings:
  hide: [".intercom-launcher", "#cookie-banner"]
matrix:
  viewport: [1440x900, 390x844m]
  theme: [light, dark]
load:
  until: networkidle
  waitFor: main
login: /sso/
concurrency: 2
pages:
  - /dashboard
  - url: /reports?range=30d
    name: reports-30d
    load: { waitFor: ".chart canvas" }
  - url: /settings
    steps:
      - click: "button[aria-controls=billing]"
      - waitFor: "#billing-panel"
  - url: /legacy
    skip: true
```

## Settings

Settings are the same everywhere, under the same names:

| where | form | example |
|---|---|---|
| config file, page lists | YAML key | `lazyLoad: true` |
| command line | flag | `--lazy-load` |
| interactive screen | label | Lazy load |

They are applied in one order, later wins:

```
built-in → config defaults → presets → page list → page → matrix → flags
```

`pagestill help settings` lists all 24 with their flags, keys and defaults: what to save (image, HTML), emulation (viewport, DPR, theme, reduced motion), preparation (delay, hide, lazy load, freeze animations, hide scrollbars), the image (area, element, format, quality, transparent), the HTML snapshot (scripts, hidden elements, unused CSS, frames, minify, absolute links, resource size) and files (workspace folder, file name template).

`~/.pagestill/config.yaml`:

```yaml
defaults:                 # every command starts from these
  format: webp
presets:                  # --preset retina,dark (later wins)
  retina: { dpr: 2 }
  dark: { theme: dark }
  mobile: { viewport: 390x844m, dpr: 3 }
browser:
  port: 9222
```

## Where files go

Everything pagestill writes goes into one **workspace** folder, `./pagestill-out` unless you set `-o` (or `out:` in your defaults):

```
pagestill-out/
  shots/     single captures (Shot, Auto)
  lists/     page lists (crawl, Record)
  runs/      runs (run, crawl --capture)
```

`~/.pagestill/` holds `config.yaml`, the screen's last session (`tui-state.yaml`) and the Chrome profile.

## Browser

By default pagestill starts its own Chrome (separate profile, remote debugging on `127.0.0.1:9222`) or attaches to it if it's running. Browser options work with every command: `--port`, `--ws <url>`, `--no-launch`, `--chrome <path>`, `--profile <dir>`. Extra Chrome flags go in `PAGESTILL_CHROME_ARGS` (e.g. `--proxy-server=...`).

**Your everyday Chrome** (`--auto-connect`, experimental): turn on remote debugging at `chrome://inspect/#remote-debugging` (Chrome 144+), run `pagestill --auto-connect`, and click **Allow** when Chrome asks. The port Chrome shows isn't enough by itself: in this mode Chrome doesn't answer the usual discovery requests, so pagestill reads the full address from the `DevToolsActivePort` file in Chrome's profile. **On macOS your terminal app needs Full Disk Access** to read it (System Settings → Privacy & Security → Full Disk Access).

## Upgrading from 0.3

0.4 renames things so that each setting has one name; the old names keep working, with a warning, until 0.5.

| 0.3 | 0.4 |
|---|---|
| job file, `pages-*.yaml` | page list, `*.pages.yaml` |
| `hideSelectors`, `loadLazy` / `--lazy`, `waitMs` / `--wait` | `hide`, `lazyLoad` / `--lazy-load`, `delay` / `--delay` |
| `selector` / `--selector`, `omitBackground` | `element` / `--element`, `transparent` |
| `htmlOptions: { keepScripts, … }`, `--archiver` | `htmlScripts`, … (flat), `--html-engine` |
| `outDir`, `filename` | `out`, `name` |
| page list `wait: { selector, delay }`, `actions:`, `loginPattern:`, `type: { selector }` | `load: { waitFor }` + `delay` setting, `steps:`, `login:`, `type: { into }` |
| `pagestill open`, `pagestill tabs` | `pagestill browser open`, `pagestill browser tabs` |
| `crawl -o <file>`, `--login-pattern`, `--no-default-excludes` | `crawl --save <file>`, `--login`, `--follow-unsafe` |

Behavior changes:

- `-o` always means the workspace folder. Shots go to `<out>/shots/`, runs to `<out>/runs/`, crawled lists to `<out>/lists/`.
- `shot` no longer picks up the interactive screen's last settings. Put settings you always want in `defaults:` in `config.yaml`. The 0.3 `settings:` key there is treated as the screen's last session and moved to `tui-state.yaml`.
- The interactive screen's `s`/`h` (capture image only / HTML only) are gone: choose what to save with `o`, capture with `⏎`. The folder key moved from `O` to `g`.

## Security notes

- The Chrome that pagestill launches listens for DevTools connections on `127.0.0.1:<port>` (9222 by default) while it runs. Any program on **your machine** can then control that browser, including the sessions you are logged into. It is not reachable from the network. Close that Chrome when you're done if this matters to you, or use a separate OS user.
- The `~/.pagestill/chrome-profile` profile stores the cookies and logins you make in that window. Treat it like any browser profile.
- To follow the focused tab, pagestill exposes a small `__pagestillSignal` function to each page. A page could call it to trigger a capture, which writes files to your workspace folder. It can't do anything else.
- HTML snapshots inline everything that was on screen, including personal data visible in a logged-in page. Review them before sharing.

## How it works

```
src/
  cli.ts                 commands
  cli/options.ts         flags, generated from the settings registry
  cli/topics.ts          pagestill help settings | lists | keys
  core/
    settings.ts          the settings registry: one definition per setting
    config.ts            config.yaml, presets, the resolution order, TUI state
    workspace.ts         shots/ lists/ runs/
    chrome.ts            find + launch Chrome (dedicated profile, remote debugging)
    session.ts           attach via puppeteer-core, follow the focused tab, in-page hotkey
    emulation.ts         viewport/DPR/media overrides, capture CSS, lazy-load scroll
    screenshot.ts        CDP screenshots; tall pages are tiled and stitched (sharp)
    capture.ts           HTML first (non-invasive), then the image
    navigate.ts          load waiting and page steps
    urls.ts              normalization, URL patterns, globs, login detection
  batch/
    pagelist.ts          page list format, matrix, editable YAML writer
    runner.ts            run workers, login pause, checks, manifest, resume
    crawler.ts           breadth-first crawl in the live browser
    gallery.ts           index.html + thumbnails
  archivers/
    types.ts             the Archiver interface
    index.ts             lazy registry
    singlefile/          SingleFile adapter (the only code that knows about SingleFile)
  tui/                   Ink screens
docs/design/             concept guide and target help this version implements
```

The HTML snapshot is produced by an **Archiver**: it serializes the live page without reloading it and returns one HTML string. The default engine is [SingleFile](https://github.com/gildas-lormeau/single-file-core). pagestill injects SingleFile's browser bundle into the already-open page, and into its cross-origin iframes, through an isolated world. Resources the page can't fetch because of CORS are fetched again through the browser with your cookies.

To use another engine, add `src/archivers/<id>/index.ts` that exports an `Archiver` and register it in `src/archivers/index.ts`. Then select it with `--html-engine <id>` or in the settings.

## Known limitations

- Full-page capture uses the document's scroll height. Apps that scroll inside an inner container (`body { overflow: hidden }` plus a scrolling `<main>`) come out viewport-sized. Use the viewport or element area for those.
- Full-page capture temporarily enlarges the viewport, so `100vh` elements stretch and `position: fixed` elements appear once, at their initial position.
- The HTML snapshot keeps how the page looks, not how it behaves: no JS, no hover states, and inner scroll positions are reset.
- WebGL canvases created without `preserveDrawingBuffer` may come out blank in the HTML snapshot.
- Images, fonts and stylesheets are inlined as `data:` URLs, so CSS that selects on those attributes (e.g. `img[src$=".gif"]`) can match differently in the snapshot. Links keep their original `href` for this reason, so relative links in a snapshot opened from disk don't lead back to the site unless `htmlAbsoluteLinks` is on.
- Record stores URLs, not clicks. A screen reached only by clicking needs `steps:` in the page list to be reproduced by a run.

## Roadmap

- Full-page capture of apps that scroll inside an inner container
- Run and crawl from inside the interactive screen
- Record clicks as `steps:`
- Visual diff between two runs of the same list

## Releasing

```sh
pnpm release patch --dry-run   # preview: checks + "0.3.0 → 0.3.1 (tag v0.3.1)", changes nothing
pnpm release minor             # or patch | major | 1.2.3 | prerelease --preid rc
```

[`scripts/release.mjs`](scripts/release.mjs) does the whole thing:

1. Refuses to release from a bad state: not on `main`, uncommitted changes, behind `origin/main`, or the target tag already exists locally or on `origin`.
2. Runs typecheck and the tests (headless Chrome).
3. Runs `pnpm version`, which bumps `package.json`, commits `chore: release x.y.z` and creates the annotated tag `vX.Y.Z`.
4. Pushes the commit and the tag atomically. The tag triggers the [Release workflow](.github/workflows/release.yml), which tests again, runs `pnpm pack`, and publishes a GitHub Release with the tarball. With `gh` installed, the script follows the run and prints the install command. Set `RELEASE_NO_WATCH=1` to skip that.

Versions with a `-` (e.g. `0.4.0-rc.0`) become prereleases. If the workflow fails, the script prints the commands to move the tag after you push a fix. Running the workflow manually from the Actions tab is a dry run that uploads the tarball as an artifact instead of releasing.

## Development

```sh
pnpm install
pnpm dev            # run from source (tsx)
pnpm test           # unit + e2e (e2e launches a throwaway Chrome; PAGESTILL_CHROME_ARGS="--headless=new" to hide it)
pnpm build          # dist/cli.js
pnpm add -g "link:$PWD"   # put this checkout's `pagestill` on PATH (rebuilds apply instantly)
pnpm remove -g pagestill  # undo
```

## License

AGPL-3.0-or-later. pagestill bundles and drives [SingleFile](https://github.com/gildas-lormeau/single-file-cli) by Gildas Lormeau, which is also AGPL-3.0-or-later.
