# Deployment

The current deployable shape is a local product server, not a packaged desktop
app and not a hosted SaaS release. A smoke-tested local release directory is
available for users who need to run the built product without Vite.

## Local Product Server

Build:

```bash
npm run build
```

Run:

```bash
npm run serve
```

Open:

```txt
http://127.0.0.1:8787/
```

The server serves `dist/` and exposes the PDF engine API endpoints from
`server/pdf-engine-server.mjs`.

## Smoke Test

```bash
npm run test:release-smoke
```

This verifies:

- Built UI is served from `dist/`.
- `/api/health` returns the PyMuPDF engine status.
- OCR runtime is reachable through `/api/pdf/ocr-status`.
- Compare and batch endpoints work through the product server path.

## Local Release Package

Create:

```bash
npm run package:local
```

Run:

```bash
release/pdfeditor-local/run.sh
```

Open:

```txt
http://127.0.0.1:8787/
```

Verify:

```bash
npm run test:package-smoke
```

The local package contains built UI assets, the Node engine server, the Python
engine, fonts, a launcher, runtime log directory, support-bundle script, release
manifest, desktop readiness metadata, a runtime dependency check, and a README.
The launcher creates a local Python virtual environment and installs
`engine/requirements.txt` on first run.

Package support files:

```txt
release/pdfeditor-local/release-manifest.json
release/pdfeditor-local/desktop-readiness.json
release/pdfeditor-local/desktop/tauri.conf.ready.json
release/pdfeditor-local/check-runtime.mjs
release/pdfeditor-local/OFFLINE-POLICY.txt
release/pdfeditor-local/logs/pdfeditor-local.log
release/pdfeditor-local/support-bundle.sh
```

Create a support bundle:

```bash
release/pdfeditor-local/support-bundle.sh
```

`npm run test:package-smoke` verifies the manifest, launcher, support-bundle
script, desktop readiness scaffold, runtime dependency report, built UI, health
endpoint, and preflight endpoint. `npm run test:desktop-smoke` builds the same
local artifact and runs the desktop readiness, runtime dependency, and support
bundle smoke tests without requiring Rust, Cargo, the Tauri CLI, or a native
bundle. This is still a local web package, not a native app or managed hosted
deployment.

## Tauri-First Desktop Readiness

The local package now emits a Tauri-first readiness scaffold without requiring
Rust, Cargo, the Tauri CLI, or a native bundler to be installed. The scaffold is
intended to make the future desktop wrapper concrete while keeping release
claims bounded.

The desktop readiness smoke verifies:

- `release/pdfeditor-local/desktop-readiness.json` declares Tauri as the target
  shell and keeps `nativeDesktopBundleBuilt` false.
- `release/pdfeditor-local/desktop/tauri.conf.ready.json` is a Tauri v2 config
  template pointing at `dist/`, with native bundling inactive.
- Engine lifecycle metadata identifies the local server entrypoint,
  `engine/pdf_engine.py`, `127.0.0.1`, `/api/health`, shutdown signal, and log
  path.
- `release/pdfeditor-local/check-runtime.mjs` reports required Node/Python and
  optional qpdf/Ghostscript/Tesseract availability without installing tools or
  checking Rust/Tauri build prerequisites.
- `release/pdfeditor-local/OFFLINE-POLICY.txt` and the manifest keep PDF
  processing local-only, with no telemetry, hosted storage, update checks, or
  remote PDF processing.
- The claim boundary continues to block packaged native desktop and production
  SaaS claims.

## Non-Claimable Deployment Gaps

- No packaged Tauri/Electron desktop app; only a Tauri-first readiness scaffold
  is present.
- No hosted upload/download storage.
- No job queue for long OCR/sanitize/preflight tasks.
- No authentication, billing, tenant isolation, audit logs, or retention
  controls.
- No crash-reporting or automatic telemetry.

Until one of those product packaging paths is complete, deployment contributes
only limited external replacement readiness credit.
