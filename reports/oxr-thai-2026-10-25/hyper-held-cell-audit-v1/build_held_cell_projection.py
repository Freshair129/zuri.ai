"""Build a compact, source-derived overlay without rewriting baseline OCR text."""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from held_cell_repair import numeric_word_key


ROOT = next(path for path in Path(__file__).resolve().parents if (path / "AGENTS.md").is_file())
REPORT = Path(__file__).resolve().parent
RAW = ROOT / ".local/hyper-held-cell-audit-20261025"
BASELINE_PATH = ROOT / ".local/thai-table-chunking-20261025/run-v2/native-input.json"
ENUM_PATH = RAW / "held-cell-enumeration-v1.json"
HELD_FREEZE_PATH = RAW / "held-cell-freeze-v1.json"
VALUE_EVIDENCE_PATH = RAW / "pdf-cell-value-evidence-v1.json"
VALUE_FREEZE_PATH = RAW / "pdf-cell-value-freeze-v1.json"
GEOMETRY_PATH = RAW / "pdf-vector-geometry-v1.json"
BUNDLE_PATH = ROOT / ".local/hyper-relation-audit-20261025/run-5/source-bundle.json"
PROJECTION_PATH = RAW / "held-cell-repair-projection-layout-v2.json"
PROJECTION_FREEZE_PATH = RAW / "held-cell-repair-projection-layout-v2-freeze.json"
NATIVE_INPUT_PATH = RAW / "native-input-held-cell-repair-layout-v2.json"
NATIVE_FREEZE_PATH = RAW / "native-input-held-cell-repair-layout-v2-freeze.json"


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _sha_text(text: str) -> str:
    return _sha(text.encode("utf-8"))


def _json_quote(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)


def _exact_span(span: dict[str, Any] | None, zones_by_id: dict[str, dict[str, Any]]) -> str:
    if not isinstance(span, dict):
        raise ValueError("source span is missing")
    zone_id = str(span.get("zoneId", ""))
    zone = zones_by_id.get(zone_id)
    if zone is None or span.get("rangeId") != zone.get("rangeId"):
        raise ValueError(f"source span zone mismatch: {zone_id}")
    start = int(span.get("zoneStart", -1))
    end = int(span.get("zoneEnd", -1))
    quote = str(span.get("quote", ""))
    if start < 0 or end <= start or end > len(str(zone["text"])):
        raise ValueError(f"source span bounds invalid for {zone_id}")
    if str(zone["text"])[start:end] != quote:
        raise ValueError(f"source span quote mismatch for {zone_id}")
    if int(span.get("start", -1)) != int(zone["sourceStart"]) + start:
        raise ValueError(f"source span absolute start mismatch for {zone_id}")
    if int(span.get("end", -1)) != int(zone["sourceStart"]) + end:
        raise ValueError(f"source span absolute end mismatch for {zone_id}")
    return quote


def _check_cell_pdf_evidence(
    *,
    cell: dict[str, Any],
    evidence_record: dict[str, Any],
    table_geometry: dict[str, Any],
    zones_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    source_span = cell.get("sourceSpan")
    source_text = _exact_span(source_span, zones_by_id)
    if source_text != str(cell.get("text", "")):
        raise ValueError(f"raw source text/span mismatch: {cell.get('recordId')}")
    if evidence_record.get("recordId") != cell.get("recordId"):
        raise ValueError("source cell/evidence identity mismatch")
    if evidence_record.get("sourcePdfSha256") != table_geometry.get("sourcePdfSha256"):
        raise ValueError(f"source PDF hash mismatch: {cell.get('recordId')}")
    evidence = evidence_record.get("evidence", {})
    status = evidence.get("status")
    if status not in {"SOURCE_TEXT_LAYER_AGREES", "SOURCE_TEXT_LAYER_CORRECTION"}:
        raise ValueError(f"cell has no qualified PDF numeric evidence: {cell.get('recordId')}")
    raw_text = str(evidence.get("rawOcrText", ""))
    pdf_text = str(evidence.get("derivedPdfText", ""))
    if raw_text != source_text or numeric_word_key(pdf_text) is None:
        raise ValueError(f"raw or PDF token is invalid: {cell.get('recordId')}")
    pdf_key = numeric_word_key(pdf_text)
    if pdf_key != evidence.get("derivedNumericKey"):
        raise ValueError(f"derived PDF numeric key mismatch: {cell.get('recordId')}")
    changed = numeric_word_key(raw_text) != pdf_key
    if changed != (status == "SOURCE_TEXT_LAYER_CORRECTION") or changed != bool(evidence.get("replacementRequired")):
        raise ValueError(f"numeric comparison status mismatch: {cell.get('recordId')}")

    vector_id = str(evidence.get("pdfVectorCellId", ""))
    vectors = [item for item in table_geometry.get("vectorCells", []) if item.get("id") == vector_id]
    if len(vectors) != 1:
        raise ValueError(f"PDF vector cell is not unique: {cell.get('recordId')}")
    vector_cell = vectors[0]
    if vector_cell.get("box") != evidence.get("pdfVectorCellBounds"):
        raise ValueError(f"PDF vector cell bounds mismatch: {cell.get('recordId')}")
    words = [
        item for item in table_geometry.get("numericTextLayerWords", [])
        if int(item.get("wordIndex", -1)) == int(evidence.get("pdfWordIndex", -2))
    ]
    if len(words) != 1:
        raise ValueError(f"PDF text word index is not unique: {cell.get('recordId')}")
    word = words[0]
    if word.get("text") != pdf_text or word.get("box") != evidence.get("pdfWordBox") or word.get("pdfBox") != evidence.get("pdfWordBoxPdfPoints"):
        raise ValueError(f"PDF text word evidence mismatch: {cell.get('recordId')}")
    if numeric_word_key(str(word.get("text", ""))) != word.get("comparisonCanonical"):
        raise ValueError(f"PDF word canonicalization mismatch: {cell.get('recordId')}")

    # Recheck that the PDF token and its source OCR box resolve only to the same vector cell.
    try:
        ocr_box = [float(value) for value in cell["ocrBox"]]
        word_box = [float(value) for value in word["box"]]
    except (KeyError, TypeError, ValueError):
        raise ValueError(f"source/OCR box missing: {cell.get('recordId')}")
    wx, wy = (word_box[0] + word_box[2]) / 2, (word_box[1] + word_box[3]) / 2
    ox, oy = (ocr_box[0] + ocr_box[2]) / 2, (ocr_box[1] + ocr_box[3]) / 2
    containing = [
        item for item in table_geometry.get("vectorCells", [])
        if item["box"][0] <= wx <= item["box"][2]
        and item["box"][1] <= wy <= item["box"][3]
    ]
    if len(containing) != 1 or containing[0].get("id") != vector_id:
        raise ValueError(f"PDF text word does not resolve uniquely to vector cell: {cell.get('recordId')}")
    if not (ocr_box[0] <= wx <= ocr_box[2] and ocr_box[1] <= wy <= ocr_box[3]):
        raise ValueError(f"PDF word center is outside source OCR box: {cell.get('recordId')}")
    if not (vector_cell["box"][0] <= ox <= vector_cell["box"][2] and vector_cell["box"][1] <= oy <= vector_cell["box"][3]):
        raise ValueError(f"source OCR box does not resolve to PDF vector cell: {cell.get('recordId')}")

    return {
        "status": status,
        "rawOcrText": raw_text,
        "pdfText": pdf_text,
        "replacementRequired": changed,
        "origin": "ORIGINAL_PDF_TEXT_LAYER_NUMERIC_WORD",
        "sourcePdfSha256": table_geometry["sourcePdfSha256"],
        "pdfVectorCellId": vector_id,
        "pdfVectorColumnStart": vector_cell.get("vectorColumnStart"),
        "pdfVectorColumnEnd": vector_cell.get("vectorColumnEnd"),
        "pdfVectorCellBounds": vector_cell["box"],
        "pdfWordIndex": int(word["wordIndex"]),
        "pdfWordText": word["text"],
        "pdfWordBox": word["box"],
        "pdfWordBoxPdfPoints": word["pdfBox"],
        "rawOcrSourceSpan": source_span,
    }


def _header_map_for_table(
    table: dict[str, Any],
    table_geometry: dict[str, Any],
    zones_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    if table_geometry.get("topologyCheck", {}).get("status") != "USABLE":
        return []
    by_vector_id: dict[str, dict[str, Any]] = {}
    for cell in table.get("cells", []):
        if cell.get("recordType") != "TABLE_VALUE_CELL" or cell.get("status") != "SOURCE_CELL_STRUCTURALLY_RESOLVED":
            continue
        for header in cell.get("resolvedHeaderPath", []):
            if header.get("status") != "RESOLVED" or not header.get("pdfVectorCellId"):
                continue
            text = _exact_span(header.get("sourceSpan"), zones_by_id)
            if text != str(header.get("text", "")):
                raise ValueError(f"header source span mismatch in {table['tableId']}")
            vector_id = str(header["pdfVectorCellId"])
            binding = {
                "text": text,
                "physicalColumns": [int(column) for column in header.get("physicalColumns", [])],
                "pdfVectorCellId": vector_id,
                "pdfVectorCellBounds": header.get("pdfVectorCellBounds"),
                "pdfVectorRowStart": header.get("pdfVectorRowStart"),
                "pdfVectorRowEnd": header.get("pdfVectorRowEnd"),
                "pdfVectorRowSpan": header.get("pdfVectorRowSpan"),
                "rawHeaderGridColumnsPreserved": header.get("rawHeaderGridColumnsPreserved", header.get("gridColumns", [])),
                "origin": "ORIGINAL_PADDLE_HEADER_TEXT_BOUND_TO_PDF_VECTOR_CELL",
                "semanticStatus": "NOT_ASSESSED",
            }
            previous = by_vector_id.get(vector_id)
            if previous is not None:
                comparable = {key: value for key, value in previous.items() if key != "sourceSpans"}
                if comparable != binding:
                    raise ValueError(f"conflicting header metadata for vector cell {vector_id}")
                if header["sourceSpan"] not in previous["sourceSpans"]:
                    previous["sourceSpans"].append(header["sourceSpan"])
            else:
                by_vector_id[vector_id] = {**binding, "sourceSpans": [header["sourceSpan"]]}
    return sorted(
        by_vector_id.values(),
        key=lambda item: (
            int(item["pdfVectorRowStart"] if item["pdfVectorRowStart"] is not None else -1),
            min(item["physicalColumns"] or [-1]),
            item["pdfVectorCellId"],
        ),
    )


def build_repair_overlay(
    enumeration: dict[str, Any],
    bundle: dict[str, Any],
    value_evidence: dict[str, Any],
    geometry: dict[str, Any],
) -> dict[str, Any]:
    """Build compact table header maps and fully evidenced corrected row views.

    All raw OCR/source spans remain untouched. A full PDF-derived row is emitted
    only when every nonempty enumerated value cell in that affected row has one
    exact numeric PDF token and a resolved header path. Otherwise, qualified
    correction cells are emitted as explicit partial deltas.
    """
    zones_by_id = {str(zone["id"]): zone for zone in bundle.get("zones", [])}
    evidence_by_id = {str(item["recordId"]): item for item in value_evidence.get("cells", [])}
    geometry_by_table = geometry.get("tables", {})
    tables_by_id = {str(table["tableId"]): table for table in enumeration.get("tables", [])}
    if len(evidence_by_id) != len(value_evidence.get("cells", [])):
        raise ValueError("duplicate value-evidence record ID")

    header_maps: list[dict[str, Any]] = []
    blocks: list[dict[str, Any]] = []
    partial_cells: list[dict[str, Any]] = []
    excluded_corrections: list[dict[str, Any]] = []
    excluded_correction_reasons: Counter[str] = Counter()
    evidence_status_counts: Counter[str] = Counter()
    complete_corrected_rows = 0
    corrected_cells = 0

    for table_id, table in sorted(tables_by_id.items()):
        table_geometry = geometry_by_table.get(table_id)
        if table_geometry is None:
            raise ValueError(f"missing PDF geometry for {table_id}")
        header_bindings = _header_map_for_table(table, table_geometry, zones_by_id)
        if header_bindings:
            header_lines = [
                f"c{min(binding['physicalColumns'])}-c{max(binding['physicalColumns'])} "
                f"= {_json_quote(binding['text'])} "
                f"(vector-cell={binding['pdfVectorCellId']}; rows={binding['pdfVectorRowStart']}-{binding['pdfVectorRowEnd']})"
                for binding in header_bindings
                if binding["physicalColumns"]
            ]
            header_maps.append({
                "blockId": f"pdf-header-map:{table_id}",
                "kind": "TABLE_HEADER_MAP",
                "tableId": table_id,
                "documentId": str(table["documentId"]),
                "pageIndex": int(table["page"]),
                "sourcePdfSha256": table_geometry["sourcePdfSha256"],
                "origin": "ORIGINAL_PADDLE_HEADER_TEXT_BOUND_TO_PDF_VECTOR_CELLS",
                "bindings": header_bindings,
                "semanticStatus": "NOT_ASSESSED",
                "graphAdmission": "NONE",
                "text": (
                    "## PDF vector table header map (structural only; semantics NOT_ASSESSED)\n"
                    f"table={table_id}; document={table['documentId']}; PDF page={int(table['page']) + 1}\n"
                    + "\n".join(header_lines)
                    + "\n"
                ),
            })

        cells_by_row: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for cell in table.get("cells", []):
            cells_by_row[int(cell["sourceRow"])].append(cell)
        for row in sorted(table.get("rows", []), key=lambda item: int(item["sourceRow"])):
            source_row = int(row["sourceRow"])
            row_cells = cells_by_row.get(source_row, [])
            value_cells = sorted(
                [cell for cell in row_cells if cell.get("recordType") == "TABLE_VALUE_CELL"],
                key=lambda cell: (int(cell.get("gridColumn", -1)), int(cell.get("sourceCell", -1))),
            )
            if not value_cells:
                continue
            correction_cell_ids = [
                str(cell["recordId"])
                for cell in value_cells
                if evidence_by_id.get(str(cell["recordId"]), {}).get("evidence", {}).get("status") == "SOURCE_TEXT_LAYER_CORRECTION"
            ]
            if not correction_cell_ids:
                continue
            corrected_cells += len(correction_cell_ids)

            row_zone = zones_by_id.get(str((row.get("rowSourceSpan") or {}).get("zoneId", "")))
            row_text = str(row.get("rowText", ""))
            if row_zone is None or not row_text or row_text not in str(row_zone.get("text", "")):
                raise ValueError(f"row text/source zone mismatch: {row.get('recordId')}")
            label_cells = [cell for cell in row_cells if cell.get("recordType") == "ROW_LABEL_CELL"]
            label = None
            if len(label_cells) == 1 and label_cells[0].get("status") == "SOURCE_CELL_STRUCTURALLY_RESOLVED":
                label = label_cells[0]
                label_text = _exact_span(label.get("sourceSpan"), zones_by_id)
                if label_text != str(label.get("text", "")) or label_text != str(label.get("rowLabelText", "")):
                    raise ValueError(f"row label source mismatch: {label.get('recordId')}")

            qualified: list[dict[str, Any]] = []
            failure_reasons: list[str] = []
            seen_vector_cells: set[str] = set()
            seen_word_indices: set[int] = set()
            for cell in value_cells:
                if cell.get("status") != "SOURCE_CELL_STRUCTURALLY_RESOLVED" or cell.get("headerStatus") != "RESOLVED" or not cell.get("text"):
                    failure_reasons.append("SOURCE_CELL_OR_HEADER_NOT_RESOLVED")
                    continue
                path = cell.get("resolvedHeaderPath", [])
                if not path:
                    failure_reasons.append("HEADER_PATH_MISSING")
                    continue
                try:
                    for header in path:
                        if header.get("status") != "RESOLVED":
                            raise ValueError("HEADER_PATH_NOT_RESOLVED")
                        header_text = _exact_span(header.get("sourceSpan"), zones_by_id)
                        if header_text != str(header.get("text", "")):
                            raise ValueError("HEADER_SPAN_MISMATCH")
                    record = evidence_by_id.get(str(cell["recordId"]))
                    if record is None:
                        raise ValueError("PDF_VALUE_EVIDENCE_MISSING")
                    resolved = _check_cell_pdf_evidence(
                        cell=cell, evidence_record=record, table_geometry=table_geometry, zones_by_id=zones_by_id,
                    )
                    column_start = resolved.get("pdfVectorColumnStart")
                    column_end = resolved.get("pdfVectorColumnEnd")
                    if column_start is None or column_end is None or int(column_start) != int(column_end):
                        raise ValueError("PDF_DATA_CELL_COLUMN_NOT_UNIQUE")
                    for header in path:
                        if int(column_start) not in [int(column) for column in header.get("physicalColumns", [])]:
                            raise ValueError("HEADER_DOES_NOT_BIND_TO_PDF_DATA_COLUMN")
                    vector_id = str(resolved["pdfVectorCellId"])
                    word_index = int(resolved["pdfWordIndex"])
                    if vector_id in seen_vector_cells or word_index in seen_word_indices:
                        raise ValueError("DUPLICATE_CELL_OR_WORD_BINDING")
                    seen_vector_cells.add(vector_id)
                    seen_word_indices.add(word_index)
                    evidence_status_counts[str(resolved["status"])] += 1
                    qualified.append({
                        "recordId": str(cell["recordId"]),
                        "sourceCell": int(cell["sourceCell"]),
                        "gridColumn": int(cell["gridColumn"]),
                        "physicalColumn": int(column_start),
                        "rawOcrText": str(cell["text"]),
                        "rawOcrSourceSpan": cell["sourceSpan"],
                        "headerPath": [str(header["text"]) for header in path],
                        "headerVectorCellIds": [header.get("pdfVectorCellId") for header in path],
                        **resolved,
                    })
                except (KeyError, TypeError, ValueError) as error:
                    reason = str(error) or "CELL_EVIDENCE_INVALID"
                    failure_reasons.append(reason)
                    if str(cell.get("recordId")) in correction_cell_ids:
                        excluded_corrections.append({"recordId": str(cell["recordId"]), "reason": reason})
                        excluded_correction_reasons[reason] += 1

            complete = (
                label is not None
                and len(qualified) == len(value_cells)
                and len(seen_vector_cells) == len(value_cells)
                and len(seen_word_indices) == len(value_cells)
            )
            if complete:
                complete_corrected_rows += 1
                row_zone_span = row.get("rowSourceSpan") or {}
                if (
                    row_zone_span.get("rangeId") != row_zone.get("rangeId")
                    or row_zone_span.get("zoneId") != row_zone.get("id")
                    or int(row_zone_span.get("start", -1)) != int(row_zone["sourceStart"])
                    or int(row_zone_span.get("end", -1)) != int(row_zone["sourceEnd"])
                    or row_zone_span.get("zoneTextSha256") != _sha_text(str(row_zone["text"]))
                ):
                    raise ValueError(f"row source-zone provenance mismatch: {row.get('recordId')}")
                value_tokens = []
                for cell_record in qualified:
                    headers = " / ".join(cell_record["headerPath"])
                    value_tokens.append(
                        f"c{cell_record['physicalColumn']}[{_json_quote(headers)}]="
                        f"{_json_quote(cell_record['pdfText'])}"
                    )
                label_text = str(label["text"])
                value_line = " | ".join(value_tokens)
                block_text = (
                    "## PDF-derived full-row numeric view (source values only; semantics NOT_ASSESSED)\n"
                    f"table={table_id}; document={table['documentId']}; PDF page={int(table['page']) + 1}; row={source_row}\n"
                    f"row label (unchanged Paddle source)={_json_quote(label_text)}\n"
                    "## Source row cells (full header paths and PDF text; semantics NOT_ASSESSED)\n"
                    + f"row={_json_quote(label_text)}|{value_line}"
                    + "\n"
                )
                blocks.append({
                    "blockId": f"pdf-derived-row:{table_id}:r{source_row}",
                    "kind": "COMPLETE_AFFECTED_SOURCE_ROW",
                    "tableId": table_id,
                    "documentId": str(table["documentId"]),
                    "pageIndex": int(table["page"]),
                    "sourceRow": source_row,
                    "sourceRowRecordId": str(row["recordId"]),
                    "sourceRowSpan": row_zone_span,
                    "rowLabelText": label_text,
                    "rowLabelSourceSpan": label["sourceSpan"],
                    "sourcePdfSha256": table_geometry["sourcePdfSha256"],
                    "cells": qualified,
                    "correctionCellCount": sum(item["replacementRequired"] for item in qualified),
                    "rawSourceRowIsUnchanged": True,
                    "origin": "ORIGINAL_PDF_VECTOR_CELLS_AND_NUMERIC_TEXT_LAYER",
                    "semanticStatus": "NOT_ASSESSED",
                    "graphAdmission": "NONE",
                    "text": block_text,
                })
            else:
                # Keep exact cell corrections in view, but never imply a complete row
                # when any sibling lacks clean PDF cell evidence or header binding.
                by_id = {str(item["recordId"]): item for item in qualified}
                for record_id in correction_cell_ids:
                    item = by_id.get(record_id)
                    if item is None:
                        continue
                    label_text = str(label["text"]) if label is not None else "UNRESOLVED_SOURCE_ROW_LABEL"
                    text = (
                        "## PDF-derived qualified cell only (other row fields withheld; semantics NOT_ASSESSED)\n"
                        f"table={table_id}; document={table['documentId']}; PDF page={int(table['page']) + 1}; row={source_row}; "
                        f"label={_json_quote(label_text)}; c{item['physicalColumn']} header="
                        f"{_json_quote(' / '.join(item['headerPath']))}; PDF text={_json_quote(item['pdfText'])}; "
                        f"raw OCR={_json_quote(item['rawOcrText'])}\n"
                    )
                    partial_cells.append({
                        "blockId": f"pdf-derived-cell:{record_id}",
                        "kind": "QUALIFIED_CELL_ONLY",
                        "tableId": table_id,
                        "documentId": str(table["documentId"]),
                        "pageIndex": int(table["page"]),
                        "sourceRow": source_row,
                        "sourceCellRecordId": record_id,
                        "sourceRowRecordId": str(row["recordId"]),
                        "sourceRowSpan": row.get("rowSourceSpan"),
                        "rowLabelText": label_text,
                        "sourcePdfSha256": table_geometry["sourcePdfSha256"],
                        "cell": item,
                        "incompleteRowReasons": sorted(set(failure_reasons)) or ["ROW_NOT_COMPLETE"],
                        "origin": "ORIGINAL_PDF_VECTOR_CELL_AND_NUMERIC_TEXT_LAYER",
                        "semanticStatus": "NOT_ASSESSED",
                        "graphAdmission": "NONE",
                        "text": text,
                    })

    all_blocks = sorted(header_maps, key=lambda item: item["blockId"]) + sorted(blocks, key=lambda item: item["blockId"]) + sorted(partial_cells, key=lambda item: item["blockId"])
    overlay_text = "\n".join(block["text"].rstrip("\n") for block in all_blocks)
    if overlay_text:
        overlay_text += "\n"
    return {
        "schema": "hyper-held-cell-source-derived-overlay-v1",
        "profile": "pdf-vector-header-and-numeric-text-layer-row-body-boundary-v2",
        "text": overlay_text,
        "textSha256": _sha_text(overlay_text),
        "headerMaps": header_maps,
        "completeRowBlocks": blocks,
        "qualifiedCellOnlyBlocks": partial_cells,
        "excludedCorrectionDiagnostics": excluded_corrections,
        "blocks": all_blocks,
        "summary": {
            "tableHeaderMaps": len(header_maps),
            "headerBindings": sum(len(item["bindings"]) for item in header_maps),
            "completeCorrectedRows": complete_corrected_rows,
            "pdfSourceCorrectionCells": corrected_cells,
            "completeRowCorrectedCells": sum(int(block["correctionCellCount"]) for block in blocks),
            "partialCorrectionCells": len(partial_cells),
            "excludedCorrectionCells": len(excluded_corrections),
            "excludedCorrectionReasonCounts": dict(sorted(excluded_correction_reasons.items())),
            "sourceTextLayerEvidenceStatusCounts": dict(sorted(evidence_status_counts.items())),
            "semantics": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "rawOcrCellsChanged": False,
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
        },
    }


def build_native_input(
    baseline_input: dict[str, Any],
    overlay: dict[str, Any],
    freeze_refs: dict[str, str],
) -> dict[str, Any]:
    arms = [dict(arm) for arm in baseline_input.get("arms", [])]
    by_parser = {str(arm.get("parser")): arm for arm in arms}
    if set(by_parser) != {"plain", "table"}:
        raise ValueError("Frozen native baseline must contain exactly plain and table arms")
    prefix_end = int(by_parser["table"]["ranges"][0]["start"])
    control_prefix = str(by_parser["table"]["content"][:prefix_end])
    if str(by_parser["plain"]["content"][:prefix_end]) != control_prefix:
        raise ValueError("Baseline arms do not share the exact frozen control prefix")
    for arm in arms:
        content = str(arm["content"])
        if _sha_text(content) != arm.get("contentSha256"):
            raise ValueError(f"Baseline content hash mismatch: {arm['parser']}")
        for source_range in arm.get("ranges", []):
            start, end = int(source_range["start"]), int(source_range["end"])
            if end <= start or end > len(content) or _sha_text(content[start:end]) != source_range.get("textSha256"):
                raise ValueError(f"Baseline range mismatch: {arm['parser']}/{source_range.get('id')}")
        for source_range in arm.get("ranges", []):
            source_range.setdefault("doc", str(source_range.get("id", "")))

    table_arm = by_parser["table"]
    original_content = str(table_arm["content"])
    overlay_text = str(overlay["text"])
    separator = "\n" if overlay_text and original_content and not original_content.endswith("\n") else ""
    content = original_content + separator + overlay_text
    ranges = [dict(source_range) for source_range in table_arm.get("ranges", [])]
    cursor = len(original_content) + len(separator)
    for block in overlay.get("blocks", []):
        text = str(block["text"]).rstrip("\n")
        start, end = cursor, cursor + len(text)
        if not text or content[start:end] != text:
            raise ValueError(f"Overlay range text mismatch: {block['blockId']}")
        ranges.append({
            "id": str(block["blockId"]),
            "doc": str(block["documentId"]),
            "zoneKind": str(block["kind"]),
            "start": start,
            "end": end,
            "textSha256": _sha_text(text),
            "origin": str(block["origin"]),
            "sourcePdfSha256": str(block["sourcePdfSha256"]),
            "sourceRowRecordId": block.get("sourceRowRecordId"),
            "sourceCellRecordIds": [cell["recordId"] for cell in block.get("cells", [])]
                if block.get("kind") == "COMPLETE_AFFECTED_SOURCE_ROW"
                else [block["sourceCellRecordId"]] if block.get("sourceCellRecordId") else [],
            "sourcePdfVectorCellIds": sorted({
                str(cell["pdfVectorCellId"])
                for cell in (block.get("cells", []) if block.get("kind") == "COMPLETE_AFFECTED_SOURCE_ROW" else [block.get("cell", {})])
                if cell.get("pdfVectorCellId")
            }),
            "sourcePdfWordIndices": sorted({
                int(cell["pdfWordIndex"])
                for cell in (block.get("cells", []) if block.get("kind") == "COMPLETE_AFFECTED_SOURCE_ROW" else [block.get("cell", {})])
                if cell.get("pdfWordIndex") is not None
            }),
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
        })
        cursor = end + 1
    if cursor != len(content):
        raise ValueError("Overlay text and generated ranges do not cover the appended content")
    for source_range in ranges:
        start, end = int(source_range["start"]), int(source_range["end"])
        if start < prefix_end or end <= start or end > len(content):
            raise ValueError(f"Invalid native input range: {source_range.get('id')}")
        if _sha_text(content[start:end]) != source_range["textSha256"]:
            raise ValueError(f"Native input range hash mismatch: {source_range.get('id')}")

    treatment = {
        "parser": "source-pdf-repair-v1",
        "content": content,
        "ranges": ranges,
        "packets": [dict(packet) for packet in table_arm.get("packets", [])],
        "contentSha256": _sha_text(content),
        "sourceRepair": {
            "profile": str(overlay["profile"]),
            "projectionFreezeSha256": freeze_refs["projectionFreezeSha256"],
            "projectionSha256": freeze_refs["projectionSha256"],
            "overlaySha256": str(overlay["textSha256"]),
            "overlayChars": len(overlay_text),
            "baselineTableContentSha256": _sha_text(original_content),
            "baselineContentPreservedExactlyAsPrefix": content.startswith(original_content),
            "sourceTextLayerCorrectionCells": int(overlay["summary"]["pdfSourceCorrectionCells"]),
            "completeCorrectedRowBlocks": int(overlay["summary"]["completeCorrectedRows"]),
            "qualifiedCellOnlyBlocks": len(overlay["qualifiedCellOnlyBlocks"]),
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "candidateGraphIncluded": False,
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
        },
    }
    return {
        "schema": "zuri.hyper-held-cell-native-input.v1",
        "profile": "frozen-table-baseline-plus-source-pdf-repair-overlay",
        "controlFileSha256": baseline_input["controlFileSha256"],
        "arms": [*arms, treatment],
        "candidateSidecarIncluded": False,
        "sourceRepairProjection": treatment["sourceRepair"],
    }


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    input_paths = {
        "baselineNativeInput": BASELINE_PATH,
        "sourceNativeFreeze": HELD_FREEZE_PATH,
        "sourceNativeEnumeration": ENUM_PATH,
        "pdfValueFreeze": VALUE_FREEZE_PATH,
        "pdfValueEvidence": VALUE_EVIDENCE_PATH,
        "pdfVectorGeometry": GEOMETRY_PATH,
        "sourceBundle": BUNDLE_PATH,
    }
    input_hashes = {name: _sha(path.read_bytes()) for name, path in input_paths.items()}
    held_freeze = _load_json(HELD_FREEZE_PATH)
    enumeration = _load_json(ENUM_PATH)
    value_freeze = _load_json(VALUE_FREEZE_PATH)
    evidence = _load_json(VALUE_EVIDENCE_PATH)
    geometry = _load_json(GEOMETRY_PATH)
    bundle = _load_json(BUNDLE_PATH)
    baseline = _load_json(BASELINE_PATH)
    if enumeration.get("freezeSha256") != input_hashes["sourceNativeFreeze"]:
        raise SystemExit("All-cell enumeration is not bound to its freeze")
    if value_freeze.get("inputSha256", {}).get("sourceNativeFreeze") != input_hashes["sourceNativeFreeze"]:
        raise SystemExit("PDF value freeze does not bind source-native freeze")
    if value_freeze.get("inputSha256", {}).get("sourceNativeEnumeration") != input_hashes["sourceNativeEnumeration"]:
        raise SystemExit("PDF value freeze does not bind all-cell enumeration")
    if value_freeze.get("inputSha256", {}).get("pdfVectorGeometry") != input_hashes["pdfVectorGeometry"]:
        raise SystemExit("PDF value freeze does not bind geometry/text-layer artifact")
    if evidence.get("freezeSha256") != input_hashes["pdfValueFreeze"]:
        raise SystemExit("PDF value evidence is not bound to its freeze")
    if held_freeze.get("inputSha256", {}).get("sourceBundle") != input_hashes["sourceBundle"]:
        raise SystemExit("All-cell freeze does not bind source bundle")
    overlay = build_repair_overlay(enumeration, bundle, evidence, geometry)
    overlay["inputSha256"] = input_hashes
    overlay["implementationSha256"] = {
        name: _sha((REPORT / name).read_bytes())
        for name in (
            "build_held_cell_projection.py",
            "held_cell_repair.py",
            "test_held_cell_projection.py",
            "test_pdf_cell_value_corrections.py",
            "native_chunk_boundary_probe.mjs",
        )
    }
    PROJECTION_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROJECTION_PATH.write_text(json.dumps(overlay, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    projection_sha = _sha(PROJECTION_PATH.read_bytes())
    projection_freeze = {
        "schema": "hyper-held-cell-repair-projection-freeze-v2",
        "status": "FROZEN_BEFORE_QA_OR_SCORING",
        "profile": overlay["profile"],
        "inputPaths": {name: str(path.relative_to(ROOT)).replace("\\", "/") for name, path in input_paths.items()},
        "inputSha256": input_hashes,
        "implementationSha256": overlay["implementationSha256"],
        "projectionSha256": projection_sha,
        "policy": {
            "population": "All 972 re-enumerated cells are scanned. Full affected-row blocks require every nonempty value cell to have a unique exact PDF numeric token, cell box and resolved source header path.",
            "partialRows": "When a corrected cell has unique source evidence but its row is incomplete, only that qualified cell is emitted and sibling fields are explicitly withheld.",
            "rawSource": "Frozen table-baseline content is copied byte-for-byte as the treatment prefix; raw Paddle OCR text/source spans are never overwritten.",
            "pdfDerivedValues": "Only exact numeric-syntax PDF text-layer tokens bound to original-PDF vector cells and Paddle cell boxes are used. Each derived block carries source PDF, vector cell, PDF word and raw OCR provenance.",
            "headerBindings": "Exact Paddle header labels are mapped to independently detected original-PDF vector cells. Header literals and raw parser spans remain unchanged; mappings are structural references only.",
            "rowBodyBoundary": "The exact complete cell-value line retains all header paths, PDF values and raw-OCR qualifiers byte-for-byte; its own text section keeps framing metadata outside the native chunk budget.",
            "candidateInputs": "No Hyper candidate IDs or per-cell audit labels select values, rows or projection fields.",
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
        },
        "summary": overlay["summary"],
    }
    PROJECTION_FREEZE_PATH.write_text(json.dumps(projection_freeze, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    projection_freeze_sha = _sha(PROJECTION_FREEZE_PATH.read_bytes())

    native = build_native_input(
        baseline,
        overlay,
        {"projectionFreezeSha256": projection_freeze_sha, "projectionSha256": projection_sha},
    )
    NATIVE_INPUT_PATH.write_text(json.dumps(native, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    native_freeze = {
        "schema": "hyper-held-cell-native-input-freeze-v2",
        "status": "FROZEN_BEFORE_QA_OR_SCORING",
        "profile": native["profile"],
        "inputSha256": {
            **input_hashes,
            "repairProjection": projection_sha,
            "repairProjectionFreeze": projection_freeze_sha,
        },
        "nativeInputSha256": _sha(NATIVE_INPUT_PATH.read_bytes()),
        "implementationSha256": {
            "builder": _sha(Path(__file__).read_bytes()),
            "projectionTests": _sha((REPORT / "test_held_cell_projection.py").read_bytes()),
            "nativeChunkBoundaryProbe": _sha((REPORT / "native_chunk_boundary_probe.mjs").read_bytes()),
        },
        "arms": [
            {"parser": arm["parser"], "contentSha256": arm["contentSha256"], "contentChars": len(arm["content"]), "rangeCount": len(arm["ranges"])}
            for arm in native["arms"]
        ],
        "policy": {
            "tableBaselineContentUnchanged": True,
            "treatmentBeginsWithExactBaselineTableContent": True,
            "allBaselineArmsRetained": True,
            "candidateOutputOrGraphUsed": False,
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
        },
        "runtime": {"python": sys.version.split()[0]},
    }
    NATIVE_FREEZE_PATH.write_text(json.dumps(native_freeze, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "projectionSha256": projection_sha,
        "projectionFreezeSha256": projection_freeze_sha,
        "nativeInputSha256": native_freeze["nativeInputSha256"],
        "nativeFreezeSha256": _sha(NATIVE_FREEZE_PATH.read_bytes()),
        "summary": overlay["summary"],
        "arms": native_freeze["arms"],
        "qaOrQuestionsUsed": False,
        "modelCalls": 0,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
