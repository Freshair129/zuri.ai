"""Re-enumerate the complete frozen source-cell set with versioned slot binding."""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from source_native_v2 import configure_pdf_geometry, enumerate_table


ROOT = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
REPORT = Path(__file__).resolve().parent
RAW = ROOT / ".local/hyper-held-cell-audit-20261025"
PREVIOUS_RAW = ROOT / ".local/hyper-extraction-repair-20261025"
TABLE_RUN = ROOT / ".local/thai-table-chunking-20261025/run-v2"
HYPER_RUN5 = ROOT / ".local/hyper-relation-audit-20261025/run-5"
PADDLE = ROOT / ".local/thai-native-20261025/paddle-2"
PDF_INPUT = ROOT / ".local/thai-native-20261025/input"
PDF_GEOMETRY_PATH = RAW / "pdf-vector-geometry-v1.json"
FREEZE_PATH = RAW / "held-cell-freeze-v1.json"
OUTPUT_PATH = RAW / "held-cell-enumeration-v1.json"
RECHECK_PATH = RAW / "all-cell-recheck-v1.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def file_sha(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def count_reasons(cells: list[dict[str, Any]]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for cell in cells:
        if cell.get("status") == "HELD":
            counter.update(str(reason) for reason in cell.get("holdReasons", []))
    return dict(sorted(counter.items()))


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    prior_freeze_path = PREVIOUS_RAW / "source-native-freeze.json"
    prior_enum_path = PREVIOUS_RAW / "source-native-enumeration.json"
    prior_projection_freeze_path = PREVIOUS_RAW / "source-native-projection-freeze.json"
    table_sidecar_path = TABLE_RUN / "table-sidecar.json"
    bundle_path = HYPER_RUN5 / "source-bundle.json"
    paddle_paths = {
        "economy": PADDLE / "economy.json",
        "population": PADDLE / "population.json",
    }
    pdf_paths = {
        "economy": PDF_INPUT / "economy.pdf",
        "population": PDF_INPUT / "population.pdf",
    }
    input_paths = {
        "priorSourceNativeFreeze": prior_freeze_path,
        "priorSourceNativeEnumeration": prior_enum_path,
        "priorSourceProjectionFreeze": prior_projection_freeze_path,
        "tableSidecar": table_sidecar_path,
        "sourceBundle": bundle_path,
        "economyPaddleRaw": paddle_paths["economy"],
        "populationPaddleRaw": paddle_paths["population"],
        "economyPdf": pdf_paths["economy"],
        "populationPdf": pdf_paths["population"],
        "pdfVectorGeometry": PDF_GEOMETRY_PATH,
    }
    input_hashes = {name: file_sha(path) for name, path in input_paths.items()}
    prior_freeze = read_json(prior_freeze_path)
    prior_enum = read_json(prior_enum_path)
    prior_projection_freeze = read_json(prior_projection_freeze_path)
    if prior_enum.get("freezeSha256") != input_hashes["priorSourceNativeFreeze"]:
        raise SystemExit("Prior source-native enumeration does not match its sealed freeze")
    if prior_projection_freeze.get("sourceNativeEnumerationSha256") != input_hashes["priorSourceNativeEnumeration"]:
        raise SystemExit("Prior source projection is not bound to the prior enumeration")

    baseline_inputs = prior_freeze["inputSha256"]
    for name, baseline_key in (
        ("tableSidecar", "tableSidecar"),
        ("sourceBundle", "sourceBundle"),
        ("economyPaddleRaw", "economyPaddleRaw"),
        ("populationPaddleRaw", "populationPaddleRaw"),
    ):
        if input_hashes[name] != baseline_inputs[baseline_key]:
            raise SystemExit(f"Frozen input drift for {name}")

    sidecar = read_json(table_sidecar_path)
    bundle = read_json(bundle_path)
    pdf_geometry = read_json(PDF_GEOMETRY_PATH)
    if pdf_geometry.get("schema") != "hyper-held-cell-pdf-vector-geometry-v1":
        raise SystemExit("Unexpected PDF vector geometry schema")
    for source_key in ("tableSidecar", "economyPaddleRaw", "populationPaddleRaw", "economyPdf", "populationPdf"):
        if pdf_geometry.get("sourceSha256", {}).get(source_key) != input_hashes[source_key]:
            raise SystemExit(f"PDF vector geometry source mismatch for {source_key}")
    configure_pdf_geometry(pdf_geometry)
    paddle_docs = {doc: read_json(path) for doc, path in paddle_paths.items()}
    zones_by_table_row: dict[str, dict[int, dict[str, Any]]] = {}
    for zone in bundle["zones"]:
        if zone.get("kind") != "table-row":
            continue
        packet = zone.get("packet", {})
        table_id = str(packet.get("tableId", ""))
        row = int(packet.get("row", -1))
        zones_by_table_row.setdefault(table_id, {})[row] = zone
    if len(sidecar.get("tables", [])) != 4 or len(sidecar.get("packets", [])) != 114:
        raise SystemExit("Frozen input dimensions differ from the original four-table/114-packet profile")

    freeze = {
        "schema": "hyper-held-cell-freeze-v1",
        "profile": "all-four-frozen-tables-source-native-cell-re-evaluation",
        "status": "FROZEN_BEFORE_SCORING",
        "scope": "Recompute all 972 source-cell statuses; prior statuses are diagnostic only and none are auto-carried.",
        "inputPaths": {name: str(path.relative_to(ROOT)).replace("\\", "/") for name, path in input_paths.items()},
        "inputSha256": input_hashes,
        "implementationSha256": {
            name: file_sha(REPORT / name)
            for name in ("held_cell_repair.py", "source_native_v2.py", "extract_pdf_vector_geometry.py", "derive_pdf_cell_values.py", "prepare_held_cells.py", "test_held_cell_repair.py", "test_pdf_cell_value_corrections.py")
        },
        "protocol": {
            "enumeration": "All tables and packets are re-enumerated from unchanged table-sidecar, source-bundle and Paddle outputs.",
            "rowBinding": "Unchanged exact full nonempty source-cell sequence to a same-y, x-ordered Paddle OCR row anchored by the inferred label column.",
            "headerRepair": "Recompute source headers against exact Paddle OCR text-box positions and independently extracted original-PDF vector cell rectangles; derive physical row and column spans only from the matched PDF table. Preserve original HTML row/cell spans and literal source text as provenance.",
            "ambiguousCases": "Duplicate header strings, missing cells/records/PDF vector cells, nonunique box-to-cell containment, overlapping vector cells, incomplete geometry or nonunique column-center assignment remain held.",
            "sourceText": "Header topology uses only original-PDF vector rectangles. A separate post-enumeration numeric evidence pass reads exact numeric text-layer words; the raw Paddle cell text/source span remain immutable, with any replacement stored as a separate derived value.",
            "candidateInputs": "No Hyper candidate IDs, per-cell audit labels or QA/questions are used for enumeration, repair or projection.",
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "modelCalls": 0,
            "goldQuestionsOrMetricsUsed": False,
        },
        "runtime": {"python": sys.version.split()[0], "pdfVectorGeometryRuntime": pdf_geometry.get("runtime")},
    }
    FREEZE_PATH.write_text(json.dumps(freeze, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    freeze_sha = file_sha(FREEZE_PATH)

    tables = []
    for table in sidecar["tables"]:
        doc = str(table["doc"])
        page = int(table["page"])
        page_result = paddle_docs[doc]["raw"][page]["res"]
        table_result = page_result["table_res_list"][0]
        packet_rows = {int(packet["row"]) for packet in table.get("packets", [])}
        source_rows = set(zones_by_table_row.get(table["id"], {}))
        if packet_rows != source_rows:
            raise SystemExit(f"Frozen source packet mismatch for {table['id']}")
        tables.append(enumerate_table(
            table=table,
            table_ocr=table_result["table_ocr_pred"],
            cell_boxes=table_result.get("cell_box_list", []),
            page_width=int(page_result["width"]),
            page_height=int(page_result["height"]),
            zones_by_row=zones_by_table_row[table["id"]],
        ))

    all_rows = [row for table in tables for row in table["rows"]]
    all_cells = [cell for table in tables for cell in table["cells"]]
    ids = [cell["recordId"] for cell in all_cells]
    if len(all_rows) != 114 or len(all_cells) != 972 or len(ids) != len(set(ids)):
        raise SystemExit(f"Unexpected all-cell re-enumeration: rows={len(all_rows)} cells={len(all_cells)}")

    prior_cells = {
        cell["recordId"]: cell
        for table in prior_enum["tables"]
        for cell in table["cells"]
    }
    if set(prior_cells) != set(ids):
        raise SystemExit("The re-enumerated 972 cell identities differ from the frozen baseline identity set")
    transitions = Counter((prior_cells[cell["recordId"]]["status"], cell["status"]) for cell in all_cells)
    reason_transitions = Counter(
        (reason, cell["status"])
        for cell in all_cells
        for reason in prior_cells[cell["recordId"]].get("holdReasons", [])
    )
    resolved = [cell for cell in all_cells if cell["status"] == "SOURCE_CELL_STRUCTURALLY_RESOLVED"]
    held = [cell for cell in all_cells if cell["status"] == "HELD"]
    repaired_header_bindings = [
        header
        for table in tables
        for header in table["headerBindings"]
        if header.get("bindingMethod") == "EXACT_HEADER_TEXT_BOX_TO_PDF_VECTOR_CELL"
    ]
    output = {
        "schema": "hyper-held-cell-enumeration-v1",
        "freezeSha256": freeze_sha,
        "origin": "SOURCE_NATIVE_TABLE_CELL_REEVALUATION",
        "semanticStatus": "NOT_ASSESSED",
        "graphAdmission": "NONE",
        "candidateOutputsUsed": False,
        "goldQuestionsOrMetricsUsed": False,
        "modelCalls": 0,
        "summary": {
            "tables": len(tables),
            "sourcePackets": len(all_rows),
            "sourceCellsReevaluated": len(all_cells),
            "resolvedCells": len(resolved),
            "heldCells": len(held),
            "headerBindingsReassignedFromExactGeometry": len(repaired_header_bindings),
            "holdReasonMembershipCounts": count_reasons(all_cells),
            "statusTransitionsAgainstPriorEnumeration": {
                f"{old}->{new}": count for (old, new), count in sorted(transitions.items())
            },
            "priorHoldReasonTransitions": {
                f"{reason}->{status}": count for (reason, status), count in sorted(reason_transitions.items())
            },
        },
        "tables": tables,
    }
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    recheck = {
        "schema": "hyper-held-cell-recheck-v1",
        "status": "DIAGNOSTIC_ONLY",
        "inputEnumerationSha256": input_hashes["priorSourceNativeEnumeration"],
        "newEnumerationSha256": file_sha(OUTPUT_PATH),
        "all972Reevaluated": True,
        "previousStatusAutoCarried": False,
        "goldQuestionsOrMetricsUsed": False,
        "candidateInputsUsed": False,
        "transitions": output["summary"]["statusTransitionsAgainstPriorEnumeration"],
        "priorHoldReasonTransitions": output["summary"]["priorHoldReasonTransitions"],
        "recordStatusChanges": [
            {
                "recordId": cell["recordId"],
                "previousStatus": prior_cells[cell["recordId"]]["status"],
                "newStatus": cell["status"],
                "previousHoldReasons": prior_cells[cell["recordId"]].get("holdReasons", []),
                "newHoldReasons": cell.get("holdReasons", []),
            }
            for cell in all_cells
            if prior_cells[cell["recordId"]]["status"] != cell["status"]
            or prior_cells[cell["recordId"]].get("holdReasons", []) != cell.get("holdReasons", [])
        ],
    }
    RECHECK_PATH.write_text(json.dumps(recheck, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "freezeSha256": freeze_sha,
        "enumerationSha256": file_sha(OUTPUT_PATH),
        "recheckSha256": file_sha(RECHECK_PATH),
        "summary": output["summary"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
