"""Engine provider capability registry.

The provider layer is deliberately conservative: it exposes what the current
runtime can prove, and it keeps final 100-point claims blocked until external
SDKs, validators, desktop smoke, corpus, and manual compatibility evidence are
present.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ProviderCapability:
    id: str
    label: str
    status: str
    source: str
    claimable: bool
    reason: str
    evidence: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "status": self.status,
            "source": self.source,
            "claimable": self.claimable,
            "reason": self.reason,
            "evidence": self.evidence,
        }


@dataclass(frozen=True)
class EngineProvider:
    id: str
    label: str
    available: bool
    version: str
    configured: bool
    reason: str
    capabilities: list[ProviderCapability]
    sdk_loaded: bool = False
    configuration: dict[str, Any] = field(default_factory=dict)

    def to_dict(self, *, active: bool = False) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.label,
            "label": self.label,
            "available": self.available,
            "active": active,
            "version": self.version,
            "configured": self.configured,
            "sdkLoaded": self.sdk_loaded,
            "unavailableReason": "" if self.available else self.reason,
            "reason": self.reason,
            "capabilities": [capability.id for capability in self.capabilities if capability.claimable],
            "capabilityDetails": [capability.to_dict() for capability in self.capabilities],
            "configuration": self.configuration or {"source": self.id},
        }


FINAL_100_REQUIRED_CAPABILITIES = [
    "realWorldCorpus100",
    "deepManualViewerSmoke",
    "desktopReleaseSmoke",
    "commercialSdkObjectEditing",
    "standardsValidatorPdfA",
    "standardsValidatorPdfX",
    "standardsValidatorPdfUA",
    "timestampedPadesLtv",
    "fullHiddenDataSanitizer",
    "productionSupportability",
]


def build_provider_status() -> dict[str, Any]:
    from .providers.commercial_provider import commercial_provider_status
    from .providers.pymupdf_provider import pymupdf_provider_status

    providers = [pymupdf_provider_status(), commercial_provider_status()]
    active_provider = next((provider for provider in providers if provider.available), providers[0])
    capability_index: dict[str, ProviderCapability] = {}
    for provider in providers:
        for capability in provider.capabilities:
            existing = capability_index.get(capability.id)
            if existing is None or (capability.claimable and not existing.claimable):
                capability_index[capability.id] = capability

    blockers = []
    for capability_id in FINAL_100_REQUIRED_CAPABILITIES:
        capability = capability_index.get(capability_id)
        if capability is None:
            blockers.append(
                {
                    "id": capability_id,
                    "reason": "No provider reports this 100-point gate capability.",
                    "requiredFor": "external 100 Acrobat Pro replacement claim",
                },
            )
        elif not capability.claimable:
            blockers.append(
                {
                    "id": capability_id,
                    "reason": capability.reason,
                    "requiredFor": "external 100 Acrobat Pro replacement claim",
                },
            )

    return {
        "ok": True,
        "activeProvider": active_provider.id,
        "providers": [
            provider.to_dict(active=provider.id == active_provider.id)
            for provider in providers
        ],
        "capabilities": {
            capability_id: capability.to_dict()
            for capability_id, capability in sorted(capability_index.items())
        },
        "claimGate100": {
            "ready": len(blockers) == 0,
            "blockers": blockers,
            "policy": "100점 claim은 provider capability, validator, manual smoke, corpus, desktop evidence가 모두 Complete일 때만 허용됩니다.",
        },
        "warnings": [
            provider.reason
            for provider in providers
            if provider.id != "pymupdf" and not provider.available and provider.reason
        ],
        "environment": {
            "commercialSdk": os.environ.get("PDFEDITOR_COMMERCIAL_SDK", ""),
            "standardsValidator": os.environ.get("PDFEDITOR_STANDARDS_VALIDATOR", ""),
            "desktopArtifact": os.environ.get("PDFEDITOR_DESKTOP_ARTIFACT", ""),
        },
    }
