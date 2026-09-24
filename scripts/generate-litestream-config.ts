import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const base = (process.env.LITESTREAM_REPLICA_URL ?? "").replace(/\/$/, "");
if (!base.startsWith("s3://")) throw new Error("LITESTREAM_REPLICA_URL must be an s3:// URL");
const deployment = process.env.BANTAM_DEPLOYMENT_ID ?? "local";
const target = process.env.LITESTREAM_CONFIG ?? join(config.dataDir, "litestream.generated.yml");
const lines = ["dbs:"];
for (const game of config.games.values()) {
  lines.push(
    `  - path: ${JSON.stringify(join(config.dataDir, "games", game.id, "bantam.sqlite").replaceAll("\\", "/"))}`,
  );
  lines.push("    replicas:", `      - url: ${JSON.stringify(`${base}/${deployment}/${game.id}`)}`);
  if (process.env.LITESTREAM_ENDPOINT)
    lines.push(`        endpoint: ${JSON.stringify(process.env.LITESTREAM_ENDPOINT)}`);
  if (process.env.AWS_REGION) lines.push(`        region: ${JSON.stringify(process.env.AWS_REGION)}`);
  if (process.env.LITESTREAM_FORCE_PATH_STYLE === "true") lines.push("        force-path-style: true");
}
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(target);
