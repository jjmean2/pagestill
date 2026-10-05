import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, ManifestEntry } from "./runner.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const href = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Static index.html next to the captures: one row per page, one card per variant. */
export function writeGallery(runDir: string, m: Manifest): void {
  const byPage = new Map<string, ManifestEntry[]>();
  for (const e of Object.values(m.entries)) {
    const list = byPage.get(e.page) ?? [];
    list.push(e);
    byPage.set(e.page, list);
  }
  const counts = { ok: 0, failed: 0, skipped: 0 };
  for (const e of Object.values(m.entries)) counts[e.status]++;

  const rows = [...byPage].map(([page, entries]) => {
    const first = entries[0]!;
    const cards = entries
      .sort((a, b) => a.variant.localeCompare(b.variant))
      .map((e) => {
        const img = e.files.find((f) => f.kind === "image");
        const html = e.files.find((f) => f.kind === "html");
        const thumb = img
          ? `<a class="thumb" href="${href(img.path)}"><img loading="lazy" src="${href(img.path)}" alt=""></a>`
          : `<div class="thumb empty">${e.status === "ok" ? "HTML only" : esc(e.error ?? e.status)}</div>`;
        const links = [
          img && `<a href="${href(img.path)}">image${img.width ? ` ${img.width}×${img.height}` : ""}</a>`,
          html && `<a href="${href(html.path)}">HTML</a>`,
        ]
          .filter(Boolean)
          .join(" · ");
        return `<figure class="${e.status}">${thumb}<figcaption><b>${esc(e.variant)}</b> ${links}${
          e.warnings.length ? `<div class="warn">${esc(e.warnings.join("; "))}</div>` : ""
        }</figcaption></figure>`;
      })
      .join("");
    return `<section><h2>${esc(page)}</h2><p class="url"><a href="${esc(first.url)}">${esc(first.url)}</a>${
      first.finalUrl && first.finalUrl !== first.url ? ` → ${esc(first.finalUrl)}` : ""
    }${first.title ? ` · ${esc(first.title)}` : ""}</p><div class="cards">${cards}</div></section>`;
  });

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.jobName)} · pagestill</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--card:#f5f5f7;--line:#e3e3e8;--bad:#c62828;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf0;--muted:#9a9aa2;--card:#1e1e22;--line:#2c2c32;--bad:#ff6b6b;--warn:#e3b341}}
*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
header,section{max-width:1400px;margin:0 auto 32px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:0}
.meta,.url{color:var(--muted);margin:4px 0 12px;overflow-wrap:anywhere}a{color:inherit}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.thumb{display:block;height:260px;overflow:hidden;background:var(--line)}.thumb img{width:100%;display:block}
.thumb.empty{display:grid;place-items:center;color:var(--muted);padding:12px;text-align:center}
figcaption{padding:8px 10px;color:var(--muted)}figcaption b{color:var(--fg)}
.failed{border-color:var(--bad)}.failed .thumb{color:var(--bad)}.warn{color:var(--warn);font-size:12px;margin-top:4px}
</style></head><body>
<header><h1>${esc(m.jobName)}</h1><p class="meta">${counts.ok} ok · ${counts.failed} failed · ${counts.skipped} skipped · started ${esc(
    new Date(m.startedAt).toLocaleString(),
  )}</p></header>
${rows.join("\n")}
</body></html>`;
  writeFileSync(join(runDir, "index.html"), html);
}
