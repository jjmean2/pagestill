const seen = new Set<string>();
let sink: (message: string) => void = (m) => process.stderr.write(`pagestill: ${m}\n`);

/** Print a warning once per process (deprecated names are often hit many times). */
export function warnOnce(message: string): void {
  if (seen.has(message)) return;
  seen.add(message);
  sink(message);
}

/** Redirect warnings (e.g. into the interactive screen while it owns the terminal). */
export function setWarningSink(fn: (message: string) => void): void {
  sink = fn;
}
