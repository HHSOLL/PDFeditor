# PDFEdit Commercial Operation Notes

## Runtime Shape

- Browser UI: Vite/TypeScript app in `src/main.ts` renders PDFs with `pdfjs-dist`.
- PDF edit engine: `engine/pdf_engine.py` is a separate PyMuPDF process boundary.
- API wrapper: `server/pdf-engine-server.mjs` serves the built web app and exposes:
  - `GET /api/health`
  - `POST /api/pdf/apply`
  - `POST /api/pdf/extract`

The browser keeps the interactive editor model, then serializes normalized page
and annotation operations to the engine. If the engine API is unavailable during
local development, export falls back to the browser `pdf-lib` path.

## Local Commands

```bash
npm install
npm run engine:install
npm run build
npm run engine:serve
```

Open `http://127.0.0.1:8787/` for the production-style local server.

During frontend development, run Vite and the engine side by side:

```bash
npm run dev
npm run engine:serve
```

The Vite app at `http://127.0.0.1:5173/` will call the engine API at
`http://127.0.0.1:8787/api/pdf/apply`.

## Verification

```bash
npm run build
npm run test:engine
npm run test:e2e -- --reporter=list
npm audit --audit-level=moderate
```

`test:engine` verifies both the Python CLI engine and the Node HTTP API:
it replaces existing PDF text, confirms the original text is no longer
extractable, confirms the Korean replacement is extractable, and renders the
resulting PDF page to a PNG.

## API Contract

`POST /api/pdf/apply`

```json
{
  "pdfBase64": "<source pdf bytes>",
  "pages": [{ "sourceIndex": 0, "rotation": 0 }],
  "operations": [
    {
      "type": "text",
      "pageIndex": 0,
      "x": 0.1,
      "y": 0.1,
      "width": 0.4,
      "height": 0.08,
      "text": "edited text",
      "fontSize": 18,
      "color": "#172026",
      "eraseOriginal": { "x": 0.1, "y": 0.1, "width": 0.4, "height": 0.08 }
    }
  ]
}
```

Coordinates are normalized with a top-left origin. The engine writes page
content, not browser-only overlays. Text replacement first applies a PDF
redaction to remove the original content stream text, then inserts reflowed
replacement text into the target rectangle.

## Production Gates

- Licensing: PyMuPDF is dual licensed under AGPL/commercial terms. Proprietary
  commercial deployment requires either AGPL compliance or an Artifex commercial
  license before launch.
- Isolation: Run `server/pdf-engine-server.mjs` behind an authenticated gateway
  for multi-user operation. Add per-request file size limits at the proxy as
  well as the current in-process `80MB` limit.
- Storage: The current server is stateless and streams base64 JSON responses.
  For large production workloads, move payloads to object storage and pass
  signed object references to the engine worker.
- Queueing: For long PDFs, run the Python engine as an async job worker instead
  of tying work to one HTTP request lifecycle.
- Observability: Add request ids, structured logs, engine duration metrics, and
  failed-PDF corpus retention before serving paying customers.
