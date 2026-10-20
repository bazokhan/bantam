import { googlePlayServiceAccountEnv } from "../services/economy.js";
import type { RuntimeGame } from "../types.js";

// Required env keys per game. Booleans only — never echo the value back to
// the operator, even in error messages. The full key names are documented in
// the SKILL so this list stays authoritative.
export function requiredEnvKeys(game: RuntimeGame): string[] {
  const base = [
    `${game.secretPrefix}_IDENTITY_SALT`,
    `${game.secretPrefix}_SESSION_SECRET`,
    `${game.secretPrefix}_CURSOR_SECRET`,
  ];
  if (game.authProvider === "pgs-v2")
    base.push(`${game.secretPrefix}_PGS_CLIENT_ID`, `${game.secretPrefix}_PGS_CLIENT_SECRET`);
  if (game.economy?.iapProducts?.some((product) => product.provider === "google_play"))
    base.push(googlePlayServiceAccountEnv(game.secretPrefix));
  return base;
}

export function envPresence(keys: readonly string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of keys) out[key] = Boolean(process.env[key]) && (process.env[key] ?? "").length >= 16;
  return out;
}
