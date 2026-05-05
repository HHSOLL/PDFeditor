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
engine, fonts, a launcher, and a README. The launcher creates a local Python
virtual environment and installs `engine/requirements.txt` on first run.

## Non-Claimable Deployment Gaps

- No packaged Tauri/Electron desktop app.
- No hosted upload/download storage.
- No job queue for long OCR/sanitize/preflight tasks.
- No authentication, billing, tenant isolation, audit logs, or retention
  controls.
- No crash-reporting or support bundle.

Until one of those product packaging paths is complete, deployment contributes
only limited external replacement readiness credit.
