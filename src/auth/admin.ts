import { promisify } from "node:util";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: import("node:crypto").ScryptOptions,
) => Promise<Buffer>;
import type { AdminDatabase } from "../db/admin-database.js";
import { opaqueToken, sha256, safeEqual } from "../util/crypto.js";

// scrypt parameters. N=16384, r=8, p=1 are OWASP minimums for interactive logins
// (kept low so that one login attempt on the slow CPU of a small container
// is <100 ms; revisit when we add a rate limit on /admin/login).
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export type HashedPassword = { hash: string; salt: string };

export async function hashPasswordAsync(plain: string): Promise<HashedPassword> {
  const salt = randomBytes(16).toString("base64");
  const hash = await scryptAsync(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return { hash: hash.toString("base64"), salt };
}

export async function verifyPasswordAsync(plain: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  const candidate = await scryptAsync(plain, parsed.salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  const a = Buffer.from(parsed.hash, "base64");
  const b = candidate;
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseStored(stored: string): { hash: string; salt: string } | null {
  // Format: scrypt$N=<n>,r=<r>,p=<p>$<salt-b64>$<hash-b64>
  const parts = stored.split("$");
  if (parts.length !== 4) return null;
  const [head, paramsStr, salt, hash] = parts;
  if (head !== "scrypt") return null;
  if (!paramsStr || !salt || !hash) return null;
  const params = paramsStr.split(",").reduce<Record<string, number>>((acc, kv) => {
    const eq = kv.indexOf("=");
    if (eq === -1) return acc;
    const k = kv.slice(0, eq);
    const v = kv.slice(eq + 1);
    if (k && v) acc[k] = Number(v);
    return acc;
  }, {});
  if (params.N !== SCRYPT_N || params.r !== SCRYPT_R || params.p !== SCRYPT_P) return null;
  return { salt, hash };
}

export function formatStored({ hash, salt }: HashedPassword): string {
  return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt}$${hash}`;
}

export function generateSessionCookie(): string {
  return opaqueToken(32);
}

export function hashSessionToken(cookie: string): string {
  return sha256(cookie);
}

export type IssuedSession = { cookie: string; expiresAt: number; familyId: string };

export function issueAdminSession(adminDb: AdminDatabase, adminId: string, now = Date.now()): IssuedSession {
  const cookie = generateSessionCookie();
  const familyId = randomUUID();
  const expiresAt = now + SESSION_MS;
  adminDb.insertSession(hashSessionToken(cookie), adminId, familyId, expiresAt, now);
  return { cookie, expiresAt, familyId };
}

export function verifySession(adminDb: AdminDatabase, cookie: string, now = Date.now()): string | null {
  if (!cookie || cookie.length > 256) return null;
  const row = adminDb.findSession(hashSessionToken(cookie));
  if (!row) return null;
  if (row.expires_at <= now) return null;
  if (row.revoked_at !== null) return null;
  return row.admin_id;
}

export function revokeSession(adminDb: AdminDatabase, cookie: string, now = Date.now()): void {
  if (!cookie || cookie.length > 256) return;
  adminDb.revokeSession(hashSessionToken(cookie), now);
}

export function revokeAllForAdmin(adminDb: AdminDatabase, adminId: string, now = Date.now()): void {
  const stmt = adminDb.db.prepare(
    "UPDATE admin_sessions SET revoked_at=? WHERE admin_id=? AND revoked_at IS NULL",
  );
  stmt.run(now, adminId);
}

export function parseUsername(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > 64) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function validatePassword(input: string): string | null {
  if (typeof input !== "string") return null;
  if (input.length < 8) return null;
  if (input.length > 256) return null;
  return input;
}

export const ADMIN_SESSION_MAX_AGE_MS = SESSION_MS;
export const ADMIN_COOKIE_NAME = "bantam_admin";

// Constants used by other modules (kept here for one-stop export).
export { SCRYPT_N, SCRYPT_R, SCRYPT_P };

// Suppress unused warning for safeEqual (might be handy for tests later).
void safeEqual;
