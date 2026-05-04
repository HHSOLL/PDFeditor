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

## Sanitization And Preflight Gate

- Sanitizer changes must prove removed secrets are absent from raw PDF bytes.
- Preflight changes must include both positive and cleaned-document assertions.
- qpdf validation remains mandatory after sanitization.
- Do not claim PDF/A, PDF/X, accessibility, or full hidden-information removal
  unless those dedicated fixtures and external compatibility checks pass.
