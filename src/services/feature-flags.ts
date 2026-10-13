// Deterministic, server-side feature-flag evaluation.
//
// Clients read flags; they never write them. Bucketing is a pure function of
// (player id, flag key, per-game identity salt), so a given player keeps the
// same decision for a flag no matter which server instance answers, and no
// per-player assignment rows need to be persisted or migrated.

import { hmac } from "../util/crypto.js";
import type { FeatureFlagRow, ResolvedFlag } from "../types.js";

export const FLAG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const FLAG_DESCRIPTION_MAX = 200;
export const FLAG_VALUE_MAX = 500;
export const FLAG_MAX = 64;

export function isValidFlagKey(key: string): boolean {
  return FLAG_KEY_PATTERN.test(key);
}

export function parseRolloutPercent(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    throw new Error("Rollout percent is required");
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new Error("Rollout percent must be an integer 0-100");
  }
  return n;
}

// HMAC-SHA256 of `${flagKey}:${playerId}` keyed with the per-game identity
// salt, then the first 8 hex digits modulo 10_000 → bucket 0..9999.
function bucket(subject: string, flagKey: string, salt: string): number {
  const digest = hmac(`${flagKey}:${subject}`, salt);
  return Number.parseInt(digest.slice(0, 8), 16) % 10_000;
}

// Anonymous callers have no stable id, so a partial rollout cannot be resolved
// for them. They see a flag only when it is fully rolled out (100%), which
// keeps signed-out behaviour predictable instead of flipping per request.
// `value` is sent only when the flag resolves on for this caller.
export function resolveFlags(
  rows: readonly FeatureFlagRow[],
  subject: string | null,
  salt: string,
): ResolvedFlag[] {
  return rows.map((row) => {
    const enabled = Boolean(row.enabled);
    let on = false;
    if (enabled && row.rolloutPercent >= 100) on = true;
    else if (enabled && row.rolloutPercent > 0 && subject !== null) {
      on = bucket(subject, row.key, salt) < row.rolloutPercent * 100;
    }
    return { key: row.key, enabled: on, value: on ? row.value : null };
  });
}
