import type { Archiver } from "./types.js";

export type { Archiver, ArchiveContext, ArchiveResult } from "./types.js";

/**
 * Archiver registry. Engines are loaded lazily so a heavy engine (SingleFile's bundle is ~1.2MB)
 * costs nothing until the first HTML capture, and an unused engine's dependency could be dropped.
 *
 * To add or replace an engine: create src/archivers/<id>/index.ts exporting a default Archiver,
 * add a loader here, and (optionally) change DEFAULT_ARCHIVER.
 */
const loaders: Record<string, () => Promise<Archiver>> = {
  singlefile: async () => (await import("./singlefile/index.js")).default,
};

export const DEFAULT_ARCHIVER = "singlefile";

const cache = new Map<string, Promise<Archiver>>();

export function archiverIds(): string[] {
  return Object.keys(loaders);
}

export function getArchiver(id: string = DEFAULT_ARCHIVER): Promise<Archiver> {
  const load = loaders[id];
  if (!load) throw new Error(`Unknown archiver "${id}". Available: ${archiverIds().join(", ")}`);
  let p = cache.get(id);
  if (!p) {
    p = load();
    cache.set(id, p);
  }
  return p;
}
