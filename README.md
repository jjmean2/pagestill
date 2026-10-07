# pagestill

Capture the page you're looking at, exactly as it is right now:

- **Screenshots** (PNG / JPEG / WebP) of the viewport, the full page, or one element, at any viewport size and pixel density.
- **HTML snapshots**: one self-contained `.html` file holding the current DOM, styles, images, fonts and frames. Open it anywhere, offline, and the page looks the same.

pagestill doesn't load URLs itself. It attaches to a Chrome window **you** drive, so it captures pages behind logins, client-side rendering, opened menus, typed-in forms, and anything else that only exists in your live session.

## Install

```sh
pnpm add -g pagestill     # or: npm i -g pagestill
```

Requires Node 22+ and Google Chrome (or Chromium / Edge / Brave).

## Quick start

```sh
pagestill
```

1. pagestill opens a Chrome window with its own profile (`~/.pagestill/chrome-profile`) and remote debugging on port 9222. Logins you make there are kept for next time.
2. Browse to the page you want, log in, click around until it looks right.
3. Press **⏎** in the terminal, or **Alt+Shift+S** in the page.

Files go to `./pagestill-out/` (`20261005-140211_admin-acme-com_users.png` + `.html`).

pagestill follows whichever tab you're looking at. Press `t` to pin a specific tab instead.

## The TUI

```
pagestill v0.1.0 ● launched Chrome · tab: follows focus
────────────────────────────────────────────────────────────────
Users – Acme Admin
https://admin.acme.com/users?page=2
────────────────────────────────────────────────────────────────
[o] Output   image + HTML   [m] Theme    as-is    [l] Lazy-load scroll off
[v] Viewport 1440×900       [w] Wait     500ms    [a] Area     full page
[d] DPR      2x             [x] Hide     .cookie  [f] Format   png
lowercase key cycles · Shift+key types a value · e for all settings
────────────────────────────────────────────────────────────────
RECENT
  ✓ …_users.html 841KB · …_users.png 2880×9970 3.1MB 2.0s
────────────────────────────────────────────────────────────────
⏎ capture  s image  h html  t tab  e settings  p presets  O folder  q quit
```

| Key | |
|---|---|
| `⏎` / `s` / `h` | capture image + HTML / image only / HTML only |
| `v` `d` `m` `w` `a` `f` `o` `l` | cycle viewport, DPR, theme, wait, area, format, outputs, lazy-load |
| `V` `D` `W` `A` `X` (Shift) | type a value: `1366x768`, `390x844m` (mobile), `1.5`, a CSS selector… |
| `e` | every setting, including HTML snapshot options and the filename template |
| `p` | presets: `n` saves the current settings, `⏎` loads one |
| `t` | pick a tab, or go back to following focus |
| `r` | Record mode: collect every page you open, then save the list as a job file |
| `u` | auto-capture: capture after every navigation once the page settles |
| `O` | open the output folder |

Viewport, DPR and theme are **applied live** to the tab, so the browser shows what will be captured. Overrides are removed when you switch tabs, set them back to `as-is`, or quit. If pagestill crashes, Chrome drops them on its own.

## One-shot CLI

```sh
pagestill shot                                   # active tab, current settings
pagestill shot --viewport 390x844m --dpr 3 --no-html
pagestill shot --selector '#chart' --format webp --quality 85
pagestill shot --theme dark --hide '.cookie-banner' '#intercom' -o shots/
pagestill shot --tab 2                           # or --tab admin.acme  (URL/title substring)
pagestill tabs                                   # list tabs; ★ = what `shot` would capture
pagestill crawl / edit / run                     # many pages: see below
pagestill open https://admin.acme.com            # just open the pagestill Chrome
```

Extra Chrome flags for the launched browser can be passed with `PAGESTILL_CHROME_ARGS` (e.g. `--proxy-server=...`).

Connection flags work with every command: `--port`, `--no-launch`, `--chrome <path>`, `--profile <dir>`, `--ws <endpoint>`, and `--auto-connect`.

### Using your everyday Chrome (`--auto-connect`, experimental)

1. In Chrome (144+), open `chrome://inspect/#remote-debugging` and turn remote debugging on. Chrome shows `Server running at: 127.0.0.1:<port>`.
2. Run `pagestill --auto-connect` and click **Allow** when Chrome asks.

The port Chrome shows is not enough on its own. In this mode Chrome doesn't answer the usual discovery requests (`/json/version` returns 404), so `--port <that port>` can't work. pagestill reads the full address from the `DevToolsActivePort` file in Chrome's profile folder instead. **On macOS your terminal app needs Full Disk Access to read that file** (System Settings → Privacy & Security → Full Disk Access). Without it, pagestill tells you the read was blocked.

If that's more setup than you want, the default mode (pagestill opens its own Chrome with a persistent profile) needs none of it.

## Many pages at once

Three ways to build a page list, all producing the same editable YAML job file:

| | |
|---|---|
| **Record** | press `r` in the TUI and browse; every page you open (including client-side routes) is added. Press `r` again to save. |
| **Crawl** | `pagestill crawl` follows links in your logged-in browser and writes the list for you |
| **By hand** | write the YAML yourself |

Then pick pages with `pagestill edit` and capture them with `pagestill run`.

### Crawl

```sh
pagestill crawl                                  # start from the active tab
pagestill crawl https://admin.acme.com --depth 3 --max 300 --scope /admin
pagestill crawl https://acme.com --include '/docs/**' --exclude '/docs/archive/**' --sitemap
```

- Runs in the pagestill Chrome, so it sees what you see: logged-in areas and links rendered by JavaScript (including inside open shadow roots).
- URLs are de-duplicated: fragments and tracking params (`utm_*`, `gclid`, ...) are dropped and the query is sorted.
- Pages are grouped by URL pattern: `/users/42` and `/users/7` both belong to `/users/:id`. Only `--sample` pages per pattern are visited and listed (default 1). This keeps a 10,000-row table from becoming 10,000 screenshots.
- **Logout, delete/remove, unsubscribe and file-download links are never followed.** Use `--no-default-excludes` only if you really mean it.
- If a page redirects to a login screen, the crawl pauses and asks you to log in in the browser window.

Output (`pages-<host>-<time>.yaml`):

```yaml
# Generated by pagestill crawl https://admin.acme.com on 2026-10-05 23:15
# 41 pages visited, 912 URLs in 41 patterns.
base: https://admin.acme.com/
settings: {}
pages:
  - /dashboard # Dashboard – Acme Admin
  # /users/:id — 480 URLs found
  - /users/1042 # Jane Doe – Users
  - url: /billing
    skip: true # login required
```

### Edit

```sh
pagestill edit pages-admin.acme.com-20261005-231500.yaml
```

A checklist over the job file: `space` toggles a page, `g` toggles a whole pattern group, `a`/`n` select all/none, `E` opens it in `$EDITOR`, `w` saves. Unchecked pages get `skip: true`, and comments and formatting are kept.

### Run

```sh
pagestill run pages.yaml                         # → pagestill-out/pages-20261005-232000/
pagestill run pages.yaml -c 3                    # 3 windows in parallel
pagestill run pages.yaml --resume pagestill-out/pages-20261005-232000
```

The job file can do more than list URLs:

```yaml
name: admin-review
base: https://admin.acme.com/
preset: retina                 # from ~/.pagestill/config.yaml
settings:                      # any setting from the table below
  hideSelectors: [".intercom-launcher", "#cookie-banner"]
  html: false
matrix:                        # every page × every combination
  viewport: [1440x900, 390x844m]
  theme: [light, dark]
wait:                          # applies to all pages; overridable per page
  until: networkidle           # load | domcontentloaded | networkidle
  delay: 500
loginPattern: /sso/            # final URLs that mean "logged out" (substring or /regex/)
concurrency: 2
pages:
  - /dashboard
  - url: /reports?range=30d
    name: reports-30d          # folder name (default: from the URL)
    wait: { selector: ".chart canvas" }
  - url: /settings
    actions:                   # run after load, before capture
      - click: "button[aria-controls=billing]"
      - waitFor: "#billing-panel"
      - press: Escape          # also: type, hover, wait (ms), scroll, eval
  - url: /legacy
    skip: true
```

Each run writes `<page>/<variant>.png|.html` (variant = matrix combination, e.g. `1440x900.dark`), a `manifest.json` that is updated after every capture, and an **`index.html` gallery** with thumbnails. When a page lands on a login screen, all workers pause, the window comes to the front, and you choose: continue after logging in, skip the page, or stop. Interrupted or failed runs continue with `--resume`. Finished captures are not redone. The exit code is 2 if anything failed or was skipped.

## Settings

| Setting | Default | |
|---|---|---|
| Output | image + HTML | |
| Viewport | as-is | the real window, or emulated `WxH` (+ mobile/touch) |
| DPR | as-is | device pixel ratio, e.g. 2 for retina-quality images |
| Theme | as-is | emulate `prefers-color-scheme: light / dark` |
| Reduced motion | off | emulate `prefers-reduced-motion` |
| Wait | 0ms | delay after applying emulation |
| Hide | none | selectors set to `visibility:hidden` in both outputs |
| Lazy-load scroll | off | scroll to the bottom and back before capturing |
| Freeze animations | on | pause CSS animations/transitions, hide the caret |
| Hide scrollbars | on | |
| Area | full page | viewport / full page / element (selector) |
| Format, quality | png, 90 | png / jpeg / webp |
| Transparent background | off | png / webp |
| HTML: keep scripts | off | scripts replayed over a frozen DOM usually break it |
| HTML: remove hidden elements | off | smaller files, but menus/tabs that are closed are dropped |
| HTML: remove unused CSS | on | |
| HTML: include frames | on | including cross-origin iframes |
| HTML: max resource size | 10MB | |
| HTML: absolute links | off | rewrite relative `href`s to absolute URLs so links in a saved file lead to the site. Off because it can change the look: rules like `a[href^="http"]` would then match links they didn't match live |
| Output folder, filename | `pagestill-out`, `{date}-{time}_{host}_{slug}` | also `{title} {w} {h} {dpr}`; `/` creates folders |

Last-used settings and presets are stored in `~/.pagestill/config.yaml`. Set `PAGESTILL_HOME` to change the location.

```yaml
presets:
  mobile-dark:
    viewport: { width: 390, height: 844, mobile: true }
    dpr: 3
    theme: dark
browser:
  port: 9222
```

## Security notes

- The Chrome that pagestill launches listens for DevTools connections on `127.0.0.1:<port>` (9222 by default) while it runs. Any program on **your machine** can then control that browser, including the sessions you are logged into. It is not reachable from the network. Close that Chrome when you're done if this matters to you, or use a separate OS user.
- The `~/.pagestill/chrome-profile` profile stores the cookies and logins you make in that window. Treat it like any browser profile.
- To follow the focused tab, pagestill exposes a small `__pagestillSignal` function to each page. A page could call it to trigger a capture, which writes files to your output folder. It can't do anything else.
- HTML snapshots inline everything that was on screen, including personal data visible in a logged-in page. Review them before sharing.

## How it works

```
src/
  cli.ts                 commander entry (TUI / shot / tabs / open)
  core/
    chrome.ts            find + launch Chrome (dedicated profile, remote debugging)
    session.ts           attach via puppeteer-core, follow the focused tab, in-page hotkey
    emulation.ts         viewport/DPR/media overrides, capture CSS, lazy-load scroll
    screenshot.ts        CDP screenshots; tall pages are tiled and stitched (sharp)
    capture.ts           orchestration: HTML first (non-invasive), then the image
    navigate.ts          wait strategies and page actions
    urls.ts              normalization, URL patterns, globs, login detection
  batch/
    job.ts               job file format, matrix, editable YAML writer
    runner.ts            workers, login pause, manifest, resume
    crawler.ts           BFS in the live browser
    gallery.ts           index.html + thumbnails
  archivers/
    types.ts             the Archiver interface
    index.ts             lazy registry
    singlefile/          SingleFile adapter (the only code that knows about SingleFile)
  tui/                   Ink UI
```

The HTML snapshot is produced by an **Archiver**: it serializes the live page without reloading it and returns one HTML string. The default engine is [SingleFile](https://github.com/gildas-lormeau/single-file-core). pagestill injects SingleFile's browser bundle into the already-open page, and into its cross-origin iframes, through an isolated world. Resources the page can't fetch because of CORS are fetched again through the browser with your cookies.

To use another engine, add `src/archivers/<id>/index.ts` that exports an `Archiver` and register it in `src/archivers/index.ts`. Then select it with `--archiver <id>` or in the settings.

## Known limitations

- Full-page capture uses the document's scroll height. Apps that scroll inside an inner container (`body { overflow: hidden }` plus a scrolling `<main>`) come out viewport-sized. Use the viewport or element area for those.
- Full-page capture temporarily enlarges the viewport, so `100vh` elements stretch and `position: fixed` elements appear once, at their initial position.
- The HTML snapshot keeps how the page looks, not how it behaves: no JS, no hover states, and inner scroll positions are reset.
- WebGL canvases created without `preserveDrawingBuffer` may come out blank in the HTML snapshot.
- Images, fonts and stylesheets are inlined as `data:` URLs, so CSS that selects on those attributes (e.g. `img[src$=".gif"]`) can match differently in the snapshot. Links keep their original `href` for this reason, so relative links in a snapshot opened from disk don't lead back to the site unless "absolute links" is on.

## Roadmap

- Full-page capture of apps that scroll inside an inner container
- Run jobs from inside the TUI (progress view, login prompt in place)
- Visual diff between two runs of the same job

## Releasing

Bump `version` in `package.json`, commit and push, then push a matching tag:

```sh
git tag -a v0.2.0 -m "pagestill v0.2.0" && git push origin v0.2.0
```

The [Release workflow](.github/workflows/release.yml) typechecks, tests (headless Chrome), runs `pnpm pack`, and creates a GitHub Release with the tarball attached. Install with `pnpm add -g https://github.com/jjmean2/pagestill/releases/download/v0.2.0/pagestill-0.2.0.tgz`. Tags containing `-` (e.g. `v0.2.0-rc.1`) are published as prereleases. Run the workflow manually for a dry run that skips the release.

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
