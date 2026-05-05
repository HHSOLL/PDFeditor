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
    "if [ ! -x .venv/bin/python ]; then",
    "  python3 -m venv .venv",
    "  .venv/bin/python -m pip install -r engine/requirements.txt",
    "fi",
    "export PDF_ENGINE_PYTHON=\"$PWD/.venv/bin/python\"",
    "export PORT=\"${PORT:-8787}\"",
    "node server/pdf-engine-server.mjs",
    "",
  ].join("\n"),
  "utf8",
);
await chmod(path.join(releaseRoot, "run.sh"), 0o755);

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
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Created ${releaseRoot}`);
