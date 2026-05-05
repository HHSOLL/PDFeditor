#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const binary = process.env.GHOSTSCRIPT_BIN || "gs";
const result = spawnSync(binary, ["--version"], { encoding: "utf8" });

if (result.status !== 0) {
  console.error("Ghostscript is required for PDF/X preflight fixups.");
  console.error("Install it with `brew install ghostscript` on macOS or `sudo apt-get install ghostscript` on Ubuntu.");
  process.exit(1);
}

process.stdout.write(`Ghostscript ${result.stdout.trim() || result.stderr.trim()} available at ${binary}\n`);
