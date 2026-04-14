#!/usr/bin/env node

const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packagedBinary = path.join(root, "dist", "tmaxx");
const sourceEntry = path.join(root, "src", "cli", "tmaxx.ts");
const args = process.argv.slice(2);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.error) {
    return { ok: false, error: result.error };
  }
  process.exit(result.status ?? 0);
}

if (existsSync(packagedBinary)) {
  const packaged = run(packagedBinary, args);
  if (packaged?.ok === false && packaged.error?.code !== "ENOEXEC") {
    if (packaged.error?.code !== "ENOENT") {
      console.error(`tmaxx: failed to execute packaged binary at ${packagedBinary}`);
      console.error(packaged.error.message);
    }
  }
}

if (existsSync(sourceEntry)) {
  const bun = run("bun", [sourceEntry, ...args]);
  if (bun?.ok === false) {
    console.error("tmaxx: packaged binary was unavailable and Bun fallback failed.");
    console.error("Install Bun or build a standalone binary with `bun run build:bin`.");
    console.error(bun.error.message);
    process.exit(1);
  }
}

console.error("tmaxx: no packaged binary or source entrypoint was found.");
console.error("Reinstall the package or build a standalone binary with `bun run build:bin`.");
process.exit(1);
