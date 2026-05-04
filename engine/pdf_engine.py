#!/usr/bin/env python3
"""Production-oriented PDF text editing engine.

The engine intentionally lives outside the browser UI. It exposes deterministic
JSON operations that can be used from a CLI, an HTTP service, or future workers.
Coordinates are normalized with a top-left origin, matching the web editor.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Literal, TypedDict

import fitz


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FONT = ROOT / "public" / "fonts" / "AppleGothic.ttf"


class PageSpec(TypedDict):
    sourceIndex: int
    rotation: int


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
    fieldName: str
    fieldType: str
    fieldValue: str
    checked: bool
    exportValue: str


class SaveOptions(TypedDict, total=False):
    annotationMode: str
    redactionMode: str
    flattenForms: bool
    validate: bool


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
    validate_parser.add_argument("--stdin", action="store_true")
    validate_parser.add_argument("--stdout", action="store_true")

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
        else:
            if not args.input:
                raise SystemExit("--input is required without --stdin")
            pdf_bytes = Path(args.input).read_bytes()
        result = validate_pdf_bytes(pdf_bytes)
        if args.stdout:
            write_json(result, sys.stdout)
        else:
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
        pages.append(
            {
                "index": page_index,
                "width": rect.width,
                "height": rect.height,
                "rotation": page.rotation,
                "spans": spans,
                "images": images,
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
    try:
        authenticate_if_needed(source, str(payload.get("password", "")))
        pages = normalize_pages(payload.get("pages"), source.page_count)
        for page_spec in pages:
            source_index = clamp_int(page_spec["sourceIndex"], 0, source.page_count - 1)
            output.insert_pdf(source, from_page=source_index, to_page=source_index)
            if page_spec.get("rotation", 0):
                output[-1].set_rotation(int(page_spec["rotation"]) % 360)

        operations = validate_operations(payload.get("operations", []), output.page_count)
        save_options = normalize_save_options(payload.get("saveOptions"))
        operations_by_page = group_operations(operations)
        for page_index, page_operations in operations_by_page.items():
            page = output[page_index]
            metrics = PageMetrics(page.rect.width, page.rect.height)
            apply_annotation_delete_phase(page, page_operations, metrics)
            apply_form_field_phase(page, page_operations, metrics)
            flow_slice_images = render_flow_slice_images(page, page_operations, metrics)
            apply_redaction_phase(page, page_operations, metrics, save_options)
            apply_insert_phase(page, page_operations, metrics, font_path, flow_slice_images, save_options)

        apply_metadata(output, payload.get("metadata"))
        if save_options.get("annotationMode") == "flatten" or save_options.get("flattenForms", False):
            output.bake(
                annots=save_options.get("annotationMode") == "flatten",
                widgets=save_options.get("flattenForms", False),
            )
        buffer = io.BytesIO()
        output.save(buffer, garbage=4, deflate=True, clean=True)
        edited = buffer.getvalue()
        if save_options.get("validate", True):
            validation = validate_pdf_bytes(edited)
            if not validation["ok"]:
                raise ValueError(f"PDF validation failed: {validation['errors']}")
        return edited
    finally:
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
        "validate": bool(value.get("validate", True)),
    }


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
            }
        )
    return pages or [{"sourceIndex": index, "rotation": 0} for index in range(page_count)]


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
        if op_type not in {"text", "highlight", "rect", "redact", "pen", "image", "flowSlice", "deleteAnnotation", "deleteImage", "formField"}:
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
    for operation in form_operations:
        target_rect = to_rect(operation, metrics)
        field_name = str(operation.get("fieldName", ""))
        for widget in page.widgets() or []:
            if not widget_matches_form_operation(widget, target_rect, field_name):
                continue
            update_widget_value(widget, operation)
            break


def widget_matches_form_operation(widget: fitz.Widget, target_rect: fitz.Rect, field_name: str) -> bool:
    if field_name and widget.field_name == field_name:
        return True
    return rects_match(widget.rect, target_rect)


def update_widget_value(widget: fitz.Widget, operation: Operation) -> None:
    field_type = str(operation.get("fieldType", ""))
    if field_type == "checkbox":
        checked = bool(operation.get("checked", False))
        if checked:
            widget.field_value = widget.on_state() or str(operation.get("exportValue", "Yes"))
        else:
            widget.field_value = "Off"
        widget.update()
        return
    widget.field_value = str(operation.get("fieldValue", ""))
    widget.update()


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


def apply_redaction_phase(
    page: fitz.Page,
    operations: list[Operation],
    metrics: PageMetrics,
    save_options: SaveOptions,
) -> None:
    has_redactions = False
    force_image_removal = False
    for operation in operations:
        if operation["type"] == "text" and isinstance(operation.get("eraseOriginal"), dict):
            source_rect = to_rect(operation["eraseOriginal"], metrics)
            page.add_redact_annot(source_rect, fill=(1, 1, 1))
            has_redactions = True
        elif operation["type"] == "redact":
            page.add_redact_annot(to_rect(operation, metrics), fill=(1, 1, 1))
            has_redactions = True
        elif operation["type"] == "deleteImage":
            page.add_redact_annot(to_rect(operation, metrics), fill=(1, 1, 1))
            has_redactions = True
            force_image_removal = True
        elif operation["type"] == "flowSlice":
            page.add_redact_annot(flow_slice_source_rect(operation, metrics), fill=(1, 1, 1))
            has_redactions = True

    if has_redactions:
        image_policy, graphics_policy = redaction_policy(save_options)
        if force_image_removal:
            image_policy = fitz.PDF_REDACT_IMAGE_REMOVE
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


def apply_insert_phase(
    page: fitz.Page,
    operations: list[Operation],
    metrics: PageMetrics,
    font_path: Path,
    flow_slice_images: list[bytes],
    save_options: SaveOptions,
) -> None:
    flow_slice_index = 0
    native_annotations = save_options.get("annotationMode") == "native"
    for operation in operations:
        op_type = operation["type"]
        if op_type in {"deleteAnnotation", "deleteImage", "formField"}:
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
    page.insert_textbox(
        rect,
        text,
        fontsize=font_size,
        fontname=font_name,
        color=color,
        align=fitz.TEXT_ALIGN_LEFT,
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


def validate_pdf_bytes(pdf_bytes: bytes) -> dict[str, Any]:
    errors: list[str] = []
    page_count = 0
    encrypted = False
    annotation_count = 0
    text_length = 0
    page_sizes: list[dict[str, float]] = []
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            encrypted = bool(document.needs_pass)
            page_count = document.page_count if not encrypted else 0
            if not encrypted:
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
                [qpdf_path, "--check", handle.name],
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


def clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def clamp_float(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def write_json(value: Any, stream: Any) -> None:
    json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
    stream.write("\n")


if __name__ == "__main__":
    raise SystemExit(main())
