import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";

// Serves the built React admin console (packages/admin-ui) under /admin/.
// The bundle is a build artifact of the image, not user input: only
// pre-built files inside the resolved root are ever served.

export const ADMIN_UI_PREFIX = "/admin/console";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

// The console is built into <repo>/dist/admin-ui for a normal build and
// served from dist/admin-ui in the container image. BANTAM_ADMIN_UI_DIR
// overrides the location.
export function resolveAdminUiRoot(): string | null {
  const candidates = [
    process.env["BANTAM_ADMIN_UI_DIR"],
    // dist/admin/spa.js -> dist/admin-ui (container + built server)
    fileURLToPath(new URL("../admin-ui", import.meta.url)),
    // src/admin/spa.ts -> <repo>/dist/admin-ui (local development)
    fileURLToPath(new URL("../../dist/admin-ui", import.meta.url)),
    // <repo>/packages/admin-ui/dist (package built in place)
    fileURLToPath(new URL("../../packages/admin-ui/dist", import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const root = resolve(candidate);
    if (existsSync(resolve(root, "index.html"))) return root;
  }
  return null;
}

function etagFor(stats: { size: number; mtimeMs: number }): string {
  return `"${createHash("sha256")
    .update(`${stats.size}:${Math.floor(stats.mtimeMs)}`)
    .digest("hex")
    .slice(0, 32)}"`;
}

function notBuilt(reply: FastifyReply): FastifyReply {
  return reply
    .code(503)
    .type("text/html; charset=utf-8")
    .send(
      `<!doctype html><meta charset="utf-8"><title>Admin console not built</title>` +
        `<h1>Admin console not built</h1>` +
        `<p>The React console is a build artifact. Build it with <code>npm run build:admin-ui</code> ` +
        `(or <code>npm run build</code> for the full image), or set <code>BANTAM_ADMIN_UI_DIR</code> ` +
        `to a directory that contains <code>index.html</code>.</p>` +
        `<p><a href="/admin/login">Log in</a></p>`,
    );
}

export async function registerAdminUi(app: FastifyInstance): Promise<void> {
  const root = resolveAdminUiRoot();

  // Hashed bundle assets. Vite fingerprints every file name, so they are
  // safe to cache forever.
  app.get(`${ADMIN_UI_PREFIX}/assets/*`, async (request, reply) => {
    if (!root) return notBuilt(reply);
    // The wildcard captures the path after /assets/, so it resolves inside
    // the assets directory, not the SPA root.
    const assetsRoot = resolve(root, "assets");
    const relative = (request.params as { "*": string })["*"] ?? "";
    const target = resolve(assetsRoot, relative);
    if (target !== assetsRoot && !target.startsWith(assetsRoot + sep)) {
      return reply.code(404).type("text/plain").send("not found");
    }
    let stats;
    try {
      stats = statSync(target);
    } catch {
      return reply.code(404).type("text/plain").send("not found");
    }
    if (!stats.isFile()) return reply.code(404).type("text/plain").send("not found");
    const etag = etagFor(stats);
    reply.header("etag", etag);
    reply.header("cache-control", "public, max-age=31536000, immutable");
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    reply.header("content-type", MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream");
    return reply.send(readFileSync(target));
  });

  // The console shell. Every client-side route falls back to index.html so
  // deep links survive a page reload.
  const shell = async (_request: unknown, reply: FastifyReply) => {
    if (!root) return notBuilt(reply);
    const index = resolve(root, "index.html");
    reply.header("cache-control", "no-store");
    reply.header("content-type", "text/html; charset=utf-8");
    return reply.send(readFileSync(index));
  };

  // The router runs with `ignoreTrailingSlash`, so `/admin/console` and
  // `/admin/console/` are the same route — registering both is an error.
  app.get(`${ADMIN_UI_PREFIX}/`, shell);
  app.get(`${ADMIN_UI_PREFIX}/*`, shell);
}
