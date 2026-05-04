# Save Pipeline

The export path is designed to preserve PDF behavior instead of rasterizing the document.

## Browser Flow

1. Build an engine payload from current page order, rotations, metadata, save mode, annotations, and source text edits.
2. Send the payload to `/api/pdf/apply`.
3. If the engine succeeds, receive edited PDF bytes.
4. Re-open the exported PDF with PDF.js and check the expected page count.
5. Download only after validation passes.
6. If the engine is unavailable, fall back to the browser `pdf-lib` writer for basic operations.

## Engine Flow

1. Open the source PDF and authenticate when a password is provided.
2. Copy requested source pages into the output document.
3. Capture flow slice images before redaction.
4. Apply redaction for source text replacement, redaction boxes, and moved flow slices.
5. Insert replacement text, images, shapes, ink, and flow slices.
6. In native mode, write supported user annotations as PDF annotation objects.
7. Write metadata.
8. Save with garbage collection, compression, and cleanup.

## Validation

`engine/pdf_engine.py validate` and `/api/pdf/validate` open the produced PDF with PyMuPDF, load every page, and optionally run `qpdf --check` when `qpdf` exists on the machine.

The browser also validates exported bytes with PDF.js before presenting the download.

## Export Modes

- `flatten`: writes visible edits into page content streams.
- `native`: stores new text boxes, highlights, rectangles, and ink as PDF annotations when safe. Source text replacement and redaction remain destructive content edits.
