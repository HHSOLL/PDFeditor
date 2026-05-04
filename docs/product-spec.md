# Product Spec

PDF Studio targets a local-first Acrobat-class PDF editor. The product is only
complete when edits are written into PDF structure and survive reopen,
extraction, qpdf validation, and compatibility review.

## Product Goal

Users can open a PDF, edit text, images, pages, annotations, forms, signatures,
redaction, metadata, and accessibility structure, save the document, and reopen
the saved PDF in Acrobat Reader, Acrobat Pro, Chrome, Edge, and macOS Preview
without broken layout or hidden stale data.

## Non-Negotiable Rules

- Never claim an edit is saved when it only exists in the browser overlay.
- Engine-required operations must fail loudly when the engine is unavailable.
- Redaction is data removal, not a white rectangle.
- Every new PDF feature needs a fixture-backed roundtrip test.
- qpdf structural validation is required in local release verification.
- Unsupported PDF constructs must be classified and surfaced to the user.

## Supported First

- Normal text PDFs with horizontal text runs.
- Redaction plus replacement text for existing text edits.
- Flattened and native annotation export where safe.
- Page reorder, duplicate, rotate, extract, and mixed page sizes.
- Password-aware open/extract/apply flow.

## Explicitly Limited Until Implemented

- Full inline content-stream text editing.
- OCR-backed scanned PDF editing.
- Certificate digital signatures.
- XFA forms.
- PDF/A/PDF/X preflight fixups.
- PDF/UA accessibility repair.

## Release Gate

`npm run verify:local` must pass before any release build. Manual
compatibility smoke must be recorded for Acrobat Reader, Chrome, and Preview
for any change touching engine output.
