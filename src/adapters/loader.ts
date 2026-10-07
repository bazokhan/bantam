import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BantamError } from "../errors.js";
import type { GameAdapterV1 } from "../types.js";

// Reads a mounted directory of compiled adapter modules and returns a map
// from each module's declared `id` to its `GameAdapterV1` instance.
//
// Authoring contract:
//   - Module's default export (or named export `adapter`) implements GameAdapterV1.
//   - `id` and `version` are required strings. `boards` is a readonly array.
//   - `validateAndDerive(payload, ctx)` returns `{ normalized, values }`.
//
// Hot-reload is NOT supported. Restart the container to pick up new files.
// `.ts` runtime is NOT supported — authors ship compiled `.js`/`.mjs`.
export type LoadedAdapter = { adapter: GameAdapterV1; file: string };

export async function loadFromDirectory(dir: string): Promise<Map<string, LoadedAdapter>> {
  // Keyed by basename: a single directory has at most one file per basename,
  // and the spec's `source` field is itself a basename, so lookups are direct.
  const map = new Map<string, LoadedAdapter>();
  // Tracks ids seen across files so duplicate ids throw even if filenames differ.
  const idOwners = new Map<string, string>();
  if (!existsSync(dir)) return map;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith(".js") && !name.endsWith(".mjs")) continue;
    const file = join(dir, name);
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    const candidate =
      (module.default as GameAdapter | undefined) ??
      (module.adapter as GameAdapter | undefined) ??
      (module as unknown as GameAdapter);
    validateContract(candidate, file);
    const existingOwner = idOwners.get(candidate.id);
    if (existingOwner)
      throw new BantamError(
        "adapter-duplicate",
        `Adapter id ${candidate.id} is registered by both ${existingOwner} and ${file}`,
        500,
      );
    idOwners.set(candidate.id, file);
    map.set(name, { adapter: candidate, file });
  }
  return map;
}

function validateContract(candidate: unknown, file: string): asserts candidate is GameAdapter {
  if (!candidate || typeof candidate !== "object")
    throw new BantamError("adapter-invalid", `Adapter at ${file}: default export must be an object`, 500);
  const a = candidate as Record<string, unknown>;
  if (typeof a.id !== "string" || a.id.length === 0)
    throw new BantamError("adapter-invalid", `Adapter at ${file}: missing or empty id`, 500);
  if (typeof a.version !== "string" || a.version.length === 0)
    throw new BantamError("adapter-invalid", `Adapter at ${file}: missing or empty version`, 500);
  if (!Array.isArray(a.boards))
    throw new BantamError("adapter-invalid", `Adapter at ${file}: boards must be an array`, 500);
  for (const [index, board] of a.boards.entries()) {
    if (!board || typeof board !== "object")
      throw new BantamError("adapter-invalid", `Adapter at ${file}: board[${index}] must be an object`, 500);
    const b = board as Record<string, unknown>;
    if (typeof b.id !== "string" || b.id.length === 0)
      throw new BantamError(
        "adapter-invalid",
        `Adapter at ${file}: board[${index}].id must be a non-empty string`,
        500,
      );
    if (b.direction !== "higher" && b.direction !== "lower")
      throw new BantamError(
        "adapter-invalid",
        `Adapter at ${file}: board[${index}].direction must be "higher" or "lower"`,
        500,
      );
    if (b.period !== "all_time" && b.period !== "daily")
      throw new BantamError(
        "adapter-invalid",
        `Adapter at ${file}: board[${index}].period must be "all_time" or "daily"`,
        500,
      );
  }
  if (typeof a.validateAndDerive !== "function")
    throw new BantamError("adapter-invalid", `Adapter at ${file}: validateAndDerive must be a function`, 500);
}

type GameAdapter = GameAdapterV1;
