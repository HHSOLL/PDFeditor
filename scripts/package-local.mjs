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
await mkdir(path.join(releaseRoot, "desktop"), { recursive: true });

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
    "tar -czf \"$OUT\" README.txt release-manifest.json desktop-readiness.json OFFLINE-POLICY.txt logs 2>/dev/null || tar -czf \"$OUT\" README.txt release-manifest.json desktop-readiness.json OFFLINE-POLICY.txt",
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
        runtimeCheck: "check-runtime.mjs",
      },
      desktopReadiness: {
        targetShell: "Tauri",
        tauriFirst: true,
        nativeDesktopBundle: false,
        rustTauriRequiredForSmoke: false,
        manifest: "desktop-readiness.json",
        tauriConfigTemplate: "desktop/tauri.conf.ready.json",
        engineLifecycle: "local sidecar process behind 127.0.0.1 HTTP API",
        offlinePolicy: "local-only; no telemetry, update checks, hosted storage, or remote PDF processing",
      },
      claimBoundary: {
        packageType: "local web package with Tauri-first desktop readiness scaffold",
        nativeDesktop: false,
        productionSaaS: false,
        engineLifecycle: "launcher-managed local process; Tauri sidecar lifecycle remains planned, not shipped",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await writeFile(
  path.join(releaseRoot, "desktop-readiness.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      targetShell: "Tauri",
      status: "readiness-scaffold",
      rustTauriRequiredForSmoke: false,
      nativeDesktopBundleBuilt: false,
      tauriConfigTemplate: "desktop/tauri.conf.ready.json",
      engineLifecycle: {
        currentMode: "launcher-managed local process",
        tauriTargetMode: "tauri-sidecar-managed local process",
        serverEntrypoint: "server/pdf-engine-server.mjs",
        engineEntrypoint: "engine/pdf_engine.py",
        bindHost: "127.0.0.1",
        defaultPort: 8787,
        healthEndpoint: "/api/health",
        startupLog: "logs/pdfeditor-local.log",
        shutdownSignal: "SIGTERM",
        restartPolicy: "manual restart in local package; supervised restart belongs to future Tauri shell",
      },
      runtimeDependencyChecks: {
        script: "check-runtime.mjs",
        required: ["node", "python3"],
        optional: ["qpdf", "gs", "tesseract"],
        deferredForNativeBuild: ["rustc", "cargo", "tauri-cli"],
        installBehavior: "runtime check reports status only; it does not install dependencies",
      },
      support: {
        logDirectory: "logs",
        mainLog: "logs/pdfeditor-local.log",
        supportBundleScript: "support-bundle.sh",
        supportBundleIncludes: ["README.txt", "release-manifest.json", "desktop-readiness.json", "OFFLINE-POLICY.txt", "logs"],
      },
      offlinePolicy: {
        defaultOffline: true,
        remotePdfProcessing: false,
        hostedStorage: false,
        telemetry: false,
        updateChecks: false,
        allowedOutboundHosts: [],
        localLoopbackOnly: true,
      },
      claimBoundary: {
        claimable: [
          "Local web release package",
          "Tauri-first desktop readiness metadata",
          "Runtime dependency reporting without native build prerequisites",
        ],
        blocked: [
          "Packaged native Tauri desktop app",
          "Production SaaS deployment",
          "Automatic crash reporting or telemetry",
          "Managed update channel",
        ],
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await writeFile(
  path.join(releaseRoot, "desktop", "tauri.conf.ready.json"),
  `${JSON.stringify(
    {
      $schema: "https://schema.tauri.app/config/2",
      productName: "PDFeditor",
      version: "0.1.0",
      identifier: "com.pdfeditor.local",
      build: {
        beforeDevCommand: "npm run dev",
        beforeBuildCommand: "npm run build",
        devUrl: "http://127.0.0.1:5173",
        frontendDist: "../dist",
      },
      app: {
        windows: [
          {
            title: "PDFeditor",
            width: 1280,
            height: 860,
            minWidth: 1024,
            minHeight: 720,
          },
        ],
        security: {
          csp: "default-src 'self'; img-src 'self' blob: data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:*",
        },
      },
      bundle: {
        active: false,
        targets: ["app", "dmg", "msi", "deb", "appimage"],
        resources: ["../server", "../engine", "../public"],
        externalBin: [],
      },
      plugins: {},
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await writeFile(
  path.join(releaseRoot, "check-runtime.mjs"),
  [
    "#!/usr/bin/env node",
    'import { spawnSync } from "node:child_process";',
    "",
    "const checks = [",
    '  { name: "node", command: process.execPath, args: ["--version"], required: true },',
    '  { name: "python3", command: process.env.PDF_ENGINE_PYTHON || "python3", args: ["--version"], required: true },',
    '  { name: "qpdf", command: "qpdf", args: ["--version"], required: false },',
    '  { name: "ghostscript", command: "gs", args: ["--version"], required: false },',
    '  { name: "tesseract", command: "tesseract", args: ["--version"], required: false },',
    "];",
    "",
    "const results = checks.map((check) => {",
    "  const result = spawnSync(check.command, check.args, { encoding: 'utf8' });",
    "  return {",
    "    name: check.name,",
    "    required: check.required,",
    "    ok: result.status === 0,",
    "    command: check.command,",
    "    version: (result.stdout || result.stderr || '').split('\\n')[0].trim(),",
    "    error: result.error?.message,",
    "  };",
    "});",
    "",
    "const report = {",
    '  package: "pdfeditor-local",',
    "  nativeBuildPrerequisitesChecked: false,",
    '  nativeBuildPrerequisitesDeferred: ["rustc", "cargo", "tauri-cli"],',
    "  checks: results,",
    "};",
    "",
    "console.log(JSON.stringify(report, null, 2));",
    "if (results.some((check) => check.required && !check.ok)) {",
    "  process.exitCode = 1;",
    "}",
    "",
  ].join("\n"),
  "utf8",
);
await chmod(path.join(releaseRoot, "check-runtime.mjs"), 0o755);

await writeFile(
  path.join(releaseRoot, "OFFLINE-POLICY.txt"),
  [
    "PDFeditor offline mode policy",
    "",
    "- The local package binds the product server to 127.0.0.1.",
    "- PDF files are processed by the local Node server and Python engine.",
    "- The package does not require hosted PDF storage, telemetry, crash reporting, update checks, or remote PDF processing.",
    "- Optional tools such as qpdf, Ghostscript, and Tesseract are detected locally when installed.",
    "- Rust, Cargo, and the Tauri CLI are deferred native build prerequisites and are not required for this desktop readiness smoke.",
    "",
  ].join("\n"),
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
    "- Desktop readiness metadata is available in desktop-readiness.json.",
    "- The Tauri config template is scaffolded at desktop/tauri.conf.ready.json, but no native desktop bundle is built by this package.",
    "- Run ./check-runtime.mjs to report local runtime dependencies without installing Rust, Tauri, or optional PDF tools.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Created ${releaseRoot}`);
