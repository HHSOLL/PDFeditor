# Release Claim Boundary

This document defines what may and may not be said externally about the current
PDFeditor build. It exists to prevent the automated 85/100 local baseline from
being confused with a fully verified Acrobat Pro replacement claim.

## Allowed Claims

- Acrobat-class local PDF editor prototype.
- Real PDF-structure export through the PyMuPDF engine; not screenshot export.
- qpdf-required local validation.
- PDF.js and PyMuPDF-based automated export/reopen checks.
- Engine-backed OCR searchable PDF generation and OCR correction UI.
- Engine-backed certificate signing UI using CMS ByteRange signing with
  self-signed certificate support and tamper detection.
- Basic accessibility repair UI for document title, language, tag signals, tab
  order, and image alt text.
- AcroForm filling/creation support for text, checkbox, radio, combo, list, and
  signature-field widgets.
- Validator-backed preflight reporting with veraPDF PDF/A/PDF/UA validation
  output when installed, PDF/X signal diagnostics, local PDF/X structural
  validation, and Ghostscript-backed PDF/X-3 fixup evidence.
- Hidden-info sanitizer coverage for generated fixtures.
- Inspector compare report download and batch quick action backed by the engine,
  changed-region compare overlay and first-change navigation, persisted batch
  presets, plus the 100-job batch runner.
- Existing image move UI that emits `moveImage` and keeps a real image object in
  the output PDF.
- Existing vector object selection and basic object inspector that export
  through `deleteVector`.
- Representative Acrobat Pro/Reader, macOS Preview, Chrome, and Edge open/render
  smoke for the 50-PDF manual package: 200/200 pass with screenshots under
  `tmp/manual-viewer-smoke/2026-05-05T17-33-44-886Z/`.
- External replacement readiness: 90/100 verified as of 2026-05-06.
- Product-server release smoke verifies the built UI, engine health endpoint,
  OCR runtime, compare endpoint, and batch endpoint through
  `server/pdf-engine-server.mjs`.
- Local release package smoke verifies `release/pdfeditor-local`.

## Forbidden Claims

- Full Acrobat Pro replacement.
- 100% Acrobat-compatible.
- External Acrobat Pro replacement score above 90.
- Full PDF/A or PDF/X certification.
- Broad preflight fixup engine claims beyond the implemented PDF/X-3 path.
- Full PDF/UA editor or validator.
- LTV/timestamped enterprise signature support.
- Complete sanitizer for all hidden PDF content.
- Complete native vector editor.
- Production-ready SaaS or native packaged desktop release.
- Deep feature-panel compatibility with Acrobat/Preview/Chrome/Edge beyond the
  representative open/render smoke unless the manual smoke report contains
  feature-specific pass records.
- Treating the external corpus manifest as completed real-world corpus evidence
  before files or reproducible generation steps are attached.

## Current High-Risk Boundaries

- **Manual viewer compatibility:** representative 50-PDF open/render smoke is
  complete in Acrobat, Preview, Chrome, and Edge. Deeper feature-panel smoke is
  still required for scores above 90, including Acrobat signature status,
  Acrobat Preflight comparison, form appearance details, sanitizer comparison,
  OCR search/correction, and accessibility workflow checks.
- **External corpus:** `tests/corpus/manifest.json` defines 117 planned external
  entries and `npm run test:corpus` now generates/validates 117 synthetic
  surrogate PDFs for drift prevention, but most real-world entries are still
  pending acquisition and manual smoke.
- **Deployment:** the app has a smoke-tested local web release package. There is
  no native desktop app, hosted production deployment, queue, auth, audit log, or
  managed engine lifecycle.
- **Preflight:** the current engine reports local signals and can include
  veraPDF PDF/A/PDF/UA validation output. PDF/X-3 fixup is implemented through
  Ghostscript `pdfwrite` and accepted only after qpdf, PyMuPDF, and local PDF/X
  structural validation pass. This does not certify arbitrary PDF/A/X/UA output,
  does not cover PDF/A fixups, and does not provide Acrobat Pro output preview,
  separations, ink coverage, or arbitrary PDF/X profile parity.
- **Digital signatures:** CMS ByteRange signing and tamper detection work.
  Timestamp, LTV, revocation, and enterprise trust-chain UX are not included.
- **OCR:** OCR can produce searchable PDFs and write corrected text. Full
  scanned-PDF semantic editing, deskew/orientation, and queue-backed OCR are not
  included.
- **Accessibility:** basic repair exists. Real tag-tree editing, reading order,
  artifact marking, and PDF/UA validation remain unimplemented.

## Required Wording

Use:

> Acrobat-class local PDF editor prototype with verified engine-backed OCR
> correction, certificate signing, forms, sanitizer, preflight reporting,
> PDF/X-3 fixup, compare/batch UI workflows, representative
> Acrobat/Preview/Chrome/Edge viewer smoke, and a 90/100 external replacement readiness
> score.

Do not use:

> Full Acrobat Pro replacement.

Do not use:

> Acrobat Pro compatible.

Do not use:

> PDF/A, PDF/X, or PDF/UA certified.
