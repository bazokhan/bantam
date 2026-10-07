import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../config.js";

const config = loadConfig();
const base = (process.env.LITESTREAM_REPLICA_URL ?? "").replace(/\/$/, "");
const target = process.env.LITESTREAM_CONFIG ?? join(config.dataDir, "litestream.generated.yml");

// If LITESTREAM_REPLICA_URL is unset, there's nothing to back up to — write an
// empty `dbs:` config and exit cleanly. The server still runs; litestream
// simply has nothing to replicate (and litestream is bypassed when this is
// the case).
if (!base.startsWith("s3://")) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, "dbs:\n", { mode: 0o600 });
  process.stdout.write(`${target}\n`);
  process.exit(0);
}

const deployment = process.env.BANTAM_DEPLOYMENT_ID ?? "local";
const lines = ["dbs:"];

for (const game of config.games.values()) {
  lines.push(
    `  - path: ${JSON.stringify(join(config.dataDir, "games", game.id, "bantam.sqlite").replaceAll("\\", "/"))}`,
    "    replicas:",
    `      - url: ${JSON.stringify(`${base}/${deployment}/${game.id}`)}`,
  );
  if (process.env.LITESTREAM_ENDPOINT) {
    lines.push(`        endpoint: ${JSON.stringify(process.env.LITESTREAM_ENDPOINT)}`);
  }
  if (process.env.AWS_REGION) {
    lines.push(`        region: ${JSON.stringify(process.env.AWS_REGION)}`);
  }
  if (process.env.LITESTREAM_FORCE_PATH_STYLE === "true") {
    lines.push("        force-path-style: true");
  }
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${lines.join("\n")}\n`, { mode: 0o600 });
process.stdout.write(`${target}\n`);
