import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml" };

export interface TestSite {
  server: Server;
  /** http://localhost:<port>/ */
  base: string;
  hits: Map<string, number>;
  close: () => void;
}

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

/**
 * Static fixtures under / plus a small fake app under /site/:
 * links, tracking params, id-like routes, a login wall (cookie auth=1), and a logout link
 * that must never be visited.
 */
export async function startSite(): Promise<TestSite> {
  const hits = new Map<string, number>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    const html = (body: string) => res.writeHead(200, { "content-type": "text/html" }).end(body);
    if (url.pathname.startsWith("/site")) {
      const p = url.pathname;
      const authed = /(?:^|;\s*)auth=1/.test(req.headers.cookie ?? "");
      if (p === "/site" || p === "/site/")
        return html(
          page(
            "Home",
            `<a href="/site/a">A</a> <a href="/site/b?utm_source=mail&x=1">B</a> <a href="/site/users/1">U1</a>
             <a href="/site/users/2">U2</a> <a href="/site/private">Private</a> <a href="/site/logout">Log out</a>
             <a href="https://example.com/">ext</a> <a href="mailto:a@b.c">mail</a> <a href="/site/report.pdf">pdf</a>`,
          ),
        );
      if (p === "/site/a") return html(page("A", `<a href="/site/b?x=1#top">B again</a> <a href="/site/a#frag">self</a>`));
      if (p === "/site/b") return html(page("B", `<p>query x=${url.searchParams.get("x")}</p>`));
      const user = /^\/site\/users\/(\d+)$/.exec(p);
      if (user) {
        const n = Number(user[1]);
        return html(page(`User ${n}`, n < 30 ? `<a href="/site/users/${n + 1}">next</a>` : ""));
      }
      if (p === "/site/private") {
        if (!authed) return res.writeHead(302, { location: "/site/login?next=/site/private" }).end();
        return html(page("Private", "<p>secret dashboard</p>"));
      }
      if (p.startsWith("/site/spa"))
        return html(
          page(
            "SPA",
            `<button id="go" onclick="history.pushState({}, '', '/site/spa/settings'); document.title = 'SPA Settings'; this.textContent = 'moved'">go</button>`,
          ),
        );
      if (p === "/site/login") return html(page("Login", "<form><input name=u></form>"));
      if (p === "/site/logout") return html(page("Bye", ""));
      return res.writeHead(404).end();
    }
    const file = join(FIXTURES, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { server, base: `http://localhost:${port}/`, hits, close: () => server.close() };
}
