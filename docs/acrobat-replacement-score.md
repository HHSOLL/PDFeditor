# Acrobat Replacement Readiness Score

This score is intentionally separate from `docs/acrobat-parity-matrix.md`.
The parity matrix is the local automated baseline. This document is the
external product-readiness score for an Acrobat Pro replacement claim.

## Current Result

- Local automated baseline: **84 / 100**
- External replacement readiness: **82 / 100 verified**
- External 90+ claim: **not claimable yet**

The project is now materially closer to an Acrobat-class product because OCR
correction, certificate signing, signature validation, basic accessibility
repair, compare report generation with changed-region overlays, reusable batch
presets, native vector object selection/deletion, and batch automation are
available from the product inspector and save through the engine into real PDF
structure. A generated 100-PDF corpus validates qpdf-backed open and structure
behavior, and a local release package smoke verifies that built assets and the
product engine server can run outside the Vite development server. The remaining
blocker for an external 90+ claim is not feature labels; it is missing broad manual
compatibility evidence, larger real-world corpus coverage, a native/properly
managed production package, and non-report-only professional validation engines.

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

## Score Table

| Area | Max | Verified External Points | Evidence | Remaining Gap |
| --- | ---: | ---: | --- | --- |
| Viewer / workspace / performance | 8 | 6 | Continuous center viewport, fixed side panels, page-scoped rendering, lazy large-document engine fixture | 1000-page UX/memory report and cross-browser visual smoke |
| Core compatibility / export validation | 10 | 8 | `qpdf`, PyMuPDF validation, PDF.js E2E reopen/export, 100 generated PDF corpus | Third-party real-world 100+ corpus and external app smoke |
| Text editing / semantic reflow | 12 | 6 | Redaction + replacement, paragraph reflow tests, figure/caption/cross-page coverage | Multi-column/table/RTL/emoji manual corpus and Acrobat visual smoke |
| Image / vector / object editing | 8 | 7 | Engine-backed image delete/replace/move tests plus UI move path that uses `moveImage`; existing vector objects are detected, surfaced, inspected, and exported through `deleteVector` or `moveVector` instead of overlay-only movement | Image crop/rotate/resize UI polish, exact vector path preservation, vector color/stroke editing UI, richer object inspector smoke |
| Page organization | 7 | 6 | Page delete/reorder/rotate/duplicate/extract/insert/crop/resize/bookmark remap tests | More link/named-destination/form remap corpus and manual smoke |
| Comments / annotations | 6 | 4 | Imported annotations, native/flatten save, file attachment comment tests | Cross-viewer annotation corpus and reply/stamp/XFDF comment workflows |
| Forms | 8 | 6 | AcroForm fill/save/create, required/default/export values, tab order, XFDF, XFA warning | Manual Acrobat/Preview/Chrome appearance report and richer field UI |
| Signatures / security | 8 | 7 | Inspector certificate signing UI, CMS ByteRange signing, signature validation, DocMDP lock policy, password permissions | Acrobat signature panel smoke, timestamp/LTV, trust-store UX |
| Redaction / full sanitizer | 8 | 5 | Real redaction policies, hidden-info sanitizer engine fixtures | Third-party hidden-data corpus and Acrobat Pro sanitizer comparison |
| OCR / scanned PDF editing | 7 | 6 | Inspector OCR status/run/correction UI, searchable image-over-text PDF, Korean OCR engine fixture | OCR correction selection UI, deskew/orientation, manual viewer smoke |
| Preflight / PDF/A/X / print production | 5 | 3 | Report-only preflight UI/report PDF, PDF/A/X signal detection | veraPDF/pro SDK validation and Acrobat Preflight comparison |
| Accessibility / PDF/UA | 4 | 2 | Inspector accessibility repair UI, title/language/tag signal/image alt text engine report | Real tag-tree editor, reading order, PDF/UA validator |
| Compare / batch automation | 4 | 4 | Inspector compare target selection, changed-region overlay with first-change navigation, compare report PDF download, reusable batch preset, batch watermark/search-redaction/sanitizer quick action, production-server compare/batch smoke, 100-job runner | Queue/worker execution, full multi-step action builder, annotation/object diff |
| Deployment / productization / supportability | 5 | 2 | Build output served by the product engine server, release smoke for health/UI/OCR/compare/batch, and smoke-tested local release package with launcher | Native desktop or managed web deployment with engine lifecycle/logging |
| **Total** | **100** | **82** |  |  |

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
- Existing vector drawings are now exposed in the document layer, selectable
  from the UI, shown in the object inspector, and exported through the engine
  `deleteVector` operation so the original colored line art is removed from the
  saved PDF.
- The production server smoke now verifies OCR, compare, and batch endpoints,
  and `npm run test:package-smoke` builds a local release package and verifies
  that it serves the built UI and engine APIs outside the dev server.
- A generated 100-PDF corpus validates qpdf-backed open/structure behavior and
  documents which categories are covered.

## 90+ Blockers

The shortest path from the current verified 82 to a claimable 90 is:

1. Run and record Acrobat Pro/Reader, Preview, Chrome, and Edge manual smoke for
   representative OCR, signed, form, sanitizer, preflight, annotation, text-edit,
   image-edit, compare, and batch output PDFs.
2. Attach actual files or reproducible acquisition/generation steps to the
   117-entry external corpus manifest in `tests/corpus/manifest.json`, then
   connect representative entries to manual smoke results.
3. Replace report-only PDF/A/X checks with veraPDF or a professional SDK path,
   while keeping fixups unclaimed until verified.
4. Ship either a native desktop build or a managed production web deployment with
   engine lifecycle management, logs, and failure recovery.
5. Add image crop/rotate/resize UI polish, vector move/color/stroke editing,
   full multi-step action-builder UI with queue/worker execution, richer object
   inspector details, and annotation/object diff.

Until those are complete, the safe external claim is:

> Acrobat-class local PDF editor prototype with verified engine-backed OCR
> correction, certificate signing, forms, sanitizer, preflight reporting,
> compare/batch UI workflows, and an 82/100 external replacement readiness
> score.
