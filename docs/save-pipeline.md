# Save Pipeline

The export path is designed to preserve PDF behavior instead of rasterizing the document.

## Browser Flow

1. Build an engine payload from current page order, rotations, metadata, save mode, redaction policy, sanitizer options, annotations, form field values, and source text edits.
2. Send the payload to `/api/pdf/apply`.
3. If the engine succeeds, receive edited PDF bytes.
4. Re-open the exported PDF with PDF.js and check the expected page count.
5. Ask the engine validation endpoint for PyMuPDF/qpdf metrics when available.
6. When requested, run the preflight endpoint before export or after export to
   surface hidden data, page boxes, forms, fonts, images, drawings,
   annotations, OCG/layer signals, XFA, signature fields, stale incremental
   saves, and unreferenced-object signals.
7. Download only after validation passes.
8. If the engine is unavailable, fall back to the browser `pdf-lib` writer only for basic operations.

## Engine Flow

1. Open the source PDF and authenticate when a password is provided.
2. Copy requested source pages into the output document.
   Page items may copy from the source document, create a blank page, or insert
   a page from an external donor PDF supplied as `sourcePdfBase64`.
3. Apply redaction for source text replacement, explicit redaction boxes, and
   cross-page moved text source regions using the selected redaction policy.
   Existing image move operations redact the original visual area before the
   extracted image is inserted at the target rectangle.
4. Insert replacement text, moved semantic reflow text, images, simple
   signature appearances, shapes, and ink.
5. Use `flowSlice` only for non-text visual fallback work; searchable text
   reflow must be emitted as text operations.
6. In native mode, write supported user annotations as PDF annotation objects.
7. Write metadata.
8. Fill imported AcroForm text, checkbox, radio, combo, and list fields while
   preserving appearance streams and supported required/default/export values.
   When provided, explicit form tab order is saved with page annotation order
   and `/Tabs /A`.
9. Create new basic AcroForm text, checkbox, radio, combo, and list fields as
   real PDF Widget annotations when a form operation includes `create: true`.
10. Flatten form fields when requested.
11. Remove hidden information when `saveOptions.sanitize` is true.
12. Apply AES-256 user/owner password encryption and permission flags when
    requested.
13. Save with garbage collection, compression, and cleanup.

## Validation

`engine/pdf_engine.py validate` and `/api/pdf/validate` open the produced PDF with PyMuPDF, load every page, count annotations, collect page sizes, check extractable text length, and optionally run `qpdf --check` when `qpdf` exists on the machine.

The browser also validates exported bytes with PDF.js before presenting the download.

When `REQUIRE_QPDF=1`, engine validation fails unless `qpdf --check` actually
runs. Local verification and CI use this strict mode.

`engine/pdf_engine.py preflight` and `/api/pdf/preflight` add a product-facing
inspection report for hidden data and document structure: metadata, XMP,
embedded files, JavaScript/actions, form fields, fonts, page boxes, images,
drawings, annotations, widgets, OCG/layer signals, XFA, signature fields,
stale incremental saves, explicit tab-order pages, and unreferenced-object
signals. It also reports PDF/A/PDF/X claim signals and OutputIntent counts. This
is report-only and is not PDF/A or PDF/X certification.

`engine/pdf_engine.py preflight --report report.pdf` writes the same inspection
summary as a PDF report for release evidence and manual review.

`engine/pdf_engine.py accessibility` returns a basic accessibility triage report
for title/language, tag-structure presence, form fields, page text extraction,
and image alt-text gaps. `engine/pdf_engine.py accessibility-repair` can persist
title/language, a basic tag-structure signal, page tab-order source, and image
alt-text metadata. It does not validate PDF/UA.

If the preflight endpoint is unavailable, the UI command falls back to the
engine validation endpoint and displays a warning that only structural
validation ran. Hidden-data release claims still require the full preflight
endpoint and sanitizer fixtures.

## Export Modes

- `flatten`: writes visible edits into page content streams.
- `native`: stores new text boxes, highlights, rectangles, and ink as PDF annotations when safe. Source text replacement and redaction remain destructive content edits.
- In native mode, CJK text boxes are flattened with the embedded editor font instead of being saved as unsupported Base14 FreeText annotations.

## Fallback Rules

Browser fallback is allowed only for basic flatten operations. Existing text
replacement, redaction, native annotation export, password-backed PDFs, and
semantic reflow require the PyMuPDF engine. When `VITE_STRICT_ENGINE=true`,
any export without a successful engine response fails loudly.

## Test Matrix

- `engine-smoke.mjs`: CLI/API roundtrip, metadata, native annotations, password-aware extraction, and preflight endpoint smoke.
- `engine-redaction-policy.mjs`: text-only, visual-area, and image-and-text redaction semantics plus raw text absence.
- `engine-sanitizer-preflight.mjs`: hidden-info sanitization removes metadata, XMP, embedded files, file-attachment annotations, comments, annotation actions, JavaScript/name trees, link actions, hidden-layer catalog signals, search-index signals, stale incremental saves, and unreferenced object signals, then verifies the preflight report and raw-byte absence.
- `engine-render-diff.mjs`: saved edit locality with qpdf validation and text extraction checks.
- `engine-page-ops.mjs`: reorder, duplicate, rotate, mixed page geometry roundtrip.
- `engine-page-merge-external.mjs`: external PDF page insertion plus blank page
  insertion with qpdf validation.
- `engine-reflow.mjs`: cross-page semantic reflow operations keep moved text searchable.
- `engine-forms.mjs`: text, checkbox, radio, combo, and list AcroForm fill/save, new basic field creation, required/default/export values, explicit tab order, appearance streams, XFA detection, signature-field import reporting, plus flatten.
- `engine-forms-xfdf.mjs`: XFDF export/import for supported field values.
- `engine-form-signature-field.mjs`: real signature widget creation through the form engine.
- `engine-password-permissions.mjs`: encrypted output, user/owner passwords,
  permission flags, authenticated validation, and qpdf encryption inspection.
- `engine-signature-simple.mjs`: typed, drawn, and image signature appearances
  written into PDF page content.
- `engine-digital-signature.mjs`: real signature field creation, ByteRange
  patching, OpenSSL CMS signing, DocMDP lock policy encoding, signature
  validation, and tamper detection.
- `engine-ocr-searchable.mjs`: scanned image-only PDF to searchable
  image-over-text PDF with Tesseract-backed OCR, text extraction, and qpdf
  validation.
- `engine-ocr-korean-correction.mjs`: Korean OCR corpus plus scanned-page OCR
  correction rebuilding with stale OCR text-layer replacement.
- `engine-image-move.mjs`: existing image extraction, source-region redaction,
  and target-region insertion.
- `engine-vector-object-edit.mjs`: vector drawing extraction and delete through
  graphics redaction.
- `engine-file-attachment-annotation.mjs`: real file attachment comment creation.
- `engine-page-bookmark-remap.mjs`: bookmark remap after page reorder.
- `engine-compare.mjs`: compare JSON plus changed-area regions and generated report PDF.
- `engine-batch-100.mjs`: 100-output local batch manifest validation.
- `engine-preflight-report.mjs`: preflight report PDF generation.
- `engine-preflight-standards-signals.mjs`: PDF/A claim and OutputIntent
  diagnostics.
- `engine-accessibility-report.mjs`: document title/language and accessibility
  triage report generation.
- `engine-accessibility-repair.mjs`: basic accessibility repair for
  title/language/tag signal/tab source/image alt text.
- `engine-large-document.mjs`: 100/300/500-page generated corpus validation.
- `pdf-editor.spec.ts`: browser editing, export/reopen, metadata/page duplication, AcroForm text/checkbox/choice fields, new text field creation as a real widget, and engine-required fallback blocking.

## Redaction Policies

- `textOnly`: removes extractable text under the target area and keeps image/vector content unchanged.
- `visualArea`: removes extractable text and pixel-cleans touched image/vector areas.
- `imagesAndText`: removes extractable text and removes touched image/vector content.
