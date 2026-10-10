#!/usr/bin/env node
/**
 * Publish only @gamercury/bantam-sdk. Never publish the server workspace root.
 *
 *   node scripts/publish-sdk.mjs --dry-run
 *   node scripts/publish-sdk.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const skipVerify = process.argv.includes("--skip-verify");

const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (rootPkg.name !== "@gamercury/bantam" || rootPkg.private !== true) {
  console.error("Refusing to publish: root package must remain private @gamercury/bantam");
  process.exit(1);
}

const sdkPkg = JSON.parse(readFileSync(join(root, "packages/sdk/package.json"), "utf8"));
if (sdkPkg.name !== "@gamercury/bantam-sdk") {
  console.error("Refusing to publish: unexpected SDK package name", sdkPkg.name);
  process.exit(1);
}
if (sdkPkg.private === true) {
  console.error("Refusing to publish: SDK is still marked private");
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!dryRun && !skipVerify) run("npm", ["run", "verify"]);
else run("npm", ["run", "build", "-w", "@gamercury/bantam-sdk"]);

const publishArgs = ["publish", "-w", "@gamercury/bantam-sdk", "--access", "public"];
if (dryRun) publishArgs.push("--dry-run");
run("npm", publishArgs);
