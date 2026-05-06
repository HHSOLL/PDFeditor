"""Compatibility wrapper for provider status reporting."""

from __future__ import annotations

from .provider import build_provider_status


def provider_status() -> dict:
    return build_provider_status()

