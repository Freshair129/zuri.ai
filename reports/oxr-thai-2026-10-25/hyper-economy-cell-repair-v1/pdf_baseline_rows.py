"""Reconstruct conservative PDF-native data rows from word-box geometry only."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path
from statistics import median
from typing import Any

HERE = Path(__file__).resolve().parent
PREVIOUS_REPORT = HERE.parent / "hyper-held-cell-audit-v1"
sys.path.insert(0, str(PREVIOUS_REPORT))

from held_cell_repair import numeric_word_key  # noqa: E402


MIDPOINT_EPSILON = 1e-7
MIN_VERTICAL_OVERLAP_RATIO = 0.5


def _box(word: dict[str, Any]) -> list[float]:
    value = word.get("box")
    if value is None:
        value = [word["x0"], word["top"], word["x1"], word["bottom"]]
    if len(value) != 4:
        raise ValueError("word box must contain x0, top, x1, bottom")
    box = [float(item) for item in value]
    if not all(math.isfinite(item) for item in box):
        raise ValueError("word box coordinates must be finite")
    if not box[0] < box[2] or not box[1] < box[3]:
        raise ValueError("word box must have positive width and height")
    return box


def _vertical_overlap_ratio(left: list[float], right: list[float]) -> float:
    overlap = max(0.0, min(left[3], right[3]) - max(left[1], right[1]))
    shorter = min(left[3] - left[1], right[3] - right[1])
    return overlap / shorter if shorter > 0 else 0.0


def _source_value_key(text: str) -> str | None:
    """Validate numeric token syntax while preserving balanced parentheses."""
    direct = numeric_word_key(text)
    if direct is not None:
        return direct
    if len(text) >= 3 and text.startswith("(") and text.endswith(")"):
        inner = numeric_word_key(text[1:-1])
        if inner is not None:
            return f"({inner})"
    return None


def _axis_overlap_ratio(left: list[float], right: list[float], axis: int) -> float:
    start = axis
    end = axis + 2
    width = left[end] - left[start]
    if width <= 0:
        return 0.0
    overlap = max(0.0, min(left[end], right[end]) - max(left[start], right[start]))
    return overlap / width


def bind_raw_ocr_value(
    pdf_word: dict[str, Any],
    *,
    raw_texts: list[str],
    raw_boxes: list[list[float]],
    paddle_per_pdf_point_scale: list[float] | tuple[float, float],
    slot_bounds_pdf_points: list[float] | tuple[float, float],
    minimum_axis_overlap: float = 0.5,
) -> dict[str, Any]:
    """Corroborate a PDF numeric token with one spatially matching Paddle box.

    The PDF word defines the value and slot. Paddle is only an independent
    geometry/text cross-check; Paddle text never supplies or changes a value.
    """
    if len(raw_texts) != len(raw_boxes):
        return {"status": "HELD", "reason": "PADDLE_TEXT_BOX_LENGTH_MISMATCH", "matches": []}
    if len(paddle_per_pdf_point_scale) != 2 or len(slot_bounds_pdf_points) != 2:
        return {"status": "HELD", "reason": "PADDLE_BINDING_GEOMETRY_INVALID", "matches": []}
    scale_x, scale_y = (float(value) for value in paddle_per_pdf_point_scale)
    slot_left, slot_right = (float(value) for value in slot_bounds_pdf_points)
    key = _source_value_key(str(pdf_word.get("text", "")))
    if key is None:
        return {"status": "HELD", "reason": "PDF_WORD_NOT_NUMERIC", "matches": []}
    try:
        source_box = _box(pdf_word)
    except (KeyError, TypeError, ValueError):
        return {"status": "HELD", "reason": "PDF_WORD_BOX_INVALID", "matches": []}
    paddle_source_box = [
        source_box[0] * scale_x,
        source_box[1] * scale_y,
        source_box[2] * scale_x,
        source_box[3] * scale_y,
    ]
    candidates = []
    for record_index, (raw_text, raw_box_value) in enumerate(zip(raw_texts, raw_boxes)):
        if _source_value_key(str(raw_text)) != key:
            continue
        try:
            raw_box = [float(value) for value in raw_box_value]
        except (TypeError, ValueError):
            continue
        if len(raw_box) != 4 or not raw_box[0] < raw_box[2] or not raw_box[1] < raw_box[3]:
            continue
        center_x = (raw_box[0] + raw_box[2]) / 2
        if not (slot_left * scale_x <= center_x < slot_right * scale_x):
            continue
        overlap_x = _axis_overlap_ratio(paddle_source_box, raw_box, axis=0)
        overlap_y = _axis_overlap_ratio(paddle_source_box, raw_box, axis=1)
        if overlap_x >= minimum_axis_overlap and overlap_y >= minimum_axis_overlap:
            candidates.append({
                "recordIndex": record_index,
                "rawText": str(raw_text),
                "rawBoxPixels": raw_box,
                "numericKey": key,
                "overlapRatioX": round(overlap_x, 6),
                "overlapRatioY": round(overlap_y, 6),
            })
    if len(candidates) != 1:
        return {
            "status": "HELD",
            "reason": "PADDLE_VALUE_BOX_NOT_UNIQUE",
            "matches": candidates,
        }
    return {"status": "CORROBORATED", "reason": None, "match": candidates[0]}


def _baseline_groups(words: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    prepared = []
    seen_indices: set[int] = set()
    for word in words:
        index = int(word["wordIndex"])
        if index in seen_indices:
            raise ValueError(f"duplicate PDF word index: {index}")
        seen_indices.add(index)
        text = str(word.get("text", ""))
        if not text:
            raise ValueError(f"empty PDF word at index {index}")
        prepared.append({"wordIndex": index, "text": text, "box": _box(word)})
    prepared.sort(key=lambda item: (item["box"][1], item["box"][0], item["wordIndex"]))

    parents = list(range(len(prepared)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        root_left = find(left)
        root_right = find(right)
        if root_left != root_right:
            parents[root_right] = root_left

    for left_index, left in enumerate(prepared):
        left_box = left["box"]
        for right_index in range(left_index + 1, len(prepared)):
            right_box = prepared[right_index]["box"]
            if right_box[1] >= left_box[3]:
                break
            if _vertical_overlap_ratio(left_box, right_box) >= MIN_VERTICAL_OVERLAP_RATIO:
                union(left_index, right_index)

    groups: dict[int, list[dict[str, Any]]] = {}
    for index, word in enumerate(prepared):
        groups.setdefault(find(index), []).append(word)
    return [
        sorted(group, key=lambda item: (item["box"][0], item["wordIndex"]))
        for group in sorted(groups.values(), key=lambda items: median((item["box"][1] + item["box"][3]) / 2 for item in items))
    ]


def _boundaries(header_centers: list[float], outer_bounds: list[float] | tuple[float, float] | None) -> list[float]:
    centers = [float(center) for center in header_centers]
    if len(centers) < 2 or not all(math.isfinite(center) for center in centers):
        raise ValueError("at least two finite header centers are required")
    if centers != sorted(centers) or len(set(centers)) != len(centers):
        raise ValueError("header centers must be strictly increasing and unique")
    midpoints = [(left + right) / 2 for left, right in zip(centers, centers[1:])]
    if outer_bounds is None:
        left = centers[0] - (centers[1] - centers[0]) / 2
        right = centers[-1] + (centers[-1] - centers[-2]) / 2
    else:
        left, right = (float(item) for item in outer_bounds)
    if not math.isfinite(left) or not math.isfinite(right) or left >= centers[0] or right <= centers[-1] or left >= right:
        raise ValueError("outer boundaries must strictly contain all header centers")
    return [left, *midpoints, right]


def _row_key(words: list[dict[str, Any]], baseline: float) -> str:
    payload = [
        {"wordIndex": word["wordIndex"], "text": word["text"], "box": [round(value, 6) for value in word["box"]]}
        for word in words
    ]
    digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return f"pdf-row:y{baseline:.3f}:{digest[:16]}"


def derive_header_layout(
    *,
    page_words: list[dict[str, Any]],
    source_header_records: list[dict[str, Any]],
    horizontal_edges: list[dict[str, Any]],
    vertical_edges: list[dict[str, Any]],
    paddle_per_pdf_point_scale: list[float] | tuple[float, float],
) -> dict[str, Any]:
    """Bind a complete source header row to exact PDF words and table rules.

    Header text is matched only against the supplied frozen source OCR records;
    no month labels or page coordinates are embedded in the resolver.
    ``source_header_records[*].box`` uses Paddle page pixels. PDF word boxes,
    horizontal rules and returned centers/bounds use PDF points.
    """
    if len(paddle_per_pdf_point_scale) != 2:
        raise ValueError("Paddle-to-PDF scale must have x and y components")
    scale_x, scale_y = (float(value) for value in paddle_per_pdf_point_scale)
    if not math.isfinite(scale_x) or not math.isfinite(scale_y) or scale_x <= 0 or scale_y <= 0:
        raise ValueError("Paddle-to-PDF scale must be finite and positive")

    words_by_index: dict[int, dict[str, Any]] = {}
    for raw_word in page_words:
        index = int(raw_word["wordIndex"])
        if index in words_by_index:
            return {"status": "HELD", "reason": "PDF_WORD_INDEX_NOT_UNIQUE", "bindings": []}
        try:
            box = _box(raw_word)
        except (KeyError, TypeError, ValueError):
            return {"status": "HELD", "reason": "PDF_WORD_BOX_INVALID", "bindings": []}
        text = str(raw_word.get("text", ""))
        if not text:
            return {"status": "HELD", "reason": "PDF_WORD_TEXT_EMPTY", "bindings": []}
        words_by_index[index] = {"wordIndex": index, "text": text, "box": box}

    by_source_row: dict[int, list[dict[str, Any]]] = {}
    for record in source_header_records:
        try:
            row = int(record["row"])
            cell_index = int(record["cell"])
        except (KeyError, TypeError, ValueError):
            return {"status": "HELD", "reason": "SOURCE_HEADER_RECORD_INVALID", "bindings": []}
        raw_record_box = record.get("box")
        record_box = None
        if raw_record_box is not None:
            try:
                record_box = [float(value) for value in raw_record_box]
                if len(record_box) != 4 or not record_box[0] < record_box[2] or not record_box[1] < record_box[3]:
                    record_box = None
            except (TypeError, ValueError):
                record_box = None
        try:
            record_index = int(record.get("recordIndex", -1))
        except (TypeError, ValueError):
            record_index = -1
        by_source_row.setdefault(row, []).append({
            "row": row,
            "cell": cell_index,
            "recordIndex": record_index,
            "text": str(record.get("text") or ""),
            "paddleBox": record_box,
            "rawGridColumns": list(record.get("gridColumns", [])),
            "rawRowEnd": record.get("rowEnd"),
        })

    if not by_source_row:
        return {"status": "HELD", "reason": "SOURCE_HEADER_RECORDS_MISSING", "bindings": []}

    row_attempts: list[tuple[int, list[dict[str, Any]], str | None]] = []
    for source_row, records in sorted(by_source_row.items()):
        records.sort(key=lambda item: item["cell"])
        matched: list[dict[str, Any]] = []
        used_pdf_indices: set[int] = set()
        reason: str | None = None
        for record in records:
            if not record["text"] or record["paddleBox"] is None or record["recordIndex"] < 0:
                reason = "SOURCE_HEADER_CELL_MISSING"
                break
            scaled_box = [record["paddleBox"][0] / scale_x, record["paddleBox"][1] / scale_y,
                          record["paddleBox"][2] / scale_x, record["paddleBox"][3] / scale_y]
            candidates = []
            for word in words_by_index.values():
                if word["text"] != record["text"]:
                    continue
                box = word["box"]
                center = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
                if scaled_box[0] < center[0] < scaled_box[2] and scaled_box[1] < center[1] < scaled_box[3]:
                    candidates.append(word)
            if len(candidates) != 1:
                reason = "SOURCE_HEADER_TO_PDF_WORD_NOT_UNIQUE"
                break
            word = candidates[0]
            if word["wordIndex"] in used_pdf_indices:
                reason = "PDF_HEADER_WORD_REUSED"
                break
            used_pdf_indices.add(word["wordIndex"])
            matched.append({**record, "pdfWordIndex": word["wordIndex"], "pdfBox": word["box"]})
        if reason is None and len(matched) < 2:
            reason = "SOURCE_HEADER_ROW_TOO_SHORT"
        row_attempts.append((source_row, matched, reason))

    maximum_declared_cells = max(len(item[1]) for item in row_attempts)
    largest_rows = [item for item in row_attempts if len(item[1]) == maximum_declared_cells]
    if len(largest_rows) != 1:
        return {"status": "HELD", "reason": "SOURCE_HEADER_ROW_SELECTION_TIED", "bindings": []}
    if largest_rows[0][2] is not None:
        return {"status": "HELD", "reason": largest_rows[0][2], "bindings": []}
    complete_attempts = [item for item in row_attempts if item[2] is None]
    if not complete_attempts:
        reasons = sorted({item[2] for item in row_attempts if item[2]})
        return {"status": "HELD", "reason": reasons[0] if reasons else "HEADER_ROW_NOT_RESOLVED", "bindings": []}
    source_row, bindings, _ = largest_rows[0]

    centers = [((item["pdfBox"][0] + item["pdfBox"][2]) / 2) for item in bindings]
    if centers != sorted(centers) or len(set(centers)) != len(centers):
        return {"status": "HELD", "reason": "PDF_HEADER_CENTERS_NOT_STRICTLY_ORDERED", "bindings": []}
    top = min(item["pdfBox"][1] for item in bindings)
    bottom = max(item["pdfBox"][3] for item in bindings)
    left_header = min(item["pdfBox"][0] for item in bindings)
    right_header = max(item["pdfBox"][2] for item in bindings)

    covering_edges: list[tuple[float, float, float]] = []
    for edge in horizontal_edges:
        try:
            x0 = float(edge["x0"])
            x1 = float(edge["x1"])
            y = float(edge.get("top", edge.get("y0")))
        except (KeyError, TypeError, ValueError):
            continue
        if x0 <= left_header and x1 >= right_header and x1 > x0:
            covering_edges.append((y, x0, x1))
    upper = [edge for edge in covering_edges if edge[0] < top]
    lower = [edge for edge in covering_edges if edge[0] > bottom]
    if not upper or not lower:
        return {"status": "HELD", "reason": "SOURCE_HEADER_OUTER_RULES_MISSING", "bindings": []}
    upper_y = max(edge[0] for edge in upper)
    lower_y = min(edge[0] for edge in lower)
    upper_spans = {(round(x0, 3), round(x1, 3)) for y, x0, x1 in upper if abs(y - upper_y) <= 1e-3}
    lower_spans = {(round(x0, 3), round(x1, 3)) for y, x0, x1 in lower if abs(y - lower_y) <= 1e-3}
    if len(upper_spans) != 1 or len(lower_spans) != 1:
        return {"status": "HELD", "reason": "SOURCE_HEADER_RULE_SPANS_NOT_UNIQUE", "bindings": []}
    upper_span = next(iter(upper_spans))
    lower_span = next(iter(lower_spans))
    if upper_span != lower_span:
        return {"status": "HELD", "reason": "SOURCE_HEADER_RULE_SPANS_DISAGREE", "bindings": []}
    header_gap = min(right - left for left, right in zip(centers, centers[1:]))
    max_stroke_band_width = header_gap * 0.05

    def vertical_band(left_side: bool) -> tuple[float, float] | None:
        positions: list[float] = []
        for edge in vertical_edges:
            try:
                x0 = float(edge["x0"])
                x1 = float(edge["x1"])
                edge_top = float(edge.get("top", edge.get("y0")))
                edge_bottom = float(edge.get("bottom", edge.get("y1")))
            except (KeyError, TypeError, ValueError):
                continue
            if edge_top > top or edge_bottom < bottom or x1 < x0:
                continue
            positions.extend((x0, x1))
        if left_side:
            positions = [value for value in positions if value <= left_header]
            if not positions:
                return None
            nearest = max(positions)
            band = [value for value in positions if nearest - value <= max_stroke_band_width]
        else:
            positions = [value for value in positions if value >= right_header]
            if not positions:
                return None
            nearest = min(positions)
            band = [value for value in positions if value - nearest <= max_stroke_band_width]
        return min(band), max(band)

    left_band = vertical_band(left_side=True)
    right_band = vertical_band(left_side=False)
    if left_band is None or right_band is None:
        return {"status": "HELD", "reason": "SOURCE_HEADER_VERTICAL_RULES_MISSING", "bindings": []}
    rule_tolerance = 1e-3
    if abs(upper_span[0] - left_band[0]) > rule_tolerance or abs(upper_span[1] - right_band[1]) > rule_tolerance:
        return {"status": "HELD", "reason": "SOURCE_HEADER_HORIZONTAL_RULE_INCLUDES_STUB_OR_MISALIGNED", "bindings": []}
    if abs(lower_span[0] - left_band[0]) > rule_tolerance or abs(lower_span[1] - right_band[1]) > rule_tolerance:
        return {"status": "HELD", "reason": "SOURCE_HEADER_RULE_SPANS_DISAGREE", "bindings": []}
    outer_bounds = [left_band[1], right_band[0]]
    try:
        boundaries = _boundaries(centers, outer_bounds)
    except ValueError as exc:
        return {"status": "HELD", "reason": str(exc).upper().replace(" ", "_"), "bindings": []}

    for slot, binding in enumerate(bindings):
        box = binding["pdfBox"]
        if box[0] <= boundaries[slot] or box[2] >= boundaries[slot + 1]:
            return {"status": "HELD", "reason": "PDF_HEADER_WORD_CROSSES_SLOT_BOUNDARY", "bindings": []}
        binding["slot"] = slot
        binding["centerPdfPoints"] = centers[slot]
        binding["slotBoundsPdfPoints"] = [boundaries[slot], boundaries[slot + 1]]

    mapped_pdf_indices = {item["pdfWordIndex"] for item in bindings}
    context_words = []
    for word in words_by_index.values():
        box = word["box"]
        if word["wordIndex"] in mapped_pdf_indices:
            continue
        center_x = (box[0] + box[2]) / 2
        if (
            box[2] > upper_span[0]
            and box[0] < upper_span[1]
            and box[3] > upper_y
            and box[1] < lower_y
            and upper_span[0] < center_x < upper_span[1]
        ):
            context_words.append({
                "wordIndex": word["wordIndex"],
                "text": word["text"],
                "pdfBox": box,
                "bindingStatus": "TABLE_CONTEXT_ONLY",
            })
    return {
        "status": "RESOLVED",
        "reason": None,
        "sourceHeaderRow": source_row,
        "headerCentersPdfPoints": centers,
        "slotBoundariesPdfPoints": boundaries,
        "horizontalRuleYSpanPdfPoints": [upper_y, lower_y],
        "horizontalRuleOuterBoundsPdfPoints": [float(upper_span[0]), float(upper_span[1])],
        "verticalRuleBandsPdfPoints": {"left": list(left_band), "right": list(right_band)},
        "contextWords": sorted(context_words, key=lambda item: (item["pdfBox"][1], item["pdfBox"][0], item["wordIndex"])),
        "bindings": bindings,
    }


def reconstruct_baselines(
    words: list[dict[str, Any]],
    header_centers: list[float],
    *,
    outer_bounds: list[float] | tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Group PDF words by shared vertical ink and bind complete source rows.

    The caller supplies header centers derived from source geometry. Midpoints
    bound interior value slots; explicit outer bounds should come from source
    table rules where available. A row is only a lexical geometry candidate.
    """
    boundaries = _boundaries(header_centers, outer_bounds)
    groups: list[dict[str, Any]] = []
    for group_words in _baseline_groups(words):
        centers_y = [(word["box"][1] + word["box"][3]) / 2 for word in group_words]
        baseline = float(median(centers_y))
        numeric_by_slot: list[list[dict[str, Any]]] = [[] for _ in header_centers]
        labels: list[dict[str, Any]] = []
        errors: set[str] = set()
        extras: list[dict[str, Any]] = []
        for word in group_words:
            box = word["box"]
            center_x = (box[0] + box[2]) / 2
            key = _source_value_key(word["text"])
            if any(abs(center_x - boundary) <= MIDPOINT_EPSILON for boundary in boundaries[1:-1]):
                errors.add("COLUMN_MIDPOINT_TIE")
                continue
            overlaps = [
                slot
                for slot, (left, right) in enumerate(zip(boundaries, boundaries[1:]))
                if min(box[2], right) > max(box[0], left)
            ]
            if not overlaps:
                if box[2] <= boundaries[0]:
                    labels.append(word)
                elif center_x >= boundaries[-1]:
                    extras.append(word)
                    if key is not None:
                        errors.add("EXTRA_VALUE_TOKEN")
                else:
                    errors.add("OUTSIDE_SLOT_GEOMETRY")
                continue
            if len(overlaps) != 1:
                errors.add("VALUE_WORD_CROSSES_COLUMN_BOUNDARY")
                continue
            slot = overlaps[0]
            left, right = boundaries[slot], boundaries[slot + 1]
            if abs(center_x - right) <= MIDPOINT_EPSILON and slot < len(header_centers) - 1:
                errors.add("COLUMN_MIDPOINT_TIE")
                continue
            if abs(center_x - left) <= MIDPOINT_EPSILON and slot > 0:
                errors.add("COLUMN_MIDPOINT_TIE")
                continue
            if box[0] <= left or box[2] >= right:
                errors.add("VALUE_WORD_NOT_FULLY_INSIDE_SLOT")
                continue
            if key is None:
                errors.add("NONNUMERIC_VALUE_SLOT")
                continue
            numeric_by_slot[slot].append({**word, "numericKey": key, "centerX": center_x, "slot": slot})

        if extras:
            errors.add("TRAILING_WORD_OUTSIDE_GRID")
        duplicate_slots = [slot for slot, items in enumerate(numeric_by_slot) if len(items) > 1]
        missing_slots = [slot for slot, items in enumerate(numeric_by_slot) if not items]
        if duplicate_slots:
            errors.add("DUPLICATE_VALUE_SLOT")
        if missing_slots and any(numeric_by_slot):
            errors.add("INCOMPLETE_VALUE_ROW")
        if any(numeric_by_slot) and not labels:
            errors.add("ROW_LABEL_MISSING")

        label_words = sorted(labels, key=lambda item: (item["box"][0], item["wordIndex"]))
        label_text = " ".join(word["text"] for word in label_words)
        cells = [items[0] for items in numeric_by_slot if len(items) == 1]
        if not any(numeric_by_slot):
            reason = "NO_VALUE_TOKENS"
        elif errors:
            reason = sorted(errors)[0]
        else:
            reason = None
        group_record = {
            "status": "SOURCE_ROW_CANDIDATE" if reason is None else "HELD",
            "reason": reason,
            "holdReasons": sorted(errors),
            "rowKey": _row_key(group_words, baseline),
            "baselinePdfPoints": baseline,
            "labelText": label_text,
            "labelWords": label_words,
            "cells": sorted(cells, key=lambda cell: cell["slot"]),
            "duplicateSlots": duplicate_slots,
            "missingSlots": missing_slots,
            "extraWords": extras,
            "wordIndexes": [word["wordIndex"] for word in group_words],
        }
        groups.append(group_record)

    return {
        "headerCentersPdfPoints": [float(center) for center in header_centers],
        "slotBoundariesPdfPoints": boundaries,
        "groups": groups,
        "rows": [group for group in groups if group["status"] == "SOURCE_ROW_CANDIDATE"],
    }
