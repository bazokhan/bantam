// Tests for the admin console's JSON API (`/admin/api/*`).
//
// The console is a React SPA, so the JSON API is now the primary admin
// surface. These cover the three lanes the repo's rules require for new admin
// routes: happy path, missing session, and schema rejection.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { LoadedConfig } from "../src/config.js";
import type { RuntimeGame } from "../src/types.js";

const secret = "test-secret-that-is-long-enough-000001";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "bantam-admin-api-"));
}

function gameWithEconomy(id = "demo"): RuntimeGame {
  return {
    id,
    displayName: id,
    adapters: [
      {
        kind: "generic",
        boards: [
          { id: "high_score", direction: "higher", period: "all_time" },
          { id: "daily_runs", direction: "higher", period: "daily" },
        ],
      },
    ],
    secretPrefix: "TEST",
    gracePeriodHours: 24,
    authProvider: "development",
    identitySalt: secret + id,
    sessionSecret: secret + id,
    cursorSecret: secret + id,
    economy: {
      currencies: [{ id: "gold" }],
      items: [{ id: "potion", type: "consumable", stackable: true, usable: true }],
      offers: [{ id: "starter", itemId: "potion", quantity: 1, priceCurrencyId: "gold", priceAmount: 10 }],
    },
  };
}

function config(dataDir = temp(), games = [gameWithEconomy()]): LoadedConfig {
  return {
    environment: "test",
    dataDir,
    allowedOrigins: ["https://example.com"],
    manifestPath: undefined,
    manifestWritable: true,
    games: new Map(games.map((value) => [value.id, value])),
  } as LoadedConfig;
}

function setDemoEnv(): void {
  process.env.TEST_IDENTITY_SALT = "test-identity-salt-32-chars-long";
  process.env.TEST_SESSION_SECRET = "test-session-secret-32-chars-long";
  process.env.TEST_CURSOR_SECRET = "test-cursor-secret-32-chars-long";
}

function clearDemoEnv(): void {
  delete process.env.TEST_IDENTITY_SALT;
  delete process.env.TEST_SESSION_SECRET;
  delete process.env.TEST_CURSOR_SECRET;
}

async function adminCookie(app: import("fastify").FastifyInstance): Promise<string> {
  const reg = await app.inject({
    method: "POST",
    url: "/admin/register",
    payload: "username=alice&password=hunter2hunter2&confirm=hunter2hunter2",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  return reg.headers["set-cookie"]!.toString().split(";")[0]!;
}

/** Sign in as a player and submit one scored run so boards are not empty. */
async function seedRun(
  app: import("fastify").FastifyInstance,
  cookie: string,
  gameId = "demo",
  score = 7,
): Promise<{ token: string; playerId: string }> {
  const login = await app.inject({
    method: "POST",
    url: `/v1/games/${gameId}/auth/exchange`,
    payload: { authorizationCode: `p-${gameId}-${score}` },
  });
  const token = login.json<{ accessToken: string }>().accessToken;
  await app.inject({
    method: "POST",
    url: `/v1/games/${gameId}/runs/generic:daily_runs,high_score`,
    headers: { authorization: `Bearer ${token}` },
    payload: { runId: `run-${gameId}-${score}`, payload: { high_score: score, daily_runs: score } },
  });
  const players = await app.inject({
    method: "GET",
    url: `/admin/api/games/${gameId}/players`,
    headers: { cookie },
  });
  const first = players.json<{ players: { id: string }[] }>().players[0];
  return { token, playerId: first?.id ?? "" };
}

describe("admin console API — session gate", () => {
  it("answers 401 JSON on every unauthenticated API route", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      for (const url of [
        "/admin/api/session",
        "/admin/api/overview",
        "/admin/api/games",
        "/admin/api/games/demo",
        "/admin/api/games/demo/players",
        "/admin/api/games/demo/flags",
        "/admin/api/health",
        "/admin/api/adapters",
        "/admin/api/manifest",
      ]) {
        const res = await app.inject({ method: "GET", url });
        expect(res.statusCode, url).toBe(401);
        expect(res.headers["content-type"], url).toContain("application/json");
        expect(res.json<{ error: { code: string } }>().error.code).toBe("unauthorized");
      }
    } finally {
      await app.close();
    }
  }, 30_000);

  it("rejects an unauthenticated write", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/games/demo/flags/new_flag/toggle",
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("reports the signed-in admin and whether registration is still open", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const before = await app.inject({ method: "GET", url: "/admin/api/session" });
      // Unauthenticated session calls answer 401 like every other API route.
      expect(before.statusCode).toBe(401);

      const cookie = await adminCookie(app);
      const after = await app.inject({ method: "GET", url: "/admin/api/session", headers: { cookie } });
      expect(after.statusCode).toBe(200);
      const body = after.json<{ admin: { username: string } | null; firstRun: boolean }>();
      expect(body.admin?.username).toBe("alice");
      expect(body.firstRun).toBe(false);
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe("admin console API — read models", () => {
  it("returns games, overview, boards, players, runs, flags, economy, health and adapters", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const { playerId } = await seedRun(app, cookie);

      const games = await app.inject({ method: "GET", url: "/admin/api/games", headers: { cookie } });
      expect(games.statusCode).toBe(200);
      const gameList = games.json<{ id: string; players: number; boards: unknown[] }[]>();
      expect(gameList).toHaveLength(1);
      expect(gameList[0]!.id).toBe("demo");
      expect(gameList[0]!.players).toBe(1);
      // Env keys are reported as names + presence only, never values.
      expect(JSON.stringify(gameList[0])).not.toContain("test-identity-salt");

      const overview = await app.inject({ method: "GET", url: "/admin/api/overview", headers: { cookie } });
      expect(overview.statusCode).toBe(200);
      const ov = overview.json<{
        totals: { games: number; players: number; runsToday: number };
        activity: { date: string; runs: number }[];
        recentRuns: { boardId: string; value: number }[];
      }>();
      expect(ov.totals.games).toBe(1);
      expect(ov.totals.players).toBe(1);
      expect(ov.totals.runsToday).toBe(1);
      // Seven days, oldest first, so the chart axis is continuous.
      expect(ov.activity).toHaveLength(7);
      expect(ov.activity[6]!.runs).toBe(1);
      // One run produced an entry on every board the adapter declares.
      expect(ov.recentRuns.map((run) => run.boardId).sort()).toEqual(["daily_runs", "high_score"]);
      expect(ov.recentRuns[0]!.value).toBe(7);

      const boards = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/boards/high_score",
        headers: { cookie },
      });
      expect(boards.statusCode).toBe(200);
      const board = boards.json<{
        boardId: string;
        period: string;
        periods: string[];
        entries: { rank: number; playerId: string; value: number }[];
      }>();
      expect(board.boardId).toBe("high_score");
      expect(board.period).toBe("all_time");
      expect(board.entries).toHaveLength(1);
      expect(board.entries[0]!.value).toBe(7);
      expect(board.entries[0]!.playerId).toBe(playerId);

      // A daily board offers recent date keys, today first.
      const daily = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/boards/daily_runs",
        headers: { cookie },
      });
      const dailyBody = daily.json<{ periods: string[]; period: string }>();
      expect(dailyBody.periods).toHaveLength(7);
      expect(dailyBody.period).toBe(dailyBody.periods[0]);

      const players = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/players",
        headers: { cookie },
      });
      expect(players.json<{ total: number }>().total).toBe(1);

      const player = await app.inject({
        method: "GET",
        url: `/admin/api/games/demo/players/${playerId}`,
        headers: { cookie },
      });
      expect(player.statusCode).toBe(200);
      const detail = player.json<{ id: string; runs: number; wallet: unknown[] }>();
      expect(detail.id).toBe(playerId);
      expect(detail.runs).toBe(1);

      const runs = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/runs",
        headers: { cookie },
      });
      expect(runs.json<{ runs: unknown[]; total: number }>().total).toBe(2);

      const flags = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/flags",
        headers: { cookie },
      });
      expect(flags.statusCode).toBe(200);
      expect(flags.json<{ flags: unknown[] }>().flags).toEqual([]);

      const economy = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/economy",
        headers: { cookie },
      });
      expect(economy.statusCode).toBe(200);
      const catalog = economy.json<{ currencies: unknown[]; items: unknown[]; offers: unknown[] }>();
      expect(catalog.currencies).toHaveLength(1);
      expect(catalog.items).toHaveLength(1);
      expect(catalog.offers).toHaveLength(1);

      const health = await app.inject({ method: "GET", url: "/admin/api/health", headers: { cookie } });
      expect(health.statusCode).toBe(200);
      const healthBody = health.json<{ status: string; allowedOrigins: string[]; games: unknown[] }>();
      expect(healthBody.status).toBe("ok");
      expect(healthBody.allowedOrigins).toEqual(["https://example.com"]);
      expect(healthBody.games).toHaveLength(1);

      const adapters = await app.inject({ method: "GET", url: "/admin/api/adapters", headers: { cookie } });
      expect(adapters.statusCode).toBe(200);
      expect(adapters.json<{ adapters: unknown[] }>().adapters.length).toBeGreaterThan(0);

      const manifest = await app.inject({ method: "GET", url: "/admin/api/manifest", headers: { cookie } });
      expect(manifest.statusCode).toBe(200);
      expect(manifest.json<{ environment: string }>().environment).toBe("development");
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("revokes the session and clears the cookie on the admin's own path", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/logout",
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      expect(res.statusCode).toBe(204);
      // The session cookie is scoped to /admin/. A deletion on a different
      // Path leaves the browser holding a cookie that no longer resolves.
      const setCookie = res.headers["set-cookie"]!.toString();
      expect(setCookie).toContain("Path=/admin/");
      expect(setCookie).toContain("Max-Age=0");

      // The revoked session no longer opens the API.
      const after = await app.inject({ method: "GET", url: "/admin/api/session", headers: { cookie } });
      expect(after.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("404s for an unknown game or board", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const game = await app.inject({ method: "GET", url: "/admin/api/games/nope", headers: { cookie } });
      expect(game.statusCode).toBe(404);
      const board = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/boards/nope",
        headers: { cookie },
      });
      expect(board.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe("admin console API — writes", () => {
  it("writes, toggles and deletes a feature flag", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const write = await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/flags/daily_challenge",
        headers: { cookie, "content-type": "application/json" },
        payload: { enabled: true, description: "Daily run", targeting: { rolloutPercent: 50 } },
      });
      expect(write.statusCode).toBe(200);
      const written = write.json<{ key: string; enabled: boolean; targeting: string }>();
      expect(written.key).toBe("daily_challenge");
      expect(written.enabled).toBe(true);
      expect(written.targeting).toContain("50%");

      const toggle = await app.inject({
        method: "POST",
        url: "/admin/api/games/demo/flags/daily_challenge/toggle",
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      expect(toggle.statusCode).toBe(200);
      expect(toggle.json<{ enabled: boolean }>().enabled).toBe(false);

      const list = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/flags",
        headers: { cookie },
      });
      expect(list.json<{ flags: { key: string }[] }>().flags[0]!.key).toBe("daily_challenge");

      const del = await app.inject({
        method: "DELETE",
        url: "/admin/api/games/demo/flags/daily_challenge",
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      expect(del.statusCode).toBe(204);
      const after = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/flags",
        headers: { cookie },
      });
      expect(after.json<{ flags: unknown[] }>().flags).toEqual([]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("rejects an unknown field in a flag write and an invalid flag key", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const unknown = await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/flags/ok_flag",
        headers: { cookie, "content-type": "application/json" },
        payload: { enabled: true, sneaky: "value" },
      });
      expect(unknown.statusCode).toBe(400);

      const badKey = await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/flags/NOT%20A%20KEY",
        headers: { cookie, "content-type": "application/json" },
        payload: { enabled: true },
      });
      expect(badKey.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("credits and debits a catalog currency with a reason", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const { playerId } = await seedRun(app, cookie);

      const credit = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/currency`,
        headers: { cookie, "content-type": "application/json" },
        payload: { currencyId: "gold", amount: 25, direction: "credit", reason: "support_fix" },
      });
      expect(credit.statusCode, credit.body).toBe(200);
      const wallet = credit.json<{ currency: string; amount: number }[]>();
      expect(wallet.find((row) => row.currency === "gold")?.amount).toBe(25);

      const debit = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/currency`,
        headers: { cookie, "content-type": "application/json" },
        payload: { currencyId: "gold", amount: 5, direction: "debit", reason: "support_fix" },
      });
      expect(
        debit.json<{ currency: string; amount: number }[]>().find((row) => row.currency === "gold")?.amount,
      ).toBe(20);

      // A currency that is not in the catalogue is refused.
      const unknown = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/currency`,
        headers: { cookie, "content-type": "application/json" },
        payload: { currencyId: "gems", amount: 1, direction: "credit" },
      });
      expect(unknown.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("grants and removes a catalog item", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const { playerId } = await seedRun(app, cookie);

      const grant = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/item`,
        headers: { cookie, "content-type": "application/json" },
        payload: { itemId: "potion", quantity: 3, direction: "grant", reason: "support_fix" },
      });
      expect(grant.statusCode).toBe(200);
      expect(
        grant.json<{ item: string; quantity: number }[]>().find((row) => row.item === "potion")?.quantity,
      ).toBe(3);

      const remove = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/item`,
        headers: { cookie, "content-type": "application/json" },
        payload: { itemId: "potion", quantity: 1, direction: "remove", reason: "support_fix" },
      });
      expect(
        remove.json<{ item: string; quantity: number }[]>().find((row) => row.item === "potion")?.quantity,
      ).toBe(2);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("deletes a player", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const { playerId } = await seedRun(app, cookie);

      const del = await app.inject({
        method: "DELETE",
        url: `/admin/api/games/demo/players/${playerId}`,
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      expect(del.statusCode).toBe(204);

      const after = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/players",
        headers: { cookie },
      });
      expect(after.json<{ total: number }>().total).toBe(0);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("rejects an invalid manifest and accepts a valid one", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const invalid = await app.inject({
        method: "PUT",
        url: "/admin/api/manifest",
        headers: { cookie, "content-type": "application/json" },
        payload: { manifest: { environment: "nope", games: [] } },
      });
      expect(invalid.statusCode).toBe(400);

      const valid = await app.inject({
        method: "PUT",
        url: "/admin/api/manifest",
        headers: { cookie, "content-type": "application/json" },
        payload: {
          manifest: {
            environment: "development",
            games: [
              {
                id: "demo",
                displayName: "Demo",
                adapters: [
                  {
                    kind: "generic",
                    boards: [{ id: "high_score", direction: "higher", period: "all_time" }],
                  },
                ],
                secretPrefix: "TEST",
                gracePeriodHours: 24,
                authProvider: "development",
              },
            ],
          },
        },
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.json<{ environment: string }>().environment).toBe("development");
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe("admin console API — console shell", () => {
  it("redirects /admin/ to the console and keeps the legacy page reachable", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const redirect = await app.inject({ method: "GET", url: "/admin/", headers: { cookie } });
      expect(redirect.statusCode).toBe(302);
      expect(redirect.headers.location).toBe("/admin/console/");

      const legacy = await app.inject({ method: "GET", url: "/admin/legacy", headers: { cookie } });
      expect(legacy.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe("admin console API — per-player leaderboard", () => {
  it("lists the boards a player is ranked on", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const { playerId } = await seedRun(app, cookie);

      const res = await app.inject({
        method: "GET",
        url: `/admin/api/games/demo/players/${playerId}/entries`,
        headers: { cookie },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        playerId: string;
        total: number;
        entries: { boardId: string; period: string; rank: number; value: number; runId: string }[];
      }>();
      expect(body.playerId).toBe(playerId);
      expect(body.total).toBe(body.entries.length);
      expect(body.entries.length).toBeGreaterThan(0);
      for (const entry of body.entries) {
        expect(entry.rank).toBe(1);
        expect(entry.value).toBe(7);
        expect(entry.runId).toBe("run-demo-7");
      }
      expect(body.entries.map((entry) => entry.boardId).sort()).toEqual(["daily_runs", "high_score"]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("ranks a second player below the first on the same board", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const first = await seedRun(app, cookie, "demo", 7);
      const second = await seedRun(app, cookie, "demo", 3);

      const res = await app.inject({
        method: "GET",
        url: `/admin/api/games/demo/players/${second.playerId}/entries`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ entries: { boardId: string; rank: number; value: number }[] }>();
      const high = body.entries.find((entry) => entry.boardId === "high_score");
      expect(high?.value).toBe(3);
      expect(high?.rank).toBe(2);
      expect(first.playerId).not.toBe(second.playerId);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("refuses the player entries route without a session and for an unknown player", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const unauth = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/players/whoever/entries",
      });
      expect(unauth.statusCode).toBe(401);

      const cookie = await adminCookie(app);
      const missing = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/players/does-not-exist/entries",
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe("admin console API — economy summary and inventory ledger", () => {
  it("summarises the currency and item supply of the game", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const { playerId } = await seedRun(app, cookie);

      await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/currency`,
        headers: { cookie, "content-type": "application/json" },
        payload: { currencyId: "gold", amount: 25, direction: "credit", reason: "support_fix" },
      });
      await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/item`,
        headers: { cookie, "content-type": "application/json" },
        payload: { itemId: "potion", quantity: 3, direction: "grant", reason: "support_fix" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/admin/api/games/demo/economy",
        headers: { cookie },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        summary: {
          currencies: { id: string; amount: number; holders: number }[];
          items: { id: string; quantity: number; holders: number }[];
          walletTransactions: { today: number; total: number };
          inventoryTransactions: { today: number; total: number };
          playersWithBalance: number;
        };
      }>();
      expect(body.summary.currencies).toEqual([{ id: "gold", amount: 25, holders: 1 }]);
      expect(body.summary.items).toEqual([{ id: "potion", quantity: 3, holders: 1 }]);
      expect(body.summary.walletTransactions.total).toBe(1);
      expect(body.summary.walletTransactions.today).toBe(1);
      expect(body.summary.inventoryTransactions.total).toBe(1);
      expect(body.summary.playersWithBalance).toBe(1);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("returns the inventory ledger of one player", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const { playerId } = await seedRun(app, cookie);

      await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/item`,
        headers: { cookie, "content-type": "application/json" },
        payload: { itemId: "potion", quantity: 3, direction: "grant", reason: "support_fix" },
      });
      await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/item`,
        headers: { cookie, "content-type": "application/json" },
        payload: { itemId: "potion", quantity: 1, direction: "remove", reason: "support_fix" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/admin/api/games/demo/players/${playerId}`,
        headers: { cookie },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        inventory: { item: string; quantity: number }[];
        inventoryLedger: { id: string; item: string; amount: number; balance: number; reason: string }[];
      }>();
      expect(body.inventory).toEqual([{ item: "potion", quantity: 2 }]);
      expect(body.inventoryLedger.length).toBe(2);
      expect(body.inventoryLedger[0]?.amount).toBe(-1);
      expect(body.inventoryLedger[0]?.balance).toBe(2);
      expect(body.inventoryLedger[1]?.amount).toBe(3);
      expect(body.inventoryLedger[1]?.balance).toBe(3);
      expect(body.inventoryLedger[0]?.reason).toBe("support_fix");
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe("admin console API — audit trail", () => {
  it("records every operator action with the admin, game, target and details", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const { playerId } = await seedRun(app, cookie);

      await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/flags/daily_challenge",
        headers: { cookie, "content-type": "application/json" },
        payload: { enabled: true, description: "Daily run" },
      });
      await app.inject({
        method: "POST",
        url: "/admin/api/games/demo/flags/daily_challenge/toggle",
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/currency`,
        headers: { cookie, "content-type": "application/json" },
        payload: { currencyId: "gold", amount: 25, direction: "credit", reason: "support_fix" },
      });
      await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/item`,
        headers: { cookie, "content-type": "application/json" },
        payload: { itemId: "potion", quantity: 3, direction: "grant", reason: "support_fix" },
      });
      await app.inject({
        method: "DELETE",
        url: "/admin/api/games/demo/flags/daily_challenge",
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      await app.inject({
        method: "DELETE",
        url: `/admin/api/games/demo/players/${playerId}`,
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });

      const res = await app.inject({ method: "GET", url: "/admin/api/audit", headers: { cookie } });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        total: number;
        entries: {
          id: string;
          adminUsername: string;
          action: string;
          gameId: string | null;
          target: string | null;
          details: string;
          createdAt: string;
        }[];
      }>();
      expect(body.total).toBe(6);
      const actions = body.entries.map((entry) => entry.action);
      expect(actions).toEqual([
        "player.delete",
        "flag.delete",
        "item.grant",
        "currency.credit",
        "flag.toggle",
        "flag.write",
      ]);
      for (const entry of body.entries) {
        expect(entry.adminUsername).toBe("alice");
        expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
      expect(body.entries[0]?.target).toBe(playerId);
      expect(body.entries[0]?.gameId).toBe("demo");
      const credit = body.entries.find((entry) => entry.action === "currency.credit");
      expect(JSON.parse(credit?.details ?? "{}")).toEqual({
        currencyId: "gold",
        amount: 25,
        reason: "support_fix",
      });
      const write = body.entries.find((entry) => entry.action === "flag.write");
      expect(write?.target).toBe("daily_challenge");
    } finally {
      await app.close();
    }
  }, 30_000);

  it("filters the audit trail by action and by game", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/flags/one",
        headers: { cookie, "content-type": "application/json" },
        payload: { enabled: true },
      });
      await app.inject({
        method: "DELETE",
        url: "/admin/api/games/demo/flags/one",
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });

      const byAction = await app.inject({
        method: "GET",
        url: "/admin/api/audit?action=flag.delete",
        headers: { cookie },
      });
      expect(byAction.statusCode).toBe(200);
      const actionBody = byAction.json<{ total: number; entries: { action: string }[] }>();
      expect(actionBody.total).toBe(1);
      expect(actionBody.entries[0]?.action).toBe("flag.delete");

      const byGame = await app.inject({
        method: "GET",
        url: "/admin/api/audit?gameId=demo",
        headers: { cookie },
      });
      expect(byGame.json<{ total: number }>().total).toBe(2);

      const other = await app.inject({
        method: "GET",
        url: "/admin/api/audit?gameId=not-a-game",
        headers: { cookie },
      });
      expect(other.json<{ total: number }>().total).toBe(0);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("gates the audit route and rejects an unknown query field", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const unauth = await app.inject({ method: "GET", url: "/admin/api/audit" });
      expect(unauth.statusCode).toBe(401);
      expect(unauth.headers["content-type"]).toContain("application/json");

      const cookie = await adminCookie(app);
      const unknown = await app.inject({
        method: "GET",
        url: "/admin/api/audit?sneaky=1",
        headers: { cookie },
      });
      expect(unknown.statusCode).toBe(400);

      const badLimit = await app.inject({
        method: "GET",
        url: "/admin/api/audit?limit=99999",
        headers: { cookie },
      });
      expect(badLimit.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  }, 30_000);
});
