# Corpus Coverage

The project now has two corpus layers:

1. Generated local fixtures that are committed as code or produced under `tmp/`
   during tests.
2. External real-world corpus entries that must be maintained through a manifest
   when copyright or privacy prevents committing the PDFs.

## Generated 100-PDF Corpus

`tests/engine-corpus-100.mjs` generates 100 PDFs into
`tmp/engine-corpus-100/` and validates every file with the engine validation
path. qpdf is required.

| Category | Count | Assertion Protected |
| --- | ---: | --- |
| `text` | 10 | Basic text extraction, open, qpdf validation |
| `contract` | 10 | Contract-like body text and signature lines |
| `invoice` | 10 | Structured invoice/table-like content |
| `form-like` | 10 | Boxed form layouts before AcroForm conversion |
| `annotation-like` | 10 | Comment/callout-style visual layouts |
| `image-heavy` | 10 | Embedded image object handling |
| `vector-heavy` | 10 | Drawings/line art/page graphics |
| `table-heavy` | 10 | Dense table grid/page geometry |
| `multicolumn` | 10 | Academic two-column layout pressure |
| `large-page` | 10 | Varied page sizes and page-box handling |

Generated manifest:

- `tmp/engine-corpus-100/manifest.json`

Validation command:

```bash
REQUIRE_QPDF=1 node tests/engine-corpus-100.mjs
```

## Existing Engine Corpus

| Area | Representative Tests |
| --- | --- |
| Export/save pipeline | `tests/engine-smoke.mjs`, `tests/engine-render-diff.mjs` |
| Redaction/sanitizer | `tests/engine-sanitizer-preflight.mjs`, `tests/engine-search-redaction.mjs` |
| Reflow | `tests/engine-reflow.mjs` |
| Page operations | `tests/engine-page-ops.mjs`, `tests/engine-page-merge-external.mjs`, `tests/engine-page-bookmark-remap.mjs` |
| Forms | `tests/engine-forms.mjs`, `tests/engine-forms-xfdf.mjs`, `tests/engine-form-signature-field.mjs` |
| Signatures/security | `tests/engine-digital-signature.mjs`, `tests/engine-signature-simple.mjs`, `tests/engine-password-permissions.mjs` |
| OCR | `tests/engine-ocr-searchable.mjs`, `tests/engine-ocr-korean-correction.mjs` |
| Accessibility | `tests/engine-accessibility-report.mjs`, `tests/engine-accessibility-repair.mjs` |
| Preflight/compare/batch | `tests/engine-preflight-report.mjs`, `tests/engine-preflight-standards-signals.mjs`, `tests/engine-compare.mjs`, `tests/engine-batch-action.mjs`, `tests/engine-batch-100.mjs` |
| Product UI and packaging | compare/batch/image-move cases in `tests/pdf-editor.spec.ts`, `tests/release-smoke.mjs`, `tests/package-smoke.mjs` |

## External Real-World Corpus Manifest

The external corpus is not complete enough for a 90+ external replacement
claim. The required manifest should be created under
`tests/corpus/external/README.md` or another non-committed-private corpus
registry and include these categories:

| Category | Minimum Count | Status |
| --- | ---: | --- |
| Acrobat-created / Acrobat-edited PDFs | 10 | Pending |
| macOS Preview annotated PDFs | 8 | Pending |
| Chrome/Edge print-to-PDF outputs | 8 | Pending |
| Office Word/PowerPoint/Excel exports | 12 | Pending |
| Government, contract, invoice, bank/tax forms | 15 | Pending |
| Scanned Korean and English PDFs | 10 | Pending |
| CJK, emoji, RTL text PDFs | 8 | Pending |
| Signed/encrypted PDFs | 8 | Pending |
| AcroForm/XFA PDFs | 8 | Pending |
| Annotation/image/vector/table-heavy PDFs | 10 | Pending |
| PDF/A/PDF/X/tagged/accessibility PDFs | 8 | Pending |
| Hidden-data, OCG, JS/action, embedded-file PDFs | 8 | Pending |
| Malformed-but-openable and large 100/300/500/1000-page PDFs | 7 | Pending |

## Acceptance for External Corpus Completion

- At least 100 real-world or reproducibly generated PDFs are listed.
- Every entry records source, license/privacy handling, protected assertion, and
  expected behavior.
- Representative files cover open/render/export/reopen.
- Manual compatibility results reference corpus IDs rather than ad hoc paths.
- Private or copyrighted PDFs are not committed to the repository.
