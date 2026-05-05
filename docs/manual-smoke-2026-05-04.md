# Manual Smoke Record - 2026-05-04

This file records external-viewer smoke status for the sanitizer, preflight,
and forms changes. It separates automated evidence from manual Acrobat/Preview
claims so release notes do not overstate compatibility.

Superseding note: general Acrobat/Preview/Chrome/Edge representative open/render
smoke is now complete in `docs/manual-compatibility-report.md` with 200/200
viewer checks. The rows in this older dated file remain feature-panel reminders
for sanitizer before/after comparison, Acrobat Preflight comparison, and detailed
form appearance inspection.

## Environment

- Repository: `/Users/sol/Desktop/pdfedit`
- Engine: PyMuPDF through `.venv/bin/python`
- Structural validator: qpdf required through `REQUIRE_QPDF=1`
- External apps discovered locally: Adobe Acrobat DC, Google Chrome

## Automated Evidence

| Area | Fixture | Evidence |
| --- | --- | --- |
| Sanitizer before/after | `tmp/engine-sanitizer-preflight/hidden-source.pdf` -> `hidden-sanitized.pdf` | Engine preflight detects metadata, XMP, embedded file, hidden layer/OCG signal, comments, annotation action, file attachment annotation, link action, JavaScript name tree, embedded search-index signal, stale incremental save, and unreferenced object signal before sanitization. After sanitization those counts are zero and raw secret strings are absent. |
| Preflight report before/after | Same fixture | `pdf_engine.py preflight` reports hidden-info warnings before sanitization and no hidden-info warnings after sanitization. This is report-only; no preflight fixup claim is made. |
| Forms radio/combo/list | `tmp/engine-forms/input.pdf` -> `filled.pdf` | Engine form test verifies text, checkbox, radio, combo, and list values after save, plus required flags, default values, export values, explicit tab order, and appearance streams. |
| Basic form field creation | `tmp/engine-forms/input.pdf` -> `created.pdf` | Engine form test verifies newly created text, checkbox, radio, combo, and list fields are saved as real AcroForm widgets with values, choices, required/default metadata, tab order, and appearance streams. Playwright verifies the UI-created text field reopens as a widget. |
| XFDF export/import | `tmp/engine-forms-xfdf/form.pdf` -> `imported.pdf` | `forms-export` writes supported field values to XFDF and `forms-import` writes modified text/checkbox values back into real AcroForm widgets. |
| Visible signatures | `tmp/engine-signature-simple/signed.pdf` | Typed, drawn, and image signature appearances are written into page content and validated by text extraction/image inspection. These are not certificate digital signatures. |
| Certificate digital signature | `tmp/engine-digital-signature/signature-signed.pdf` | Engine creates a real signature field, signs `/ByteRange` with OpenSSL CMS, PyMuPDF reports the widget as signed, qpdf validates structure, and a same-length tamper fixture fails signature validation. Acrobat trust UI smoke remains pending. |
| OCR searchable PDF | `tmp/engine-ocr-searchable/scanned-source.pdf` -> `ocr-output.pdf` | Source fixture is image-only with no extractable text. Engine OCR writes an image-over-text searchable PDF; qpdf validates and text extraction returns `OCR TEST 123`. Korean language data is checked by `ensure:ocr`, but Korean recognition corpus smoke remains pending. |
| Password permissions | `tmp/engine-password-permissions/encrypted.pdf` | Engine saves AES-256 user/owner password output, validates with password-aware PyMuPDF/qpdf, and verifies unauthenticated text extraction is blocked. |
| Compare/preflight/accessibility reports | `tmp/engine-compare/compare-report.pdf`, `tmp/engine-preflight-report/preflight-report.pdf`, accessibility JSON | Engine tests verify generated compare/preflight report PDFs and basic accessibility title/language/tag-structure reporting. |
| XFA/signature detection | `tmp/engine-forms/xfa-signature.pdf` | Engine preflight reports `xfaPresent: true` and `signatureFieldCount: 1`; XFA editing and digital signing remain unsupported. |

## External Viewer Manual Status

| Viewer | Sanitizer before/after | Preflight before/after | Radio/combo/list display | Status |
| --- | --- | --- | --- | --- |
| Google Chrome | Representative package open/render pass; deep before/after inspection still required above 90 | Representative package open/render pass; deep report comparison still required above 90 | Representative package open/render pass; detailed appearance inspection still required above 90 | General smoke passed; feature-panel smoke remains |
| macOS Preview | Representative package open/render pass; deep before/after inspection still required above 90 | Representative package open/render pass; deep report comparison still required above 90 | Representative package open/render pass; detailed appearance inspection still required above 90 | General smoke passed; feature-panel smoke remains |
| Adobe Acrobat DC / Acrobat Pro | Representative package open/render pass; deep before/after inspection still required above 90 | Representative package open/render pass; Acrobat Preflight comparison still required above 90 | Representative package open/render pass; detailed appearance inspection still required above 90 | General smoke passed; feature-panel smoke remains |

## Release Note Boundary

- Preflight remains report-only.
- PDF/A and PDF/X validation require veraPDF or a professional SDK before they
  can be claimed.
- Certificate digital signatures now have automated CMS/ByteRange coverage, but
  timestamp/LTV, trusted certificate policy, and Acrobat trust-chain UI remain
  outside the supported boundary.
- OCR now has local searchable-PDF coverage, but OCR correction UI, Korean
  recognition fixtures, and scanned-PDF semantic editing remain outside the
  supported boundary.
- XFA editing and full optional-content artwork rewriting remain outside the
  supported boundary.
