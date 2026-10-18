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
import { catalogCurrency, catalogItem, googlePlayServiceAccountEnv } from "../services/economy.js";
import { applyEconomyFromForm, currencyOptions, itemOptions, renderEconomyFields } from "./economy-form.js";
import type { AdapterSpec, BoardDefinition, RuntimeGame } from "../types.js";
import {
  clearCookieValue,
  cookieHook,
  redirectIfAuthenticated,
  serializeCookie,
  sessionCookieMiddleware,
} from "./middleware.js";
import { ManifestStore, type ManifestFile } from "./manifest-store.js";
import {
  FLAG_DESCRIPTION_MAX,
  FLAG_MAX,
  FLAG_VALUE_MAX,
  isValidFlagKey,
  parseRolloutPercent,
} from "../services/feature-flags.js";
import {
  badge,
  banner,
  confirmAction,
  errorList,
  escapeHtml,
  field,
  gameSubnav,
  kpi,
  pageHead,
  publicShell,
  renderTable,
  shell,
} from "./templates.js";

export type ReloadRuntimes = (manifest: ManifestFile) => Promise<{ added: string[]; removed: string[] }>;

// Required env keys per game. Booleans only — never echo the value back to
// the operator, even in error messages. The full key names are documented in
// the SKILL so this list stays authoritative.
function requiredEnvKeys(game: RuntimeGame): string[] {
  const base = [
    `${game.secretPrefix}_IDENTITY_SALT`,
    `${game.secretPrefix}_SESSION_SECRET`,
    `${game.secretPrefix}_CURSOR_SECRET`,
  ];
  if (game.authProvider === "pgs-v2")
    base.push(`${game.secretPrefix}_PGS_CLIENT_ID`, `${game.secretPrefix}_PGS_CLIENT_SECRET`);
  if (game.economy?.iapProducts?.some((product) => product.provider === "google_play"))
    base.push(googlePlayServiceAccountEnv(game.secretPrefix));
  return base;
}

function envPresence(keys: readonly string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of keys) out[key] = Boolean(process.env[key]) && (process.env[key] ?? "").length >= 16;
  return out;
}

// First 8 chars of the SHA-256(player id) for display. Operators don't need the
// full id to disambiguate two players; the full id is only revealed inside
// the confirm form for delete actions.
function truncateId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

function catalogSection(catalog: RuntimeGame["economy"]): string {
  const edit = `<a class="btn secondary small" href="/admin/manifest">Edit catalog</a>`;
  if (!catalog) {
    return `<section class="card" id="catalog">
      <h3>Catalog</h3>
      ${banner("No economy catalog on this game.", "warn", "Economy off")}
      <p class="muted">Add currencies, items, and offers in the manifest form. Grant forms on a player page stay hidden until a catalog exists.</p>
      ${edit}
    </section>`;
  }
  const currencyRows = catalog.currencies.map((row) => [
    { html: `<code>${escapeHtml(row.id)}</code>`, label: "currency" },
  ]);
  const itemRows = catalog.items.map((row) => [
    { html: `<code>${escapeHtml(row.id)}</code>`, label: "item" },
    { html: escapeHtml(row.type), label: "type" },
    { html: row.stackable ? "yes" : "no", label: "stackable" },
    { html: row.usable ? "yes" : "no", label: "usable" },
  ]);
  const offerRows = catalog.offers.map((row) => [
    { html: `<code>${escapeHtml(row.id)}</code>`, label: "offer" },
    { html: `<code>${escapeHtml(row.itemId)}</code> × ${row.quantity}`, label: "item" },
    { html: `${row.priceAmount} ${escapeHtml(row.priceCurrencyId)}`, label: "price" },
    { html: row.active === false ? "off" : "on", label: "active" },
  ]);
  const rewardRows = (catalog.rewards ?? []).map((row) => [
    { html: `<code>${escapeHtml(row.id)}</code>`, label: "reward" },
    { html: String(row.grants.length), label: "grants", numeric: true },
    { html: row.maxClaims == null ? "1" : String(row.maxClaims), label: "max claims" },
  ]);
  const iapRows = (catalog.iapProducts ?? []).map((row) => [
    { html: `<code>${escapeHtml(row.id)}</code>`, label: "product" },
    { html: escapeHtml(row.provider), label: "provider" },
    { html: `<code>${escapeHtml(row.providerProductId)}</code>`, label: "play id" },
  ]);
  return `<section class="card" id="catalog">
    <h3>Catalog</h3>
    <dl class="kv">
      <dt>Currencies</dt><dd>${catalog.currencies.length}</dd>
      <dt>Items</dt><dd>${catalog.items.length}</dd>
      <dt>Offers</dt><dd>${catalog.offers.length}</dd>
      <dt>Rewards</dt><dd>${(catalog.rewards ?? []).length}</dd>
      <dt>IAP</dt><dd>${(catalog.iapProducts ?? []).length}</dd>
    </dl>
    ${currencyRows.length ? renderTable(["currency"], currencyRows) : ""}
    ${itemRows.length ? renderTable(["item", "type", "stackable", "usable"], itemRows) : ""}
    ${offerRows.length ? renderTable(["offer", "item", "price", "active"], offerRows) : ""}
    ${rewardRows.length ? renderTable(["reward", "grants", "max claims"], rewardRows) : ""}
    ${iapRows.length ? renderTable(["product", "provider", "play id"], iapRows) : ""}
    ${edit}
  </section>`;
}

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
    ].map((item) => ({ ...item, active: active === item.href || active.startsWith(item.href + "?") }));

  const countAdmins = () => adminDb.countAdmins();

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
    if (opened) {
      const body = `<div class="auth-card">${pageHead(
        "Create the first admin",
        "No admin accounts exist yet. This is the only moment registration is open.",
      )}${banner(
        "Once you create the first admin, future visitors must log in. Choose a long password; you cannot recover this account later.",
        "warn",
      )}
      <form class="form" method="post" action="/admin/register">
        ${field(
          "Username",
          '<input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64" autofocus>',
          "Letters, digits, dot, underscore, dash. Up to 64 chars.",
          true,
        )}
        ${field(
          "Password",
          `<span class="password-row"><input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show" data-hide-label="Hide">Show</button></span>`,
          "At least 8 characters.",
          true,
        )}
        ${field(
          "Confirm password",
          `<span class="password-row"><input type="password" name="confirm" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show" data-hide-label="Hide">Show</button></span>`,
          "",
          true,
        )}
        <div class="form-actions">
          <button type="submit" class="btn primary">Create admin</button>
        </div>
      </form>
      <p class="meta">Already registered? <a href="/admin/login">Log in</a>.</p>
      </div>`;
      return reply.type("text/html").send(publicShell("First admin", body));
    }
    const action = `/admin/login${next !== "/admin/" ? `?next=${encodeURIComponent(next)}` : ""}`;
    const body = `<div class="auth-card">${pageHead("Log in", "Sign in with the operator account that was created at first boot.")}
      <form class="form" method="post" action="${action}">
        ${field(
          "Username",
          '<input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64" autofocus>',
          "",
          true,
        )}
        ${field(
          "Password",
          `<span class="password-row"><input type="password" name="password" autocomplete="current-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show" data-hide-label="Hide">Show</button></span>`,
          "",
          true,
        )}
        <div class="form-actions">
          <button type="submit" class="btn primary">Log in</button>
        </div>
      </form>
      </div>`;
    return reply.type("text/html").send(publicShell("Login", body));
  });

  app.post("/admin/login", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    const usernameRaw = typeof body?.["username"] === "string" ? body["username"] : "";
    const username = parseUsername(usernameRaw.toLowerCase());
    const password = validatePassword(typeof body?.["password"] === "string" ? body["password"] : "");
    const next = (() => {
      const url = request.url;
      const v = new URL(url, "http://x").searchParams.get("next") ?? "/admin/";
      if (!v.startsWith("/admin/") && !v.startsWith("/admin")) return "/admin/";
      return v;
    })();
    const action = `/admin/login${next !== "/admin/" ? `?next=${encodeURIComponent(next)}` : ""}`;
    const renderError = (title: string, message: string, code: number) => {
      const body = `<div class="auth-card">${pageHead(title, "")}${banner(escapeHtml(message), "bad")}
        <form class="form" method="post" action="${action}">
          ${field(
            "Username",
            `<input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64" value="${escapeHtml(usernameRaw)}">`,
            "",
            true,
          )}
          ${field(
            "Password",
            `<span class="password-row"><input type="password" name="password" autocomplete="current-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show" data-hide-label="Hide">Show</button></span>`,
            "",
            true,
          )}
          <div class="form-actions">
            <button type="submit" class="btn primary">Log in</button>
          </div>
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
    const body = `<div class="auth-card">${pageHead(
      "Create the first admin",
      "No admin accounts exist yet. This is the only moment registration is open.",
    )}
      ${banner(
        "Once you create the first admin, future visitors must log in. Choose a long password; you cannot recover this account later.",
        "warn",
      )}
      <form class="form" method="post" action="/admin/register">
        ${field(
          "Username",
          '<input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64" autofocus>',
          "Letters, digits, dot, underscore, dash. Up to 64 chars.",
          true,
        )}
        ${field(
          "Password",
          `<span class="password-row"><input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show" data-hide-label="Hide">Show</button></span>`,
          "At least 8 characters.",
          true,
        )}
        ${field(
          "Confirm password",
          `<span class="password-row"><input type="password" name="confirm" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show" data-hide-label="Hide">Show</button></span>`,
          "",
          true,
        )}
        <div class="form-actions">
          <button type="submit" class="btn primary">Create admin</button>
        </div>
      </form>
      <p class="meta">Already registered? <a href="/admin/login">Log in</a>.</p>
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
            `<div class="auth-card">${pageHead("Registration failed", "")}${banner(escapeHtml(message), "bad")}
            <form class="form" method="post" action="/admin/register">
              ${field(
                "Username",
                `<input type="text" name="username" autocomplete="username" required minlength="1" maxlength="64" value="${escapeHtml(usernameRaw)}">`,
                "",
                true,
              )}
              ${field(
                "Password",
                `<span class="password-row"><input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show" data-hide-label="Hide">Show</button></span>`,
                "",
                true,
              )}
              ${field(
                "Confirm password",
                `<span class="password-row"><input type="password" name="confirm" autocomplete="new-password" required minlength="8" maxlength="256"><button type="button" class="pw-toggle" aria-label="Show password" data-show-label="Show" data-hide-label="Hide">Show</button></span>`,
                "",
                true,
              )}
              <div class="form-actions">
                <button type="submit" class="btn primary">Create admin</button>
              </div>
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

  // ─── Overview ────────────────────────────────────────────────────────────────

  app.get("/admin/", async (_request, reply) => {
    const games = [...runtimes.values()];
    const totals = {
      games: games.length,
      players: games.reduce((sum, runtime) => sum + runtime.db.countPlayers(), 0),
      runsToday: games.reduce((sum, runtime) => {
        const today = new Date().toISOString().slice(0, 10);
        // Cheap approximation: sum recent runs created today. We re-use the
        // existing `recentRuns` listing rather than adding a new query.
        return (
          sum +
          runtime.db.recentRuns(200).filter((run) => run.createdAt.toISOString().slice(0, 10) === today)
            .length
        );
      }, 0),
    };
    const gameCards = games.length
      ? `<div class="card-grid">${games
          .map((runtime) => {
            const ready = runtime.db.ready();
            return `<a class="card compact" href="/admin/games/${escapeHtml(runtime.game.id)}" style="text-decoration:none;color:inherit;display:block">
          <div class="page-head" style="margin-bottom:0.5rem">
            <div>
              <h2 style="margin-bottom:0.15rem">${escapeHtml(runtime.game.displayName)}</h2>
              <div class="muted"><code>${escapeHtml(runtime.game.id)}</code></div>
            </div>
          </div>
          <div class="btn-row">
            ${badge(runtime.game.authProvider)}
            ${badge(ready ? "ready" : "starting", ready ? "ok" : "bad")}
            <span class="muted">${runtime.adapters.size} adapter${runtime.adapters.size === 1 ? "" : "s"} · ${runtime.db.countPlayers()} player${runtime.db.countPlayers() === 1 ? "" : "s"}</span>
          </div>
        </a>`;
          })
          .join("")}</div>`
      : banner("No games loaded yet.", "warn", "Get started");
    const body = `${pageHead(
      "Overview",
      games.length
        ? `${games.length} game${games.length === 1 ? "" : "s"} loaded. Pick one to inspect boards, players, and runs.`
        : "Boot the operator dashboard.",
      `<a class="btn secondary" href="/admin/manifest">Manifest editor</a>`,
    )}
      <div class="kpis">
        ${kpi("Games loaded", totals.games)}
        ${kpi("Players (all games)", totals.players)}
        ${kpi("Runs today (UTC)", totals.runsToday)}
        ${kpi(
          "Adapters loaded",
          games.reduce((s, r) => s + r.adapters.size, 0),
        )}
      </div>
      <h2 style="margin-top:1.5rem">Games</h2>
      ${gameCards}`;
    return reply.type("text/html").send(shell("Overview", body, nav("/admin/")));
  });

  // ─── Games list ──────────────────────────────────────────────────────────────

  app.get("/admin/games", async (_request, reply) => {
    const rows: { html: string; label: string; numeric?: boolean }[][] = [...runtimes.entries()].map(
      ([id, runtime]) => {
        const ready = runtime.db.ready();
        return [
          { html: `<a href="/admin/games/${escapeHtml(id)}">${escapeHtml(id)}</a>`, label: "id" },
          { html: escapeHtml(runtime.game.displayName), label: "display name" },
          { html: badge(runtime.game.authProvider), label: "auth" },
          { html: String(runtime.adapters.size), label: "adapters", numeric: true },
          { html: String(runtime.db.countPlayers()), label: "players", numeric: true },
          { html: badge(ready ? "ready" : "starting", ready ? "ok" : "bad"), label: "db" },
          {
            html: `<div class="row-actions">
              <a class="btn ghost small" href="/admin/games/${escapeHtml(id)}/boards">Boards</a>
              <a class="btn ghost small" href="/admin/games/${escapeHtml(id)}/players">Players</a>
              <a class="btn ghost small" href="/admin/games/${escapeHtml(id)}/runs">Runs</a>
              <a class="btn ghost small" href="/admin/games/${escapeHtml(id)}/flags">Flags</a>
            </div>`,
            label: "actions",
          },
        ];
      },
    );
    const body = `${pageHead(
      "Games",
      "Every game loaded from the manifest. Open one to inspect boards, players, and recent runs.",
    )}${renderTable(["id", "display name", "auth", "adapters", "players", "db", "actions"], rows)}`;
    return reply.type("text/html").send(shell("Games", body, nav("/admin/games")));
  });

  // ─── Game detail ─────────────────────────────────────────────────────────────

  app.get<{ Params: { gameId: string } }>("/admin/games/:gameId", async (request, reply) => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    const envKeys = requiredEnvKeys(runtime.game);
    const presence = envPresence(envKeys);
    const lastRun = runtime.db.recentRuns(1)[0];
    const allBoards: { adapter: { id: string; version: string }; board: BoardDefinition }[] = [];
    for (const adapter of runtime.adapters.values())
      for (const board of adapter.boards) allBoards.push({ adapter, board });
    const boardsRows = allBoards.map(({ adapter, board }) => [
      {
        html: `<a href="/admin/games/${escapeHtml(runtime.game.id)}/boards/${escapeHtml(board.id)}">${escapeHtml(board.id)}</a>`,
        label: "board",
      },
      { html: escapeHtml(board.direction), label: "direction" },
      { html: escapeHtml(board.period), label: "period" },
      { html: board.completedOnly ? "yes" : "no", label: "completed-only" },
      {
        html: `<code>${escapeHtml(adapter.id)}</code> <span class="muted">v${escapeHtml(adapter.version)}</span>`,
        label: "adapter",
      },
    ]);
    const envRows: { html: string; label: string }[] = envKeys.map((key) => ({
      html: badge(presence[key] ? "present" : "missing", presence[key] ? "ok" : "bad"),
      label: key,
    }));
    const ready = runtime.db.ready();
    const actions = `<a class="btn secondary" href="/admin/manifest">Edit manifest</a>`;
    const body = `${gameSubnav(runtime.game.id, "game")}${pageHead(
      runtime.game.displayName,
      `${runtime.game.id} · ${runtime.game.authProvider}`,
      actions,
    )}
      <section class="card stack">
        <h3>Status</h3>
        <dl class="kv">
          <dt>Grace period</dt><dd>${runtime.game.gracePeriodHours} hours</dd>
          <dt>Adapters</dt><dd>${runtime.adapters.size} of ${runtime.game.adapters.length} loaded</dd>
          <dt>Players</dt><dd>${runtime.db.countPlayers()}</dd>
          <dt>Database</dt><dd>${badge(ready ? "ready" : "starting", ready ? "ok" : "bad")}</dd>
          <dt>Last run</dt><dd>${
            lastRun
              ? `${escapeHtml(lastRun.createdAt.toISOString())} <span class="muted">(<code>${escapeHtml(lastRun.runId)}</code>)</span>`
              : '<span class="muted">never</span>'
          }</dd>
        </dl>
      </section>
      <section class="card">
        <h3>Boards</h3>
        ${allBoards.length ? renderTable(["board", "direction", "period", "completed-only", "adapter"], boardsRows) : banner("No boards declared for this game.", "warn", "Add a board")}
      </section>
      <section class="card">
        <h3>Required env vars</h3>
        ${
          envRows.length
            ? renderTable(
                ["env key", "status"],
                envRows.map((r, i) => [
                  { html: `<code>${escapeHtml(envKeys[i] ?? "")}</code>`, label: "env key" },
                  { html: r.html, label: "status" },
                ]),
              )
            : banner("No env vars required for this provider.", "warn")
        }
        <p class="muted" style="margin-top:0.5rem">Names only — values are never shown.</p>
      </section>
      ${catalogSection(runtime.game.economy)}`;
    return reply.type("text/html").send(shell(runtime.game.id, body, nav("/admin/games")));
  });

  // ─── Boards list and per-board view ──────────────────────────────────────────

  app.get<{ Params: { gameId: string } }>("/admin/games/:gameId/boards", async (request, reply) => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    const rows: { html: string; label: string }[][] = [];
    for (const adapter of runtime.adapters.values())
      for (const board of adapter.boards)
        rows.push([
          {
            html: `<a href="/admin/games/${escapeHtml(runtime.game.id)}/boards/${escapeHtml(board.id)}">${escapeHtml(board.id)}</a>`,
            label: "board",
          },
          { html: escapeHtml(board.direction), label: "direction" },
          { html: escapeHtml(board.period), label: "period" },
          { html: board.completedOnly ? "yes" : "no", label: "completed-only" },
          {
            html: `<code>${escapeHtml(adapter.id)}</code> <span class="muted">v${escapeHtml(adapter.version)}</span>`,
            label: "adapter",
          },
        ]);
    const body = `${gameSubnav(runtime.game.id, "boards")}${pageHead(
      `Boards · ${runtime.game.displayName}`,
      `${runtime.game.id} — ${rows.length} board${rows.length === 1 ? "" : "s"} loaded.`,
    )}${rows.length ? renderTable(["board", "direction", "period", "completed-only", "adapter"], rows) : banner("No boards loaded.", "warn")}`;
    return reply.type("text/html").send(shell("Boards", body, nav("/admin/games")));
  });

  app.get<{ Params: { gameId: string; boardId: string } }>(
    "/admin/games/:gameId/boards/:boardId",
    async (request, reply) => {
      const runtime = runtimes.get(request.params.gameId);
      if (!runtime) return reply.code(404).type("text/plain").send("game not found");
      let board: BoardDefinition | undefined;
      let adapterId: string | undefined;
      for (const adapter of runtime.adapters.values()) {
        const found = adapter.boards.find((candidate) => candidate.id === request.params.boardId);
        if (found) {
          board = found;
          adapterId = adapter.id;
          break;
        }
      }
      if (!board) return reply.code(404).type("text/plain").send("board not found");
      const periodKey = board.period === "all_time" ? "all_time" : new Date().toISOString().slice(0, 10);
      const rows = runtime.db.list(board, periodKey, 0, 50);
      const tableRows: { html: string; label: string; numeric?: boolean }[][] = rows.map((entry) => [
        { html: String(entry.rank), label: "rank", numeric: true },
        { html: escapeHtml(entry.displayName), label: "player" },
        { html: String(entry.value), label: "value", numeric: true },
      ]);
      const foot = `Showing ${rows.length === 50 ? "up to 50" : rows.length} entries · period ${escapeHtml(periodKey)}`;
      const body = `${gameSubnav(runtime.game.id, "boards")}${pageHead(
        board.id,
        `${runtime.game.displayName} · ${adapterId ?? "?"} · ${board.direction} · ${board.period}${board.completedOnly ? " · completed-only" : ""}`,
      )}
      ${tableRows.length ? renderTable(["rank", "player", "value"], tableRows, foot) : banner("No scores yet for this period.", "warn", "Empty board")}`;
      return reply.type("text/html").send(shell(board.id, body, nav("/admin/games")));
    },
  );

  // ─── Runs ────────────────────────────────────────────────────────────────────

  app.get<{ Params: { gameId: string } }>("/admin/games/:gameId/runs", async (request, reply) => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    const recent = runtime.db.recentRuns(20);
    const rows = recent.map(
      (run: { runId: string; adapterId: string; createdAt: Date; payloadHash: string }) => [
        { html: `<code>${escapeHtml(run.runId)}</code>`, label: "runId" },
        { html: `<code>${escapeHtml(run.adapterId)}</code>`, label: "adapter" },
        { html: escapeHtml(run.createdAt.toISOString()), label: "createdAt" },
        {
          html: `<code title="${escapeHtml(run.payloadHash)}">${escapeHtml(run.payloadHash.slice(0, 16))}…</code>`,
          label: "payloadHash",
        },
      ],
    );
    const body = `${gameSubnav(runtime.game.id, "runs")}${pageHead(
      `Runs · ${runtime.game.displayName}`,
      "Last 20. Payload bodies are redacted; only the payload hash is shown so you can spot duplicates without exposing player data.",
    )}${rows.length ? renderTable(["runId", "adapter", "createdAt", "payloadHash"], rows) : banner("No runs recorded.", "warn")}`;
    return reply.type("text/html").send(shell("Runs", body, nav("/admin/games")));
  });

  // ─── Players (list + delete) ─────────────────────────────────────────────────

  app.get<{ Params: { gameId: string } }>("/admin/games/:gameId/players", async (request, reply) => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    const players = runtime.db.listPlayers(200);
    const rows = players.map((player) => [
      {
        html: `<code title="${escapeHtml(player.id)}">${escapeHtml(truncateId(player.id))}</code>`,
        label: "id",
      },
      { html: badge(player.provider), label: "provider" },
      {
        html: `<a href="/admin/games/${escapeHtml(runtime.game.id)}/players/${encodeURIComponent(player.id)}">${escapeHtml(player.displayName)}</a>`,
        label: "display name",
      },
      { html: escapeHtml(new Date(player.createdAt).toISOString()), label: "created (UTC)" },
      {
        html: `<form method="post" action="/admin/games/${escapeHtml(runtime.game.id)}/players/delete">
          <input type="hidden" name="playerId" value="${escapeHtml(player.id)}">
          ${confirmAction("Delete player", true)}
        </form>`,
        label: "actions",
      },
    ]);
    const body = `${gameSubnav(runtime.game.id, "players")}${pageHead(
      `Players · ${runtime.game.displayName}`,
      `Most recent ${players.length} of this game. Delete removes the player row, refresh sessions, leaderboard entries, runs, and economy data. Audit log captures the operator and truncated id.`,
    )}
    ${players.length ? renderTable(["id", "provider", "display name", "created (UTC)", "actions"], rows) : banner("No players have signed into this game yet.", "warn", "Empty")}`;
    return reply.type("text/html").send(shell("Players", body, nav("/admin/games")));
  });

  app.post<{ Params: { gameId: string }; Body: { playerId?: string } }>(
    "/admin/games/:gameId/players/delete",
    async (request, reply) => {
      const runtime = runtimes.get(request.params.gameId);
      if (!runtime) return reply.code(404).type("text/plain").send("game not found");
      const playerId = typeof request.body?.playerId === "string" ? request.body.playerId : "";
      if (!playerId) return reply.code(400).type("text/plain").send("playerId required");
      const removed = runtime.db.deletePlayer(playerId);
      // Audit log: admin username (truncated) + truncated player id + timestamp.
      // Never include the provider subject or the raw provider id.
      const adminId = (request as unknown as { adminId?: string }).adminId ?? "?";
      const adminRow = adminDb.findAdminById(adminId);
      request.log.info(
        {
          admin: adminRow ? adminRow.username : "?",
          game: runtime.game.id,
          playerIdPrefix: truncateId(playerId),
          removed,
          ts: Date.now(),
        },
        "admin deleted player",
      );
      return reply.redirect(`/admin/games/${encodeURIComponent(runtime.game.id)}/players`, 302);
    },
  );

  app.get<{ Params: { gameId: string; playerId: string } }>(
    "/admin/games/:gameId/players/:playerId",
    async (request, reply) => {
      const runtime = runtimes.get(request.params.gameId);
      if (!runtime) return reply.code(404).type("text/plain").send("game not found");
      const player = runtime.db.getPlayer(request.params.playerId);
      if (!player) return reply.code(404).type("text/plain").send("player not found");
      const saveError = new URL(request.url, "http://admin.local").searchParams.get("error");
      const wallet = runtime.db.getWallet(player.id);
      const ledger = runtime.db.listWalletTransactions(player.id, 50);
      const inventory = runtime.db.getInventory(player.id);
      const purchases = runtime.db.listStorePurchases(player.id, 50);
      const iaps = runtime.db.listIapPurchases(player.id, 50);
      const walletRows = wallet.map((row) => [
        { html: `<code>${escapeHtml(row.currencyId)}</code>`, label: "currency" },
        { html: String(row.balance), label: "balance", numeric: true },
      ]);
      const ledgerRows = ledger.map((row) => [
        { html: escapeHtml(new Date(row.createdAt).toISOString()), label: "when" },
        { html: `<code>${escapeHtml(row.currencyId)}</code>`, label: "currency" },
        { html: String(row.amount), label: "amount", numeric: true },
        { html: String(row.balanceAfter), label: "after", numeric: true },
        { html: `<code>${escapeHtml(row.reason)}</code>`, label: "reason" },
      ]);
      const inventoryRows = inventory.map((row) => [
        { html: `<code>${escapeHtml(row.itemId)}</code>`, label: "item" },
        { html: String(row.quantity), label: "qty", numeric: true },
      ]);
      const purchaseRows = purchases.map((row) => [
        { html: `<code>${escapeHtml(row.offerId)}</code>`, label: "offer" },
        { html: `<code>${escapeHtml(row.itemId)}</code>`, label: "item" },
        { html: `${row.priceAmount} ${escapeHtml(row.currencyId)}`, label: "price" },
        { html: escapeHtml(new Date(row.createdAt).toISOString()), label: "when" },
      ]);
      const iapRows = iaps.map((row) => [
        { html: `<code>${escapeHtml(row.productId)}</code>`, label: "product" },
        { html: badge(row.verificationState), label: "verified" },
        { html: badge(row.fulfillmentState), label: "fulfilled" },
        { html: badge(row.acknowledgeState), label: "ack" },
        { html: escapeHtml(new Date(row.createdAt).toISOString()), label: "when" },
      ]);
      const action = `/admin/games/${escapeHtml(runtime.game.id)}/players/${encodeURIComponent(player.id)}`;
      const currencies = currencyOptions(runtime.game.economy);
      const items = itemOptions(runtime.game.economy);
      const currencyForm = currencies
        ? `<form class="form" method="post" action="${action}/currency">
          ${field("Currency", `<select name="currencyId" required>${currencies}</select>`, "", true)}
          ${field("Amount", '<input type="number" name="amount" required min="1" step="1">', "Positive integer. Debit uses the same field.", true)}
          ${field("Direction", '<select name="direction"><option value="credit">Credit</option><option value="debit">Debit</option></select>')}
          ${field("Idempotency key", `<input type="text" name="requestId" required maxlength="128" value="admin-${randomUUID()}">`, "", true)}
          <div class="form-actions"><button type="submit" class="btn primary">Apply currency</button></div>
        </form>`
        : banner("No currencies in the catalog. Add them on the Manifest page.", "warn");
      const itemForm = items
        ? `<form class="form" method="post" action="${action}/item">
          ${field("Item", `<select name="itemId" required>${items}</select>`, "Must exist in the game catalog.", true)}
          ${field("Quantity", '<input type="number" name="quantity" required min="1" step="1" value="1">', "", true)}
          ${field("Direction", '<select name="direction"><option value="grant">Grant</option><option value="remove">Remove</option></select>')}
          ${field("Idempotency key", `<input type="text" name="requestId" required maxlength="128" value="admin-${randomUUID()}">`, "", true)}
          <div class="form-actions"><button type="submit" class="btn primary">Apply item</button></div>
        </form>`
        : banner("No items in the catalog. Add them on the Manifest page.", "warn");
      const body = `${gameSubnav(runtime.game.id, "players")}${pageHead(
        player.displayName,
        `Economy for ${truncateId(player.id)}. Manual changes write the same ledger as player operations. Purchase tokens are never shown.`,
      )}
      ${saveError ? banner(escapeHtml(saveError), "bad", "Could not apply") : ""}
      <section class="card">
        <h3>Wallet</h3>
        ${walletRows.length ? renderTable(["currency", "balance"], walletRows) : banner("No balances yet.", "warn")}
      </section>
      <section class="card">
        <h3>Ledger</h3>
        ${ledgerRows.length ? renderTable(["when", "currency", "amount", "after", "reason"], ledgerRows) : banner("No wallet transactions.", "warn")}
      </section>
      <section class="card">
        <h3>Inventory</h3>
        ${inventoryRows.length ? renderTable(["item", "qty"], inventoryRows) : banner("Inventory is empty.", "warn")}
      </section>
      <section class="card">
        <h3>Store purchases</h3>
        ${purchaseRows.length ? renderTable(["offer", "item", "price", "when"], purchaseRows) : banner("No store purchases.", "warn")}
      </section>
      <section class="card">
        <h3>IAP</h3>
        ${iapRows.length ? renderTable(["product", "verified", "fulfilled", "ack", "when"], iapRows) : banner("No IAP records.", "warn")}
      </section>
      <section class="card">
        <h3>Adjust currency</h3>
        ${currencyForm}
      </section>
      <section class="card">
        <h3>Adjust inventory</h3>
        ${itemForm}
      </section>`;
      return reply.type("text/html").send(shell(player.displayName, body, nav("/admin/games")));
    },
  );

  const playerEconomyRedirect = (gameId: string, playerId: string, error?: string) =>
    `/admin/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(playerId)}${error ? `?error=${encodeURIComponent(error)}` : ""}`;

  app.post<{
    Params: { gameId: string; playerId: string };
    Body: { currencyId?: string; amount?: string; direction?: string; requestId?: string };
  }>("/admin/games/:gameId/players/:playerId/currency", async (request, reply) => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    const playerId = request.params.playerId;
    if (!runtime.db.getPlayer(playerId)) return reply.code(404).type("text/plain").send("player not found");
    try {
      const currencyId = typeof request.body?.currencyId === "string" ? request.body.currencyId : "";
      catalogCurrency(runtime.game.economy, currencyId);
      const amount = Number(request.body?.amount);
      const requestId = typeof request.body?.requestId === "string" ? request.body.requestId : "";
      const direction = request.body?.direction === "debit" ? "debit" : "credit";
      if (direction === "debit")
        runtime.db.debitCurrency(playerId, currencyId, amount, "admin_adjustment", requestId, Date.now());
      else runtime.db.creditCurrency(playerId, currencyId, amount, "admin_adjustment", requestId, Date.now());
      request.log.info(
        {
          admin: (request as unknown as { adminId?: string }).adminId ?? "?",
          game: runtime.game.id,
          playerIdPrefix: truncateId(playerId),
          action: `currency-${direction}`,
          ts: Date.now(),
        },
        "admin adjusted currency",
      );
      return reply.redirect(playerEconomyRedirect(runtime.game.id, playerId), 302);
    } catch (error) {
      const message = error instanceof BantamError ? error.message : "Currency adjustment failed";
      return reply.redirect(playerEconomyRedirect(runtime.game.id, playerId, message), 302);
    }
  });

  app.post<{
    Params: { gameId: string; playerId: string };
    Body: { itemId?: string; quantity?: string; direction?: string; requestId?: string };
  }>("/admin/games/:gameId/players/:playerId/item", async (request, reply) => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    const playerId = request.params.playerId;
    if (!runtime.db.getPlayer(playerId)) return reply.code(404).type("text/plain").send("player not found");
    try {
      const itemId = typeof request.body?.itemId === "string" ? request.body.itemId : "";
      const quantity = Number(request.body?.quantity);
      const requestId = typeof request.body?.requestId === "string" ? request.body.requestId : "";
      const item = catalogItem(runtime.game.economy, itemId);
      if (request.body?.direction === "remove")
        runtime.db.consumeItem(playerId, item, quantity, "admin_adjustment", requestId, Date.now());
      else runtime.db.grantItem(playerId, item, quantity, "admin_adjustment", requestId, Date.now());
      request.log.info(
        {
          admin: (request as unknown as { adminId?: string }).adminId ?? "?",
          game: runtime.game.id,
          playerIdPrefix: truncateId(playerId),
          action: request.body?.direction === "remove" ? "item-remove" : "item-grant",
          ts: Date.now(),
        },
        "admin adjusted inventory",
      );
      return reply.redirect(playerEconomyRedirect(runtime.game.id, playerId), 302);
    } catch (error) {
      const message = error instanceof BantamError ? error.message : "Inventory adjustment failed";
      return reply.redirect(playerEconomyRedirect(runtime.game.id, playerId, message), 302);
    }
  });

  // ─── Adapters ────────────────────────────────────────────────────────────────

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
      { html: `<code>${escapeHtml(a.id)}</code>`, label: "id" },
      { html: `<code>${escapeHtml(a.version)}</code>`, label: "version" },
      { html: String(a.boards.length), label: "boards", numeric: true },
      {
        html:
          (usage.get(a.id) ?? []).map((g) => `<code>${escapeHtml(g)}</code>`).join(", ") ||
          '<span class="muted">—</span>',
        label: "games",
      },
    ]);
    const body = `${pageHead(
      "Adapters",
      "Every adapter currently loaded by the runtime. `boards` is the number of declared boards; `games` lists the games that reference this adapter.",
    )}${renderTable(["id", "version", "boards", "games"], rows)}`;
    return reply.type("text/html").send(shell("Adapters", body, nav("/admin/adapters")));
  });

  // ─── Health ──────────────────────────────────────────────────────────────────

  app.get("/admin/health", async (_request, reply) => {
    const allowedOrigins = (process.env.BANTAM_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const cors = allowedOrigins.length
      ? `<ul style="margin:0.25rem 0;padding-left:1.25rem">${allowedOrigins.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join("")}</ul>`
      : '<p class="muted">No origins configured — same-origin only.</p>';
    const rows: { html: string; label: string; numeric?: boolean }[][] = [...runtimes.entries()].map(
      ([id, runtime]) => {
        const ready = runtime.db.ready();
        const total = runtime.game.adapters.length;
        const loaded = runtime.adapters.size;
        const envKeys = requiredEnvKeys(runtime.game);
        const presence = envPresence(envKeys);
        const allEnv = envKeys.every((key) => presence[key]);
        return [
          { html: `<a href="/admin/games/${escapeHtml(id)}">${escapeHtml(id)}</a>`, label: "game" },
          { html: badge(ready ? "ready" : "starting", ready ? "ok" : "bad"), label: "db" },
          { html: `${loaded} / ${total}`, label: "adapters", numeric: true },
          { html: badge(allEnv ? "env ok" : "env missing", allEnv ? "ok" : "warn"), label: "env" },
        ];
      },
    );
    const body = `${pageHead(
      "Health",
      "Per-game readiness, adapter coverage, env completeness, and the CORS origin list (read-only — restart the host to change).",
    )}
      ${rows.length ? renderTable(["game", "db", "adapters", "env"], rows) : banner("No games loaded yet.", "warn")}
      <section class="card">
        <h3>CORS (read-only)</h3>
        <p class="muted">Set <code>BANTAM_ALLOWED_ORIGINS</code> on the host to change. Edited only by restarting the container.</p>
        ${cors}
      </section>`;
    return reply.type("text/html").send(shell("Health", body, nav("/admin/health")));
  });

  // ─── Feature flags ──────────────────────────────────────────────────────────

  app.get<{ Params: { gameId: string } }>("/admin/games/:gameId/flags", async (request, reply) => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    const saveError = new URL(request.url, "http://admin.local").searchParams.get("error");
    const rows = runtime.db.listFlags();
    const tableRows = rows.map((flag) => [
      { html: `<code>${escapeHtml(flag.key)}</code>`, label: "key" },
      {
        html: flag.description ? escapeHtml(flag.description) : '<span class="muted">—</span>',
        label: "description",
      },
      {
        html: badge(flag.enabled ? "enabled" : "disabled", flag.enabled ? "ok" : "neutral"),
        label: "state",
      },
      { html: `${flag.rolloutPercent}%`, label: "rollout", numeric: true },
      {
        html: flag.value ? `<code>${escapeHtml(flag.value)}</code>` : '<span class="muted">—</span>',
        label: "value",
      },
      { html: escapeHtml(new Date(flag.updatedAt).toISOString()), label: "updated" },
      {
        html: `<div class="row-actions">
          <form method="post" action="/admin/games/${escapeHtml(runtime.game.id)}/flags/toggle" style="display:inline">
            <input type="hidden" name="key" value="${escapeHtml(flag.key)}">
            <button type="submit" class="btn ghost small">${flag.enabled ? "Disable" : "Enable"}</button>
          </form>
          <a class="btn ghost small" href="/admin/games/${escapeHtml(runtime.game.id)}/flags/${encodeURIComponent(flag.key)}">Edit</a>
          <form method="post" action="/admin/games/${escapeHtml(runtime.game.id)}/flags/delete" style="display:inline">
            <input type="hidden" name="key" value="${escapeHtml(flag.key)}">
            ${confirmAction("Delete", true)}
          </form>
        </div>`,
        label: "actions",
      },
    ]);
    const body = `${gameSubnav(runtime.game.id, "flags")}${pageHead(
      `Flags · ${runtime.game.displayName}`,
      `${rows.length} flag${rows.length === 1 ? "" : "s"} (max ${FLAG_MAX}). Clients read flags from GET /v1/games/${runtime.game.id}/flags; only operators change them.`,
    )}
      ${saveError ? banner(escapeHtml(saveError), "bad", "Could not save") : ""}
      <section class="card">
        <h3>Existing flags</h3>
        ${
          tableRows.length
            ? renderTable(
                ["key", "description", "state", "rollout", "value", "updated", "actions"],
                tableRows,
              )
            : banner("No flags defined for this game yet.", "warn", "No flags")
        }
      </section>
      <section class="card">
        <h3>Create or replace a flag</h3>
        <form class="form" method="post" action="/admin/games/${escapeHtml(runtime.game.id)}/flags">
          ${field(
            "Key",
            '<input type="text" name="key" required maxlength="64" pattern="[a-z0-9][a-z0-9._-]*" placeholder="daily_challenge">',
            "Lowercase letters, digits, dot, dash, underscore. Starts with a letter or digit.",
            true,
          )}
          ${field(
            "Description",
            `<input type="text" name="description" maxlength="${FLAG_DESCRIPTION_MAX}">`,
            "Operator-facing note. Never shown to clients.",
          )}
          ${field(
            "Value (optional)",
            `<input type="text" name="value" maxlength="${FLAG_VALUE_MAX}">`,
            "Short string delivered to clients only when the flag resolves on for that caller. Not a secret.",
          )}
          ${field(
            "Rollout percent",
            '<input type="number" name="rolloutPercent" value="100" min="0" max="100">',
            "0-100. Below 100 resolves per signed-in player; anonymous callers see only flags at 100%.",
          )}
          ${field(
            "Enabled",
            '<div class="checkbox-row"><input type="checkbox" name="enabled" value="true" checked><span>Enabled on create</span></div>',
          )}
          <div class="form-actions">
            <button type="submit" class="btn primary">Save flag</button>
          </div>
        </form>
      </section>`;
    return reply.type("text/html").send(shell("Flags", body, nav("/admin/games")));
  });

  app.get<{ Params: { gameId: string; key: string } }>(
    "/admin/games/:gameId/flags/:key",
    async (request, reply) => {
      const runtime = runtimes.get(request.params.gameId);
      if (!runtime) return reply.code(404).type("text/plain").send("game not found");
      const flag = runtime.db.getFlag(request.params.key);
      if (!flag) return reply.code(404).type("text/plain").send("flag not found");
      const body = `${gameSubnav(runtime.game.id, "flags")}${pageHead(
        flag.key,
        `${runtime.game.displayName} · updated ${new Date(flag.updatedAt).toISOString()}`,
      )}
      <section class="card">
        <form class="form" method="post" action="/admin/games/${escapeHtml(runtime.game.id)}/flags/${encodeURIComponent(flag.key)}">
          <input type="hidden" name="key" value="${escapeHtml(flag.key)}">
          ${field("Key", `<input type="text" value="${escapeHtml(flag.key)}" readonly>`)}
          ${field("Description", `<input type="text" name="description" maxlength="${FLAG_DESCRIPTION_MAX}" value="${escapeHtml(flag.description)}">`)}
          ${field("Value", `<input type="text" name="value" maxlength="${FLAG_VALUE_MAX}" value="${escapeHtml(flag.value ?? "")}">`)}
          ${field("Rollout percent", `<input type="number" name="rolloutPercent" value="${flag.rolloutPercent}" min="0" max="100">`)}
          ${field("Enabled", `<div class="checkbox-row"><input type="checkbox" name="enabled" value="true"${flag.enabled ? " checked" : ""}><span>Enabled</span></div>`)}
          <div class="form-actions">
            <button type="submit" class="btn primary">Save changes</button>
          </div>
        </form>
      </section>`;
      return reply.type("text/html").send(shell(flag.key, body, nav("/admin/games")));
    },
  );

  // Shared parse for every flag write. Rejects malformed operator input before
  // it reaches SQLite so a bad paste can't silently become a broken flag.
  const flagFromBody = (
    body: Record<string, unknown> | undefined,
    overrides?: Partial<{ key: string; enabled: boolean }>,
  ): { key: string; description: string; value: string | null; rolloutPercent: number; enabled: boolean } => {
    const key = overrides?.key ?? (typeof body?.["key"] === "string" ? body["key"].trim() : "");
    if (!isValidFlagKey(key))
      throw new BantamError("invalid-flag", "Flag key must match ^[a-z0-9][a-z0-9._-]{0,63}$", 400);
    const description =
      typeof body?.["description"] === "string"
        ? body["description"].trim().slice(0, FLAG_DESCRIPTION_MAX)
        : "";
    const rawValue = typeof body?.["value"] === "string" ? body["value"].trim() : "";
    let rolloutPercent: number;
    try {
      rolloutPercent = parseRolloutPercent(body?.["rolloutPercent"]);
    } catch (error) {
      throw new BantamError(
        "invalid-flag",
        error instanceof Error ? error.message : "Rollout percent must be an integer 0-100",
        400,
      );
    }
    return {
      key,
      description,
      value: rawValue ? rawValue.slice(0, FLAG_VALUE_MAX) : null,
      rolloutPercent,
      enabled: overrides?.enabled ?? body?.["enabled"] === "true",
    };
  };

  const flagRedirect = (gameId: string) => `/admin/games/${encodeURIComponent(gameId)}/flags`;

  const handleFlagWrite = (
    request: { body?: unknown; params: { gameId: string }; log: { info: (o: unknown, m: string) => void } },
    reply: import("fastify").FastifyReply,
    apply: (runtime: Runtime, parsed: ReturnType<typeof flagFromBody>) => void,
    action: string,
    keyOverride?: string,
  ): import("fastify").FastifyReply => {
    const runtime = runtimes.get(request.params.gameId);
    if (!runtime) return reply.code(404).type("text/plain").send("game not found");
    let parsed: ReturnType<typeof flagFromBody>;
    try {
      parsed = flagFromBody(
        request.body as Record<string, unknown> | undefined,
        keyOverride ? { key: keyOverride } : undefined,
      );
      apply(runtime, parsed);
    } catch (error) {
      if (error instanceof BantamError && error.statusCode === 404) {
        return reply.code(404).type("text/plain").send(error.message);
      }
      const message = error instanceof BantamError ? error.message : String(error);
      return reply.redirect(`${flagRedirect(runtime.game.id)}?error=${encodeURIComponent(message)}`, 302);
    }
    request.log.info(
      {
        admin: (request as unknown as { adminId?: string }).adminId ?? "?",
        game: runtime.game.id,
        flag: parsed.key,
        action,
        enabled: parsed.enabled,
        rolloutPercent: parsed.rolloutPercent,
        ts: Date.now(),
      },
      "admin changed feature flag",
    );
    return reply.redirect(flagRedirect(runtime.game.id), 302);
  };

  app.post<{ Params: { gameId: string } }>("/admin/games/:gameId/flags", async (request, reply) =>
    handleFlagWrite(
      request,
      reply,
      (runtime, parsed) => {
        runtime.db.upsertFlag(parsed, Date.now());
      },
      "upsert",
    ),
  );

  app.post<{ Params: { gameId: string; key: string } }>(
    "/admin/games/:gameId/flags/:key",
    async (request, reply) =>
      handleFlagWrite(
        request,
        reply,
        (runtime, parsed) => {
          if (!runtime.db.getFlag(request.params.key)) {
            throw new BantamError("flag-not-found", "flag not found", 404);
          }
          runtime.db.upsertFlag({ ...parsed, key: request.params.key }, Date.now());
        },
        "update",
        request.params.key,
      ),
  );

  app.post<{ Params: { gameId: string }; Body: { key?: string } }>(
    "/admin/games/:gameId/flags/toggle",
    async (request, reply) => {
      const runtime = runtimes.get(request.params.gameId);
      if (!runtime) return reply.code(404).type("text/plain").send("game not found");
      const key = typeof request.body?.["key"] === "string" ? request.body["key"] : "";
      const existing = runtime.db.getFlag(key);
      if (!existing) return reply.code(404).type("text/plain").send("flag not found");
      runtime.db.upsertFlag(
        {
          key: existing.key,
          description: existing.description,
          enabled: !existing.enabled,
          rolloutPercent: existing.rolloutPercent,
          value: existing.value,
        },
        Date.now(),
      );
      request.log.info(
        {
          admin: (request as unknown as { adminId?: string }).adminId ?? "?",
          game: runtime.game.id,
          flag: key,
          action: "toggle",
          enabled: !existing.enabled,
          rolloutPercent: existing.rolloutPercent,
          ts: Date.now(),
        },
        "admin toggled feature flag",
      );
      return reply.redirect(flagRedirect(runtime.game.id), 302);
    },
  );

  app.post<{ Params: { gameId: string }; Body: { key?: string } }>(
    "/admin/games/:gameId/flags/delete",
    async (request, reply) => {
      const runtime = runtimes.get(request.params.gameId);
      if (!runtime) return reply.code(404).type("text/plain").send("game not found");
      const key = typeof request.body?.["key"] === "string" ? request.body["key"] : "";
      if (!isValidFlagKey(key)) return reply.code(400).type("text/plain").send("invalid flag key");
      if (!runtime.db.getFlag(key)) return reply.code(404).type("text/plain").send("flag not found");
      runtime.db.deleteFlag(key);
      request.log.info(
        {
          admin: (request as unknown as { adminId?: string }).adminId ?? "?",
          game: runtime.game.id,
          flag: key,
          action: "delete",
          ts: Date.now(),
        },
        "admin deleted feature flag",
      );
      return reply.redirect(flagRedirect(runtime.game.id), 302);
    },
  );

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
            `${pageHead("Manifest", "")}${banner(`Cannot read manifest: ${escapeHtml(loaded.error)}`, "bad")}`,
            nav("/admin/manifest"),
          ),
        );
    }
    const bannerHtml = justSaved
      ? banner("Saved. Runtime reloaded.", "ok", "Success")
      : loaded.writable
        ? ""
        : banner(
            `Manifest path <code>${escapeHtml(loaded.path)}</code> is read-only. The editor below is disabled. To edit via the UI, leave BANTAM_CONFIG_FILE unset and mount /data writable.`,
            "warn",
            "Read-only manifest",
          );
    const editorDisabled = loaded.writable ? "" : "disabled";
    const manifest = loaded.manifest;
    const gameFields = manifest.games.length
      ? `<div class="game-grid">${manifest.games
          .map((game, index) => {
            const adapters = game.adapters as AdapterSpec[];
            const adapterLines = adapters
              .map((spec, i) => {
                if (spec.kind === "generic") {
                  const boards = spec.boards
                    .map(
                      (board) =>
                        `<code>${escapeHtml(board.id)}</code> · ${escapeHtml(board.direction)} · ${escapeHtml(board.period)}${board.completedOnly ? " · completed-only" : ""}`,
                    )
                    .join(", ");
                  return `<li><span class="muted">adapter ${i + 1}</span> · <code>generic</code> — ${boards || "<em>(no boards)</em>"}</li>`;
                }
                return `<li><span class="muted">adapter ${i + 1}</span> · <code>file</code> — source <code>${escapeHtml(spec.source)}</code></li>`;
              })
              .join("");
            const authOptions =
              manifest.environment === "production"
                ? `<option value="pgs-v2"${game.authProvider === "pgs-v2" ? " selected" : ""}>pgs-v2</option>`
                : `<option value="development"${game.authProvider === "development" ? " selected" : ""}>development</option><option value="pgs-v2"${game.authProvider === "pgs-v2" ? " selected" : ""}>pgs-v2</option>`;
            return `<fieldset class="game">
            <legend>${escapeHtml(game.id)}</legend>
            ${field("Game id", `<input type="text" name="game[${index}].id" value="${escapeHtml(game.id)}" readonly>`)}
            ${field("Display name", `<input type="text" name="game[${index}].displayName" value="${escapeHtml(game.displayName)}" required>`)}
            ${field("Auth provider", `<select name="game[${index}].authProvider">${authOptions}</select>`)}
            ${field("Grace period (hours)", `<input type="number" name="game[${index}].gracePeriodHours" value="${game.gracePeriodHours}" min="0" max="168">`)}
            ${field(
              "Secret prefix",
              `<input type="text" name="game[${index}].secretPrefix" value="${escapeHtml(game.secretPrefix)}" pattern="[A-Z][A-Z0-9_]{1,47}" title="Uppercase letters, digits, underscore. 2-48 chars, starts with letter.">`,
            )}
            <div class="field">
              <label>Adapters (read-only here)</label>
              <ul style="margin:0.25rem 0;padding-left:1.25rem">${adapterLines || '<li class="muted">(none)</li>'}</ul>
            </div>
            <div class="field">
              <label>Economy catalog</label>
              ${renderEconomyFields(index, game.economy, editorDisabled)}
            </div>
          </fieldset>`;
          })
          .join("")}</div>`
      : banner(
          "No games in the manifest yet. Use Advanced JSON to add the first game, or seed one via the deployment manifest.",
          "warn",
          "Empty manifest",
        );
    const productionWarning =
      manifest.environment === "production"
        ? banner(
            "Production environment: <code>development</code> auth is rejected. Saved manifest must keep all games on <code>pgs-v2</code>.",
            "warn",
            "Production guard",
          )
        : "";
    const meta = `<div class="btn-row" style="margin-bottom:1rem">
      <span class="muted">Source</span> <code>${escapeHtml(loaded.path)}</code>
      ${badge(loaded.writable ? "writable" : "read-only", loaded.writable ? "ok" : "warn")}
    </div>`;
    const body = `${pageHead(
      "Manifest",
      "Edit existing fields and the economy catalog inline. Adding or removing games requires Advanced JSON.",
      `<span class="muted">last save: ${loaded.writable ? "live reload" : "read-only"}</span>`,
    )}
      ${meta}
      ${bannerHtml}
      ${productionWarning}
      <form class="form wide" method="post" action="/admin/manifest">
        ${field(
          "Environment",
          `<select name="environment" ${editorDisabled}>
            <option value="development"${manifest.environment === "development" ? " selected" : ""}>development</option>
            <option value="test"${manifest.environment === "test" ? " selected" : ""}>test</option>
            <option value="production"${manifest.environment === "production" ? " selected" : ""}>production</option>
          </select>`,
        )}
        <div class="field">
          <label>Games</label>
          ${gameFields}
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary" ${editorDisabled}>Save & reload</button>
          <a class="btn ghost" href="/admin/health">Check health</a>
        </div>
      </form>
      <details class="disclosure">
        <summary>Advanced JSON</summary>
        <div class="body">
          <p class="muted">Use this to add or remove games, or to edit adapter specs (which the form does not expose). Catalog types also live in the form above.</p>
          <form class="form wide" method="post" action="/admin/manifest">
            ${field("Manifest JSON", `<textarea name="manifest" spellcheck="false" ${editorDisabled}>${escapeHtml(loaded.raw)}</textarea>`)}
            <div class="form-actions">
              <button type="submit" class="btn primary" ${editorDisabled}>Save & reload</button>
            </div>
          </form>
        </div>
      </details>
      <p class="muted">Per-game secrets must be supplied as env vars: <code>\${secretPrefix}_IDENTITY_SALT</code>, <code>_SESSION_SECRET</code>, <code>_CURSOR_SECRET</code>, plus <code>_PGS_CLIENT_ID</code> / <code>_PGS_CLIENT_SECRET</code> for <code>pgs-v2</code>. Restart the container after changing them.</p>`;
    return reply.type("text/html").send(shell("Manifest", body, nav("/admin/manifest")));
  });

  app.post("/admin/manifest", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    const manifestTextRaw = typeof body?.["manifest"] === "string" ? body["manifest"] : "";
    let manifest: ManifestFile;
    let saveText: string;
    // Snapshot of the on-disk manifest BEFORE we mutate it. Used to roll back
    // if the reload fails — reading the disk post-save would just give us the
    // new (broken) version back.
    let priorManifest: ManifestFile | undefined;
    if (manifestTextRaw.trim()) {
      // Advanced JSON path: round-trip the operator's exact bytes so
      // ordering/whitespace don't shift between save and re-render.
      let parsed: unknown;
      try {
        parsed = JSON.parse(manifestTextRaw);
      } catch (error) {
        return renderManifestError(reply, nav, [`Invalid JSON: ${String(error)}`]);
      }
      const { Value } = await import("@sinclair/typebox/value");
      const { ManifestSchema } = await import("../config.js");
      if (!Value.Check(ManifestSchema, parsed)) {
        const details = [...Value.Errors(ManifestSchema, parsed)]
          .map((item) => `${item.path}: ${item.message}`)
          .join("; ");
        return renderManifestError(reply, nav, [`Invalid manifest: ${details}`]);
      }
      manifest = parsed;
      const priorLoad = manifestStore.load();
      if (priorLoad.ok) priorManifest = JSON.parse(JSON.stringify(priorLoad.manifest)) as ManifestFile;
      saveText = manifestTextRaw;
    } else {
      // Form path: read the existing manifest, replace targeted fields.
      const loaded = manifestStore.load();
      if (!loaded.ok) return renderManifestError(reply, nav, [`Cannot read manifest: ${loaded.error}`]);
      priorManifest = JSON.parse(JSON.stringify(loaded.manifest)) as ManifestFile;
      manifest = JSON.parse(JSON.stringify(loaded.manifest)) as ManifestFile;
      const envValue = typeof body?.["environment"] === "string" ? body["environment"] : "";
      if (envValue === "development" || envValue === "test" || envValue === "production") {
        manifest.environment = envValue;
      }
      // Per-game fields. Slot N must match the manifest's position so an
      // add/remove doesn't silently drop or duplicate games — operators
      // add or remove via Advanced JSON.
      for (let i = 0; i < manifest.games.length; i++) {
        const game = manifest.games[i];
        if (!game) continue;
        const idRaw = body?.[`game[${i}].id`];
        if (typeof idRaw === "string" && idRaw !== game.id) {
          return renderManifestError(reply, nav, [
            `Game order changed (slot ${i} now references ${idRaw}, expected ${game.id}). Use Advanced JSON to add or remove games.`,
          ]);
        }
        const displayName = body?.[`game[${i}].displayName`];
        if (typeof displayName === "string" && displayName.trim()) game.displayName = displayName.trim();
        const auth = body?.[`game[${i}].authProvider`];
        if (auth === "development" || auth === "pgs-v2") game.authProvider = auth;
        const grace = body?.[`game[${i}].gracePeriodHours`];
        if (typeof grace === "string") {
          const num = Number(grace);
          if (Number.isInteger(num) && num >= 0 && num <= 168) game.gracePeriodHours = num;
        }
        const prefix = body?.[`game[${i}].secretPrefix`];
        if (typeof prefix === "string" && /^[A-Z][A-Z0-9_]{1,47}$/.test(prefix)) {
          game.secretPrefix = prefix;
        }
        try {
          const economy = applyEconomyFromForm(body ?? {}, i, game.economy);
          if (economy.touched) {
            if (economy.catalog) game.economy = economy.catalog;
            else delete game.economy;
          }
        } catch (error) {
          const message = error instanceof BantamError ? error.message : "Invalid economy catalog";
          return renderManifestError(reply, nav, [message]);
        }
      }
      saveText = JSON.stringify(manifest, null, 2);
    }
    const saveResult = manifestStore.save(saveText);
    if (!saveResult.ok) return renderManifestError(reply, nav, saveResult.errors);
    try {
      await reloadRuntimes(manifest);
    } catch (error) {
      // Reload failed: roll the on-disk manifest back to the snapshot we
      // captured before the save so a follow-up save can succeed without an
      // already-bad manifest standing in the way.
      if (priorManifest) {
        try {
          manifestStore.save(JSON.stringify(priorManifest, null, 2));
        } catch {
          // surface the original error regardless
        }
      }
      return reply
        .code(500)
        .type("text/html")
        .send(
          shell(
            "Manifest",
            `${pageHead("Manifest", "")}${banner(`Manifest rolled back: runtime reload failed (${escapeHtml(String(error))}). The on-disk manifest was reverted to the previous version.`, "bad", "Save failed")}
        <p><a href="/admin/manifest">Back to editor</a></p>`,
            nav("/admin/manifest"),
          ),
        );
    }
    return reply.redirect("/admin/manifest?saved=1", 302);
  });
}

async function renderManifestError(
  reply: import("fastify").FastifyReply,
  nav: (active: string) => { href: string; label: string; active?: boolean }[],
  errors: string[],
): Promise<import("fastify").FastifyReply> {
  return reply
    .code(400)
    .type("text/html")
    .send(
      shell(
        "Manifest",
        `${pageHead("Manifest", "")}${errorList(errors)}<p><a class="btn secondary" href="/admin/manifest">Back to editor</a></p>`,
        nav("/admin/manifest"),
      ),
    );
}
