# PDF Studio

PDF Studio is a local-first PDF editor built with TypeScript, PDF.js, pdf-lib, and a PyMuPDF editing engine.

It is designed around a real save pipeline, not screenshot export:

- PDF page rendering stays separate from editable objects.
- Existing text replacement is applied with redaction plus replacement text.
- User annotations can be saved either as flattened page content or native PDF annotations.
- Exported PDFs are re-opened and validated before download.

## Features

- Open, search, zoom, rotate, reorder, delete, duplicate, and extract pages
- Select existing PDF text blocks and replace them with auto-fit text boxes
- Live source masking and reflow slices to avoid duplicate original text
- Add text, images, highlights, rectangles, redactions, and ink
- Undo and redo command snapshots
- Password-protected PDF open flow
- Document metadata editing
- Flattened export mode and native PDF annotation export mode
- Redaction policy modes for text-only removal, visual-area cleanup, or image-and-text removal
- PyMuPDF backend with true redaction, password-aware extraction, and PDF structure validation endpoint
- CI-ready Playwright configuration that starts the Vite app and engine server automatically

## Setup

```bash
npm install
npm run engine:install
npx playwright install chromium
brew install qpdf
```

## Development

Run the web app and PDF engine manually:

```bash
npm run dev
npm run engine:serve
```

Open the app at `http://127.0.0.1:5173/`.

`npm run test:e2e` starts both servers through `playwright.config.ts`, so the
end-to-end suite is reproducible from a clean shell.

## Verification

```bash
npm run verify:local
```

`verify:local` requires `qpdf` on PATH and runs the strict engine path:

```bash
npm run ensure:qpdf
npm run build
npm run test:engine
npm run test:e2e -- --reporter=list
npm audit --audit-level=moderate
```

`test:engine` runs the engine smoke, redaction policy, render-diff, and page
operation roundtrip tests.

## Architecture

See:

- [docs/architecture.md](docs/architecture.md)
- [docs/save-pipeline.md](docs/save-pipeline.md)
- [docs/pdf-coordinate-system.md](docs/pdf-coordinate-system.md)

## License Notes

The current engine uses PyMuPDF. Review PyMuPDF/MuPDF licensing before shipping a closed-source commercial product.
