"""Versioned source-native resolver with independent PDF vector slots."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PREVIOUS_REPORT = HERE.parent / "hyper-extraction-repair-v1"
sys.path.insert(0, str(PREVIOUS_REPORT))

import source_native as _base  # noqa: E402

from held_cell_repair import resolve_header_slots  # noqa: E402

_original_resolve_header_geometry = _base.resolve_header_geometry
_original_enumerate_table = _base.enumerate_table
_pdf_tables_by_id: dict[str, dict[str, Any]] = {}
_active_pdf_cells: list[dict[str, Any]] = []
_active_pdf_topology: dict[str, Any] = {}


def configure_pdf_geometry(geometry: dict[str, Any]) -> None:
    """Install PDF vector cells derived from the current frozen PDF inputs."""
    global _pdf_tables_by_id
    _pdf_tables_by_id = {str(table_id): table for table_id, table in geometry.get("tables", {}).items()}


def resolve_header_geometry(
    *,
    header_cells: list[dict[str, Any]],
    header_records: list[dict[str, Any]],
    column_boxes: dict[int, list[int | float]],
) -> dict[str, Any]:
    """Recheck each source header row against exact OCR boxes and PDF cells."""
    result = _original_resolve_header_geometry(
        header_cells=header_cells,
        header_records=header_records,
        column_boxes=column_boxes,
    )
    if not _active_pdf_cells or _active_pdf_topology.get("status") != "USABLE":
        return result

    bindings = result["bindings"]
    by_key = {(int(binding["row"]), int(binding["cell"])): binding for binding in bindings}
    source_rows = sorted({int(cell["row"]) for cell in header_cells if cell.get("text")})
    for row in source_rows:
        cells = [cell for cell in header_cells if int(cell["row"]) == row and cell.get("text")]
        row_bindings = [by_key[(row, int(cell["cell"]))] for cell in cells]
        records = [
            {"index": binding.get("recordIndex", -1), "text": binding["text"], "box": binding.get("box")}
            for binding in row_bindings
            if binding.get("recordIndex", -1) >= 0
        ]
        vector_result = resolve_header_slots(
            header_cells=cells,
            header_records=records,
            pdf_cells=_active_pdf_cells,
            column_boxes=column_boxes,
        )
        if vector_result.get("status") != "RESOLVED":
            # A previous geometry conflict cannot fall back to a Paddle-only
            # admission. Other rows are still rederived by the frozen resolver.
            if any(binding.get("status") == "HELD" for binding in row_bindings):
                for binding in row_bindings:
                    binding["status"] = "HELD"
                    binding["reason"] = f"PDF_VECTOR_{vector_result.get('reason', 'BINDING_HELD')}"
                    binding["physicalColumns"] = []
            continue

        by_cell = {int(item["sourceCell"]): item for item in vector_result["bindings"]}
        for cell, binding in zip(cells, row_bindings):
            vector_binding = by_cell.get(int(cell["cell"]))
            if vector_binding is None:
                binding["status"] = "HELD"
                binding["reason"] = "PDF_VECTOR_SOURCE_CELL_BINDING_MISSING"
                binding["physicalColumns"] = []
                continue
            prior_status = binding.get("status")
            prior_reason = binding.get("reason")
            binding.update({
                "physicalColumns": vector_binding["physicalColumns"],
                "status": "CONTEXT_ONLY" if prior_status == "CONTEXT_ONLY" else "RESOLVED",
                "reason": prior_reason if prior_status == "CONTEXT_ONLY" else None,
                "bindingMethod": vector_binding["bindingMethod"],
                "pdfVectorCellId": vector_binding["pdfVectorCellId"],
                "pdfVectorCellBounds": vector_binding["pdfVectorCellBounds"],
                "pdfVectorRowStart": vector_binding["pdfVectorRowStart"],
                "pdfVectorRowEnd": vector_binding["pdfVectorRowEnd"],
                "pdfVectorRowSpan": vector_binding["pdfVectorRowSpan"],
                "rawHeaderGridColumnsPreserved": list(binding["gridColumns"]),
                "rawHeaderRowEndPreserved": cell.get("rowEnd"),
            })
    return result


def enumerate_table(**kwargs: Any) -> dict[str, Any]:
    global _active_pdf_cells, _active_pdf_topology
    table_id = str(kwargs["table"]["id"])
    if table_id not in _pdf_tables_by_id:
        raise ValueError(f"Missing frozen PDF vector geometry for {table_id}")
    previous = _active_pdf_cells
    previous_topology = _active_pdf_topology
    table_geometry = _pdf_tables_by_id[table_id]
    _active_pdf_topology = table_geometry.get("topologyCheck", {})
    _active_pdf_cells = list(table_geometry.get("vectorCells", [])) if _active_pdf_topology.get("status") == "USABLE" else []
    try:
        result = _original_enumerate_table(**kwargs)
        result["pdfVectorTopology"] = _active_pdf_topology
        return result
    finally:
        _active_pdf_cells = previous
        _active_pdf_topology = previous_topology


_base.resolve_header_geometry = resolve_header_geometry
