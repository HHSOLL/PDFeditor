# Gap Closure Plan

Date: 2026-05-05

This plan is the Phase 0 control artifact for moving PDFeditor from the current
Acrobat-class prototype baseline toward a production-ready Acrobat Pro
replacement. It does **not** raise scores by itself. A gap closes only when the
feature is implemented, saved into real PDF structure, validated by automated
tests, and manual compatibility evidence is recorded where required.

## Current Baseline

| Metric | Current Value | Claim Status |
| --- | ---: | --- |
| Local automated baseline | 84 / 100 | Verified by local automated tests |
| External replacement readiness | 82 / 100 | Verified but below 90+ claim gate |
| Full Acrobat Pro replacement | 0 / 1 | Not claimable |
| Production-ready SaaS/native release | 0 / 1 | Not claimable |

Safe current wording remains:

> Acrobat-class local PDF editor prototype with verified engine-backed OCR
> correction, certificate signing, forms, sanitizer, preflight reporting,
> compare/batch UI workflows, and an 82/100 external replacement readiness
> score.

## Completion Rules

- Do not raise the external score without evidence in code, tests, docs, and
  manual smoke where required.
- Do not count overlay-only UI as PDF editing.
- Do not count screenshot/raster export as PDF editing.
- Do not claim Acrobat/Preview/Chrome/Edge compatibility without app-specific
  manual records in `docs/manual-compatibility-report.md`.
- Do not claim PDF/A, PDF/X, or PDF/UA certification without validator-backed
  passing/failing fixtures and Acrobat comparison evidence. veraPDF report
  output is validation evidence, not certified-output evidence.
- Do not claim enterprise signature support without timestamp/LTV and trust-chain
  UX.

## Phase 0 Gap Inventory

| Phase | Gap | Owner Files | Required Tests | Manual Smoke | UI Needed | Engine Needed | Deployment Needed | Completion Evidence | Current Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Acrobat/Preview/Chrome/Edge visual smoke | `docs/manual-compatibility-report.md`, `tmp/manual-smoke-*` | `npm run test:release-smoke`, `npm run test:package-smoke` | Yes, 50+ representative PDFs | No new UI | No | No | Pass/fail rows with viewer versions and screenshots | Pending |
| 2 | Real-world corpus 100+ | `tests/corpus/manifest.json`, `tests/corpus-smoke.mjs`, `docs/corpus-coverage.md` | `npm run test:corpus` | Representative subset | No | Generated corpus validation | No | Manifest with 100+ planned entries plus generated 100-PDF smoke | Manifest gate added; acquisition pending |
| 3 | Viewer performance at 1000 pages | `src/main.ts`, `src/styles.css`, `tests/pdf-editor.spec.ts`, `tests/engine-large-document.mjs` | large-document E2E/engine metrics | Chrome/Edge visual smoke | Existing | No | No | first-page visible time, canvas count, freeze check | 100/300/500/1000 engine fixtures verified; browser memory/manual smoke still partial |
| 4 | Semantic reflow for multi-column/table/RTL/emoji | `src/main.ts`, `engine/pdf_engine.py`, `tests/engine-reflow*.mjs` | reflow multicolumn/table/CJK/RTL tests | Acrobat/Preview/Chrome | Existing | Yes | No | searchable output, no figure/table overlap, raw source removal | Partial |
| 5 | Native image/vector object editing completeness | `src/main.ts`, `engine/pdf_engine.py`, `tests/engine-image*.mjs`, `tests/engine-vector*.mjs` | crop/rotate/resize/vector style tests | Acrobat/Preview/Chrome | Yes | Yes | No | real object mutation, render diff, source bytes removed | `moveVector` engine/UI path added for bbox-preserving vector moves; exact path/style editor still partial |
| 6 | Page organization remaps | `engine/pdf_engine.py`, `tests/engine-page-*.mjs` | link/named-destination/form remap tests | Acrobat/Preview/Chrome | Existing | Yes | No | bookmarks/links/forms survive operations | Partial |
| 7 | Cross-viewer annotation completeness | `engine/pdf_engine.py`, `src/main.ts`, `tests/engine-annotations*.mjs` | reply/stamp/XFDF/cross-viewer tests | Acrobat/Preview/Chrome | Yes | Yes | No | native/flatten output verified by viewer | Partial |
| 8 | Forms appearance and editor polish | `engine/pdf_engine.py`, `src/main.ts`, `tests/engine-forms*.mjs` | appearance/tab-order/delete/move/resize tests | Acrobat/Preview/Chrome | Yes | Yes | No | values/appearances visible in all viewers | Partial |
| 9 | Signature trust, timestamp, LTV | `engine/pdf_engine.py`, `src/main.ts`, `tests/engine-digital-signature*.mjs` | timestamp/trust boundary/password tests | Acrobat signature panel | Yes | Yes | No | Acrobat recognizes signature status; tamper invalidates | Partial; timestamp/LTV missing |
| 10 | OCR scanned editing completeness | `engine/pdf_engine.py`, `src/main.ts`, `tests/engine-ocr*.mjs` | deskew/orientation/correction UI tests | Acrobat/Preview/Chrome search | Yes | Yes | Optional queue | corrected invisible text layer extractable | Partial |
| 11 | Full sanitizer claim | `engine/pdf_engine.py`, `tests/engine-sanitizer*.mjs` | RichMedia/OCG/obscured/xref tests | Acrobat Pro sanitizer comparison | Existing | Yes | No | no secrets in text/raw/xref/unreferenced scans | Partial; full claim blocked |
| 12 | PDF/A/UA validator-backed preflight | `engine/pdf_engine.py`, `docs/pdfa-pdfx-engine-evaluation.md`, `tests/engine-preflight*.mjs` | `engine-standards-validator.mjs` with veraPDF | Acrobat Preflight comparison | Existing | PDF/X validator/fixup engine still needed | No | validator-backed report/fixups | PDF/A/UA report path implemented; fixups/PDF/X blocked |
| 13 | PDF/UA accessibility workflow | `engine/pdf_engine.py`, `src/main.ts`, `tests/engine-accessibility*.mjs` | tag tree/reading order/PDF-UA report tests | Acrobat accessibility panel | Yes | Validator needed | No | tagged PDF save and validator report | Basic only |
| 14 | Compare/batch full workflow | `src/main.ts`, `server/pdf-engine-server.mjs`, `tests/engine-batch*.mjs` | compare object/annotation diff, batch worker tests | Report PDF visual smoke | Yes | Yes | Worker needed | action builder, logs, failure report | Partial |
| 15 | Production or desktop packaging | `scripts/package-local.mjs`, `server/pdf-engine-server.mjs`, `docs/deployment.md` | package/deployment/job/storage smoke | User launch smoke | Yes | Lifecycle automation | Yes | dev-server-free execution with logs/recovery | Local web package has launcher, manifest, logs, support bundle; native/hosted release still blocked |
| 16 | Final claim gate | all docs and tests | `npm run verify:local`, `npm run verify:external`, `npm run test:corpus`, release/package smoke | Complete matrix | Complete | Complete | Complete | external readiness >= 95 and forbidden claims removed only if evidence exists | Blocked |

## Immediate Closure Order

1. Complete manual compatibility records for the already generated OCR,
   signature, accessibility, form, sanitizer, preflight, compare, batch, image,
   vector, text edit, and page organization outputs.
2. Acquire or reproducibly generate the external corpus entries described in
   `tests/corpus/manifest.json`.
3. Extend the implemented veraPDF report path with PDF/X-capable validation and
   professional fixup evidence before changing certification language.
4. Build a managed desktop or production web package with engine lifecycle,
   logs, and failure recovery.
5. Expand object editing, semantic reflow, annotations, forms, sanitizer, OCR,
   and signatures using the gap rows above as acceptance gates.

## Phase 0 Evidence Added

- `tests/corpus/manifest.json` defines 117 planned external corpus entries
  across the required real-world categories.
- `tests/corpus-smoke.mjs` validates the manifest schema and enforces that
  manual smoke remains required for full external credit. It also generates 117
  reproducible surrogate PDFs under `tmp/corpus-manifest-smoke/surrogate-pdfs/`
  and validates them with qpdf/PyMuPDF so corpus coverage cannot drift without
  breaking `npm run test:corpus`.
- `npm run test:corpus` now runs both the generated 100-PDF corpus validation and
  the external corpus manifest gate.
- `tests/release-claim-boundary.mjs` enforces that external 90+, full Acrobat
  replacement, viewer compatibility, production release, and PDF/A/X/UA claims
  stay blocked while required evidence is pending.
- `tests/manual-smoke-package.mjs` builds a validated 50-PDF package and
  checklist under `tmp/manual-compatibility-package/` so Phase 1 manual smoke has
  stable input files instead of ad hoc PDFs.
- `tests/engine-large-document.mjs` now validates 100, 300, 500, and 1000-page
  fixtures and writes timing metrics to `tmp/engine-large-document/metrics.json`.
- `scripts/package-local.mjs` now emits a local release manifest, runtime log
  directory, and support-bundle script; `tests/package-smoke.mjs` verifies those
  files while keeping native desktop/SaaS claims blocked.
- `moveVector` now removes the original touched vector drawing and reinserts a
  real vector box at the edited bbox, so moving detected vector objects is no
  longer overlay-only. Exact source path preservation and full stroke/fill UI
  remain blocked.
- `docs/pdfa-pdfx-engine-evaluation.md` records the validator path.
  `tests/standards-validator-boundary.mjs` keeps PDF/A, PDF/X, PDF/UA, and
  preflight fixup claims blocked unless validator-backed report evidence exists.
  `tests/engine-standards-validator.mjs` now proves the veraPDF JSON report path
  and missing-validator failure policy.

## Non-Claimable Boundaries

These remain non-claimable until closed with evidence:

- Full Acrobat Pro replacement.
- External replacement readiness above 90.
- Production-ready SaaS or native desktop release.
- PDF/A, PDF/X, or PDF/UA certification.
- LTV/timestamp enterprise digital signatures.
- Complete sanitizer for all hidden PDF content.
- Complete native vector editor.
