import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import type { LoadedConfig } from "../src/config.js";

const dir = mkdtempSync(join(tmpdir(), "bantam-openapi-"));
const secret = "openapi-generation-secret-at-least-32";
const config: LoadedConfig = {
  environment: "test",
  dataDir: dir,
  allowedOrigins: [],
  games: new Map([
    [
      "example-title",
      {
        id: "example-title",
        displayName: "Example",
        adapters: ["example-title-daily-v1"],
        secretPrefix: "TEST",
        gracePeriodHours: 48,
        authProvider: "development",
        identitySalt: secret,
        sessionSecret: secret,
        cursorSecret: secret,
      },
    ],
  ]),
};
const app = await buildApp(config, { logger: false });
await app.ready();
const output = `${JSON.stringify(app.swagger(), null, 2)}\n`;
await app.close();
rmSync(dir, { recursive: true, force: true });
const target = join(process.cwd(), "openapi", "bantam.openapi.json");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) {
    console.error("OpenAPI snapshot is stale. Run npm run openapi:generate.");
    process.exitCode = 1;
  }
} else {
  mkdirSync(join(process.cwd(), "openapi"), { recursive: true });
  writeFileSync(target, output);
  console.log(target);
}
