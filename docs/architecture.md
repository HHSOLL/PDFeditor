# Architecture

PDF Studio is split into three runtime layers.

## Browser Editor

`src/main.ts` owns the current browser app:

- PDF.js renders pages and extracts text maps.
- The editor model stores page items, annotations, metadata, save mode, redaction policy, and undo/redo snapshots.
- The render layer, source text layer, source mask layer, flow slice layer, and editable overlay layer are kept separate.
- Export payloads are serialized in normalized page coordinates.

The viewer canvas is treated as immutable page rendering. Editing changes update the overlay layer instead of repainting the canvas on every keystroke.

## Engine Server

`server/pdf-engine-server.mjs` exposes:

- `GET /api/health`
- `POST /api/pdf/apply`
- `POST /api/pdf/validate`
- `POST /api/pdf/extract`

It keeps the browser app isolated from Python/PyMuPDF process execution and gives production builds one local HTTP bridge.

## PDF Engine

`engine/pdf_engine.py` applies actual PDF mutations with PyMuPDF:

- page copy, reorder, and rotation
- redaction-backed text replacement
- text, image, shape, ink insertion
- flow slice capture and reinsertion
- native annotation mode for safe text boxes, highlights, rectangles, and ink
- CJK text fallback to flattened embedded-font content when native FreeText would be unsafe
- metadata write
- output validation with PDF.js, PyMuPDF metrics, and optional `qpdf --check` when qpdf is installed

## Design Rules

- Store all persistent editor objects in normalized PDF page coordinates.
- Do not export screenshots as the final PDF.
- Use redaction for destructive removal, not white rectangles only.
- Keep native annotations optional because some users need flattened immutable PDFs.
- Re-open exported PDFs before claiming the save succeeded.
- Require qpdf in local verification so structural validation is not silently skipped.
- Do not use browser fallback for engine-required operations such as redaction or existing text replacement.
