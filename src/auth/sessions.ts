import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { GameDatabase } from "../db/game-database.js";
import { BantamError } from "../errors.js";
import type { RuntimeGame } from "../types.js";
import { opaqueToken, sha256 } from "../util/crypto.js";

const ACCESS_SECONDS = 15 * 60;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionTokens = { accessToken: string; refreshToken: string; expiresIn: number };

export async function issueSession(
  db: GameDatabase,
  game: RuntimeGame,
  playerId: string,
  now = Date.now(),
): Promise<SessionTokens> {
  const refreshToken = opaqueToken();
  db.insertRefresh(sha256(refreshToken), playerId, randomUUID(), now + REFRESH_MS, now);
  return { accessToken: await signAccess(game, playerId, now), refreshToken, expiresIn: ACCESS_SECONDS };
}

export async function rotateSession(
  db: GameDatabase,
  game: RuntimeGame,
  oldToken: string,
  now = Date.now(),
): Promise<SessionTokens> {
  if (!oldToken || oldToken.length > 256)
    throw new BantamError("reauth-required", "Reauthentication required", 401);
  const refreshToken = opaqueToken();
  const rotated = db.rotateRefresh(sha256(oldToken), sha256(refreshToken), now + REFRESH_MS, now);
  return {
    accessToken: await signAccess(game, rotated.playerId, now),
    refreshToken,
    expiresIn: ACCESS_SECONDS,
  };
}

export function revokeSession(db: GameDatabase, refreshToken: string, now = Date.now()): void {
  if (refreshToken && refreshToken.length <= 256) db.revokeRefresh(sha256(refreshToken), now);
}

async function signAccess(game: RuntimeGame, playerId: string, now: number): Promise<string> {
  return new SignJWT({ gid: game.id })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(playerId)
    .setIssuer("bantam")
    .setAudience(`bantam:${game.id}`)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + ACCESS_SECONDS)
    .sign(new TextEncoder().encode(game.sessionSecret));
}

export async function verifyAccess(game: RuntimeGame, token: string): Promise<string> {
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(game.sessionSecret), {
      algorithms: ["HS256"],
      issuer: "bantam",
      audience: `bantam:${game.id}`,
    });
    if (!result.payload.sub || result.payload.gid !== game.id) throw new Error("invalid claims");
    return result.payload.sub;
  } catch {
    throw new BantamError("invalid-session", "Session is missing or expired", 401);
  }
}
