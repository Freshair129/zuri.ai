"""Conservative source/geometry binding for the frozen Hyper fact audit.

This module only establishes lexical cell identity and physical header alignment.
It does not assess whether a candidate predicate/description is semantically true.
"""

from __future__ import annotations

from typing import Any


def _valid_box(box: Any, width: int, height: int) -> bool:
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return False
    try:
        x1, y1, x2, y2 = (float(x) for x in box)
    except (TypeError, ValueError):
        return False
    return (
        0 <= x1 < x2 <= width
        and 0 <= y1 < y2 <= height
    )


def _x_overlap_ratio(a: list[float], b: list[float]) -> float:
    overlap = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    denom = min(a[2] - a[0], b[2] - b[0])
    return overlap / denom if denom > 0 else 0.0


def _y_overlap_ratio(a: list[float], b: list[float]) -> float:
    overlap = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    denom = min(a[3] - a[1], b[3] - b[1])
    return overlap / denom if denom > 0 else 0.0


def _center_x(box: list[float]) -> float:
    return (box[0] + box[2]) / 2


def _center_y(box: list[float]) -> float:
    return (box[1] + box[3]) / 2


def _reject(reason: str, **details: Any) -> dict[str, Any]:
    return {"status": "HELD", "reason": reason, **details}


def exact_source_span_in_chunk(
    *,
    source_start: int,
    source_end: int,
    expected_text: str,
    chunk_start: int,
    chunk_text: str,
    source_range_start: int,
    source_range_text: str,
) -> bool:
    """Require the selected source occurrence itself inside this exact chunk."""
    if source_end - source_start != len(expected_text):
        return False
    if source_start < chunk_start or source_end > chunk_start + len(chunk_text):
        return False
    source_a = source_start - source_range_start
    source_b = source_end - source_range_start
    chunk_a = source_start - chunk_start
    chunk_b = source_end - chunk_start
    return (
        source_range_text[source_a:source_b] == expected_text
        and chunk_text[chunk_a:chunk_b] == expected_text
    )


def resolve_geometry_binding(
    *,
    subject: str,
    value: str,
    header_quote: str,
    table_cells: list[dict[str, Any]],
    header_row_count: int,
    rec_texts: list[str],
    rec_boxes: list[list[int | float]],
    page_width: int,
    page_height: int,
    emitting_chunk_text: str,
) -> dict[str, Any]:
    """Resolve exact source cells and a unique OCR-box header/value alignment.

    Model-supplied row/table/column identifiers are intentionally not inputs.
    We require one parser source row with one exact subject cell and one exact
    header cell. When the value string repeats in the row, the full nonempty row
    cell sequence must map one-to-one to same-row OCR records in x order. OCR
    geometry must then align the header with exactly one non-subject cell.
    """
    if not subject or not value or not header_quote:
        return _reject("MISSING_EXACT_CELL_TEXT")
    if not all(s in emitting_chunk_text for s in (subject, value, header_quote)):
        return _reject("ATOM_NOT_PRESENT_IN_EMITTING_CHUNK")
    if len(rec_texts) != len(rec_boxes):
        return _reject("OCR_TEXT_BOX_COUNT_MISMATCH")

    valid_records = [
        {"index": i, "text": text, "box": [float(v) for v in box]}
        for i, (text, box) in enumerate(zip(rec_texts, rec_boxes))
        if _valid_box(box, page_width, page_height)
    ]
    exact_subject_cells = [
        c for c in table_cells
        if c.get("row", -1) >= header_row_count and c.get("text") == subject
    ]
    exact_value_cells = [
        c for c in table_cells
        if c.get("row", -1) >= header_row_count and c.get("text") == value
    ]
    exact_header_cells = [
        c for c in table_cells
        if c.get("row", -1) < header_row_count and c.get("text") == header_quote
    ]
    if not exact_subject_cells:
        return _reject("SUBJECT_NOT_EXACT_SOURCE_DATA_CELL")
    if not exact_value_cells:
        return _reject("VALUE_NOT_EXACT_SOURCE_DATA_CELL")
    if not exact_header_cells:
        return _reject("HEADER_NOT_EXACT_SOURCE_HEADER_CELL")
    if len(exact_header_cells) != 1:
        return _reject("HEADER_CELL_NOT_UNIQUE", headerCellCount=len(exact_header_cells))

    candidate_rows = []
    rows = sorted({int(c["row"]) for c in exact_subject_cells})
    for row in rows:
        row_subjects = [c for c in exact_subject_cells if int(c["row"]) == row]
        row_values = [c for c in exact_value_cells if int(c["row"]) == row]
        if len(row_subjects) == 1 and row_values:
            row_values = [c for c in row_values if c.get("cell") != row_subjects[0].get("cell")]
            if row_values:
                candidate_rows.append((row, row_subjects[0], row_values))
    if len(candidate_rows) != 1:
        return _reject("SUBJECT_VALUE_ROW_BINDING_NOT_UNIQUE", rowCount=len(candidate_rows))
    source_row, subject_cell, candidate_value_cells = candidate_rows[0]
    subject_records = [r for r in valid_records if r["text"] == subject]
    if not subject_records:
        return _reject("SUBJECT_HAS_NO_VALID_OCR_BOX")
    if len(subject_records) != 1:
        return _reject("SUBJECT_OCR_BOX_NOT_UNIQUE", boxCount=len(subject_records))
    subject_record = subject_records[0]

    value_records = [
        r for r in valid_records
        if r["text"] == value and _y_overlap_ratio(r["box"], subject_record["box"]) >= 0.5
    ]
    if not value_records:
        return _reject("VALUE_HAS_NO_SAME_ROW_OCR_BOX")
    header_records = [r for r in valid_records if r["text"] == header_quote]
    if not header_records:
        return _reject("HEADER_HAS_NO_VALID_OCR_BOX")
    subject_box = subject_record["box"]
    row_records = [
        r for r in valid_records
        if _y_overlap_ratio(r["box"], subject_box) >= 0.5
    ]
    row_records.sort(key=lambda r: (_center_x(r["box"]), r["index"]))

    if len(candidate_value_cells) == 1:
        if len(value_records) != 1:
            return _reject("VALUE_SAME_ROW_OCR_BOX_NOT_UNIQUE", boxCount=len(value_records))
        value_cell = candidate_value_cells[0]
        value_record = value_records[0]
        if value_record["index"] == subject_record["index"]:
            return _reject("SUBJECT_AND_VALUE_SHARE_OCR_BOX")
        resolved_pairs = [(value_cell, value_record)]
    else:
        # When the same literal appears in multiple cells in this row, exact
        # strings alone cannot choose which cell the model meant. Permit a
        # binding only if every nonempty source cell maps one-to-one to all
        # same-row OCR boxes in left-to-right order, with exact sequence text.
        row_cells = sorted(
            [c for c in table_cells if int(c.get("row", -1)) == source_row and c.get("text")],
            key=lambda c: (int(c.get("col", -1)), int(c.get("cell", -1))),
        )
        if not row_cells or len(row_cells) != len(row_records):
            return _reject("DUPLICATE_VALUE_ROW_SEQUENCE_NOT_ONE_TO_ONE", sourceCellCount=len(row_cells), ocrRecordCount=len(row_records))
        if [c.get("text") for c in row_cells] != [r["text"] for r in row_records]:
            return _reject("DUPLICATE_VALUE_ROW_SEQUENCE_TEXT_MISMATCH")
        resolved_pairs = []
        for cell in candidate_value_cells:
            cell_index = next(
                (i for i, c in enumerate(row_cells) if c.get("cell") == cell.get("cell") and c.get("col") == cell.get("col")),
                None,
            )
            if cell_index is not None:
                resolved_pairs.append((cell, row_records[cell_index]))
        if len(resolved_pairs) != len(candidate_value_cells):
            return _reject("DUPLICATE_VALUE_ROW_CELL_MAPPING_INCOMPLETE")

    aligned = []
    for header in header_records:
        hbox = header["box"]
        overlaps = [
            r for r in row_records if r["index"] != subject_record["index"]
            if _x_overlap_ratio(hbox, r["box"]) >= 0.55
        ]
        if len(overlaps) != 1:
            continue
        matched_record = overlaps[0]
        if _center_y(hbox) >= _center_y(matched_record["box"]):
            continue
        matched_cells = [cell for cell, rec in resolved_pairs if rec["index"] == matched_record["index"]]
        if len(matched_cells) == 1:
            aligned.append((header, matched_cells[0], matched_record))
    if not aligned:
        return _reject("NO_UNIQUE_PHYSICAL_HEADER_VALUE_ALIGNMENT")
    if len(aligned) != 1:
        return _reject("PHYSICAL_HEADER_VALUE_ALIGNMENT_NOT_UNIQUE", boxCount=len(aligned))

    header_record, value_cell, value_record = aligned[0]
    value_box = value_record["box"]
    return {
        "status": "LEXICALLY_GROUNDED_FACT_CANDIDATE",
        "semanticStatus": "NOT_ASSESSED",
        "sourceRow": subject_cell.get("row"),
        "subjectCell": subject_cell.get("cell"),
        "subjectColumn": subject_cell.get("col"),
        "valueCell": value_cell.get("cell"),
        "valueColumn": value_cell.get("col"),
        "headerRow": exact_header_cells[0].get("row"),
        "headerCell": exact_header_cells[0].get("cell"),
        "headerGridColumn": exact_header_cells[0].get("col"),
        "ocrBoxes": {
            "subject": {"recordIndex": subject_record["index"], "box": subject_record["box"]},
            "value": {"recordIndex": value_record["index"], "box": value_box},
            "header": {"recordIndex": header_record["index"], "box": header_record["box"]},
        },
        "headerValueXOverlapRatio": round(_x_overlap_ratio(header_record["box"], value_box), 6),
        "headerGridColumnDiff": exact_header_cells[0].get("col") - value_cell.get("col"),
        "candidateColumnMetadata": "IGNORED_FOR_BINDING",
    }
