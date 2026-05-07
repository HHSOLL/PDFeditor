# Manual Compatibility Report

Manual compatibility evidence is required before this project claims an
external Acrobat Pro replacement score above 90. Automated qpdf/PyMuPDF/PDF.js
tests are necessary but not sufficient.

## Environment

- Date: 2026-05-06
- OS: macOS 26.4.1 (`25E253`) local development machine
- Repository: `/Users/sol/Desktop/pdfedit`
- Adobe Acrobat: `26.001.21529` detected locally
- macOS Preview: `11.0` detected locally
- Google Chrome: `147.0.7727.138` detected locally
- Microsoft Edge: `147.0.3912.98` detected locally
- Structural validator: `qpdf` required for local verification
- Standards validator: `veraPDF` can be required with
  `REQUIRE_STANDARDS_VALIDATOR=1 npm run test:standards-validator`; this is
  automated PDF/A/PDF/UA report evidence, not Acrobat Pro Preflight smoke.
- OCR runtime: `tesseract` required for local OCR verification

## Automated External-Viewer Proxies Completed

These do not replace visual/manual smoke, but they prove the generated PDF files
are real PDF structure and pass the local validators used before manual opening.

| Output | Feature | qpdf/PyMuPDF Evidence | Result |
| --- | --- | --- | --- |
| `tmp/exported-ocr-ui.pdf` | OCR correction UI | `pdf_engine.py validate` returned `ok: true`, `pageCount: 1`, `qpdfChecked: true`, `textLength: 26` | Pass |
| `tmp/exported-sign-ui.pdf` | Certificate signing UI | `pdf_engine.py signature-validate` returned `ok: true`, `signatureCount: 1`, `signedWidgetCount: 1`, `cmsVerified: true`, `docMDP: true` | Pass |
| `tmp/exported-accessibility-ui.pdf` | Accessibility repair UI | `pdf_engine.py accessibility` returned `ok: true`, title `Accessible UI Smoke`, language `ko-KR`, `tagged: true`, `imageAltTextCount: 1` | Pass |
| `tmp/engine-preflight-report/preflight-report.pdf` | Preflight report PDF | Engine test generated and validates the report PDF | Pass |
| `tmp/engine-standards-validator/standards-validator-report.pdf` | veraPDF standards report PDF | `engine-standards-validator.mjs` validates qpdf/PyMuPDF output and records veraPDF profile/failure details when the validator is installed | Pass |
| `tmp/engine-compare/compare-report.pdf` | Compare report PDF | Engine test generated and validates the report PDF | Pass |
| `tmp/exported-compare-report-ui.pdf` | Inspector compare UI | Playwright saved report PDF and extracted `PDF Compare Report` plus before/after text | Pass |
| document overlay | Inspector compare UI | Playwright verified changed-region overlay visibility, overlay toggle removal, and first-change command availability | Pass |
| `tmp/exported-batch-ui.pdf` | Inspector batch UI | Playwright saved/reloaded the batch preset, extracted batch watermark, and confirmed `BATCH_UI_SECRET` was removed from extracted text | Pass |
| `tmp/exported-image-move-ui.pdf` | Existing image move UI | Playwright verified the output retained one real image object after source-image repositioning | Pass |
| `tmp/exported-vector-object-ui.pdf` | Existing vector object UI | Playwright selected a detected vector object, displayed the object inspector, exported through `deleteVector`, and confirmed original colored line art count decreased | Pass |

## Product Server Smoke

`npm run test:release-smoke` starts `server/pdf-engine-server.mjs` against the
production `dist/` output and verifies:

- `/api/health` returns the PyMuPDF engine status.
- `/` serves the built UI HTML.
- `/api/pdf/ocr-status` reaches the OCR runtime and reports no missing English
  language data.
- `/api/pdf/compare` returns changed page data and a report PDF.
- `/api/pdf/batch` applies a structural batch payload and returns a validated
  output PDF.

`npm run test:package-smoke` additionally builds `release/pdfeditor-local` and
verifies that the packaged local server serves the built UI plus engine
preflight API outside the Vite development server. This is still a local web
package, not a native desktop release.

## Completed Manual Viewer Smoke

`npm run test:manual-smoke-package` generated a stable 50-PDF representative
package under `tmp/manual-compatibility-package/`. The package intentionally
covers Acrobat-created/edited surrogates, AcroForm/XFA surrogates, government
and contract forms, hidden-data/security files, scanned Korean/English files,
Office-style exports, Preview/Chrome/Edge surrogates, signed-document surrogates,
tagged/PDF-A/PDF-X/accessibility surrogates, CJK/emoji/RTL text, and malformed or
large-document categories.

`MANUAL_VIEWER_LIMIT=50 MANUAL_VIEWER_DELAY_MS=900
MANUAL_VIEWER_COMMAND_TIMEOUT_MS=7000 MANUAL_VIEWER_OPEN_TIMEOUT_MS=7000 npm
run test:manual-viewer-smoke` opened every package PDF in the actual local
viewer apps and captured per-viewer screenshots. The run passed 200 out of 200
open/render checks:

```txt
tmp/manual-viewer-smoke/2026-05-05T20-00-36-400Z/
```

Result summary:

| Viewer | Files | Pass | Fail | Evidence |
| --- | ---: | ---: | ---: | --- |
| Adobe Acrobat Pro / Reader | 50 | 50 | 0 | `tmp/manual-viewer-smoke/2026-05-05T20-00-36-400Z/results.json` |
| macOS Preview | 50 | 50 | 0 | `tmp/manual-viewer-smoke/2026-05-05T20-00-36-400Z/results.json` |
| Google Chrome PDF viewer | 50 | 50 | 0 | `tmp/manual-viewer-smoke/2026-05-05T20-00-36-400Z/results.json` |
| Microsoft Edge PDF viewer | 50 | 50 | 0 | `tmp/manual-viewer-smoke/2026-05-05T20-00-36-400Z/results.json` |

The pass criterion was viewer-specific: the script required an app/window or
tab title matching the PDF filename or external corpus ID and a non-empty
screenshot. This is representative open/render smoke evidence. It does not
replace deeper Acrobat panel verification for signature trust chains, Acrobat
Preflight parity, PDF/UA repair workflow, or hidden-information comparison.
Those deeper feature-panel records are mandatory before any 100/100 or full
Acrobat Pro replacement claim under `docs/final-100-gap-closure-plan.md`.

### 2026-05-06 Follow-Up Automation Attempt

During the 90-to-100 implementation pass, the automated GUI smoke was retried
with `MANUAL_VIEWER_LIMIT=1 MANUAL_VIEWER_DELAY_MS=900 npm run
test:manual-viewer-smoke`. The run was stopped because macOS AppleScript blocked
while asking Acrobat to open
`/Users/sol/Desktop/pdfeditor-manual-smoke-input/01-EXT-ACR-001-acrobat-created.pdf`.
No compatibility pass credit was taken from this interrupted run. Deep Acrobat
feature-panel smoke remains a final 100-point blocker.

The harness was then changed to open Acrobat with the non-blocking macOS
`open -a` path, apply per-command timeouts, and close the viewer after each
file by default. The focused rerun
`MANUAL_VIEWERS=acrobat MANUAL_VIEWER_LIMIT=50 MANUAL_VIEWER_DELAY_MS=900
MANUAL_VIEWER_COMMAND_TIMEOUT_MS=5000 MANUAL_VIEWER_OPEN_TIMEOUT_MS=5000 npm
run test:manual-viewer-smoke` passed 50/50 at
`tmp/manual-viewer-smoke/2026-05-05T19-35-35-632Z/results.json`. This confirms
the sequential one-file open/check/close workflow across the full representative
Acrobat package. After the same fallback logic was applied to Acrobat, Chrome,
and Edge title detection, the full four-viewer rerun passed 200/200 at
`tmp/manual-viewer-smoke/2026-05-05T20-00-36-400Z/results.json`. This is stronger
open/render evidence, but it is still not the deep 100-file feature-panel smoke
required for a final 100-point claim.

## Required Manual Smoke Matrix

The following grid records the completed representative open/render smoke. A
cell marked **Pass** means the 50-PDF package included that feature category and
the actual viewer opened/rendered the representative PDFs. Deeper feature-panel
checks remain listed in the claim boundary for scores above 90.

| Viewer | OCR PDF | Signed PDF | Accessibility-repaired PDF | Form PDF | Sanitized PDF | Preflight report | Compare report | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Adobe Acrobat Pro / Reader | Pass | Pass | Pass | Pass | Pass | Pass | Pass | Representative open/render pass |
| macOS Preview | Pass | Pass | Pass | Pass | Pass | Pass | Pass | Representative open/render pass |
| Google Chrome PDF viewer | Pass | Pass | Pass | Pass | Pass | Pass | Pass | Representative open/render pass |
| Microsoft Edge PDF viewer | Pass | Pass | Pass | Pass | Pass | Pass | Pass | Representative open/render pass |

## Corpus Linkage

Future manual rows must reference either a generated output path from `tmp/` or
an external corpus ID from `tests/corpus/manifest.json`. The manifest currently
plans 117 external entries, but those entries are not full compatibility evidence
until actual files or reproducible generation steps exist and this report records
viewer-specific pass/fail results.

`npm run test:manual-smoke-package` creates the stable 50-PDF manual smoke
package under `tmp/manual-compatibility-package/` with a generated checklist.
`npm run test:manual-viewer-smoke` records actual viewer-specific pass/fail
results and screenshots.

## Manual Smoke Procedure

For each viewer:

1. Open each representative PDF listed above.
2. Verify the file opens without a repair prompt or blank page.
3. Verify text selection/search for OCR and edited text outputs.
4. Verify signature field visibility and the signature panel result. A
   self-signed certificate trust warning is acceptable, but byte-integrity must
   be recognized.
5. Verify form values and appearance for text, checkbox, radio, combo, and list
   fields.
6. Verify sanitized output has no visible comments/attachments/actions and that
   hidden-data checks remain clean in the engine.
7. Verify preflight and compare report PDFs are readable.
8. Record screenshot path, app version, pass/fail, and any notes.

## Current Product Claim Boundary

This report now contains completed app-by-app representative open/render
results for Acrobat Pro/Reader, Preview, Chrome, and Edge. The current release
may claim 50-PDF representative manual viewer smoke, local qpdf/PyMuPDF/PDF.js
validation, and engine-backed PDF structure. It must not claim full Acrobat Pro
replacement, Acrobat Preflight parity, timestamp/LTV signature trust, full
PDF/A/X/UA certification, or complete sanitizer parity without deeper
feature-panel smoke and validator evidence.
