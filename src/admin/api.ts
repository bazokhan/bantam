import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  listAdapterFiles,
  listAdapterGames,
  listAdapterOrigins,
  listLoadedAdapters,
} from "../adapters/registry.js";
import type { Runtime } from "../app.js";
import { ADMIN_COOKIE_NAME, revokeSession } from "../auth/admin.js";
import type { AdminDatabase } from "../db/admin-database.js";
import { BantamError } from "../errors.js";
import { ManifestSchema } from "../config.js";
import {
  catalogCurrency,
  catalogItem,
  catalogReward,
  parseEconomyCatalog,
  type EconomyCatalog,
  type EconomyGrant,
} from "../services/economy.js";
import {
  FLAG_DESCRIPTION_MAX,
  FLAG_VALUE_MAX,
  isValidFlagKey,
  parseRolloutPercent,
} from "../services/feature-flags.js";
import type { BoardDefinition, FeatureFlag } from "../types.js";
import {
  AdapterSourceSchema,
  AdaptersResponseSchema,
  AuditResponseSchema,
  BoardEntriesResponseSchema,
  EconomyCatalogWriteBodySchema,
  EconomyResponseSchema,
  EmptyBodySchema,
  FeatureFlagRowSchema,
  FlagWriteBodySchema,
  FlagsResponseSchema,
  GameDetailSchema,
  GameSettingsResponseSchema,
  GameSettingsWriteBodySchema,
  GameSummarySchema,
  HealthResponseSchema,
  InventoryItemSchema,
  ManifestResponseSchema,
  ManifestWriteBodySchema,
  OverviewResponseSchema,
  PlayerDetailSchema,
  PlayerEntriesResponseSchema,
  PlayersResponseSchema,
  RewardClaimBodySchema,
  RewardClaimResponseSchema,
  RunsResponseSchema,
  SessionResponseSchema,
  WalletBalanceSchema,
} from "./api-schemas.js";
import { envPresence, requiredEnvKeys } from "./env-keys.js";
import { clearCookieValue, cookieSecureFor } from "./middleware.js";
import type { ManifestFile, ManifestStore } from "./manifest-store.js";

export type ReloadRuntimes = (manifest: ManifestFile) => Promise<{ added: string[]; removed: string[] }>;

// The manifest's game entry as the admin API edits it. The manifest schema
// types `adapters` as unknown[] because each adapter kind is validated
// separately, so the entry is handled as a loose record here and narrowed by
// the manifest validation before it is written.
type MutableManifestGame = {
  id: string;
  displayName: string;
  adapters: unknown[];
  secretPrefix: string;
  gracePeriodHours: number;
  authProvider: "pgs-v2" | "development";
  economy?: EconomyCatalog;
};

export type AdminApiOptions = {
  allowedOrigins: string[];
  version: string;
};

const GameParams = Type.Object(
  { gameId: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);
const GameBoardParams = Type.Object(
  {
    gameId: Type.String({ minLength: 1, maxLength: 64 }),
    boardId: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { additionalProperties: false },
);
const GamePlayerParams = Type.Object(
  {
    gameId: Type.String({ minLength: 1, maxLength: 64 }),
    playerId: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
const CurrencyAdjustmentBody = Type.Object(
  {
    currencyId: Type.String({ minLength: 1, maxLength: 48 }),
    amount: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
    direction: Type.Union([Type.Literal("credit"), Type.Literal("debit")]),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);
const ItemAdjustmentBody = Type.Object(
  {
    itemId: Type.String({ minLength: 1, maxLength: 48 }),
    quantity: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
    direction: Type.Union([Type.Literal("grant"), Type.Literal("remove")]),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);
const GameFlagParams = Type.Object(
  { gameId: Type.String({ minLength: 1, maxLength: 64 }), key: Type.String({ minLength: 1, maxLength: 80 }) },
  { additionalProperties: false },
);
const GamePlayerRewardParams = Type.Object(
  {
    gameId: Type.String({ minLength: 1, maxLength: 64 }),
    playerId: Type.String({ minLength: 1, maxLength: 128 }),
    rewardId: Type.String({ minLength: 1, maxLength: 48 }),
  },
  { additionalProperties: false },
);
const AdapterParams = Type.Object(
  { adapterId: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);

// An adapter module is a source file an operator shipped; 512 KB is far above
// any real adapter and keeps the endpoint from serving an arbitrary file.
const ADAPTER_SOURCE_MAX_BYTES = 512 * 1024;
const RunsQuery = Type.Object(
  { limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) },
  { additionalProperties: false },
);
const BoardQuery = Type.Object(
  { period: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })) },
  { additionalProperties: false },
);
const AuditQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    action: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    gameId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

// Stable vocabulary for the audit trail. The console filters on these strings,
// so they are part of the API contract.
type AuditAction =
  | "flag.write"
  | "flag.toggle"
  | "flag.delete"
  | "player.delete"
  | "currency.credit"
  | "currency.debit"
  | "item.grant"
  | "item.remove"
  | "reward.claim"
  | "economy.update"
  | "game.update"
  | "manifest.save";

function isoOrNull(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value).toISOString();
}

function todayUtc(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function startOfTodayUtc(nowMs: number): number {
  const day = todayUtc(nowMs);
  return Date.parse(`${day}T00:00:00.000Z`);
}

function boardPeriodKey(board: BoardDefinition, nowMs: number): string {
  return board.period === "all_time" ? "all_time" : todayUtc(nowMs);
}

// Last `days` period keys, newest first, for a daily board.
function recentPeriodKeys(days: number, nowMs: number): string[] {
  const out: string[] = [];
  for (let offset = 0; offset < days; offset++) {
    out.push(new Date(nowMs - offset * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

function findBoard(
  runtime: Runtime,
  boardId: string,
): { board: BoardDefinition; adapterId: string; adapterVersion: string } | undefined {
  for (const adapter of runtime.adapters.values()) {
    const board = adapter.boards.find((candidate) => candidate.id === boardId);
    if (board) return { board, adapterId: adapter.id, adapterVersion: adapter.version };
  }
  return undefined;
}

function allBoards(
  runtime: Runtime,
): Array<{ board: BoardDefinition; adapterId: string; adapterVersion: string }> {
  const out: Array<{ board: BoardDefinition; adapterId: string; adapterVersion: string }> = [];
  for (const adapter of runtime.adapters.values()) {
    for (const board of adapter.boards)
      out.push({ board, adapterId: adapter.id, adapterVersion: adapter.version });
  }
  return out;
}

function gameSummary(runtime: Runtime, nowMs: number) {
  const boards = allBoards(runtime).map(({ board }) => ({
    id: board.id,
    period: board.period,
    entries: runtime.db.countBoardEntries(board.id, boardPeriodKey(board, nowMs)),
  }));
  const envKeys = requiredEnvKeys(runtime.game);
  const presence = envPresence(envKeys);
  return {
    id: runtime.game.id,
    displayName: runtime.game.displayName,
    authProvider: runtime.game.authProvider,
    secretPrefix: runtime.game.secretPrefix,
    adapterCount: runtime.adapters.size,
    boards,
    players: runtime.db.countPlayers(),
    flags: runtime.db.countFlags(),
    runsToday: runtime.db.countRunsSince(startOfTodayUtc(nowMs)),
    lastRunAt: isoOrNull(runtime.db.lastRunAt()),
    dbReady: runtime.db.ready(),
    envKeys: envKeys.map((name) => ({ name, present: presence[name] ?? false })),
  };
}

function manifestEnvironment(manifestStore: ManifestStore): string {
  const loaded = manifestStore.load();
  return loaded.ok ? loaded.manifest.environment : "development";
}

// A catalog grant is one of two shapes depending on its kind. The console
// renders both in one table, so the response flattens them into one row shape
// and the write endpoint accepts the catalog's own shape back.
function grantRows(grants: readonly EconomyGrant[]) {
  return grants.map((grant) =>
    grant.kind === "currency"
      ? { kind: "currency" as const, currencyId: grant.currencyId, amount: grant.amount }
      : { kind: "item" as const, itemId: grant.itemId, quantity: grant.quantity },
  );
}

// The whole economy catalog of one game plus the live balance summary. This is
// the read model the console edits against, so it must carry every field the
// write endpoint accepts — otherwise a round-trip would silently drop data.
function economyResponse(runtime: Runtime, nowMs: number) {
  const summary = runtime.db.economySummary(startOfTodayUtc(nowMs));
  const economySummary = {
    currencies: summary.currencies.map((entry) => ({
      id: entry.currency,
      amount: entry.amount,
      holders: entry.holders,
    })),
    items: summary.items.map((entry) => ({
      id: entry.item,
      quantity: entry.quantity,
      holders: entry.holders,
    })),
    walletTransactions: summary.walletTransactions,
    inventoryTransactions: summary.inventoryTransactions,
    playersWithBalance: summary.playersWithBalance,
  };
  const catalog = runtime.game.economy;
  if (!catalog) {
    return {
      currencies: [],
      items: [],
      offers: [],
      rewards: [],
      iapProducts: [],
      summary: economySummary,
    };
  }
  return {
    currencies: catalog.currencies.map((currency) => ({ id: currency.id })),
    items: catalog.items.map((item) => ({
      id: item.id,
      type: item.type,
      stackable: item.stackable,
      usable: item.usable ?? false,
    })),
    offers: catalog.offers.map((offer) => ({
      id: offer.id,
      itemId: offer.itemId,
      quantity: offer.quantity,
      priceCurrencyId: offer.priceCurrencyId,
      priceAmount: offer.priceAmount,
      active: offer.active ?? true,
      maxPerPlayer: offer.maxPerPlayer ?? null,
      startsAtMs: offer.startsAtMs ?? null,
      endsAtMs: offer.endsAtMs ?? null,
      salePriceAmount: offer.salePriceAmount ?? null,
      saleStartsAtMs: offer.saleStartsAtMs ?? null,
      saleEndsAtMs: offer.saleEndsAtMs ?? null,
    })),
    rewards: (catalog.rewards ?? []).map((reward) => ({
      id: reward.id,
      grants: grantRows(reward.grants),
      maxClaims: reward.maxClaims ?? null,
    })),
    iapProducts: (catalog.iapProducts ?? []).map((product) => ({
      id: product.id,
      provider: product.provider,
      providerProductId: product.providerProductId,
      packageName: product.packageName,
      grants: grantRows(product.grants),
      active: product.active ?? true,
      startsAtMs: product.startsAtMs ?? null,
      endsAtMs: product.endsAtMs ?? null,
      fulfillment: product.fulfillment ?? null,
    })),
    summary: economySummary,
  };
}

// Daily player and run counts summed across every loaded game, so the
// overview chart describes the whole deployment rather than one game.
function aggregateActivity(
  runtimes: Map<string, Runtime>,
  days: number,
  nowMs: number,
): Array<{ date: string; players: number; runs: number }> {
  const totals = new Map<string, { players: number; runs: number }>();
  for (const runtime of runtimes.values()) {
    for (const point of runtime.db.dailyActivity(days, nowMs)) {
      const current = totals.get(point.date) ?? { players: 0, runs: 0 };
      current.players += point.players;
      current.runs += point.runs;
      totals.set(point.date, current);
    }
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, ...value }));
}

function flagRow(
  row: {
    key: string;
    description: string;
    enabled: number;
    rolloutPercent: number;
    value: string | null;
    updatedAt: number;
  },
  environment: string,
) {
  const parts: string[] = [];
  if (!row.enabled) parts.push("off");
  else if (row.rolloutPercent < 100) parts.push(`${row.rolloutPercent}% rollout`);
  else parts.push("100% rollout");
  if (row.value) parts.push(`value "${row.value}"`);
  return {
    key: row.key,
    enabled: row.enabled === 1,
    description: row.description,
    targeting: parts.join(" · "),
    updatedAt: isoOrNull(row.updatedAt),
    environment,
  };
}

function readCookies(request: FastifyRequest): Record<string, string> {
  return (request as unknown as { cookies?: Record<string, string> }).cookies ?? {};
}

export async function registerAdminApi(
  app: FastifyInstance,
  adminDb: AdminDatabase,
  runtimes: Map<string, Runtime>,
  reloadRuntimes: ReloadRuntimes,
  manifestStore: ManifestStore,
  options: AdminApiOptions,
): Promise<void> {
  const now = () => Date.now();

  const requireRuntime = (request: FastifyRequest): Runtime => {
    const gameId = (request.params as { gameId?: string }).gameId ?? "";
    const runtime = runtimes.get(gameId);
    if (!runtime) {
      throw new BantamError("game-not-found", "Game not found", 404);
    }
    return runtime;
  };

  // Appends one row to the operator trail. The mutation it describes has
  // already committed in the game database, so a failure here is logged
  // rather than turned into an error response — reporting a failed action
  // for work that actually landed would be the worse lie.
  const recordAudit = (
    request: FastifyRequest,
    action: AuditAction,
    subject: { gameId?: string | null; target?: string | null; details?: Record<string, unknown> },
  ): void => {
    const adminId = request.adminId ?? null;
    const admin = adminId ? adminDb.findAdminById(adminId) : undefined;
    try {
      adminDb.insertAudit({
        adminId,
        adminUsername: admin?.username ?? "unknown",
        action,
        gameId: subject.gameId ?? null,
        target: subject.target ?? null,
        details: JSON.stringify(subject.details ?? {}),
        now: now(),
      });
    } catch (error) {
      request.log.error({ err: error, action }, "could not write the admin audit row");
    }
  };

  // Applies a typed edit to one game's manifest entry, then persists and
  // reloads. The write is validated against the whole manifest before it
  // touches disk, and a failed runtime reload restores the previous file —
  // the console never leaves the server in a half-applied state.
  const updateManifestGame = async (
    gameId: string,
    mutate: (game: MutableManifestGame) => MutableManifestGame,
  ): Promise<void> => {
    const loaded = manifestStore.load();
    if (!loaded.ok) throw new BantamError("manifest-unreadable", loaded.error, 500);
    const prior = JSON.parse(JSON.stringify(loaded.manifest)) as ManifestFile;
    const manifest = JSON.parse(JSON.stringify(loaded.manifest)) as ManifestFile;
    const games = manifest.games as unknown as MutableManifestGame[];
    let found = false;
    const nextGames = games.map((game) => {
      if (game.id !== gameId) return game;
      found = true;
      return mutate(game);
    });
    if (!found) throw new BantamError("game-not-found", "Game not found", 404);
    manifest.games = nextGames;
    if (!Value.Check(ManifestSchema, manifest)) {
      const details = [...Value.Errors(ManifestSchema, manifest)]
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ");
      throw new BantamError("invalid-manifest", `Invalid manifest: ${details}`, 400);
    }
    const saveResult = manifestStore.save(JSON.stringify(manifest, null, 2));
    if (!saveResult.ok) {
      throw new BantamError("manifest-save-failed", saveResult.errors.join("; "), 400);
    }
    try {
      await reloadRuntimes(manifest);
    } catch (error) {
      try {
        manifestStore.save(JSON.stringify(prior, null, 2));
      } catch {
        // keep the original failure as the reported error
      }
      throw new BantamError(
        "manifest-reload-failed",
        `Manifest rolled back: runtime reload failed (${String(error)})`,
        500,
      );
    }
  };

  // ─── Session ──────────────────────────────────────────────────────────────

  app.get(
    "/admin/api/session",
    { schema: { response: { 200: SessionResponseSchema } } },
    async (request: FastifyRequest) => {
      const adminId = request.adminId;
      const admin = adminId ? adminDb.findAdminById(adminId) : undefined;
      return {
        admin: admin
          ? {
              id: admin.id,
              username: admin.username,
              createdAt: isoOrNull(admin.created_at),
              lastLoginAt: isoOrNull(admin.last_login_at),
            }
          : null,
        firstRun: adminDb.countAdmins() === 0,
      };
    },
  );

  app.post(
    "/admin/api/logout",
    { schema: { body: EmptyBodySchema, response: { 204: { type: "null" } } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cookie = readCookies(request)[ADMIN_COOKIE_NAME];
      if (cookie) revokeSession(adminDb, cookie);
      reply.header("set-cookie", clearCookieValue(ADMIN_COOKIE_NAME, { secure: cookieSecureFor(request) }));
      return reply.code(204).send();
    },
  );

  // ─── Overview ─────────────────────────────────────────────────────────────

  app.get("/admin/api/overview", { schema: { response: { 200: OverviewResponseSchema } } }, async () => {
    const nowMs = now();
    const games = [...runtimes.values()].map((runtime) => gameSummary(runtime, nowMs));
    const activity = aggregateActivity(runtimes, 7, nowMs);
    const recentRuns = [...runtimes.values()].flatMap((runtime) =>
      runtime.db.recentEntries(8).map((entry) => ({ ...entry, gameId: runtime.game.id })),
    );
    recentRuns.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return {
      generatedAt: new Date(nowMs).toISOString(),
      totals: {
        games: games.length,
        players: games.reduce((sum, game) => sum + game.players, 0),
        runsToday: games.reduce((sum, game) => sum + game.runsToday, 0),
        flags: games.reduce((sum, game) => sum + game.flags, 0),
        boards: games.reduce((sum, game) => sum + game.boards.length, 0),
      },
      games,
      activity,
      recentRuns: recentRuns.slice(0, 20).map((entry) => ({
        id: entry.id,
        boardId: entry.boardId,
        period: entry.period,
        value: entry.value,
        createdAt: isoOrNull(entry.createdAt),
        playerId: entry.playerId,
        displayName: entry.displayName,
        gameId: entry.gameId,
      })),
    };
  });

  // ─── Games ────────────────────────────────────────────────────────────────

  app.get("/admin/api/games", { schema: { response: { 200: Type.Array(GameSummarySchema) } } }, async () => {
    const nowMs = now();
    return [...runtimes.values()].map((runtime) => gameSummary(runtime, nowMs));
  });

  app.get(
    "/admin/api/games/:gameId",
    { schema: { params: GameParams, response: { 200: GameDetailSchema } } },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const nowMs = now();
      const summary = gameSummary(runtime, nowMs);
      return {
        ...summary,
        gracePeriodHours: runtime.game.gracePeriodHours,
        environment: manifestEnvironment(manifestStore),
        adapters: [...runtime.adapters.values()].map((adapter) => ({
          id: adapter.id,
          kind: adapter.id.startsWith("synthesized") ? "generic" : "file",
          version: adapter.version,
          boards: adapter.boards.map((board) => board.id),
        })),
      };
    },
  );

  // Typed edit of one game's identity fields. The game id and the secret
  // prefix stay out of reach: the id is the database path and the prefix
  // names the environment variables the server reads at boot.
  app.put(
    "/admin/api/games/:gameId/settings",
    {
      schema: {
        params: GameParams,
        body: GameSettingsWriteBodySchema,
        response: { 200: GameSettingsResponseSchema },
      },
    },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const body = request.body as {
        displayName: string;
        authProvider: "pgs-v2" | "development";
        gracePeriodHours: number;
      };
      await updateManifestGame(runtime.game.id, (game) => ({
        ...game,
        displayName: body.displayName,
        authProvider: body.authProvider,
        gracePeriodHours: body.gracePeriodHours,
      }));
      const updated = runtimes.get(runtime.game.id) ?? runtime;
      recordAudit(request, "game.update", {
        gameId: runtime.game.id,
        target: runtime.game.id,
        details: {
          displayName: body.displayName,
          authProvider: body.authProvider,
          gracePeriodHours: body.gracePeriodHours,
        },
      });
      request.log.info({ admin: request.adminId, game: runtime.game.id }, "admin updated the game settings");
      return {
        id: updated.game.id,
        displayName: updated.game.displayName,
        authProvider: updated.game.authProvider,
        gracePeriodHours: updated.game.gracePeriodHours,
        secretPrefix: updated.game.secretPrefix,
        environment: manifestEnvironment(manifestStore),
      };
    },
  );

  // ─── Leaderboards ─────────────────────────────────────────────────────────

  app.get(
    "/admin/api/games/:gameId/boards/:boardId",
    {
      schema: {
        params: GameBoardParams,
        querystring: BoardQuery,
        response: { 200: BoardEntriesResponseSchema },
      },
    },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const boardId = (request.params as { boardId: string }).boardId;
      const found = findBoard(runtime, boardId);
      if (!found) throw new BantamError("board-not-found", "Board not found", 404);
      const nowMs = now();
      const requested = (request.query as { period?: string }).period;
      const period = requested ?? boardPeriodKey(found.board, nowMs);
      const entries = runtime.db.listAdmin(found.board, period, 50);
      const periods = found.board.period === "daily" ? recentPeriodKeys(7, nowMs) : ["all_time"];
      return {
        boardId: found.board.id,
        period,
        periods,
        entries: entries.map((entry) => ({
          rank: entry.rank,
          playerId: entry.playerId,
          displayName: entry.displayName,
          value: entry.value,
          updatedAt: isoOrNull(entry.updatedAt),
        })),
      };
    },
  );

  // ─── Players ──────────────────────────────────────────────────────────────

  app.get(
    "/admin/api/games/:gameId/players",
    { schema: { params: GameParams, response: { 200: PlayersResponseSchema } } },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const rows = runtime.db.listPlayers(200);
      const runCounts = runtime.db.runCountsByPlayer();
      return {
        players: rows.map((row) => ({
          id: row.id,
          displayName: row.displayName,
          provider: row.provider,
          createdAt: isoOrNull(row.createdAt),
          runs: runCounts.get(row.id) ?? 0,
        })),
        total: runtime.db.countPlayers(),
      };
    },
  );

  app.get(
    "/admin/api/games/:gameId/players/:playerId",
    { schema: { params: GamePlayerParams, response: { 200: PlayerDetailSchema } } },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const playerId = (request.params as { playerId: string }).playerId;
      const row = runtime.db.getPlayerRow(playerId);
      if (!row) throw new BantamError("player-not-found", "Player not found", 404);
      const runCounts = runtime.db.runCountsByPlayer();
      const rewardLimits = new Map(
        (runtime.game.economy?.rewards ?? []).map((reward) => [reward.id, reward.maxClaims ?? 1]),
      );
      return {
        id: row.id,
        displayName: row.displayName,
        provider: row.provider,
        createdAt: isoOrNull(row.createdAt),
        wallet: runtime.db.getWallet(playerId).map((balance) => ({
          currency: balance.currencyId,
          amount: balance.balance,
        })),
        ledger: runtime.db.listWalletTransactions(playerId, 50).map((entry) => ({
          id: String(entry.id),
          playerId: entry.playerId,
          currency: entry.currencyId,
          amount: entry.amount,
          balance: entry.balanceAfter,
          reason: entry.reason,
          createdAt: isoOrNull(entry.createdAt),
        })),
        inventory: runtime.db.getInventory(playerId).map((entry) => ({
          item: entry.itemId,
          quantity: entry.quantity,
        })),
        inventoryLedger: runtime.db.listInventoryTransactions(playerId, 50).map((entry) => ({
          id: String(entry.id),
          item: entry.itemId,
          amount: entry.amount,
          balance: entry.quantityAfter,
          reason: entry.reason,
          createdAt: isoOrNull(entry.createdAt),
        })),
        purchases: runtime.db.listStorePurchases(playerId, 50).map((entry) => ({
          id: String(entry.id),
          offerId: entry.offerId,
          itemId: entry.itemId,
          quantity: entry.quantity,
          currencyId: entry.currencyId,
          priceAmount: entry.priceAmount,
          createdAt: isoOrNull(entry.createdAt),
        })),
        iapPurchases: runtime.db.listIapPurchases(playerId, 50).map((entry) => ({
          id: String(entry.id),
          provider: entry.provider,
          productId: entry.productId,
          providerProductId: entry.providerProductId,
          verificationState: entry.verificationState,
          fulfillmentState: entry.fulfillmentState,
          acknowledgeState: entry.acknowledgeState,
          createdAt: isoOrNull(entry.createdAt),
        })),
        rewardClaims: runtime.db.rewardClaims(playerId).map((row) => ({
          rewardId: row.rewardId,
          claims: row.claims,
          maxClaims: rewardLimits.get(row.rewardId) ?? 1,
        })),
        runs: runCounts.get(playerId) ?? 0,
      };
    },
  );

  app.get(
    "/admin/api/games/:gameId/players/:playerId/entries",
    { schema: { params: GamePlayerParams, response: { 200: PlayerEntriesResponseSchema } } },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const playerId = (request.params as { playerId: string }).playerId;
      if (!runtime.db.getPlayerRow(playerId))
        throw new BantamError("player-not-found", "Player not found", 404);
      const directions = new Map<string, "higher" | "lower">(
        allBoards(runtime).map(({ board }) => [board.id, board.direction]),
      );
      const entries = runtime.db.playerEntries(playerId, directions);
      return {
        playerId,
        entries: entries.map((entry) => ({
          boardId: entry.boardId,
          period: entry.period,
          rank: entry.rank,
          value: entry.value,
          achievedAt: isoOrNull(entry.achievedAt),
          runId: entry.runId,
        })),
        total: entries.length,
      };
    },
  );

  app.delete(
    "/admin/api/games/:gameId/players/:playerId",
    { schema: { params: GamePlayerParams, body: EmptyBodySchema, response: { 204: { type: "null" } } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const runtime = requireRuntime(request);
      const playerId = (request.params as { playerId: string }).playerId;
      const changes = runtime.db.deletePlayer(playerId);
      if (!changes) throw new BantamError("player-not-found", "Player not found", 404);
      recordAudit(request, "player.delete", {
        gameId: runtime.game.id,
        target: playerId,
        details: {},
      });
      request.log.info(
        { admin: request.adminId, game: runtime.game.id, player: playerId.slice(0, 8) },
        "admin deleted a player",
      );
      return reply.code(204).send();
    },
  );

  // ─── Economy adjustments ───────────────────────────────────────────────────
  // Operator-initiated wallet and inventory changes. The service layer already
  // enforces the reason format and the idempotency key; the console only
  // supplies them.

  app.post(
    "/admin/api/games/:gameId/players/:playerId/currency",
    {
      schema: {
        params: GamePlayerParams,
        body: CurrencyAdjustmentBody,
        response: { 200: Type.Array(WalletBalanceSchema) },
      },
    },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const playerId = (request.params as { playerId: string }).playerId;
      if (!runtime.db.getPlayerRow(playerId))
        throw new BantamError("player-not-found", "Player not found", 404);
      const body = request.body as {
        currencyId: string;
        amount: number;
        direction: "credit" | "debit";
        reason?: string;
        requestId?: string;
      };
      const currency = catalogCurrency(runtime.game.economy, body.currencyId);
      const reason = body.reason?.trim() || "admin_adjustment";
      const requestId = body.requestId?.trim() || `admin:${randomUUID()}`;
      if (body.direction === "debit") {
        runtime.db.debitCurrency(playerId, currency.id, body.amount, reason, requestId, now());
      } else {
        runtime.db.creditCurrency(playerId, currency.id, body.amount, reason, requestId, now());
      }
      recordAudit(request, body.direction === "debit" ? "currency.debit" : "currency.credit", {
        gameId: runtime.game.id,
        target: playerId,
        details: { currencyId: currency.id, amount: body.amount, reason },
      });
      request.log.info(
        {
          admin: request.adminId,
          game: runtime.game.id,
          player: playerId.slice(0, 8),
          action: `currency-${body.direction}`,
        },
        "admin adjusted currency",
      );
      const wallet = runtime.db.getWallet(playerId);
      return wallet.map((balance) => ({ currency: balance.currencyId, amount: balance.balance }));
    },
  );

  app.post(
    "/admin/api/games/:gameId/players/:playerId/item",
    {
      schema: {
        params: GamePlayerParams,
        body: ItemAdjustmentBody,
        response: { 200: Type.Array(InventoryItemSchema) },
      },
    },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const playerId = (request.params as { playerId: string }).playerId;
      if (!runtime.db.getPlayerRow(playerId))
        throw new BantamError("player-not-found", "Player not found", 404);
      const body = request.body as {
        itemId: string;
        quantity: number;
        direction: "grant" | "remove";
        reason?: string;
        requestId?: string;
      };
      const item = catalogItem(runtime.game.economy, body.itemId);
      const reason = body.reason?.trim() || "admin_adjustment";
      const requestId = body.requestId?.trim() || `admin:${randomUUID()}`;
      if (body.direction === "remove") {
        runtime.db.consumeItem(playerId, item, body.quantity, reason, requestId, now());
      } else {
        runtime.db.grantItem(playerId, item, body.quantity, reason, requestId, now());
      }
      recordAudit(request, body.direction === "remove" ? "item.remove" : "item.grant", {
        gameId: runtime.game.id,
        target: playerId,
        details: { itemId: item.id, quantity: body.quantity, reason },
      });
      request.log.info(
        {
          admin: request.adminId,
          game: runtime.game.id,
          player: playerId.slice(0, 8),
          action: `item-${body.direction}`,
        },
        "admin adjusted inventory",
      );
      return runtime.db
        .getInventory(playerId)
        .map((entry) => ({ item: entry.itemId, quantity: entry.quantity }));
    },
  );

  // ─── Reward claims ───────────────────────────────────────────────────────
  // An operator grants a catalog reward to a player. It uses the same
  // transactional path as the public claim endpoint, so the reward's claim
  // limit still applies and the grant is recorded in reward_claims.

  app.post(
    "/admin/api/games/:gameId/players/:playerId/rewards/:rewardId",
    {
      schema: {
        params: GamePlayerRewardParams,
        body: RewardClaimBodySchema,
        response: { 200: RewardClaimResponseSchema },
      },
    },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const { playerId, rewardId } = request.params as { playerId: string; rewardId: string };
      if (!runtime.db.getPlayerRow(playerId))
        throw new BantamError("player-not-found", "Player not found", 404);
      const catalog = runtime.game.economy;
      if (!catalog) throw new BantamError("reward-not-found", "This game has no economy catalog", 404);
      const reward = catalogReward(catalog, rewardId);
      const body = request.body as { reason?: string; requestId?: string };
      const requestId = body.requestId?.trim() || `admin-reward:${randomUUID()}`;
      const result = runtime.db.claimReward(playerId, reward, catalog, requestId, now());
      const claims = runtime.db.countRewardClaims(playerId, reward.id);
      recordAudit(request, "reward.claim", {
        gameId: runtime.game.id,
        target: playerId,
        details: {
          rewardId: reward.id,
          claims,
          maxClaims: reward.maxClaims ?? 1,
          reason: body.reason?.trim() || "admin_reward_claim",
          replayed: result.replayed,
        },
      });
      request.log.info(
        {
          admin: request.adminId,
          game: runtime.game.id,
          player: playerId.slice(0, 8),
          reward: reward.id,
          claims,
        },
        "admin claimed a reward for a player",
      );
      return {
        rewardId: result.rewardId,
        replayed: result.replayed,
        claims,
        maxClaims: reward.maxClaims ?? 1,
        wallet: result.wallet.map((balance) => ({
          currency: balance.currencyId,
          amount: balance.balance,
        })),
        inventory: result.inventory.map((entry) => ({ item: entry.itemId, quantity: entry.quantity })),
      };
    },
  );

  // ─── Runs ─────────────────────────────────────────────────────────────────

  app.get(
    "/admin/api/games/:gameId/runs",
    { schema: { params: GameParams, querystring: RunsQuery, response: { 200: RunsResponseSchema } } },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const limit = (request.query as { limit?: number }).limit ?? 100;
      const entries = runtime.db.recentEntries(limit);
      return {
        runs: entries.map((entry) => ({
          id: entry.id,
          boardId: entry.boardId,
          period: entry.period,
          value: entry.value,
          createdAt: isoOrNull(entry.createdAt),
          playerId: entry.playerId,
          displayName: entry.displayName,
        })),
        total: runtime.db.countEntries(),
      };
    },
  );

  // ─── Feature flags ────────────────────────────────────────────────────────

  app.get(
    "/admin/api/games/:gameId/flags",
    { schema: { params: GameParams, response: { 200: FlagsResponseSchema } } },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const environment = manifestEnvironment(manifestStore);
      return { flags: runtime.db.listFlags().map((row) => flagRow(row, environment)) };
    },
  );

  app.put(
    "/admin/api/games/:gameId/flags/:key",
    {
      schema: {
        params: GameFlagParams,
        body: FlagWriteBodySchema,
        response: { 200: FeatureFlagRowSchema },
      },
    },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const key = (request.params as { key: string }).key;
      if (!isValidFlagKey(key)) {
        throw new BantamError("invalid-flag", "Flag key is not a valid identifier", 400);
      }
      const body = request.body as {
        enabled: boolean;
        description?: string;
        targeting?: Record<string, unknown>;
      };
      const existing = runtime.db.getFlag(key);
      const targeting = body.targeting ?? {};
      let rolloutPercent = existing?.rolloutPercent ?? 100;
      const rawRollout = targeting["rolloutPercent"];
      if (rawRollout !== undefined && rawRollout !== null) {
        try {
          rolloutPercent = parseRolloutPercent(rawRollout);
        } catch (error) {
          throw new BantamError(
            "invalid-flag",
            error instanceof Error ? error.message : "Invalid rollout percent",
            400,
          );
        }
      }
      const rawValue = targeting["value"];
      if (rawValue !== undefined && rawValue !== null && typeof rawValue !== "string") {
        throw new BantamError("invalid-flag", "Flag value must be a string", 400);
      }
      const value = rawValue === undefined || rawValue === null ? (existing?.value ?? null) : rawValue;
      if (value !== null && value.length > FLAG_VALUE_MAX) {
        throw new BantamError("invalid-flag", `Flag value must be at most ${FLAG_VALUE_MAX} characters`, 400);
      }
      const description = body.description ?? existing?.description ?? "";
      if (description.length > FLAG_DESCRIPTION_MAX) {
        throw new BantamError(
          "invalid-flag",
          `Flag description must be at most ${FLAG_DESCRIPTION_MAX} characters`,
          400,
        );
      }
      const flag: FeatureFlag = { key, description, enabled: body.enabled, rolloutPercent, value };
      const row = runtime.db.upsertFlag(flag, now());
      recordAudit(request, "flag.write", {
        gameId: runtime.game.id,
        target: key,
        details: { enabled: body.enabled, rolloutPercent },
      });
      request.log.info(
        { admin: request.adminId, game: runtime.game.id, flag: key },
        "admin wrote a feature flag",
      );
      return flagRow(row, manifestEnvironment(manifestStore));
    },
  );

  app.post(
    "/admin/api/games/:gameId/flags/:key/toggle",
    {
      schema: {
        params: GameFlagParams,
        body: EmptyBodySchema,
        response: { 200: FeatureFlagRowSchema },
      },
    },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const key = (request.params as { key: string }).key;
      const existing = runtime.db.getFlag(key);
      if (!existing) throw new BantamError("flag-not-found", "Flag not found", 404);
      const flag: FeatureFlag = {
        key,
        description: existing.description,
        enabled: existing.enabled !== 1,
        rolloutPercent: existing.rolloutPercent,
        value: existing.value,
      };
      const row = runtime.db.upsertFlag(flag, now());
      recordAudit(request, "flag.toggle", {
        gameId: runtime.game.id,
        target: key,
        details: { enabled: flag.enabled },
      });
      request.log.info(
        { admin: request.adminId, game: runtime.game.id, flag: key },
        "admin toggled a feature flag",
      );
      return flagRow(row, manifestEnvironment(manifestStore));
    },
  );

  app.delete(
    "/admin/api/games/:gameId/flags/:key",
    {
      schema: {
        params: GameFlagParams,
        body: EmptyBodySchema,
        response: { 204: { type: "null" } },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const runtime = requireRuntime(request);
      const key = (request.params as { key: string }).key;
      const changes = runtime.db.deleteFlag(key);
      if (!changes) throw new BantamError("flag-not-found", "Flag not found", 404);
      recordAudit(request, "flag.delete", {
        gameId: runtime.game.id,
        target: key,
        details: {},
      });
      request.log.info(
        { admin: request.adminId, game: runtime.game.id, flag: key },
        "admin deleted a feature flag",
      );
      return reply.code(204).send();
    },
  );

  // ─── Economy ──────────────────────────────────────────────────────────────

  app.get(
    "/admin/api/games/:gameId/economy",
    { schema: { params: GameParams, response: { 200: EconomyResponseSchema } } },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      return economyResponse(runtime, now());
    },
  );

  // Typed replacement for the raw-JSON manifest editor: the console sends the
  // whole catalog, the server validates it against the economy contract, and
  // the manifest entry is patched and reloaded. Unknown fields are rejected,
  // and a catalog that breaks referential integrity never reaches disk.
  app.put(
    "/admin/api/games/:gameId/economy",
    {
      schema: {
        params: GameParams,
        body: EconomyCatalogWriteBodySchema,
        response: { 200: EconomyResponseSchema },
      },
    },
    async (request: FastifyRequest) => {
      const runtime = requireRuntime(request);
      const catalog = request.body as EconomyCatalog;
      try {
        parseEconomyCatalog(catalog, `/games/${runtime.game.id}/economy`);
      } catch (error) {
        throw new BantamError(
          "invalid-economy",
          error instanceof Error ? error.message : "Invalid economy catalog",
          400,
        );
      }
      await updateManifestGame(runtime.game.id, (game) => ({ ...game, economy: catalog }));
      const updated = runtimes.get(runtime.game.id) ?? runtime;
      recordAudit(request, "economy.update", {
        gameId: runtime.game.id,
        target: runtime.game.id,
        details: {
          currencies: catalog.currencies.length,
          items: catalog.items.length,
          offers: catalog.offers.length,
          rewards: catalog.rewards?.length ?? 0,
          iapProducts: catalog.iapProducts?.length ?? 0,
        },
      });
      request.log.info(
        {
          admin: request.adminId,
          game: runtime.game.id,
          currencies: catalog.currencies.length,
          items: catalog.items.length,
          offers: catalog.offers.length,
        },
        "admin updated the economy catalog",
      );
      return economyResponse(updated, now());
    },
  );

  // ─── Audit ────────────────────────────────────────────────────────────────

  app.get(
    "/admin/api/audit",
    { schema: { querystring: AuditQuery, response: { 200: AuditResponseSchema } } },
    async (request: FastifyRequest) => {
      const query = request.query as { limit?: number; action?: string; gameId?: string };
      const filter: { action?: string; gameId?: string } = {};
      if (query.action) filter.action = query.action;
      if (query.gameId) filter.gameId = query.gameId;
      const rows = adminDb.listAudit(query.limit ?? 100, filter);
      return {
        entries: rows.map((row) => ({
          id: String(row.id),
          adminId: row.admin_id,
          adminUsername: row.admin_username,
          action: row.action,
          gameId: row.game_id,
          target: row.target,
          details: row.details,
          createdAt: new Date(row.created_at).toISOString(),
        })),
        total: adminDb.countAudit(filter),
      };
    },
  );

  // ─── Health ───────────────────────────────────────────────────────────────

  app.get("/admin/api/health", { schema: { response: { 200: HealthResponseSchema } } }, async () => {
    const games = [...runtimes.values()].map((runtime) => {
      const envKeys = requiredEnvKeys(runtime.game);
      const presence = envPresence(envKeys);
      return {
        id: runtime.game.id,
        displayName: runtime.game.displayName,
        declaredAdapters: runtime.game.adapters.length,
        loadedAdapters: runtime.adapters.size,
        dbReady: runtime.db.ready(),
        envComplete: envKeys.every((key) => presence[key] === true),
      };
    });
    const degraded = games.some(
      (game) => !game.dbReady || game.declaredAdapters !== game.loadedAdapters || !game.envComplete,
    );
    return {
      status: degraded ? "degraded" : "ok",
      environment: manifestEnvironment(manifestStore),
      allowedOrigins: options.allowedOrigins,
      games,
      uptimeSeconds: Math.floor(process.uptime()),
      version: options.version,
    };
  });

  // ─── Adapters ─────────────────────────────────────────────────────────────

  app.get("/admin/api/adapters", { schema: { response: { 200: AdaptersResponseSchema } } }, async () => {
    const loaded = listLoadedAdapters();
    const origins = listAdapterOrigins();
    const gamesByAdapter = listAdapterGames();
    return {
      adapters: loaded.map((adapter) => ({
        id: adapter.id,
        kind: origins.get(adapter.id)?.kind ?? "file",
        version: adapter.version,
        source: origins.get(adapter.id)?.source ?? null,
        boards: adapter.boards.map((board) => board.id),
        games: gamesByAdapter.get(adapter.id) ?? [],
      })),
    };
  });

  // The module behind a loaded adapter, as it is on disk right now. Adapters
  // are shipped by a sibling repository and imported by the runtime at boot,
  // so this is read-only by design: the console can show what is running, but
  // editing belongs in the repository that owns the file.
  app.get(
    "/admin/api/adapters/:adapterId/source",
    { schema: { params: AdapterParams, response: { 200: AdapterSourceSchema } } },
    async (request: FastifyRequest) => {
      const adapterId = (request.params as { adapterId: string }).adapterId;
      const file = listAdapterFiles().get(adapterId);
      if (!file) throw new BantamError("adapter-not-found", "Adapter not found", 404);
      let bytes: number;
      try {
        bytes = statSync(file).size;
      } catch (error) {
        throw new BantamError("adapter-unreadable", `Cannot stat ${file}: ${String(error)}`, 500);
      }
      if (bytes > ADAPTER_SOURCE_MAX_BYTES) {
        throw new BantamError(
          "adapter-source-too-large",
          `Adapter source is ${bytes} bytes; the limit is ${ADAPTER_SOURCE_MAX_BYTES}`,
          413,
        );
      }
      let content: string;
      try {
        content = readFileSync(file, "utf8");
      } catch (error) {
        throw new BantamError("adapter-unreadable", `Cannot read ${file}: ${String(error)}`, 500);
      }
      return {
        id: adapterId,
        file,
        language: "javascript",
        bytes,
        content,
        editable: false,
      };
    },
  );

  // ─── Manifest ─────────────────────────────────────────────────────────────

  app.get("/admin/api/manifest", { schema: { response: { 200: ManifestResponseSchema } } }, async () => {
    const loaded = manifestStore.load();
    if (!loaded.ok) throw new BantamError("manifest-unreadable", loaded.error, 500);
    return {
      manifest: loaded.manifest as unknown as Record<string, unknown>,
      environment: loaded.manifest.environment,
    };
  });

  app.put(
    "/admin/api/manifest",
    {
      schema: {
        body: ManifestWriteBodySchema,
        response: { 200: ManifestResponseSchema },
      },
    },
    async (request: FastifyRequest) => {
      const body = request.body as { manifest: Record<string, unknown> };
      if (!Value.Check(ManifestSchema, body.manifest)) {
        const details = [...Value.Errors(ManifestSchema, body.manifest)]
          .map((item) => `${item.path}: ${item.message}`)
          .join("; ");
        throw new BantamError("invalid-manifest", `Invalid manifest: ${details}`, 400);
      }
      const manifest = body.manifest as unknown as ManifestFile;
      const priorLoad = manifestStore.load();
      const priorManifest = priorLoad.ok
        ? (JSON.parse(JSON.stringify(priorLoad.manifest)) as ManifestFile)
        : undefined;
      const saveResult = manifestStore.save(JSON.stringify(manifest, null, 2));
      if (!saveResult.ok) {
        throw new BantamError("manifest-save-failed", saveResult.errors.join("; "), 400);
      }
      try {
        await reloadRuntimes(manifest);
      } catch (error) {
        if (priorManifest) {
          try {
            manifestStore.save(JSON.stringify(priorManifest, null, 2));
          } catch {
            // keep the original failure as the reported error
          }
        }
        throw new BantamError(
          "manifest-reload-failed",
          `Manifest rolled back: runtime reload failed (${String(error)})`,
          500,
        );
      }
      request.log.info({ admin: request.adminId }, "admin saved the manifest");
      recordAudit(request, "manifest.save", {
        target: null,
        details: { environment: manifest.environment, games: manifest.games.length },
      });
      return { manifest: manifest as unknown as Record<string, unknown>, environment: manifest.environment };
    },
  );
}
