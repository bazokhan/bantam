import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { BantamError } from "../errors.js";

type MigrationRow = { version: number; checksum: string };

export function applyMigrations(db: Database.Database, directory: string): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT",
  );
  const names = readdirSync(directory)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();
  const files = names.map((name) => ({ name, version: Number(name.slice(0, 3)) }));
  for (const [index, file] of files.entries()) {
    if (file.version !== index + 1) {
      throw new BantamError("migration-sequence", "Migrations must be contiguous from 001", 503);
    }
  }
  const known = db
    .prepare("SELECT version, checksum FROM schema_migrations ORDER BY version")
    .all() as MigrationRow[];
  if (known.some((row) => !files.some((file) => file.version === row.version))) {
    throw new BantamError("schema-too-new", "Database schema is newer than this Bantam build", 503);
  }
  for (const { name, version } of files) {
    const sql = readFileSync(join(directory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = known.find((row) => row.version === version);
    if (existing) {
      if (existing.checksum !== checksum)
        throw new BantamError("migration-checksum", `Migration ${name} was modified`, 503);
      continue;
    }
    if (/\b(?:DROP\s+(?:TABLE|INDEX)|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\b[\s\S]*?\bDROP\b)/iu.test(sql)) {
      throw new BantamError(
        "destructive-migration",
        `Migration ${name} contains a destructive operation and must be applied offline`,
        503,
      );
    }
    const migrate = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(version, name, checksum, Date.now());
    });
    migrate.immediate();
  }
}
