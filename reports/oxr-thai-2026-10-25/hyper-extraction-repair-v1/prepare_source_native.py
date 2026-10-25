"""Run deterministic source-native cell enumeration over all frozen packets.

This script reads frozen table-sidecar/source-bundle/Paddle inputs only. It does
not open QA/gold, model candidate outputs, or auditor disposition labels.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from source_native import enumerate_table


ROOT = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
RAW = ROOT / ".local/hyper-extraction-repair-20261025"
FACT_AUDIT = ROOT / ".local/hyper-fact-audit-20261025"
TABLE_RUN = ROOT / ".local/thai-table-chunking-20261025/run-v2"
HYPER_RUN5 = ROOT / ".local/hyper-relation-audit-20261025/run-5"
REPORT = ROOT / "reports/oxr-thai-2026-10-25/hyper-extraction-repair-v1"
FREEZE_PATH = RAW / "source-native-freeze.json"
OUTPUT_PATH = RAW / "source-native-enumeration.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def file_sha(path: Path) -> str:
    return sha256(path.read_bytes())


def count_reasons(rows: list[dict[str, Any]]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for row in rows:
        if row.get("status") == "HELD":
            for reason in row.get("holdReasons", []) or [row.get("reason", "HELD_UNSPECIFIED")]:
                counter[str(reason)] += 1
    return dict(sorted(counter.items()))


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    fact_freeze_path = FACT_AUDIT / "fact-audit-freeze.json"
    fact_freeze = read_json(fact_freeze_path)
    expected = fact_freeze["inputFiles"]
    sidecar_path = TABLE_RUN / "table-sidecar.json"
    bundle_path = HYPER_RUN5 / "source-bundle.json"
    economy_paddle_path = ROOT / ".local/thai-native-20261025/paddle-2/economy.json"
    population_paddle_path = ROOT / ".local/thai-native-20261025/paddle-2/population.json"
    input_paths = {
        "factAuditFreeze": fact_freeze_path,
        "tableSidecar": sidecar_path,
        "sourceBundle": bundle_path,
        "economyPaddleRaw": economy_paddle_path,
        "populationPaddleRaw": population_paddle_path,
    }
    input_hashes = {name: file_sha(path) for name, path in input_paths.items()}
    for name in ("tableSidecar", "sourceBundle", "economyPaddleRaw", "populationPaddleRaw"):
        if input_hashes[name] != expected[name]:
            raise SystemExit(f"Frozen source hash mismatch for {name}: {input_hashes[name]} != {expected[name]}")

    sidecar = read_json(sidecar_path)
    bundle = read_json(bundle_path)
    zones_by_table_row: dict[str, dict[int, dict[str, Any]]] = {}
    for zone in bundle["zones"]:
        if zone.get("kind") != "table-row":
            continue
        packet = zone.get("packet", {})
        table_id = str(packet.get("tableId", ""))
        row = int(packet.get("row", -1))
        zones_by_table_row.setdefault(table_id, {})[row] = zone

    paddle_docs = {
        "economy": read_json(economy_paddle_path),
        "population": read_json(population_paddle_path),
    }
    if len(sidecar.get("tables", [])) != 4 or len(sidecar.get("packets", [])) != 114:
        raise SystemExit("Unexpected frozen table-sidecar dimensions")

    tables = []
    for table in sidecar["tables"]:
        doc = str(table["doc"])
        page = int(table["page"])
        page_result = paddle_docs[doc]["raw"][page]["res"]
        table_result = page_result["table_res_list"][0]
        table_ocr = table_result["table_ocr_pred"]
        zones_for_table = zones_by_table_row.get(table["id"], {})
        if set(zones_for_table) != {int(p["row"]) for p in table.get("packets", [])}:
            raise SystemExit(f"Source-bundle packet rows do not match table {table['id']}")
        result = enumerate_table(
            table=table,
            table_ocr=table_ocr,
            cell_boxes=table_result.get("cell_box_list", []),
            page_width=int(page_result["width"]),
            page_height=int(page_result["height"]),
            zones_by_row=zones_for_table,
        )
        tables.append(result)

    all_rows = [row for table in tables for row in table["rows"]]
    all_cells = [cell for table in tables for cell in table["cells"]]
    packet_count = sum(int(t["packetCount"]) for t in tables)
    if packet_count != 114 or len(all_rows) != packet_count:
        raise SystemExit(f"Expected 114 source packets, enumerated {len(all_rows)}")
    ids = [c["recordId"] for c in all_cells]
    if len(ids) != len(set(ids)):
        raise SystemExit("Source-native cell record IDs are not unique")

    freeze = {
        "schema": "hyper-source-native-freeze-v1",
        "profile": "all-frozen-table-packets-source-native-cell-enumeration",
        "purpose": "deterministic source-cell enumeration and nonproduction TEXT-only native comparison",
        "inputPaths": {name: str(path.relative_to(ROOT)).replace("\\", "/") for name, path in input_paths.items()},
        "inputSha256": input_hashes,
        "implementationSha256": {
            "sourceNative": file_sha(REPORT / "source_native.py"),
            "prepareSourceNative": file_sha(Path(__file__).resolve()),
            "sourceNativeTests": file_sha(REPORT / "test_source_native.py"),
        },
        "protocol": {
            "scope": "all four frozen tables and all 114 source packets",
            "rowBinding": "exact full nonempty source-cell sequence equals same-y, x-ordered Paddle table_ocr records anchored by one structurally inferred textual label column",
            "labelColumn": "Unicode letter presence x cross-row uniqueness; no entity-name or domain allowlist",
            "headerBinding": "exact source header text plus unique OCR geometry; single-cell leaves may follow unique physical column alignment; merged spans must agree with declared source span; order inversions and span conflicts are held; a solitary unmerged upper header above a lower multi-column header level remains literal table context without a declared span",
            "geometrySettings": {
                "minimumYOverlapForSameRow": 0.5,
                "minimumHeaderLeafXOverlap": 0.55,
                "minimumMergedHeaderSpanCoverage": 0.6,
                "headerVisualBandHeightMultiplier": 1.5,
                "minimumHeaderVisualBandHeightPx": 8,
                "minimumHeaderOrderInversionOverlapToIgnore": 0.2,
                "maximumParentHeaderDistanceFromDeepestHeaderRows": 2,
            },
            "sourceText": "preserve exact frozen OCR/parser literals; no normalization, correction or candidate-derived values",
            "candidateLinking": "not read or used during enumeration; post-freeze crosswalk only",
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "modelCalls": 0,
            "goldQuestionsOrMetricsUsed": False,
        },
        "runtime": {"python": sys.version.split()[0]},
    }
    FREEZE_PATH.write_text(json.dumps(freeze, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    freeze_sha = file_sha(FREEZE_PATH)
    resolved_cells = [c for c in all_cells if c["status"] == "SOURCE_CELL_STRUCTURALLY_RESOLVED"]
    held_cells = [c for c in all_cells if c["status"] == "HELD"]
    output = {
        "schema": "hyper-source-native-enumeration-v1",
        "freezeSha256": freeze_sha,
        "sourceBundleSha256": input_hashes["sourceBundle"],
        "tableSidecarSha256": input_hashes["tableSidecar"],
        "paddleRawSha256": {
            "economy": input_hashes["economyPaddleRaw"],
            "population": input_hashes["populationPaddleRaw"],
        },
        "origin": "SOURCE_NATIVE_TABLE_CELL",
        "semanticStatus": "NOT_ASSESSED",
        "graphAdmission": "NONE",
        "candidateOutputsUsed": False,
        "goldQuestionsOrMetricsUsed": False,
        "modelCalls": 0,
        "summary": {
            "tables": len(tables),
            "sourcePackets": packet_count,
            "sourceRows": len(all_rows),
            "sourceCells": len(all_cells),
            "rowSequencesResolved": sum(r["rowSequenceStatus"] == "ROW_SEQUENCE_RESOLVED" for r in all_rows),
            "rowSequencesHeld": sum(r["rowSequenceStatus"] != "ROW_SEQUENCE_RESOLVED" for r in all_rows),
            "structurallyResolvedCellCandidates": len(resolved_cells),
            "structurallyResolvedValueCellCandidates": sum(c["status"] == "SOURCE_CELL_STRUCTURALLY_RESOLVED" and c["recordType"] == "TABLE_VALUE_CELL" for c in all_cells),
            "structurallyResolvedRowLabelCells": sum(c["status"] == "SOURCE_CELL_STRUCTURALLY_RESOLVED" and c["recordType"] == "ROW_LABEL_CELL" for c in all_cells),
            "heldCells": len(held_cells),
            "cellHoldReasons": count_reasons(held_cells),
            "resolvedCellCandidatesByTable": {
                t["tableId"]: sum(c["status"] == "SOURCE_CELL_STRUCTURALLY_RESOLVED" for c in t["cells"])
                for t in tables
            },
            "resolvedValueCellCandidatesByTable": {
                t["tableId"]: sum(c["status"] == "SOURCE_CELL_STRUCTURALLY_RESOLVED" and c["recordType"] == "TABLE_VALUE_CELL" for c in t["cells"])
                for t in tables
            },
        },
        "tables": tables,
    }
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"freezeSha256": freeze_sha, "summary": output["summary"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
