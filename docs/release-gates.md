# Release Gates

## Local Gate

```bash
npm run verify:local
```

This requires qpdf and strict engine mode.

## Feature Gate

Every new PDF feature must include:

- A generated or checked-in fixture.
- Engine roundtrip verification.
- PDF.js reopen verification.
- qpdf validation.
- Text extraction assertions when text is involved.
- Render-diff or page geometry assertions when layout is involved.
- Documentation update for support limits.

## Compatibility Gate

Before release, record manual smoke results for Acrobat Reader, Chrome, and
macOS Preview. Acrobat Pro is required for redaction/sanitization, signatures,
forms, preflight, and accessibility release claims.
