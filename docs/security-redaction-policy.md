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

Full sanitization must remove metadata, XMP, embedded files, JavaScript,
actions, hidden layers, comments, stored form data, embedded search indexes,
stale incremental-save data, and unreferenced objects.
