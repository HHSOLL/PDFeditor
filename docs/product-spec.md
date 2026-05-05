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
- Page reorder, duplicate, rotate, extract, blank insertion, crop, resize, and
  mixed page sizes. External PDF page insertion is supported through engine
  payload page items with `sourcePdfBase64`.
- Existing image replacement through engine-backed source image removal and
  real image insertion. Existing image move is supported by extracting the
  source image, redacting the original area, and writing the image at the new
  target rectangle.
- Literal search, regex, and whole-page redaction with extracted-text and raw
  byte removal tests.
- Password-aware open/extract/apply flow.
- AES-256 user/owner password saving with qpdf-verified permission flags.
- AcroForm text field, checkbox, radio button, combo box, and list box
  fill/save; required/default/export values and appearance streams are covered
  by engine tests. Basic new text, checkbox, radio, combo, list, and signature field
  creation writes real PDF Widget annotations through the engine. Explicit tab
  order is saved through page annotation order with `/Tabs /A`. XFA is detected
  with an unsupported warning. Newly created radio buttons are supported as widget
  fields; full Acrobat-style interconnected radio group authoring remains a
  limited area until a dedicated group editor is implemented. XFDF export and
  import are available for supported field values.
- Simple typed, drawn, and image signature appearances are written into page
  content. Certificate signing is available through the engine: it creates a
  real signature field, signs the PDF ByteRange with a detached OpenSSL CMS
  signature, writes optional DocMDP lock policy entries, and validates that
  tampering breaks the signature.
- Searchable OCR export is available through the engine. The OCR path checks
  Tesseract/tessdata availability, renders selected scanned pages, writes an
  image-over-text PDF, and accepts the output only after qpdf/PyMuPDF
  validation and text extraction. Korean OCR and scanned-page correction
  rebuilding are covered by engine tests.
- Hidden-info sanitization for metadata, XMP, embedded files,
  file-attachment annotations, comments, annotation actions, JavaScript name
  trees, hidden layer catalog entries, embedded search-index signals,
  stale incremental saves, unreferenced object signals, links/actions,
  thumbnails, and optional form-value reset.
- Basic preflight report and report PDF for hidden data, page boxes, forms,
  fonts, images, drawings, annotations, widgets, PDF/A claim signals, and
  OutputIntent diagnostics.
- Basic accessibility triage and repair for title/language, tag-structure
  signal, form fields, page text extraction, and image alt-text gaps.
- Basic compare engine command and report PDF for page-count, text, and
  render-delta reports with changed-area regions.
- Basic batch engine command for manifest-driven apply jobs with per-output
  validation, including 100-output corpus evidence.

## Explicitly Limited Until Implemented

- Full inline content-stream text editing.
- Arbitrary multi-column layout solving with movable figures/tables. The first
  reflow solver treats existing images, figures, tables, and captions as
  protected blocks and moves text around them; it blocks export when the edited
  text itself cannot be placed safely.
- OCR correction UI, scanned-PDF semantic edit mode beyond corrected invisible
  OCR layers, deskew/orientation preprocessing, and production OCR worker queues.
- Timestamped PAdES/LTV signing, revocation data, and enterprise trust stores.
- XFA forms and advanced AcroForm scripts/calculations.
- Full interconnected radio group authoring for newly created groups.
- PDF/A/PDF/X preflight fixups.
- Full optional-content artwork rewriting for complex hidden-layer page content.
- Full PDF/UA accessibility validation, reading-order repair, and tag-tree editing.
- Acrobat-style visual changed-area overlay UI and annotation/object diff.
- Saved action-builder UI and queued production workers.

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
