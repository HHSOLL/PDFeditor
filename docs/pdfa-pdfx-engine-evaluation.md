# PDF/A, PDF/X, and PDF/UA Validator Evaluation

Date: 2026-05-05

Current status: **validator-backed report plus PDF/X-3 fixup**. PDFeditor
detects PDF/A/PDF/X claim signals, OutputIntent presence, page boxes,
font/image/drawing/form/signature indicators, and hidden-info risk signals. When
`veraPDF` is installed, `preflight` also runs `verapdf --format json --flavour 0`
and includes a machine-readable `standardsValidation` result in the engine
report. PDF/X has a separate local structural validator exposed as
`pdfxValidation`. PDFeditor can now run a Ghostscript-backed `pdfwrite` fixup to
produce a PDF/X-3:2002 candidate, then validates the output with qpdf, PyMuPDF,
and the local PDF/X structural validator. It still does not certify arbitrary
PDF/A/PDF/X/PDF/UA output.

## Candidate Validators

| Candidate | Coverage | Integration Shape | Product Use | Current Decision |
| --- | --- | --- | --- | --- |
| veraPDF | PDF/A and PDF/UA validation. The official validation engine implements formalized specification requirements for PDF/A-1/2/3/4 and PDF/UA-1/2. See [veraPDF Validation](https://site.verapdf.org/validation/) and [veraPDF CLI Validation](https://site.verapdf.org/cli/validation/). | Local CLI or server worker. Parse JSON reports into engine preflight output. | Standards validation gate and report artifact. | Integrated for report-only validation through `tests/engine-standards-validator.mjs`. |
| Ghostscript `pdfwrite` | PDF/X-1 and PDF/X-3 creation path. Ghostscript documents `-dPDFX`, `PDFX_def.ps`, CMYK/Gray color conversion, ICC OutputIntent configuration, and embedded-font handling for PDF/X output. | Local CLI worker used by `pdf_engine.py preflight-fixup --target pdfx-3` and `/api/pdf/preflight-fixup`. | Limited, claimable PDF/X-3:2002 fixup candidate generation followed by qpdf/PyMuPDF/PDF/X structural validation. | Integrated for `pdfx-3` through `tests/engine-preflight-fixup.mjs` and `tests/engine-pdfx-validation.mjs`. |
| Adobe Acrobat Pro Preflight | Professional reference comparator for user-facing warnings and report language. | Manual compatibility lab only; not automated in CI. | Manual comparison records in `docs/manual-compatibility-report.md`. | Required external smoke comparator, not embedded engine. |
| Commercial PDF SDK preflight module | PDF/A/X validation, fixups, and production-print checks depending on vendor. | Server/native worker behind engine API. | Claimable fixups only after SDK-specific validation tests. | Evaluate after veraPDF path is proven insufficient. |
| Apache PDFBox Preflight | PDF/A-focused Java path, historically PDF/A-1 oriented. | Java worker or CLI wrapper. | Secondary signal only. | Not first choice for broad PDF/A/PDF/UA coverage. |

## Required Before Any Certification Claim

- Installable validator command or embedded SDK path. Local path is `veraPDF`
  when `npm run test:standards-validator` passes.
- Machine-readable validator output parsed by the engine. The current
  `standardsValidation` shape is implemented for veraPDF JSON output.
- Corpus with passing and failing PDF/A/PDF/X/PDF/UA samples.
- Tests that fail when a claimed PDF/A/UA document fails validator checks.
- Tests that fail when the PDF/X-3 fixup output lacks a PDF/X-3 claim,
  `/OutputIntent` with `/S /GTS_PDFX`, `/Trapped`, page TrimBox/ArtBox, embedded
  fonts, or qpdf/PyMuPDF readability.
- Manual Acrobat Pro Preflight comparison for representative files.
- Release boundary update that distinguishes validation from fixup/conversion.

## Non-Claimable Until Implemented

- PDF/A-certified output.
- PDF/X-certified output.
- PDF/UA-compliant editor.
- PDF/A fixups.
- Arbitrary PDF/X profile fixups beyond the implemented PDF/X-3:2002 path.
- Output preview/separations/ink coverage parity with Acrobat Pro.

## Implemented Engine Contract

```json
{
  "available": true,
  "validator": "verapdf",
  "validatorVersion": "1.30.x",
  "profileName": "PDF/A-1b validation profile",
  "validated": true,
  "passed": false,
  "compliant": false,
  "failedChecks": 3,
  "failures": [],
  "errors": []
}
```

The existing `preflight` command now returns local signal fields,
`standardsValidation`, and `pdfxValidation`. If `REQUIRE_STANDARDS_VALIDATOR=1`
and veraPDF is not on `PATH`, the preflight report contains a blocker error.

`pdfxValidation` is intentionally scoped. It verifies the structural signals that
the engine can check locally:

```json
{
  "available": true,
  "validator": "pdfedit-pdfx-structural",
  "validated": true,
  "passed": true,
  "profileName": "PDF/X-3:2002",
  "outputIntentCount": 1,
  "checks": [
    { "id": "output-intent-gts-pdfx", "passed": true },
    { "id": "trapped-key-present", "passed": true },
    { "id": "font-embedding", "passed": true }
  ]
}
```

`preflight-fixup --target pdfx-3` returns a new PDF and a report with:

- `before`: qpdf/PyMuPDF validation, preflight signals, and PDF/X validation.
- `fixup`: Ghostscript executable, version, ICC profile, PDF/X definition file
  path, redacted command, exit code, stdout, and stderr.
- `after`: qpdf/PyMuPDF validation, preflight signals, and PDF/X validation.

The product may claim a tested Ghostscript-backed PDF/X-3 fixup path. It must not
claim full PDF/X certification, PDF/X-1/PDF/X-4 coverage, PDF/A fixups, output
preview, separations, ink coverage, or Acrobat Pro Preflight parity until those
paths have dedicated validators, fixtures, and manual Acrobat comparison
records.
