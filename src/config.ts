import { accessSync, constants, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { BantamError } from "./errors.js";
import type { GameManifestEntry, RuntimeGame, AdapterSpec } from "./types.js";

const BoardDefSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 80 }),
    direction: Type.Union([Type.Literal("higher"), Type.Literal("lower")]),
    period: Type.Union([Type.Literal("all_time"), Type.Literal("daily")]),
    completedOnly: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

// Adapter spec models. Type.Union of Object Members can produce surprising
// diagnostics depending on the TypeBox runtime path; per-member schemas
// validated manually by `validateAdapterSpecs` below.
const FileAdapterSpecSchema = Type.Object(
  {
    kind: Type.Literal("file"),
    source: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
const GenericAdapterSpecSchema = Type.Object(
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
  },
  { additionalProperties: false },
);

const ManifestSchema = Type.Object(
  {
    environment: Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")]),
    // Empty `games` array is valid: the server boots with zero games and the admin
    // UI surfaces a "no games yet" banner that drives manifest creation.
    games: Type.Array(GameSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);

export type LoadedConfig = {
  environment: "development" | "test" | "production";
  dataDir: string;
  games: Map<string, RuntimeGame>;
  allowedOrigins: string[];
  metricsToken?: string;
  manifestPath: string | undefined;
  manifestWritable: boolean;
};

function validateAdapterSpec(value: unknown, path: string): AdapterSpec {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BantamError("invalid-config", `${path}: Expected object`, 500);
  const v = value as Record<string, unknown>;
  const kind = v.kind;
  if (kind === "file") {
    if (!Value.Check(FileAdapterSpecSchema, v)) {
      const errs = [...Value.Errors(FileAdapterSpecSchema, v)]
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ");
      throw new BantamError("invalid-config", `${path}: ${errs}`, 500);
    }
    const spec: Static<typeof FileAdapterSpecSchema> = v;
    return { kind: "file", source: spec.source };
  }
  if (kind === "generic") {
    if (!Value.Check(GenericAdapterSpecSchema, v)) {
      const errs = [...Value.Errors(GenericAdapterSpecSchema, v)]
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ");
      throw new BantamError("invalid-config", `${path}: ${errs}`, 500);
    }
    const spec: Static<typeof GenericAdapterSpecSchema> = v;
    return { kind: "generic", boards: spec.boards };
  }
  throw new BantamError(
    "invalid-config",
    `${path}: kind must be "file" or "generic" (got ${JSON.stringify(kind)})`,
    500,
  );
}

// Decide which on-disk path the manifest lives at, in priority order:
//   1. $BANTAM_CONFIG_FILE if set AND readable (covers demo compose mounts + user overrides).
//   2. /data/games.json (the canonical writable path inside the persistent volume).
//   3. None — first boot with no manifest; admin UI drives creation.
function resolveManifestPath(path: string | undefined): string | undefined {
  if (path) {
    try {
      readFileSync(path, "utf8");
      return path;
    } catch {
      // ENOENT or unreadable — fall through.
    }
  }
  const fallback = "/data/games.json";
  try {
    readFileSync(fallback, "utf8");
    return fallback;
  } catch {
    return undefined;
  }
}

function isWritable(path: string | undefined): boolean {
  if (!path) {
    // No manifest exists yet. We test whether the canonical /data directory
    // is writable by trying to create and remove a temp file inside it.
    const probe = "/data/.bantam-write-probe";
    try {
      writeFileSync(probe, "");
      rmSync(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function buildLoadedConfig(
  manifest: { environment: LoadedConfig["environment"]; games: unknown[] },
  env: NodeJS.ProcessEnv,
  manifestPath: string | undefined,
  manifestWritable: boolean,
): LoadedConfig {
  const only = env.BANTAM_ONLY_GAME;
  const candidateGames = manifest.games.filter(
    (game): game is Record<string, unknown> =>
      typeof game === "object" && game !== null && !Array.isArray(game),
  );
  const allSelected = (
    only ? candidateGames.filter((game) => game["id"] === only) : candidateGames
  ) as GameManifestEntry[];
  if (only && allSelected.length !== 1)
    throw new BantamError("invalid-config", `Unknown BANTAM_ONLY_GAME: ${only}`, 500);
  if (new Set(allSelected.map((game) => game.id)).size !== allSelected.length) {
    throw new BantamError("invalid-config", "Duplicate game id", 500);
  }
  const games = new Map<string, RuntimeGame>();
  for (const [i, game] of allSelected.entries()) {
    if (manifest.environment === "production" && game.authProvider === "development") {
      throw new BantamError("invalid-config", `Development auth forbidden for ${game.id}`, 500);
    }
    const adapters: AdapterSpec[] = (game.adapters as unknown[]).map((value, idx) =>
      validateAdapterSpec(value, `/games/${i}/adapters/${idx}`),
    );
    const readSecret = (suffix: string): string => {
      const key = `${game.secretPrefix}_${suffix}`;
      const value = env[key];
      if (!value || value.length < 16)
        throw new BantamError("invalid-config", `Missing or short secret: ${key}`, 500);
      return value;
    };
    const runtime: RuntimeGame = {
      ...game,
      adapters,
      identitySalt: readSecret("IDENTITY_SALT"),
      sessionSecret: readSecret("SESSION_SECRET"),
      cursorSecret: readSecret("CURSOR_SECRET"),
    };
    if (game.authProvider === "pgs-v2") {
      runtime.pgsClientId = readSecret("PGS_CLIENT_ID");
      runtime.pgsClientSecret = readSecret("PGS_CLIENT_SECRET");
    }
    games.set(game.id, runtime);
  }
  return {
    environment: manifest.environment,
    dataDir: env.BANTAM_DATA_DIR ?? "/data",
    games,
    allowedOrigins: (env.BANTAM_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ...(env.BANTAM_METRICS_TOKEN ? { metricsToken: env.BANTAM_METRICS_TOKEN } : {}),
    manifestPath,
    manifestWritable,
  };
}

export function loadConfig(
  path: string | undefined = process.env.BANTAM_CONFIG_FILE,
  env: NodeJS.ProcessEnv = process.env,
): LoadedConfig {
  const manifestPath = resolveManifestPath(path);
  const manifestWritable = isWritable(manifestPath ?? "/data/games.json");

  let manifest: { environment: LoadedConfig["environment"]; games: unknown[] };
  if (manifestPath) {
    let raw: string;
    try {
      raw = readFileSync(manifestPath, "utf8");
    } catch (error) {
      throw new BantamError(
        "invalid-config",
        `Cannot read game manifest at ${manifestPath}: ${String(error)}`,
        500,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new BantamError(
        "invalid-config",
        `Cannot parse game manifest at ${manifestPath}: ${String(error)}`,
        500,
      );
    }
    if (!Value.Check(ManifestSchema, parsed)) {
      const details = [...Value.Errors(ManifestSchema, parsed)]
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ");
      throw new BantamError("invalid-config", `Invalid game manifest at ${manifestPath}: ${details}`, 500);
    }
    manifest = parsed as { environment: LoadedConfig["environment"]; games: unknown[] };
  } else {
    // No manifest on disk — boot with empty games so the admin UI can drive creation.
    process.stderr.write(
      `[bantam] no game manifest found (looked at ${path ?? "(unset)"} and /data/games.json) — booting empty; visit the admin UI to create your first game\n`,
    );
    manifest = { environment: "development", games: [] };
  }

  return buildLoadedConfig(manifest, env, manifestPath, manifestWritable);
}
