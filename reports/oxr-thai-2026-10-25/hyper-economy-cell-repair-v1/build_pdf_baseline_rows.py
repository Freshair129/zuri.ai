"""Build source-only PDF row candidates for the frozen economy table."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import pdfminer
import pdfplumber

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
from pdf_baseline_rows import (  # noqa: E402
    _axis_overlap_ratio,
    bind_raw_ocr_value,
    derive_header_layout,
    reconstruct_baselines,
)


PDF_PATH = REPO / ".local/thai-native-20261025/input/economy.pdf"
PADDLE_PATH = REPO / ".local/thai-native-20261025/paddle-2/economy.json"
ENUM_PATH = REPO / ".local/hyper-held-cell-audit-20261025/held-cell-enumeration-v1.json"
ENUM_FREEZE_PATH = REPO / ".local/hyper-held-cell-audit-20261025/held-cell-freeze-v1.json"
GEOMETRY_PATH = REPO / ".local/hyper-held-cell-audit-20261025/pdf-vector-geometry-v1.json"
OUTPUT_PATH = REPO / ".local/hyper-economy-cell-repair-20261025/pdf-baseline-rows-v1.json"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _label_ocr_evidence(
    label_words: list[dict[str, Any]],
    *,
    raw_texts: list[str],
    raw_boxes: list[list[float]],
    scale: tuple[float, float],
    data_left_pdf: float,
) -> list[dict[str, Any]]:
    sx, sy = scale
    found: dict[int, dict[str, Any]] = {}
    for source_word in label_words:
        source_box = [
            float(source_word["box"][0]) * sx,
            float(source_word["box"][1]) * sy,
            float(source_word["box"][2]) * sx,
            float(source_word["box"][3]) * sy,
        ]
        for record_index, (raw_text, raw_box_value) in enumerate(zip(raw_texts, raw_boxes)):
            try:
                raw_box = [float(value) for value in raw_box_value]
            except (TypeError, ValueError):
                continue
            if len(raw_box) != 4 or not raw_box[0] < raw_box[2] or not raw_box[1] < raw_box[3]:
                continue
            center_x = (raw_box[0] + raw_box[2]) / 2
            if center_x >= data_left_pdf * sx:
                continue
            overlap_x = _axis_overlap_ratio(source_box, raw_box, axis=0)
            overlap_y = _axis_overlap_ratio(source_box, raw_box, axis=1)
            if overlap_x >= 0.30 and overlap_y >= 0.30:
                found[record_index] = {
                    "recordIndex": record_index,
                    "rawText": str(raw_text),
                    "rawBoxPixels": raw_box,
                    "overlapRatioX": round(overlap_x, 6),
                    "overlapRatioY": round(overlap_y, 6),
                }
    return [found[index] for index in sorted(found)]


def build() -> dict[str, Any]:
    inputs = {
        "pdf": PDF_PATH,
        "paddleRaw": PADDLE_PATH,
        "enumeration": ENUM_PATH,
        "enumerationFreeze": ENUM_FREEZE_PATH,
        "pdfVectorGeometry": GEOMETRY_PATH,
    }
    for path in inputs.values():
        if not path.is_file():
            raise FileNotFoundError(path)
    hashes = {name: sha256_file(path) for name, path in inputs.items()}
    enumeration = json.loads(ENUM_PATH.read_text(encoding="utf-8"))
    enumeration_freeze = json.loads(ENUM_FREEZE_PATH.read_text(encoding="utf-8"))
    geometry_document = json.loads(GEOMETRY_PATH.read_text(encoding="utf-8"))
    geometry = geometry_document["tables"]["economy-table-0"]
    if hashes["pdf"] != geometry_document["sourceSha256"]["economyPdf"]:
        raise ValueError("economy PDF does not match the frozen geometry source hash")
    if hashes["paddleRaw"] != geometry_document["sourceSha256"]["economyPaddleRaw"]:
        raise ValueError("Paddle source does not match the frozen geometry source hash")
    if hashes["enumerationFreeze"] != enumeration.get("freezeSha256", ""):
        raise ValueError("enumeration does not bind the exact held-cell freeze bytes")
    for source_key, input_key in (("economyPdf", "pdf"), ("economyPaddleRaw", "paddleRaw"), ("pdfVectorGeometry", "pdfVectorGeometry")):
        if enumeration_freeze.get("inputSha256", {}).get(source_key) != hashes[input_key]:
            raise ValueError(f"held-cell freeze input hash mismatch for {source_key}")

    table = next(item for item in enumeration["tables"] if item["tableId"] == "economy-table-0")
    paddle_document = json.loads(PADDLE_PATH.read_text(encoding="utf-8-sig"))
    paddle_result = paddle_document["raw"][0]["res"]
    paddle_table = paddle_result["table_res_list"][0]["table_ocr_pred"]
    raw_texts = [str(value) for value in paddle_table["rec_texts"]]
    raw_boxes = paddle_table["rec_boxes"]
    if len(raw_texts) != len(raw_boxes):
        raise ValueError("frozen Paddle text/box arrays have different lengths")
    for record in table["headerBindings"]:
        index = record.get("recordIndex")
        if index is None:
            continue
        index = int(index)
        if index < 0 or index >= len(raw_texts):
            raise ValueError("header source record index falls outside raw Paddle arrays")
        if str(record["text"]) != raw_texts[index]:
            raise ValueError("header source record text differs from frozen Paddle output")
        if [float(value) for value in record["box"]] != [float(value) for value in raw_boxes[index]]:
            raise ValueError("header source record box differs from frozen Paddle output")

    sx, sy = (float(value) for value in geometry["paddlePerPdfPointScale"])
    raw_page = paddle_result
    with pdfplumber.open(PDF_PATH) as pdf:
        if len(pdf.pages) != 1:
            raise ValueError("expected the frozen one-page economy PDF")
        page = pdf.pages[0]
        page_scale = [float(raw_page["width"]) / page.width, float(raw_page["height"]) / page.height]
        if not math.isclose(page_scale[0], sx, rel_tol=0.0, abs_tol=1e-9) or not math.isclose(page_scale[1], sy, rel_tol=0.0, abs_tol=1e-9):
            raise ValueError("Paddle-to-PDF coordinate transform differs from the frozen page dimensions")
        extracted_words = page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False)
        page_words = [
            {
                "wordIndex": index,
                "text": str(word["text"]),
                "box": [float(word["x0"]), float(word["top"]), float(word["x1"]), float(word["bottom"])],
            }
            for index, word in enumerate(extracted_words)
        ]
        header_layout = derive_header_layout(
            page_words=page_words,
            source_header_records=table["headerBindings"],
            horizontal_edges=page.horizontal_edges,
            vertical_edges=page.vertical_edges,
            paddle_per_pdf_point_scale=[sx, sy],
        )
        if header_layout["status"] != "RESOLVED":
            raise ValueError(f"source month-header geometry held: {header_layout['reason']}")
        slot_bounds = header_layout["slotBoundariesPdfPoints"]
        row_result = reconstruct_baselines(
            page_words,
            header_layout["headerCentersPdfPoints"],
            outer_bounds=[slot_bounds[0], slot_bounds[-1]],
        )

    unique_paddle_records: set[int] = set()
    candidate_rows: list[dict[str, Any]] = []
    held_groups: list[dict[str, Any]] = []
    for group in row_result["groups"]:
        if group["status"] != "SOURCE_ROW_CANDIDATE":
            held_groups.append({
                "rowKey": group["rowKey"],
                "baselinePdfPoints": group["baselinePdfPoints"],
                "wordIndexes": group["wordIndexes"],
                "holdReasons": group["holdReasons"],
            })
            continue
        if len(group["cells"]) != len(header_layout["bindings"]):
            held_groups.append({
                "rowKey": group["rowKey"],
                "baselinePdfPoints": group["baselinePdfPoints"],
                "wordIndexes": group["wordIndexes"],
                "holdReasons": ["VALUE_COUNT_DOES_NOT_MATCH_COMPLETE_HEADER"],
            })
            continue
        label_evidence = _label_ocr_evidence(
            group["labelWords"],
            raw_texts=raw_texts,
            raw_boxes=raw_boxes,
            scale=(sx, sy),
            data_left_pdf=slot_bounds[0],
        )
        if not label_evidence:
            held_groups.append({
                "rowKey": group["rowKey"],
                "baselinePdfPoints": group["baselinePdfPoints"],
                "wordIndexes": group["wordIndexes"],
                "holdReasons": ["LEFT_STUB_LABEL_NOT_CORROBORATED_BY_PADDLE_GEOMETRY"],
            })
            continue

        cells: list[dict[str, Any]] = []
        matches_for_row: list[int] = []
        row_held_reason: str | None = None
        for cell in group["cells"]:
            slot = int(cell["slot"])
            header = header_layout["bindings"][slot]
            binding = bind_raw_ocr_value(
                cell,
                raw_texts=raw_texts,
                raw_boxes=raw_boxes,
                paddle_per_pdf_point_scale=[sx, sy],
                slot_bounds_pdf_points=header["slotBoundsPdfPoints"],
            )
            if binding["status"] != "CORROBORATED":
                row_held_reason = binding["reason"]
                break
            paddle_match = binding["match"]
            if paddle_match["recordIndex"] in unique_paddle_records:
                row_held_reason = "PADDLE_VALUE_RECORD_REUSED"
                break
            matches_for_row.append(paddle_match["recordIndex"])
            cells.append({
                "slot": slot,
                "sourceOrigin": "PDF_TEXT_LAYER_WORD",
                "pdfWordIndex": int(cell["wordIndex"]),
                "pdfText": str(cell["text"]),
                "numericLexicalKey": str(cell["numericKey"]),
                "pdfBoxPoints": [float(value) for value in cell["box"]],
                "header": {
                    "sourceOrigin": "PDF_TEXT_LAYER_WORD_WITH_FROZEN_PADDLE_RECORD_MATCH",
                    "text": str(header["text"]),
                    "pdfWordIndex": int(header["pdfWordIndex"]),
                    "pdfBoxPoints": [float(value) for value in header["pdfBox"]],
                    "frozenPaddleRecordIndex": int(header["recordIndex"]),
                    "slotBoundsPdfPoints": [float(value) for value in header["slotBoundsPdfPoints"]],
                    "bindingStatus": "LEXICAL_SLOT_REFERENCE_ONLY",
                },
                "paddleCorroboration": paddle_match,
            })
        if row_held_reason:
            held_groups.append({
                "rowKey": group["rowKey"],
                "baselinePdfPoints": group["baselinePdfPoints"],
                "wordIndexes": group["wordIndexes"],
                "holdReasons": [row_held_reason],
            })
            continue
        if len(set(matches_for_row)) != len(cells):
            raise ValueError("one Paddle OCR record was reused within a PDF baseline row")
        unique_paddle_records.update(matches_for_row)
        candidate_rows.append({
            "rowId": f"pdf-row:economy:p0:{group['rowKey'].split(':')[-1]}",
            "origin": "PDF_TEXT_LAYER_BASELINE_ROW",
            "documentId": "economy",
            "tableId": "economy-table-0",
            "pageIndex": 0,
            "rowKey": group["rowKey"],
            "baselinePdfPoints": float(group["baselinePdfPoints"]),
            "rowLabel": {
                "sourceOrigin": "PDF_TEXT_LAYER_WORD_SEQUENCE",
                "text": str(group["labelText"]),
                "words": [
                    {"pdfWordIndex": int(word["wordIndex"]), "text": str(word["text"]), "pdfBoxPoints": [float(value) for value in word["box"]]}
                    for word in group["labelWords"]
                ],
                "paddleLabelBoxOverlapOnly": label_evidence,
                "paddleTextTokens": [entry["rawText"] for entry in label_evidence],
                "labelTextDiscrepancyStatus": (
                    "PDF_PADDLE_LITERAL_LABEL_MISMATCH"
                    if len(label_evidence) == 1 and label_evidence[0]["rawText"] != str(group["labelText"])
                    else "MULTI_TOKEN_OR_LITERAL_LABEL_COMPARISON_REQUIRED"
                ),
            },
            "cells": cells,
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
        })

    if len(candidate_rows) != len(row_result["rows"]):
        raise ValueError("a geometrically complete PDF row failed raw-source cross-checks")
    context = [
        {
            "sourceOrigin": "PDF_TEXT_LAYER_WORD",
            "pdfWordIndex": int(word["wordIndex"]),
            "text": str(word["text"]),
            "pdfBoxPoints": [float(value) for value in word["pdfBox"]],
            "bindingStatus": "TABLE_CONTEXT_ONLY",
        }
        for word in header_layout["contextWords"]
    ]
    return {
        "schema": "hyper-economy-pdf-baseline-rows-v1",
        "status": "SOURCE_ONLY_CANDIDATES_FROZEN_PENDING_SEPARATE_PROJECTION",
        "inputs": {name: {"path": str(path.relative_to(REPO)).replace("\\", "/"), "sha256": hashes[name]} for name, path in inputs.items()},
        "runtime": {
            "python": sys.version.split()[0],
            "pdfplumber": pdfplumber.__version__,
            "pdfminer": pdfminer.__version__,
            "wordExtraction": {"xTolerance": 2, "yTolerance": 3, "keepBlankChars": False},
        },
        "selectionPolicy": {
            "rows": "All same-baseline PDF word groups with exactly one left-stub label sequence and one complete numeric token in each uniquely derived header slot; no old candidate IDs, labels, expected values, questions or metrics select rows.",
            "values": "Exact PDF text-layer token only; retained verbatim. A unique text+box Paddle match corroborates geometry but never supplies or changes the value.",
            "headers": "Exact source-bound PDF words selected from the complete frozen Paddle header row; slot order is x-coordinate order; table year is context only.",
            "meaning": "Lexical and geometry candidate only; semanticStatus is NOT_ASSESSED and graphAdmission is NONE.",
        },
        "coordinateEvidence": {
            "pdfPagePoints": [float(page.width), float(page.height)],
            "paddlePagePixels": [int(raw_page["width"]), int(raw_page["height"])],
            "paddlePerPdfPointScale": [sx, sy],
            "headerLayout": header_layout,
        },
        "tableContextWords": context,
        "candidateRows": candidate_rows,
        "heldBaselines": held_groups,
        "summary": {
            "completePdfBaselines": len(row_result["rows"]),
            "candidateRows": len(candidate_rows),
            "candidateValueCells": sum(len(row["cells"]) for row in candidate_rows),
            "uniquePaddleValueRecords": len(unique_paddle_records),
            "heldBaselineGroups": len(held_groups),
            "tableYearWordsContextOnly": [word["text"] for word in context],
            "oldHeldCellRecordsChanged": 0,
            "legacyCellStatusesCarriedIntoSourceRows": 0,
            "goldQuestionsMetricsUsed": False,
            "modelCalls": 0,
        },
    }


def main() -> None:
    result = build()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
