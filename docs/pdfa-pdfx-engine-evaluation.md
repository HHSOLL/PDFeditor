# PDF/A, PDF/X, and PDF/UA Validator Evaluation

Date: 2026-05-05

Current status: **report-only**. PDFeditor detects PDF/A/PDF/X claim signals,
OutputIntent presence, page boxes, font/image/drawing/form/signature indicators,
and hidden-info risk signals. It does not certify conformance and does not apply
preflight fixups.

## Candidate Validators

| Candidate | Coverage | Integration Shape | Product Use | Current Decision |
| --- | --- | --- | --- | --- |
| veraPDF | PDF/A and PDF/UA validation. The official validation engine implements formalized specification requirements for PDF/A-1/2/3/4 and PDF/UA-1/2. See [veraPDF Validation](https://site.verapdf.org/validation/) and [veraPDF CLI Validation](https://site.verapdf.org/cli/validation/). | Local CLI or server worker. Parse XML/JSON-like reports into engine preflight output. | Standards validation gate and report artifact. | Preferred open-source validator path to evaluate first. |
| Adobe Acrobat Pro Preflight | Professional reference comparator for user-facing warnings and report language. | Manual compatibility lab only; not automated in CI. | Manual comparison records in `docs/manual-compatibility-report.md`. | Required external smoke comparator, not embedded engine. |
| Commercial PDF SDK preflight module | PDF/A/X validation, fixups, and production-print checks depending on vendor. | Server/native worker behind engine API. | Claimable fixups only after SDK-specific validation tests. | Evaluate after veraPDF path is proven insufficient. |
| Apache PDFBox Preflight | PDF/A-focused Java path, historically PDF/A-1 oriented. | Java worker or CLI wrapper. | Secondary signal only. | Not first choice for broad PDF/A/PDF/UA coverage. |

## Required Before Any Certification Claim

- Installable validator command or embedded SDK path.
- Machine-readable validator output parsed by the engine.
- Corpus with passing and failing PDF/A/PDF/X/PDF/UA samples.
- Tests that fail when a claimed PDF/A/X/UA document fails validator checks.
- Manual Acrobat Pro Preflight comparison for representative files.
- Release boundary update that distinguishes validation from fixup/conversion.

## Non-Claimable Until Implemented

- PDF/A-certified output.
- PDF/X-certified output.
- PDF/UA-compliant editor.
- Preflight fixups.
- Output preview/separations/ink coverage parity with Acrobat Pro.

## Proposed Engine Contract

```json
{
  "validator": "verapdf",
  "validatorVersion": "pending",
  "profiles": ["PDF/A auto", "PDF/UA auto"],
  "validated": false,
  "passed": false,
  "failures": [],
  "warnings": [],
  "rawReportPath": "tmp/preflight/verapdf-report.xml"
}
```

The existing `preflight` command should keep returning report-only signal fields
until this contract is backed by a real validator.

