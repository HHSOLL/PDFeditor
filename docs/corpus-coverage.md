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
| Preflight/compare/batch | `tests/engine-preflight-report.mjs`, `tests/engine-preflight-standards-signals.mjs`, `tests/engine-standards-validator.mjs`, `tests/engine-compare.mjs`, `tests/engine-batch-action.mjs`, `tests/engine-batch-100.mjs` |
| Product UI and packaging | compare/batch/image-move cases in `tests/pdf-editor.spec.ts`, `tests/release-smoke.mjs`, `tests/package-smoke.mjs` |

## External Real-World Corpus Manifest

`tests/corpus/manifest.json` now defines the required real-world corpus scope as
a structured manifest. It plans **117 external entries** across the required
Acrobat, Preview, Chrome, Edge, Office, forms, scanned, CJK, hidden-data,
standard-signals, malformed, and large-document categories.

This is a gate, not a claim. Most entries remain `pending-acquisition` until the
actual PDF or reproducible generation step is attached and representative manual
compatibility smoke is recorded. Private or copyrighted PDFs must not be
committed.

Validation command:

```bash
npm run test:corpus
```

That command validates the generated 100-PDF corpus with qpdf/PyMuPDF, validates
the external corpus manifest schema through `tests/corpus-smoke.mjs`, generates
117 reproducible surrogate PDFs under
`tmp/corpus-manifest-smoke/surrogate-pdfs/`, and validates those surrogate PDFs
with qpdf/PyMuPDF.

The surrogate files prove the corpus gate is executable and broad enough to
exercise validators. They do **not** replace the required real-world/manual
compatibility corpus because they are synthetic.

Current planned manifest coverage:

| Category | Planned Count | Status |
| --- | ---: | --- |
| Acrobat-created PDFs | 10 | Pending acquisition/manual smoke |
| Acrobat-edited PDFs | 6 | Pending acquisition/manual smoke |
| Acrobat signed PDFs | 6 | Pending acquisition/manual smoke |
| AcroForm/XFA PDFs | 8 | Pending acquisition/manual smoke |
| macOS Preview annotated PDFs | 8 | Pending acquisition/manual smoke |
| Chrome print-to-PDF outputs | 4 | Pending acquisition/manual smoke |
| Edge print-to-PDF outputs | 4 | Pending acquisition/manual smoke |
| Office Word exports | 5 | Pending acquisition/manual smoke |
| Office Excel exports | 4 | Pending acquisition/manual smoke |
| Office PowerPoint exports | 4 | Pending acquisition/manual smoke |
| Government, contract, invoice, bank/tax forms | 15 | Pending acquisition/manual smoke |
| Scanned Korean and English PDFs | 10 | Pending acquisition/manual smoke |
| CJK, emoji, RTL text PDFs | 8 | Pending acquisition/manual smoke |
| PDF/A/PDF/X/tagged/accessibility PDFs | 8 | Pending acquisition/manual smoke |
| Hidden-data, OCG, JS/action, embedded-file PDFs | 10 | Pending acquisition/manual smoke |
| Malformed-but-openable and large 100/300/500/1000-page PDFs | 7 | Pending acquisition/manual smoke; generated 100/300/500/1000-page engine fixtures are covered by `tests/engine-large-document.mjs` |

## Acceptance for External Corpus Completion

- At least 100 real-world or reproducibly generated PDFs are listed.
- Every entry records source, license/privacy handling, protected assertion, and
  expected behavior.
- Representative files cover open/render/export/reopen.
- Manual compatibility results reference corpus IDs rather than ad hoc paths.
- Private or copyrighted PDFs are not committed to the repository.

Until actual real-world files or faithful reproducible generation steps are
attached and linked to manual compatibility results, this manifest and its
surrogate PDFs do not add external readiness points by themselves.
