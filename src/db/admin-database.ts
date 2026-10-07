import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { applyMigrations } from "./migrations.js";

export type AdminRow = {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  created_at: number;
  last_login_at: number | null;
};

export type AdminSessionRow = {
  token_hash: string;
  admin_id: string;
  family_id: string;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

export class AdminDatabase {
  readonly db: Database.Database;

  constructor(
    readonly path: string,
    migrationsDirectory: string,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { timeout: 5_000 });
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("wal_autocheckpoint = 1000");
    try {
      applyMigrations(this.db, migrationsDirectory);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  ready(): boolean {
    return (this.db.prepare("SELECT 1 value").pluck().get() as number) === 1;
  }

  countAdmins(): number {
    return (this.db.prepare("SELECT count(*) value FROM admins").pluck().get() as number) ?? 0;
  }

  findAdminByUsername(username: string): AdminRow | undefined {
    return this.db
      .prepare(
        "SELECT id, username, password_hash, password_salt, created_at, last_login_at FROM admins WHERE username=?",
      )
      .get(username) as AdminRow | undefined;
  }

  findAdminById(id: string): AdminRow | undefined {
    return this.db
      .prepare(
        "SELECT id, username, password_hash, password_salt, created_at, last_login_at FROM admins WHERE id=?",
      )
      .get(id) as AdminRow | undefined;
  }

  insertAdmin(id: string, username: string, passwordHash: string, passwordSalt: string, now: number): void {
    this.db
      .prepare(
        "INSERT INTO admins(id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, username, passwordHash, passwordSalt, now);
  }

  updateAdminLastLogin(id: string, now: number): void {
    this.db.prepare("UPDATE admins SET last_login_at=? WHERE id=?").run(now, id);
  }

  insertSession(tokenHash: string, adminId: string, familyId: string, expiresAt: number, now: number): void {
    this.db
      .prepare(
        "INSERT INTO admin_sessions(token_hash, admin_id, family_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(tokenHash, adminId, familyId, expiresAt, now);
  }

  findSession(tokenHash: string): AdminSessionRow | undefined {
    return this.db
      .prepare(
        "SELECT token_hash, admin_id, family_id, expires_at, used_at, revoked_at, created_at FROM admin_sessions WHERE token_hash=?",
      )
      .get(tokenHash) as AdminSessionRow | undefined;
  }

  revokeSession(tokenHash: string, now: number): void {
    this.db
      .prepare("UPDATE admin_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL")
      .run(now, tokenHash);
  }

  revokeSessionFamily(familyId: string, now: number): void {
    this.db
      .prepare("UPDATE admin_sessions SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL")
      .run(now, familyId);
  }
}
