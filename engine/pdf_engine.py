#!/usr/bin/env python3
"""Production-oriented PDF text editing engine.

The engine intentionally lives outside the browser UI. It exposes deterministic
JSON operations that can be used from a CLI, an HTTP service, or future workers.
Coordinates are normalized with a top-left origin, matching the web editor.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import datetime as dt
import glob
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Literal, TypedDict

import fitz


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FONT = ROOT / "public" / "fonts" / "AppleGothic.ttf"


class PageSpec(TypedDict):
    sourceIndex: int
    rotation: int
    width: float
    height: float
    cropBox: dict[str, float]
    sourcePdfBase64: str
    password: str


class Operation(TypedDict, total=False):
    type: str
    pageIndex: int
    x: float
    y: float
    sourceY: float
    width: float
    height: float
    text: str
    fontSize: float
    color: str
    opacity: float
    strokeWidth: float
    eraseOriginal: dict[str, float]
    points: list[dict[str, float]]
    dataUrl: str
    fontFamily: str
    fontName: str
    sourceAnnotationId: str
    annotationSubtype: str
    sourceImageId: str
    sourceVectorId: str
    fieldName: str
    fieldType: str
    fieldValue: str
    checked: bool
    exportValue: str
    defaultValue: str
    required: bool
    readOnly: bool
    tabIndex: int
    options: list[str]
    create: bool
    targetWidth: float
    targetHeight: float
    pattern: str
    regex: bool
    caseSensitive: bool
    targetX: float
    targetY: float
    targetWidth: float
    targetHeight: float
    signerName: str
    lockPolicy: str
    fileName: str
    fileBase64: str
    description: str


class SaveOptions(TypedDict, total=False):
    annotationMode: str
    redactionMode: str
    flattenForms: bool
    sanitize: bool
    sanitizeOptions: dict[str, bool]
    validate: bool
    encrypt: bool
    userPassword: str
    ownerPassword: str
    permissions: dict[str, bool]


class OcrResult(TypedDict):
    pdfBytes: bytes
    report: dict[str, Any]


@dataclass(frozen=True)
class PageMetrics:
    width: float
    height: float


def main() -> int:
    parser = argparse.ArgumentParser(description="PDFEdit engine")
    subparsers = parser.add_subparsers(dest="command", required=True)

    extract_parser = subparsers.add_parser("extract", help="Extract editable text spans")
    extract_parser.add_argument("--input", required=True)
    extract_parser.add_argument("--password", default="")

    apply_parser = subparsers.add_parser("apply", help="Apply edit operations")
    apply_parser.add_argument("--input")
    apply_parser.add_argument("--ops")
    apply_parser.add_argument("--output")
    apply_parser.add_argument("--stdin", action="store_true")
    apply_parser.add_argument("--stdout", action="store_true")
    apply_parser.add_argument("--font", default=str(DEFAULT_FONT))

    validate_parser = subparsers.add_parser("validate", help="Validate PDF bytes")
    validate_parser.add_argument("--input")
    validate_parser.add_argument("--password", default="")
    validate_parser.add_argument("--stdin", action="store_true")
    validate_parser.add_argument("--stdout", action="store_true")

    preflight_parser = subparsers.add_parser("preflight", help="Inspect PDF production/security signals")
    preflight_parser.add_argument("--input")
    preflight_parser.add_argument("--report")
    preflight_parser.add_argument("--stdin", action="store_true")
    preflight_parser.add_argument("--stdout", action="store_true")

    preflight_fixup_parser = subparsers.add_parser(
        "preflight-fixup",
        help="Apply validated preflight fixups such as Ghostscript PDF/X-3 conversion",
    )
    preflight_fixup_parser.add_argument("--input")
    preflight_fixup_parser.add_argument("--output")
    preflight_fixup_parser.add_argument("--target", default="pdfx-3", choices=["pdfx-3"])
    preflight_fixup_parser.add_argument("--stdin", action="store_true")
    preflight_fixup_parser.add_argument("--stdout", action="store_true")

    compare_parser = subparsers.add_parser("compare", help="Compare two PDF files")
    compare_parser.add_argument("--input", required=True)
    compare_parser.add_argument("--other", required=True)
    compare_parser.add_argument("--report")
    compare_parser.add_argument("--stdout", action="store_true")

    batch_parser = subparsers.add_parser("batch", help="Run a manifest of engine apply jobs")
    batch_parser.add_argument("--manifest", required=True)
    batch_parser.add_argument("--font", default=str(DEFAULT_FONT))
    batch_parser.add_argument("--stdout", action="store_true")

    forms_export_parser = subparsers.add_parser("forms-export", help="Export AcroForm values as XFDF")
    forms_export_parser.add_argument("--input", required=True)
    forms_export_parser.add_argument("--password", default="")
    forms_export_parser.add_argument("--stdout", action="store_true")

    forms_import_parser = subparsers.add_parser("forms-import", help="Import XFDF values into AcroForm fields")
    forms_import_parser.add_argument("--input", required=True)
    forms_import_parser.add_argument("--xfdf", required=True)
    forms_import_parser.add_argument("--output", required=True)
    forms_import_parser.add_argument("--password", default="")

    accessibility_parser = subparsers.add_parser("accessibility", help="Inspect basic PDF accessibility signals")
    accessibility_parser.add_argument("--input", required=True)
    accessibility_parser.add_argument("--password", default="")
    accessibility_parser.add_argument("--stdout", action="store_true")

    accessibility_repair_parser = subparsers.add_parser("accessibility-repair", help="Apply basic PDF accessibility repair metadata")
    accessibility_repair_parser.add_argument("--input")
    accessibility_repair_parser.add_argument("--output")
    accessibility_repair_parser.add_argument("--password", default="")
    accessibility_repair_parser.add_argument("--title", default="")
    accessibility_repair_parser.add_argument("--language", default="")
    accessibility_repair_parser.add_argument("--alt-text-json", default="[]")
    accessibility_repair_parser.add_argument("--stdin", action="store_true")
    accessibility_repair_parser.add_argument("--stdout", action="store_true")

    ocr_status_parser = subparsers.add_parser("ocr-status", help="Check OCR runtime dependencies")
    ocr_status_parser.add_argument("--language", default="eng")
    ocr_status_parser.add_argument("--tessdata")
    ocr_status_parser.add_argument("--stdout", action="store_true")

    ocr_parser = subparsers.add_parser("ocr", help="Create a searchable PDF from scanned pages")
    ocr_parser.add_argument("--input")
    ocr_parser.add_argument("--output")
    ocr_parser.add_argument("--password", default="")
    ocr_parser.add_argument("--language", default="eng")
    ocr_parser.add_argument("--tessdata")
    ocr_parser.add_argument("--pages", default="all")
    ocr_parser.add_argument("--dpi", type=int, default=220)
    ocr_parser.add_argument("--force", action="store_true")
    ocr_parser.add_argument("--stdin", action="store_true")
    ocr_parser.add_argument("--stdout", action="store_true")

    ocr_correct_parser = subparsers.add_parser("ocr-correct", help="Rebuild scanned pages with corrected invisible OCR text")
    ocr_correct_parser.add_argument("--input")
    ocr_correct_parser.add_argument("--output")
    ocr_correct_parser.add_argument("--password", default="")
    ocr_correct_parser.add_argument("--corrections", required=False)
    ocr_correct_parser.add_argument("--dpi", type=int, default=220)
    ocr_correct_parser.add_argument("--stdin", action="store_true")
    ocr_correct_parser.add_argument("--stdout", action="store_true")

    cert_sign_parser = subparsers.add_parser("cert-sign", help="Apply a certificate-backed CMS digital signature")
    cert_sign_parser.add_argument("--input")
    cert_sign_parser.add_argument("--output")
    cert_sign_parser.add_argument("--cert")
    cert_sign_parser.add_argument("--key")
    cert_sign_parser.add_argument("--key-password", default="")
    cert_sign_parser.add_argument("--password", default="")
    cert_sign_parser.add_argument("--field-name", default="Signature1")
    cert_sign_parser.add_argument("--signer-name", default="")
    cert_sign_parser.add_argument("--reason", default="")
    cert_sign_parser.add_argument("--location", default="")
    cert_sign_parser.add_argument("--page-index", type=int, default=0)
    cert_sign_parser.add_argument("--rect", default="")
    cert_sign_parser.add_argument("--placeholder-bytes", type=int, default=16384)
    cert_sign_parser.add_argument("--lock-policy", default="none", choices=["none", "noChanges", "formFill", "formFillAnnotate"])
    cert_sign_parser.add_argument("--stdin", action="store_true")
    cert_sign_parser.add_argument("--stdout", action="store_true")

    signature_validate_parser = subparsers.add_parser("signature-validate", help="Validate PDF CMS signature byte ranges")
    signature_validate_parser.add_argument("--input")
    signature_validate_parser.add_argument("--trusted-cert")
    signature_validate_parser.add_argument("--stdin", action="store_true")
    signature_validate_parser.add_argument("--stdout", action="store_true")

    args = parser.parse_args()
    if args.command == "extract":
        with fitz.open(args.input) as document:
            authenticate_if_needed(document, args.password)
            write_json(extract_document(document), sys.stdout)
        return 0

    if args.command == "apply":
        if args.stdin:
            payload = json.load(sys.stdin)
            pdf_bytes = base64.b64decode(payload["pdfBase64"])
            ops_payload = {
                "pages": payload.get("pages"),
                "operations": payload.get("operations", []),
                "metadata": payload.get("metadata"),
                "saveOptions": payload.get("saveOptions", {}),
                "password": payload.get("password", ""),
            }
        else:
            if not args.input or not args.ops:
                raise SystemExit("--input and --ops are required without --stdin")
            pdf_bytes = Path(args.input).read_bytes()
            ops_payload = json.loads(Path(args.ops).read_text(encoding="utf-8"))

        edited = apply_operations(pdf_bytes, ops_payload, Path(args.font))
        if args.stdout:
            write_json({"pdfBase64": base64.b64encode(edited).decode("ascii")}, sys.stdout)
        else:
            if not args.output:
                raise SystemExit("--output is required without --stdout")
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_bytes(edited)
        return 0

    if args.command == "validate":
        if args.stdin:
            payload = json.load(sys.stdin)
            pdf_bytes = base64.b64decode(payload["pdfBase64"])
            password = str(payload.get("password", ""))
        else:
            if not args.input:
                raise SystemExit("--input is required without --stdin")
            pdf_bytes = Path(args.input).read_bytes()
            password = args.password
        result = validate_pdf_bytes(pdf_bytes, password)
        if args.stdout:
            write_json(result, sys.stdout)
        else:
            write_json(result, sys.stdout)
        return 0

    if args.command == "preflight":
        if args.stdin:
            payload = json.load(sys.stdin)
            pdf_bytes = base64.b64decode(payload["pdfBase64"])
        else:
            if not args.input:
                raise SystemExit("--input is required without --stdin")
            pdf_bytes = Path(args.input).read_bytes()
        result = preflight_pdf_bytes(pdf_bytes)
        if args.report:
            write_preflight_report_pdf(result, Path(args.report))
            result["reportPath"] = str(Path(args.report))
        if args.stdout:
            write_json(result, sys.stdout)
        else:
            write_json(result, sys.stdout)
        return 0

    if args.command == "preflight-fixup":
        if args.stdin:
            payload = json.load(sys.stdin)
            pdf_bytes = base64.b64decode(payload["pdfBase64"])
            target = str(payload.get("targetProfile") or payload.get("target") or args.target)
        else:
            if not args.input:
                raise SystemExit("--input is required without --stdin")
            pdf_bytes = Path(args.input).read_bytes()
            target = args.target
        result = preflight_fixup_pdf_bytes(pdf_bytes, target)
        if args.output:
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_bytes(result["pdfBytes"])
        if args.stdout:
            write_json(
                {
                    "ok": result["ok"],
                    "pdfBase64": base64.b64encode(result["pdfBytes"]).decode("ascii"),
                    "report": result["report"],
                },
                sys.stdout,
            )
        else:
            if not args.output:
                raise SystemExit("--output is required without --stdout")
            write_json({"ok": result["ok"], "report": result["report"]}, sys.stdout)
        return 0

    if args.command == "compare":
        result = compare_pdf_bytes(Path(args.input).read_bytes(), Path(args.other).read_bytes())
        if args.report:
            write_compare_report_pdf(result, Path(args.report))
            result["reportPath"] = str(Path(args.report))
        write_json(result, sys.stdout)
        return 0

    if args.command == "batch":
        result = run_batch_manifest(Path(args.manifest), Path(args.font))
        write_json(result, sys.stdout)
        return 0

    if args.command == "forms-export":
        with fitz.open(args.input) as document:
            authenticate_if_needed(document, args.password)
            xfdf = export_xfdf(document)
        sys.stdout.write(xfdf)
        if not xfdf.endswith("\n"):
            sys.stdout.write("\n")
        return 0

    if args.command == "forms-import":
        with fitz.open(args.input) as document:
            authenticate_if_needed(document, args.password)
            import_xfdf(document, Path(args.xfdf).read_text(encoding="utf-8"))
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            document.save(args.output, garbage=4, deflate=True, clean=True)
        return 0

    if args.command == "accessibility":
        result = accessibility_pdf_bytes(Path(args.input).read_bytes(), args.password)
        write_json(result, sys.stdout)
        return 0

    if args.command == "accessibility-repair":
        if args.stdin:
            payload = json.load(sys.stdin)
            pdf_bytes = base64.b64decode(payload["pdfBase64"])
            title = str(payload.get("title", ""))
            language = str(payload.get("language", ""))
            alt_texts = payload.get("altTexts", [])
            password = str(payload.get("password", ""))
        else:
            if not args.input:
                raise SystemExit("--input is required without --stdin")
            pdf_bytes = Path(args.input).read_bytes()
            title = args.title
            language = args.language
            try:
                alt_texts = json.loads(args.alt_text_json)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"--alt-text-json is invalid: {exc}") from exc
            password = args.password
        result = accessibility_repair_pdf_bytes(
            pdf_bytes,
            password=password,
            title=title,
            language=language,
            alt_texts=alt_texts,
        )
        response = result["report"]
        if args.stdout:
            response = dict(response)
            response["pdfBase64"] = base64.b64encode(result["pdfBytes"]).decode("ascii")
        else:
            if not args.output:
                raise SystemExit("--output is required without --stdout")
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_bytes(result["pdfBytes"])
            response = dict(response)
            response["output"] = str(Path(args.output))
        write_json(response, sys.stdout)
        return 0

    if args.command == "ocr-status":
        result = ocr_dependency_status(args.language, args.tessdata)
        write_json(result, sys.stdout)
        return 0

    if args.command == "ocr":
        if args.stdin:
            payload = json.load(sys.stdin)
            pdf_bytes = base64.b64decode(payload["pdfBase64"])
            options = {
                "password": str(payload.get("password", "")),
                "language": str(payload.get("language", "eng")),
                "tessdata": payload.get("tessdata"),
                "pages": str(payload.get("pages", "all")),
                "dpi": int(payload.get("dpi", 220)),
                "force": bool(payload.get("force", False)),
            }
        else:
            if not args.input:
                raise SystemExit("--input is required without --stdin")
            pdf_bytes = Path(args.input).read_bytes()
            options = {
                "password": args.password,
                "language": args.language,
                "tessdata": args.tessdata,
                "pages": args.pages,
                "dpi": args.dpi,
                "force": args.force,
            }
        result = ocr_pdf_bytes(pdf_bytes, **options)
        response = result["report"]
        if args.stdout:
            response = dict(response)
            response["pdfBase64"] = base64.b64encode(result["pdfBytes"]).decode("ascii")
        else:
            if not args.output:
                raise SystemExit("--output is required without --stdout")
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_bytes(result["pdfBytes"])
            response = dict(response)
            response["output"] = str(Path(args.output))
        write_json(response, sys.stdout)
        return 0

    if args.command == "ocr-correct":
        if args.stdin:
            payload = json.load(sys.stdin)
            pdf_bytes = base64.b64decode(payload["pdfBase64"])
            corrections = payload.get("corrections", [])
            password = str(payload.get("password", ""))
            dpi = int(payload.get("dpi", 220))
        else:
            if not args.input or not args.corrections:
                raise SystemExit("--input and --corrections are required without --stdin")
            pdf_bytes = Path(args.input).read_bytes()
            corrections = json.loads(Path(args.corrections).read_text(encoding="utf-8"))
            password = args.password
            dpi = args.dpi
        result = ocr_correct_pdf_bytes(pdf_bytes, corrections, password=password, dpi=dpi)
        response = result["report"]
        if args.stdout:
            response = dict(response)
            response["pdfBase64"] = base64.b64encode(result["pdfBytes"]).decode("ascii")
        else:
            if not args.output:
                raise SystemExit("--output is required without --stdout")
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_bytes(result["pdfBytes"])
            response = dict(response)
            response["output"] = str(Path(args.output))
        write_json(response, sys.stdout)
        return 0

    if args.command == "cert-sign":
        if args.stdin:
            payload = json.load(sys.stdin)
            pdf_bytes = base64.b64decode(payload["pdfBase64"])
            cert_pem = str(payload.get("certPem", ""))
            key_pem = str(payload.get("keyPem", ""))
            if not cert_pem or not key_pem:
                raise SystemExit("certPem and keyPem are required for --stdin certificate signing")
            with tempfile.NamedTemporaryFile(suffix=".crt") as cert_handle, tempfile.NamedTemporaryFile(suffix=".key") as key_handle:
                cert_handle.write(cert_pem.encode("utf-8"))
                cert_handle.flush()
                key_handle.write(key_pem.encode("utf-8"))
                key_handle.flush()
                result = certificate_sign_pdf_bytes(
                    pdf_bytes,
                    cert_path=Path(cert_handle.name),
                    key_path=Path(key_handle.name),
                    key_password=str(payload.get("keyPassword", "")),
                    password=str(payload.get("password", "")),
                    field_name=str(payload.get("fieldName", "Signature1")),
                    signer_name=str(payload.get("signerName", "")),
                    reason=str(payload.get("reason", "")),
                    location=str(payload.get("location", "")),
                    page_index=int(payload.get("pageIndex", 0)),
                    rect=parse_signature_rect(payload.get("rect")),
                    placeholder_bytes=int(payload.get("placeholderBytes", 16384)),
                    lock_policy=str(payload.get("lockPolicy", "none")),
                )
        else:
            if not args.input or not args.cert or not args.key:
                raise SystemExit("--input, --cert, and --key are required without --stdin")
            pdf_bytes = Path(args.input).read_bytes()
            result = certificate_sign_pdf_bytes(
                pdf_bytes,
                cert_path=Path(args.cert),
                key_path=Path(args.key),
                key_password=args.key_password,
                password=args.password,
                field_name=args.field_name,
                signer_name=args.signer_name,
                reason=args.reason,
                location=args.location,
                page_index=args.page_index,
                rect=parse_signature_rect(args.rect),
                placeholder_bytes=args.placeholder_bytes,
                lock_policy=args.lock_policy,
            )
        response = result["report"]
        if args.stdout:
            response = dict(response)
            response["pdfBase64"] = base64.b64encode(result["pdfBytes"]).decode("ascii")
        else:
            if not args.output:
                raise SystemExit("--output is required without --stdout")
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_bytes(result["pdfBytes"])
            response = dict(response)
            response["output"] = str(Path(args.output))
        write_json(response, sys.stdout)
        return 0

    if args.command == "signature-validate":
        if args.stdin:
            payload = json.load(sys.stdin)
            pdf_bytes = base64.b64decode(payload["pdfBase64"])
            trusted_cert = payload.get("trustedCertPem")
            if trusted_cert:
                with tempfile.NamedTemporaryFile(suffix=".crt") as cert_handle:
                    cert_handle.write(str(trusted_cert).encode("utf-8"))
                    cert_handle.flush()
                    result = validate_pdf_signatures(pdf_bytes, Path(cert_handle.name))
            else:
                result = validate_pdf_signatures(pdf_bytes, None)
        else:
            if not args.input:
                raise SystemExit("--input is required without --stdin")
            trusted_cert_path = Path(args.trusted_cert) if args.trusted_cert else None
            result = validate_pdf_signatures(Path(args.input).read_bytes(), trusted_cert_path)
        write_json(result, sys.stdout)
        return 0

    raise AssertionError(f"Unhandled command: {args.command}")


def extract_document(document: fitz.Document) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    for page_index in range(document.page_count):
        page = document[page_index]
        rect = page.rect
        text = page.get_text("dict", flags=fitz.TEXT_PRESERVE_LIGATURES)
        spans: list[dict[str, Any]] = []
        images: list[dict[str, Any]] = []
        drawings: list[dict[str, Any]] = []
        for block in text.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    value = str(span.get("text", "")).strip()
                    if not value:
                        continue
                    x0, y0, x1, y1 = span["bbox"]
                    spans.append(
                        {
                            "id": f"{page_index}:{len(spans)}",
                            "text": value,
                            "x": x0 / rect.width,
                            "y": y0 / rect.height,
                            "width": (x1 - x0) / rect.width,
                            "height": (y1 - y0) / rect.height,
                            "fontSize": float(span.get("size", y1 - y0)),
                            "font": span.get("font", ""),
                            "color": int_to_hex(int(span.get("color", 0))),
                        }
                    )
        seen_images: set[tuple[int, int, int, int, int]] = set()
        for image_index, image in enumerate(page.get_images(full=True)):
            xref = int(image[0])
            for rect_index, image_rect in enumerate(page.get_image_rects(xref)):
                if image_rect.is_empty or rect.width <= 0 or rect.height <= 0:
                    continue
                key = (
                    xref,
                    round(image_rect.x0 * 100),
                    round(image_rect.y0 * 100),
                    round(image_rect.x1 * 100),
                    round(image_rect.y1 * 100),
                )
                if key in seen_images:
                    continue
                seen_images.add(key)
                images.append(
                    {
                        "id": f"{page_index}:{xref}:{image_index}:{rect_index}",
                        "xref": xref,
                        "x": clamp_float(image_rect.x0 / rect.width, 0, 1),
                        "y": clamp_float(image_rect.y0 / rect.height, 0, 1),
                        "width": clamp_float((image_rect.x1 - image_rect.x0) / rect.width, 0, 1),
                        "height": clamp_float((image_rect.y1 - image_rect.y0) / rect.height, 0, 1),
                    }
                )
        for drawing_index, drawing in enumerate(page.get_drawings()):
            drawing_rect = drawing.get("rect")
            if not isinstance(drawing_rect, fitz.Rect) or drawing_rect.is_empty or rect.width <= 0 or rect.height <= 0:
                continue
            drawings.append(
                {
                    "id": f"{page_index}:drawing:{drawing_index}",
                    "x": clamp_float(drawing_rect.x0 / rect.width, 0, 1),
                    "y": clamp_float(drawing_rect.y0 / rect.height, 0, 1),
                    "width": clamp_float((drawing_rect.x1 - drawing_rect.x0) / rect.width, 0, 1),
                    "height": clamp_float((drawing_rect.y1 - drawing_rect.y0) / rect.height, 0, 1),
                    "stroke": rgb_to_hex(drawing.get("color")),
                    "fill": rgb_to_hex(drawing.get("fill")),
                    "strokeWidth": float(drawing.get("width") or 0),
                }
            )
        pages.append(
            {
                "index": page_index,
                "width": rect.width,
                "height": rect.height,
                "rotation": page.rotation,
                "spans": spans,
                "images": images,
                "drawings": drawings,
            }
        )
    return {"pages": pages}


def apply_operations(
    pdf_bytes: bytes,
    payload: dict[str, Any],
    font_path: Path,
) -> bytes:
    source = fitz.open(stream=pdf_bytes, filetype="pdf")
    output = fitz.open()
    external_documents: list[fitz.Document] = []
    try:
        authenticate_if_needed(source, str(payload.get("password", "")))
        pages = normalize_pages(payload.get("pages"), source.page_count)
        for page_spec in pages:
            page_source = source
            if str(page_spec.get("sourcePdfBase64", "")):
                page_source = fitz.open(stream=base64.b64decode(str(page_spec["sourcePdfBase64"])), filetype="pdf")
                authenticate_if_needed(page_source, str(page_spec.get("password", "")))
                external_documents.append(page_source)
            source_index = int(page_spec.get("sourceIndex", 0))
            if source_index < 0:
                width = max(72.0, float(page_spec.get("width", 612)))
                height = max(72.0, float(page_spec.get("height", 792)))
                output.new_page(width=width, height=height)
            else:
                source_index = clamp_int(source_index, 0, page_source.page_count - 1)
                output.insert_pdf(page_source, from_page=source_index, to_page=source_index)
            if page_spec.get("rotation", 0):
                output[-1].set_rotation(int(page_spec["rotation"]) % 360)
            if isinstance(page_spec.get("cropBox"), dict):
                apply_page_crop_box(output[-1], page_spec["cropBox"])

        copy_remapped_toc(source, output, pages)
        operations = validate_operations(payload.get("operations", []), output.page_count)
        save_options = normalize_save_options(payload.get("saveOptions"))
        operations_by_page = group_operations(operations)
        for page_index, page_operations in operations_by_page.items():
            page = output[page_index]
            initial_metrics = PageMetrics(page.rect.width, page.rect.height)
            apply_page_operation_phase(page, page_operations, initial_metrics)
            metrics = PageMetrics(page.rect.width, page.rect.height)
            apply_annotation_delete_phase(page, page_operations, metrics)
            apply_form_field_phase(page, page_operations, metrics)
            flow_slice_images = render_flow_slice_images(page, page_operations, metrics)
            moved_source_images = collect_moved_source_images(page, page_operations, metrics)
            apply_redaction_phase(page, page_operations, metrics, save_options)
            apply_insert_phase(page, page_operations, metrics, font_path, flow_slice_images, moved_source_images, save_options)

        apply_metadata(output, payload.get("metadata"))
        if save_options.get("annotationMode") == "flatten" or save_options.get("flattenForms", False):
            output.bake(
                annots=save_options.get("annotationMode") == "flatten",
                widgets=save_options.get("flattenForms", False),
            )
        if save_options.get("sanitize", False):
            sanitize_document(output, save_options.get("sanitizeOptions"))
        buffer = io.BytesIO()
        output.save(buffer, garbage=4, deflate=True, clean=True, **save_encryption_kwargs(save_options))
        edited = buffer.getvalue()
        if save_options.get("validate", True):
            validation = validate_pdf_bytes(edited, validation_password(save_options))
            if not validation["ok"]:
                raise ValueError(f"PDF validation failed: {validation['errors']}")
        return edited
    finally:
        for document in external_documents:
            document.close()
        output.close()
        source.close()


def authenticate_if_needed(document: fitz.Document, password: str) -> None:
    if not document.needs_pass:
        return
    if not password or not document.authenticate(password):
        raise ValueError("PDF password is required or incorrect")


def normalize_save_options(value: Any) -> SaveOptions:
    if not isinstance(value, dict):
        return {"annotationMode": "flatten", "redactionMode": "textOnly", "validate": True}
    mode = str(value.get("annotationMode", "flatten"))
    redaction_mode = str(value.get("redactionMode", "textOnly"))
    if redaction_mode not in {"textOnly", "visualArea", "imagesAndText"}:
        redaction_mode = "textOnly"
    return {
        "annotationMode": "native" if mode == "native" else "flatten",
        "redactionMode": redaction_mode,
        "flattenForms": bool(value.get("flattenForms", False)),
        "sanitize": bool(value.get("sanitize", False)),
        "sanitizeOptions": normalize_sanitize_options(value.get("sanitizeOptions")),
        "validate": bool(value.get("validate", True)),
        "encrypt": bool(value.get("encrypt", False)),
        "userPassword": str(value.get("userPassword", "")),
        "ownerPassword": str(value.get("ownerPassword", "")),
        "permissions": normalize_permissions(value.get("permissions")),
    }


def normalize_permissions(value: Any) -> dict[str, bool]:
    defaults = {
        "print": True,
        "copy": True,
        "annotate": True,
        "edit": True,
    }
    if not isinstance(value, dict):
        return defaults
    return {key: bool(value.get(key, default_value)) for key, default_value in defaults.items()}


def save_encryption_kwargs(save_options: SaveOptions) -> dict[str, Any]:
    if not save_options.get("encrypt", False):
        return {}
    user_password = str(save_options.get("userPassword", ""))
    owner_password = str(save_options.get("ownerPassword", "")) or user_password
    if not user_password and not owner_password:
        return {}
    return {
        "encryption": fitz.PDF_ENCRYPT_AES_256,
        "user_pw": user_password,
        "owner_pw": owner_password,
        "permissions": permission_bits(save_options.get("permissions")),
    }


def validation_password(save_options: SaveOptions) -> str:
    if not save_options.get("encrypt", False):
        return ""
    return str(save_options.get("userPassword") or save_options.get("ownerPassword") or "")


def permission_bits(value: Any) -> int:
    permissions = normalize_permissions(value)
    bits = 0
    if permissions.get("print", True):
        bits |= fitz.PDF_PERM_PRINT
    if permissions.get("copy", True):
        bits |= fitz.PDF_PERM_COPY
    if permissions.get("annotate", True):
        bits |= fitz.PDF_PERM_ANNOTATE
    if permissions.get("edit", True):
        bits |= fitz.PDF_PERM_MODIFY
    return bits


def normalize_sanitize_options(value: Any) -> dict[str, bool]:
    defaults = {
        "metadata": True,
        "xmlMetadata": True,
        "embeddedFiles": True,
        "fileAttachmentAnnotations": True,
        "javascript": True,
        "javascriptNameTree": True,
        "annotationActions": True,
        "comments": True,
        "hiddenLayers": True,
        "embeddedSearchIndex": True,
        "staleIncrementalUpdates": True,
        "unreferencedObjects": True,
        "links": True,
        "thumbnails": True,
        "resetFormFields": False,
    }
    if not isinstance(value, dict):
        return defaults
    return {
        key: bool(value.get(key, default_value))
        for key, default_value in defaults.items()
    }


def sanitize_document(document: fitz.Document, options: Any) -> None:
    normalized = normalize_sanitize_options(options)
    sanitize_page_hidden_data(document, normalized)
    remove_catalog_hidden_entries(document, normalized)
    try:
        document.scrub(
            attached_files=normalized["embeddedFiles"],
            clean_pages=True,
            embedded_files=normalized["embeddedFiles"],
            hidden_text=True,
            javascript=normalized["javascript"],
            metadata=normalized["metadata"],
            redactions=True,
            redact_images=fitz.PDF_REDACT_IMAGE_NONE,
            remove_links=normalized["links"],
            reset_fields=normalized["resetFormFields"],
            reset_responses=normalized["resetFormFields"],
            thumbnails=normalized["thumbnails"],
            xml_metadata=normalized["xmlMetadata"],
        )
    except RuntimeError:
        manually_sanitize_document(document, normalized)
    remove_catalog_hidden_entries(document, normalized)


def manually_sanitize_document(document: fitz.Document, options: dict[str, bool]) -> None:
    if options["metadata"]:
        try:
            document.set_metadata({})
        except Exception:  # noqa: BLE001
            pass
    if options["xmlMetadata"]:
        try:
            document.set_xml_metadata("")
        except Exception:  # noqa: BLE001
            pass


def remove_catalog_hidden_entries(document: fitz.Document, options: dict[str, bool]) -> None:
    try:
        catalog = document.pdf_catalog()
    except Exception:  # noqa: BLE001
        return
    if options["javascript"]:
        for key in ("OpenAction", "AA"):
            null_xref_key(document, catalog, key)
    if options["embeddedFiles"] or options["javascriptNameTree"]:
        null_xref_key(document, catalog, "Names")
    if options["hiddenLayers"]:
        null_xref_key(document, catalog, "OCProperties")
    if options["embeddedSearchIndex"]:
        for key in ("PieceInfo", "Search", "SpiderInfo"):
            null_xref_key(document, catalog, key)


def sanitize_page_hidden_data(document: fitz.Document, options: dict[str, bool]) -> None:
    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        if options["links"]:
            for link in list(page.get_links()):
                try:
                    page.delete_link(link)
                except Exception:  # noqa: BLE001
                    pass

        annotations = list(page.annots() or [])
        for annotation in annotations:
            subtype = annotation.type[1] if len(annotation.type) > 1 else ""
            if options["comments"] or (options["fileAttachmentAnnotations"] and subtype == "FileAttachment"):
                try:
                    page.delete_annot(annotation)
                except Exception:  # noqa: BLE001
                    pass
                continue
            if options["annotationActions"]:
                for key in ("A", "AA"):
                    null_xref_key(document, annotation.xref, key)


def null_xref_key(document: fitz.Document, xref: int, key: str) -> None:
    try:
        document.xref_set_key(xref, key, "null")
    except Exception:  # noqa: BLE001 - scrub remains best-effort but export validation still runs
        pass


def apply_metadata(document: fitz.Document, value: Any) -> None:
    if not isinstance(value, dict):
        return
    metadata = document.metadata or {}
    for source_key, target_key in {
        "title": "title",
        "author": "author",
        "subject": "subject",
        "keywords": "keywords",
        "creator": "creator",
        "producer": "producer",
    }.items():
        raw = value.get(source_key)
        if isinstance(raw, str):
            metadata[target_key] = raw
    document.set_metadata(metadata)
    language = value.get("language")
    if isinstance(language, str) and language.strip():
        try:
            document.xref_set_key(document.pdf_catalog(), "Lang", pdf_literal(language.strip()))
        except Exception:  # noqa: BLE001
            pass


def normalize_pages(value: Any, page_count: int) -> list[PageSpec]:
    if not isinstance(value, list) or not value:
        return [{"sourceIndex": index, "rotation": 0} for index in range(page_count)]
    pages: list[PageSpec] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        pages.append(
            {
                "sourceIndex": int(item.get("sourceIndex", 0)),
                "rotation": int(item.get("rotation", 0)),
                "width": float(item.get("width", 612)),
                "height": float(item.get("height", 792)),
                "cropBox": item.get("cropBox", {}),
                "sourcePdfBase64": str(item.get("sourcePdfBase64", "")),
                "password": str(item.get("password", "")),
            }
        )
    return pages or [{"sourceIndex": index, "rotation": 0} for index in range(page_count)]


def copy_remapped_toc(source: fitz.Document, output: fitz.Document, pages: list[PageSpec]) -> None:
    try:
        toc = source.get_toc()
    except Exception:  # noqa: BLE001
        return
    if not toc:
        return
    source_to_output: dict[int, int] = {}
    for output_index, page_spec in enumerate(pages):
        if str(page_spec.get("sourcePdfBase64", "")):
            continue
        source_index = int(page_spec.get("sourceIndex", -1))
        if source_index < 0:
            continue
        source_to_output.setdefault(source_index + 1, output_index + 1)
    remapped: list[list[Any]] = []
    for row in toc:
        if len(row) < 3:
            continue
        level = int(row[0])
        title = str(row[1])
        source_page = int(row[2])
        if source_page < 1:
            remapped.append([level, title, source_page])
            continue
        target_page = source_to_output.get(source_page)
        if target_page:
            remapped.append([level, title, target_page])
    if not remapped:
        return
    try:
        output.set_toc(remapped)
    except Exception:  # noqa: BLE001 - outline remap is best-effort; qpdf validation remains authoritative
        pass


def validate_operations(value: Any, page_count: int) -> list[Operation]:
    if not isinstance(value, list):
        return []
    operations: list[Operation] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        op_type = str(raw.get("type", ""))
        page_index = int(raw.get("pageIndex", -1))
        if page_index < 0 or page_index >= page_count:
            continue
        if op_type not in {
            "text",
            "highlight",
            "rect",
            "redact",
            "redactPage",
            "redactSearch",
            "pen",
            "image",
            "flowSlice",
            "deleteAnnotation",
            "deleteImage",
            "deleteVector",
            "moveVector",
            "moveImage",
            "formField",
            "cropPage",
            "resizePage",
            "typedSignature",
            "drawnSignature",
            "signatureImage",
            "fileAttachment",
        }:
            continue
        operation: Operation = dict(raw)  # type: ignore[assignment]
        operation["type"] = op_type
        operation["pageIndex"] = page_index
        operations.append(operation)
    return operations


def group_operations(operations: Iterable[Operation]) -> dict[int, list[Operation]]:
    grouped: dict[int, list[Operation]] = {}
    for operation in operations:
        grouped.setdefault(int(operation["pageIndex"]), []).append(operation)
    return grouped


def apply_page_operation_phase(
    page: fitz.Page,
    operations: list[Operation],
    metrics: PageMetrics,
) -> None:
    for operation in operations:
        op_type = operation["type"]
        if op_type == "cropPage":
            apply_page_crop_box(page, operation, metrics)
        elif op_type == "resizePage":
            apply_page_resize(page, operation)


def apply_page_crop_box(
    page: fitz.Page,
    value: dict[str, Any],
    metrics: PageMetrics | None = None,
) -> None:
    rect = crop_box_to_rect(value, page, metrics)
    if rect is None:
        return
    try:
        page.set_cropbox(rect)
    except Exception:  # noqa: BLE001 - invalid crop boxes are ignored by validation
        return


def crop_box_to_rect(
    value: dict[str, Any],
    page: fitz.Page,
    metrics: PageMetrics | None,
) -> fitz.Rect | None:
    if not isinstance(value, dict):
        return None
    if {"x0", "y0", "x1", "y1"}.issubset(value):
        rect = fitz.Rect(
            float(value.get("x0", 0)),
            float(value.get("y0", 0)),
            float(value.get("x1", 0)),
            float(value.get("y1", 0)),
        )
    elif {"x", "y", "width", "height"}.issubset(value):
        x = float(value.get("x", 0))
        y = float(value.get("y", 0))
        width = float(value.get("width", 0))
        height = float(value.get("height", 0))
        normalized = metrics is not None and all(abs(component) <= 1.5 for component in (x, y, width, height))
        if normalized:
            rect = to_rect(value, metrics)
        else:
            rect = fitz.Rect(x, y, x + width, y + height)
    else:
        return None
    media = page.mediabox
    clipped = fitz.Rect(
        max(media.x0, rect.x0),
        max(media.y0, rect.y0),
        min(media.x1, rect.x1),
        min(media.y1, rect.y1),
    )
    if clipped.is_empty or clipped.width < 12 or clipped.height < 12:
        return None
    return clipped


def apply_page_resize(page: fitz.Page, operation: Operation) -> None:
    width = float(operation.get("targetWidth", 0))
    height = float(operation.get("targetHeight", 0))
    if width <= 0 and float(operation.get("width", 0)) > 1:
        width = float(operation.get("width", 0))
    if height <= 0 and float(operation.get("height", 0)) > 1:
        height = float(operation.get("height", 0))
    if width < 72 or height < 72:
        return
    try:
        page.set_mediabox(fitz.Rect(0, 0, width, height))
        page.set_cropbox(fitz.Rect(0, 0, width, height))
    except Exception:  # noqa: BLE001
        return


def apply_annotation_delete_phase(
    page: fitz.Page,
    operations: list[Operation],
    metrics: PageMetrics,
) -> None:
    delete_operations = [operation for operation in operations if operation["type"] == "deleteAnnotation"]
    if not delete_operations:
        return
    for operation in delete_operations:
        target_rect = to_rect(operation, metrics)
        subtype = str(operation.get("annotationSubtype", ""))
        source_id = str(operation.get("sourceAnnotationId", ""))
        if subtype == "Widget":
            for widget in list(page.widgets() or []):
                if widget_matches_delete_operation(widget, target_rect, source_id):
                    page.delete_widget(widget)
                    break
            continue
        for annotation in list(page.annots() or []):
            if annotation_matches_delete_operation(annotation, target_rect, subtype, source_id):
                page.delete_annot(annotation)
                break


def widget_matches_delete_operation(widget: fitz.Widget, target_rect: fitz.Rect, source_id: str) -> bool:
    if source_id and source_id in {str(widget.xref), f"{widget.xref}R"}:
        return True
    return rects_match(widget.rect, target_rect)


def apply_form_field_phase(
    page: fitz.Page,
    operations: list[Operation],
    metrics: PageMetrics,
) -> None:
    form_operations = [operation for operation in operations if operation["type"] == "formField"]
    if not form_operations:
        return
    tab_order_updates: dict[int, int] = {}
    for operation in form_operations:
        target_rect = to_rect(operation, metrics)
        field_name = str(operation.get("fieldName", ""))
        if bool(operation.get("create")):
            widget_xref = create_form_widget(page, operation, target_rect)
            if widget_xref:
                register_tab_order_xref(widget_xref, operation, tab_order_updates)
            continue
        widgets = list(page.widgets() or [])
        if str(operation.get("fieldType", "")) == "radio" and field_name:
            group_widgets = [widget for widget in widgets if widget.field_name == field_name]
            for widget in group_widgets:
                update_widget_value(page, widget, operation, target_rect)
                register_tab_order_update(widget, operation, tab_order_updates)
            continue
        for widget in widgets:
            if not widget_matches_form_operation(widget, target_rect, field_name):
                continue
            update_widget_value(page, widget, operation, target_rect)
            register_tab_order_update(widget, operation, tab_order_updates)
            break
    if tab_order_updates:
        apply_form_tab_order(page, tab_order_updates)


def create_form_widget(page: fitz.Page, operation: Operation, target_rect: fitz.Rect) -> int | None:
    field_type = str(operation.get("fieldType", "text"))
    widget_type = widget_type_for_operation(field_type)
    if widget_type is None:
        return None
    field_name = str(operation.get("fieldName", "")).strip()
    if not field_name:
        field_name = f"{field_type}_{len(list(page.widgets() or [])) + 1}"
    widget = fitz.Widget()
    widget.field_name = field_name
    widget.field_type = widget_type
    widget.rect = target_rect
    widget.border_color = hex_to_rgb(str(operation.get("color", "#172026")))
    widget.border_width = max(0.5, float(operation.get("strokeWidth", 1)))
    widget.fill_color = (1, 1, 1)
    widget.text_color = hex_to_rgb(str(operation.get("color", "#172026")))
    widget.text_font = "ZaDb" if field_type in {"checkbox", "radio"} else "Helv"
    widget.text_fontsize = 0 if field_type in {"checkbox", "radio"} else max(6.0, float(operation.get("fontSize", 11)))
    if field_type in {"combo", "list"}:
        options = choice_options(operation)
        widget.choice_values = options
        widget.field_value = str(operation.get("fieldValue") or (options[0] if options else ""))
    elif field_type == "checkbox":
        widget.field_value = "Yes" if bool(operation.get("checked")) else "Off"
    elif field_type == "radio":
        widget.field_value = False
    else:
        widget.field_value = str(operation.get("fieldValue", ""))
    try:
        annot = page.add_widget(widget)
    except Exception:  # noqa: BLE001 - invalid widget definitions are ignored by apply validation
        return None
    if annot is None:
        return None
    document = page.parent
    widget_xref = annot.xref
    if field_type == "radio" and bool(operation.get("checked")):
        on_state = str(operation.get("exportValue") or operation.get("fieldValue") or "Yes")
        try:
            document.xref_set_key(widget_xref, "AS", pdf_name(on_state))
            document.xref_set_key(widget_xref, "V", pdf_name(on_state))
        except Exception:  # noqa: BLE001
            pass
    update_widget_xref_flags_and_defaults(document, widget_xref, operation)
    return widget_xref


def widget_type_for_operation(field_type: str) -> int | None:
    if field_type == "text":
        return fitz.PDF_WIDGET_TYPE_TEXT
    if field_type == "checkbox":
        return fitz.PDF_WIDGET_TYPE_CHECKBOX
    if field_type == "radio":
        return fitz.PDF_WIDGET_TYPE_RADIOBUTTON
    if field_type == "combo":
        return fitz.PDF_WIDGET_TYPE_COMBOBOX
    if field_type == "list":
        return fitz.PDF_WIDGET_TYPE_LISTBOX
    if field_type == "signature":
        return fitz.PDF_WIDGET_TYPE_SIGNATURE
    return None


def choice_options(operation: Operation) -> list[str]:
    raw_options = operation.get("options", [])
    if isinstance(raw_options, list):
        options = [str(option) for option in raw_options if str(option)]
    else:
        options = []
    value = str(operation.get("fieldValue", ""))
    if value and value not in options:
        options.insert(0, value)
    return options or ["Option 1", "Option 2"]


def register_tab_order_update(widget: fitz.Widget, operation: Operation, updates: dict[int, int]) -> None:
    register_tab_order_xref(widget.xref, operation, updates)


def register_tab_order_xref(xref: int, operation: Operation, updates: dict[int, int]) -> None:
    if "tabIndex" not in operation:
        return
    try:
        tab_index = int(operation.get("tabIndex", 0))
    except (TypeError, ValueError):
        return
    if tab_index > 0:
        updates[xref] = tab_index


def apply_form_tab_order(page: fitz.Page, updates: dict[int, int]) -> None:
    document = page.parent
    annotation_xrefs = page_annotation_xrefs(document, page)
    if not annotation_xrefs:
        return
    original_positions = {xref: index for index, xref in enumerate(annotation_xrefs)}
    ordered = sorted(
        annotation_xrefs,
        key=lambda xref: (
            updates.get(xref, 1_000_000 + original_positions[xref]),
            original_positions[xref],
        ),
    )
    try:
        document.xref_set_key(page.xref, "Annots", "[" + " ".join(f"{xref} 0 R" for xref in ordered) + "]")
        document.xref_set_key(page.xref, "Tabs", "/A")
    except Exception:  # noqa: BLE001
        pass


def page_annotation_xrefs(document: fitz.Document, page: fitz.Page) -> list[int]:
    kind, value = document.xref_get_key(page.xref, "Annots")
    if kind not in {"array", "xref"} or not isinstance(value, str):
        return []
    return [int(match.group(1)) for match in re.finditer(r"(\d+)\s+0\s+R", value)]


def widget_matches_form_operation(widget: fitz.Widget, target_rect: fitz.Rect, field_name: str) -> bool:
    if field_name and widget.field_name == field_name:
        return True
    return rects_match(widget.rect, target_rect)


def update_widget_value(page: fitz.Page, widget: fitz.Widget, operation: Operation, target_rect: fitz.Rect) -> None:
    field_type = str(operation.get("fieldType", ""))
    if field_type == "signature":
        return
    if field_type == "checkbox":
        checked = bool(operation.get("checked", False))
        if checked:
            widget.field_value = widget.on_state() or str(operation.get("exportValue", "Yes"))
        else:
            widget.field_value = "Off"
        widget.update()
        update_widget_flags_and_defaults(page, widget, operation)
        return
    if field_type == "radio":
        selected_value = str(operation.get("fieldValue") or operation.get("exportValue") or "")
        on_state = widget.on_state() or str(operation.get("exportValue", "Yes"))
        checked = bool(operation.get("checked", False)) and rects_match(widget.rect, target_rect)
        widget.field_value = on_state if checked or selected_value == on_state else "Off"
        widget.update()
        update_widget_flags_and_defaults(page, widget, operation)
        return
    widget.field_value = str(operation.get("fieldValue", ""))
    widget.update()
    update_widget_flags_and_defaults(page, widget, operation)


def update_widget_flags_and_defaults(page: fitz.Page, widget: fitz.Widget, operation: Operation) -> None:
    flags = int(getattr(widget, "field_flags", 0) or 0)
    if "required" in operation:
        if bool(operation.get("required")):
            flags |= 2
        else:
            flags &= ~2
    if "readOnly" in operation:
        if bool(operation.get("readOnly")):
            flags |= 1
        else:
            flags &= ~1
    try:
        widget.field_flags = flags
    except Exception:  # noqa: BLE001
        pass
    try:
        page.parent.xref_set_key(widget.xref, "Ff", str(flags))
    except Exception:  # noqa: BLE001
        pass
    if "defaultValue" in operation:
        default_value = str(operation.get("defaultValue", ""))
        try:
            page.parent.xref_set_key(widget.xref, "DV", pdf_literal(default_value))
        except Exception:  # noqa: BLE001
            pass


def update_widget_xref_flags_and_defaults(document: fitz.Document, widget_xref: int, operation: Operation) -> None:
    flags = 0
    if bool(operation.get("required")):
        flags |= 2
    if bool(operation.get("readOnly")):
        flags |= 1
    if flags:
        try:
            document.xref_set_key(widget_xref, "Ff", str(flags))
        except Exception:  # noqa: BLE001
            pass
    if "defaultValue" in operation:
        try:
            document.xref_set_key(widget_xref, "DV", pdf_literal(str(operation.get("defaultValue", ""))))
        except Exception:  # noqa: BLE001
            pass


def pdf_literal(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return f"({escaped})"


def pdf_name(value: str) -> str:
    encoded = []
    for char in value or "Yes":
        code = ord(char)
        if char.isalnum() or char in {"_", "-", "."}:
            encoded.append(char)
        elif code < 256:
            encoded.append(f"#{code:02X}")
        else:
            encoded.append("#3F")
    return "/" + "".join(encoded)


def annotation_matches_delete_operation(
    annotation: fitz.Annot,
    target_rect: fitz.Rect,
    subtype: str,
    source_id: str,
) -> bool:
    if source_id and source_id in {str(annotation.xref), f"{annotation.xref}R"}:
        return True
    if subtype and not annotation_subtype_matches(annotation, subtype):
        return False
    return rects_match(annotation.rect, target_rect)


def annotation_subtype_matches(annotation: fitz.Annot, subtype: str) -> bool:
    annotation_type = annotation.type[1] if len(annotation.type) > 1 else ""
    if annotation_type == subtype:
        return True
    aliases = {
        "rect": {"Square"},
        "highlight": {"Highlight", "Underline", "StrikeOut", "Squiggly"},
        "text": {"FreeText"},
        "pen": {"Ink"},
    }
    return annotation_type in aliases.get(subtype, set())


def rects_match(left: fitz.Rect, right: fitz.Rect) -> bool:
    intersection = left & right
    if intersection.is_empty:
        return False
    left_area = max(1.0, left.get_area())
    right_area = max(1.0, right.get_area())
    overlap = intersection.get_area() / min(left_area, right_area)
    if overlap >= 0.35:
        return True
    left_center = fitz.Point((left.x0 + left.x1) / 2, (left.y0 + left.y1) / 2)
    return right.contains(left_center)


def collect_moved_source_images(
    page: fitz.Page,
    operations: list[Operation],
    metrics: PageMetrics,
) -> dict[str, bytes]:
    images: dict[str, bytes] = {}
    for operation in operations:
        if operation["type"] != "moveImage":
            continue
        image_bytes = extract_source_image_bytes(page, operation, metrics)
        if image_bytes:
            images[moved_source_image_key(operation)] = image_bytes
    return images


def moved_source_image_key(operation: Operation) -> str:
    source_id = str(operation.get("sourceImageId", "")).strip()
    if source_id:
        return source_id
    source = operation.get("eraseOriginal")
    if isinstance(source, dict):
        return json.dumps(source, sort_keys=True)
    return json.dumps(
        {
            "x": operation.get("x", 0),
            "y": operation.get("y", 0),
            "width": operation.get("width", 0),
            "height": operation.get("height", 0),
        },
        sort_keys=True,
    )


def extract_source_image_bytes(page: fitz.Page, operation: Operation, metrics: PageMetrics) -> bytes | None:
    xref = source_image_xref(page, operation, metrics)
    if not xref:
        return None
    try:
        image = page.parent.extract_image(xref)
    except Exception:  # noqa: BLE001
        return None
    image_bytes = image.get("image")
    return image_bytes if isinstance(image_bytes, bytes) else None


def source_image_xref(page: fitz.Page, operation: Operation, metrics: PageMetrics) -> int | None:
    source_id = str(operation.get("sourceImageId", ""))
    parts = source_id.split(":")
    candidate_xrefs: list[int] = []
    if len(parts) >= 2:
        try:
            candidate_xrefs.append(int(parts[1]))
        except ValueError:
            pass
    source = operation.get("eraseOriginal")
    target_rect = to_rect(source, metrics) if isinstance(source, dict) else to_rect(operation, metrics)
    page_xrefs = [int(image[0]) for image in page.get_images(full=True)]
    for xref in candidate_xrefs + page_xrefs:
        try:
            rects = page.get_image_rects(xref)
        except Exception:  # noqa: BLE001
            continue
        if any(rects_match(rect, target_rect) for rect in rects):
            return xref
    return None


def apply_redaction_phase(
    page: fitz.Page,
    operations: list[Operation],
    metrics: PageMetrics,
    save_options: SaveOptions,
) -> None:
    has_redactions = False
    force_image_removal = False
    force_graphics_removal = False
    for operation in operations:
        if operation["type"] == "text" and isinstance(operation.get("eraseOriginal"), dict):
            source_rect = to_rect(operation["eraseOriginal"], metrics)
            page.add_redact_annot(source_rect, fill=(1, 1, 1))
            has_redactions = True
        elif operation["type"] == "redact":
            page.add_redact_annot(to_rect(operation, metrics), fill=(1, 1, 1))
            has_redactions = True
        elif operation["type"] == "redactPage":
            page.add_redact_annot(page.rect, fill=(1, 1, 1))
            has_redactions = True
            force_image_removal = True
        elif operation["type"] == "redactSearch":
            added = add_search_redactions(page, operation)
            has_redactions = has_redactions or added
        elif operation["type"] == "deleteImage":
            page.add_redact_annot(to_rect(operation, metrics), fill=(1, 1, 1))
            has_redactions = True
            force_image_removal = True
        elif operation["type"] == "deleteVector":
            page.add_redact_annot(to_rect(operation, metrics), fill=(1, 1, 1))
            has_redactions = True
            force_graphics_removal = True
        elif operation["type"] == "moveVector":
            source = operation.get("eraseOriginal")
            source_rect = to_rect(source, metrics) if isinstance(source, dict) else to_rect(operation, metrics)
            page.add_redact_annot(source_rect, fill=(1, 1, 1))
            has_redactions = True
            force_graphics_removal = True
        elif operation["type"] == "moveImage":
            source = operation.get("eraseOriginal")
            source_rect = to_rect(source, metrics) if isinstance(source, dict) else to_rect(operation, metrics)
            page.add_redact_annot(source_rect, fill=(1, 1, 1))
            has_redactions = True
            force_image_removal = True
        elif operation["type"] == "flowSlice":
            page.add_redact_annot(flow_slice_source_rect(operation, metrics), fill=(1, 1, 1))
            has_redactions = True

    if has_redactions:
        image_policy, graphics_policy = redaction_policy(save_options)
        if force_image_removal:
            image_policy = fitz.PDF_REDACT_IMAGE_REMOVE
        if force_graphics_removal:
            graphics_policy = fitz.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED
        page.apply_redactions(
            images=image_policy,
            graphics=graphics_policy,
            text=fitz.PDF_REDACT_TEXT_REMOVE,
        )


def redaction_policy(save_options: SaveOptions) -> tuple[int, int]:
    mode = save_options.get("redactionMode", "textOnly")
    if mode == "visualArea":
        return fitz.PDF_REDACT_IMAGE_PIXELS, fitz.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED
    if mode == "imagesAndText":
        return fitz.PDF_REDACT_IMAGE_REMOVE, fitz.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED
    return fitz.PDF_REDACT_IMAGE_NONE, fitz.PDF_REDACT_LINE_ART_NONE


def add_search_redactions(page: fitz.Page, operation: Operation) -> bool:
    if bool(operation.get("regex")):
        return add_regex_redactions(page, operation)
    needle = str(operation.get("text") or operation.get("pattern") or "").strip()
    if not needle:
        return False
    flags = 0 if bool(operation.get("caseSensitive")) else fitz.TEXT_DEHYPHENATE
    added = False
    for rect in page.search_for(needle, flags=flags):
        if rect.is_empty:
            continue
        page.add_redact_annot(rect, fill=(1, 1, 1))
        added = True
    if added:
        return True
    if bool(operation.get("caseSensitive")):
        return False
    lower_needle = needle.lower()
    for rect, word in page_word_rects(page):
        if word.lower() == lower_needle:
            page.add_redact_annot(rect, fill=(1, 1, 1))
            added = True
    return added


def add_regex_redactions(page: fitz.Page, operation: Operation) -> bool:
    pattern = str(operation.get("pattern") or operation.get("text") or "").strip()
    if not pattern:
        return False
    flags = 0 if bool(operation.get("caseSensitive")) else re.IGNORECASE
    try:
        matcher = re.compile(pattern, flags)
    except re.error:
        return False
    added = False
    for rect, word in page_word_rects(page):
        if matcher.search(word):
            page.add_redact_annot(rect, fill=(1, 1, 1))
            added = True
    return added


def page_word_rects(page: fitz.Page) -> list[tuple[fitz.Rect, str]]:
    words: list[tuple[fitz.Rect, str]] = []
    for word in page.get_text("words"):
        if len(word) < 5:
            continue
        x0, y0, x1, y1, value = word[:5]
        text = str(value).strip()
        if text:
            words.append((fitz.Rect(x0, y0, x1, y1), text))
    return words


def apply_insert_phase(
    page: fitz.Page,
    operations: list[Operation],
    metrics: PageMetrics,
    font_path: Path,
    flow_slice_images: list[bytes],
    moved_source_images: dict[str, bytes],
    save_options: SaveOptions,
) -> None:
    flow_slice_index = 0
    native_annotations = save_options.get("annotationMode") == "native"
    for operation in operations:
        op_type = operation["type"]
        if op_type in {
            "deleteAnnotation",
            "deleteImage",
            "deleteVector",
            "formField",
            "cropPage",
            "resizePage",
            "redactPage",
            "redactSearch",
        }:
            continue
        if native_annotations and is_native_annotation_candidate(operation, font_path):
            insert_native_annotation(page, operation, metrics, font_path)
            continue
        if op_type == "text":
            insert_reflow_text(page, operation, metrics, font_path)
        elif op_type == "flowSlice":
            if flow_slice_index < len(flow_slice_images):
                insert_flow_slice(page, operation, metrics, flow_slice_images[flow_slice_index])
            flow_slice_index += 1
        elif op_type == "highlight":
            draw_filled_rect(page, operation, metrics)
        elif op_type == "rect":
            draw_outline_rect(page, operation, metrics)
        elif op_type == "pen":
            draw_pen(page, operation, metrics)
        elif op_type == "image":
            insert_image(page, operation, metrics)
        elif op_type == "moveImage":
            image_bytes = moved_source_images.get(moved_source_image_key(operation))
            if image_bytes:
                page.insert_image(to_rect(operation, metrics), stream=image_bytes, keep_proportion=True)
        elif op_type == "moveVector":
            draw_outline_rect(page, operation, metrics)
        elif op_type == "typedSignature":
            signed_operation: Operation = dict(operation)  # type: ignore[assignment]
            signed_operation["text"] = str(operation.get("signerName") or operation.get("text") or "")
            insert_reflow_text(page, signed_operation, metrics, font_path)
        elif op_type == "drawnSignature":
            draw_pen(page, operation, metrics)
        elif op_type == "signatureImage":
            insert_image(page, operation, metrics)
        elif op_type == "fileAttachment":
            insert_file_attachment(page, operation, metrics)


def is_native_annotation_candidate(operation: Operation, font_path: Path) -> bool:
    if operation["type"] == "text" and isinstance(operation.get("eraseOriginal"), dict):
        return False
    if operation["type"] == "text" and choose_engine_font(operation, str(operation.get("text", "")), font_path) == "pdfeditfont":
        return False
    return operation["type"] in {"text", "highlight", "rect", "pen"}


def insert_native_annotation(
    page: fitz.Page,
    operation: Operation,
    metrics: PageMetrics,
    font_path: Path,
) -> None:
    op_type = operation["type"]
    color = hex_to_rgb(str(operation.get("color", "#111111")))
    opacity = float(operation.get("opacity", 1))
    if op_type == "text":
        rect = to_rect(operation, metrics)
        text = str(operation.get("text", ""))
        font_name = choose_engine_font(operation, text, font_path)
        if font_name == "pdfeditfont":
            font_name = "helv"
        annot = page.add_freetext_annot(
            rect,
            text,
            fontsize=max(4.0, float(operation.get("fontSize", 12))),
            fontname=font_name,
            text_color=color,
            fill_color=None,
            border_color=None,
            opacity=opacity,
        )
        annot.update()
        return
    if op_type == "highlight":
        annot = page.add_highlight_annot(to_rect(operation, metrics))
        annot.set_colors(stroke=color)
        annot.set_opacity(opacity)
        annot.update()
        return
    if op_type == "rect":
        annot = page.add_rect_annot(to_rect(operation, metrics))
        annot.set_colors(stroke=color)
        annot.set_border(width=float(operation.get("strokeWidth", 2)))
        annot.set_opacity(opacity)
        annot.update()
        return
    if op_type == "pen":
        points = operation.get("points", [])
        if not isinstance(points, list) or len(points) < 2:
            return
        handwriting = [[to_point(point, metrics) for point in points if isinstance(point, dict)]]
        annot = page.add_ink_annot(handwriting)
        annot.set_colors(stroke=color)
        annot.set_border(width=float(operation.get("strokeWidth", 3)))
        annot.set_opacity(opacity)
        annot.update()


def render_flow_slice_images(
    page: fitz.Page,
    operations: list[Operation],
    metrics: PageMetrics,
) -> list[bytes]:
    images: list[bytes] = []
    matrix = fitz.Matrix(2, 2)
    for operation in operations:
        if operation["type"] != "flowSlice":
            continue
        rect = flow_slice_source_rect(operation, metrics)
        pixmap = page.get_pixmap(matrix=matrix, clip=rect, alpha=False)
        images.append(pixmap.tobytes("png"))
    return images


def insert_flow_slice(
    page: fitz.Page,
    operation: Operation,
    metrics: PageMetrics,
    image_bytes: bytes,
) -> None:
    page.draw_rect(flow_slice_source_rect(operation, metrics), color=None, fill=(1, 1, 1), overlay=True)
    page.insert_image(to_rect(operation, metrics), stream=image_bytes, keep_proportion=False)


def insert_reflow_text(
    page: fitz.Page,
    operation: Operation,
    metrics: PageMetrics,
    font_path: Path,
) -> None:
    rect = to_rect(operation, metrics)
    text = str(operation.get("text", ""))
    font_size = max(4.0, float(operation.get("fontSize", 12)))
    color = hex_to_rgb(str(operation.get("color", "#111111")))
    font_name = choose_engine_font(operation, text, font_path)
    if font_name == "pdfeditfont":
        insert_custom_font_htmlbox(page, rect, operation, text, font_size, color, font_path)
        return
    remaining = page.insert_textbox(
        rect,
        text,
        fontsize=font_size,
        fontname=font_name,
        color=color,
        align=fitz.TEXT_ALIGN_LEFT,
    )
    if isinstance(remaining, (int, float)) and remaining < 0:
        page.insert_text(
            rect.tl,
            text,
            fontsize=font_size,
            fontname=font_name,
            color=color,
        )


def insert_custom_font_htmlbox(
    page: fitz.Page,
    rect: fitz.Rect,
    operation: Operation,
    text: str,
    font_size: float,
    color: tuple[float, float, float],
    font_path: Path,
) -> None:
    line_height = max(1.0, float(operation.get("lineHeight", 1.18)))
    html = build_text_html(text, font_size, color, line_height)
    archive = fitz.Archive(str(font_path), font_path.name)
    css = f"@font-face{{font-family:pdfedit;src:url({font_path.name});}}"
    page.insert_htmlbox(
        rect,
        html,
        css=css,
        archive=archive,
        opacity=float(operation.get("opacity", 1)),
    )


def build_text_html(text: str, font_size: float, color: tuple[float, float, float], line_height: float) -> str:
    red = int(color[0] * 255)
    green = int(color[1] * 255)
    blue = int(color[2] * 255)
    escaped = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br>")
    )
    return (
        f"<div style=\"font-family:pdfedit, sans-serif; font-size:{font_size}pt; "
        f"line-height:{line_height}; color:rgb({red},{green},{blue});\">{escaped}</div>"
    )


def choose_engine_font(operation: Operation, text: str, font_path: Path) -> str:
    if font_path.exists() and any(ord(char) > 255 for char in text):
        return "pdfeditfont"
    family = f"{operation.get('fontFamily', '')} {operation.get('fontName', '')}".lower()
    if "courier" in family or "mono" in family or "typewriter" in family:
        return "cour"
    if "times" in family or "serif" in family or "cmr" in family:
        return "tiro"
    return "helv"


def draw_filled_rect(page: fitz.Page, operation: Operation, metrics: PageMetrics) -> None:
    rect = to_rect(operation, metrics)
    color = hex_to_rgb(str(operation.get("color", "#ffe45c")))
    page.draw_rect(rect, color=None, fill=color, fill_opacity=float(operation.get("opacity", 0.45)))


def draw_outline_rect(page: fitz.Page, operation: Operation, metrics: PageMetrics) -> None:
    rect = to_rect(operation, metrics)
    color = hex_to_rgb(str(operation.get("color", "#176b58")))
    page.draw_rect(rect, color=color, width=float(operation.get("strokeWidth", 2)))


def draw_pen(page: fitz.Page, operation: Operation, metrics: PageMetrics) -> None:
    points = operation.get("points", [])
    if not isinstance(points, list) or len(points) < 2:
        return
    color = hex_to_rgb(str(operation.get("color", "#d8342a")))
    width = float(operation.get("strokeWidth", 3))
    shape = page.new_shape()
    previous = to_point(points[0], metrics)
    for point in points[1:]:
        current = to_point(point, metrics)
        shape.draw_line(previous, current)
        previous = current
    shape.finish(color=color, width=width)
    shape.commit()


def insert_image(page: fitz.Page, operation: Operation, metrics: PageMetrics) -> None:
    data_url = str(operation.get("dataUrl", ""))
    if not data_url.startswith("data:image/") or "," not in data_url:
        return
    image_bytes = base64.b64decode(data_url.split(",", 1)[1])
    page.insert_image(to_rect(operation, metrics), stream=image_bytes, keep_proportion=True)


def insert_file_attachment(page: fitz.Page, operation: Operation, metrics: PageMetrics) -> None:
    file_base64 = str(operation.get("fileBase64", "")).strip()
    if not file_base64:
        return
    try:
        payload = base64.b64decode(file_base64)
    except (binascii.Error, ValueError):
        return
    file_name = str(operation.get("fileName", "attachment.bin")).strip() or "attachment.bin"
    description = str(operation.get("description", "")).strip() or None
    rect = to_rect(operation, metrics)
    point = fitz.Point(rect.x0, rect.y0)
    try:
        annotation = page.add_file_annot(point, payload, file_name, desc=description, icon="PushPin")
        annotation.set_info(content=description or file_name, title=str(operation.get("signerName", "") or "PDFEdit"))
        annotation.update()
    except Exception:  # noqa: BLE001
        return


def validate_pdf_bytes(pdf_bytes: bytes, password: str = "") -> dict[str, Any]:
    errors: list[str] = []
    page_count = 0
    encrypted = False
    annotation_count = 0
    text_length = 0
    page_sizes: list[dict[str, float]] = []
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            encrypted = bool(document.needs_pass)
            if encrypted and password:
                authenticate_if_needed(document, password)
            page_count = document.page_count if not encrypted or password else 0
            if not encrypted or password:
                for page_index in range(document.page_count):
                    page = document.load_page(page_index)
                    page_sizes.append({"width": page.rect.width, "height": page.rect.height})
                    annotation_count += len(list(page.annots() or []))
                    text_length += len(page.get_text("text"))
    except Exception as exc:  # noqa: BLE001 - validation reports diagnostics instead of crashing
        errors.append(str(exc))

    qpdf_checked = False
    qpdf_path = shutil.which("qpdf")
    if qpdf_path:
        qpdf_checked = True
        with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
            handle.write(pdf_bytes)
            handle.flush()
            result = subprocess.run(
                qpdf_check_command(qpdf_path, handle.name, password),
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                errors.append(result.stderr.strip() or result.stdout.strip() or "qpdf --check failed")
    elif os.environ.get("REQUIRE_QPDF", "").lower() in {"1", "true", "yes"}:
        errors.append("qpdf is required for this validation run but was not found on PATH")

    return {
        "ok": not errors,
        "pageCount": page_count,
        "encrypted": encrypted,
        "annotationCount": annotation_count,
        "textLength": text_length,
        "pageSizes": page_sizes,
        "qpdfChecked": qpdf_checked,
        "errors": errors,
    }


def qpdf_check_command(qpdf_path: str, file_path: str, password: str) -> list[str]:
    if password:
        return [qpdf_path, f"--password={password}", "--check", file_path]
    return [qpdf_path, "--check", file_path]


def preflight_pdf_bytes(pdf_bytes: bytes) -> dict[str, Any]:
    validation = validate_pdf_bytes(pdf_bytes)
    standards_validation = validate_standards_with_verapdf(pdf_bytes)
    pdfx_validation = validate_pdfx_structure(pdf_bytes)
    warnings: list[str] = []
    pages: list[dict[str, Any]] = []
    metadata_present = False
    xmp_present = False
    embedded_file_count = 0
    javascript_count = 0
    javascript_name_tree_count = 0
    form_field_count = 0
    signature_field_count = 0
    xfa_present = False
    explicit_tab_order_page_count = 0
    hidden_layer_count = 0
    comment_annotation_count = 0
    file_attachment_annotation_count = 0
    annotation_action_count = 0
    link_action_count = 0
    embedded_search_index_count = count_embedded_search_index_signals(pdf_bytes)
    stale_incremental_save_count = max(0, pdf_bytes.count(b"%%EOF") - 1)
    unreferenced_object_signal_count = count_unreferenced_object_signals(pdf_bytes)
    standard_claims = detect_standard_profile_claims(pdf_bytes)
    font_names: set[str] = set()
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            if document.needs_pass:
                warnings.append("encrypted document cannot be fully preflighted without password")
            else:
                metadata_present = any(
                    bool(value)
                    for key, value in (document.metadata or {}).items()
                    if key not in {"format", "encryption"} and isinstance(value, str)
                )
                try:
                    xmp_present = bool(document.get_xml_metadata())
                except Exception:  # noqa: BLE001 - metadata checks should stay diagnostic-only
                    xmp_present = False
                try:
                    embedded_file_count = int(document.embfile_count())
                except Exception:  # noqa: BLE001
                    embedded_file_count = 0
                javascript_count = count_javascript_objects(document)
                javascript_name_tree_count = count_javascript_name_tree_objects(document)
                standard_claims = detect_standard_profile_claims(pdf_bytes, document)
                standard_claims["outputIntentCount"] = count_output_intents(document)
                xfa_present = detect_xfa(document)
                hidden_layer_count = count_hidden_layers(document)
                for page_index in range(document.page_count):
                    page = document.load_page(page_index)
                    annots = list(page.annots() or [])
                    widgets = list(page.widgets() or [])
                    form_field_count += len(widgets)
                    signature_field_count += count_signature_widgets(widgets)
                    if page_has_explicit_tab_order(document, page):
                        explicit_tab_order_page_count += 1
                    comment_annotation_count += count_comment_annotations(annots)
                    file_attachment_annotation_count += count_file_attachment_annotations(annots)
                    annotation_action_count += count_annotation_actions(document, annots)
                    link_action_count += len(page.get_links())
                    page_fonts = page.get_fonts(full=True)
                    for font in page_fonts:
                        if len(font) > 3 and font[3]:
                            font_names.add(str(font[3]))
                    pages.append(
                        {
                            "index": page_index,
                            "width": page.rect.width,
                            "height": page.rect.height,
                            "mediaBox": rect_to_list(page.mediabox),
                            "cropBox": rect_to_list(page.cropbox),
                            "rotation": page.rotation,
                            "images": len(page.get_images(full=True)),
                            "drawings": len(page.get_drawings()),
                            "annotations": len(annots),
                            "widgets": len(widgets),
                            "fonts": len(page_fonts),
                        }
                    )
    except Exception as exc:  # noqa: BLE001
        warnings.append(str(exc))

    if metadata_present:
        warnings.append("document metadata is present")
    if xmp_present:
        warnings.append("XMP metadata is present")
    if embedded_file_count:
        warnings.append(f"{embedded_file_count} embedded file(s) present")
    if javascript_count:
        warnings.append(f"{javascript_count} JavaScript/action object(s) present")
    if javascript_name_tree_count:
        warnings.append(f"{javascript_name_tree_count} JavaScript name tree object(s) present")
    if hidden_layer_count:
        warnings.append(f"{hidden_layer_count} optional content group/layer signal(s) present")
    if comment_annotation_count:
        warnings.append(f"{comment_annotation_count} comment annotation(s) present")
    if file_attachment_annotation_count:
        warnings.append(f"{file_attachment_annotation_count} file attachment annotation(s) present")
    if annotation_action_count:
        warnings.append(f"{annotation_action_count} annotation action object(s) present")
    if link_action_count:
        warnings.append(f"{link_action_count} link action(s) present")
    if embedded_search_index_count:
        warnings.append(f"{embedded_search_index_count} embedded search index signal(s) present")
    if stale_incremental_save_count:
        warnings.append(f"{stale_incremental_save_count} stale incremental save section(s) present")
    if unreferenced_object_signal_count:
        warnings.append(f"{unreferenced_object_signal_count} unreferenced object signal(s) present")
    if standard_claims.get("pdfaClaim") and not standard_claims.get("outputIntentCount"):
        warnings.append("PDF/A claim is present without an OutputIntent signal")
    if standard_claims.get("pdfxClaim") and not standard_claims.get("outputIntentCount"):
        warnings.append("PDF/X claim is present without an OutputIntent signal")
    if signature_field_count:
        warnings.append(f"{signature_field_count} signature field(s) present")
    if xfa_present:
        warnings.append("XFA form data is present and is not editable in this editor")
    if form_field_count and explicit_tab_order_page_count == 0:
        warnings.append("form fields present without explicit annotation tab order")
    if not validation.get("qpdfChecked"):
        warnings.append("qpdf structural check was not run")
    if standards_validation.get("available"):
        if standards_validation.get("validated"):
            if not standards_validation.get("passed"):
                profile_name = standards_validation.get("profileName") or "selected standards profile"
                warnings.append(f"veraPDF standards validation failed for {profile_name}")
        else:
            warnings.append("veraPDF standards validation did not complete")
    elif standards_validation.get("errors"):
        warnings.extend(str(error) for error in standards_validation.get("errors", []))
    if pdfx_validation.get("claim"):
        if not pdfx_validation.get("passed"):
            profile_name = pdfx_validation.get("profileName") or pdfx_validation.get("claim") or "PDF/X"
            warnings.append(f"PDF/X structural validation failed for {profile_name}")
    elif os.environ.get("REQUIRE_PDFX_VALIDATION", "").lower() in {"1", "true", "yes"}:
        warnings.append("PDF/X validation was required but the document has no PDF/X claim")

    return {
        "ok": validation["ok"] and len(warnings) == 0,
        "validation": validation,
        "standardsValidation": standards_validation,
        "pdfxValidation": pdfx_validation,
        "warnings": warnings,
        "pageCount": validation["pageCount"],
        "encrypted": validation["encrypted"],
        "metadataPresent": metadata_present,
        "xmpPresent": xmp_present,
        "embeddedFileCount": embedded_file_count,
        "javascriptCount": javascript_count,
        "javascriptNameTreeCount": javascript_name_tree_count,
        "formFieldCount": form_field_count,
        "signatureFieldCount": signature_field_count,
        "xfaPresent": xfa_present,
        "explicitTabOrderPageCount": explicit_tab_order_page_count,
        "fontCount": len(font_names),
        "hiddenLayerCount": hidden_layer_count,
        "commentAnnotationCount": comment_annotation_count,
        "fileAttachmentAnnotationCount": file_attachment_annotation_count,
        "annotationActionCount": annotation_action_count,
        "linkActionCount": link_action_count,
        "embeddedSearchIndexCount": embedded_search_index_count,
        "staleIncrementalSaveCount": stale_incremental_save_count,
        "unreferencedObjectSignalCount": unreferenced_object_signal_count,
        "pdfaClaim": standard_claims.get("pdfaClaim", ""),
        "pdfxClaim": standard_claims.get("pdfxClaim", ""),
        "outputIntentCount": standard_claims.get("outputIntentCount", 0),
        "fonts": sorted(font_names),
        "pages": pages,
    }


def validate_pdfx_structure(pdf_bytes: bytes, expected_profile: str = "") -> dict[str, Any]:
    validation = validate_pdf_bytes(pdf_bytes)
    result: dict[str, Any] = {
        "available": True,
        "validator": "pdfedit-pdfx-structural",
        "validated": False,
        "passed": False,
        "profileName": "",
        "claim": "",
        "expectedProfile": expected_profile,
        "outputIntentCount": 0,
        "outputIntentHasGtsPdfx": False,
        "checks": [],
        "errors": [],
        "warnings": [],
    }

    def add_check(check_id: str, passed: bool, message: str, severity: str = "error") -> None:
        result["checks"].append(
            {
                "id": check_id,
                "passed": bool(passed),
                "severity": severity,
                "message": message,
            }
        )
        if not passed:
            if severity == "error":
                result["errors"].append(message)
            else:
                result["warnings"].append(message)

    add_check("pymupdf-qpdf-open", bool(validation.get("ok")), "PDF must open in PyMuPDF and pass qpdf")
    add_check("not-encrypted", not bool(validation.get("encrypted")), "PDF/X output must not be encrypted")

    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            claims = detect_standard_profile_claims(pdf_bytes, document)
            claim = str(claims.get("pdfxClaim") or "")
            profile = normalize_pdfx_profile(claim)
            result["claim"] = claim
            result["profileName"] = profile
            result["outputIntentCount"] = count_output_intents(document)
            result["outputIntentHasGtsPdfx"] = output_intent_has_gts_pdfx(document)
            add_check("pdfx-claim-present", bool(claim), "PDF/X claim is missing")
            if expected_profile:
                add_check(
                    "pdfx-expected-profile",
                    normalize_pdfx_profile(expected_profile) == profile,
                    f"PDF/X profile does not match {expected_profile}",
                )
            add_check(
                "pdfx-supported-profile",
                not claim or profile in {"PDF/X-1a:2001", "PDF/X-3:2002"},
                "Engine structural validation supports only PDF/X-1a:2001 and PDF/X-3:2002 profiles",
                "warning",
            )
            add_check(
                "output-intent-present",
                int(result["outputIntentCount"]) > 0,
                "PDF/X OutputIntent is missing",
            )
            add_check(
                "output-intent-gts-pdfx",
                bool(result["outputIntentHasGtsPdfx"]),
                "OutputIntent /S /GTS_PDFX is missing",
            )
            trapped = find_document_info_name(document, "Trapped")
            add_check("trapped-present", trapped in {"/True", "/False"}, "Info dictionary /Trapped /True or /False is missing")

            missing_boxes = find_pages_missing_pdfx_boxes(document)
            add_check(
                "trim-or-art-boxes",
                not missing_boxes,
                "One or more pages lack TrimBox or ArtBox",
            )
            if missing_boxes:
                result["missingBoxPages"] = missing_boxes

            font_issues = find_unembedded_font_issues(document)
            add_check(
                "fonts-embedded",
                not font_issues,
                "One or more page fonts are not embedded",
            )
            if font_issues:
                result["fontIssues"] = font_issues[:20]

            transparency_count = count_pdf_transparency_signals(document)
            add_check(
                "no-transparency",
                transparency_count == 0,
                "Transparency signals are present and are not allowed for PDF/X-1a/3 compatibility",
            )
            result["transparencySignalCount"] = transparency_count

            action_count = count_javascript_objects(document) + count_javascript_name_tree_objects(document)
            for page in document:
                action_count += len(page.get_links())
            add_check(
                "no-interactive-actions",
                action_count == 0,
                "JavaScript or link actions remain in the PDF/X candidate",
                "warning",
            )
            result["interactiveActionSignalCount"] = action_count
            result["validated"] = bool(validation.get("ok"))
    except Exception as exc:  # noqa: BLE001 - diagnostics should be returned as JSON
        result["errors"].append(str(exc))

    result["passed"] = bool(result["validated"]) and not result["errors"]
    return result


def preflight_fixup_pdf_bytes(pdf_bytes: bytes, target_profile: str = "pdfx-3") -> dict[str, Any]:
    if target_profile != "pdfx-3":
        raise ValueError("only pdfx-3 preflight fixup is currently implemented")
    before = preflight_pdf_bytes(pdf_bytes)
    output_bytes, fixup_report = ghostscript_pdfx3_fixup(pdf_bytes)
    after = preflight_pdf_bytes(output_bytes)
    pdfx_after = after.get("pdfxValidation", {})
    ok = bool(after.get("validation", {}).get("ok")) and bool(pdfx_after.get("passed"))
    report = {
        "ok": ok,
        "targetProfile": "PDF/X-3:2002",
        "engine": "ghostscript-pdfwrite",
        "fixup": fixup_report,
        "before": {
            "validation": before.get("validation"),
            "pdfxValidation": before.get("pdfxValidation"),
            "warnings": before.get("warnings", []),
        },
        "after": {
            "validation": after.get("validation"),
            "pdfxValidation": pdfx_after,
            "warnings": after.get("warnings", []),
            "pdfxClaim": after.get("pdfxClaim", ""),
            "outputIntentCount": after.get("outputIntentCount", 0),
        },
    }
    if not ok:
        errors = list(pdfx_after.get("errors", [])) if isinstance(pdfx_after, dict) else []
        if not errors:
            errors = list(after.get("validation", {}).get("errors", []))
        report["errors"] = errors or ["PDF/X-3 fixup output did not pass validation"]
    return {"ok": ok, "pdfBytes": output_bytes, "report": report}


def ghostscript_pdfx3_fixup(pdf_bytes: bytes) -> tuple[bytes, dict[str, Any]]:
    gs_path = os.environ.get("GHOSTSCRIPT_BIN") or shutil.which("gs")
    report: dict[str, Any] = {
        "engine": "ghostscript",
        "enginePath": gs_path or "",
        "engineVersion": "",
        "targetProfile": "PDF/X-3:2002",
        "iccProfile": "",
        "command": [],
        "stderr": "",
        "stdout": "",
    }
    if not gs_path:
        message = "Ghostscript is required for PDF/X-3 preflight fixup but was not found on PATH"
        if os.environ.get("REQUIRE_PREFLIGHT_FIXUP", "").lower() in {"1", "true", "yes"}:
            raise RuntimeError(message)
        raise RuntimeError(message)

    version = subprocess.run([gs_path, "--version"], check=False, capture_output=True, text=True)
    report["engineVersion"] = version.stdout.strip() or version.stderr.strip()
    icc_profile = resolve_pdfx_icc_profile()
    report["iccProfile"] = str(icc_profile)

    with tempfile.TemporaryDirectory(prefix="pdfedit-pdfx-") as temp_name:
        temp_dir = Path(temp_name)
        input_path = temp_dir / "input.pdf"
        output_path = temp_dir / "output-pdfx3.pdf"
        pdfx_def_path = temp_dir / "PDFX_def.ps"
        input_path.write_bytes(pdf_bytes)
        pdfx_def_path.write_text(build_pdfx_def_ps(icc_profile), encoding="utf-8")
        command = [
            gs_path,
            "-q",
            "-dPDFX=3",
            "-dBATCH",
            "-dNOPAUSE",
            "-dSAFER",
            "-dPDFSTOPONERROR",
            "-dPDFACompatibilityPolicy=1",
            "-dEmbedAllFonts=true",
            "-dSubsetFonts=true",
            "-dCompressFonts=true",
            "-sProcessColorModel=DeviceCMYK",
            "-sColorConversionStrategy=CMYK",
            "-sDEVICE=pdfwrite",
            f"-sOutputFile={output_path}",
            str(pdfx_def_path),
            str(input_path),
        ]
        report["command"] = redact_temp_paths(command)
        completed = subprocess.run(command, check=False, capture_output=True, text=True, timeout=120)
        report["exitCode"] = completed.returncode
        report["stderr"] = completed.stderr.strip()
        report["stdout"] = completed.stdout.strip()
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "Ghostscript PDF/X-3 fixup failed")
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("Ghostscript PDF/X-3 fixup did not create an output PDF")
        return output_path.read_bytes(), report


def resolve_pdfx_icc_profile() -> Path:
    env_path = os.environ.get("PDFX_ICC_PROFILE")
    if env_path and Path(env_path).exists():
        return Path(env_path)
    patterns = [
        "/opt/homebrew/Cellar/ghostscript/*/share/ghostscript/iccprofiles/default_cmyk.icc",
        "/opt/homebrew/share/ghostscript/*/iccprofiles/default_cmyk.icc",
        "/usr/local/share/ghostscript/*/iccprofiles/default_cmyk.icc",
        "/usr/share/ghostscript/*/iccprofiles/default_cmyk.icc",
        "/usr/share/color/icc/*CMYK*.icc",
    ]
    for pattern in patterns:
        matches = sorted(glob.glob(pattern), reverse=True)
        for match in matches:
            candidate = Path(match)
            if candidate.exists():
                return candidate
    raise RuntimeError("No CMYK ICC profile found for PDF/X-3 fixup; set PDFX_ICC_PROFILE")


def build_pdfx_def_ps(icc_profile: Path) -> str:
    icc = ps_string_escape(str(icc_profile))
    return f"""%!
% Generated by PDFeditor for Ghostscript PDF/X-3 fixup.
% Ghostscript pdfwrite consumes this prefix through pdfmark.
[ /GTS_PDFXVersion (PDF/X-3:2002)
  /Title (PDFeditor PDF/X-3 Fixup)
  /Trapped /False
/DOCINFO pdfmark

/ICCProfile ({icc}) def
[/_objdef {{icc_PDFX}} /type /stream /OBJ pdfmark
[{{icc_PDFX}} << /N 4 >> /PUT pdfmark
[{{icc_PDFX}} ICCProfile (r) file /PUT pdfmark

[/_objdef {{OutputIntent_PDFX}} /type /dict /OBJ pdfmark
[{{OutputIntent_PDFX}} <<
  /Type /OutputIntent
  /S /GTS_PDFX
  /OutputCondition (PDFeditor CMYK PDF/X-3 fixup)
  /Info (Ghostscript pdfwrite PDF/X-3)
  /OutputConditionIdentifier (PDFeditor-CMYK)
  /RegistryName (http://www.color.org)
  /DestOutputProfile {{icc_PDFX}}
>> /PUT pdfmark
[{{Catalog}} <</OutputIntents [ {{OutputIntent_PDFX}} ]>> /PUT pdfmark
"""


def ps_string_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def redact_temp_paths(command: list[str]) -> list[str]:
    return [re.sub(r"/[^ ]*/pdfedit-pdfx-[^/]+", "<tmp>", part) for part in command]


def validate_standards_with_verapdf(pdf_bytes: bytes) -> dict[str, Any]:
    verapdf_path = os.environ.get("VERAPDF_BIN") or shutil.which("verapdf")
    result: dict[str, Any] = {
        "available": bool(verapdf_path),
        "validator": "verapdf",
        "validatorPath": verapdf_path or "",
        "validatorVersion": "",
        "validated": False,
        "passed": False,
        "compliant": False,
        "profileName": "",
        "statement": "",
        "exitCode": None,
        "passedRules": 0,
        "failedRules": 0,
        "passedChecks": 0,
        "failedChecks": 0,
        "failures": [],
        "errors": [],
    }
    if not verapdf_path:
        if os.environ.get("REQUIRE_STANDARDS_VALIDATOR", "").lower() in {"1", "true", "yes"}:
            result["errors"].append("veraPDF is required for this preflight run but was not found on PATH")
        return result

    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(pdf_bytes)
        handle.flush()
        try:
            completed = subprocess.run(
                [
                    verapdf_path,
                    "--format",
                    "json",
                    "--flavour",
                    "0",
                    "--maxfailuresdisplayed",
                    "10",
                    handle.name,
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            result["errors"].append("veraPDF validation timed out")
            return result
        except Exception as exc:  # noqa: BLE001 - preflight must stay diagnostic
            result["errors"].append(f"veraPDF validation failed to run: {exc}")
            return result

    result["exitCode"] = completed.returncode
    if completed.stderr.strip():
        result["errors"].append(completed.stderr.strip())
    if not completed.stdout.strip():
        result["errors"].append("veraPDF returned no JSON report")
        return result

    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        result["errors"].append(f"veraPDF returned invalid JSON: {exc}")
        return result

    release_details = (
        report.get("report", {})
        .get("buildInformation", {})
        .get("releaseDetails", [])
    )
    if isinstance(release_details, list):
        versions = [
            str(detail.get("version", ""))
            for detail in release_details
            if isinstance(detail, dict) and detail.get("id") in {"apps", "core"}
        ]
        result["validatorVersion"] = next((version for version in versions if version), "")

    jobs = report.get("report", {}).get("jobs", [])
    if not isinstance(jobs, list) or not jobs:
        result["errors"].append("veraPDF report did not contain a validation job")
        return result
    validation_results = jobs[0].get("validationResult", []) if isinstance(jobs[0], dict) else []
    if not isinstance(validation_results, list) or not validation_results:
        result["errors"].append("veraPDF report did not contain validationResult")
        return result

    validation_result = validation_results[0]
    if not isinstance(validation_result, dict):
        result["errors"].append("veraPDF validationResult had an unexpected shape")
        return result

    details = validation_result.get("details", {})
    result["validated"] = validation_result.get("jobEndStatus") == "normal"
    result["compliant"] = bool(validation_result.get("compliant"))
    result["passed"] = bool(validation_result.get("compliant")) and result["validated"]
    result["profileName"] = str(validation_result.get("profileName") or "")
    result["statement"] = str(validation_result.get("statement") or "")
    if isinstance(details, dict):
        result["passedRules"] = int(details.get("passedRules") or 0)
        result["failedRules"] = int(details.get("failedRules") or 0)
        result["passedChecks"] = int(details.get("passedChecks") or 0)
        result["failedChecks"] = int(details.get("failedChecks") or 0)
        summaries = details.get("ruleSummaries", [])
        if isinstance(summaries, list):
            result["failures"] = [summarize_verapdf_failure(summary) for summary in summaries[:10]]

    if completed.returncode not in {0, 1}:
        result["errors"].append(f"veraPDF exited with unexpected code {completed.returncode}")
    return result


def summarize_verapdf_failure(summary: Any) -> dict[str, Any]:
    if not isinstance(summary, dict):
        return {"description": str(summary)}
    checks = summary.get("checks", [])
    first_check = checks[0] if isinstance(checks, list) and checks and isinstance(checks[0], dict) else {}
    return {
        "specification": str(summary.get("specification") or ""),
        "clause": str(summary.get("clause") or ""),
        "testNumber": summary.get("testNumber"),
        "description": str(summary.get("description") or ""),
        "object": str(summary.get("object") or ""),
        "failedChecks": int(summary.get("failedChecks") or 0),
        "context": str(first_check.get("context") or ""),
        "errorMessage": str(first_check.get("errorMessage") or ""),
    }


def write_preflight_report_pdf(result: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document = fitz.open()
    page = document.new_page(width=612, height=792)
    lines = [
        "PDF Preflight Report",
        f"Status: {'OK' if result.get('ok') else 'Warnings'}",
        f"Pages: {result.get('pageCount', 0)}",
        f"Fonts: {result.get('fontCount', 0)}",
        f"Form fields: {result.get('formFieldCount', 0)}",
        f"Hidden layers: {result.get('hiddenLayerCount', 0)}",
        f"JavaScript objects: {result.get('javascriptCount', 0)}",
        f"Embedded files: {result.get('embeddedFileCount', 0)}",
    ]
    standards = result.get("standardsValidation", {})
    if isinstance(standards, dict):
        lines.extend(
            [
                f"veraPDF: {'available' if standards.get('available') else 'not available'}",
                f"veraPDF profile: {standards.get('profileName') or 'n/a'}",
                f"veraPDF compliant: {standards.get('passed')}",
                f"veraPDF failed checks: {standards.get('failedChecks', 0)}",
            ]
        )
        failures = standards.get("failures", [])
        if isinstance(failures, list) and failures:
            lines.append(f"veraPDF first failure: {failures[0].get('description', '')}")
            first_error = failures[0].get("errorMessage", "")
            if first_error:
                lines.append(f"veraPDF first error: {first_error}")
    pdfx = result.get("pdfxValidation", {})
    if isinstance(pdfx, dict):
        lines.extend(
            [
                f"PDF/X validator: {pdfx.get('validator', 'n/a')}",
                f"PDF/X claim: {pdfx.get('claim') or 'none'}",
                f"PDF/X structural pass: {pdfx.get('passed')}",
                f"PDF/X OutputIntent count: {pdfx.get('outputIntentCount', 0)}",
            ]
        )
        errors = pdfx.get("errors", [])
        if isinstance(errors, list) and errors:
            lines.append(f"PDF/X first error: {errors[0]}")
    lines.extend(["", "Warnings:"])
    warnings = result.get("warnings", [])
    if isinstance(warnings, list) and warnings:
        lines.extend(f"- {warning}" for warning in warnings[:30])
    else:
        lines.append("- none")
    page.insert_textbox(fitz.Rect(54, 54, 558, 738), "\n".join(lines), fontsize=11, fontname="helv")
    document.save(output_path, garbage=4, deflate=True, clean=True)
    document.close()


def accessibility_pdf_bytes(pdf_bytes: bytes, password: str = "") -> dict[str, Any]:
    validation = validate_pdf_bytes(pdf_bytes, password)
    warnings: list[str] = []
    title = ""
    title_present = False
    language = ""
    tagged = False
    image_count = 0
    image_alt_text_count = 0
    form_field_count = 0
    form_description_count = 0
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            if document.needs_pass:
                authenticate_if_needed(document, password)
            title = str((document.metadata or {}).get("title") or "")
            title_present = bool(title)
            language = catalog_language(document)
            tagged = document_has_tag_structure(document)
            for page in document:
                page_images = page.get_images(full=True)
                image_count += len(page_images)
                image_alt_text_count += count_image_alt_texts(document, page_images)
                for widget in list(page.widgets() or []):
                    form_field_count += 1
                    label = str(getattr(widget, "field_label", "") or "")
                    if label:
                        form_description_count += 1
    except Exception as exc:  # noqa: BLE001
        warnings.append(str(exc))
    if not title_present:
        warnings.append("document title is missing")
    if not language:
        warnings.append("document language is missing")
    if not tagged:
        warnings.append("tag tree is missing")
    if image_count and image_alt_text_count < image_count:
        warnings.append("some image objects do not expose alternate text")
    if form_field_count and form_description_count < form_field_count:
        warnings.append("some form fields do not expose descriptions/tooltips")
    return {
        "ok": validation["ok"] and not warnings,
        "validation": validation,
        "warnings": warnings,
        "title": title,
        "titlePresent": title_present,
        "language": language,
        "tagged": tagged,
        "imageCount": image_count,
        "imageAltTextCount": image_alt_text_count,
        "formFieldCount": form_field_count,
        "formDescriptionCount": form_description_count,
    }


def accessibility_repair_pdf_bytes(
    pdf_bytes: bytes,
    password: str = "",
    title: str = "",
    language: str = "",
    alt_texts: Any = None,
) -> dict[str, Any]:
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        authenticate_if_needed(document, password)
        metadata = document.metadata or {}
        if title.strip():
            metadata["title"] = title.strip()
        document.set_metadata(metadata)
        if language.strip():
            document.xref_set_key(document.pdf_catalog(), "Lang", pdf_literal(language.strip()))
        ensure_basic_tag_structure(document)
        alt_entries = normalize_alt_text_entries(alt_texts)
        applied_alt_texts = apply_image_alt_texts(document, alt_entries)
        for page in document:
            try:
                document.xref_set_key(page.xref, "Tabs", "/S")
            except Exception:  # noqa: BLE001
                pass
        buffer = io.BytesIO()
        document.save(buffer, garbage=4, deflate=True, clean=True)
        repaired = buffer.getvalue()
    finally:
        document.close()
    report = accessibility_pdf_bytes(repaired, password="")
    report = dict(report)
    report["appliedAltTextCount"] = applied_alt_texts
    return {"pdfBytes": repaired, "report": report}


def ensure_basic_tag_structure(document: fitz.Document) -> None:
    catalog = document.pdf_catalog()
    try:
        kind, _ = document.xref_get_key(catalog, "StructTreeRoot")
    except Exception:  # noqa: BLE001
        kind = ""
    if kind not in {"xref", "dict"}:
        struct_xref = document.get_new_xref()
        document.update_object(struct_xref, "<< /Type /StructTreeRoot /K [] >>")
        document.xref_set_key(catalog, "StructTreeRoot", f"{struct_xref} 0 R")
    document.xref_set_key(catalog, "MarkInfo", "<< /Marked true >>")


def normalize_alt_text_entries(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    entries: list[dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("altText") or raw.get("text") or "").strip()
        if not text:
            continue
        entries.append(
            {
                "pageIndex": int(raw.get("pageIndex", -1)),
                "imageIndex": int(raw.get("imageIndex", -1)),
                "xref": int(raw.get("xref", 0) or 0),
                "altText": text,
            }
        )
    return entries


def apply_image_alt_texts(document: fitz.Document, entries: list[dict[str, Any]]) -> int:
    applied = 0
    for page_index in range(document.page_count):
        page_images = document.load_page(page_index).get_images(full=True)
        for image_index, image in enumerate(page_images):
            if not image:
                continue
            xref = int(image[0])
            alt_text = matching_alt_text(entries, page_index, image_index, xref)
            if not alt_text:
                continue
            try:
                document.xref_set_key(xref, "Alt", pdf_literal(alt_text))
                applied += 1
            except Exception:  # noqa: BLE001
                pass
    return applied


def matching_alt_text(entries: list[dict[str, Any]], page_index: int, image_index: int, xref: int) -> str:
    for entry in entries:
        if int(entry.get("xref", 0)) == xref:
            return str(entry["altText"])
        if int(entry.get("pageIndex", -1)) == page_index and int(entry.get("imageIndex", -1)) == image_index:
            return str(entry["altText"])
    return ""


def count_image_alt_texts(document: fitz.Document, images: list[Any]) -> int:
    seen: set[int] = set()
    count = 0
    for image in images:
        if not image:
            continue
        xref = int(image[0])
        if xref in seen:
            continue
        seen.add(xref)
        try:
            kind, value = document.xref_get_key(xref, "Alt")
        except Exception:  # noqa: BLE001
            continue
        if kind == "string" and isinstance(value, str) and value.strip("()"):
            count += 1
    return count


def ocr_dependency_status(language: str = "eng", tessdata: str | None = None) -> dict[str, Any]:
    tesseract_path = shutil.which("tesseract")
    requested_languages = parse_ocr_languages(language)
    tessdata_path = resolve_tessdata_path(tessdata)
    available_languages: list[str] = []
    version = ""
    errors: list[str] = []
    if not tesseract_path:
        errors.append("tesseract executable was not found on PATH")
    else:
        try:
            version_result = subprocess.run(
                [tesseract_path, "--version"],
                check=False,
                capture_output=True,
                text=True,
            )
            version = (version_result.stdout or version_result.stderr).splitlines()[0].strip()
        except Exception as exc:  # noqa: BLE001
            errors.append(f"failed to inspect tesseract version: {exc}")
        try:
            language_args = [tesseract_path, "--list-langs"]
            if tessdata_path:
                language_args.extend(["--tessdata-dir", tessdata_path])
            language_result = subprocess.run(language_args, check=False, capture_output=True, text=True)
            if language_result.returncode == 0:
                lines = [line.strip() for line in language_result.stdout.splitlines() if line.strip()]
                available_languages = [line for line in lines if not line.lower().startswith("list of available")]
            else:
                errors.append(language_result.stderr.strip() or "tesseract --list-langs failed")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"failed to inspect tesseract languages: {exc}")
    missing_languages = [item for item in requested_languages if item not in available_languages]
    if missing_languages:
        errors.append(f"missing OCR language data: {', '.join(missing_languages)}")
    if not tessdata_path:
        errors.append("tessdata directory was not found")
    return {
        "ok": bool(tesseract_path) and bool(tessdata_path) and not missing_languages and not errors,
        "engine": "tesseract",
        "path": tesseract_path or "",
        "version": version,
        "tessdata": tessdata_path or "",
        "requestedLanguages": requested_languages,
        "availableLanguages": available_languages,
        "missingLanguages": missing_languages,
        "errors": errors,
    }


def parse_ocr_languages(language: str) -> list[str]:
    values = [item.strip() for item in re.split(r"[+,]", language or "eng") if item.strip()]
    return values or ["eng"]


def resolve_tessdata_path(value: str | None) -> str:
    candidates = [
        value or "",
        os.environ.get("TESSDATA_PREFIX", ""),
        "/opt/homebrew/share/tessdata",
        "/usr/local/share/tessdata",
        "/usr/share/tesseract-ocr/5/tessdata",
        "/usr/share/tesseract-ocr/4.00/tessdata",
        "/usr/share/tessdata",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_dir():
            return str(Path(candidate))
    return ""


def ocr_pdf_bytes(
    pdf_bytes: bytes,
    password: str = "",
    language: str = "eng",
    tessdata: str | None = None,
    pages: str = "all",
    dpi: int = 220,
    force: bool = False,
) -> OcrResult:
    status = ocr_dependency_status(language, tessdata)
    if not status["ok"]:
        raise ValueError(f"OCR dependencies are not ready: {status['errors']}")
    tessdata_path = str(status.get("tessdata") or "")
    source = fitz.open(stream=pdf_bytes, filetype="pdf")
    output = fitz.open()
    ocr_pages = 0
    skipped_pages = 0
    copied_pages = 0
    page_reports: list[dict[str, Any]] = []
    try:
        authenticate_if_needed(source, password)
        selected_pages = parse_page_selection(pages, source.page_count)
        for page_index in range(source.page_count):
            page = source.load_page(page_index)
            source_text = page.get_text("text").strip()
            should_ocr = page_index in selected_pages and (force or not source_text)
            if not should_ocr:
                output.insert_pdf(source, from_page=page_index, to_page=page_index)
                skipped_pages += 1 if page_index in selected_pages and source_text and not force else 0
                copied_pages += 1
                page_reports.append(
                    {
                        "pageIndex": page_index,
                        "ocrApplied": False,
                        "reason": "existing text" if source_text and not force else "not selected",
                        "sourceTextLength": len(source_text),
                    }
                )
                continue
            ocr_page = make_ocr_page(page, language, tessdata_path, dpi)
            output.insert_pdf(ocr_page, from_page=0, to_page=0)
            extracted = ocr_page[0].get_text("text").strip()
            ocr_page.close()
            ocr_pages += 1
            page_reports.append(
                {
                    "pageIndex": page_index,
                    "ocrApplied": True,
                    "sourceTextLength": len(source_text),
                    "ocrTextLength": len(extracted),
                    "ocrTextPreview": extracted[:160],
                }
            )
        try:
            output.set_metadata(source.metadata or {})
        except Exception:  # noqa: BLE001
            pass
        buffer = io.BytesIO()
        output.save(buffer, garbage=4, deflate=True, clean=True)
        result_bytes = buffer.getvalue()
        validation = validate_pdf_bytes(result_bytes)
        report = {
            "ok": bool(validation.get("ok")) and ocr_pages > 0,
            "engine": "tesseract",
            "language": language,
            "dpi": dpi,
            "pageCount": source.page_count,
            "ocrPageCount": ocr_pages,
            "skippedPageCount": skipped_pages,
            "copiedPageCount": copied_pages,
            "pages": page_reports,
            "dependency": status,
            "validation": validation,
            "errors": [] if validation.get("ok") and ocr_pages > 0 else ["no pages were OCR processed"] + list(validation.get("errors", [])),
        }
        return {"pdfBytes": result_bytes, "report": report}
    finally:
        output.close()
        source.close()


def parse_page_selection(value: str, page_count: int) -> set[int]:
    raw = (value or "all").strip().lower()
    if not raw or raw == "all":
        return set(range(page_count))
    pages: set[int] = set()
    for part in raw.split(","):
        item = part.strip()
        if not item:
            continue
        if "-" in item:
            left, right = item.split("-", 1)
            try:
                start = max(1, int(left.strip()))
                end = min(page_count, int(right.strip()))
            except ValueError:
                continue
            for page_number in range(start, end + 1):
                pages.add(page_number - 1)
            continue
        try:
            page_number = int(item)
        except ValueError:
            continue
        if 1 <= page_number <= page_count:
            pages.add(page_number - 1)
    return pages


def make_ocr_page(page: fitz.Page, language: str, tessdata_path: str, dpi: int) -> fitz.Document:
    scale = max(72, min(600, int(dpi))) / 72
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    try:
        pixmap.set_dpi(int(dpi), int(dpi))
    except Exception:  # noqa: BLE001
        pass
    ocr_bytes = pixmap.pdfocr_tobytes(compress=True, language=language, tessdata=tessdata_path)
    ocr_document = fitz.open(stream=ocr_bytes, filetype="pdf")
    if ocr_document.page_count == 0:
        ocr_document.close()
        raise ValueError("OCR engine returned an empty PDF")
    return normalize_ocr_page_size(ocr_document, page.rect)


def normalize_ocr_page_size(ocr_document: fitz.Document, source_rect: fitz.Rect) -> fitz.Document:
    ocr_page = ocr_document[0]
    if abs(ocr_page.rect.width - source_rect.width) <= 1 and abs(ocr_page.rect.height - source_rect.height) <= 1:
        return ocr_document
    normalized = fitz.open()
    target = normalized.new_page(width=source_rect.width, height=source_rect.height)
    target.show_pdf_page(target.rect, ocr_document, 0)
    ocr_document.close()
    return normalized


def ocr_correct_pdf_bytes(
    pdf_bytes: bytes,
    corrections: Any,
    password: str = "",
    dpi: int = 220,
) -> OcrResult:
    correction_entries = normalize_ocr_corrections(corrections)
    if not correction_entries:
        raise ValueError("at least one OCR correction entry is required")
    source = fitz.open(stream=pdf_bytes, filetype="pdf")
    output = fitz.open()
    corrected_pages: set[int] = set()
    try:
        authenticate_if_needed(source, password)
        corrections_by_page: dict[int, list[dict[str, Any]]] = {}
        for entry in correction_entries:
            page_index = int(entry["pageIndex"])
            if 0 <= page_index < source.page_count:
                corrections_by_page.setdefault(page_index, []).append(entry)
        for page_index in range(source.page_count):
            if page_index not in corrections_by_page:
                output.insert_pdf(source, from_page=page_index, to_page=page_index)
                continue
            source_page = source.load_page(page_index)
            rebuilt_page = output.new_page(width=source_page.rect.width, height=source_page.rect.height)
            pixmap = source_page.get_pixmap(matrix=fitz.Matrix(max(72, min(600, dpi)) / 72, max(72, min(600, dpi)) / 72), alpha=False)
            rebuilt_page.insert_image(rebuilt_page.rect, stream=pixmap.tobytes("png"), keep_proportion=False)
            for entry in corrections_by_page[page_index]:
                insert_invisible_ocr_text(rebuilt_page, entry, PageMetrics(rebuilt_page.rect.width, rebuilt_page.rect.height))
            corrected_pages.add(page_index)
        try:
            output.set_metadata(source.metadata or {})
        except Exception:  # noqa: BLE001
            pass
        buffer = io.BytesIO()
        output.save(buffer, garbage=4, deflate=True, clean=True)
        corrected = buffer.getvalue()
        validation = validate_pdf_bytes(corrected)
        report = {
            "ok": bool(validation.get("ok")) and bool(corrected_pages),
            "pageCount": source.page_count,
            "correctedPageCount": len(corrected_pages),
            "correctedPages": sorted(corrected_pages),
            "correctionCount": len(correction_entries),
            "validation": validation,
            "errors": [] if validation.get("ok") and corrected_pages else ["no pages were corrected"] + list(validation.get("errors", [])),
        }
        return {"pdfBytes": corrected, "report": report}
    finally:
        output.close()
        source.close()


def normalize_ocr_corrections(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    entries: list[dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or raw.get("replacement") or "").strip()
        if not text:
            continue
        rect = raw.get("rect") if isinstance(raw.get("rect"), dict) else raw
        if not isinstance(rect, dict):
            continue
        try:
            page_index = int(raw.get("pageIndex", 0))
            x = float(rect.get("x", 0))
            y = float(rect.get("y", 0))
            width = float(rect.get("width", 0))
            height = float(rect.get("height", 0))
        except (TypeError, ValueError):
            continue
        if width <= 0 or height <= 0:
            continue
        entries.append(
            {
                "pageIndex": page_index,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "text": text,
                "fontSize": max(4.0, float(raw.get("fontSize", 12) or 12)),
            }
        )
    return entries


def insert_invisible_ocr_text(page: fitz.Page, entry: dict[str, Any], metrics: PageMetrics) -> None:
    rect = to_rect(entry, metrics)
    text = str(entry.get("text", ""))
    font_size = max(4.0, float(entry.get("fontSize", 12)))
    kwargs: dict[str, Any] = {
        "fontsize": font_size,
        "fontname": "helv",
        "render_mode": 3,
        "overlay": True,
    }
    if DEFAULT_FONT.exists() and any(ord(char) > 255 for char in text):
        kwargs["fontname"] = "pdfeditfont"
        kwargs["fontfile"] = str(DEFAULT_FONT)
    page.insert_textbox(rect, text, **kwargs)


def certificate_sign_pdf_bytes(
    pdf_bytes: bytes,
    cert_path: Path,
    key_path: Path,
    key_password: str = "",
    password: str = "",
    field_name: str = "Signature1",
    signer_name: str = "",
    reason: str = "",
    location: str = "",
    page_index: int = 0,
    rect: fitz.Rect | None = None,
    placeholder_bytes: int = 16384,
    lock_policy: str = "none",
) -> dict[str, Any]:
    if not shutil.which("openssl"):
        raise ValueError("openssl executable was not found on PATH")
    prepared = prepare_signature_placeholder_pdf(
        pdf_bytes,
        password=password,
        field_name=field_name,
        signer_name=signer_name,
        reason=reason,
        location=location,
        page_index=page_index,
        rect=rect,
        placeholder_bytes=placeholder_bytes,
        lock_policy=lock_policy,
    )
    byte_range_pdf, byte_range, contents_range = patch_signature_byte_range(prepared)
    signed_data = byte_range_pdf[byte_range[0] : byte_range[0] + byte_range[1]] + byte_range_pdf[
        byte_range[2] : byte_range[2] + byte_range[3]
    ]
    signature_der = openssl_cms_sign(signed_data, cert_path, key_path, key_password)
    signed_pdf = fill_signature_contents(byte_range_pdf, contents_range, signature_der)
    validation = validate_pdf_bytes(signed_pdf)
    signature_validation = validate_pdf_signatures(signed_pdf, None)
    report = {
        "ok": bool(validation.get("ok")) and bool(signature_validation.get("ok")),
        "fieldName": field_name,
        "signerName": signer_name,
        "reason": reason,
        "location": location,
        "pageIndex": page_index,
        "byteRange": byte_range,
        "signatureLength": len(signature_der),
        "placeholderBytes": placeholder_bytes,
        "lockPolicy": normalize_signature_lock_policy(lock_policy),
        "validation": validation,
        "signatureValidation": signature_validation,
    }
    return {"pdfBytes": signed_pdf, "report": report}


def prepare_signature_placeholder_pdf(
    pdf_bytes: bytes,
    password: str,
    field_name: str,
    signer_name: str,
    reason: str,
    location: str,
    page_index: int,
    rect: fitz.Rect | None,
    placeholder_bytes: int,
    lock_policy: str,
) -> bytes:
    placeholder_bytes = clamp_int(placeholder_bytes, 4096, 65536)
    byte_range_placeholder = "9" * 18
    contents_placeholder = "0" * (placeholder_bytes * 2)
    signed_at = pdf_signature_date()
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        authenticate_if_needed(document, password)
        page_index = clamp_int(page_index, 0, document.page_count - 1)
        page = document.load_page(page_index)
        signature_rect = rect or default_signature_rect(page.rect)
        draw_certificate_signature_appearance(page, signature_rect, signer_name, reason, location, signed_at)
        widget = fitz.Widget()
        widget.field_type = fitz.PDF_WIDGET_TYPE_SIGNATURE
        widget.field_name = field_name or "Signature1"
        widget.field_label = field_name or "Signature1"
        widget.rect = signature_rect
        annotation = page.add_widget(widget)
        signature_xref = document.get_new_xref()
        normalized_lock_policy = normalize_signature_lock_policy(lock_policy)
        reference = signature_reference_dictionary(normalized_lock_policy)
        signature_object = (
            "<<"
            " /Type /Sig"
            " /Filter /Adobe.PPKLite"
            " /SubFilter /adbe.pkcs7.detached"
            f" /ByteRange [0 {byte_range_placeholder} {byte_range_placeholder} {byte_range_placeholder}]"
            f" /Contents <{contents_placeholder}>"
            f" /M {pdf_literal(signed_at)}"
            f" /Name {pdf_literal(signer_name or field_name or 'PDFEdit Signer')}"
            f" /Reason {pdf_literal(reason)}"
            f" /Location {pdf_literal(location)}"
            f"{reference}"
            " >>"
        )
        document.update_object(signature_xref, signature_object)
        document.xref_set_key(annotation.xref, "V", f"{signature_xref} 0 R")
        if normalized_lock_policy != "none":
            document.xref_set_key(document.pdf_catalog(), "Perms", f"<< /DocMDP {signature_xref} 0 R >>")
        buffer = io.BytesIO()
        document.save(buffer, garbage=0, deflate=False, clean=False)
        return buffer.getvalue()
    finally:
        document.close()


def default_signature_rect(page_rect: fitz.Rect) -> fitz.Rect:
    width = min(220.0, max(120.0, page_rect.width * 0.36))
    height = 72.0
    margin = 54.0
    return fitz.Rect(
        page_rect.x1 - margin - width,
        page_rect.y1 - margin - height,
        page_rect.x1 - margin,
        page_rect.y1 - margin,
    )


def normalize_signature_lock_policy(value: str) -> str:
    if value in {"noChanges", "formFill", "formFillAnnotate"}:
        return value
    return "none"


def signature_reference_dictionary(lock_policy: str) -> str:
    permission = {
        "noChanges": 1,
        "formFill": 2,
        "formFillAnnotate": 3,
    }.get(lock_policy)
    if not permission:
        return ""
    return (
        " /Reference [ << /Type /SigRef /TransformMethod /DocMDP /DigestMethod /SHA256"
        f" /TransformParams << /Type /TransformParams /P {permission} /V /1.2 >> >> ]"
    )


def draw_certificate_signature_appearance(
    page: fitz.Page,
    rect: fitz.Rect,
    signer_name: str,
    reason: str,
    location: str,
    signed_at: str,
) -> None:
    page.draw_rect(rect, color=(0.1, 0.24, 0.54), fill=(0.96, 0.98, 1.0), width=0.8)
    lines = ["Digitally signed"]
    if signer_name:
        lines.append(f"by {signer_name}")
    if reason:
        lines.append(f"Reason: {reason}")
    if location:
        lines.append(f"Location: {location}")
    lines.append(signed_at.removeprefix("D:").removesuffix("Z"))
    page.insert_textbox(
        rect + (8, 6, -8, -6),
        "\n".join(lines),
        fontsize=8.5,
        fontname="helv",
        color=(0.05, 0.1, 0.2),
        align=fitz.TEXT_ALIGN_LEFT,
    )


def pdf_signature_date() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("D:%Y%m%d%H%M%SZ")


def parse_signature_rect(value: Any) -> fitz.Rect | None:
    if isinstance(value, fitz.Rect):
        return value
    if isinstance(value, dict):
        try:
            x = float(value.get("x", 0))
            y = float(value.get("y", 0))
            width = float(value.get("width", 0))
            height = float(value.get("height", 0))
        except (TypeError, ValueError):
            return None
        if width <= 0 or height <= 0:
            return None
        return fitz.Rect(x, y, x + width, y + height)
    if not isinstance(value, str) or not value.strip():
        return None
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 4:
        return None
    try:
        x, y, width, height = [float(part) for part in parts]
    except ValueError:
        return None
    if width <= 0 or height <= 0:
        return None
    return fitz.Rect(x, y, x + width, y + height)


def patch_signature_byte_range(pdf_bytes: bytes) -> tuple[bytes, list[int], tuple[int, int]]:
    contents_match = re.search(rb"/Contents\s*<([0-9A-Fa-f]+)>", pdf_bytes)
    if not contents_match:
        raise ValueError("signature placeholder /Contents was not found")
    contents_start = contents_match.start(1)
    contents_end = contents_match.end(1)
    byte_range = [0, contents_start, contents_end, len(pdf_bytes) - contents_end]
    byte_range_match = re.search(rb"/ByteRange\[0 9{18} 9{18} 9{18}\]", pdf_bytes)
    if not byte_range_match:
        raise ValueError("signature placeholder /ByteRange was not found")
    replacement = (
        f"/ByteRange[0 {byte_range[1]:018d} {byte_range[2]:018d} {byte_range[3]:018d}]".encode("ascii")
    )
    if len(replacement) != byte_range_match.end() - byte_range_match.start():
        raise ValueError("signature byte range replacement changed object length")
    patched = bytearray(pdf_bytes)
    patched[byte_range_match.start() : byte_range_match.end()] = replacement
    return bytes(patched), byte_range, (contents_start, contents_end)


def openssl_cms_sign(signed_data: bytes, cert_path: Path, key_path: Path, key_password: str = "") -> bytes:
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        data_path = temp_path / "signed-data.bin"
        signature_path = temp_path / "signature.der"
        data_path.write_bytes(signed_data)
        command = [
            "openssl",
            "cms",
            "-sign",
            "-binary",
            "-in",
            str(data_path),
            "-signer",
            str(cert_path),
            "-inkey",
            str(key_path),
            "-outform",
            "DER",
            "-out",
            str(signature_path),
            "-md",
            "sha256",
            "-nosmimecap",
        ]
        if key_password:
            command.extend(["-passin", f"pass:{key_password}"])
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        if result.returncode != 0:
            raise ValueError(result.stderr.strip() or result.stdout.strip() or "openssl cms signing failed")
        return signature_path.read_bytes()


def fill_signature_contents(pdf_bytes: bytes, contents_range: tuple[int, int], signature_der: bytes) -> bytes:
    contents_start, contents_end = contents_range
    hex_signature = binascii.hexlify(signature_der).upper()
    capacity = contents_end - contents_start
    if len(hex_signature) > capacity:
        raise ValueError(
            f"CMS signature ({len(hex_signature)} hex chars) exceeds placeholder capacity ({capacity})"
        )
    signed = bytearray(pdf_bytes)
    signed[contents_start : contents_start + len(hex_signature)] = hex_signature
    return bytes(signed)


def validate_pdf_signatures(pdf_bytes: bytes, trusted_cert_path: Path | None = None) -> dict[str, Any]:
    signatures: list[dict[str, Any]] = []
    errors: list[str] = []
    validation = validate_pdf_bytes(pdf_bytes)
    widget_count = 0
    signed_widget_count = 0
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            for page in document:
                for widget in list(page.widgets() or []):
                    if getattr(widget, "field_type", None) == fitz.PDF_WIDGET_TYPE_SIGNATURE:
                        widget_count += 1
                        if bool(getattr(widget, "is_signed", False)):
                            signed_widget_count += 1
    except Exception as exc:  # noqa: BLE001
        errors.append(str(exc))
    for index, match in enumerate(re.finditer(rb"/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]", pdf_bytes)):
        try:
            byte_range = [int(item) for item in match.groups()]
            signed_data = (
                pdf_bytes[byte_range[0] : byte_range[0] + byte_range[1]]
                + pdf_bytes[byte_range[2] : byte_range[2] + byte_range[3]]
            )
            contents_match = re.search(rb"/Contents\s*<([0-9A-Fa-f]+)>", pdf_bytes[match.end() :])
            if not contents_match:
                raise ValueError("signature /Contents was not found after /ByteRange")
            hex_value = contents_match.group(1)
            der_with_padding = binascii.unhexlify(hex_value)
            der = strip_der_padding(der_with_padding)
            cms_result = openssl_cms_verify(der, signed_data, trusted_cert_path)
            lock_info = signature_lock_info(pdf_bytes, match.start())
            signatures.append(
                {
                    "index": index,
                    "ok": cms_result["ok"],
                    "byteRange": byte_range,
                    "signedByteCount": len(signed_data),
                    "signatureLength": len(der),
                    "cmsVerified": cms_result["ok"],
                    "docMDP": lock_info["docMDP"],
                    "lockPolicy": lock_info["lockPolicy"],
                    "errors": cms_result["errors"],
                }
            )
        except Exception as exc:  # noqa: BLE001
            signatures.append(
                {
                    "index": index,
                    "ok": False,
                    "errors": [str(exc)],
                }
            )
    if not signatures:
        errors.append("no ByteRange signatures were found")
    signature_errors = [error for signature in signatures for error in signature.get("errors", [])]
    return {
        "ok": validation["ok"] and bool(signatures) and all(signature.get("ok") for signature in signatures) and not errors,
        "signatureCount": len(signatures),
        "signatureWidgetCount": widget_count,
        "signedWidgetCount": signed_widget_count,
        "validation": validation,
        "signatures": signatures,
        "errors": errors + signature_errors,
    }


def signature_lock_info(pdf_bytes: bytes, byte_range_offset: int) -> dict[str, Any]:
    object_start = pdf_bytes.rfind(b"obj", 0, byte_range_offset)
    object_end = pdf_bytes.find(b"endobj", byte_range_offset)
    if object_start < 0:
        object_start = max(0, byte_range_offset - 2048)
    if object_end < 0:
        object_end = min(len(pdf_bytes), byte_range_offset + 4096)
    source = pdf_bytes[object_start:object_end]
    doc_mdp = b"/TransformMethod /DocMDP" in source or b"/TransformMethod/DocMDP" in source
    permission_match = re.search(rb"/P\s+([123])\b", source)
    permission = int(permission_match.group(1)) if permission_match else 0
    lock_policy = {
        1: "noChanges",
        2: "formFill",
        3: "formFillAnnotate",
    }.get(permission, "none")
    return {"docMDP": doc_mdp, "lockPolicy": lock_policy}


def strip_der_padding(value: bytes) -> bytes:
    if len(value) < 2 or value[0] != 0x30:
        raise ValueError("CMS signature does not start with a DER sequence")
    first_length = value[1]
    if first_length < 0x80:
        total_length = 2 + first_length
    else:
        length_bytes = first_length & 0x7F
        if len(value) < 2 + length_bytes:
            raise ValueError("CMS signature has a truncated DER length")
        content_length = int.from_bytes(value[2 : 2 + length_bytes], "big")
        total_length = 2 + length_bytes + content_length
    if total_length > len(value):
        raise ValueError("CMS DER length exceeds /Contents capacity")
    return value[:total_length]


def openssl_cms_verify(
    signature_der: bytes,
    signed_data: bytes,
    trusted_cert_path: Path | None = None,
) -> dict[str, Any]:
    if not shutil.which("openssl"):
        return {"ok": False, "errors": ["openssl executable was not found on PATH"]}
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        signature_path = temp_path / "signature.der"
        data_path = temp_path / "signed-data.bin"
        output_path = temp_path / "verified.bin"
        signature_path.write_bytes(signature_der)
        data_path.write_bytes(signed_data)
        command = [
            "openssl",
            "cms",
            "-verify",
            "-binary",
            "-inform",
            "DER",
            "-in",
            str(signature_path),
            "-content",
            str(data_path),
            "-out",
            str(output_path),
        ]
        if trusted_cert_path:
            command.extend(["-CAfile", str(trusted_cert_path)])
        else:
            command.append("-noverify")
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        if result.returncode != 0:
            return {"ok": False, "errors": [result.stderr.strip() or result.stdout.strip() or "openssl cms verify failed"]}
    return {"ok": True, "errors": []}


def catalog_language(document: fitz.Document) -> str:
    try:
        kind, value = document.xref_get_key(document.pdf_catalog(), "Lang")
    except Exception:  # noqa: BLE001
        return ""
    if kind != "string" or not isinstance(value, str):
        return ""
    return value.strip("()")


def document_has_tag_structure(document: fitz.Document) -> bool:
    try:
        kind, value = document.xref_get_key(document.pdf_catalog(), "StructTreeRoot")
    except Exception:  # noqa: BLE001
        return False
    return kind in {"xref", "dict"} and bool(value)


def count_javascript_objects(document: fitz.Document) -> int:
    count = 0
    for xref in range(1, document.xref_length()):
        try:
            source = document.xref_object(xref, compressed=False)
        except Exception:  # noqa: BLE001 - malformed objects are handled by validation
            continue
        compact = "".join(source.split())
        has_script_action = re.search(r"/(?:JavaScript|JS|Launch|RichMedia)\b", source) is not None
        has_open_action = re.search(r"/OpenAction\b", source) is not None and "/OpenActionnull" not in compact
        has_additional_action = re.search(r"/AA\b", source) is not None and "/AAnull" not in compact
        if has_script_action or has_open_action or has_additional_action:
            count += 1
    return count


def count_javascript_name_tree_objects(document: fitz.Document) -> int:
    count = 0
    for xref in range(1, document.xref_length()):
        try:
            source = document.xref_object(xref, compressed=False)
        except Exception:  # noqa: BLE001
            continue
        if re.search(r"/Names\b", source) and re.search(r"/JavaScript\b", source):
            count += 1
    return count


def detect_xfa(document: fitz.Document) -> bool:
    for xref in range(1, document.xref_length()):
        try:
            source = document.xref_object(xref, compressed=False)
        except Exception:  # noqa: BLE001
            continue
        if re.search(r"/XFA\b", source):
            return True
    return False


def count_hidden_layers(document: fitz.Document) -> int:
    count = 0
    try:
        ocgs = document.get_ocgs()
        if isinstance(ocgs, dict):
            count += len(ocgs)
    except Exception:  # noqa: BLE001
        pass
    try:
        configs = document.layer_ui_configs()
        count += len(configs or [])
    except Exception:  # noqa: BLE001
        pass
    return count


def count_comment_annotations(annotations: list[fitz.Annot]) -> int:
    comment_subtypes = {
        "Text",
        "FreeText",
        "Highlight",
        "Underline",
        "StrikeOut",
        "Squiggly",
        "Ink",
        "Square",
        "Circle",
        "Line",
        "Polygon",
        "PolyLine",
        "Stamp",
        "Caret",
        "FileAttachment",
    }
    return sum(1 for annotation in annotations if annotation.type[1] in comment_subtypes)


def count_file_attachment_annotations(annotations: list[fitz.Annot]) -> int:
    return sum(1 for annotation in annotations if annotation.type[1] == "FileAttachment")


def count_annotation_actions(document: fitz.Document, annotations: list[fitz.Annot]) -> int:
    count = 0
    for annotation in annotations:
        try:
            source = document.xref_object(annotation.xref, compressed=False)
        except Exception:  # noqa: BLE001
            continue
        compact = "".join(source.split())
        has_action = re.search(r"/A\b", source) is not None and "/Anull" not in compact
        has_additional_action = re.search(r"/AA\b", source) is not None and "/AAnull" not in compact
        if has_action or has_additional_action:
            count += 1
    return count


def count_signature_widgets(widgets: list[fitz.Widget]) -> int:
    count = 0
    for widget in widgets:
        field_type = str(getattr(widget, "field_type_string", "") or getattr(widget, "field_type", ""))
        if "sig" in field_type.lower() or "signature" in field_type.lower():
            count += 1
    return count


def page_has_explicit_tab_order(document: fitz.Document, page: fitz.Page) -> bool:
    try:
        kind, value = document.xref_get_key(page.xref, "Tabs")
    except Exception:  # noqa: BLE001
        return False
    return kind == "name" and value in {"/A", "/R", "/C", "/S", "/W"}


def count_embedded_search_index_signals(pdf_bytes: bytes) -> int:
    patterns = [
        rb"/EmbeddedSearchIndex\s+(?!null\b)",
        rb"/Search\s+(?!null\b)",
        rb"/SearchIndex\s+(?!null\b)",
        rb"/PieceInfo\s+(?!null\b)",
        rb"SECRET_SEARCH_INDEX",
    ]
    return sum(1 for pattern in patterns if re.search(pattern, pdf_bytes))


def count_unreferenced_object_signals(pdf_bytes: bytes) -> int:
    patterns = [
        rb"/UnreferencedSanitizerSignal\b",
        rb"SECRET_UNREFERENCED_OBJECT",
    ]
    return sum(1 for pattern in patterns if re.search(pattern, pdf_bytes))


def detect_standard_profile_claims(pdf_bytes: bytes, document: fitz.Document | None = None) -> dict[str, Any]:
    text = pdf_bytes.decode("latin1", errors="ignore")
    pdfa_claim = ""
    pdfx_claim = ""
    part_match = re.search(r"pdfaid:part[^>]*>\s*([^<\s]+)", text, flags=re.IGNORECASE)
    conformance_match = re.search(r"pdfaid:conformance[^>]*>\s*([^<\s]+)", text, flags=re.IGNORECASE)
    if part_match:
        pdfa_claim = f"PDF/A-{part_match.group(1)}"
        if conformance_match:
            pdfa_claim += conformance_match.group(1).upper()
    pdfx_claim = detect_pdfx_claim_text(text)
    if not pdfx_claim and document is not None:
        pdfx_claim = detect_pdfx_claim_document(document)
    return {
        "pdfaClaim": pdfa_claim,
        "pdfxClaim": pdfx_claim,
        "outputIntentCount": len(re.findall(r"/OutputIntent\b", text)),
    }


def detect_pdfx_claim_text(text: str) -> str:
    xmp_patterns = [
        r"<pdfxid:GTS_PDFXVersion>\s*([^<]+)",
        r"<[^:>]*:?GTS_PDFXVersion>\s*([^<]+)",
    ]
    for pattern in xmp_patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    info_match = re.search(
        r"/GTS_PDFXVersion\s*(?:\(([^)]*)\)|<([0-9A-Fa-f]+)>|/([^\s/<>\[\]()]+))",
        text,
    )
    if not info_match:
        return ""
    if info_match.group(1):
        return info_match.group(1).strip()
    if info_match.group(2):
        try:
            return bytes.fromhex(info_match.group(2)).decode("latin1", errors="ignore").strip()
        except ValueError:
            return ""
    return (info_match.group(3) or "").strip()


def detect_pdfx_claim_document(document: fitz.Document) -> str:
    for xref in range(1, document.xref_length()):
        try:
            source = document.xref_object(xref, compressed=False)
        except Exception:  # noqa: BLE001
            continue
        claim = detect_pdfx_claim_text(source)
        if claim:
            return claim
    return ""


def normalize_pdfx_profile(profile: str) -> str:
    value = profile.strip()
    if not value:
        return ""
    value = value.replace("\\", "")
    upper = value.upper()
    if "PDF/X-3" in upper:
        return "PDF/X-3:2002" if "2003" not in upper else "PDF/X-3:2003"
    if "PDF/X-1A" in upper or "PDF/X-1" in upper:
        return "PDF/X-1a:2001"
    return value


def count_output_intents(document: fitz.Document) -> int:
    count = 0
    for xref in range(1, document.xref_length()):
        try:
            source = document.xref_object(xref, compressed=False)
        except Exception:  # noqa: BLE001
            continue
        if re.search(r"/OutputIntent\b", source):
            count += 1
    return count


def output_intent_has_gts_pdfx(document: fitz.Document) -> bool:
    for xref in range(1, document.xref_length()):
        try:
            source = document.xref_object(xref, compressed=False)
        except Exception:  # noqa: BLE001
            continue
        if re.search(r"/Type\s*/OutputIntent\b", source) and re.search(r"/S\s*/GTS_PDFX\b", source):
            return True
    return False


def find_document_info_name(document: fitz.Document, key: str) -> str:
    try:
        kind, value = document.xref_get_key(-1, f"Info/{key}")
        if kind == "name":
            return value
    except Exception:  # noqa: BLE001
        pass
    for xref in range(1, document.xref_length()):
        try:
            source = document.xref_object(xref, compressed=False)
        except Exception:  # noqa: BLE001
            continue
        match = re.search(rf"/{re.escape(key)}\s+(/(?:True|False))\b", source)
        if match:
            return match.group(1)
    return ""


def find_pages_missing_pdfx_boxes(document: fitz.Document) -> list[int]:
    missing: list[int] = []
    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        has_box = False
        for box_key in ("TrimBox", "ArtBox"):
            try:
                kind, value = document.xref_get_key(page.xref, box_key)
            except Exception:  # noqa: BLE001
                kind, value = "null", "null"
            if kind != "null" and value != "null":
                has_box = True
                break
        if not has_box:
            missing.append(page_index)
    return missing


def find_unembedded_font_issues(document: fitz.Document) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        for font in page.get_fonts(full=True):
            xref = int(font[0] or 0)
            name = str(font[3] or font[4] or "unknown")
            key = (xref, name)
            if key in seen:
                continue
            seen.add(key)
            if xref <= 0 or not font_is_embedded(document, xref):
                issues.append({"pageIndex": page_index, "xref": xref, "fontName": name})
    return issues


def font_is_embedded(document: fitz.Document, xref: int) -> bool:
    stack = [xref]
    visited: set[int] = set()
    while stack and len(visited) < 40:
        current = stack.pop()
        if current in visited or current <= 0 or current >= document.xref_length():
            continue
        visited.add(current)
        try:
            source = document.xref_object(current, compressed=False)
        except Exception:  # noqa: BLE001
            continue
        if re.search(r"/FontFile(?:2|3)?\b", source):
            return True
        for ref in re.findall(r"(\d+)\s+\d+\s+R", source):
            try:
                stack.append(int(ref))
            except ValueError:
                continue
    return False


def count_pdf_transparency_signals(document: fitz.Document) -> int:
    count = 0
    transparency_patterns = [
        r"/SMask\s+(?!/None\b|null\b)",
        r"/ca\s+0?\.\d+",
        r"/CA\s+0?\.\d+",
        r"/BM\s*/(?!Normal\b)[A-Za-z0-9]+",
        r"/Group\s*<<[^>]*?/S\s*/Transparency",
    ]
    for xref in range(1, document.xref_length()):
        try:
            source = document.xref_object(xref, compressed=False)
        except Exception:  # noqa: BLE001
            continue
        if any(re.search(pattern, source, flags=re.DOTALL) for pattern in transparency_patterns):
            count += 1
    return count


def compare_pdf_bytes(left_bytes: bytes, right_bytes: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": True,
        "pageCountChanged": False,
        "changedPages": [],
        "textChanges": [],
        "renderChanges": [],
        "errors": [],
    }
    try:
        with fitz.open(stream=left_bytes, filetype="pdf") as left, fitz.open(stream=right_bytes, filetype="pdf") as right:
            left_count = left.page_count
            right_count = right.page_count
            result["leftPageCount"] = left_count
            result["rightPageCount"] = right_count
            result["pageCountChanged"] = left_count != right_count
            max_pages = max(left_count, right_count)
            changed_pages: list[int] = []
            text_changes: list[dict[str, Any]] = []
            render_changes: list[dict[str, Any]] = []
            for page_index in range(max_pages):
                left_page = left.load_page(page_index) if page_index < left_count else None
                right_page = right.load_page(page_index) if page_index < right_count else None
                if left_page is None or right_page is None:
                    changed_pages.append(page_index)
                    text_changes.append(
                        {
                            "pageIndex": page_index,
                            "type": "page-added" if left_page is None else "page-removed",
                            "leftPreview": "",
                            "rightPreview": "",
                        }
                    )
                    continue
                left_text = normalize_compare_text(left_page.get_text("text"))
                right_text = normalize_compare_text(right_page.get_text("text"))
                text_changed = left_text != right_text
                render_detail = render_page_difference_details(left_page, right_page)
                render_diff = float(render_detail["meanPixelDelta"])
                render_changed = render_diff > 0.0001
                if text_changed or render_changed:
                    changed_pages.append(page_index)
                if text_changed:
                    text_changes.append(
                        {
                            "pageIndex": page_index,
                            "leftPreview": left_text[:240],
                            "rightPreview": right_text[:240],
                        }
                    )
                if render_changed:
                    render_changes.append(
                        {
                            "pageIndex": page_index,
                            "meanPixelDelta": render_diff,
                            "changedRegion": render_detail["changedRegion"],
                        }
                    )
            result["changedPages"] = changed_pages
            result["textChanges"] = text_changes
            result["renderChanges"] = render_changes
            result["changedPageCount"] = len(changed_pages)
    except Exception as exc:  # noqa: BLE001
        result["ok"] = False
        result["errors"] = [str(exc)]
    return result


def write_compare_report_pdf(result: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document = fitz.open()
    page = document.new_page(width=612, height=792)
    lines = [
        "PDF Compare Report",
        f"Left pages: {result.get('leftPageCount', 0)}",
        f"Right pages: {result.get('rightPageCount', 0)}",
        f"Changed pages: {', '.join(str(index + 1) for index in result.get('changedPages', [])) or 'none'}",
        "",
        "Text changes:",
    ]
    for change in result.get("textChanges", [])[:20]:
        lines.append(f"- Page {int(change.get('pageIndex', 0)) + 1}")
        lines.append(f"  Before: {change.get('leftPreview', '')[:120]}")
        lines.append(f"  After:  {change.get('rightPreview', '')[:120]}")
    lines.append("")
    lines.append("Render changes:")
    for change in result.get("renderChanges", [])[:20]:
        region = change.get("changedRegion", [])
        region_text = ""
        if isinstance(region, list) and len(region) == 4:
            region_text = " region " + ", ".join(f"{float(value):.3f}" for value in region)
        lines.append(f"- Page {int(change.get('pageIndex', 0)) + 1}: mean delta {float(change.get('meanPixelDelta', 0)):.5f}{region_text}")
    page.insert_textbox(
        fitz.Rect(54, 54, 558, 738),
        "\n".join(lines),
        fontsize=11,
        fontname="helv",
        color=(0, 0, 0),
    )
    document.save(output_path, garbage=4, deflate=True, clean=True)
    document.close()


def normalize_compare_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def render_page_difference_ratio(left_page: fitz.Page, right_page: fitz.Page) -> float:
    return float(render_page_difference_details(left_page, right_page)["meanPixelDelta"])


def render_page_difference_details(left_page: fitz.Page, right_page: fitz.Page) -> dict[str, Any]:
    matrix = fitz.Matrix(0.5, 0.5)
    left_pix = left_page.get_pixmap(matrix=matrix, alpha=False)
    right_pix = right_page.get_pixmap(matrix=matrix, alpha=False)
    if left_pix.width != right_pix.width or left_pix.height != right_pix.height or left_pix.n != right_pix.n:
        return {"meanPixelDelta": 1.0, "changedRegion": [0, 0, 1, 1]}
    left_samples = left_pix.samples
    right_samples = right_pix.samples
    if not left_samples or len(left_samples) != len(right_samples):
        return {"meanPixelDelta": 1.0, "changedRegion": [0, 0, 1, 1]}
    digest_changed = getattr(left_pix, "digest", b"") != getattr(right_pix, "digest", b"")
    step = left_pix.n
    total = 0.0
    count = 0
    min_x = left_pix.width
    min_y = left_pix.height
    max_x = -1
    max_y = -1
    for index in range(0, len(left_samples), step):
        pixel_index = index // step
        x = pixel_index % left_pix.width
        y = pixel_index // left_pix.width
        pixel_delta = 0
        for channel in range(min(3, left_pix.n)):
            pixel_delta += abs(left_samples[index + channel] - right_samples[index + channel])
        total += pixel_delta / (255.0 * min(3, left_pix.n))
        if pixel_delta > 18:
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
        count += 1
    mean_delta = total / max(1, count)
    if digest_changed and mean_delta < 0.0001:
        mean_delta = 0.001
    if max_x < min_x or max_y < min_y:
        changed_region = [0, 0, 0, 0]
    else:
        changed_region = [
            min_x / left_pix.width,
            min_y / left_pix.height,
            (max_x + 1) / left_pix.width,
            (max_y + 1) / left_pix.height,
        ]
    return {"meanPixelDelta": mean_delta, "changedRegion": changed_region}


def run_batch_manifest(manifest_path: Path, font_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    jobs = manifest.get("jobs", [])
    if not isinstance(jobs, list):
        return {"ok": False, "jobs": [], "errors": ["manifest jobs must be an array"]}
    base_dir = manifest_path.parent
    results: list[dict[str, Any]] = []
    for index, job in enumerate(jobs):
        result = run_batch_job(index, job, base_dir, font_path)
        results.append(result)
    return {
        "ok": all(job.get("ok") for job in results),
        "jobCount": len(results),
        "successCount": sum(1 for job in results if job.get("ok")),
        "failureCount": sum(1 for job in results if not job.get("ok")),
        "jobs": results,
    }


def run_batch_job(index: int, job: Any, base_dir: Path, font_path: Path) -> dict[str, Any]:
    if not isinstance(job, dict):
        return {"index": index, "ok": False, "error": "job must be an object"}
    input_path = resolve_manifest_path(base_dir, str(job.get("input", "")))
    output_path = resolve_manifest_path(base_dir, str(job.get("output", "")))
    payload = job.get("payload", {})
    if not isinstance(payload, dict):
        return {"index": index, "ok": False, "error": "job payload must be an object"}
    try:
        edited = apply_operations(input_path.read_bytes(), payload, font_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(edited)
        validation = validate_pdf_bytes(edited)
        return {
            "index": index,
            "ok": bool(validation.get("ok")),
            "input": str(input_path),
            "output": str(output_path),
            "validation": validation,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "index": index,
            "ok": False,
            "input": str(input_path),
            "output": str(output_path),
            "error": str(exc),
        }


def resolve_manifest_path(base_dir: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()


def export_xfdf(document: fitz.Document) -> str:
    root = ET.Element("xfdf", {"xmlns": "http://ns.adobe.com/xfdf/", "xml:space": "preserve"})
    fields = ET.SubElement(root, "fields")
    seen: set[str] = set()
    for page in document:
        for widget in list(page.widgets() or []):
            name = str(widget.field_name or "")
            if not name or name in seen:
                continue
            seen.add(name)
            field = ET.SubElement(fields, "field", {"name": name})
            value = ET.SubElement(field, "value")
            value.text = str(widget.field_value or "")
    return ET.tostring(root, encoding="unicode", short_empty_elements=False)


def import_xfdf(document: fitz.Document, xfdf: str) -> None:
    values = parse_xfdf_values(xfdf)
    if not values:
        return
    for page in document:
        for widget in list(page.widgets() or []):
            name = str(widget.field_name or "")
            if name not in values:
                continue
            value = values[name]
            if widget.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                widget.field_value = widget.on_state() if value not in {"", "Off", "false", "False", "0"} else "Off"
            elif widget.field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
                on_state = widget.on_state()
                widget.field_value = on_state if value == on_state else "Off"
            else:
                widget.field_value = value
            try:
                widget.update()
            except Exception:  # noqa: BLE001
                pass


def parse_xfdf_values(xfdf: str) -> dict[str, str]:
    try:
        root = ET.fromstring(xfdf)
    except ET.ParseError:
        return {}
    values: dict[str, str] = {}
    for field in root.iter():
        if strip_namespace(field.tag) != "field":
            continue
        name = str(field.attrib.get("name", ""))
        if not name:
            continue
        value = ""
        for child in field:
            if strip_namespace(child.tag) == "value":
                value = child.text or ""
                break
        values[name] = value
    return values


def strip_namespace(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def rect_to_list(rect: fitz.Rect) -> list[float]:
    return [rect.x0, rect.y0, rect.x1, rect.y1]


def flow_slice_source_rect(operation: Operation, metrics: PageMetrics) -> fitz.Rect:
    return to_rect(
        {
            "x": operation.get("x", 0),
            "y": operation.get("sourceY", operation.get("y", 0)),
            "width": operation.get("width", 0),
            "height": operation.get("height", 0),
        },
        metrics,
    )


def to_rect(source: dict[str, Any], metrics: PageMetrics) -> fitz.Rect:
    x = float(source.get("x", 0)) * metrics.width
    y = float(source.get("y", 0)) * metrics.height
    width = max(0.5, float(source.get("width", 0)) * metrics.width)
    height = max(0.5, float(source.get("height", 0)) * metrics.height)
    return fitz.Rect(x, y, x + width, y + height)


def to_point(source: Any, metrics: PageMetrics) -> fitz.Point:
    if not isinstance(source, dict):
        return fitz.Point(0, 0)
    return fitz.Point(float(source.get("x", 0)) * metrics.width, float(source.get("y", 0)) * metrics.height)


def hex_to_rgb(value: str) -> tuple[float, float, float]:
    clean = value.strip().lstrip("#")
    if len(clean) != 6:
        clean = "111111"
    return (
        int(clean[0:2], 16) / 255,
        int(clean[2:4], 16) / 255,
        int(clean[4:6], 16) / 255,
    )


def int_to_hex(value: int) -> str:
    return f"#{value & 0xFFFFFF:06x}"


def rgb_to_hex(value: Any) -> str:
    if not isinstance(value, (tuple, list)) or len(value) < 3:
        return ""
    try:
        red, green, blue = [clamp_int(round(float(component) * 255), 0, 255) for component in value[:3]]
    except (TypeError, ValueError):
        return ""
    return f"#{red:02x}{green:02x}{blue:02x}"


def clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def clamp_float(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def write_json(value: Any, stream: Any) -> None:
    json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
    stream.write("\n")


if __name__ == "__main__":
    raise SystemExit(main())
