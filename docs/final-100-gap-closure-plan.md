# Final 100 Gap Closure

Date: 2026-05-06

This is the control document for any future 100/100 or full Acrobat Pro
replacement claim. It does not raise the current score. The external replacement
readiness score remains **90 / 100 verified** until every required gate below is
complete and linked to evidence.

## Claim Rule

The project must not claim any of the following while one or more required gates
remain incomplete:

- Full Acrobat Pro replacement.
- 100/100 external replacement readiness.
- Complete Acrobat compatibility.
- Production-ready Acrobat replacement.
- PDF/A, PDF/X, or PDF/UA certified output.

The only safe external score claim is still the 90-point wording in
`docs/release-claim-boundary.md`.

## Required 100 Gates

| Gate ID | Required Before 100 | Status | Evidence Required | Current Boundary |
| --- | --- | --- | --- | --- |
| `basic-edit-integrity` | Yes | Complete for current regression fixtures | E2E evidence that source paragraph soft wraps remain one editable paragraph, Escape clears selection, source image click is non-destructive, moving an image emits `moveImage`, and `ex.pdf` export preserves page structure and image count | This gate must stay complete. Any regression caps external readiness below 80 regardless of standards/deployment progress |
| `real-world-corpus` | Yes | Blocked | At least 100 real-world or faithfully reproducible corpus entries with source/license/privacy handling, protected assertions, actual files or reproducible generation steps, and linked manual compatibility results by corpus ID | The current 117-entry manifest plus surrogate PDFs is executable coverage plumbing, not real-world compatibility evidence |
| `deep-manual-smoke` | Yes | Blocked | Feature-panel manual smoke in Acrobat Pro/Reader, macOS Preview, Chrome, and Edge for signatures, forms, sanitizer, OCR search/correction, accessibility workflow, compare/preflight reports, and export/reopen behavior | The current 200/200 result is representative open/render smoke only |
| `desktop-production-package` | Yes | Blocked | Native desktop package or managed production web deployment with engine lifecycle, logs, crash/failure recovery, update/support path, and launch smoke outside development tooling | The current local web package is smoke-tested but is not native desktop or managed production |
| `validator-preflight` | Yes | Blocked | Validator-backed passing/failing fixtures for PDF/A, arbitrary PDF/X profiles, PDF/UA, and Acrobat Pro Preflight comparison records; PDF/X-3 remains a limited implemented fixup path | veraPDF report output and PDF/X-3 structural fixup evidence do not certify broad standards output |
| `ltv-signatures` | Yes | Blocked | Timestamp authority integration, LTV/revocation material, trust-chain UX, tamper and expiration fixtures, and Acrobat signature panel smoke | Current CMS ByteRange signing and validation do not include timestamp/LTV enterprise trust support |
| `complete-sanitizer` | Yes | Blocked | Third-party hidden-data corpus plus Acrobat Pro sanitizer comparison proving metadata, XMP, attachments, actions, OCG/layers, RichMedia, incremental stale bytes, xref/unreferenced objects, hidden text, and embedded indexes are removed or explicitly reported | Current sanitizer coverage is generated-fixture evidence only |
| `pdfua-accessibility` | Yes | Blocked | Real tag-tree editor, reading-order repair, artifact marking, form descriptions, alt-text workflow, PDF/UA validator pass/fail fixtures, and Acrobat accessibility panel smoke | Current accessibility repair is basic title/language/tag signal/tab-order/alt-text support, not PDF/UA parity |

## Completion Standard

A gate can move to **Complete** only when the implementation, automated tests,
manual evidence, and documentation all point to the same artifact set. Changing
wording alone never closes a gate.

Before any 100/100 or full replacement claim is allowed:

1. Every row in the Required 100 Gates table must have status **Complete**.
2. `docs/acrobat-replacement-score.md` must raise the external score with a
   matching evidence summary.
3. `docs/release-claim-boundary.md` must remove the corresponding forbidden
   claim only after the evidence is present.
4. `docs/manual-compatibility-report.md` must include viewer-specific pass/fail
   rows for the deep feature-panel checks.
5. `docs/corpus-coverage.md` must link real-world corpus entries to the manual
   compatibility evidence.
6. `npm run test:claim-boundary`, `npm run test:corpus`, release/package smoke,
   standards validator, and any feature-specific gates must pass.

## Current Decision

Current 100/full replacement status: **blocked**.

The representative viewer smoke justifies the current 90-point external claim,
but it does not close the final 100 gap. The remaining gates require real-world
corpus evidence, deep manual smoke, desktop or managed production packaging,
broader validator/preflight evidence, timestamp/LTV signatures, complete
sanitizer proof, and PDF/UA accessibility validation.
