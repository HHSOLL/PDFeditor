# Engine Contract

The engine is the source of truth for operations that mutate PDF structure.
The browser editor can preview edits, but engine output decides whether a
feature is real.

## Payload

```json
{
  "pdfBase64": "<source bytes>",
  "password": "<optional password>",
  "pages": [{ "sourceIndex": 0, "rotation": 0 }],
  "operations": [],
  "metadata": {},
  "saveOptions": {
    "annotationMode": "flatten",
    "redactionMode": "textOnly",
    "validate": true
  }
}
```

## Engine-Required Operations

- Existing text replacement.
- Redaction.
- Native annotation export.
- Password-backed PDFs.
- Existing annotation delete/replace.
- Flow-slice reflow.
- Future forms, signatures, sanitization, OCR, and preflight operations.

## Validation Response

The engine validation response must include:

- `ok`
- `pageCount`
- `encrypted`
- `annotationCount`
- `textLength`
- `pageSizes`
- `qpdfChecked`
- `errors`

When `REQUIRE_QPDF=1`, `qpdfChecked` must be true and qpdf failures are fatal.
