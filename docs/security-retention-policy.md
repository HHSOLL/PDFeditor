# Security And Retention Policy

PDFeditor's current release shape is local-first. The local product server and
local release package process PDFs on the user's machine through the Node server
and Python engine. There is no hosted storage, telemetry, crash reporting,
managed update channel, authentication, billing, tenant isolation, or production
audit-log system in the current package.

## Local Data Boundary

- PDFs are opened and processed locally.
- The packaged server binds to `127.0.0.1`.
- Runtime logs are written under `release/pdfeditor-local/logs/` for the local
  package.
- Support bundles are created only when the user runs
  `release/pdfeditor-local/support-bundle.sh`.
- Support bundles include package metadata and logs; they are not automatically
  uploaded.

## Retention

The local package does not enforce central retention because it does not store
documents in a managed service. Users control deletion of local PDFs, generated
outputs, logs, and support bundles. A future hosted or native managed release
must add explicit retention controls before claiming production deployment
readiness.

## Desktop And Offline Policy

The Tauri-first readiness scaffold is metadata and validation only. It does not
build a native desktop app, install Rust/Tauri, enable crash telemetry, or add
remote update checks. The intended desktop boundary remains local-only PDF
processing over loopback, with optional runtime dependency reporting for local
PDF tools.

## Claim Boundary

The current package may claim local release packaging, local runtime logs,
support-bundle generation, offline-mode policy documentation, and Tauri-first
desktop readiness metadata. It must not claim a packaged native desktop app,
production SaaS deployment, tenant retention controls, automatic telemetry, or
managed crash reporting until those systems exist and have release evidence.
