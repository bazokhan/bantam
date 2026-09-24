import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../config.js";
import { GameDatabase } from "../db/game-database.js";
import { BantamError } from "../errors.js";

const [command, gameId, ...flags] = process.argv.slice(2);
const config = loadConfig();
const migrations = join(process.cwd(), "migrations");
const litestreamConfig = process.env.LITESTREAM_CONFIG ?? join(config.dataDir, "litestream.generated.yml");
function gamePath(id: string): string {
  if (!config.games.has(id)) throw new BantamError("game-not-found", `Unknown game: ${id}`, 404);
  return join(config.dataDir, "games", id, "bantam.sqlite");
}
function runLitestream(args: string[]): void {
  const result = spawnSync("litestream", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (command === "integrity" || command === "quick-check") {
  if (!gameId) throw new Error("game id required");
  const db = new GameDatabase(gamePath(gameId), migrations);
  const rows = db.integrity(command === "integrity");
  db.close();
  console.log(JSON.stringify({ gameId, check: command, rows }));
  if (rows.length !== 1 || rows[0] !== "ok") process.exitCode = 1;
} else if (command === "restore" || command === "restore-if-missing") {
  if (!gameId) throw new Error("game id required");
  const path = gamePath(gameId);
  const exists = existsSync(path);
  const force = flags.includes("--force");
  if (command === "restore-if-missing" && exists)
    console.log(JSON.stringify({ gameId, restored: false, reason: "database-exists" }));
  else {
    if (exists && !force)
      throw new Error("Database exists; stop Bantam and pass --force with the exact game id to replace it");
    if (exists && force)
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
    mkdirSync(join(config.dataDir, "games", gameId), { recursive: true });
    runLitestream(["restore", "-config", litestreamConfig, path]);
    console.log(JSON.stringify({ gameId, restored: true }));
  }
} else if (command === "backup-status") runLitestream(["databases", "-config", litestreamConfig]);
else {
  console.error(
    "Usage: ops <quick-check|integrity|restore|restore-if-missing|backup-status> [game-id] [--force]",
  );
  process.exitCode = 2;
}
