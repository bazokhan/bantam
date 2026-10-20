// Tests for the admin console's typed editing surface: the operator reward
// claim, the typed economy catalog write, the typed per-game settings write
// and the read-only adapter source viewer.
//
// Every route here writes through the manifest, so these tests run against a
// real manifest file on disk and assert what actually landed in it — not just
// what the response claimed.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { preloadAdapterDirectory } from "../src/adapters/registry.js";
import { buildApp } from "../src/app.js";
import type { LoadedConfig } from "../src/config.js";
import type { EconomyCatalog } from "../src/services/economy.js";
import type { RuntimeGame } from "../src/types.js";

const secret = "test-secret-that-is-long-enough-000001";
const here = dirname(fileURLToPath(import.meta.url));
const adaptersDir = join(here, "fixtures", "adapters");

function temp(): string {
  return mkdtempSync(join(tmpdir(), "bantam-admin-edit-"));
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
  delete process.env.BANTAM_CONFIG_FILE;
}

const economy: EconomyCatalog = {
  currencies: [{ id: "gold" }],
  items: [{ id: "potion", type: "consumable", stackable: true, usable: true }],
  offers: [{ id: "starter", itemId: "potion", quantity: 1, priceCurrencyId: "gold", priceAmount: 10 }],
  rewards: [{ id: "welcome", grants: [{ kind: "currency", currencyId: "gold", amount: 100 }], maxClaims: 1 }],
};

function demoGame(id = "demo"): RuntimeGame {
  return {
    id,
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
    identitySalt: secret + id,
    sessionSecret: secret + id,
    cursorSecret: secret + id,
    economy: JSON.parse(JSON.stringify(economy)) as EconomyCatalog,
  };
}

function echoGame(): RuntimeGame {
  return {
    id: "echo-demo",
    displayName: "Echo",
    adapters: [{ kind: "file", source: "echo-v1.mjs" }],
    secretPrefix: "TEST",
    gracePeriodHours: 24,
    authProvider: "development",
    identitySalt: secret + "echo",
    sessionSecret: secret + "echo",
    cursorSecret: secret + "echo",
  };
}

/** The manifest entry for one game, in the shape the manifest file stores. */
function manifestGame(game: RuntimeGame): Record<string, unknown> {
  return {
    id: game.id,
    displayName: game.displayName,
    adapters: game.adapters,
    secretPrefix: game.secretPrefix,
    gracePeriodHours: game.gracePeriodHours,
    authProvider: game.authProvider,
    ...(game.economy ? { economy: game.economy } : {}),
  };
}

/** Writes a manifest file the admin API can read and patch. */
function writeManifest(games: RuntimeGame[]): string {
  const path = join(temp(), "games.json");
  writeFileSync(
    path,
    JSON.stringify({ environment: "development", games: games.map((game) => manifestGame(game)) }, null, 2),
  );
  return path;
}

async function boot(
  manifestPath: string,
  games: RuntimeGame[],
  dataDir = temp(),
): Promise<import("fastify").FastifyInstance> {
  process.env.BANTAM_CONFIG_FILE = manifestPath;
  const config = {
    environment: "development",
    dataDir,
    allowedOrigins: [],
    manifestPath,
    manifestWritable: true,
    games: new Map(games.map((game) => [game.id, game])),
  } as LoadedConfig;
  return buildApp(config, { logger: false });
}

async function adminCookie(app: import("fastify").FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/register",
    payload: "username=alice&password=hunter2hunter2&confirm=hunter2hunter2",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  return res.headers["set-cookie"]!.toString().split(";")[0]!;
}

/** Sign a player in and return their id. */
async function seedPlayer(
  app: import("fastify").FastifyInstance,
  cookie: string,
  gameId = "demo",
): Promise<string> {
  await app.inject({
    method: "POST",
    url: `/v1/games/${gameId}/auth/exchange`,
    payload: { authorizationCode: `p-${gameId}-1` },
  });
  const players = await app.inject({
    method: "GET",
    url: `/admin/api/games/${gameId}/players`,
    headers: { cookie },
  });
  return players.json<{ players: { id: string }[] }>().players[0]!.id;
}

afterEach(() => {
  clearDemoEnv();
});

describe("admin console API — operator reward claim", () => {
  it("grants a catalog reward to a player and records it in the audit trail", async () => {
    setDemoEnv();
    const app = await boot(writeManifest([demoGame()]), [demoGame()]);
    try {
      const cookie = await adminCookie(app);
      const playerId = await seedPlayer(app, cookie);

      const res = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/rewards/welcome`,
        headers: { cookie, "content-type": "application/json" },
        payload: { reason: "support_fix" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        rewardId: string;
        replayed: boolean;
        claims: number;
        maxClaims: number;
        wallet: { currency: string; amount: number }[];
      }>();
      expect(body.rewardId).toBe("welcome");
      expect(body.replayed).toBe(false);
      expect(body.claims).toBe(1);
      expect(body.maxClaims).toBe(1);
      expect(body.wallet).toEqual([{ currency: "gold", amount: 100 }]);

      // The player detail reports the claim against the reward's limit.
      const detail = await app.inject({
        method: "GET",
        url: `/admin/api/games/demo/players/${playerId}`,
        headers: { cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(
        detail.json<{ rewardClaims: { rewardId: string; claims: number; maxClaims: number }[] }>()
          .rewardClaims,
      ).toEqual([{ rewardId: "welcome", claims: 1, maxClaims: 1 }]);

      const audit = await app.inject({ method: "GET", url: "/admin/api/audit", headers: { cookie } });
      const entry = audit.json<{ entries: { action: string; target: string | null }[] }>().entries[0];
      expect(entry?.action).toBe("reward.claim");
      expect(entry?.target).toBe(playerId);
    } finally {
      await app.close();
    }
  }, 60_000);

  it("refuses a second claim once the reward limit is used up", async () => {
    setDemoEnv();
    const app = await boot(writeManifest([demoGame()]), [demoGame()]);
    try {
      const cookie = await adminCookie(app);
      const playerId = await seedPlayer(app, cookie);
      const url = `/admin/api/games/demo/players/${playerId}/rewards/welcome`;

      const first = await app.inject({
        method: "POST",
        url,
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url,
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      expect(second.statusCode).toBe(409);
      expect(second.json<{ error: { message: string } }>().error.message).toContain("maximum times");
    } finally {
      await app.close();
    }
  }, 60_000);

  it("gates the route, and refuses an unknown reward or player", async () => {
    setDemoEnv();
    const app = await boot(writeManifest([demoGame()]), [demoGame()]);
    try {
      const cookie = await adminCookie(app);
      const playerId = await seedPlayer(app, cookie);

      const anonymous = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/rewards/welcome`,
        headers: { "content-type": "application/json" },
        payload: {},
      });
      expect(anonymous.statusCode).toBe(401);

      const unknownReward = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/rewards/nope`,
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      expect(unknownReward.statusCode).toBe(404);

      const unknownPlayer = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/does-not-exist/rewards/welcome`,
        headers: { cookie, "content-type": "application/json" },
        payload: {},
      });
      expect(unknownPlayer.statusCode).toBe(404);

      const unknownField = await app.inject({
        method: "POST",
        url: `/admin/api/games/demo/players/${playerId}/rewards/welcome`,
        headers: { cookie, "content-type": "application/json" },
        payload: { bogus: true },
      });
      expect(unknownField.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  }, 60_000);
});

describe("admin console API — typed economy catalog write", () => {
  it("saves the catalog to the manifest and reloads the runtime", async () => {
    setDemoEnv();
    const manifestPath = writeManifest([demoGame()]);
    const app = await boot(manifestPath, [demoGame()]);
    try {
      const cookie = await adminCookie(app);
      const res = await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/economy",
        headers: { cookie, "content-type": "application/json" },
        payload: {
          currencies: [{ id: "gold" }, { id: "gems" }],
          items: [
            { id: "potion", type: "consumable", stackable: true, usable: true },
            { id: "sword", type: "permanent", stackable: false },
          ],
          offers: [
            { id: "starter", itemId: "potion", quantity: 1, priceCurrencyId: "gold", priceAmount: 10 },
            {
              id: "bundle",
              itemId: "potion",
              quantity: 3,
              priceCurrencyId: "gems",
              priceAmount: 5,
              active: false,
              maxPerPlayer: 3,
            },
          ],
          rewards: [
            {
              id: "welcome",
              grants: [{ kind: "currency", currencyId: "gems", amount: 10 }],
              maxClaims: 2,
            },
          ],
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        currencies: { id: string }[];
        items: { id: string }[];
        offers: { id: string; maxPerPlayer: number | null; active: boolean }[];
        rewards: { id: string; maxClaims: number | null }[];
        iapProducts: unknown[];
      }>();
      expect(body.currencies.map((c) => c.id)).toEqual(["gold", "gems"]);
      expect(body.items.map((i) => i.id)).toEqual(["potion", "sword"]);
      expect(body.offers).toHaveLength(2);
      expect(body.offers[1]!.maxPerPlayer).toBe(3);
      expect(body.offers[1]!.active).toBe(false);
      expect(body.rewards[0]!.maxClaims).toBe(2);
      expect(body.iapProducts).toEqual([]);

      // What landed on disk is what the server now runs.
      const onDisk = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        games: { id: string; economy: { currencies: { id: string }[] } }[];
      };
      expect(onDisk.games[0]!.economy.currencies.map((c) => c.id)).toEqual(["gold", "gems"]);

      const audit = await app.inject({ method: "GET", url: "/admin/api/audit", headers: { cookie } });
      expect(audit.json<{ entries: { action: string }[] }>().entries[0]?.action).toBe("economy.update");
    } finally {
      await app.close();
    }
  }, 60_000);

  it("rejects a catalog that breaks the economy contract and leaves the manifest untouched", async () => {
    setDemoEnv();
    const manifestPath = writeManifest([demoGame()]);
    const app = await boot(manifestPath, [demoGame()]);
    try {
      const cookie = await adminCookie(app);
      const before = readFileSync(manifestPath, "utf8");

      // An offer that points at an item the catalog does not declare.
      const dangling = await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/economy",
        headers: { cookie, "content-type": "application/json" },
        payload: {
          currencies: [{ id: "gold" }],
          items: [{ id: "potion", type: "consumable", stackable: true }],
          offers: [{ id: "starter", itemId: "ghost", quantity: 1, priceCurrencyId: "gold", priceAmount: 10 }],
        },
      });
      expect(dangling.statusCode).toBe(400);
      expect(readFileSync(manifestPath, "utf8")).toBe(before);

      // An unknown field is rejected outright.
      const unknownField = await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/economy",
        headers: { cookie, "content-type": "application/json" },
        payload: {
          currencies: [{ id: "gold" }],
          items: [{ id: "potion", type: "consumable", stackable: true }],
          offers: [],
          surprise: true,
        },
      });
      expect(unknownField.statusCode).toBe(400);
      expect(readFileSync(manifestPath, "utf8")).toBe(before);
    } finally {
      await app.close();
    }
  }, 60_000);
});

describe("admin console API — typed per-game settings write", () => {
  it("saves the display name, auth provider and grace period", async () => {
    setDemoEnv();
    const manifestPath = writeManifest([demoGame()]);
    const app = await boot(manifestPath, [demoGame()]);
    try {
      const cookie = await adminCookie(app);
      const res = await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/settings",
        headers: { cookie, "content-type": "application/json" },
        payload: { displayName: "Demo Renamed", authProvider: "development", gracePeriodHours: 48 },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        id: string;
        displayName: string;
        authProvider: string;
        gracePeriodHours: number;
        secretPrefix: string;
      }>();
      expect(body.displayName).toBe("Demo Renamed");
      expect(body.gracePeriodHours).toBe(48);
      expect(body.secretPrefix).toBe("TEST");

      const onDisk = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        games: { displayName: string; gracePeriodHours: number }[];
      };
      expect(onDisk.games[0]!.displayName).toBe("Demo Renamed");
      expect(onDisk.games[0]!.gracePeriodHours).toBe(48);

      const audit = await app.inject({ method: "GET", url: "/admin/api/audit", headers: { cookie } });
      expect(audit.json<{ entries: { action: string }[] }>().entries[0]?.action).toBe("game.update");
    } finally {
      await app.close();
    }
  }, 60_000);

  it("rejects an unknown field and an out-of-range grace period", async () => {
    setDemoEnv();
    const manifestPath = writeManifest([demoGame()]);
    const app = await boot(manifestPath, [demoGame()]);
    try {
      const cookie = await adminCookie(app);
      const unknown = await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/settings",
        headers: { cookie, "content-type": "application/json" },
        payload: { displayName: "X", authProvider: "development", gracePeriodHours: 1, secretPrefix: "NEW" },
      });
      expect(unknown.statusCode).toBe(400);

      const outOfRange = await app.inject({
        method: "PUT",
        url: "/admin/api/games/demo/settings",
        headers: { cookie, "content-type": "application/json" },
        payload: { displayName: "X", authProvider: "development", gracePeriodHours: 500 },
      });
      expect(outOfRange.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  }, 60_000);
});

describe("admin console API — adapter source viewer", () => {
  it("reports the kind, source and games of every loaded adapter", async () => {
    setDemoEnv();
    await preloadAdapterDirectory(adaptersDir);
    const app = await boot(writeManifest([demoGame(), echoGame()]), [demoGame(), echoGame()]);
    try {
      const cookie = await adminCookie(app);
      const res = await app.inject({ method: "GET", url: "/admin/api/adapters", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const adapters = res.json<{
        adapters: { id: string; kind: string; source: string | null; games: string[] }[];
      }>().adapters;

      const generic = adapters.find((adapter) => adapter.id.startsWith("generic:"));
      expect(generic?.kind).toBe("generic");
      expect(generic?.source).toBe("synthesized[demo]");
      expect(generic?.games).toEqual(["demo"]);

      const echo = adapters.find((adapter) => adapter.id === "echo-v1");
      expect(echo?.kind).toBe("file");
      expect(echo?.source).toBe("echo-v1.mjs");
      expect(echo?.games).toEqual(["echo-demo"]);
    } finally {
      await app.close();
    }
  }, 60_000);

  it("returns the module behind a file adapter", async () => {
    setDemoEnv();
    await preloadAdapterDirectory(adaptersDir);
    const app = await boot(writeManifest([echoGame()]), [echoGame()]);
    try {
      const cookie = await adminCookie(app);
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/adapters/echo-v1/source",
        headers: { cookie },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        id: string;
        file: string;
        language: string;
        bytes: number;
        content: string;
        editable: boolean;
      }>();
      expect(body.id).toBe("echo-v1");
      expect(body.language).toBe("javascript");
      expect(body.editable).toBe(false);
      expect(body.file).toContain("echo-v1.mjs");
      expect(body.bytes).toBeGreaterThan(0);
      expect(body.content).toContain('id: "echo-v1"');
    } finally {
      await app.close();
    }
  }, 60_000);

  it("gates the route and 404s for an adapter with no file", async () => {
    setDemoEnv();
    const app = await boot(writeManifest([demoGame()]), [demoGame()]);
    try {
      const cookie = await adminCookie(app);

      const anonymous = await app.inject({
        method: "GET",
        url: "/admin/api/adapters/echo-v1/source",
      });
      expect(anonymous.statusCode).toBe(401);

      const unknown = await app.inject({
        method: "GET",
        url: "/admin/api/adapters/nope/source",
        headers: { cookie },
      });
      expect(unknown.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  }, 60_000);
});
