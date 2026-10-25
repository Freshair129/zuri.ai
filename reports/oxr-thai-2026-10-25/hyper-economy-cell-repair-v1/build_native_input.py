"""Append separately sourced PDF row candidates to the frozen table input."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
BASELINE_PATH = REPO / ".local/thai-table-chunking-20261025/run-v2/native-input.json"
PRIOR_NATIVE_PATH = REPO / ".local/hyper-held-cell-audit-20261025/native-input-held-cell-repair-layout-v2.json"
PRIOR_NATIVE_FREEZE_PATH = REPO / ".local/hyper-held-cell-audit-20261025/native-input-held-cell-repair-layout-v2-freeze.json"
PRIOR_PROJECTION_PATH = REPO / ".local/hyper-held-cell-audit-20261025/held-cell-repair-projection-layout-v2.json"
PRIOR_PROJECTION_FREEZE_PATH = REPO / ".local/hyper-held-cell-audit-20261025/held-cell-repair-projection-layout-v2-freeze.json"
ROWS_PATH = REPO / ".local/hyper-economy-cell-repair-20261025/pdf-baseline-rows-v1.json"
OUTPUT_PATH = REPO / ".local/hyper-economy-cell-repair-20261025/native-input-economy-pdf-rows-v1.json"
FREEZE_PATH = REPO / ".local/hyper-economy-cell-repair-20261025/native-input-economy-pdf-rows-freeze-v1.json"


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha_text(value: str) -> str:
    return _sha_bytes(value.encode("utf-8"))


def _quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def row_line(row: dict[str, Any]) -> str:
    label = str(row["rowLabel"]["text"])
    atoms = [f"row={_quote(label)}"]
    cells = sorted(row["cells"], key=lambda cell: int(cell["slot"]))
    if len(cells) != 7 or [int(cell["slot"]) for cell in cells] != list(range(7)):
        raise ValueError(f"source row does not contain seven ordered slots: {row.get('rowId')}")
    for cell in cells:
        header = str(cell["header"]["text"])
        value = str(cell["pdfText"])
        if not header or not value:
            raise ValueError(f"source row contains empty header/value: {row.get('rowId')}")
        atoms.append(f"slot{int(cell['slot'])}={_quote(header)}|value={_quote(value)}")
    return " | ".join(atoms)


def build_native_input(
    base: dict[str, Any],
    prior_native: dict[str, Any],
    prior_projection: dict[str, Any],
    source_rows: dict[str, Any],
    *,
    hashes: dict[str, str],
) -> dict[str, Any]:
    if source_rows.get("schema") != "hyper-economy-pdf-baseline-rows-v1":
        raise ValueError("unexpected source-row receipt schema")
    if source_rows.get("summary", {}).get("candidateRows") != 37 or source_rows.get("summary", {}).get("candidateValueCells") != 259:
        raise ValueError("source-row receipt does not match the bounded 37x7 profile")
    if source_rows.get("summary", {}).get("legacyCellStatusesCarriedIntoSourceRows") != 0:
        raise ValueError("legacy statuses must not be carried into the PDF row profile")

    arms = [json.loads(json.dumps(arm, ensure_ascii=False)) for arm in base.get("arms", [])]
    by_parser = {str(arm.get("parser")): arm for arm in arms}
    if set(by_parser) != {"plain", "table"}:
        raise ValueError("frozen baseline must contain exactly plain and table arms")
    table_arm = by_parser["table"]
    plain_arm = by_parser["plain"]
    prior_table = next((arm for arm in prior_native.get("arms", []) if arm.get("parser") == "table"), None)
    prior_source = next((arm for arm in prior_native.get("arms", []) if arm.get("parser") == "source-pdf-repair-v1"), None)
    if prior_table is None or prior_source is None:
        raise ValueError("prior frozen PDF repair input is missing its table/source arms")
    prefix_end = int(table_arm["ranges"][0]["start"])
    if prefix_end != int(plain_arm["ranges"][0]["start"]):
        raise ValueError("baseline arms do not share the same control prefix length")
    control_prefix = str(table_arm["content"][:prefix_end])
    if str(plain_arm["content"][:prefix_end]) != control_prefix:
        raise ValueError("baseline arms do not share the exact control prefix")
    for arm in (plain_arm, table_arm):
        if _sha_text(str(arm["content"])) != arm["contentSha256"]:
            raise ValueError(f"baseline arm content hash mismatch: {arm['parser']}")
        for source_range in arm.get("ranges", []):
            if not source_range.get("id"):
                raise ValueError(f"baseline source range has no id: {arm['parser']}")
            source_range["doc"] = str(source_range["id"])

    if len(table_arm.get("packets", [])) != 114:
        raise ValueError("current table baseline packet count changed")
    baseline_content = str(table_arm["content"])
    if str(prior_table["content"]) != baseline_content or prior_table["contentSha256"] != table_arm["contentSha256"]:
        raise ValueError("prior PDF repair did not preserve the current table baseline")
    prior_content = str(prior_source["content"])
    if not prior_content.startswith(baseline_content) or _sha_text(prior_content) != prior_source.get("contentSha256"):
        raise ValueError("prior PDF repair is not an exact content extension of the table baseline")
    if len(prior_projection.get("completeRowBlocks", [])) != 59:
        raise ValueError("prior PDF repair row projection changed from its frozen 59-row profile")
    records = source_rows["candidateRows"]
    if len(records) != 37:
        raise ValueError("expected all 37 mechanically qualified PDF rows")

    overlay_parts = [
        "## PDF-native economy rows (source text and geometry; meaning NOT_ASSESSED)",
        'table_context="2567" (context only; not assigned to month columns)',
    ]
    row_lines: list[tuple[dict[str, Any], str]] = []
    for row in records:
        line = row_line(row)
        overlay_parts.append(line)
        row_lines.append((row, line))
    overlay = "\n\n" + "\n\n".join(overlay_parts) + "\n"
    content = prior_content + overlay
    ranges = [json.loads(json.dumps(item, ensure_ascii=False)) for item in prior_source.get("ranges", [])]
    context_line = overlay_parts[1]
    context_start = len(prior_content) + overlay.index(context_line)
    ranges.append({
        "id": "pdf-table-context:economy:p0",
        "doc": "economy",
        "rangeKind": "PDF_TABLE_CONTEXT_ONLY",
        "start": context_start,
        "end": context_start + len(context_line),
        "textSha256": _sha_text(context_line),
        "sourcePdfSha256": source_rows["inputs"]["pdf"]["sha256"],
        "pdfWordIndexes": [int(item["pdfWordIndex"]) for item in source_rows.get("tableContextWords", [])],
        "semanticStatus": "NOT_ASSESSED",
    })
    search_from = 0
    for row, line in row_lines:
        line_offset = overlay.index(line, search_from)
        search_from = line_offset + len(line)
        start = len(prior_content) + line_offset
        end = start + len(line)
        ranges.append({
            "id": str(row["rowId"]),
            "doc": "economy",
            "rangeKind": "PDF_NATIVE_BASELINE_ROW_CANDIDATE",
            "start": start,
            "end": end,
            "textSha256": _sha_text(line),
            "origin": "ORIGINAL_PDF_TEXT_LAYER_WITH_PADDLE_GEOMETRY_CORROBORATION",
            "sourcePdfSha256": source_rows["inputs"]["pdf"]["sha256"],
            "baselinePdfPoints": row["baselinePdfPoints"],
            "rowLabelText": row["rowLabel"]["text"],
            "rowLabelSourceOrigin": row["rowLabel"]["sourceOrigin"],
            "rowLabelPdfWordIndexes": [int(item["pdfWordIndex"]) for item in row["rowLabel"]["words"]],
            "rowLabelPaddleLiteralTokens": list(row["rowLabel"].get("paddleTextTokens", [])),
            "rowLabelLiteralDiscrepancyStatus": row["rowLabel"]["labelTextDiscrepancyStatus"],
            "cells": [
                {
                    "slot": int(cell["slot"]),
                    "pdfText": cell["pdfText"],
                    "pdfWordIndex": int(cell["pdfWordIndex"]),
                    "pdfBoxPoints": cell["pdfBoxPoints"],
                    "headerText": cell["header"]["text"],
                    "headerPdfWordIndex": int(cell["header"]["pdfWordIndex"]),
                    "headerBoundsPdfPoints": cell["header"]["slotBoundsPdfPoints"],
                    "paddleRecordIndex": int(cell["paddleCorroboration"]["recordIndex"]),
                    "paddleRawText": cell["paddleCorroboration"]["rawText"],
                    "paddleRawBoxPixels": cell["paddleCorroboration"]["rawBoxPixels"],
                }
                for cell in row["cells"]
            ],
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
        })
    ranges.sort(key=lambda item: (int(item["start"]), int(item["end"]), str(item["id"])))
    for source_range in ranges:
        start, end = int(source_range["start"]), int(source_range["end"])
        if start < 0 or end <= start or end > len(content):
            raise ValueError(f"native range bounds are invalid: {source_range['id']}")
        if _sha_text(content[start:end]) != source_range["textSha256"]:
            raise ValueError(f"native range exact text hash mismatch: {source_range['id']}")
    if not content.startswith(prior_content) or not content.startswith(baseline_content):
        raise ValueError("candidate does not preserve the exact prior repair and table prefixes")

    derived_arm = {
        "parser": "source-pdf-repair-plus-economy-rows-v1",
        "content": content,
        "ranges": ranges,
        "contentSha256": _sha_text(content),
        "packets": table_arm["packets"],
        "priorSourcePdfRepair": prior_source.get("sourceRepair"),
        "derivedRowProfile": {
            "sourceRows": len(records),
            "sourceValueCells": sum(len(row["cells"]) for row in records),
            "baselineTableContentSha256": table_arm["contentSha256"],
            "priorSourcePdfRepairContentSha256": _sha_text(prior_content),
            "sourceRowsSha256": hashes["pdfBaselineRows"],
            "tableContextYearIsUnbound": True,
            "legacySourceCellStatusesCarried": 0,
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
        },
    }
    return {
        "schema": "zuri.hyper-economy-pdf-row-native-input.v1",
        "profile": "prior-source-pdf-repair-plus-pdf-native-economy-rows",
        "controlFileSha256": base["controlFileSha256"],
        "arms": [plain_arm, table_arm, derived_arm],
        "candidateSidecarIncluded": False,
        "semanticStatus": "NOT_ASSESSED",
        "graphAdmission": "NONE",
        "goldQuestionsOrMetricsUsed": False,
        "modelCalls": 0,
    }


def main() -> None:
    inputs = {
        "baselineNativeInput": BASELINE_PATH,
        "priorNativeInput": PRIOR_NATIVE_PATH,
        "priorNativeFreeze": PRIOR_NATIVE_FREEZE_PATH,
        "priorProjection": PRIOR_PROJECTION_PATH,
        "priorProjectionFreeze": PRIOR_PROJECTION_FREEZE_PATH,
        "pdfBaselineRows": ROWS_PATH,
    }
    hashes = {name: _sha_bytes(path.read_bytes()) for name, path in inputs.items()}
    base = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    prior_native = json.loads(PRIOR_NATIVE_PATH.read_text(encoding="utf-8"))
    prior_native_freeze = json.loads(PRIOR_NATIVE_FREEZE_PATH.read_text(encoding="utf-8"))
    prior_projection = json.loads(PRIOR_PROJECTION_PATH.read_text(encoding="utf-8"))
    prior_projection_freeze = json.loads(PRIOR_PROJECTION_FREEZE_PATH.read_text(encoding="utf-8"))
    source_rows = json.loads(ROWS_PATH.read_text(encoding="utf-8"))
    if prior_native_freeze.get("nativeInputSha256") != hashes["priorNativeInput"]:
        raise SystemExit("prior native input differs from its sealed freeze")
    if prior_native_freeze.get("inputSha256", {}).get("baselineNativeInput") != hashes["baselineNativeInput"]:
        raise SystemExit("prior native freeze does not bind the current baseline input")
    if prior_native_freeze.get("inputSha256", {}).get("repairProjection") != hashes["priorProjection"]:
        raise SystemExit("prior native freeze does not bind its projection")
    if prior_native_freeze.get("inputSha256", {}).get("repairProjectionFreeze") != hashes["priorProjectionFreeze"]:
        raise SystemExit("prior native freeze does not bind its projection freeze")
    if prior_projection_freeze.get("projectionSha256") != hashes["priorProjection"]:
        raise SystemExit("prior source projection differs from its freeze")
    native_input = build_native_input(
        base,
        prior_native,
        prior_projection,
        source_rows,
        hashes={"pdfBaselineRows": hashes["pdfBaselineRows"]},
    )
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(native_input, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    derived_arm = next(arm for arm in native_input["arms"] if arm["parser"] == "source-pdf-repair-plus-economy-rows-v1")
    freeze = {
        "schema": "hyper-economy-pdf-row-native-input-freeze-v1",
        "profile": native_input["profile"],
        "inputPaths": {name: str(path.relative_to(REPO)).replace("\\", "/") for name, path in inputs.items()},
        "inputSha256": hashes,
        "nativeInputSha256": _sha_bytes(OUTPUT_PATH.read_bytes()),
        "arms": [
            {"parser": arm["parser"], "contentSha256": arm["contentSha256"], "contentChars": len(arm["content"]), "rangeCount": len(arm["ranges"])}
            for arm in native_input["arms"]
        ],
        "candidate": {
            "contentSha256": derived_arm["contentSha256"],
            "exactFrozenTablePrefixSha256": derived_arm["derivedRowProfile"]["baselineTableContentSha256"],
            "rowCount": derived_arm["derivedRowProfile"]["sourceRows"],
            "valueCellCount": derived_arm["derivedRowProfile"]["sourceValueCells"],
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
        },
        "implementationSha256": {"builder": _sha_bytes(Path(__file__).resolve().read_bytes())},
    }
    FREEZE_PATH.write_text(json.dumps(freeze, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"nativeInputSha256": freeze["nativeInputSha256"], "candidateContentSha256": derived_arm["contentSha256"], "chars": len(derived_arm["content"]), "ranges": len(derived_arm["ranges"]), "freezeSha256": _sha_bytes(FREEZE_PATH.read_bytes())}, sort_keys=True))


if __name__ == "__main__":
    main()
