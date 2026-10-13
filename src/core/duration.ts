/** Milliseconds from 500, "500", "500ms", "2s" or "1.5s". */
export function parseDuration(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*$/i.exec(String(raw));
  if (!m) throw new Error(`expected a duration like 500, 500ms or 2s, got ${JSON.stringify(raw)}`);
  const n = Number(m[1]);
  return Math.round(m[2]?.toLowerCase() === "s" ? n * 1000 : n);
}
