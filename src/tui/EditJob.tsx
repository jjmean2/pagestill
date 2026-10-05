import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { Box, Text, render, useApp, useInput, useWindowSize } from "ink";
import { useState } from "react";
import YAML, { type Document, isMap, isScalar, isSeq } from "yaml";
import { setSkipped } from "../batch/job.js";

interface Row {
  url: string;
  skip: boolean;
  /** Comment block above the entry (crawler: the pattern group). */
  group?: string;
  /** Trailing comment (crawler: page title or failure). */
  note?: string;
  groupIndex: number;
}

function readRows(doc: Document): Row[] {
  const pages = doc.get("pages", true);
  if (!isSeq(pages)) throw new Error('The file has no "pages:" list');
  let groupIndex = 0;
  return pages.items.map((item, i) => {
    let url = "";
    let skip = false;
    if (isScalar(item)) url = String(item.value);
    else if (isMap(item)) {
      url = String(item.get("url") ?? "");
      skip = item.get("skip") === true;
    }
    const node = isScalar(item) || isMap(item) ? item : undefined;
    const group = node?.commentBefore?.trim() || undefined;
    if (group && i > 0) groupIndex++;
    return { url, skip, group, note: node?.comment?.trim() || undefined, groupIndex };
  });
}

function EditJob({ path }: { path: string }) {
  const { exit, suspendTerminal } = useApp();
  const { rows: termRows } = useWindowSize();
  const [doc, setDoc] = useState(() => YAML.parseDocument(readFileSync(path, "utf8")));
  const [rows, setRows] = useState(() => readRows(doc));
  const [cursor, setCursor] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [message, setMessage] = useState<string>();

  const apply = (indexes: number[], skip: boolean) => {
    for (const i of indexes) setSkipped(doc, i, skip);
    setRows(readRows(doc));
    setDirty(true);
  };
  const save = () => {
    writeFileSync(path, doc.toString({ lineWidth: 0 }));
    setDirty(false);
    setMessage(`Saved ${path}`);
  };

  useInput((input, key) => {
    setMessage(undefined);
    if (confirmQuit) {
      if (input === "y") {
        save();
        exit();
      } else if (input === "n") exit();
      else setConfirmQuit(false);
      return;
    }
    const n = rows.length;
    if (key.upArrow || input === "k") setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow || input === "j") setCursor((c) => Math.min(n - 1, c + 1));
    if (key.pageUp) setCursor((c) => Math.max(0, c - 10));
    if (key.pageDown) setCursor((c) => Math.min(n - 1, c + 10));
    if (key.home) setCursor(0);
    if (key.end) setCursor(n - 1);
    const row = rows[cursor];
    if (input === " " && row) apply([cursor], !row.skip);
    if (input === "g" && row) {
      const members = rows.flatMap((r, i) => (r.groupIndex === row.groupIndex ? [i] : []));
      apply(members, !row.skip);
    }
    if (input === "a") apply(rows.map((_, i) => i), false);
    if (input === "n") apply(rows.map((_, i) => i), true);
    if (input === "w") save();
    if (input === "E") {
      if (dirty) save();
      const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
      void suspendTerminal(async () => {
        spawnSync(editor, [path], { stdio: "inherit", shell: true });
      }).then(() => {
        try {
          const fresh = YAML.parseDocument(readFileSync(path, "utf8"));
          setDoc(fresh);
          setRows(readRows(fresh));
          setDirty(false);
          setMessage("Reloaded after editing");
        } catch (e) {
          setMessage(`Cannot reload: ${(e as Error).message}`);
        }
      });
    }
    if (input === "q" || key.escape) {
      if (dirty) setConfirmQuit(true);
      else exit();
    }
  });

  const visible = Math.max(5, (termRows || 24) - 7);
  const top = Math.min(Math.max(0, cursor - Math.floor(visible / 2)), Math.max(0, rows.length - visible));
  const selected = rows.filter((r) => !r.skip).length;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color="cyan">
          pagestill edit
        </Text>{" "}
        {path} <Text dimColor>· {selected}/{rows.length} selected{dirty ? " · unsaved" : ""}</Text>
      </Text>
      {rows.slice(top, top + visible).map((r, k) => {
        const i = top + k;
        return (
          <Box key={i} flexDirection="column">
            {r.group && <Text color="cyan" wrap="truncate-end">{`  ${r.group}`}</Text>}
            <Text inverse={i === cursor} wrap="truncate-end">
              <Text color={r.skip ? "gray" : "green"}>{r.skip ? "[ ]" : "[x]"}</Text> <Text dimColor={r.skip}>{r.url}</Text>
              {r.note ? <Text dimColor>{`  ${r.note}`}</Text> : null}
            </Text>
          </Box>
        );
      })}
      {confirmQuit ? (
        <Text color="yellow">Save changes before quitting? y / n / any other key to stay</Text>
      ) : message ? (
        <Text color="green">{message}</Text>
      ) : (
        <Text dimColor>
          space toggle · g toggle group · a all · n none · w save · E open in $EDITOR · q quit
        </Text>
      )}
    </Box>
  );
}

export async function runEditJob(path: string): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("`pagestill edit` needs a terminal");
  YAML.parseDocument(readFileSync(path, "utf8")); // fail early on unreadable files
  const app = render(<EditJob path={path} />);
  await app.waitUntilExit();
}
