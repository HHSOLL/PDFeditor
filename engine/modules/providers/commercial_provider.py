"""Commercial PDF SDK adapter status.

This adapter intentionally does not load a vendor SDK directly. It establishes
the contract and claim gate used by the app and tests. A licensed SDK can be
bound behind this provider by setting the documented environment variables and
implementing the operation methods without changing UI policy code.
"""

from __future__ import annotations

import os
import importlib.util
from pathlib import Path

from ..provider import EngineProvider, ProviderCapability


def commercial_provider_status() -> EngineProvider:
    sdk_name = (
        os.environ.get("PDFEDITOR_COMMERCIAL_SDK", "").strip()
        or os.environ.get("PDF_ENGINE_COMMERCIAL_PROVIDER", "").strip()
    )
    sdk_path = os.environ.get("PDFEDITOR_COMMERCIAL_SDK_PATH", "").strip()
    sdk_module = os.environ.get("PDF_ENGINE_COMMERCIAL_SDK_MODULE", "").strip()
    license_value = (
        os.environ.get("PDFEDITOR_COMMERCIAL_LICENSE", "").strip()
        or os.environ.get("PDF_ENGINE_COMMERCIAL_LICENSE_KEY", "").strip()
        or os.environ.get("PDF_ENGINE_COMMERCIAL_LICENSE_FILE", "").strip()
    )
    enabled = os.environ.get("PDFEDITOR_COMMERCIAL_ENABLED", "").strip() == "1" or bool(
        sdk_name or sdk_module or license_value
    )
    path_exists = bool(sdk_path) and Path(sdk_path).exists()
    module_loaded = bool(sdk_module and importlib.util.find_spec(sdk_module))
    sdk_location_ready = path_exists or module_loaded
    configured = enabled and bool(sdk_name or sdk_module or sdk_path or license_value)
    available = bool(configured and sdk_location_ready and license_value)

    if not configured:
        reason = "Commercial PDF SDK provider is not configured; PyMuPDF remains active."
    elif sdk_module and not module_loaded:
        reason = f"Commercial PDF SDK module '{sdk_module}' is not importable."
    elif not sdk_location_ready:
        reason = "Commercial PDF SDK path or importable module is required before vendor-backed features can run."
    elif not license_value:
        reason = "Commercial PDF SDK license env is required before vendor-backed features can run."
    else:
        reason = f"{sdk_name or sdk_module} provider is configured; feature-specific corpus/manual evidence is still required before 100-point claims."

    status = "configured" if available else "not-configured"
    capabilities = [
        ProviderCapability(
            id="commercialSdkObjectEditing",
            label="Commercial SDK native object editing",
            status=status,
            source=sdk_name or "Apryse/Foxit/Nutrient adapter",
            claimable=available,
            reason=reason if available else "Native object editing remains disabled until a licensed SDK adapter is configured and its corpus tests pass.",
            evidence=["vendor SDK configuration"] if available else [],
        ),
        ProviderCapability(
            id="standardsValidatorPdfX",
            label="Commercial arbitrary PDF/X validation/fixup",
            status=status,
            source=sdk_name or "callas/Foxit/Apryse validator adapter",
            claimable=False,
            reason="A configured SDK is necessary but not sufficient; profile-specific validator tests and Acrobat Preflight comparison must pass.",
            evidence=["SDK configured"] if available else [],
        ),
        ProviderCapability(
            id="standardsValidatorPdfA",
            label="Commercial PDF/A validation/fixup",
            status=status,
            source=sdk_name or "veraPDF/callas validator adapter",
            claimable=False,
            reason="PDF/A claims stay blocked until validator-backed tests pass in full mode.",
            evidence=["SDK configured"] if available else [],
        ),
        ProviderCapability(
            id="standardsValidatorPdfUA",
            label="Commercial PDF/UA validation",
            status=status,
            source=sdk_name or "PDF/UA validator adapter",
            claimable=False,
            reason="PDF/UA claims stay blocked until validator-backed tests and tag-tree authoring smoke pass.",
            evidence=["SDK configured"] if available else [],
        ),
        ProviderCapability(
            id="timestampedPadesLtv",
            label="Commercial timestamp/LTV signature stack",
            status=status,
            source=sdk_name or "signature SDK/TSA adapter",
            claimable=False,
            reason="Timestamp/LTV needs TSA, OCSP/CRL embedding, trust-chain validation, and Acrobat panel smoke.",
            evidence=["SDK configured"] if available else [],
        ),
    ]

    return EngineProvider(
        id="commercial",
        label="Commercial SDK provider",
        available=available,
        version=sdk_name or "not configured",
        configured=configured,
        reason=reason,
        capabilities=capabilities,
        sdk_loaded=sdk_location_ready,
        configuration={
            "source": "commercial-adapter",
            "providerEnv": "PDFEDITOR_COMMERCIAL_SDK or PDF_ENGINE_COMMERCIAL_PROVIDER",
            "pathEnv": "PDFEDITOR_COMMERCIAL_SDK_PATH",
            "moduleEnv": "PDF_ENGINE_COMMERCIAL_SDK_MODULE",
            "licenseEnv": "PDFEDITOR_COMMERCIAL_LICENSE or PDF_ENGINE_COMMERCIAL_LICENSE_KEY/PDF_ENGINE_COMMERCIAL_LICENSE_FILE",
            "provider": sdk_name,
            "module": sdk_module,
            "path": sdk_path,
            "licenseConfigured": bool(license_value),
        },
    )
