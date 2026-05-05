# Release Claim Boundary

This document defines what may and may not be said externally about the current
PDFeditor build. It exists to prevent the automated 84/100 local baseline from
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
- Report-only preflight with PDF/A/X signal diagnostics.
- Hidden-info sanitizer coverage for generated fixtures.
- Inspector compare report download and batch quick action backed by the engine,
  plus the 100-job batch runner.
- Existing image move UI that emits `moveImage` and keeps a real image object in
  the output PDF.
- External replacement readiness: 80/100 verified as of 2026-05-05.
- Product-server release smoke verifies the built UI, engine health endpoint,
  OCR runtime, compare endpoint, and batch endpoint through
  `server/pdf-engine-server.mjs`.
- Local release package smoke verifies `release/pdfeditor-local`.

## Forbidden Claims

- Full Acrobat Pro replacement.
- 100% Acrobat-compatible.
- External Acrobat Pro replacement score above 90.
- Full PDF/A or PDF/X certification.
- Preflight fixup engine.
- Full PDF/UA editor or validator.
- LTV/timestamped enterprise signature support.
- Complete sanitizer for all hidden PDF content.
- Complete native vector editor.
- Production-ready SaaS or native packaged desktop release.
- Compatibility with Acrobat/Preview/Chrome/Edge unless the manual smoke report
  contains completed app-specific pass records.

## Current High-Risk Boundaries

- **Manual viewer compatibility:** required app versions are detected locally,
  but representative output PDFs still need explicit visual smoke in Acrobat,
  Preview, Chrome, and Edge.
- **Deployment:** the app has a smoke-tested local web release package. There is
  no native desktop app, hosted production deployment, queue, auth, audit log, or
  managed engine lifecycle.
- **Preflight:** the current engine reports signals. It does not certify PDF/A/X
  conformance and does not apply fixups.
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
> compare/batch UI workflows, and an 80/100 external replacement readiness
> score.

Do not use:

> Full Acrobat Pro replacement.

Do not use:

> Acrobat Pro compatible.

Do not use:

> PDF/A, PDF/X, or PDF/UA certified.
