"""Derive numeric cell values only from unique, source-aligned PDF text words."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from held_cell_repair import numeric_word_key

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "AGENTS.md").is_file())
RAW = ROOT / ".local/hyper-held-cell-audit-20261025"
REPORT = Path(__file__).resolve().parent
ENUM_PATH = RAW / "held-cell-enumeration-v1.json"
FREEZE_PATH = RAW / "held-cell-freeze-v1.json"
GEOMETRY_PATH = RAW / "pdf-vector-geometry-v1.json"
BUNDLE_PATH = ROOT / ".local/hyper-relation-audit-20261025/run-5/source-bundle.json"
OUTPUT_PATH = RAW / "pdf-cell-value-evidence-v1.json"
VALUE_FREEZE_PATH = RAW / "pdf-cell-value-freeze-v1.json"


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def file_sha(path: Path) -> str:
    return sha256(path.read_bytes())


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def axis_overlap_ratio(left: list[float], right: list[float], axis: str) -> float:
    if axis == "x":
        width = left[2] - left[0]
        overlap = max(0.0, min(left[2], right[2]) - max(left[0], right[0]))
    else:
        width = left[3] - left[1]
        overlap = max(0.0, min(left[3], right[3]) - max(left[1], right[1]))
    return overlap / width if width > 0 else 0.0


def _center(box: list[float]) -> tuple[float, float]:
    return ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def verify_raw_source_span(cell: dict[str, Any], zones_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    span = cell.get("sourceSpan")
    if not isinstance(span, dict):
        raise ValueError(f"Missing exact sourceSpan for {cell.get('recordId')}")
    zone = zones_by_id.get(str(span.get("zoneId")))
    if zone is None:
        raise ValueError(f"Missing source zone {span.get('zoneId')}")
    start, end = int(span["zoneStart"]), int(span["zoneEnd"])
    quote = zone["text"][start:end]
    if quote != cell.get("text") or quote != span.get("quote"):
        raise ValueError(f"Raw OCR source span does not match for {cell.get('recordId')}")
    return {
        "rangeId": span["rangeId"],
        "zoneId": span["zoneId"],
        "start": int(span["start"]),
        "end": int(span["end"]),
        "zoneStart": start,
        "zoneEnd": end,
        "quote": quote,
    }


def resolve_cell_numeric_word(
    *,
    cell: dict[str, Any],
    table_geometry: dict[str, Any],
) -> dict[str, Any]:
    if cell.get("recordType") != "TABLE_VALUE_CELL":
        return {"status": "NOT_VALUE_CELL", "reason": None}
    if cell.get("status") != "SOURCE_CELL_STRUCTURALLY_RESOLVED" or cell.get("headerStatus") != "RESOLVED":
        return {"status": "HELD", "reason": "SOURCE_CELL_OR_HEADER_NOT_RESOLVED"}
    if table_geometry.get("topologyCheck", {}).get("status") != "USABLE":
        return {"status": "HELD", "reason": "PDF_VECTOR_TABLE_TOPOLOGY_UNUSABLE"}
    try:
        ocr_box = [float(value) for value in cell["ocrBox"]]
    except (KeyError, TypeError, ValueError):
        return {"status": "HELD", "reason": "OCR_CELL_BOX_MISSING_OR_INVALID"}
    if len(ocr_box) != 4 or not ocr_box[0] < ocr_box[2] or not ocr_box[1] < ocr_box[3]:
        return {"status": "HELD", "reason": "OCR_CELL_BOX_MISSING_OR_INVALID"}
    center_x, center_y = _center(ocr_box)
    vector_cells = table_geometry.get("vectorCells", [])
    cell_matches = [
        vector_cell for vector_cell in vector_cells
        if vector_cell["box"][0] <= center_x <= vector_cell["box"][2]
        and vector_cell["box"][1] <= center_y <= vector_cell["box"][3]
    ]
    if len(cell_matches) != 1:
        return {"status": "HELD", "reason": "PDF_VECTOR_DATA_CELL_NOT_UNIQUE"}
    vector_cell = cell_matches[0]
    try:
        source_row = int(cell["sourceRow"])
        vector_row_start = int(vector_cell["rowStart"])
        vector_row_end = int(vector_cell["rowEnd"])
    except (KeyError, TypeError, ValueError):
        return {"status": "HELD", "reason": "PDF_VECTOR_CELL_SOURCE_ROW_INVALID"}
    if vector_row_start != source_row or vector_row_end != source_row:
        return {"status": "HELD", "reason": "PDF_VECTOR_CELL_SOURCE_ROW_MISMATCH"}

    try:
        source_column = int(cell["gridColumn"])
        vector_column_start = int(vector_cell["vectorColumnStart"])
        vector_column_end = int(vector_cell["vectorColumnEnd"])
    except (KeyError, TypeError, ValueError):
        return {"status": "HELD", "reason": "PDF_VECTOR_CELL_SOURCE_COLUMN_INVALID"}
    if vector_column_start != source_column or vector_column_end != source_column:
        return {"status": "HELD", "reason": "PDF_VECTOR_CELL_SOURCE_COLUMN_MISMATCH"}

    numeric_words = []
    for word in table_geometry.get("numericTextLayerWords", []):
        text = str(word.get("text", ""))
        key = numeric_word_key(text)
        if key is None or key != word.get("comparisonCanonical"):
            continue
        word_box = [float(value) for value in word["box"]]
        word_x, word_y = _center(word_box)
        cell_box = vector_cell["box"]
        if not (cell_box[0] <= word_x <= cell_box[2] and cell_box[1] <= word_y <= cell_box[3]):
            continue
        if not (ocr_box[0] <= word_x <= ocr_box[2] and ocr_box[1] <= word_y <= ocr_box[3]):
            continue
        if axis_overlap_ratio(word_box, cell_box, "x") < 0.95 or axis_overlap_ratio(word_box, cell_box, "y") < 0.95:
            continue
        if axis_overlap_ratio(word_box, ocr_box, "x") < 0.60 or axis_overlap_ratio(word_box, ocr_box, "y") < 0.60:
            continue
        numeric_words.append(word)
    if len(numeric_words) != 1:
        return {
            "status": "HELD",
            "reason": "PDF_NUMERIC_WORD_NOT_UNIQUE",
            "numericWordCandidateCount": len(numeric_words),
            "pdfVectorCellId": vector_cell["id"],
        }

    word = numeric_words[0]
    raw_text = str(cell["text"])
    pdf_text = str(word["text"])
    raw_key = numeric_word_key(raw_text)
    pdf_key = numeric_word_key(pdf_text)
    if pdf_key is None or pdf_key != word.get("comparisonCanonical"):
        return {"status": "HELD", "reason": "PDF_NUMERIC_WORD_INVALID"}
    correction = raw_key != pdf_key
    return {
        "status": "SOURCE_TEXT_LAYER_CORRECTION" if correction else "SOURCE_TEXT_LAYER_AGREES",
        "reason": None,
        "rawOcrText": raw_text,
        "rawOcrNumericKey": raw_key,
        "derivedPdfText": pdf_text,
        "derivedNumericKey": pdf_key,
        "replacementRequired": correction,
        "origin": "ORIGINAL_PDF_TEXT_LAYER_NUMERIC_WORD",
        "pdfVectorCellId": vector_cell["id"],
        "pdfVectorCellBounds": vector_cell["box"],
        "pdfVectorRowStart": vector_cell["rowStart"],
        "pdfVectorRowEnd": vector_cell["rowEnd"],
        "pdfWordIndex": int(word["wordIndex"]),
        "pdfWordText": pdf_text,
        "pdfWordBox": word["box"],
        "pdfWordBoxPdfPoints": word["pdfBox"],
        "ocrBox": ocr_box,
    }


def main() -> None:
    source_enum = read_json(ENUM_PATH)
    freeze_sha = file_sha(FREEZE_PATH)
    if source_enum.get("freezeSha256") != freeze_sha:
        raise SystemExit("Source-native enumeration does not match held-cell freeze")
    geometry = read_json(GEOMETRY_PATH)
    geometry_sha = file_sha(GEOMETRY_PATH)
    if source_enum.get("freezeSha256") != freeze_sha:
        raise SystemExit("Invalid enumeration freeze binding")
    bundle = read_json(BUNDLE_PATH)
    zones_by_id = {str(zone["id"]): zone for zone in bundle["zones"]}
    input_paths = {
        "sourceNativeFreeze": FREEZE_PATH,
        "sourceNativeEnumeration": ENUM_PATH,
        "pdfVectorGeometry": GEOMETRY_PATH,
        "sourceBundle": BUNDLE_PATH,
    }
    input_hashes = {name: file_sha(path) for name, path in input_paths.items()}
    implementation_hashes = {
        name: file_sha(REPORT / name)
        for name in ("derive_pdf_cell_values.py", "held_cell_repair.py", "extract_pdf_vector_geometry.py", "test_pdf_cell_value_corrections.py")
    }
    value_freeze = {
        "schema": "hyper-held-cell-pdf-value-freeze-v1",
        "status": "FROZEN_BEFORE_QA_OR_SCORING",
        "profile": "source-native-numeric-text-layer-delta-over-all-cells",
        "inputPaths": {name: str(path.relative_to(ROOT)).replace("\\", "/") for name, path in input_paths.items()},
        "inputSha256": input_hashes,
        "implementationSha256": implementation_hashes,
        "policy": {
            "population": "All 972 source cells are scanned. Correction candidates require a structurally resolved value cell, unique source OCR box, usable PDF vector table, one unique valid numeric word in the same vector cell and OCR box, and an exact raw source span.",
            "valueText": "Replacement text is the exact original PDF text-layer token. Unicode normalization is used only for numeric comparison; raw Paddle text remains unchanged.",
            "outsidePriorHeldCohort": "The source-derived rule is evaluated without prior status/audit labels. Any mismatches outside the previous held cohort remain separately identified for source review before native projection.",
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "modelCalls": 0,
            "goldQuestionsOrMetricsUsed": False,
        },
    }
    VALUE_FREEZE_PATH.write_text(json.dumps(value_freeze, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    value_freeze_sha = file_sha(VALUE_FREEZE_PATH)
    geometry_tables = geometry.get("tables", {})
    all_cells = [cell for table in source_enum["tables"] for cell in table["cells"]]
    if len(all_cells) != 972 or len({cell["recordId"] for cell in all_cells}) != 972:
        raise SystemExit("Unexpected source-native cell set")

    outcomes: list[dict[str, Any]] = []
    for table in source_enum["tables"]:
        table_id = str(table["tableId"])
        table_geometry = geometry_tables.get(table_id)
        if table_geometry is None:
            raise SystemExit(f"Missing PDF geometry for {table_id}")
        for cell in table["cells"]:
            evidence = resolve_cell_numeric_word(cell=cell, table_geometry=table_geometry)
            outcome = {
                "recordId": cell["recordId"],
                "recordType": cell["recordType"],
                "documentId": cell["documentId"],
                "tableId": table_id,
                "pageIndex": int(cell["page"]),
                "sourcePdfSha256": table_geometry.get("sourcePdfSha256"),
                "pdfTextGeometryEngine": geometry.get("runtime"),
                "sourceRow": int(cell["sourceRow"]),
                "sourceCell": int(cell["sourceCell"]),
                "sourceStatus": cell["status"],
                "sourceText": cell["text"],
                "sourceSpan": verify_raw_source_span(cell, zones_by_id) if cell.get("recordType") == "TABLE_VALUE_CELL" else None,
                "evidence": evidence,
            }
            outcomes.append(outcome)

    counts = Counter(str(row["evidence"]["status"]) for row in outcomes)
    hold_reasons = Counter(
        str(row["evidence"].get("reason"))
        for row in outcomes
        if row["evidence"]["status"] == "HELD"
    )
    source_corrections = [row for row in outcomes if row["evidence"]["status"] == "SOURCE_TEXT_LAYER_CORRECTION"]
    output = {
        "schema": "hyper-held-cell-pdf-value-evidence-v1",
        "status": "SOURCE_EVIDENCE_DERIVED_NOT_SEMANTICALLY_ASSESSED",
        "freezeSha256": value_freeze_sha,
        "inputs": {
            "sourceNativeFreezeSha256": freeze_sha,
            "sourceNativeEnumerationSha256": file_sha(ENUM_PATH),
            "pdfVectorGeometrySha256": geometry_sha,
            "sourceBundleSha256": file_sha(BUNDLE_PATH),
        },
        "implementationSha256": implementation_hashes,
        "method": {
            "population": "Scan every re-enumerated source cell. Only structurally resolved TABLE_VALUE_CELL entries with a unique OCR box and a unique clean numeric PDF text-layer word fully inside the matching PDF vector cell and centered inside the OCR box can agree/correct.",
            "selection": "No held-cell audit labels, candidate IDs, question text, gold answers or metrics choose records or values.",
            "normalization": "NFKC plus Unicode decimal digit values and retained numeric punctuation are used only for comparison. Replacement text is the exact original PDF text-layer word.",
            "rawOcr": "Original Paddle text and sourceSpan are copied unchanged. Replacement is a distinct derived source-text-layer value.",
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "modelCalls": 0,
        },
        "summary": {
            "sourceCells": len(outcomes),
            "valueCells": sum(row["recordType"] == "TABLE_VALUE_CELL" for row in outcomes),
            "statusCounts": dict(sorted(counts.items())),
            "heldReasonCounts": dict(sorted(hold_reasons.items())),
            "sourceTextLayerCorrections": len(source_corrections),
            "correctionRecords": [
                {
                    "recordId": row["recordId"],
                    "sourceText": row["sourceText"],
                    "derivedPdfText": row["evidence"]["derivedPdfText"],
                    "sourceSpan": row["sourceSpan"],
                    "pdfVectorCellId": row["evidence"]["pdfVectorCellId"],
                    "pdfWordIndex": row["evidence"]["pdfWordIndex"],
                    "pdfWordBox": row["evidence"]["pdfWordBox"],
                }
                for row in source_corrections
            ],
        },
        "cells": outcomes,
    }
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "outputSha256": file_sha(OUTPUT_PATH),
        "summary": {key: value for key, value in output["summary"].items() if key != "correctionRecords"},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
