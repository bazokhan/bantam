import { BantamError } from "../errors.js";
import type { RuntimeGame } from "../types.js";
import { sanitizeDisplayName } from "../util/display-name.js";

export type ProviderIdentity = { rawId: string; displayName: string };

export interface AuthProviderV1 {
  readonly id: RuntimeGame["authProvider"];
  exchange(code: string, game: RuntimeGame, signal: AbortSignal): Promise<ProviderIdentity>;
}

export class DevelopmentAuthProvider implements AuthProviderV1 {
  readonly id = "development" as const;
  async exchange(code: string): Promise<ProviderIdentity> {
    if (!/^[A-Za-z0-9._~-]{3,128}$/.test(code))
      throw new BantamError("invalid-auth-code", "Invalid development auth code", 401);
    return { rawId: code, displayName: sanitizeDisplayName(`Player ${code.slice(0, 12)}`) };
  }
}

export class PgsV2AuthProvider implements AuthProviderV1 {
  readonly id = "pgs-v2" as const;
  async exchange(code: string, game: RuntimeGame, signal: AbortSignal): Promise<ProviderIdentity> {
    if (!code || code.length > 2048 || !game.pgsClientId || !game.pgsClientSecret) {
      throw new BantamError("invalid-auth-code", "Invalid authorization code", 401);
    }
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: game.pgsClientId,
          client_secret: game.pgsClientSecret,
          grant_type: "authorization_code",
        }),
        signal,
      });
    } catch {
      throw new BantamError("provider-unavailable", "Authentication provider unavailable", 503);
    }
    if (!tokenResponse.ok)
      throw new BantamError("provider-rejected", "Play Games authentication failed", 401);
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token)
      throw new BantamError("provider-rejected", "Play Games authentication failed", 401);
    let playerResponse: Response;
    try {
      playerResponse = await fetch("https://games.googleapis.com/games/v1/players/me", {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal,
      });
    } catch {
      throw new BantamError("provider-unavailable", "Authentication provider unavailable", 503);
    }
    if (!playerResponse.ok)
      throw new BantamError("provider-rejected", "Play Games identity lookup failed", 401);
    const player = (await playerResponse.json()) as { playerId?: string; displayName?: string };
    if (!player.playerId) throw new BantamError("provider-rejected", "Play Games identity missing", 401);
    return { rawId: player.playerId, displayName: sanitizeDisplayName(player.displayName) };
  }
}

export function providerFor(game: RuntimeGame): AuthProviderV1 {
  return game.authProvider === "pgs-v2" ? new PgsV2AuthProvider() : new DevelopmentAuthProvider();
}
