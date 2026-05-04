# Compatibility Policy

## Automated Compatibility

- PDF.js reopen and page count validation.
- PyMuPDF reopen, page load, text length, annotation count, and page size checks.
- qpdf structural validation.
- Render-diff tests for changed versus unchanged regions.
- Text extraction tests for replacement and redaction behavior.

## Manual Compatibility

Record manual smoke results for:

- Acrobat Reader.
- Acrobat Pro when available.
- Chrome.
- Edge.
- macOS Preview.

Manual smoke is required before release for any engine output change.

## Corpus Policy

Each fixture documents the behavior it protects. The corpus should grow toward
100+ files covering generated, Acrobat-created, Preview-created, browser-printed,
Office-exported, government form, image-heavy, vector-heavy, encrypted,
malformed, and scanned PDFs.
