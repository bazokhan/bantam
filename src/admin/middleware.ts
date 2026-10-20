import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdminDatabase } from "../db/admin-database.js";
import { ADMIN_COOKIE_NAME, verifySession } from "../auth/admin.js";

// Routes that must remain reachable without a session cookie.
const PUBLIC_PATHS = new Set(["/admin/login", "/admin/register"]);

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  return false;
}

// Tiny inline cookie parser. Stdlib-free. Cookies are simple enough that
// pulling in a dep just for this is overkill.
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

// Serialize a Set-Cookie header value. We rely on Fastify's reply.header()
// for the actual emission.
export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite ?? "Strict"}`);
  if (options.secure ?? true) parts.push("Secure");
  return parts.join("; ");
}

// The session cookie is scoped to /admin/. A deletion must use the same
// Path, otherwise the browser keeps the original cookie and the operator
// lands in a redirect loop instead of a logged-out state.
export function clearCookieValue(name: string, options: { path?: string; secure?: boolean } = {}): string {
  const parts = [`${name}=`, `Path=${options.path ?? "/admin/"}`, "Max-Age=0", "HttpOnly", "SameSite=Strict"];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

// BANTAM_ADMIN_COOKIE_SECURE overrides the protocol-derived default so an
// operator can force Secure on a TLS-terminating proxy.
export function cookieSecureFor(request: { protocol: string }): boolean {
  const flag = process.env.BANTAM_ADMIN_COOKIE_SECURE;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return request.protocol === "https";
}

// Populate request.cookies on every /admin/* route. Other routes don't need it.
export function cookieHook(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    const url = request.routeOptions.url ?? request.url;
    if (!url.startsWith("/admin")) return;
    const header = request.headers.cookie;
    (request as unknown as { cookies: Record<string, string> }).cookies = parseCookies(header);
  });
}

// Auth middleware: any /admin/* path that is not in PUBLIC_PATHS requires a
// valid session cookie. GET requests redirect to /admin/login with a `next`
// param; POST/PUT/DELETE return 401.
export function sessionCookieMiddleware(adminDb: AdminDatabase) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.routeOptions.url ?? request.url;
    if (!url.startsWith("/admin")) return;
    if (isPublicPath(url)) return;
    const cookies = (request as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    const cookie = cookies[ADMIN_COOKIE_NAME];
    const adminId = cookie ? verifySession(adminDb, cookie) : null;
    if (!adminId) {
      // The JSON API answers with 401 so the console can react instead of
      // silently following a redirect into the login page's HTML.
      if (url.startsWith("/admin/api/")) {
        return reply
          .code(401)
          .type("application/json")
          .send({ error: { code: "unauthorized", message: "Sign in to use the admin API" } });
      }
      if (request.method === "GET") {
        const target = encodeURIComponent(request.url);
        return reply.redirect(`/admin/login?next=${target}`, 302);
      }
      return reply
        .code(401)
        .type("text/html")
        .send(
          `<!doctype html><meta charset="utf-8"><title>Unauthorized</title><p>Unauthorized. <a href="/admin/login">Log in</a>.</p>`,
        );
    }
    (request as unknown as { adminId: string }).adminId = adminId;
  };
}

// For login/register pages: if already authenticated, redirect to the console.
export function redirectIfAuthenticated(adminDb: AdminDatabase) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.routeOptions.url ?? request.url;
    if (url !== "/admin/login" && url !== "/admin/register") return;
    const cookies = (request as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    const cookie = cookies[ADMIN_COOKIE_NAME];
    if (cookie && verifySession(adminDb, cookie)) {
      return reply.redirect("/admin/console/", 302);
    }
  };
}

declare module "fastify" {
  interface FastifyRequest {
    adminId?: string;
  }
}
