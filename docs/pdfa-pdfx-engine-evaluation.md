# PDF/A, PDF/X, and PDF/UA Validator Evaluation

Date: 2026-05-05

Current status: **validator-backed report-only**. PDFeditor detects PDF/A/PDF/X
claim signals, OutputIntent presence, page boxes, font/image/drawing/form/signature
indicators, and hidden-info risk signals. When `veraPDF` is installed, `preflight`
also runs `verapdf --format json --flavour 0` and includes a machine-readable
`standardsValidation` result in the engine report. It still does not certify that
PDFeditor can create PDF/A/PDF/X/PDF/UA-compliant output and does not apply
preflight fixups.

## Candidate Validators

| Candidate | Coverage | Integration Shape | Product Use | Current Decision |
| --- | --- | --- | --- | --- |
| veraPDF | PDF/A and PDF/UA validation. The official validation engine implements formalized specification requirements for PDF/A-1/2/3/4 and PDF/UA-1/2. See [veraPDF Validation](https://site.verapdf.org/validation/) and [veraPDF CLI Validation](https://site.verapdf.org/cli/validation/). | Local CLI or server worker. Parse JSON reports into engine preflight output. | Standards validation gate and report artifact. | Integrated for report-only validation through `tests/engine-standards-validator.mjs`. |
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
- Manual Acrobat Pro Preflight comparison for representative files.
- Release boundary update that distinguishes validation from fixup/conversion.

## Non-Claimable Until Implemented

- PDF/A-certified output.
- PDF/X-certified output.
- PDF/UA-compliant editor.
- Preflight fixups.
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

The existing `preflight` command now returns both local signal fields and
`standardsValidation`. If `REQUIRE_STANDARDS_VALIDATOR=1` and veraPDF is not on
`PATH`, the preflight report contains a blocker error. PDF/X remains signal-only
unless a PDF/X-capable validator or professional SDK is added.
