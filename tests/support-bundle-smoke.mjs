import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const releaseRoot = path.join(root, "release", "pdfeditor-local");
const supportScript = path.join(releaseRoot, "support-bundle.sh");

if (!existsSync(supportScript)) {
  throw new Error("support bundle smoke requires package artifact; run npm run package:local first");
}

const result = spawnSync(supportScript, [], {
  cwd: releaseRoot,
  encoding: "utf8",
});

if (result.status !== 0) {
  throw new Error(`support bundle script failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

const bundlePath = result.stdout.trim().split(/\r?\n/).at(-1);
if (!bundlePath || !existsSync(bundlePath) || !bundlePath.endsWith(".tar.gz")) {
  throw new Error(`support bundle script did not create an archive: ${result.stdout}`);
}

const inspect = spawnSync("tar", ["-tzf", bundlePath], {
  cwd: releaseRoot,
  encoding: "utf8",
});
if (inspect.status !== 0) {
  throw new Error(`support bundle archive is not readable:\nstdout:\n${inspect.stdout}\nstderr:\n${inspect.stderr}`);
}

for (const required of ["README.txt", "release-manifest.json", "desktop-readiness.json", "OFFLINE-POLICY.txt"]) {
  if (!inspect.stdout.includes(required)) {
    throw new Error(`support bundle is missing ${required}:\n${inspect.stdout}`);
  }
}

rmSync(bundlePath, { force: true });

