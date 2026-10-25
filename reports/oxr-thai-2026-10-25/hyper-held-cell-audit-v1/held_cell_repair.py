"""Resolve source-header labels against independent PDF vector cell geometry."""

from __future__ import annotations

import unicodedata
import re
from typing import Any


_NUMERIC_WORD_PATTERN = re.compile(
    r"[+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?\Z"
)


def _intersection_ratio(box: list[float], cell_box: list[float], axis: str) -> float:
    if axis == "x":
        width = box[2] - box[0]
        overlap = max(0.0, min(box[2], cell_box[2]) - max(box[0], cell_box[0]))
    else:
        width = box[3] - box[1]
        overlap = max(0.0, min(box[3], cell_box[3]) - max(box[1], cell_box[1]))
    return overlap / width if width > 0 else 0.0


def _row_span(cell: dict[str, Any]) -> int:
    return int(cell.get("rowEnd", cell.get("rowStart", -1))) - int(cell.get("rowStart", -1)) + 1


def numeric_word_key(text: str) -> str | None:
    """Return a comparison key for a complete Unicode decimal token only."""
    normalized = unicodedata.normalize("NFKC", text)
    if not normalized or not any(unicodedata.category(char) == "Nd" for char in normalized):
        return None
    digits: list[str] = []
    for char in normalized:
        if unicodedata.category(char) == "Nd":
            digits.append(str(unicodedata.decimal(char)))
        elif char in {",", ".", "-", "+"}:
            digits.append(char)
        else:
            return None
    key = "".join(digits)
    if _NUMERIC_WORD_PATTERN.fullmatch(key) is None:
        return None
    return key


def _physical_columns(box: list[float], column_boxes: dict[int, list[int | float]]) -> list[int] | None:
    columns: list[int] = []
    for column, interval in sorted(column_boxes.items()):
        if len(interval) != 2 or float(interval[1]) <= float(interval[0]):
            return None
        center = (float(interval[0]) + float(interval[1])) / 2
        if box[0] <= center <= box[2]:
            columns.append(int(column))
    if columns and columns != list(range(columns[0], columns[-1] + 1)):
        return None
    return columns


def resolve_header_slots(
    *,
    header_cells: list[dict[str, Any]],
    header_records: list[dict[str, Any]],
    pdf_cells: list[dict[str, Any]],
    column_boxes: dict[int, list[int | float]],
    minimum_axis_overlap: float = 0.60,
) -> dict[str, Any]:
    """Map each exact OCR header label to one independently detected PDF cell.

    ``pdf_cells`` must be vector cells extracted from the matching frozen PDF
    table and transformed to the Paddle page coordinate system. Raw HTML
    column/row spans are retained as source metadata; physical spans come only
    from the independent PDF vector rectangles.
    """
    cells = [cell for cell in header_cells if cell.get("text")]
    if not cells:
        return {"status": "HELD", "reason": "NO_NONEMPTY_HEADER_CELLS", "bindings": []}
    rows = {int(cell.get("row", -1)) for cell in cells}
    if len(rows) != 1:
        return {"status": "HELD", "reason": "HEADER_SLOT_ROWS_NOT_UNIQUE", "bindings": []}
    if len({str(cell["text"]) for cell in cells}) != len(cells):
        return {"status": "HELD", "reason": "DUPLICATE_HEADER_TEXT_IDENTITY_AMBIGUOUS", "bindings": []}
    if len(header_records) != len(cells):
        return {"status": "HELD", "reason": "HEADER_CELL_RECORD_COUNT_MISMATCH", "bindings": []}
    if not pdf_cells:
        return {"status": "HELD", "reason": "PDF_VECTOR_CELLS_MISSING", "bindings": []}

    records_by_text: dict[str, list[dict[str, Any]]] = {}
    for record in header_records:
        records_by_text.setdefault(str(record.get("text", "")), []).append(record)
    expected_texts = {str(cell["text"]) for cell in cells}
    if set(records_by_text) != expected_texts or any(len(items) != 1 for items in records_by_text.values()):
        return {"status": "HELD", "reason": "HEADER_TEXT_RECORD_MATCH_NOT_UNIQUE", "bindings": []}

    normalized_pdf_cells: list[dict[str, Any]] = []
    ids: set[str] = set()
    for cell in pdf_cells:
        try:
            bbox = [float(value) for value in cell["box"]]
            row_start = int(cell["rowStart"])
            row_end = int(cell["rowEnd"])
            cell_id = str(cell["id"])
        except (KeyError, TypeError, ValueError):
            return {"status": "HELD", "reason": "PDF_VECTOR_CELL_GEOMETRY_INVALID", "bindings": []}
        if len(bbox) != 4 or not bbox[0] < bbox[2] or not bbox[1] < bbox[3] or row_end < row_start:
            return {"status": "HELD", "reason": "PDF_VECTOR_CELL_GEOMETRY_INVALID", "bindings": []}
        if cell_id in ids:
            return {"status": "HELD", "reason": "PDF_VECTOR_CELL_ID_NOT_UNIQUE", "bindings": []}
        ids.add(cell_id)
        cell_columns = _physical_columns(bbox, column_boxes)
        if cell_columns is None:
            return {"status": "HELD", "reason": "PDF_VECTOR_COLUMN_BINDING_AMBIGUOUS", "bindings": []}
        normalized_pdf_cells.append({
            "id": cell_id,
            "box": bbox,
            "rowStart": row_start,
            "rowEnd": row_end,
            "rowSpan": row_end - row_start + 1,
            "physicalColumns": cell_columns,
        })

    # Vector cell rectangles in a table may share borders but must not overlap
    # in their interiors. A malformed table grid is held as a whole.
    for index, left in enumerate(normalized_pdf_cells):
        for right in normalized_pdf_cells[index + 1:]:
            ix = min(left["box"][2], right["box"][2]) - max(left["box"][0], right["box"][0])
            iy = min(left["box"][3], right["box"][3]) - max(left["box"][1], right["box"][1])
            if ix > 0.5 and iy > 0.5:
                return {"status": "HELD", "reason": "PDF_VECTOR_CELLS_OVERLAP", "bindings": []}

    assignments: list[dict[str, Any]] = []
    used_slots: set[str] = set()
    mapped_rows: set[int] = set()
    for cell in cells:
        text = str(cell["text"])
        record = records_by_text[text][0]
        try:
            box = [float(value) for value in record["box"]]
        except (KeyError, TypeError, ValueError):
            return {"status": "HELD", "reason": "HEADER_OCR_BOX_MISSING_OR_INVALID", "bindings": []}
        if len(box) != 4 or not box[0] < box[2] or not box[1] < box[3]:
            return {"status": "HELD", "reason": "HEADER_OCR_BOX_MISSING_OR_INVALID", "bindings": []}
        center_x = (box[0] + box[2]) / 2
        center_y = (box[1] + box[3]) / 2
        candidates = [
            slot for slot in normalized_pdf_cells
            if slot["box"][0] <= center_x <= slot["box"][2]
            and slot["box"][1] <= center_y <= slot["box"][3]
        ]
        if len(candidates) != 1:
            return {"status": "HELD", "reason": "PDF_VECTOR_CELL_ASSIGNMENT_NOT_UNIQUE", "bindings": []}
        slot = candidates[0]
        if _intersection_ratio(box, slot["box"], "x") < minimum_axis_overlap:
            return {"status": "HELD", "reason": "HEADER_BOX_HORIZONTAL_OVERLAP_TOO_LOW", "bindings": []}
        if _intersection_ratio(box, slot["box"], "y") < minimum_axis_overlap:
            return {"status": "HELD", "reason": "HEADER_BOX_VERTICAL_OVERLAP_TOO_LOW", "bindings": []}
        if slot["id"] in used_slots:
            return {"status": "HELD", "reason": "PDF_VECTOR_CELL_ASSIGNMENT_NOT_ONE_TO_ONE", "bindings": []}
        used_slots.add(slot["id"])
        mapped_rows.add(slot["rowStart"])
        raw_start = int(cell["col"])
        raw_end = int(cell.get("colEnd", raw_start))
        assignments.append({
            "sourceRow": int(cell["row"]),
            "sourceCell": int(cell.get("cell", -1)),
            "text": text,
            "recordIndex": int(record.get("index", -1)),
            "box": box,
            "gridColumns": list(range(raw_start, raw_end + 1)),
            "rawRowEnd": cell.get("rowEnd"),
            "rawRowSpan": int(cell.get("rowEnd", cell["row"])) - int(cell["row"]) + 1,
            "physicalColumns": list(slot["physicalColumns"]),
            "pdfVectorCellId": slot["id"],
            "pdfVectorCellBounds": slot["box"],
            "pdfVectorRowStart": slot["rowStart"],
            "pdfVectorRowEnd": slot["rowEnd"],
            "pdfVectorRowSpan": slot["rowSpan"],
            "status": "RESOLVED",
            "reason": None,
            "bindingMethod": "EXACT_HEADER_TEXT_BOX_TO_PDF_VECTOR_CELL",
        })

    if len(mapped_rows) != 1:
        return {"status": "HELD", "reason": "HEADER_RECORDS_SPAN_MULTIPLE_PDF_ROWS", "bindings": []}
    assigned_row = next(iter(mapped_rows))
    row_slot_ids = {slot["id"] for slot in normalized_pdf_cells if slot["rowStart"] == assigned_row}
    if row_slot_ids != used_slots:
        return {"status": "HELD", "reason": "PDF_VECTOR_HEADER_ROW_COVERAGE_MISMATCH", "bindings": []}
    row_slots = [slot for slot in normalized_pdf_cells if slot["rowStart"] == assigned_row]
    row_columns = [column for slot in row_slots for column in slot["physicalColumns"]]
    if len(row_columns) != len(set(row_columns)):
        return {"status": "HELD", "reason": "PDF_VECTOR_COLUMN_ASSIGNMENT_NOT_UNIQUE", "bindings": []}
    return {"status": "RESOLVED", "reason": None, "pdfVectorRowStart": assigned_row, "bindings": assignments}
