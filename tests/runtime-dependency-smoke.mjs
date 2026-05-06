import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const releaseRoot = path.join(root, "release", "pdfeditor-local");
const runtimeCheckPath = path.join(releaseRoot, "check-runtime.mjs");

if (!existsSync(runtimeCheckPath)) {
  throw new Error("runtime dependency smoke requires package artifact; run npm run package:local first");
}

const result = spawnSync(process.execPath, [runtimeCheckPath], {
  cwd: releaseRoot,
  encoding: "utf8",
  env: process.env,
});

if (result.status !== 0) {
  throw new Error(`runtime dependency check failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

const report = JSON.parse(result.stdout);
if (report.package !== "pdfeditor-local" || report.nativeBuildPrerequisitesChecked !== false) {
  throw new Error(`unexpected runtime dependency report: ${result.stdout}`);
}

for (const required of ["node", "python3"]) {
  const check = report.checks?.find((entry) => entry.name === required);
  if (!check?.ok || check.required !== true) {
    throw new Error(`required runtime ${required} did not pass: ${result.stdout}`);
  }
}

for (const optional of ["qpdf", "ghostscript", "tesseract"]) {
  const check = report.checks?.find((entry) => entry.name === optional);
  if (!check || check.required !== false) {
    throw new Error(`optional runtime ${optional} is missing from report: ${result.stdout}`);
  }
}

for (const deferred of ["rustc", "cargo", "tauri-cli"]) {
  if (!report.nativeBuildPrerequisitesDeferred?.includes(deferred)) {
    throw new Error(`native build prerequisite ${deferred} must be deferred in local package smoke: ${result.stdout}`);
  }
}

