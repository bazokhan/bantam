import { sha256, safeEqual } from "../util/crypto.js";
import type { FastifyInstance } from "fastify";
import { badge, escapeHtml, renderKv, renderTable, shell } from "./templates.js";
import type { Runtime } from "../app.js";
import { listLoadedAdapters } from "../adapters/registry.js";
import type { BoardDefinition, GenericAdapterSpec } from "../types.js";
import type { LeaderboardEntry } from "../db/game-database.js";

// Registers the read-only admin UI on `app`. Auth: Bearer token (constant-time
// compare). Missing/invalid token → 401. Routes:
//   GET /admin                       — landing
//   GET /admin/games                 — games table
//   GET /admin/games/:gameId          — game manifest, boards, top 10
//   GET /admin/games/:gameId/runs    — last 20 runs (no payload bodies)
//   GET /admin/adapters              — loaded adapters + which games use them
//   GET /admin/health                — per-game ready status + adapter coverage
export async function registerAdmin(
  app: FastifyInstance,
  token: string,
  runtimes: Map<string, Runtime>,
): Promise<void> {
  const expected = sha256(token);

  app.addHook("preHandler", async (request, reply) => {
    const url = request.routeOptions.url ?? request.url;
    if (!url.startsWith("/admin")) return;
    const header = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!safeEqual(sha256(header), expected)) {
      return reply
        .code(401)
        .type("text/html")
        .send(`<!doctype html><meta charset="utf-8"><title>Unauthorized</title><p>Unauthorized.</p>`);
    }
  });

  const nav = (active: string) =>
    [
      { href: "/admin", label: "Overview" },
      { href: "/admin/games", label: "Games" },
      { href: "/admin/adapters", label: "Adapters" },
      { href: "/admin/health", label: "Health" },
    ].map((item) => ({ ...item, active: active.startsWith(item.href) }));

  app.get("/admin", async (_request, reply) => {
    const games = [...runtimes.values()];
    const body = `
      <h1>Bantam Admin</h1>
      <p class="muted">Read-only operational view. ${escapeHtml(String(games.length))} game(s) loaded.</p>
      <ul>
        <li><a href="/admin/games">Games</a> — manifest, boards, recent runs.</li>
        <li><a href="/admin/adapters">Adapters</a> — loaded implementations and which games reference them.</li>
        <li><a href="/admin/health">Health</a> — per-game readiness and adapter coverage.</li>
        <li><a href="/openapi.json">OpenAPI spec</a> — JSON, all routes.</li>
      </ul>`;
    return reply.type("text/html").send(shell("Overview", body, nav("/admin")));
  });

  app.get("/admin/games", async (_request, reply) => {
    const rows = [...runtimes.entries()].map(([id, runtime]) => {
      const ready = runtime.db.ready();
      return [
        `<a href="/admin/games/${escapeHtml(id)}">${escapeHtml(id)}</a>`,
        escapeHtml(runtime.game.displayName),
        String(runtime.adapters.size),
        badge(ready ? "ready" : "starting", ready ? "ok" : "bad"),
        `<a href="/admin/games/${escapeHtml(id)}/runs">runs</a>`,
      ];
    });
    const body = `<h1>Games</h1>${renderTable(["id", "display name", "adapters", "db", ""], rows)}`;
    return reply.type("text/html").send(shell("Games", body, nav("/admin/games")));
  });

  app.get<{ Params: { gameId: string } }>("/admin/games/:gameId", async (request, reply) => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    const adapters = [...runtime.adapters.values()].map((a) =>
      renderKv([
        ["id", escapeHtml(a.id)],
        ["version", escapeHtml(a.version)],
        [
          "boards",
          a.boards
            .map(
              (b: BoardDefinition) =>
                `${escapeHtml(b.id)} (${b.direction}, ${b.period}${b.completedOnly ? ", completed-only" : ""})`,
            )
            .join(", "),
        ],
      ]),
    );
    // Pick the first generic adapter with a board; if none, render an empty top-10.
    const genericSpec = runtime.game.adapters.find(
      (spec): spec is GenericAdapterSpec => spec.kind === "generic",
    );
    const defaultBoard: BoardDefinition | undefined = genericSpec?.boards[0];
    const top = defaultBoard
      ? renderTable(
          ["rank", "player", "value"],
          runtime.db
            .list(
              defaultBoard,
              defaultBoard.period === "all_time" ? "all_time" : new Date().toISOString().slice(0, 10),
              0,
              10,
            )
            .map((entry: LeaderboardEntry & { ordinal: number }) => [
              String(entry.rank),
              escapeHtml(entry.displayName),
              String(entry.value),
            ]),
        )
      : `<p class="muted">No boards.</p>`;
    const body = `
      <h1>${escapeHtml(runtime.game.id)}</h1>
      <p class="muted">${escapeHtml(runtime.game.displayName)}</p>
      ${renderKv([
        ["auth", escapeHtml(runtime.game.authProvider)],
        ["grace period", `${runtime.game.gracePeriodHours}h`],
        ["adapters", String(runtime.adapters.size)],
      ])}
      <h2>Adapters</h2>
      ${adapters.join("")}
      <h2>Top 10 — ${escapeHtml(defaultBoard?.id ?? "(none)")}</h2>
      ${top}`;
    return reply.type("text/html").send(shell(runtime.game.id, body, nav("/admin/games")));
  });

  app.get<{ Params: { gameId: string } }>("/admin/games/:gameId/runs", async (request, reply) => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    const rows = runtime.db
      .recentRuns(20)
      .map((run: { runId: string; adapterId: string; createdAt: Date; payloadHash: string }) => [
        escapeHtml(run.runId),
        escapeHtml(run.adapterId),
        escapeHtml(run.createdAt.toISOString()),
        `<span class="muted">${escapeHtml(run.payloadHash.slice(0, 16))}…</span>`,
      ]);
    const body = `<h1>Runs — ${escapeHtml(runtime.game.id)}</h1>
      <p class="muted">Last 20. Payload bodies redacted; payloadHash only.</p>
      ${renderTable(["runId", "adapter", "createdAt", "payloadHash"], rows)}`;
    return reply.type("text/html").send(shell("Runs", body, nav("/admin/games")));
  });

  app.get("/admin/adapters", async (_request, reply) => {
    const games = [...runtimes.values()];
    const usage = new Map<string, string[]>();
    for (const runtime of games) {
      for (const id of runtime.adapters.keys()) {
        const list = usage.get(id) ?? [];
        list.push(runtime.game.id);
        usage.set(id, list);
      }
    }
    const rows = listLoadedAdapters().map((a) => [
      escapeHtml(a.id),
      escapeHtml(a.version),
      String(a.boards.length),
      (usage.get(a.id) ?? []).map((g) => escapeHtml(g)).join(", ") || '<span class="muted">—</span>',
    ]);
    const body = `<h1>Adapters</h1>${renderTable(["id", "version", "boards", "games"], rows)}`;
    return reply.type("text/html").send(shell("Adapters", body, nav("/admin/adapters")));
  });

  app.get("/admin/health", async (_request, reply) => {
    const games = [...runtimes.entries()].map(([id, runtime]) => {
      const ready = runtime.db.ready();
      const total = runtime.game.adapters.length;
      const loaded = runtime.adapters.size;
      return [
        `<a href="/admin/games/${escapeHtml(id)}">${escapeHtml(id)}</a>`,
        badge(ready ? "ready" : "starting", ready ? "ok" : "bad"),
        `${loaded} / ${total}`,
      ];
    });
    const body = `<h1>Health</h1>${renderTable(["game", "db", "adapters loaded"], games)}`;
    return reply.type("text/html").send(shell("Health", body, nav("/admin/health")));
  });
}
