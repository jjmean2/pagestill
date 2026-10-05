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
pagestill open https://admin.acme.com            # just open the pagestill Chrome
```

Connection flags work with every command: `--port`, `--no-launch`, `--chrome <path>`, `--profile <dir>`, `--ws <endpoint>`, and `--auto-connect`. `--auto-connect` is experimental: it attaches to your everyday Chrome after you enable remote debugging at `chrome://inspect/#remote-debugging`, on Chrome versions that support it.

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

## Roadmap

- Batch capture from a URL list / YAML job (viewport × theme matrix, pause for login)
- Record mode: collect URLs as you browse, optionally auto-capture on each navigation
- Crawler that builds an editable page list (pattern grouping, safe exclusions)

## Development

```sh
pnpm install
pnpm dev            # run from source (tsx)
pnpm test           # unit + e2e (e2e launches a throwaway Chrome)
pnpm build          # dist/cli.js
```

## License

AGPL-3.0-or-later. pagestill bundles and drives [SingleFile](https://github.com/gildas-lormeau/single-file-cli) by Gildas Lormeau, which is also AGPL-3.0-or-later.
