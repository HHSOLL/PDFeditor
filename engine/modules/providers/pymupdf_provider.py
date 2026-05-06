"""Built-in PyMuPDF/qpdf/Ghostscript provider capability report."""

from __future__ import annotations

import shutil

import fitz

from ..provider import EngineProvider, ProviderCapability


def _present(binary: str) -> bool:
    return shutil.which(binary) is not None


def pymupdf_provider_status() -> EngineProvider:
    qpdf = _present("qpdf")
    tesseract = _present("tesseract")
    ghostscript = _present("gs")
    capabilities = [
        ProviderCapability(
            id="corePdfMutation",
            label="Engine-backed PDF mutation",
            status="available",
            source="PyMuPDF",
            claimable=True,
            reason="PyMuPDF is bundled as the default editing engine.",
            evidence=["engine apply/validate tests", "qpdf validation when REQUIRE_QPDF=1"],
        ),
        ProviderCapability(
            id="preflightReport",
            label="Preflight report",
            status="available",
            source="PyMuPDF/qpdf",
            claimable=True,
            reason="Report-only diagnostics are implemented and tested.",
            evidence=["tests/engine-preflight-report.mjs", "tests/engine-preflight-standards-signals.mjs"],
        ),
        ProviderCapability(
            id="pdfx3Fixup",
            label="PDF/X-3 fixup",
            status="available" if ghostscript else "missing-runtime",
            source="Ghostscript",
            claimable=ghostscript,
            reason="Ghostscript is required for the current PDF/X-3 conversion path.",
            evidence=["tests/engine-preflight-fixup.mjs", "tests/engine-pdfx-validation.mjs"] if ghostscript else [],
        ),
        ProviderCapability(
            id="ocrSearchablePdf",
            label="Searchable OCR PDF",
            status="available" if tesseract else "missing-runtime",
            source="Tesseract/PyMuPDF",
            claimable=tesseract,
            reason="Tesseract runtime is required for local OCR.",
            evidence=["tests/engine-ocr-searchable.mjs", "tests/engine-ocr-korean-correction.mjs"] if tesseract else [],
        ),
        ProviderCapability(
            id="qpdfStructuralValidation",
            label="qpdf structural validation",
            status="available" if qpdf else "missing-runtime",
            source="qpdf",
            claimable=qpdf,
            reason="qpdf must be on PATH for strict structural validation.",
            evidence=["npm run ensure:qpdf"] if qpdf else [],
        ),
        ProviderCapability(
            id="timestampedPadesLtv",
            label="Timestamped PAdES/LTV signatures",
            status="boundary",
            source="PyMuPDF/CMS baseline",
            claimable=False,
            reason="CMS ByteRange signing exists, but TSA timestamp, revocation embedding, and LTV trust evidence are not complete.",
            evidence=["tests/engine-digital-signature.mjs"],
        ),
        ProviderCapability(
            id="standardsValidatorPdfA",
            label="PDF/A validator-backed certification",
            status="boundary",
            source="external validator required",
            claimable=False,
            reason="veraPDF or equivalent validator evidence is required before PDF/A certification/fixup can be claimed.",
        ),
        ProviderCapability(
            id="standardsValidatorPdfX",
            label="Arbitrary PDF/X profile validation/fixup",
            status="partial",
            source="Ghostscript PDF/X-3 only",
            claimable=False,
            reason="Only the current PDF/X-3 path is claimable; arbitrary PDF/X profiles require a validator/pro SDK path.",
            evidence=["tests/engine-pdfx-validation.mjs"],
        ),
        ProviderCapability(
            id="standardsValidatorPdfUA",
            label="PDF/UA validator-backed report",
            status="boundary",
            source="external validator required",
            claimable=False,
            reason="PDF/UA validator evidence and full tag-tree authoring are required before PDF/UA claims.",
        ),
        ProviderCapability(
            id="fullHiddenDataSanitizer",
            label="Full hidden-data sanitizer",
            status="partial",
            source="PyMuPDF/qpdf scans",
            claimable=False,
            reason="Generated fixtures pass, but third-party hidden-data corpus and Acrobat Pro sanitizer comparison are still required.",
            evidence=["tests/engine-full-sanitizer.mjs", "tests/engine-sanitizer-xref-scan.mjs"],
        ),
        ProviderCapability(
            id="commercialSdkObjectEditing",
            label="Commercial SDK native object editing",
            status="not-configured",
            source="commercial provider",
            claimable=False,
            reason="Apryse/Foxit/Nutrient object-editing SDK is not configured.",
        ),
        ProviderCapability(
            id="realWorldCorpus100",
            label="100+ real-world corpus",
            status="planned",
            source="tests/corpus/manifest.json",
            claimable=False,
            reason="The manifest plans 100+ entries, but acquisition/manual evidence must close before 100-point claim.",
        ),
        ProviderCapability(
            id="deepManualViewerSmoke",
            label="Deep feature-panel manual smoke",
            status="partial",
            source="manual viewer report",
            claimable=False,
            reason="Representative viewer smoke exists; Acrobat feature-panel smoke is still required for 100.",
        ),
        ProviderCapability(
            id="desktopReleaseSmoke",
            label="Desktop release smoke",
            status="boundary",
            source="desktop packaging",
            claimable=False,
            reason="Desktop-first release artifact and lifecycle smoke must pass before production-ready desktop claim.",
        ),
        ProviderCapability(
            id="productionSupportability",
            label="Production supportability",
            status="boundary",
            source="desktop/web release",
            claimable=False,
            reason="Logs, support bundle, crash/recovery, retention, and packaged runtime evidence are required.",
        ),
    ]
    return EngineProvider(
        id="pymupdf",
        label="PyMuPDF/qpdf local provider",
        available=True,
        version=str(getattr(fitz, "VersionBind", "unknown")),
        configured=True,
        reason="Default local provider.",
        capabilities=capabilities,
        sdk_loaded=True,
        configuration={"source": "bundled-python-dependency"},
    )
