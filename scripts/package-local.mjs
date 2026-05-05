#!/usr/bin/env node
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const releaseRoot = path.join(root, "release", "pdfeditor-local");

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });

await cp(path.join(root, "dist"), path.join(releaseRoot, "dist"), { recursive: true });
await cp(path.join(root, "server"), path.join(releaseRoot, "server"), { recursive: true });
await cp(path.join(root, "engine"), path.join(releaseRoot, "engine"), { recursive: true });
await cp(path.join(root, "public"), path.join(releaseRoot, "public"), { recursive: true });
await mkdir(path.join(releaseRoot, "logs"), { recursive: true });
await writeFile(path.join(releaseRoot, "logs", ".gitkeep"), "", "utf8");

await writeFile(
  path.join(releaseRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "pdfeditor-local-release",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: "node server/pdf-engine-server.mjs",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await writeFile(
  path.join(releaseRoot, "run.sh"),
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "cd \"$(dirname \"$0\")\"",
    "mkdir -p logs",
    "if [ ! -x .venv/bin/python ]; then",
    "  echo \"[pdfeditor] creating local Python runtime\" | tee -a logs/pdfeditor-local.log",
    "  python3 -m venv .venv 2>&1 | tee -a logs/pdfeditor-local.log",
    "  .venv/bin/python -m pip install -r engine/requirements.txt 2>&1 | tee -a logs/pdfeditor-local.log",
    "fi",
    "export PDF_ENGINE_PYTHON=\"$PWD/.venv/bin/python\"",
    "export PORT=\"${PORT:-8787}\"",
    "echo \"[pdfeditor] starting local engine server on http://127.0.0.1:$PORT\" | tee -a logs/pdfeditor-local.log",
    "node server/pdf-engine-server.mjs 2>&1 | tee -a logs/pdfeditor-local.log",
    "",
  ].join("\n"),
  "utf8",
);
await chmod(path.join(releaseRoot, "run.sh"), 0o755);

await writeFile(
  path.join(releaseRoot, "support-bundle.sh"),
  [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "cd \"$(dirname \"$0\")\"",
    "STAMP=\"$(date +%Y%m%d-%H%M%S)\"",
    "OUT=\"pdfeditor-support-$STAMP.tar.gz\"",
    "tar -czf \"$OUT\" README.txt release-manifest.json logs 2>/dev/null || tar -czf \"$OUT\" README.txt release-manifest.json",
    "echo \"$PWD/$OUT\"",
    "",
  ].join("\n"),
  "utf8",
);
await chmod(path.join(releaseRoot, "support-bundle.sh"), 0o755);

await writeFile(
  path.join(releaseRoot, "release-manifest.json"),
  `${JSON.stringify(
    {
      name: "PDFeditor local web package",
      version: "0.1.0",
      generatedAt: new Date().toISOString(),
      runtime: {
        frontend: "dist/",
        server: "server/pdf-engine-server.mjs",
        engine: "engine/pdf_engine.py",
        launcher: "run.sh",
        logs: "logs/pdfeditor-local.log",
        supportBundle: "support-bundle.sh",
      },
      claimBoundary: {
        packageType: "local web package",
        nativeDesktop: false,
        productionSaaS: false,
        engineLifecycle: "launcher-managed local process",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await writeFile(
  path.join(releaseRoot, "README.txt"),
  [
    "PDFeditor local release package",
    "",
    "Run:",
    "  ./run.sh",
    "",
    "Open:",
    "  http://127.0.0.1:8787/",
    "",
    "Notes:",
    "- The launcher creates a local Python virtual environment on first run.",
    "- PDF editing, OCR, signing, compare, batch, sanitizer, and preflight endpoints are served locally.",
    "- This is a local web package, not a native Tauri/Electron desktop bundle.",
    "- Runtime logs are written to logs/pdfeditor-local.log.",
    "- Run ./support-bundle.sh to create a support archive with logs and package metadata.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Created ${releaseRoot}`);
