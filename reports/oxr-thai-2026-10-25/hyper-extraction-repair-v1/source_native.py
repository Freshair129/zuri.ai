"""Deterministic source-cell enumeration for the frozen Thai OCR corpus.

This module binds exact Paddle table-parser cell text to the separate frozen
table OCR boxes. It does not consult Hyper candidate IDs, QA, or audit labels,
and it does not normalize or correct source text. A resolved cell is only a
structural/lexical candidate; semanticStatus always remains NOT_ASSESSED.
"""

from __future__ import annotations

import statistics
import unicodedata
from collections import defaultdict
import hashlib
from typing import Any


def _center(box: list[float], axis: str) -> float:
    if axis == "x":
        return (box[0] + box[2]) / 2
    return (box[1] + box[3]) / 2


def _valid_box(box: Any, width: int, height: int) -> bool:
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return False
    try:
        x1, y1, x2, y2 = (float(x) for x in box)
    except (TypeError, ValueError):
        return False
    return 0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height


def _x_overlap_ratio(a: list[float], b: list[float]) -> float:
    overlap = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    denom = min(a[2] - a[0], b[2] - b[0])
    return overlap / denom if denom > 0 else 0.0


def _y_overlap_ratio(a: list[float], b: list[float]) -> float:
    overlap = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    denom = min(a[3] - a[1], b[3] - b[1])
    return overlap / denom if denom > 0 else 0.0


def _has_letter(text: str) -> bool:
    return any(unicodedata.category(ch).startswith("L") for ch in text)


def _sha_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def infer_label_column(rows: list[list[dict[str, Any]]]) -> dict[str, Any]:
    """Infer a stable textual row-label column from table shape only.

    The procedure uses Unicode letter presence and cross-row uniqueness. It
    does not inspect document names, expected entity names, values, or labels.
    """
    eligible = [[c for c in row if c.get("text")] for row in rows]
    eligible = [row for row in eligible if len(row) >= 2]
    columns = sorted({int(c["col"]) for row in eligible for c in row})
    if len(eligible) < 3 or not columns:
        return {"status": "HELD", "reason": "INSUFFICIENT_ROWS_FOR_LABEL_COLUMN"}

    scores: list[dict[str, Any]] = []
    for column in columns:
        values = [str(c["text"]) for row in eligible for c in row if int(c["col"]) == column]
        if len(values) < 3:
            continue
        letter_rate = sum(_has_letter(v) for v in values) / len(values)
        unique_rate = len(set(values)) / len(values)
        scores.append({
            "column": column,
            "observations": len(values),
            "letterRate": round(letter_rate, 6),
            "uniqueRate": round(unique_rate, 6),
            "score": round(letter_rate * unique_rate, 6),
        })
    scores.sort(key=lambda x: (-x["score"], x["column"]))
    if not scores or scores[0]["letterRate"] < 0.6 or scores[0]["uniqueRate"] < 0.8:
        return {"status": "HELD", "reason": "NO_STABLE_TEXTUAL_LABEL_COLUMN", "scores": scores}
    if len(scores) > 1 and scores[0]["score"] - scores[1]["score"] < 0.15:
        return {"status": "HELD", "reason": "LABEL_COLUMN_NOT_UNIQUE", "scores": scores}
    return {"status": "RESOLVED", "column": scores[0]["column"], "scores": scores}


def match_row_to_ocr_cells(
    *,
    cells: list[dict[str, Any]],
    rec_texts: list[str],
    rec_boxes: list[list[int | float]],
    page_width: int,
    page_height: int,
    table_bounds: list[int | float],
    label_column: int,
) -> dict[str, Any]:
    """Map one source row to a complete same-y, x-ordered OCR sequence.

    Exact repeated strings are safe only when the entire row sequence maps
    one-to-one. Partial rows, extra OCR records, and mismatched order are held.
    """
    if len(rec_texts) != len(rec_boxes):
        return {"status": "HELD", "reason": "OCR_TEXT_BOX_COUNT_MISMATCH"}
    row_cells = sorted(
        [c for c in cells if c.get("text")],
        key=lambda c: (int(c.get("col", -1)), int(c.get("cell", -1))),
    )
    if len(row_cells) < 2:
        return {"status": "HELD", "reason": "INSUFFICIENT_NONEMPTY_ROW_CELLS"}
    labels = [c for c in row_cells if int(c.get("col", -1)) == label_column]
    if len(labels) != 1:
        return {"status": "HELD", "reason": "ROW_LABEL_CELL_NOT_UNIQUE"}

    x1, y1, x2, y2 = (float(v) for v in table_bounds)
    records: list[dict[str, Any]] = []
    for index, (text, box) in enumerate(zip(rec_texts, rec_boxes)):
        if not _valid_box(box, page_width, page_height):
            continue
        normalized_box = [float(v) for v in box]
        cx = _center(normalized_box, "x")
        cy = _center(normalized_box, "y")
        if x1 <= cx <= x2 and y1 <= cy <= y2:
            records.append({"index": index, "text": str(text), "box": normalized_box})

    label_text = str(labels[0]["text"])
    anchors = [r for r in records if r["text"] == label_text]
    if not anchors:
        return {"status": "HELD", "reason": "EXACT_ROW_LABEL_OCR_BOX_MISSING"}

    source_texts = [str(c["text"]) for c in row_cells]
    matches: list[list[dict[str, Any]]] = []
    for anchor in anchors:
        same_row = [r for r in records if _y_overlap_ratio(r["box"], anchor["box"]) >= 0.5]
        same_row.sort(key=lambda r: (_center(r["box"], "x"), r["index"]))
        if [r["text"] for r in same_row] == source_texts:
            centers = [_center(r["box"], "x") for r in same_row]
            if all(a < b for a, b in zip(centers, centers[1:])):
                matches.append(same_row)
    if len(matches) != 1:
        reason = "ROW_SEQUENCE_NOT_UNIQUE" if len(matches) > 1 else "ROW_SEQUENCE_TEXT_MISMATCH"
        return {"status": "HELD", "reason": reason, "anchorCount": len(anchors)}

    bindings = []
    for cell, record in zip(row_cells, matches[0]):
        bindings.append({
            "row": int(cell["row"]),
            "cell": int(cell["cell"]),
            "column": int(cell["col"]),
            "text": str(cell["text"]),
            "recordIndex": int(record["index"]),
            "box": record["box"],
        })
    return {"status": "ROW_SEQUENCE_RESOLVED", "cellBindings": bindings}


def derive_column_boxes(row_mappings: list[dict[str, Any]]) -> dict[int, list[float]]:
    """Derive unique physical column sectors from resolved complete rows."""
    centers: dict[int, list[float]] = defaultdict(list)
    for mapping in row_mappings:
        if mapping.get("status") != "ROW_SEQUENCE_RESOLVED":
            continue
        for cell in mapping.get("cellBindings", []):
            centers[int(cell["column"])].append(_center(cell["box"], "x"))
    median_centers = {
        col: statistics.median(values)
        for col, values in centers.items()
        if len(values) >= 2
    }
    columns = sorted(median_centers)
    result: dict[int, list[float]] = {}
    for index, col in enumerate(columns):
        center = median_centers[col]
        if index > 0 and index < len(columns) - 1:
            left = (median_centers[columns[index - 1]] + center) / 2
            right = (center + median_centers[columns[index + 1]]) / 2
        elif index == 0 and len(columns) > 1:
            gap = median_centers[columns[1]] - center
            left = center - gap / 2
            right = (center + median_centers[columns[1]]) / 2
        elif len(columns) > 1:
            gap = center - median_centers[columns[index - 1]]
            left = (center + median_centers[columns[index - 1]]) / 2
            right = center + gap / 2
        else:
            continue
        result[col] = [left, right]
    return result


def resolve_header_geometry(
    *,
    header_cells: list[dict[str, Any]],
    header_records: list[dict[str, Any]],
    column_boxes: dict[int, list[int | float]],
) -> dict[str, Any]:
    """Resolve exact header records to physical columns; hold conflicts.

    Single-column header leaves may be remapped when their exact OCR box has a
    unique physical-column overlap (for example, a leading blank grid stub).
    A merged header keeps its declared grid span and is held if the text box
    conflicts with that span.
    """
    nonempty = [c for c in header_cells if c.get("text")]
    cells_by_text: dict[str, list[dict[str, Any]]] = defaultdict(list)
    records_by_text: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for cell in nonempty:
        cells_by_text[str(cell["text"])].append(cell)
    for record in header_records:
        if record.get("text"):
            records_by_text[str(record["text"])].append(record)

    paired: dict[tuple[int, int], dict[str, Any]] = {}
    for text, cells in cells_by_text.items():
        records = records_by_text.get(text, [])
        cells_sorted = sorted(cells, key=lambda c: (int(c["row"]), int(c["col"]), int(c["cell"])))
        if len({int(c["row"]) for c in cells_sorted}) == 1:
            # OCR row glyph heights can vary by a few pixels; within one source
            # header row, physical x-order is the stable disambiguator.
            records_sorted = sorted(records, key=lambda r: (_center([float(v) for v in r["box"]], "x"), _center([float(v) for v in r["box"]], "y"), int(r.get("index", -1))))
        else:
            records_sorted = sorted(records, key=lambda r: (_center([float(v) for v in r["box"]], "y"), _center([float(v) for v in r["box"]], "x"), int(r.get("index", -1))))
        if len(cells_sorted) != len(records_sorted):
            for cell in cells_sorted:
                paired[(int(cell["row"]), int(cell["cell"]))] = {
                    "status": "HELD",
                    "reason": "HEADER_RECORD_COUNT_MISMATCH",
                    "text": text,
                    "gridColumns": list(range(int(cell["col"]), int(cell.get("colEnd", cell["col"])) + 1)),
                    "physicalColumns": [],
                    "row": int(cell["row"]),
                    "cell": int(cell["cell"]),
                }
            continue
        for cell, record in zip(cells_sorted, records_sorted):
            box = [float(v) for v in record["box"]]
            grid_start = int(cell["col"])
            grid_end = int(cell.get("colEnd", grid_start))
            grid_columns = list(range(grid_start, grid_end + 1))
            result = {
                "status": "HELD",
                "reason": "NO_PHYSICAL_COLUMN_ALIGNMENT",
                "text": text,
                "row": int(cell["row"]),
                "cell": int(cell["cell"]),
                "recordIndex": int(record.get("index", -1)),
                "box": box,
                "gridColumns": grid_columns,
                "physicalColumns": [],
            }
            if grid_end > grid_start:
                intervals = [column_boxes[c] for c in grid_columns if c in column_boxes]
                if len(intervals) != len(grid_columns):
                    result["reason"] = "HEADER_GRID_SPAN_HAS_NO_COLUMN_GEOMETRY"
                else:
                    left = min(float(b[0]) for b in intervals)
                    right = max(float(b[1]) for b in intervals)
                    width = box[2] - box[0]
                    overlap = max(0.0, min(box[2], right) - max(box[0], left))
                    ratio = overlap / width if width > 0 else 0.0
                    if not (left <= _center(box, "x") <= right):
                        result["reason"] = "HEADER_GEOMETRY_CONFLICT"
                    elif ratio < 0.6:
                        result["reason"] = "HEADER_GEOMETRY_AMBIGUOUS"
                    else:
                        result.update({"status": "RESOLVED", "reason": None, "physicalColumns": grid_columns})
            else:
                overlaps = []
                for col, interval in column_boxes.items():
                    column_box = [float(interval[0]), box[1], float(interval[1]), box[3]]
                    ratio = _x_overlap_ratio(box, column_box)
                    if ratio >= 0.55:
                        overlaps.append(int(col))
                if len(overlaps) > 1:
                    result["reason"] = "HEADER_GEOMETRY_AMBIGUOUS"
                elif len(overlaps) == 1:
                    physical_col = overlaps[0]
                    result.update({
                        "status": "RESOLVED",
                        "reason": None,
                        "physicalColumns": [physical_col],
                        "gridOffsetRemapped": physical_col != grid_start,
                    })
                else:
                    result["reason"] = "HEADER_HAS_NO_UNIQUE_PHYSICAL_COLUMN_OVERLAP"
            paired[(int(cell["row"]), int(cell["cell"]))] = result

    # A within-row order inversion is a separate structural conflict. Compare
    # only records in a common visual band whose y tolerance scales with OCR
    # glyph/row height. Mark only cells participating in an inversion.
    for row in sorted({int(c["row"]) for c in nonempty}):
        row_cells = sorted([c for c in nonempty if int(c["row"]) == row], key=lambda c: (int(c["col"]), int(c["cell"])))
        mapped = [paired.get((row, int(c["cell"]))) for c in row_cells]
        heights = [
            float(m["box"][3]) - float(m["box"][1])
            for m in mapped if m and m.get("box")
        ]
        y_band_tolerance = max(8.0, 1.5 * statistics.median(heights)) if heights else 8.0
        for i in range(len(row_cells)):
            for j in range(i + 1, len(row_cells)):
                a, b = mapped[i], mapped[j]
                if not a or not b or not a.get("box") or not b.get("box"):
                    continue
                if abs(_center(a["box"], "y") - _center(b["box"], "y")) > y_band_tolerance:
                    continue
                ax = _center(a["box"], "x")
                bx = _center(b["box"], "x")
                if ax > bx:
                    # Text boxes that substantially overlap do not establish a
                    # reliable left-to-right source order (e.g. a title over a
                    # merged attribution cell). Do not turn that into a false
                    # column-order conflict.
                    overlap = max(0.0, min(a["box"][2], b["box"][2]) - max(a["box"][0], b["box"][0]))
                    smaller = min(a["box"][2] - a["box"][0], b["box"][2] - b["box"][0])
                    if smaller > 0 and overlap / smaller >= 0.2:
                        continue
                    for item in (a, b):
                        item["status"] = "HELD"
                        item["reason"] = "HEADER_SOURCE_ORDER_PHYSICAL_ORDER_CONFLICT"

    # A solitary unmerged cell in an upper header row does not establish a
    # value-column association when a lower header level explicitly divides
    # the table into multiple value columns. Keep its literal geometry for
    # audit, but treat it as table context until a source span declares which
    # lower columns it covers.
    header_rows = sorted({int(c["row"]) for c in nonempty})
    for row in header_rows:
        row_cells = [c for c in nonempty if int(c["row"]) == row]
        if len(row_cells) != 1:
            continue
        cell = row_cells[0]
        grid_start = int(cell["col"])
        grid_end = int(cell.get("colEnd", grid_start))
        if grid_start != grid_end:
            continue
        lower_columns: set[int] = set()
        for lower_row in (r for r in header_rows if r > row):
            lower_cells = [c for c in nonempty if int(c["row"]) == lower_row]
            if len(lower_cells) < 2:
                continue
            for lower_cell in lower_cells:
                binding = paired.get((lower_row, int(lower_cell["cell"])), {})
                if binding.get("status") == "RESOLVED":
                    lower_columns.update(int(c) for c in binding.get("physicalColumns", []))
        binding = paired.get((row, int(cell["cell"])))
        if len(lower_columns) > 1 and binding and binding.get("status") == "RESOLVED":
            binding["status"] = "CONTEXT_ONLY"
            binding["reason"] = "SINGLETON_HEADER_WITHOUT_DECLARED_SPAN"
        
    return {"bindings": [paired[(int(c["row"]), int(c["cell"]))] for c in nonempty], "columnBoxes": column_boxes}


def header_path_for_column(column: int, header_bindings: list[dict[str, Any]]) -> dict[str, Any]:
    conflicts = [
        h for h in header_bindings
        if h.get("status") not in {"RESOLVED", "CONTEXT_ONLY"}
        and (column in h.get("gridColumns", []) or column in h.get("physicalColumns", []))
    ]
    if conflicts:
        return {"status": "HELD", "reason": "HEADER_PATH_CONFLICT", "conflicts": conflicts}
    path = [h for h in header_bindings if h.get("status") == "RESOLVED" and column in h.get("physicalColumns", [])]
    path.sort(key=lambda h: (int(h["row"]), int(h["cell"])))
    if not path:
        return {"status": "HELD", "reason": "NO_RESOLVED_HEADER_PATH", "headers": []}
    rows = [int(h["row"]) for h in path]
    if len(rows) != len(set(rows)):
        return {"status": "HELD", "reason": "MULTIPLE_HEADERS_FOR_SAME_ROW", "headers": path}
    # A title/attribution row can span many cells while sitting several
    # structural rows above the actual measure headers. Keep only the deepest
    # mapped header and at most two parent rows above it.
    deepest_row = max(rows)
    local_path = [h for h in path if deepest_row - int(h["row"]) <= 2]
    return {
        "status": "RESOLVED",
        "headers": local_path,
        "excludedDistantContextHeaderCount": len(path) - len(local_path),
    }


def _source_cell_span(
    *,
    packet: dict[str, Any],
    zone: dict[str, Any],
    kind: str,
    row: int,
    cell: int,
    expected: str,
) -> dict[str, Any] | None:
    matches = [
        s for s in packet.get("sourceSpans", [])
        if s.get("kind") == kind and int(s.get("row", -1)) == row and int(s.get("cell", -1)) == cell
    ]
    if len(matches) != 1:
        return None
    span = matches[0]
    start, end = int(span["start"]), int(span["end"])
    if packet["text"][start:end] != expected:
        return None
    packet_offset = zone["text"].find(packet["text"])
    if packet_offset < 0 or zone["text"].find(packet["text"], packet_offset + 1) >= 0:
        return None
    zone_start, zone_end = packet_offset + start, packet_offset + end
    if zone["text"][zone_start:zone_end] != expected:
        return None
    return {
        "rangeId": zone["rangeId"],
        "zoneId": zone["id"],
        "start": int(zone["sourceStart"]) + zone_start,
        "end": int(zone["sourceStart"]) + zone_end,
        "zoneStart": zone_start,
        "zoneEnd": zone_end,
        "quote": expected,
    }


def _stable_record_id(doc: str, table_id: str, page: int, row: int, cell: int, text: str) -> str:
    # Coordinates are the identity; the text is included in the suffix only to
    # make a changed frozen source cell visibly produce a different identifier.
    token = _sha_text(text)[:10]
    return f"src-cell:{doc}:p{page}:{table_id}:r{row}:c{cell}:{token}"


def _median_cell_column_boxes(row_mappings: list[dict[str, Any]]) -> dict[int, list[float]]:
    return derive_column_boxes(row_mappings)


def enumerate_table(
    *,
    table: dict[str, Any],
    table_ocr: dict[str, Any],
    cell_boxes: list[list[int | float]],
    page_width: int,
    page_height: int,
    zones_by_row: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    """Enumerate every packet/cell in one frozen table without candidate input."""
    rec_texts = [str(x) for x in table_ocr.get("rec_texts", [])]
    rec_boxes = table_ocr.get("rec_boxes", [])
    if len(rec_texts) != len(rec_boxes):
        raise ValueError(f"OCR text/box mismatch for {table['id']}")
    if not cell_boxes:
        raise ValueError(f"Missing cell geometry for {table['id']}")
    valid_table_boxes = [b for b in cell_boxes if _valid_box(b, page_width, page_height)]
    if not valid_table_boxes:
        raise ValueError(f"No valid table bounds for {table['id']}")
    bounds = [
        min(float(b[0]) for b in valid_table_boxes),
        min(float(b[1]) for b in valid_table_boxes),
        max(float(b[2]) for b in valid_table_boxes),
        max(float(b[3]) for b in valid_table_boxes),
    ]

    packets = table.get("packets", [])
    rows_for_label = []
    cells_by_row: dict[int, list[dict[str, Any]]] = {}
    for packet in packets:
        row_index = int(packet["row"])
        if row_index < int(table["headerRowCount"]):
            continue
        cells = [c for c in table["cells"] if int(c["row"]) == row_index]
        cells_by_row[row_index] = cells
        rows_for_label.append(cells)
    label_result = infer_label_column(rows_for_label)

    row_mappings: dict[int, dict[str, Any]] = {}
    for row_index, cells in cells_by_row.items():
        if label_result["status"] != "RESOLVED":
            row_mappings[row_index] = {"status": "HELD", "reason": "LABEL_COLUMN_NOT_RESOLVED"}
        else:
            row_mappings[row_index] = match_row_to_ocr_cells(
                cells=cells,
                rec_texts=rec_texts,
                rec_boxes=rec_boxes,
                page_width=page_width,
                page_height=page_height,
                table_bounds=bounds,
                label_column=int(label_result["column"]),
            )
    column_boxes = _median_cell_column_boxes(list(row_mappings.values()))

    first_body_y = min(
        (_center([float(v) for v in x["box"]], "y") for mapping in row_mappings.values() for x in mapping.get("cellBindings", [])),
        default=float(page_height),
    )
    header_cells = [c for c in table["cells"] if int(c["row"]) < int(table["headerRowCount"]) and c.get("text")]
    header_records = [
        {"index": i, "text": text, "box": box}
        for i, (text, box) in enumerate(zip(rec_texts, rec_boxes))
        if _valid_box(box, page_width, page_height) and _center([float(v) for v in box], "y") < first_body_y
        and text in {str(c["text"]) for c in header_cells}
    ]
    header_geometry = resolve_header_geometry(
        header_cells=header_cells,
        header_records=header_records,
        column_boxes=column_boxes,
    )
    header_bindings = header_geometry["bindings"]
    headers_by_key = {(int(h["row"]), int(h["cell"])): h for h in header_bindings}

    packet_by_row = {int(p["row"]): p for p in packets}
    source_rows: list[dict[str, Any]] = []
    source_cells: list[dict[str, Any]] = []
    for row_index in sorted(cells_by_row):
        packet = packet_by_row[row_index]
        zone = zones_by_row.get(row_index)
        mapping = row_mappings[row_index]
        cell_by_key = {(int(c["row"]), int(c["cell"])): c for c in cells_by_row[row_index]}
        raw_binding_by_key = {
            (int(b["row"]), int(b["cell"])): b
            for b in mapping.get("cellBindings", [])
        }
        label_col = label_result.get("column") if label_result.get("status") == "RESOLVED" else None
        label_cell = next((c for c in cells_by_row[row_index] if label_col is not None and int(c["col"]) == int(label_col) and c.get("text")), None)
        label_text = str(label_cell["text"]) if label_cell else None
        label_span = _source_cell_span(
            packet=packet,
            zone=zone,
            kind="data",
            row=row_index,
            cell=int(label_cell["cell"]),
            expected=label_text,
        ) if zone and label_cell else None

        row_cell_records = []
        for cell in sorted([c for c in cells_by_row[row_index] if c.get("text")], key=lambda c: (int(c["col"]), int(c["cell"]))):
            key = (row_index, int(cell["cell"]))
            span = _source_cell_span(
                packet=packet,
                zone=zone,
                kind="data",
                row=row_index,
                cell=int(cell["cell"]),
                expected=str(cell["text"]),
            ) if zone else None
            ocr_binding = raw_binding_by_key.get(key)
            path = header_path_for_column(int(cell["col"]), header_bindings)
            is_label = label_col is not None and int(cell["col"]) == int(label_col)
            resolved_header_path = []
            reasons = []
            if mapping.get("status") != "ROW_SEQUENCE_RESOLVED":
                reasons.append(mapping.get("reason", "ROW_SEQUENCE_NOT_RESOLVED"))
            if not span:
                reasons.append("SOURCE_CELL_SPAN_MISSING_OR_MISMATCH")
            if not is_label and not label_span:
                reasons.append("SOURCE_ROW_LABEL_SPAN_MISSING_OR_MISMATCH")
            if not ocr_binding:
                reasons.append("SOURCE_CELL_OCR_BINDING_MISSING")
            if not is_label and path["status"] != "RESOLVED":
                reasons.append(path.get("reason", "HEADER_PATH_NOT_RESOLVED"))
            if not is_label and path["status"] == "RESOLVED":
                for header in path.get("headers", []):
                    header_span = _source_cell_span(
                        packet=packet,
                        zone=zone,
                        kind="header",
                        row=int(header["row"]),
                        cell=int(header["cell"]),
                        expected=str(header["text"]),
                    ) if zone else None
                    if not header_span:
                        reasons.append("HEADER_SOURCE_SPAN_MISSING_OR_MISMATCH")
                        resolved_header_path = []
                        break
                    resolved_header_path.append({**header, "sourceSpan": header_span})
            status = "SOURCE_CELL_STRUCTURALLY_RESOLVED" if not reasons else "HELD"
            source_record = {
                "recordId": _stable_record_id(table["doc"], table["id"], int(table["page"]), row_index, int(cell["cell"]), str(cell["text"])),
                "origin": "SOURCE_NATIVE_TABLE_CELL",
                "recordType": "ROW_LABEL_CELL" if is_label else "TABLE_VALUE_CELL",
                "status": status,
                "semanticStatus": "NOT_ASSESSED",
                "documentId": table["doc"],
                "tableId": table["id"],
                "page": int(table["page"]),
                "sourceRow": row_index,
                "sourceCell": int(cell["cell"]),
                "gridColumn": int(cell["col"]),
                "gridColumnEnd": int(cell.get("colEnd", cell["col"])),
                "text": str(cell["text"]),
                "rowLabelText": label_text,
                "rowLabelSourceSpan": label_span,
                "sourceSpan": span,
                "ocrBox": ocr_binding.get("box") if ocr_binding else None,
                "ocrRecordIndex": ocr_binding.get("recordIndex") if ocr_binding else None,
                "resolvedHeaderPath": resolved_header_path,
                "headerStatus": path["status"] if not is_label else "ROW_LABEL_NO_HEADER_REQUIRED",
                "holdReasons": reasons,
            }
            source_cells.append(source_record)
            row_cell_records.append(source_record)

        source_rows.append({
            "recordId": f"src-row:{table['doc']}:p{table['page']}:{table['id']}:r{row_index}",
            "origin": "SOURCE_NATIVE_TABLE_ROW",
            "documentId": table["doc"],
            "tableId": table["id"],
            "page": int(table["page"]),
            "sourceRow": row_index,
            "sourceHeadingLabel": packet.get("sourceHeadingLabel"),
            "rowText": packet.get("rowText", ""),
            "rowTextSha256": _sha_text(str(packet.get("rowText", ""))),
            "rowSourceSpan": {
                "rangeId": zone.get("rangeId"),
                "zoneId": zone.get("id"),
                "start": int(zone.get("sourceStart", 0)),
                "end": int(zone.get("sourceEnd", 0)),
                "zoneTextSha256": _sha_text(str(zone.get("text", ""))),
            } if zone else None,
            "rowSequenceStatus": mapping.get("status", "HELD"),
            "rowSequenceReason": mapping.get("reason"),
            "labelColumnStatus": label_result.get("status"),
            "labelColumn": label_col,
            "labelText": label_text,
            "structurallyResolvedCellCount": sum(c["status"] == "SOURCE_CELL_STRUCTURALLY_RESOLVED" for c in row_cell_records),
            "heldCellCount": sum(c["status"] == "HELD" for c in row_cell_records),
            "semanticStatus": "NOT_ASSESSED",
        })

    return {
        "tableId": table["id"],
        "documentId": table["doc"],
        "page": int(table["page"]),
        "headerRowCount": int(table["headerRowCount"]),
        "packetCount": len(packets),
        "labelColumn": label_result,
        "columnBoxes": {str(k): v for k, v in sorted(column_boxes.items())},
        "headerBindings": header_bindings,
        "rows": source_rows,
        "cells": source_cells,
    }
