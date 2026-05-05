# Security And Redaction Policy

## Redaction Modes

- `textOnly`: remove extractable PDF text in the selected region while leaving
  image and vector content unchanged.
- `visualArea`: remove extractable text and clean the visible touched image or
  vector area.
- `imagesAndText`: remove extractable text and remove touched image/vector
  objects.

## Completion Criteria

Redaction is complete only when:

- Sensitive text is absent from `get_text()`.
- Sensitive text is absent from raw PDF bytes.
- qpdf validation passes.
- The rendered area reflects the selected policy.
- Unreferenced objects and hidden data have been inspected.

## Sanitization Target

The implemented sanitizer currently removes metadata, XMP, embedded files,
file-attachment annotations, comments, annotation actions, JavaScript/actions,
catalog open actions, JavaScript name trees, link actions, hidden layer catalog
signals, embedded search-index catalog signals, thumbnails, stale incremental
save sections, unreferenced object signals, and optionally stored form values.
Sanitized output must also pass qpdf validation and must not contain the
removed fixture secrets in raw PDF bytes.

The remaining Acrobat-class sanitization target is broader: complex optional
content artwork rewriting, obscured content analysis, and specialized PDF
features still require larger third-party corpora and Acrobat Pro manual
verification before they can be claimed as fully supported.
