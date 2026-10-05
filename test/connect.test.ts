import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explainActivePortError, launchChrome, readDevToolsActivePort } from "../src/core/chrome.js";
import { BrowserSession } from "../src/core/session.js";

const dir = () => mkdtempSync(join(tmpdir(), "pagestill-chrome-"));

describe("auto-connect", () => {
  it("reads the endpoint Chrome writes", () => {
    const d = dir();
    writeFileSync(join(d, "DevToolsActivePort"), "57997\n/devtools/browser/abc-123\n");
    expect(readDevToolsActivePort(d)).toEqual({ endpoint: "ws://127.0.0.1:57997/devtools/browser/abc-123", port: 57997 });
  });

  it("says remote debugging is off when the file is missing", () => {
    const r = readDevToolsActivePort(dir());
    expect(r).toMatchObject({ error: "missing" });
    if ("error" in r) expect(explainActivePortError(r)).toContain("chrome://inspect/#remote-debugging");
  });

  it.skipIf(process.getuid?.() === 0)("explains a blocked read instead of claiming it's missing", () => {
    const d = dir();
    const f = join(d, "DevToolsActivePort");
    writeFileSync(f, "1\n/x\n");
    chmodSync(f, 0o000);
    const r = readDevToolsActivePort(d);
    chmodSync(f, 0o600);
    expect(r).toMatchObject({ error: "blocked" });
    if ("error" in r) expect(explainActivePortError(r)).toContain("Full Disk Access");
  });

  it("rejects garbage", () => {
    const d = dir();
    writeFileSync(join(d, "DevToolsActivePort"), "hello");
    expect(readDevToolsActivePort(d)).toMatchObject({ error: "invalid" });
  });
});

describe("--port pointing at a Chrome without discovery", () => {
  it("explains instead of launching a second browser", async () => {
    // What Chrome does when remote debugging is turned on from chrome://inspect: /json/* is 404.
    const server = createServer((_, res) => res.writeHead(404).end());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      await expect(BrowserSession.connect({ port, profileDir: join(dir(), "p") })).rejects.toThrow(/use --auto-connect/);
    } finally {
      server.close();
    }
  });
});

describe("launch failures", () => {
  it("says Chrome exited instead of waiting out the timeout", async () => {
    const started = Date.now();
    await expect(launchChrome({ port: 9999, chromePath: "/usr/bin/false", profileDir: join(dir(), "p") })).rejects.toThrow(
      /Chrome exited \(code 1\)/,
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
