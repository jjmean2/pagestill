import { resolve } from "node:path";

/**
 * Everything pagestill writes goes into one workspace folder (setting `out`, flag -o):
 *
 *   <out>/shots/   single captures (shot, the interactive screen, auto-capture)
 *   <out>/lists/   page lists made by crawl and Record
 *   <out>/runs/    one folder per run (and crawl --capture)
 */
export function workspace(out: string) {
  const root = resolve(out);
  return { root, shots: resolve(root, "shots"), lists: resolve(root, "lists"), runs: resolve(root, "runs") };
}
