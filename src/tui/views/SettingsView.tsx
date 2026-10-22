import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { type CaptureSettings, DEFAULT_SETTINGS, SETTING_BY_KEY, flagName, toYamlSettings } from "../../core/settings.js";
import { FIELDS, type Field } from "../fields.js";
import { Panel } from "../ui/Frame.js";
import { padTo } from "../ui/text.js";
import { changed } from "./MainView.js";

export interface SettingsViewProps {
  width: number;
  height: number;
  active: boolean;
  settings: CaptureSettings;
  /** What R resets to; values that differ get a dot. */
  base: CaptureSettings;
  onChange: (s: CaptureSettings) => void;
  onEdit: (field: Field) => void;
  onDone: () => void;
  /** Owned by the parent: this view unmounts while a value is being typed. */
  cursor: number;
  setCursor: (c: number) => void;
}

type Row = { header: string } | { field: Field };

const yamlValue = (key: keyof CaptureSettings, v: unknown) => {
  const y = toYamlSettings({ [key]: v } as never)[key];
  return Array.isArray(y) ? `[${y.join(", ")}]` : String(y === "" ? '""' : y);
};

export function SettingsView(p: SettingsViewProps) {
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const fields = FIELDS.filter((f) => !filter || f.label.toLowerCase().includes(filter.toLowerCase()) || f.group.toLowerCase().includes(filter.toLowerCase()));
  const index = Math.min(Math.max(0, fields.findIndex((f) => f.id === FIELDS[p.cursor]?.id)), Math.max(0, fields.length - 1));
  const field = fields[index];
  const select = (i: number) => {
    const f = fields[(i + fields.length) % fields.length];
    if (f) p.setCursor(FIELDS.indexOf(f));
  };

  useInput(
    (input, key) => {
      if (filtering) {
        if (key.return) return setFiltering(false);
        if (key.escape) {
          setFilter("");
          return setFiltering(false);
        }
        if (key.backspace || key.delete) return setFilter((v) => v.slice(0, -1));
        if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) return setFilter((v) => v + input);
      }
      if (key.escape) return filter ? setFilter("") : p.onDone();
      if (input === "q" || input === "e") return p.onDone();
      if (input === "/") return setFiltering(true);
      if (!field) return;
      if (key.upArrow || input === "k") select(index - 1);
      if (key.downArrow || input === "j") select(index + 1);
      if ((key.rightArrow || input === " " || input === "l") && field.step) p.onChange(field.step(p.settings, 1));
      if ((key.leftArrow || input === "h") && field.step) p.onChange(field.step(p.settings, -1));
      if (key.backspace || key.delete) p.onChange(resetField(field, p.settings, p.base));
      if (key.return) {
        if (field.edit) p.onEdit(field);
        else if (field.step) p.onChange(field.step(p.settings, 1));
      }
    },
    { isActive: p.active },
  );

  const rows: Row[] = [];
  let lastGroup = "";
  for (const f of fields) {
    if (f.group !== lastGroup) rows.push({ header: f.group });
    lastGroup = f.group;
    rows.push({ field: f });
  }
  const aboutH = 4;
  const listH = Math.max(6, p.height - aboutH);
  const visible = listH - 2;
  const at = rows.findIndex((r) => "field" in r && r.field === field);
  const top = Math.min(Math.max(0, at - Math.floor(visible / 2)), Math.max(0, rows.length - visible));
  const changedCount = FIELDS.filter((f) => changed(f, p.settings, p.base)).length;
  const keys = (f: Field) => [f.key1, f.keyType].filter(Boolean).join(" ");
  const right = filtering || filter ? `/ ${filter}${filtering ? "▏" : ""} · ${fields.length} match` : `/ filter · ${changedCount} of ${FIELDS.length} changed`;

  return (
    <Box flexDirection="column">
      <Panel title="Settings" right={right} width={p.width} height={listH}>
        {rows.length === 0 ? <Text dimColor>No setting matches "{filter}".</Text> : null}
        {rows.slice(top, top + visible).map((r, i) =>
          "header" in r ? (
            <Text key={`h${top + i}`} color="cyan" bold>
              {r.header}
            </Text>
          ) : (
            <Text key={r.field.id} inverse={r.field === field} wrap="truncate-end">
              {r.field === field ? "▸ " : "  "}
              {padTo(r.field.label, 20)}
              {padTo(r.field.show(p.settings), 26)}
              <Text color="yellow">{changed(r.field, p.settings, p.base) ? "•" : " "}</Text>
              {keys(r.field) ? <Text color="cyan">{`  [${keys(r.field)}]`}</Text> : null}
            </Text>
          ),
        )}
      </Panel>
      {field ? <About field={field} settings={p.settings} base={p.base} width={p.width} /> : null}
    </Box>
  );
}

function About({ field, settings, base, width }: { field: Field; settings: CaptureSettings; base: CaptureSettings; width: number }) {
  if (field.id === "save") {
    return (
      <Panel title="About Save" width={width} height={4}>
        <Text wrap="truncate-end">What a capture writes: the screenshot, the single-file HTML snapshot, or both.</Text>
        <Text dimColor wrap="truncate-end">
          flags --no-image / --no-html    YAML image: / html:    default image + HTML
        </Text>
      </Panel>
    );
  }
  const key = field.id as keyof CaptureSettings;
  const def = SETTING_BY_KEY.get(key)!;
  const now = yamlValue(key, settings[key]);
  const from =
    JSON.stringify(settings[key]) !== JSON.stringify(base[key])
      ? `changed here from ${yamlValue(key, base[key])}`
      : JSON.stringify(base[key]) !== JSON.stringify(DEFAULT_SETTINGS[key])
        ? "from your config, preset or flags"
        : "default";
  const flag = def.arg ? `--${flagName(key)} ${now}` : `--${settings[key] ? "" : "no-"}${flagName(key)}`;
  return (
    <Panel title={`About ${field.label}`} width={width} height={4}>
      <Text wrap="truncate-end">{def.description[0]!.toUpperCase() + def.description.slice(1)}.</Text>
      <Text dimColor wrap="truncate-end">
        flag {flag}    YAML {key}: {now}    default {yamlValue(key, DEFAULT_SETTINGS[key])}    ({from})
      </Text>
    </Panel>
  );
}

/** ⌫: put one setting back to what R would reset it to. */
function resetField(f: Field, s: CaptureSettings, base: CaptureSettings): CaptureSettings {
  if (f.id === "save") return { ...s, image: base.image, html: base.html };
  const key = f.id as keyof CaptureSettings;
  return { ...s, [key]: base[key] } as CaptureSettings;
}
