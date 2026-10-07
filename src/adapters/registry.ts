import { basename } from "node:path";
import { BantamError } from "../errors.js";
import { GenericAdapter } from "./built-in/generic.js";
import { loadFromDirectory, type LoadedAdapter } from "./loader.js";
import type { AdapterSpec, GameAdapterV1 } from "../types.js";

// One cache slot per directory the loader has scanned. Multiple games may
// point at the same directory; reusing the cache avoids re-importing modules.
const directoryCache = new Map<string, Map<string, LoadedAdapter>>();

// Per-game adapter map. Populated by buildApp via loadAdaptersForGame.
const gameAdapters = new Map<string, Map<string, GameAdapterV1>>();

// One preload slot — the directory the runtime container mounts.
// `preloadAdapterDirectory` may be called once before `buildApp`.
let preloadedDir: string | undefined;

export async function preloadAdapterDirectory(
  dir = process.env.BANTAM_ADAPTERS_DIR ?? "/bantam/adapters",
): Promise<void> {
  if (preloadedDir === dir) return;
  if (!directoryCache.has(dir)) directoryCache.set(dir, await loadFromDirectory(dir));
  preloadedDir = dir;
}

// Returns the per-game adapter map. Called from main.ts / app.ts once
// the manifest has been validated and the directory preloaded.
export async function loadAdaptersForGame(
  gameId: string,
  specs: readonly AdapterSpec[],
): Promise<Map<string, GameAdapterV1>> {
  const map = new Map<string, GameAdapterV1>();
  for (const spec of specs) {
    if (spec.kind === "generic") {
      const adapter = new GenericAdapter(spec.boards);
      register(map, adapter, `synthesized[${gameId}]`);
      continue;
    }
    const dir = preloadedDir;
    if (!dir) {
      throw new BantamError(
        "adapter-invalid",
        `Game ${gameId} references file adapter ${spec.source} but no adapter directory was preloaded`,
        500,
      );
    }
    const fileMap = directoryCache.get(dir);
    if (!fileMap) {
      throw new BantamError(
        "adapter-invalid",
        `Game ${gameId} references file adapter ${spec.source} but directory ${dir} was not preloaded`,
        500,
      );
    }
    const key = basename(spec.source);
    const loaded = fileMap.get(key);
    if (!loaded) {
      throw new BantamError(
        "adapter-not-found",
        `Game ${gameId} references file adapter ${spec.source} but no such file is loaded from ${dir}`,
        404,
      );
    }
    register(map, loaded.adapter, spec.source);
  }
  gameAdapters.set(gameId, map);
  return map;
}

function register(map: Map<string, GameAdapterV1>, adapter: GameAdapterV1, source: string): void {
  const existing = map.get(adapter.id);
  if (existing) {
    throw new BantamError(
      "adapter-duplicate",
      `Adapter id ${adapter.id} appears twice in the same game (from ${source})`,
      500,
    );
  }
  map.set(adapter.id, adapter);
}

// Flat list of every adapter currently registered for at least one game.
// Deduplicates by id so a generic adapter shared by two games appears once.
// Used by /version. Read-only — callers must not mutate.
export function listLoadedAdapters(): readonly GameAdapterV1[] {
  const seen = new Set<string>();
  const out: GameAdapterV1[] = [];
  for (const map of gameAdapters.values())
    for (const adapter of map.values())
      if (!seen.has(adapter.id)) {
        seen.add(adapter.id);
        out.push(adapter);
      }
  return out;
}

// Test/admin helper. Returns the per-game adapter map for the given game id.
export function adaptersFor(gameId: string): ReadonlyMap<string, GameAdapterV1> | undefined {
  return gameAdapters.get(gameId);
}
