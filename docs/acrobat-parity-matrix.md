# Acrobat Parity Matrix

This matrix defines the 100-point target. A feature scores only when its save
behavior is verified with fixtures and compatibility checks.

| Area | Points | Current | Completion Evidence |
| --- | ---: | --- | --- |
| Core PDF compatibility | 15 | Strict local validation and qpdf are in place | 100+ corpus PDFs pass open/render/export/reopen |
| Edit PDF | 15 | Redaction plus replacement text; first-pass semantic paragraph reflow; new image/text objects | Text/image/vector fixtures roundtrip with 2px tolerance |
| Page organization | 8 | Delete, reorder, rotate, duplicate, extract | Merge/split/crop/replace plus bookmarks/links/forms remap |
| Comments/annotations | 8 | New annotations plus existing Square/FreeText/Highlight/Ink import/edit/delete path | Acrobat/Preview/Chrome annotations import/edit/delete/flatten |
| Forms | 10 | AcroForm text, checkbox, radio, combo, and list fill/save, engine flatten path | AcroForm fields fill/save/flatten with appearance regeneration |
| Signatures/security | 10 | Password-aware open/apply only | Image signatures and certificate signing validate in Acrobat |
| Redaction/sanitization | 10 | Redaction policies tested; hidden-info sanitizer removes metadata, XMP, embedded files, JavaScript/actions, links, and thumbnails | Hidden information sanitizer also covers hidden layers, comments, stale incremental data, search indexes, and unreferenced data |
| OCR/conversion | 8 | Not implemented | Searchable scanned PDFs with OCR correction |
| Accessibility | 6 | Not implemented | Tags, reading order, alt text, PDF/UA basic report |
| Print production/preflight | 5 | qpdf structural checks plus basic engine preflight for metadata, XMP, embedded files, JavaScript/actions, forms, fonts, images, drawings, annotations, and page boxes | PDF/A/X, font, image, color, page-box reports with fixups |
| Compare/batch automation | 4 | Not implemented | Compare report and saved batch action execution |
| Packaging/performance/support | 1 | Local web app | Desktop package, large-file benchmarks, crash recovery |

## Current Score

The current project is a verified advanced prototype, not an Acrobat Pro
replacement. It scores highest in save validation and has working first-pass
forms, imported annotations, hidden-info sanitization, and basic preflight
reporting. Signatures, OCR, accessibility, PDF/A/X preflight fixups, compare,
batch automation, and full object editing remain outside the completed support
boundary.

## Current Reflow Score Boundary

The current semantic reflow implementation is a first pass, not full Acrobat
inline editing. It groups extractable horizontal text into paragraph blocks,
moves downstream text in the same flow, avoids protected figure/image/caption
blocks, and can cascade moved text to following pages. It does not yet move
existing vector tables or original image objects as native PDF objects. Export
is blocked when the solver cannot produce a non-overlapping searchable text
layout.
