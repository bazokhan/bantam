import { accessSync, constants, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { EconomyCatalogSchema } from "../services/economy.js";

const BoardDefSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 80 }),
    direction: Type.Union([Type.Literal("higher"), Type.Literal("lower")]),
    period: Type.Union([Type.Literal("all_time"), Type.Literal("daily")]),
    completedOnly: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const _FileAdapterSpecSchema = Type.Object(
  {
    kind: Type.Literal("file"),
    source: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
const _GenericAdapterSpecSchema = Type.Object(
  {
    kind: Type.Literal("generic"),
    boards: Type.Array(BoardDefSchema, { minItems: 1, maxItems: 16 }),
  },
  { additionalProperties: false },
);
const GameSchema = Type.Object(
  {
    id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{1,47}$" }),
    displayName: Type.String({ minLength: 1, maxLength: 80 }),
    adapters: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 16 }),
    secretPrefix: Type.String({ pattern: "^[A-Z][A-Z0-9_]{1,47}$" }),
    gracePeriodHours: Type.Integer({ minimum: 0, maximum: 168 }),
    authProvider: Type.Union([Type.Literal("pgs-v2"), Type.Literal("development")]),
    economy: Type.Optional(EconomyCatalogSchema),
  },
  { additionalProperties: false },
);
export const ManifestSchema = Type.Object(
  {
    environment: Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")]),
    games: Type.Array(GameSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type ManifestFile = Static<typeof ManifestSchema>;

export type LoadResult =
  | {
      ok: true;
      path: string;
      writable: boolean;
      manifest: ManifestFile;
      raw: string;
    }
  | {
      ok: false;
      error: string;
    };

export type SaveResult = { ok: true; manifest: ManifestFile } | { ok: false; errors: string[] };

export class ManifestStore {
  private readonly envPath: string | undefined;
  private readonly dataDir: string;

  constructor(envPath: string | undefined, dataDir: string) {
    this.envPath = envPath;
    this.dataDir = dataDir;
  }

  // Default writable target when BANTAM_CONFIG_FILE is unset. Lives in the
  // server's data volume (dataDir) so it survives container restarts and
  // doesn't depend on /data being writable.
  private defaultTarget(): string {
    return `${this.dataDir.replace(/\/$/, "")}/games.json`;
  }

  // Decide which path to read from. Priority order matches loadConfig.
  resolvePath(): string | undefined {
    if (this.envPath) {
      try {
        readFileSync(this.envPath, "utf8");
        return this.envPath;
      } catch {
        // missing or unreadable — fall through
      }
    }
    try {
      readFileSync(this.defaultTarget(), "utf8");
      return this.defaultTarget();
    } catch {
      return undefined;
    }
  }

  load(): LoadResult {
    const path = this.resolvePath();
    if (!path) {
      // No manifest on disk. Return an empty default.
      const target = this.defaultTarget();
      return {
        ok: true,
        path: target,
        writable: isDirWritable(dirname(target)),
        manifest: { environment: "development", games: [] },
        raw: JSON.stringify({ environment: "development", games: [] }, null, 2),
      };
    }
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      return { ok: false, error: `Cannot read ${path}: ${String(error)}` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { ok: false, error: `Cannot parse JSON in ${path}: ${String(error)}` };
    }
    if (!Value.Check(ManifestSchema, parsed)) {
      const details = [...Value.Errors(ManifestSchema, parsed)]
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ");
      return { ok: false, error: `Invalid manifest: ${details}` };
    }
    return {
      ok: true,
      path,
      writable: isFileWritable(path) || (!existsSync(path) && isDirWritable(dirname(path))),
      manifest: parsed,
      raw,
    };
  }

  // Save attempts the same priority: write to $BANTAM_CONFIG_FILE if it was the
  // source of truth, otherwise write to ${dataDir}/games.json. Refuses to write
  // to any read-only mount.
  save(input: string): SaveResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      return { ok: false, errors: [`Invalid JSON: ${String(error)}`] };
    }
    if (!Value.Check(ManifestSchema, parsed)) {
      const details = [...Value.Errors(ManifestSchema, parsed)]
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ");
      return { ok: false, errors: [details] };
    }
    const target = this.envPath ?? this.defaultTarget();
    if (existsSync(target) && !isFileWritable(target)) {
      return {
        ok: false,
        errors: [
          `Cannot write to ${target}: file is mounted read-only. Unset BANTAM_CONFIG_FILE and let the server manage ${this.dataDir}/games.json, or remount the file as read-write.`,
        ],
      };
    }
    if (!existsSync(target) && !isDirWritable(dirname(target))) {
      return {
        ok: false,
        errors: [`Cannot create ${target}: parent directory ${dirname(target)} is not writable.`],
      };
    }
    try {
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.tmp`;
      writeFileSync(tmp, input.endsWith("\n") ? input : `${input}\n`, { mode: 0o600 });
      renameSync(tmp, target);
    } catch (error) {
      return { ok: false, errors: [`Write failed: ${String(error)}`] };
    }
    return { ok: true, manifest: parsed };
  }

  writableTarget(): string {
    return this.envPath ?? this.defaultTarget();
  }
}

function existsSync(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isFileWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
