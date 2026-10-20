/**
 * Thin typed client over `/admin/api/*`. The admin session cookie is
 * HttpOnly + SameSite=Strict, so the browser attaches it to same-origin
 * fetches automatically — no token ever reaches JavaScript.
 */

import type {
  ActivityPoint,
  AdapterSourceResponse,
  AdaptersResponse,
  AuditResponse,
  BoardEntriesResponse,
  EconomyCatalogWrite,
  EconomyResponse,
  FeatureFlagRow,
  FlagWriteRequest,
  FlagsResponse,
  GameDetail,
  GameSettingsResponse,
  GameSettingsWriteRequest,
  GameSummary,
  HealthResponse,
  InventoryItem,
  LeaderboardEntry,
  ManifestResponse,
  OverviewResponse,
  PlayerDetail,
  PlayerEntriesResponse,
  PlayersResponse,
  RewardClaimRequest,
  RewardClaimResponse,
  RunsResponse,
  SessionResponse,
  WalletBalance,
} from "./types";

export class AdminApiError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const body = payload as {
      error?: string | { code?: string; message?: string };
      message?: string;
      details?: string[];
    };
    const nested = typeof body.error === "object" ? body.error : undefined;
    throw new AdminApiError(
      response.status,
      body.message ??
        nested?.message ??
        (typeof body.error === "string" ? body.error : undefined) ??
        `Request failed with status ${response.status}`,
      body.details ?? [],
    );
  }
  return payload as T;
}

const json = (method: "POST" | "PUT" | "DELETE", body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const api = {
  session: () => request<SessionResponse>("/admin/api/session"),

  logout: () => request<void>("/admin/api/logout", json("POST", {})),

  overview: () => request<OverviewResponse>("/admin/api/overview"),

  games: () => request<GameSummary[]>("/admin/api/games"),

  game: (gameId: string) => request<GameDetail>(`/admin/api/games/${encodeURIComponent(gameId)}`),

  boardEntries: (gameId: string, boardId: string, period?: string) =>
    request<BoardEntriesResponse>(
      `/admin/api/games/${encodeURIComponent(gameId)}/boards/${encodeURIComponent(boardId)}` +
        (period ? `?period=${encodeURIComponent(period)}` : ""),
    ),

  players: (gameId: string) =>
    request<PlayersResponse>(`/admin/api/games/${encodeURIComponent(gameId)}/players`),

  player: (gameId: string, playerId: string) =>
    request<PlayerDetail>(
      `/admin/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}`,
    ),

  playerEntries: (gameId: string, playerId: string) =>
    request<PlayerEntriesResponse>(
      `/admin/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}/entries`,
    ),

  deletePlayer: (gameId: string, playerId: string) =>
    request<void>(
      `/admin/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}`,
      json("DELETE", {}),
    ),

  adjustCurrency: (
    gameId: string,
    playerId: string,
    body: {
      currencyId: string;
      amount: number;
      direction: "credit" | "debit";
      reason?: string;
      requestId?: string;
    },
  ) =>
    request<WalletBalance[]>(
      `/admin/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}/currency`,
      json("POST", body),
    ),

  adjustItem: (
    gameId: string,
    playerId: string,
    body: {
      itemId: string;
      quantity: number;
      direction: "grant" | "remove";
      reason?: string;
      requestId?: string;
    },
  ) =>
    request<InventoryItem[]>(
      `/admin/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}/item`,
      json("POST", body),
    ),

  runs: (gameId: string, limit = 100) =>
    request<RunsResponse>(`/admin/api/games/${encodeURIComponent(gameId)}/runs?limit=${limit}`),

  flags: (gameId: string) =>
    request<FlagsResponse>(`/admin/api/games/${encodeURIComponent(gameId)}/flags`).then(
      (response) => response.flags,
    ),

  writeFlag: (gameId: string, key: string, body: FlagWriteRequest) =>
    request<FeatureFlagRow>(
      `/admin/api/games/${encodeURIComponent(gameId)}/flags/${encodeURIComponent(key)}`,
      json("PUT", body),
    ),

  toggleFlag: (gameId: string, key: string) =>
    request<FeatureFlagRow>(
      `/admin/api/games/${encodeURIComponent(gameId)}/flags/${encodeURIComponent(key)}/toggle`,
      json("POST", {}),
    ),

  deleteFlag: (gameId: string, key: string) =>
    request<void>(
      `/admin/api/games/${encodeURIComponent(gameId)}/flags/${encodeURIComponent(key)}`,
      json("DELETE", {}),
    ),

  economy: (gameId: string) =>
    request<EconomyResponse>(`/admin/api/games/${encodeURIComponent(gameId)}/economy`),

  saveEconomy: (gameId: string, catalog: EconomyCatalogWrite) =>
    request<EconomyResponse>(
      `/admin/api/games/${encodeURIComponent(gameId)}/economy`,
      json("PUT", catalog),
    ),

  saveGameSettings: (gameId: string, body: GameSettingsWriteRequest) =>
    request<GameSettingsResponse>(
      `/admin/api/games/${encodeURIComponent(gameId)}/settings`,
      json("PUT", body),
    ),

  claimReward: (
    gameId: string,
    playerId: string,
    rewardId: string,
    body: RewardClaimRequest = {},
  ) =>
    request<RewardClaimResponse>(
      `/admin/api/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}` +
        `/rewards/${encodeURIComponent(rewardId)}`,
      json("POST", body),
    ),

  health: () => request<HealthResponse>("/admin/api/health"),

  manifest: () => request<ManifestResponse>("/admin/api/manifest"),

  saveManifest: (manifest: Record<string, unknown>) =>
    request<ManifestResponse>("/admin/api/manifest", json("PUT", { manifest })),

  adapters: () => request<AdaptersResponse>("/admin/api/adapters"),

  adapterSource: (adapterId: string) =>
    request<AdapterSourceResponse>(`/admin/api/adapters/${encodeURIComponent(adapterId)}/source`),

  audit: (params: { limit?: number; action?: string; gameId?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.action) query.set("action", params.action);
    if (params.gameId) query.set("gameId", params.gameId);
    const suffix = query.toString();
    return request<AuditResponse>(`/admin/api/audit${suffix ? `?${suffix}` : ""}`);
  },
};

export type { ActivityPoint, LeaderboardEntry };
