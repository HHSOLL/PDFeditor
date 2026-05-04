# Save Pipeline

The export path is designed to preserve PDF behavior instead of rasterizing the document.

## Browser Flow

1. Build an engine payload from current page order, rotations, metadata, save mode, redaction policy, sanitizer options, annotations, form field values, and source text edits.
2. Send the payload to `/api/pdf/apply`.
3. If the engine succeeds, receive edited PDF bytes.
4. Re-open the exported PDF with PDF.js and check the expected page count.
5. Ask the engine validation endpoint for PyMuPDF/qpdf metrics when available.
6. When requested, run the preflight endpoint before export or after export to
   surface hidden data, page boxes, forms, fonts, images, drawings, and
   annotations.
7. Download only after validation passes.
8. If the engine is unavailable, fall back to the browser `pdf-lib` writer only for basic operations.

## Engine Flow

1. Open the source PDF and authenticate when a password is provided.
2. Copy requested source pages into the output document.
3. Apply redaction for source text replacement, explicit redaction boxes, and
   cross-page moved text source regions using the selected redaction policy.
4. Insert replacement text, moved semantic reflow text, images, shapes, and ink.
5. Use `flowSlice` only for non-text visual fallback work; searchable text
   reflow must be emitted as text operations.
6. In native mode, write supported user annotations as PDF annotation objects.
7. Write metadata.
8. Fill imported AcroForm text, checkbox, radio, combo, and list fields.
9. Flatten form fields when requested.
10. Remove hidden information when `saveOptions.sanitize` is true.
11. Save with garbage collection, compression, and cleanup.

## Validation

`engine/pdf_engine.py validate` and `/api/pdf/validate` open the produced PDF with PyMuPDF, load every page, count annotations, collect page sizes, check extractable text length, and optionally run `qpdf --check` when `qpdf` exists on the machine.

The browser also validates exported bytes with PDF.js before presenting the download.

When `REQUIRE_QPDF=1`, engine validation fails unless `qpdf --check` actually
runs. Local verification and CI use this strict mode.

`engine/pdf_engine.py preflight` and `/api/pdf/preflight` add a product-facing
inspection report for hidden data and document structure: metadata, XMP,
embedded files, JavaScript/actions, form fields, fonts, page boxes, images,
drawings, annotations, and widgets. This is not yet PDF/A or PDF/X
certification.

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
- `engine-sanitizer-preflight.mjs`: hidden-info sanitization removes metadata, XMP, embedded files, and JavaScript/actions, then verifies the preflight report.
- `engine-render-diff.mjs`: saved edit locality with qpdf validation and text extraction checks.
- `engine-page-ops.mjs`: reorder, duplicate, rotate, mixed page geometry roundtrip.
- `engine-reflow.mjs`: cross-page semantic reflow operations keep moved text searchable.
- `engine-forms.mjs`: text, checkbox, radio, combo, and list AcroForm fill/save plus flatten.
- `engine-large-document.mjs`: 100/300/500-page generated corpus validation.
- `pdf-editor.spec.ts`: browser editing, export/reopen, metadata/page duplication, AcroForm text/checkbox/choice fields, and engine-required fallback blocking.

## Redaction Policies

- `textOnly`: removes extractable text under the target area and keeps image/vector content unchanged.
- `visualArea`: removes extractable text and pixel-cleans touched image/vector areas.
- `imagesAndText`: removes extractable text and removes touched image/vector content.
