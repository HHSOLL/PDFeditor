# Manual Compatibility Report

Manual compatibility evidence is required before this project claims an
external Acrobat Pro replacement score above 90. Automated qpdf/PyMuPDF/PDF.js
tests are necessary but not sufficient.

## Environment

- Date: 2026-05-05
- OS: macOS local development machine
- Repository: `/Users/sol/Desktop/pdfedit`
- Adobe Acrobat: `26.001.21431` detected locally
- macOS Preview: `11.0` detected locally
- Google Chrome: `147.0.7727.138` detected locally
- Microsoft Edge: `147.0.3912.98` detected locally
- Structural validator: `qpdf` required for local verification
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
| `tmp/engine-compare/compare-report.pdf` | Compare report PDF | Engine test generated and validates the report PDF | Pass |
| `tmp/exported-compare-report-ui.pdf` | Inspector compare UI | Playwright saved report PDF and extracted `PDF Compare Report` plus before/after text | Pass |
| `tmp/exported-batch-ui.pdf` | Inspector batch UI | Playwright extracted batch watermark and confirmed `BATCH_UI_SECRET` was removed from extracted text | Pass |
| `tmp/exported-image-move-ui.pdf` | Existing image move UI | Playwright verified the output retained one real image object after source-image repositioning | Pass |

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

## Local App Launch Attempt

Representative OCR, signed, and accessibility-repaired PDFs were launched
against Preview, Chrome, Edge, and Acrobat and screenshots were written under:

```txt
tmp/manual-smoke-2026-05-05/
```

The screenshots are **not counted as pass evidence** because macOS screen
privacy prompts obscured the viewer windows during capture. Chrome and Edge did
open the OCR PDF behind the prompt, but the obstruction means the result is
recorded as launch-attempt evidence only, not manual compatibility pass.

## Required Manual Smoke Matrix

The following grid is intentionally explicit. A row remains **Pending** until a
human or browser/desktop automation opens the output in that exact app and
records the actual visual result.

| Viewer | OCR PDF | Signed PDF | Accessibility-repaired PDF | Form PDF | Sanitized PDF | Preflight report | Compare report | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Adobe Acrobat Pro / Reader | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not claimable |
| macOS Preview | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not claimable |
| Google Chrome PDF viewer | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not claimable |
| Microsoft Edge PDF viewer | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not claimable |

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

Because this report does not yet contain completed app-by-app visual results,
Acrobat/Preview/Chrome/Edge compatibility is not claimed as full external
evidence. The current release may claim local qpdf/PyMuPDF/PDF.js validation and
engine-backed PDF structure only.
