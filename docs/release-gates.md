# Release Gates

## Local Gate

```bash
npm run verify:local
```

This requires qpdf and strict engine mode.
Playwright starts fresh Vite and engine servers by default so E2E tests cannot
accidentally validate stale local processes. Set `PLAYWRIGHT_REUSE_SERVER=1`
only for deliberate interactive debugging.

## Feature Gate

Every new PDF feature must include:

- A generated or checked-in fixture.
- Engine roundtrip verification.
- PDF.js reopen verification.
- qpdf validation.
- Text extraction assertions when text is involved.
- Render-diff or page geometry assertions when layout is involved.
- Documentation update for support limits.
- Hidden-data assertions when sanitizer or redaction behavior is involved.
- Preflight report assertions when document structure or hidden-info reporting
  changes.
- Compare changes must include text/page/render-delta assertions and make clear
  whether the output is JSON-only, report-PDF output, or a user-facing visual
  overlay.
- Batch action changes must include multi-job success/failure reporting and
  per-output validation assertions.
- Encryption/security changes must include authenticated validation and qpdf
  encryption inspection.
- Signature changes must distinguish visible signature appearances from
  certificate-backed digital signing, and certificate claims require Acrobat
  validation evidence.
- Form interchange changes must include import and export assertions for the
  same field corpus.
- Accessibility changes must state whether they are triage reports, PDF/UA
  validation, or tag-tree repair.

## UI Gate

- `window.scrollY` must stay `0` while navigating the document.
- `.canvas-area.scrollTop` is the only central document scroll state.
- Rail, sidebar, and inspector bounding boxes must stay fixed while the center
  viewport scrolls.
- Active thumbnail sync must scroll only `.page-list`.
- Implemented UI commands must be enabled only when they can run. Unsupported
  commands are hidden or disabled with a reason; enabled no-op buttons are a
  release blocker.

## Reflow Gate

- The semantic solver must try to place edited text before export blocking.
- Downstream text must remain searchable after save.
- Protected images, figures, tables, and captions must not be overlapped by
  moved text.
- Export may be blocked only when the solver returns unresolved collisions or
  the edited block itself cannot be placed safely.

## Compatibility Gate

Before release, record manual smoke results for Acrobat Reader, Chrome, and
macOS Preview. Acrobat Pro is required for redaction/sanitization, signatures,
forms, preflight, and accessibility release claims.

Manual smoke records live in dated files under `docs/manual-smoke-*.md`.
Automated Chrome/Playwright evidence is not a substitute for Acrobat Pro or
Preview visual confirmation when the claim is about external viewer
compatibility.

## Sanitization And Preflight Gate

- Sanitizer changes must prove removed secrets are absent from raw PDF bytes.
- Preflight changes must include both positive and cleaned-document assertions.
- qpdf validation remains mandatory after sanitization.
- Preflight is report-only. Do not claim automatic preflight fixups.
- Do not claim PDF/A, PDF/X, accessibility, or professional preflight
  certification until veraPDF or a professional SDK is integrated and checked
  against dedicated fixtures.

## Current 80+ Point Gate

The project may claim a verified 80+ prototype score only when these targeted
tests pass in addition to the local gate:

```bash
REQUIRE_QPDF=1 node tests/engine-page-merge-external.mjs
REQUIRE_QPDF=1 node tests/engine-password-permissions.mjs
REQUIRE_QPDF=1 node tests/engine-signature-simple.mjs
REQUIRE_QPDF=1 node tests/engine-digital-signature.mjs
REQUIRE_QPDF=1 REQUIRE_OCR=1 node tests/engine-ocr-searchable.mjs
REQUIRE_QPDF=1 node tests/engine-forms-xfdf.mjs
REQUIRE_QPDF=1 node tests/engine-image-move.mjs
REQUIRE_QPDF=1 node tests/engine-compare.mjs
REQUIRE_QPDF=1 node tests/engine-preflight-report.mjs
REQUIRE_QPDF=1 node tests/engine-preflight-standards-signals.mjs
REQUIRE_QPDF=1 node tests/engine-accessibility-report.mjs
REQUIRE_QPDF=1 node tests/engine-accessibility-repair.mjs
REQUIRE_QPDF=1 node tests/engine-vector-object-edit.mjs
REQUIRE_QPDF=1 node tests/engine-page-bookmark-remap.mjs
REQUIRE_QPDF=1 node tests/engine-file-attachment-annotation.mjs
REQUIRE_QPDF=1 node tests/engine-form-signature-field.mjs
REQUIRE_QPDF=1 REQUIRE_OCR=1 node tests/engine-ocr-korean-correction.mjs
REQUIRE_QPDF=1 node tests/engine-batch-100.mjs
```
