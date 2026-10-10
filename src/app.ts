import { randomBytes } from "node:crypto";
import { join } from "node:path";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import formbody from "@fastify/formbody";
import { Type, type Static } from "@sinclair/typebox";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { Registry, collectDefaultMetrics, Counter, Histogram } from "prom-client";
import { loadAdaptersForGame, listLoadedAdapters } from "./adapters/registry.js";
import { ManifestStore } from "./admin/manifest-store.js";
import { AdminDatabase } from "./db/admin-database.js";
import { providerFor } from "./auth/provider.js";
import { issueSession, revokeSession, rotateSession, verifyAccess } from "./auth/sessions.js";
import type { LoadedConfig } from "./config.js";
import { GameDatabase } from "./db/game-database.js";
import { BantamError } from "./errors.js";
import { decodeCursor, encodeCursor } from "./services/cursor.js";
import type { BoardDefinition, GameAdapterV1, RuntimeGame } from "./types.js";
import { canonicalJson, derivePlayerId, hmac, sha256 } from "./util/crypto.js";
import { sanitizeDisplayName } from "./util/display-name.js";

const GameParams = Type.Object(
  { gameId: Type.String({ minLength: 2, maxLength: 48 }) },
  { additionalProperties: false },
);
const AdapterParams = Type.Object(
  {
    gameId: Type.String({ minLength: 2, maxLength: 48 }),
    adapterId: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { additionalProperties: false },
);
const BoardParams = Type.Object(
  {
    gameId: Type.String({ minLength: 2, maxLength: 48 }),
    boardId: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { additionalProperties: false },
);
const AuthBody = Type.Object(
  { authorizationCode: Type.String({ minLength: 1, maxLength: 2048 }) },
  { additionalProperties: false },
);
const TokenBody = Type.Object(
  { refreshToken: Type.String({ minLength: 16, maxLength: 256 }) },
  { additionalProperties: false },
);
const RunBody = Type.Object(
  {
    runId: Type.String({ pattern: "^[A-Za-z0-9._~-]{8,128}$" }),
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
const ListQuery = Type.Object(
  {
    period: Type.Optional(Type.String({ maxLength: 10 })),
    cursor: Type.Optional(Type.String({ maxLength: 512 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
const AroundQuery = Type.Object(
  {
    period: Type.Optional(Type.String({ maxLength: 10 })),
    radius: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  },
  { additionalProperties: false },
);

export type RuntimeT = { game: RuntimeGame; db: GameDatabase; adapters: ReadonlyMap<string, GameAdapterV1> };
export type Runtime = RuntimeT;

// Container for the per-game runtimes. Exposes the underlying Map directly
// so admin can iterate or mutate via the same surface; replaceAll is the only
// mutation path that diffs old vs new (and tears down DBs on remove).
class RuntimeRegistry {
  readonly map = new Map<string, Runtime>();
  get(id: string): Runtime | undefined {
    return this.map.get(id);
  }
  list(): Runtime[] {
    return [...this.map.values()];
  }
  entries(): IterableIterator<[string, Runtime]> {
    return this.map.entries();
  }
  size(): number {
    return this.map.size;
  }
  async replaceAll(
    newGames: RuntimeGame[],
    ctx: { dataDir: string; migrationsDirectory: string },
  ): Promise<{ added: string[]; removed: string[]; kept: string[] }> {
    const next = new Map<string, RuntimeGame>();
    for (const game of newGames) next.set(game.id, game);
    const removed: string[] = [];
    for (const [id, runtime] of this.map) {
      if (!next.has(id)) {
        runtime.db.close();
        this.map.delete(id);
        removed.push(id);
      }
    }
    const added: string[] = [];
    const kept: string[] = [];
    for (const [id, game] of next) {
      const existing = this.map.get(id);
      if (existing && existing.game === game) {
        kept.push(id);
        continue;
      }
      if (existing) {
        existing.db.close();
        this.map.delete(id);
      }
      const adapters = await loadAdaptersForGame(id, game.adapters);
      const runtime: Runtime = {
        game,
        db: new GameDatabase(join(ctx.dataDir, "games", id, "bantam.sqlite"), ctx.migrationsDirectory),
        adapters,
      };
      this.map.set(id, runtime);
      added.push(id);
    }
    return { added, removed, kept };
  }
  closeAll(): void {
    for (const runtime of this.map.values()) runtime.db.close();
    this.map.clear();
  }
}

export async function buildApp(
  config: LoadedConfig,
  options: { migrationsDirectory?: string; logger?: boolean } = {},
): Promise<FastifyInstance> {
  const logger =
    options.logger === false
      ? false
      : {
          level: process.env.BANTAM_LOG_LEVEL ?? "info",
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.headers['set-cookie']",
              "res.headers.set-cookie",
            ],
            censor: "[REDACTED]",
          },
        };
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 65_536,
    ajv: { customOptions: { allErrors: false, removeAdditional: false } },
    requestIdHeader: false,
    routerOptions: { ignoreTrailingSlash: true },
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.allowedOrigins.length ? config.allowedOrigins : false,
    credentials: false,
  });
  await app.register(formbody);
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Bantam Game Services",
        description: "Small footprint. Authoritative results.",
        version: "0.1.0",
      },
      tags: [{ name: "system" }, { name: "auth" }, { name: "leaderboards" }, { name: "players" }],
    },
  });

  const migrationsDirectory = options.migrationsDirectory ?? join(process.cwd(), "migrations");
  const registry = new RuntimeRegistry();
  await registry.replaceAll([...config.games.values()], {
    dataDir: config.dataDir,
    migrationsDirectory,
  });
  app.addHook("onClose", async () => {
    registry.closeAll();
  });

  const metrics = new Registry();
  collectDefaultMetrics({ register: metrics, prefix: "bantam_" });
  const requests = new Counter({
    name: "bantam_http_requests_total",
    help: "HTTP requests",
    labelNames: ["route", "status"],
    registers: [metrics],
  });
  const duration = new Histogram({
    name: "bantam_http_request_duration_seconds",
    help: "HTTP request duration",
    labelNames: ["route"],
    registers: [metrics],
  });
  const startTimes = new WeakMap<object, bigint>();
  app.addHook("onRequest", async (request) => {
    startTimes.set(request, process.hrtime.bigint());
  });
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    requests.inc({ route, status: String(reply.statusCode) });
    const start = startTimes.get(request);
    if (start) duration.observe({ route }, Number(process.hrtime.bigint() - start) / 1e9);
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        path: request.url.split("?")[0],
        statusCode: reply.statusCode,
      },
      "request completed",
    );
  });

  const authBuckets = new Map<string, { bucket: number; count: number }>();
  const anonymousReadBuckets = new Map<string, { bucket: number; count: number }>();
  const authFingerprintSecret = randomBytes(32).toString("hex");
  function runtime(gameId: string): Runtime {
    const value = registry.get(gameId);
    if (!value) throw new BantamError("game-not-found", "Game not found", 404);
    return value;
  }
  function takeAnonymousRead(ip: string): void {
    const bucket = Math.floor(Date.now() / 60_000);
    const key = hmac(ip, authFingerprintSecret);
    const state = anonymousReadBuckets.get(key);
    const count = state?.bucket === bucket ? state.count + 1 : 1;
    anonymousReadBuckets.set(key, { bucket, count });
    if (count > 120) throw new BantamError("rate-limited", "Rate limit exceeded", 429);
  }
  async function playerId(header: string | undefined, game: RuntimeGame): Promise<string> {
    if (!header?.startsWith("Bearer "))
      throw new BantamError("invalid-session", "Session is missing or expired", 401);
    return verifyAccess(game, header.slice(7));
  }
  async function optionalPlayerId(header: string | undefined, game: RuntimeGame): Promise<string | null> {
    if (!header) return null;
    return playerId(header, game);
  }
  function boardFor(run: Runtime, boardId: string): BoardDefinition {
    for (const adapter of run.adapters.values()) {
      const board = adapter.boards.find((item) => item.id === boardId);
      if (board) return board;
    }
    throw new BantamError("board-not-found", "Leaderboard not found", 404);
  }
  function periodFor(board: BoardDefinition, period?: string): string {
    if (board.period === "all_time") {
      if (period && period !== "all_time") throw new BantamError("invalid-period", "This board is all-time");
      return "all_time";
    }
    if (
      !period ||
      !/^\d{4}-\d{2}-\d{2}$/.test(period) ||
      new Date(`${period}T00:00:00.000Z`).toISOString().slice(0, 10) !== period
    )
      throw new BantamError("invalid-period", "A valid UTC date is required");
    return period;
  }

  app.get("/healthz", { schema: { tags: ["system"] } }, async () => ({ status: "ok" }));
  app.get("/readyz", { schema: { tags: ["system"] } }, async () => {
    const games = [...registry.entries()].map(([id, value]) => ({ id, ready: value.db.ready() }));
    if (games.some((game) => !game.ready))
      throw new BantamError("not-ready", "One or more game databases are not ready", 503);
    return { status: "ready", games };
  });
  app.get("/version", { schema: { tags: ["system"] } }, async () => ({
    name: "Bantam Game Services",
    version: "0.1.0",
    commit: process.env.BANTAM_GIT_SHA ?? "local",
    builtAt: process.env.BANTAM_BUILT_AT ?? "unknown",
    adapters: listLoadedAdapters().map(({ id, version }) => ({ id, version })),
  }));
  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  app.get("/metrics", { schema: { hide: true } }, async (request, reply) => {
    if (!config.metricsToken) return reply.code(404).send();
    const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (sha256(token) !== sha256(config.metricsToken))
      throw new BantamError("invalid-monitor-token", "Not authorized", 401);
    return reply.header("content-type", metrics.contentType).send(await metrics.metrics());
  });

  app.post<{ Params: Static<typeof GameParams>; Body: Static<typeof AuthBody> }>(
    "/v1/games/:gameId/auth/exchange",
    { schema: { tags: ["auth"], params: GameParams, body: AuthBody } },
    async (request) => {
      const run = runtime(request.params.gameId);
      const bucket = Math.floor(Date.now() / 60_000);
      const key = hmac(request.ip, authFingerprintSecret);
      const state = authBuckets.get(key);
      const count = state?.bucket === bucket ? state.count + 1 : 1;
      authBuckets.set(key, { bucket, count });
      if (count > 10) throw new BantamError("rate-limited", "Rate limit exceeded", 429);
      const identity = await providerFor(run.game).exchange(
        request.body.authorizationCode,
        run.game,
        AbortSignal.timeout(10_000),
      );
      const id = derivePlayerId(run.game.authProvider, identity.rawId, run.game.identitySalt);
      const player = run.db.upsertPlayer(
        id,
        run.game.authProvider,
        sanitizeDisplayName(identity.displayName),
        Date.now(),
      );
      return {
        ...(await issueSession(run.db, run.game, player.id)),
        player: { displayName: player.displayName },
      };
    },
  );
  app.post<{ Params: Static<typeof GameParams>; Body: Static<typeof TokenBody> }>(
    "/v1/games/:gameId/auth/refresh",
    { schema: { tags: ["auth"], params: GameParams, body: TokenBody } },
    async (request) => {
      const run = runtime(request.params.gameId);
      return rotateSession(run.db, run.game, request.body.refreshToken);
    },
  );
  app.post<{ Params: Static<typeof GameParams>; Body: Static<typeof TokenBody> }>(
    "/v1/games/:gameId/auth/logout",
    { schema: { tags: ["auth"], params: GameParams, body: TokenBody } },
    async (request, reply) => {
      const run = runtime(request.params.gameId);
      revokeSession(run.db, request.body.refreshToken);
      return reply.code(204).send();
    },
  );
  app.post<{ Params: Static<typeof AdapterParams>; Body: Static<typeof RunBody> }>(
    "/v1/games/:gameId/runs/:adapterId",
    { schema: { tags: ["leaderboards"], params: AdapterParams, body: RunBody } },
    async (request) => {
      const run = runtime(request.params.gameId);
      const player = await playerId(request.headers.authorization, run.game);
      run.db.takeRate(player, "submission", 20, Date.now());
      const adapter = run.adapters.get(request.params.adapterId);
      if (!adapter) throw new BantamError("adapter-not-found", "Adapter not found", 404);
      if (typeof request.body.payload.runId === "string" && request.body.payload.runId !== request.body.runId)
        throw new BantamError("run-id-mismatch", "Run id mismatch");
      const derived = adapter.validateAndDerive(request.body.payload, {
        nowMs: Date.now(),
        gracePeriodHours: run.game.gracePeriodHours,
      });
      const payloadHash = sha256(canonicalJson(request.body.payload));
      const stored = run.db.submitRun({
        adapterId: adapter.id,
        playerId: player,
        runId: request.body.runId,
        payloadHash,
        values: derived.values,
        boards: adapter.boards,
        response: { accepted: true, result: derived.normalized },
        now: Date.now(),
      });
      return { ...stored.response, replayed: stored.replayed };
    },
  );
  app.get<{ Params: Static<typeof BoardParams>; Querystring: Static<typeof ListQuery> }>(
    "/v1/games/:gameId/leaderboards/:boardId",
    { schema: { tags: ["leaderboards"], params: BoardParams, querystring: ListQuery } },
    async (request) => {
      const run = runtime(request.params.gameId);
      const player = await optionalPlayerId(request.headers.authorization, run.game);
      if (player) run.db.takeRate(player, "read", 120, Date.now());
      else takeAnonymousRead(request.ip);
      const board = boardFor(run, request.params.boardId);
      const period = periodFor(board, request.query.period);
      const limit = request.query.limit ?? 25;
      const after = decodeCursor(request.query.cursor, run.game.cursorSecret);
      const rows = run.db.list(board, period, after, limit + 1);
      const more = rows.length > limit;
      const entries = rows.slice(0, limit);
      return {
        entries: entries.map(({ ordinal: _ordinal, ...entry }) => entry),
        nextCursor: more ? encodeCursor(entries.at(-1)!.ordinal, run.game.cursorSecret) : null,
      };
    },
  );
  app.get<{ Params: Static<typeof BoardParams>; Querystring: Static<typeof AroundQuery> }>(
    "/v1/games/:gameId/leaderboards/:boardId/me",
    { schema: { tags: ["leaderboards"], params: BoardParams, querystring: AroundQuery } },
    async (request) => {
      const run = runtime(request.params.gameId);
      const player = await playerId(request.headers.authorization, run.game);
      run.db.takeRate(player, "read", 120, Date.now());
      const board = boardFor(run, request.params.boardId);
      const period = periodFor(board, request.query.period);
      const entry = run.db.playerEntry(board, period, player);
      return {
        entry: entry ? { displayName: entry.displayName, value: entry.value, rank: entry.rank } : null,
      };
    },
  );
  app.get<{ Params: Static<typeof BoardParams>; Querystring: Static<typeof AroundQuery> }>(
    "/v1/games/:gameId/leaderboards/:boardId/around-me",
    { schema: { tags: ["leaderboards"], params: BoardParams, querystring: AroundQuery } },
    async (request) => {
      const run = runtime(request.params.gameId);
      const player = await playerId(request.headers.authorization, run.game);
      run.db.takeRate(player, "read", 120, Date.now());
      const board = boardFor(run, request.params.boardId);
      const period = periodFor(board, request.query.period);
      return {
        entries: run.db
          .around(board, period, player, request.query.radius ?? 3)
          .map(({ ordinal: _ordinal, ...entry }) => entry),
      };
    },
  );
  app.delete<{ Params: Static<typeof GameParams> }>(
    "/v1/games/:gameId/player",
    { schema: { tags: ["players"], params: GameParams } },
    async (request, reply) => {
      const run = runtime(request.params.gameId);
      const player = await playerId(request.headers.authorization, run.game);
      run.db.deletePlayer(player);
      return reply.code(204).send();
    },
  );

  // ─── Admin UI: session-cookie-gated. DB-backed. Always on (no env-var gate). ───────
  const adminDb = new AdminDatabase(join(config.dataDir, "admin.sqlite"), migrationsDirectory);
  const manifestStore = new ManifestStore(process.env.BANTAM_CONFIG_FILE, config.dataDir);
  const { registerAdmin } = await import("./admin/routes.js");
  await registerAdmin(
    app,
    adminDb,
    registry.map,
    async (games) => {
      const result = await registry.replaceAll(games, {
        dataDir: config.dataDir,
        migrationsDirectory,
      });
      app.log.info(
        { added: result.added, removed: result.removed, kept: result.kept.length },
        "runtime reloaded after manifest edit",
      );
      return result;
    },
    manifestStore,
  );
  app.addHook("onClose", async () => {
    adminDb.close();
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const known = error instanceof BantamError;
    const status = known
      ? error.statusCode
      : "statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500
        ? error.statusCode
        : 500;
    if (status >= 500)
      request.log.error(
        { err: { name: error.name, message: error.message, stack: error.stack } },
        "request failed",
      );
    const code = known ? error.code : status === 400 ? "invalid-request" : "internal-error";
    return reply.code(status).send({
      error: {
        code,
        message: known
          ? error.message
          : status === 400
            ? "Request validation failed"
            : "Internal server error",
        requestId: request.id,
      },
    });
  });
  return app;
}

// The admin routes module expects a `Map<string, Runtime>`; the registry's
// public `map` field exposes the underlying Map directly. We pass it as the
// readonly source-of-truth — admin reads, registry mutates.
