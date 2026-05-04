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
JavaScript/actions, catalog open actions, name trees, links/actions,
thumbnails, and optionally stored form values. Sanitized output must also pass
qpdf validation and must not contain the removed secrets in raw PDF bytes.

The remaining Acrobat-class sanitization target is broader: hidden layers,
comments, embedded search indexes, stale incremental-save data, unreferenced
objects, obscured content, and specialized PDF features still require explicit
fixtures and verification before they can be claimed as supported.
