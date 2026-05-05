# Acrobat Parity Matrix

This matrix is the release gate for any "Acrobat Pro grade" claim. A feature is
credited only when it is saved into PDF structure, reopened, and validated by
automated fixtures. UI-only buttons, overlay-only previews, and screenshot-based
exports score zero.

## Scoring Snapshot

Current automated score: **84 / 100**.

External replacement readiness is tracked separately in
`docs/acrobat-replacement-score.md`. The current external score is **80 / 100
verified**, and an external 90+ claim is not allowed until the manual
compatibility and packaging gates in that document are complete.

This is a verified advanced prototype. It is not yet an Acrobat Pro replacement.
The strongest areas are continuous viewer behavior, qpdf/PyMuPDF/PDF.js export
validation, imported annotations, AcroForm filling and field creation including
signature widgets, XFDF import/export, report-only preflight with report PDF
export and PDF/A claim diagnostics, hidden-info sanitizer coverage, engine-backed
page organization including external PDF page insertion and bookmark remapping,
CMS ByteRange certificate signing with DocMDP lock policy, local OCR searchable
PDF export with Korean corpus and scanned-page correction rebuilding, simple
visible signatures, password/permission saving, existing image move/delete/replace
paths including UI-driven `moveImage`, vector delete, file attachment comments,
inspector compare report download, inspector batch quick actions, changed-region
compare report data, 100-job batch apply evidence, and smoke-tested local release
packaging. Timestamped PAdES/LTV trust, full
PDF/UA validation, PDF/A/X certification/fixups, full vector editing,
saved action-builder UI, native/managed production deployment, and broad
Acrobat/Preview/Chrome/Edge visual smoke remain non-claimable.

| Area | Target Points | Current Points | Current Status | Automated Evidence | Completion Criteria | Remaining Work |
| --- | ---: | ---: | --- | --- | --- | --- |
| Core PDF compatibility | 10 | 8 | Strict engine validation, qpdf-required local verification, PDF.js reopen checks, PyMuPDF validation metrics, expanded engine corpus for page ops/redaction/image/compare/batch/encryption/signature/XFDF/accessibility-report | `tests/engine-smoke.mjs`, `tests/engine-render-diff.mjs`, `tests/engine-page-ops.mjs`, `tests/engine-page-merge-external.mjs`, `tests/engine-password-permissions.mjs`, `tests/engine-signature-simple.mjs`, `tests/engine-forms-xfdf.mjs`, `tests/engine-accessibility-report.mjs`, `tests/pdf-editor.spec.ts`, `npm run verify:local` | 100+ corpus PDFs pass open/render/export/reopen with qpdf, PyMuPDF, PDF.js, and documented Acrobat/Preview/Chrome smoke | Expand third-party corpus, add Acrobat/Preview/Chrome visual smoke records for every release gate |
| Continuous viewer / performance | 8 | 5 | Continuous page stack, independent center viewport, page-scoped metrics, lazy page rendering path | `tests/pdf-editor.spec.ts`, `tests/engine-large-document.mjs` | 100/300/500/1000 page PDFs open without eager canvas rendering; first page visible time recorded; side panels never scroll with document | Add 1000-page fixture, record rendered canvas count and rough memory ceiling |
| Text editing / semantic reflow | 14 | 5 | Redaction plus replacement, first-pass paragraph reflow, protected figure/caption avoidance, cross-page cascade tests | `tests/engine-reflow.mjs`, `tests/pdf-editor.spec.ts` reflow cases | Paragraph font/size/color/alignment edits preserve structure, avoid figure/table/caption collisions, cascade across pages, save searchable text, and remove replaced raw/source text | Improve columns/tables/RTL/emoji handling, native movement of source images/vector tables, Acrobat/Preview manual smoke |
| Native image/vector/object editing | 8 | 7 | Existing image detection plus engine-backed delete/replace/move path removes or redacts the source image area; UI source-image reposition emits `moveImage`; vector drawings are extracted and `deleteVector` removes touched line art through PDF redaction graphics removal | `tests/engine-image-object-edit.mjs`, `tests/engine-image-move.mjs`, `tests/engine-vector-object-edit.mjs`, source image coverage inside `tests/engine-smoke.mjs`, image move UI regression in `tests/pdf-editor.spec.ts` | Existing images can be selected/moved/resized/rotated/cropped/deleted/replaced; image data and vector paths are actually removed or rewritten | Add image crop/rotate UI polish, vector move/color/stroke editing, object inspector, image raw-byte corpus |
| Page organization | 8 | 8 | Delete, reorder, rotate, duplicate, extract, blank page insertion, external PDF page insertion, cropBox persistence, resize/mediaBox persistence, mixed page size roundtrip, and source bookmark remapping for reordered primary-source pages | `tests/engine-page-ops.mjs`, `tests/engine-page-merge-external.mjs`, `tests/engine-page-bookmark-remap.mjs`, `tests/pdf-editor.spec.ts` | Insert blank/from PDF, merge, split, crop, resize, replace pages while preserving bookmarks, links, labels, forms, annotations, named destinations | Add split/replace UI polish, richer link/named-destination remap corpus, manual Acrobat/Preview smoke |
| Comments / annotations | 7 | 5 | Existing source annotation import/edit/delete for common annotation types, native export and flatten paths, plus engine-backed file attachment comment creation | `tests/engine-smoke.mjs`, `tests/engine-file-attachment-annotation.mjs`, annotation cases in `tests/pdf-editor.spec.ts` | Acrobat/Preview/Chrome-created Sticky, FreeText, Highlight, Underline, Strikeout, Squiggly, Ink, Line, Arrow, Rectangle, Circle, Polygon, Stamp, file attachment comments import/edit/delete/flatten | Add reply threads, stamps, XFDF/FDF comment import/export, cross-viewer corpus |
| AcroForm | 10 | 9 | Text, checkbox, radio, combo, list fill/save; new text/checkbox/radio/combo/list/signature field creation; required/default/export values; appearance streams; tab order; XFDF export/import; XFA detection | `tests/engine-forms.mjs`, `tests/engine-forms-xfdf.mjs`, `tests/engine-form-signature-field.mjs`, form UI cases in `tests/pdf-editor.spec.ts` | Full form edit/delete/move/resize workflows, richer field metadata UI, tab order editor, appearance regeneration corpus, flatten, FDF/XFDF, signature fields, XFA unsupported warning or limited support | Add richer appearance compatibility corpus, manual Acrobat/Preview/Chrome form smoke |
| Signatures / security | 8 | 7 | Typed/drawn/image signature appearances; AES-256 user/owner password encryption; real signature field creation with `/ByteRange`, `/Contents`, `/Adobe.PPKLite`, detached CMS signing through OpenSSL, validation that detects tampering, and DocMDP lock policy encoding | `tests/engine-signature-simple.mjs`, `tests/engine-digital-signature.mjs`, `tests/engine-password-permissions.mjs`, `tests/engine-smoke.mjs` password paths | Signature field creation, CMS/PKCS#7 or PAdES ByteRange signing, timestamp, validation, signed-document lock, Acrobat-visible permission policies | Add timestamp/LTV/revocation data, trusted certificate policy UI, Acrobat signature validation smoke |
| Full redaction / sanitizer | 10 | 7 | Real redaction policies; literal search, regex, whole-page redaction; sanitizer removes metadata, XMP, embedded files, file attachment annotations, comments, annotation actions, JavaScript/name trees, link actions, hidden layer catalog entries, search-index signals, stale incremental saves, unreferenced object signals, thumbnails | `tests/engine-sanitizer-preflight.mjs`, `tests/engine-search-redaction.mjs`, redaction tests in `tests/engine-smoke.mjs` | Search/regex/whole-page redaction plus full hidden-data sanitizer leaves no secrets in text extraction, raw bytes, xref scan, unreferenced data, attachments, JS/actions, OCG, comments, stale history | Add third-party hidden-data corpus, obscured content removal, multimedia/RichMedia, Acrobat Pro sanitizer manual smoke |
| OCR / scanned PDF editing | 7 | 6 | Local Tesseract-backed OCR status checks, English and Korean scanned image-over-text PDF export, scanned-page correction rebuilding that replaces stale OCR text layers with corrected invisible searchable text, and inspector UI for OCR status/run/correction | `tests/ensure-ocr.mjs`, `tests/engine-ocr-searchable.mjs`, `tests/engine-ocr-korean-correction.mjs`, OCR UI cases in `tests/pdf-editor.spec.ts`, CI installs Tesseract English/Korean language data | Scanned Korean/English PDFs become searchable/editable with OCR text layer, correction UI, image-over-text save, qpdf/PyMuPDF validation | Add selection-based correction UI, cloud/queue OCR worker, deskew/orientation preprocessing |
| Accessibility / PDF/UA | 6 | 4 | Basic accessibility report plus inspector-accessible structural repair for title, document language, MarkInfo/StructTreeRoot signal, page tab order, and image object alternate-text metadata | `tests/engine-accessibility-report.mjs`, `tests/engine-accessibility-repair.mjs`, accessibility UI cases in `tests/pdf-editor.spec.ts` | Document title/language, tag tree import/edit, reading order, alt text, artifacts, form descriptions, PDF/UA basic report and tagged save | Add real tag-tree editor, reading-order authoring, artifact marking, PDF/UA validator, tagged corpus |
| Preflight / PDF/A / PDF/X / print production | 6 | 4 | Report-only preflight for structure, hidden-info signals, forms, fonts, page boxes, images, drawings, annotations, XFA/signature indicators, PDF/A/PDF/X claim diagnostics, OutputIntent signals, plus generated report PDF | `tests/engine-sanitizer-preflight.mjs`, `tests/engine-preflight-report.mjs`, `tests/engine-preflight-standards-signals.mjs`, `docs/manual-smoke-2026-05-04.md` | PDF/A and PDF/X validation, font/image/color/pagebox/ICC/spot/overprint/transparency checks, output preview, report export, limited fixups verified against Acrobat Pro | Keep fixups/certification unclaimed; evaluate veraPDF/pro SDK; add PDF/A/X corpus and manual comparison |
| Compare files | 3 | 3 | Engine CLI/API returns page count changes, changed page list, text previews, render-diff metrics, changed-area bounding regions, report PDF, and inspector UI can select a target PDF and download the report | `tests/engine-compare.mjs`, compare UI case in `tests/pdf-editor.spec.ts`, compare endpoint in `tests/release-smoke.mjs` | Text/render/annotation/page/object diff with changed-area overlay and report PDF | Add annotation/object diff and Acrobat-style interactive overlay UI |
| Batch action / automation | 3 | 3 | Engine manifest runner applies PDF jobs with per-job validation and failure reporting; inspector quick action applies watermark, search redaction, and sanitizer; tested with text insertion, search redaction, sanitizer jobs, and a 100-output batch corpus | `tests/engine-batch-action.mjs`, `tests/engine-batch-100.mjs`, batch UI case in `tests/pdf-editor.spec.ts`, batch endpoint in `tests/release-smoke.mjs` | Saved action builder runs OCR, sanitize, redact, watermark, flatten, split/merge, preflight, convert across 100 PDFs with logs and failure report | Add saved action UI, queue/worker model, OCR/convert/preflight steps |
| Packaging / deployment / productization | 2 | 2 | Local web app with Python engine server, strict local verification, production-server release smoke, and a smoke-tested local release package with launcher | `npm run verify:local`, `npm run test:release-smoke`, `npm run test:package-smoke`, GitHub Actions strict engine path | Web deployment, queued workers, object storage, auth, billing, audit logs, virus scan, retention policy, desktop/local package, crash recovery | Build native desktop package or managed web deployment with logs and recovery |

## Non-Claimable Boundaries

- **Preflight fixups:** current preflight is report-only. PDF/A/X certification and fixups require veraPDF, a professional SDK, or an equivalent validated engine.
- **Digital signatures:** CMS ByteRange signing, DocMDP lock policy encoding, and cryptographic validation are implemented. Timestamping, LTV/revocation data, and enterprise trust stores are not claimed.
- **OCR:** local searchable-PDF OCR, Korean fixture coverage, and scanned-page correction rebuilding are implemented. Browser correction UI, scanned semantic text editing beyond corrected invisible text layers, deskew/orientation preprocessing, and production OCR queues are not claimed.
- **Accessibility/PDF/UA:** basic reporting and structural repair for title/language/tag signal/alt text exist, but full tag-tree editing, reading-order repair, artifact marking, and PDF/UA checks are not implemented.
- **Native vector editing:** vector detection/delete is implemented and image move is UI-accessible; vector movement, color/stroke editing, and object inspector workflows are not complete.
- **Compare:** current compare has JSON/report PDF output, changed-area regions, and inspector-triggered report download, but not an Acrobat-style interactive overlay UI with annotation/object diff.
- **Batch automation:** current batch support is a validated 100-job engine manifest runner plus inspector quick action, not a saved action-builder UI or queued production worker.
- **Full Acrobat parity:** no 100-point claim is allowed until every row above reaches its completion criteria and manual smoke records are complete.

## Current Reflow Boundary

The current semantic reflow implementation is a first pass. It groups
extractable horizontal text into paragraph blocks, moves downstream text in the
same flow, avoids protected figure/image/caption blocks, and can cascade moved
text to following pages. It does not yet natively move existing vector tables or
original image objects. Export is blocked when the solver cannot produce a
non-overlapping searchable text layout.
