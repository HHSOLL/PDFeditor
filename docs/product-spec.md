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
- Continuous document viewing with fixed header, rail, thumbnail sidebar,
  inspector, and bottom navigation. Only the central document viewport scrolls.
- First-pass semantic reflow for paragraph/block edits: downstream text in the
  same flow is moved, protected figure/image/caption regions are avoided, and
  overflow can cascade to following pages.
- Flattened and native annotation export where safe.
- Page reorder, duplicate, rotate, extract, and mixed page sizes.
- Password-aware open/extract/apply flow.
- AcroForm text field and checkbox fill/save; engine flatten is supported by
  contract tests.

## Explicitly Limited Until Implemented

- Full inline content-stream text editing.
- Arbitrary multi-column layout solving with movable figures/tables. The first
  reflow solver treats existing images, figures, tables, and captions as
  protected blocks and moves text around them; it blocks export when the edited
  text itself cannot be placed safely.
- OCR-backed scanned PDF editing.
- Certificate digital signatures.
- XFA forms and advanced AcroForm scripts/calculations.
- PDF/A/PDF/X preflight fixups.
- PDF/UA accessibility repair.

## Release Gate

`npm run verify:local` must pass before any release build. Manual
compatibility smoke must be recorded for Acrobat Reader, Chrome, and Preview
for any change touching engine output.

## Viewport Policy

`html`, `body`, and `#app` are fixed-height and `overflow: hidden`. The app
shell fills `100dvh`. Header/menu/ribbon and the bottom navigation are fixed
rows. The workspace has rail, thumbnails, document, and inspector columns. Only
`.canvas-area` scrolls the document stack; `.page-list` and `.inspector-body`
may scroll internally. `window.scrollY` must remain `0` during normal document
navigation.

## Performance Targets

- 100-page PDF: first page visible within 2 seconds on the local test machine.
- 500-page PDF: opens without rendering every page canvas at once.
- Thumbnails hydrate lazily or through a queue; central scroll must not move the
  rail, sidebar, or inspector.
