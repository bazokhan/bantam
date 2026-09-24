import { readFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { BantamError } from "./errors.js";
import type { GameManifestEntry, RuntimeGame } from "./types.js";

const GameSchema = Type.Object(
  {
    id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{1,47}$" }),
    displayName: Type.String({ minLength: 1, maxLength: 80 }),
    adapters: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { minItems: 1, maxItems: 16 }),
    secretPrefix: Type.String({ pattern: "^[A-Z][A-Z0-9_]{1,47}$" }),
    gracePeriodHours: Type.Integer({ minimum: 0, maximum: 168 }),
    authProvider: Type.Union([Type.Literal("pgs-v2"), Type.Literal("development")]),
  },
  { additionalProperties: false },
);

const ManifestSchema = Type.Object(
  {
    environment: Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")]),
    games: Type.Array(GameSchema, { minItems: 1, maxItems: 64 }),
  },
  { additionalProperties: false },
);

export type LoadedConfig = {
  environment: "development" | "test" | "production";
  dataDir: string;
  games: Map<string, RuntimeGame>;
  allowedOrigins: string[];
  metricsToken?: string;
};

export function loadConfig(
  path = process.env.BANTAM_CONFIG_FILE ?? "/etc/bantam/games.json",
  env: NodeJS.ProcessEnv = process.env,
): LoadedConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new BantamError("invalid-config", `Cannot read game manifest: ${String(error)}`, 500);
  }
  if (!Value.Check(ManifestSchema, raw)) {
    const details = [...Value.Errors(ManifestSchema, raw)]
      .map((item) => `${item.path}: ${item.message}`)
      .join("; ");
    throw new BantamError("invalid-config", `Invalid game manifest: ${details}`, 500);
  }
  const manifest = raw as { environment: LoadedConfig["environment"]; games: GameManifestEntry[] };
  const only = env.BANTAM_ONLY_GAME;
  const selected = only ? manifest.games.filter((game) => game.id === only) : manifest.games;
  if (only && selected.length !== 1)
    throw new BantamError("invalid-config", `Unknown BANTAM_ONLY_GAME: ${only}`, 500);
  if (new Set(selected.map((game) => game.id)).size !== selected.length) {
    throw new BantamError("invalid-config", "Duplicate game id", 500);
  }
  const games = new Map<string, RuntimeGame>();
  for (const game of selected) {
    if (manifest.environment === "production" && game.authProvider === "development") {
      throw new BantamError("invalid-config", `Development auth forbidden for ${game.id}`, 500);
    }
    const readSecret = (suffix: string): string => {
      const key = `${game.secretPrefix}_${suffix}`;
      const value = env[key];
      if (!value || value.length < 16)
        throw new BantamError("invalid-config", `Missing or short secret: ${key}`, 500);
      return value;
    };
    const runtime: RuntimeGame = {
      ...game,
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
  };
}
