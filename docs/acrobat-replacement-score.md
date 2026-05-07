# Acrobat Replacement Readiness Score

This score is intentionally separate from `docs/acrobat-parity-matrix.md`.
The parity matrix is the local automated baseline. This document is the
external product-readiness score for an Acrobat Pro replacement claim.

## Current Result

- Local automated baseline: **85 / 100**
- External replacement readiness: **90 / 100 verified**
- External 90-point claim: **claimable with the representative viewer-smoke
  boundary below**
- External score above 90: **not claimable yet**
- External 100-point/full replacement claim: **blocked by
  `docs/final-100-gap-closure-plan.md`**

The project is now materially closer to an Acrobat-class product because OCR
correction, certificate signing, signature validation, basic accessibility
repair, compare report generation with changed-region overlays, reusable batch
presets, native vector object selection/deletion, and batch automation are
available from the product inspector and save through the engine into real PDF
structure. PDF/X is no longer signal-only: the engine now has local PDF/X
structural validation and a Ghostscript-backed PDF/X-3 fixup path that emits a
new searchable PDF and accepts it only after qpdf, PyMuPDF, and PDF/X structural
checks pass. A generated 100-PDF corpus validates qpdf-backed open and structure
behavior, and a local release package smoke verifies that built assets and the
product engine server can run outside the Vite development server. The 90-point
external gate is now backed by actual app opening evidence:
`MANUAL_VIEWER_REQUIRE_PASS=1 npm run test:manual-viewer-smoke` opened 50
representative PDFs in Acrobat Pro/Reader, macOS Preview, Chrome, and Edge and
recorded 200/200 pass results with screenshots under
`tmp/manual-viewer-smoke/2026-05-05T17-33-44-886Z/`. The remaining blocker for a
score above 90 is deeper feature-panel compatibility evidence, larger real-world
corpus coverage, a native/properly managed production package, and broader
professional validation engines.

## Scoring Rules

- Automated tests alone can contribute at most 70 external points.
- CLI-only functionality receives at most half product credit.
- Acrobat Pro / Reader, macOS Preview, Chrome, and Edge manual smoke is required
  before a feature receives full external compatibility credit.
- Development-server-only execution caps deployment/productization at 1 point;
  the local release package can receive limited productization credit because it
  is smoke-tested from `release/pdfeditor-local`.
- No PDF/A/X certification, full PDF/UA, LTV/timestamp signature, complete
  hidden-data sanitizer, or full vector editor claim is allowed yet.
- Basic edit integrity is a hard product gate, not a polish item. If editing a
  source paragraph inserts artificial line breaks, loses word order, fails to
  preserve paragraph structure, or lets font-size changes overlap protected
  images/captions/tables, the Text editing / semantic reflow area receives no
  more than 2 external points and the total external score is capped at 75.
- Source object selection must be non-destructive. If clicking an existing PDF
  image or vector object schedules deletion, hides the object, or exports a
  destructive operation without an explicit delete/redact command, the Image /
  vector / object editing area receives no more than 2 external points and the
  total external score is capped at 75.
- Any regression in these two basic gates blocks external claims above 80 even
  if standards, OCR, signature, sanitizer, or packaging tests pass.

## Score Table

| Area | Max | Verified External Points | Evidence | Remaining Gap |
| --- | ---: | ---: | --- | --- |
| Viewer / workspace / performance | 8 | 7 | Continuous center viewport, fixed side panels, page-scoped rendering, lazy large-document engine fixture, 50-PDF Acrobat/Preview/Chrome/Edge open/render smoke | 1000-page UX/memory report and deeper cross-viewer interaction smoke |
| Core compatibility / export validation | 10 | 9 | `qpdf`, PyMuPDF validation, PDF.js E2E reopen/export, 100 generated PDF corpus, 200/200 representative manual viewer smoke | Third-party real-world 100+ corpus and deep feature-panel external app smoke |
| Text editing / semantic reflow | 12 | 6 | Redaction + replacement, paragraph reflow tests, figure/caption/cross-page coverage, and a hard regression that source paragraph soft wraps stay one editable paragraph instead of becoming forced line breaks | Multi-column/table/RTL/emoji manual corpus and Acrobat visual smoke |
| Image / vector / object editing | 8 | 7 | Engine-backed image delete/replace/move tests plus UI move path that uses `moveImage`; existing image click is a non-destructive selection and only movement/resizing emits `moveImage`; existing vector objects are detected, surfaced, inspected, and exported through `deleteVector` or `moveVector` instead of overlay-only movement | Image crop/rotate/resize UI polish, exact vector path preservation, vector color/stroke editing UI, richer object inspector smoke |
| Page organization | 7 | 6 | Page delete/reorder/rotate/duplicate/extract/insert/crop/resize/bookmark remap tests | More link/named-destination/form remap corpus and manual smoke |
| Comments / annotations | 6 | 5 | Imported annotations, native/flatten save, file attachment comment tests, representative Preview/Acrobat/Chrome/Edge annotation-category open/render smoke | Cross-viewer annotation corpus and reply/stamp/XFDF comment workflows |
| Forms | 8 | 7 | AcroForm fill/save/create, required/default/export values, tab order, XFDF, XFA warning, representative form-category viewer smoke | Deeper Acrobat/Preview/Chrome appearance-panel report and richer field UI |
| Signatures / security | 8 | 7 | Inspector certificate signing UI, CMS ByteRange signing, signature validation, DocMDP lock policy, password permissions | Acrobat signature panel smoke, timestamp/LTV, trust-store UX |
| Redaction / full sanitizer | 8 | 6 | Real redaction policies, hidden-info sanitizer engine fixtures, hidden-data/security category viewer smoke | Third-party hidden-data corpus and Acrobat Pro sanitizer comparison |
| OCR / scanned PDF editing | 7 | 7 | Inspector OCR status/run/correction UI, searchable image-over-text PDF, Korean OCR engine fixture, scanned Korean/English category viewer smoke | OCR correction selection UI and deskew/orientation remain for 95+ |
| Preflight / PDF/A/X / print production | 5 | 5 | Preflight UI/report PDF, PDF/A/X signal detection, veraPDF-backed PDF/A/PDF/UA validation output when `npm run test:standards-validator` passes, local PDF/X structural validation, Ghostscript-backed PDF/X-3 fixup, tagged/PDF-A/PDF-X/accessibility category viewer smoke | PDF/A fixups, arbitrary PDF/X profile validation/fixups, output preview/separations/ink coverage, and Acrobat Preflight comparison |
| Accessibility / PDF/UA | 4 | 2 | Inspector accessibility repair UI, title/language/tag signal/image alt text engine report | Real tag-tree editor, reading order, PDF/UA validator |
| Compare / batch automation | 4 | 4 | Inspector compare target selection, changed-region overlay with first-change navigation, compare report PDF download, reusable batch preset, batch watermark/search-redaction/sanitizer quick action, production-server compare/batch smoke, 100-job runner | Queue/worker execution, full multi-step action builder, annotation/object diff |
| Deployment / productization / supportability | 5 | 2 | Build output served by the product engine server, release smoke for health/UI/OCR/compare/batch, and smoke-tested local release package with launcher | Native desktop or managed web deployment with engine lifecycle/logging |
| **Total** | **100** | **90** |  |  |

## What Changed in This Readiness Step

- OCR is no longer engine-only. The inspector can check OCR runtime status, run
  OCR, and write corrected searchable OCR text into the saved PDF.
- Certificate signing is no longer CLI-only. The inspector accepts PEM
  certificate/key files, signs the current PDF, downloads the signed output, and
  validates the signature structure.
- Accessibility repair is no longer engine-only. The inspector writes document
  title/language, basic tag signals, tab order, and image alt text through the
  engine.
- Accessibility reports now expose the actual document title in addition to the
  title-present boolean.
- Compare and batch automation are no longer engine-only. The inspector can
  select a comparison PDF, run a text/render comparison, download a report PDF,
  show changed regions on the document, jump to the first changed page, save and
  reload a batch preset, and run a structural batch quick action that applies
  watermark, search redaction, and sanitizer steps through the engine.
- Existing image move from the UI now emits an engine `moveImage` operation when
  the selected source-image box is repositioned or resized, preserving a real
  image object instead of deleting it or keeping an overlay.
- Existing image click is now explicitly non-destructive. The regression suite
  verifies that simply selecting an image does not create a `redact` box, does
  not emit `deleteImage`, and does not reduce the image count in the exported
  `ex.pdf` fixture.
- Source paragraph selection now treats PDF line wrapping as paragraph layout
  instead of textarea hard breaks. The regression suite verifies that a
  two-line source paragraph opens as one editable paragraph with no artificial
  newline before the second sentence.
- Existing vector drawings are now exposed in the document layer, selectable
  from the UI, shown in the object inspector, and exported through the engine
  `deleteVector` operation so the original colored line art is removed from the
  saved PDF.
- PDF/X-3 fixup is now engine-backed instead of report-only. The UI calls
  `/api/pdf/preflight-fixup`, the engine rewrites the PDF with Ghostscript
  `pdfwrite`, and the result must pass qpdf, PyMuPDF, and local PDF/X structural
  validation before download.
- The production server smoke now verifies OCR, compare, and batch endpoints,
  and `npm run test:package-smoke` builds a local release package and verifies
  that it serves the built UI and engine APIs outside the dev server.
- A generated 100-PDF corpus validates qpdf-backed open/structure behavior and
  documents which categories are covered.
- Actual Acrobat Pro/Reader, macOS Preview, Chrome, and Edge representative
  viewer smoke now passes 200/200 open/render checks for the 50-PDF package.

## Above-90 Blockers

The shortest path from the current verified 90 to a claimable 95+ is:

1. Record deeper Acrobat feature-panel smoke for signature status, form
   appearance details, Acrobat Preflight comparison, sanitizer comparison,
   accessibility repair workflow, and OCR search/correction behavior.
2. Attach actual files or reproducible acquisition/generation steps to the
   117-entry external corpus manifest in `tests/corpus/manifest.json`, then
   connect representative entries to manual smoke results.
3. Extend the PDF/X-3 fixup path into a broader professional preflight track:
   PDF/A fixups, arbitrary PDF/X profiles, output preview/separations/ink
   coverage, and Acrobat Pro Preflight comparison.
4. Ship either a native desktop build or a managed production web deployment with
   engine lifecycle management, logs, and failure recovery.
5. Add image crop/rotate/resize UI polish, vector move/color/stroke editing,
   full multi-step action-builder UI with queue/worker execution, richer object
   inspector details, and annotation/object diff.

Any 100/100 or full Acrobat Pro replacement claim additionally requires every
gate in `docs/final-100-gap-closure-plan.md` to be marked complete with matching
implementation, automated test, manual smoke, corpus, validator, sanitizer,
signature, PDF/UA, and desktop/production-package evidence.

Until those are complete, the safe external claim is:

> Acrobat-class local PDF editor prototype with verified engine-backed OCR
> correction, certificate signing, forms, sanitizer, PDF/X-3 preflight fixup,
> compare/batch UI workflows, representative Acrobat/Preview/Chrome/Edge
> viewer smoke, and a 90/100 external replacement readiness
> score.
