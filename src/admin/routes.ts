import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { listLoadedAdapters } from "../adapters/registry.js";
import type { Runtime } from "../app.js";
import {
  ADMIN_SESSION_MAX_AGE_MS,
  ADMIN_COOKIE_NAME,
  formatStored,
  hashPasswordAsync,
  issueAdminSession,
  parseUsername,
  revokeSession,
  validatePassword,
  verifyPasswordAsync,
} from "../auth/admin.js";
import type { AdminDatabase } from "../db/admin-database.js";
import { BantamError } from "../errors.js";
import type { LeaderboardEntry } from "../db/game-database.js";
import type { BoardDefinition, GenericAdapterSpec, RuntimeGame } from "../types.js";
import {
  clearCookieValue,
  cookieHook,
  redirectIfAuthenticated,
  serializeCookie,
  sessionCookieMiddleware,
} from "./middleware.js";
import { ManifestStore } from "./manifest-store.js";
import type { ManifestFile } from "./manifest-store.js";
import {
  badge,
  banner,
  errorList,
  escapeHtml,
  publicShell,
  renderKv,
  renderTable,
  shell,
} from "./templates.js";

export type ReloadRuntimes = (games: RuntimeGame[]) => Promise<{ added: string[]; removed: string[] }>;

export async function registerAdmin(
  app: FastifyInstance,
  adminDb: AdminDatabase,
  runtimes: Map<string, Runtime>,
  reloadRuntimes: ReloadRuntimes,
  manifestStore: ManifestStore,
): Promise<void> {
  cookieHook(app);
  app.addHook("preHandler", sessionCookieMiddleware(adminDb));
  app.addHook("preHandler", redirectIfAuthenticated(adminDb));

  const nav = (active: string) =>
    [
      { href: "/admin/", label: "Overview" },
      { href: "/admin/games", label: "Games" },
      { href: "/admin/adapters", label: "Adapters" },
      { href: "/admin/health", label: "Health" },
      { href: "/admin/manifest", label: "Manifest" },
      { href: "/admin/logout", label: "Log out" },
    ].map((item) => ({ ...item, active: active === item.href || active.startsWith(item.href + "?") }));

  const countAdmins = () => adminDb.countAdmins();

  // Decide the Secure flag for the session cookie. Browsers refuse Secure
  // cookies on plain HTTP, so we must not set Secure when the request is
  // HTTP (even behind a TLS-terminating proxy, request.protocol still reads
  // the inner scheme unless trustProxy is enabled — keep the explicit env
  // override as the supported way to lock it down).
  // - BANTAM_ADMIN_COOKIE_SECURE=true  → always Secure (real production)
  // - BANTAM_ADMIN_COOKIE_SECURE=false → never Secure (local HTTP testing)
  // - unset                            → Secure iff the request is HTTPS
  const cookieSecureFor = (request: { protocol: string }): boolean => {
    const flag = process.env.BANTAM_ADMIN_COOKIE_SECURE;
    if (flag === "true") return true;
    if (flag === "false") return false;
    return request.protocol === "https";
  };

  // ─── Auth pages ───────────────────────────────────────────────────────────────

  app.get("/admin/login", async (_request, reply) => {
    const url = _request.url;
    const next = new URL(url, "http://x").searchParams.get("next") ?? "/admin/";
    const opened = countAdmins() === 0;
    // When no admin exists yet, render a registration form (POSTs to
    // /admin/register), NOT a login form. Submitting the login form before
    // any admin exists is a dead-end — the login handler has no row to verify
    // against and replies with "incorrect username or password", which the
    // user reads as a registration failure. Show the registration form up
    // front when opened=true.
    if (opened) {
      const body = `<div class="card">
        <h1>Create the first admin</h1>
        ${banner("No admin accounts exist yet. This is the only moment registration is open. Once you create the first admin, future visitors must log in.", "warn")}
        <form class="bantam" method="post" action="/admin/register">
          <label>Username <input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64"></label>
          <label class="pw-row">Password <span class="pw-wrap"><input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show password" data-hide-label="Hide password">Show</button></span></label>
          <label class="pw-row">Confirm password <span class="pw-wrap"><input type="password" name="confirm" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show password" data-hide-label="Hide password">Show</button></span></label>
          <button type="submit">Create admin</button>
        </form>
      </div>`;
      return reply.type("text/html").send(publicShell("First admin", body));
    }
    const body = `<div class="card">
        <h1>Log in</h1>
        <form class="bantam" method="post" action="/admin/login${next !== "/admin/" ? `?next=${encodeURIComponent(next)}` : ""}">
          <label>Username <input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64"></label>
          <label class="pw-row">Password <span class="pw-wrap"><input type="password" name="password" autocomplete="current-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show password" data-hide-label="Hide password">Show</button></span></label>
          <button type="submit">Log in</button>
        </form>
      </div>`;
    return reply.type("text/html").send(publicShell("Login", body));
  });

  app.post("/admin/login", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    // Trim and normalize to make typos harder: collapse case so "Alice" and
    // "alice" hit the same row.
    const usernameRaw = typeof body?.["username"] === "string" ? body["username"] : "";
    const username = parseUsername(usernameRaw.toLowerCase());
    const password = validatePassword(typeof body?.["password"] === "string" ? body["password"] : "");
    const next = (() => {
      const url = request.url;
      const v = new URL(url, "http://x").searchParams.get("next") ?? "/admin/";
      if (!v.startsWith("/admin/") && !v.startsWith("/admin")) return "/admin/";
      return v;
    })();
    // Always re-render the login form so the user can correct typos without
    // losing their input. The server-side error message is the only signal
    // telling them what went wrong; clearing the form on rejection is hostile.
    const renderError = (title: string, message: string, code: number) => {
      const body = `<div class="card">
          <h1>${escapeHtml(title)}</h1>
          ${banner(escapeHtml(message), "bad")}
          <form class="bantam" method="post" action="/admin/login${next !== "/admin/" ? `?next=${encodeURIComponent(next)}` : ""}">
            <label>Username <input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64" value="${escapeHtml(usernameRaw)}"></label>
            <label class="pw-row">Password <span class="pw-wrap"><input type="password" name="password" autocomplete="current-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show password" data-hide-label="Hide password">Show</button></span></label>
            <button type="submit">Log in</button>
          </form>
        </div>`;
      return reply.code(code).type("text/html").send(publicShell("Login", body));
    };
    if (!username || !password) {
      return renderError("Login failed", "Invalid username or password format.", 400);
    }
    const row = adminDb.findAdminByUsername(username);
    if (!row || !(await verifyPasswordAsync(password, row.password_hash))) {
      return renderError("Login failed", "Username or password is incorrect.", 401);
    }
    const session = issueAdminSession(adminDb, row.id);
    adminDb.updateAdminLastLogin(row.id, Date.now());
    return reply
      .header(
        "set-cookie",
        serializeCookie(ADMIN_COOKIE_NAME, session.cookie, {
          maxAge: Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000),
          path: "/admin/",
          secure: cookieSecureFor(request),
          httpOnly: true,
          sameSite: "Strict",
        }),
      )
      .redirect(next, 302);
  });

  app.get("/admin/register", async (_request, reply) => {
    if (countAdmins() > 0) {
      return reply.code(404).type("text/plain").send("registration closed");
    }
    const body = `
      <div class="card">
        <h1>Create the first admin</h1>
        ${banner("No admin accounts exist yet. This is the only moment registration is open. Once you create the first admin, future visitors must log in.", "warn")}
        <form class="bantam" method="post" action="/admin/register">
          <label>Username <input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64"><span class="muted">Letters, digits, dot, underscore, dash. Up to 64 chars.</span></label>
          <label class="pw-row">Password <span class="muted">At least 8 characters.</span><span class="pw-wrap"><input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show password" data-hide-label="Hide password">Show</button></span></label>
          <label class="pw-row">Confirm password <span class="pw-wrap"><input type="password" name="confirm" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show password" data-hide-label="Hide password">Show</button></span></label>
          <button type="submit">Create admin</button>
        </form>
      </div>`;
    return reply.type("text/html").send(publicShell("Register", body));
  });

  app.post("/admin/register", async (request, reply) => {
    if (countAdmins() > 0) {
      return reply.code(404).type("text/plain").send("registration closed");
    }
    const body = request.body as Record<string, unknown> | undefined;
    const usernameRaw = typeof body?.["username"] === "string" ? body["username"] : "";
    const username = parseUsername(usernameRaw.toLowerCase());
    const password = validatePassword(typeof body?.["password"] === "string" ? body["password"] : "");
    const confirm = typeof body?.["confirm"] === "string" ? body["confirm"] : "";
    const renderRegError = (message: string) =>
      reply
        .code(400)
        .type("text/html")
        .send(
          publicShell(
            "Register",
            `<div class="card">
              <h1>Registration failed</h1>
              ${banner(message, "bad")}
              <form class="bantam" method="post" action="/admin/register">
                <label>Username <input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64" value="${escapeHtml(usernameRaw)}"></label>
                <label class="pw-row">Password <span class="pw-wrap"><input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show password" data-hide-label="Hide password">Show</button></span></label>
                <label class="pw-row">Confirm password <span class="pw-wrap"><input type="password" name="confirm" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show password" data-hide-label="Hide password">Show</button></span></label>
                <button type="submit">Create admin</button>
              </form>
            </div>`,
          ),
        );
    if (!username || !password) {
      return renderRegError("Username or password invalid.");
    }
    if (password !== confirm) {
      return renderRegError("Passwords do not match.");
    }
    if (adminDb.findAdminByUsername(username)) {
      return renderRegError("Username is already taken.");
    }
    const hashed = await hashPasswordAsync(password);
    adminDb.insertAdmin(randomUUID(), username, formatStored(hashed), hashed.salt, Date.now());
    const inserted = adminDb.findAdminByUsername(username);
    if (!inserted) throw new BantamError("internal-error", "Admin insert lost", 500);
    const session = issueAdminSession(adminDb, inserted.id);
    return reply
      .header(
        "set-cookie",
        serializeCookie(ADMIN_COOKIE_NAME, session.cookie, {
          maxAge: Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000),
          path: "/admin/",
          secure: cookieSecureFor(request),
          httpOnly: true,
          sameSite: "Strict",
        }),
      )
      .redirect("/admin/", 302);
  });

  app.post("/admin/logout", async (request, reply) => {
    const cookies = (request as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    const cookie = cookies[ADMIN_COOKIE_NAME];
    if (cookie) revokeSession(adminDb, cookie);
    return reply.header("set-cookie", clearCookieValue(ADMIN_COOKIE_NAME)).redirect("/admin/login", 302);
  });

  // ─── Manifest editor ─────────────────────────────────────────────────────────

  app.get("/admin/manifest", async (_request, reply) => {
    const loaded = manifestStore.load();
    const url = _request.url;
    const justSaved = new URL(url, "http://x").searchParams.get("saved") === "1";
    if (!loaded.ok) {
      return reply
        .type("text/html")
        .send(
          shell(
            "Manifest",
            `<h1>Manifest</h1>${banner(`Cannot read manifest: ${escapeHtml(loaded.error)}`, "bad")}`,
            nav("/admin/manifest"),
          ),
        );
    }
    const bannerHtml = justSaved
      ? banner("Saved. Runtime reloaded.", "ok")
      : loaded.writable
        ? ""
        : banner(
            `Manifest path ${escapeHtml(loaded.path)} is read-only. The editor below is disabled. To edit via the UI, leave BANTAM_CONFIG_FILE unset and mount /data writable.`,
            "warn",
          );
    const editorDisabled = loaded.writable ? "" : "disabled";
    const body = `
      <h1>Manifest</h1>
      <p class="muted">Source: <code>${escapeHtml(loaded.path)}</code> · ${badge(loaded.writable ? "writable" : "read-only", loaded.writable ? "ok" : "warn")}</p>
      ${bannerHtml}
      <form class="bantam" method="post" action="/admin/manifest">
        <label>Manifest JSON <textarea name="manifest" spellcheck="false" ${editorDisabled}>${escapeHtml(loaded.raw)}</textarea></label>
        <button type="submit" ${editorDisabled}>Save & reload</button>
      </form>
      <p class="muted">Top-level <code>environment</code> and an array of <code>games</code>. Each game has <code>id</code>, <code>displayName</code>, <code>adapters</code> (kind <code>generic</code> with <code>boards</code> or kind <code>file</code> with <code>source</code>), <code>secretPrefix</code>, <code>gracePeriodHours</code>, and <code>authProvider</code>.</p>
      <p class="muted">Per-game secrets must be supplied as env vars: <code>\${secretPrefix}_IDENTITY_SALT</code>, <code>_SESSION_SECRET</code>, <code>_CURSOR_SECRET</code>, plus <code>_PGS_CLIENT_ID</code> / <code>_PGS_CLIENT_SECRET</code> for <code>pgs-v2</code>. Restart the container after changing them.</p>`;
    return reply.type("text/html").send(shell("Manifest", body, nav("/admin/manifest")));
  });

  app.post("/admin/manifest", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    const manifestText = typeof body?.["manifest"] === "string" ? body["manifest"] : "";
    if (!manifestText.trim()) {
      return reply
        .code(400)
        .type("text/html")
        .send(
          shell(
            "Manifest",
            `<h1>Manifest</h1>${banner("Manifest body was empty.", "bad")}`,
            nav("/admin/manifest"),
          ),
        );
    }
    const result = manifestStore.save(manifestText);
    if (!result.ok) {
      return reply
        .code(400)
        .type("text/html")
        .send(
          shell(
            "Manifest",
            `<h1>Manifest</h1>${errorList(result.errors)}<p><a href="/admin/manifest">Back</a></p>`,
            nav("/admin/manifest"),
          ),
        );
    }
    const manifest: ManifestFile = result.manifest;
    // Reload runtimes from the validated manifest. The reload callback in app.ts
    // re-opens per-game DBs and rebuilds adapter maps based on the new config.
    const runtimeGames: RuntimeGame[] = manifest.games.map((g) => ({
      id: g.id,
      displayName: g.displayName,
      adapters: g.adapters as never,
      secretPrefix: g.secretPrefix,
      gracePeriodHours: g.gracePeriodHours,
      authProvider: g.authProvider,
      identitySalt: "", // Resolved by env vars when the game runtime is built.
      sessionSecret: "",
      cursorSecret: "",
    }));
    // Resolve secrets from env via a helper that reads process.env. This
    // keeps the editor decoupled from the runtime config loader.
    const enriched = runtimeGames.map((g) => resolveGameSecrets(g));
    try {
      await reloadRuntimes(enriched);
    } catch (error) {
      return reply
        .code(500)
        .type("text/html")
        .send(
          shell(
            "Manifest",
            `<h1>Manifest</h1>${banner(`Saved manifest to disk but runtime reload failed: ${escapeHtml(String(error))}`, "bad")}`,
            nav("/admin/manifest"),
          ),
        );
    }
    return reply.redirect("/admin/manifest?saved=1", 302);
  });

  // ─── Existing read-only pages ─────────────────────────────────────────────────

  app.get("/admin/", async (_request, reply) => {
    const games = [...runtimes.values()];
    const body =
      games.length === 0
        ? `
        <h1>Bantam Admin</h1>
        ${banner('No games loaded yet. <a href="/admin/manifest">Open Manifest</a> to create your first game.', "warn")}
        <p class="muted">Read-only operational view. The server is healthy and waiting for a manifest.</p>
        <ul>
          <li><a href="/admin/manifest">Manifest</a> — edit and apply games.json.</li>
          <li><a href="/admin/adapters">Adapters</a> — loaded implementations and which games reference them.</li>
          <li><a href="/admin/health">Health</a> — per-game readiness and adapter coverage.</li>
          <li><a href="/openapi.json">OpenAPI spec</a> — JSON, all routes.</li>
        </ul>`
        : `
        <h1>Bantam Admin</h1>
        <p class="muted">Read-only operational view. ${escapeHtml(String(games.length))} game(s) loaded.</p>
        <ul>
          <li><a href="/admin/games">Games</a> — manifest, boards, recent runs.</li>
          <li><a href="/admin/adapters">Adapters</a> — loaded implementations and which games reference them.</li>
          <li><a href="/admin/health">Health</a> — per-game readiness and adapter coverage.</li>
          <li><a href="/admin/manifest">Manifest</a> — edit or replace games.json.</li>
          <li><a href="/openapi.json">OpenAPI spec</a> — JSON, all routes.</li>
        </ul>`;
    return reply.type("text/html").send(shell("Overview", body, nav("/admin/")));
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

function resolveGameSecrets(
  game: Omit<
    RuntimeGame,
    "identitySalt" | "sessionSecret" | "cursorSecret" | "pgsClientId" | "pgsClientSecret"
  >,
): RuntimeGame {
  const env = process.env;
  const read = (suffix: string): string => {
    const key = `${game.secretPrefix}_${suffix}`;
    const value = env[key];
    if (!value || value.length < 16)
      throw new BantamError(
        "invalid-secret",
        `Missing or short secret for ${game.id}: ${key} (≥16 chars required)`,
        500,
      );
    return value;
  };
  const out: RuntimeGame = {
    ...game,
    identitySalt: read("IDENTITY_SALT"),
    sessionSecret: read("SESSION_SECRET"),
    cursorSecret: read("CURSOR_SECRET"),
  };
  if (game.authProvider === "pgs-v2") {
    out.pgsClientId = read("PGS_CLIENT_ID");
    out.pgsClientSecret = read("PGS_CLIENT_SECRET");
  }
  return out;
}
