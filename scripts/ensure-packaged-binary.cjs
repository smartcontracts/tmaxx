#!/usr/bin/env node

const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packagedBinary = path.join(root, "dist", "tmaxx");

if (existsSync(packagedBinary)) {
  process.exit(0);
}

const result = spawnSync("bun", ["run", "build:bin"], {
  cwd: root,
  stdio: "inherit",
});

if (result.error) {
  console.error("tmaxx: no packaged binary was found and Bun is unavailable to build one.");
  console.error("Install Bun before packaging from source, or build `dist/tmaxx` first.");
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
