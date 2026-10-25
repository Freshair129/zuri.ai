"""Build a row-preserving TEXT projection from source-native cell references."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def _sha_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _quoted(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def build_source_projection(enumeration: dict[str, Any], bundle: dict[str, Any]) -> dict[str, Any]:
    """Preserve complete frozen ranges and add structural frames to table rows.

    Non-table zones, gaps, and all table-row text are copied from the exact
    sourceRange text in source order. Generated frames follow table-row zones;
    none of their labels are semantic or graph admissions.
    """
    zones = list(bundle.get("zones", []))
    zones_by_id = {str(z["id"]): z for z in zones}
    all_rows = [r for table in enumeration.get("tables", []) for r in table.get("rows", [])]
    all_cells = [c for table in enumeration.get("tables", []) for c in table.get("cells", [])]
    rows_by_zone: dict[str, dict[str, Any]] = {}
    cells_by_key: dict[tuple[str, str, int, int], list[dict[str, Any]]] = {}
    for row in all_rows:
        zone_id = str((row.get("rowSourceSpan") or {}).get("zoneId", ""))
        if not zone_id or zone_id in rows_by_zone:
            raise ValueError(f"Missing or duplicate table-row zone identity: {zone_id}")
        rows_by_zone[zone_id] = row
    for cell in all_cells:
        key = (str(cell["documentId"]), str(cell["tableId"]), int(cell["page"]), int(cell["sourceRow"]))
        cells_by_key.setdefault(key, []).append(cell)

    table_zone_ids = {str(z["id"]) for z in zones if z.get("kind") == "table-row"}
    if table_zone_ids != set(rows_by_zone):
        raise ValueError("Source-native rows do not cover exactly the frozen table-row zones")
    source_ranges = list(bundle.get("sourceRanges", []))
    if not source_ranges:
        raise ValueError("Frozen source ranges are required to conserve full source text")

    snippets: list[dict[str, Any]] = []
    source_gaps: list[dict[str, Any]] = []
    source_range_records: list[dict[str, Any]] = []
    text_parts: list[str] = []
    cursor = 0
    source_zone_chars = 0
    source_range_chars = 0
    gap_chars = 0
    generated_chars = 0
    resolved_value_count = 0
    unqualified_context_count = 0
    non_table_zone_count = 0
    seen_zones: set[str] = set()

    for source_range in source_ranges:
        range_id = str(source_range["id"])
        source_start = int(source_range["sourceStart"])
        raw_range = str(source_range["text"])
        source_end = int(source_range.get("sourceEnd", source_start + len(raw_range)))
        if source_end - source_start != len(raw_range):
            raise ValueError(f"Source range offsets do not match exact text length: {range_id}")
        range_projection_start = cursor
        local_cursor = source_start
        reconstructed: list[str] = []
        range_zones = sorted(
            [z for z in zones if str(z.get("rangeId")) == range_id],
            key=lambda z: (int(z["sourceStart"]), int(z["sourceEnd"]), str(z["id"])),
        )
        for zone in range_zones:
            zone_id = str(zone["id"])
            if zone_id in seen_zones:
                raise ValueError(f"Duplicate frozen source zone: {zone_id}")
            seen_zones.add(zone_id)
            z_start, z_end = int(zone["sourceStart"]), int(zone["sourceEnd"])
            if z_start < local_cursor or z_end < z_start or z_end > source_end:
                raise ValueError(f"Invalid or overlapping source-zone bounds: {zone_id}")
            expected_zone = raw_range[z_start - source_start:z_end - source_start]
            raw_zone = str(zone["text"])
            if raw_zone != expected_zone or len(raw_zone) != z_end - z_start:
                raise ValueError(f"Frozen source zone differs from its exact range slice: {zone_id}")

            gap = raw_range[local_cursor - source_start:z_start - source_start]
            if gap:
                gap_projection_start = cursor
                text_parts.append(gap)
                cursor += len(gap)
                reconstructed.append(gap)
                source_gaps.append({
                    "rangeId": range_id,
                    "sourceStart": local_cursor,
                    "sourceEnd": z_start,
                    "textSha256": _sha_text(gap),
                    "projectionStart": gap_projection_start,
                    "projectionEnd": cursor,
                })
                gap_chars += len(gap)

            snippet_start = cursor
            text_parts.append(raw_zone)
            cursor += len(raw_zone)
            reconstructed.append(raw_zone)
            source_zone_chars += len(raw_zone)
            frame = ""
            row = rows_by_zone.get(zone_id)
            value_refs: list[dict[str, Any]] = []
            row_cells: list[dict[str, Any]] = []
            if zone.get("kind") == "table-row":
                if row is None:
                    raise ValueError(f"Missing source-native row record for {zone_id}")
                if zone.get("packet", {}).get("tableId") != row["tableId"] or int(zone.get("packet", {}).get("row", -1)) != int(row["sourceRow"]):
                    raise ValueError(f"Source row zone identity mismatch for {row.get('recordId')}")
                zone_ref = row.get("rowSourceSpan") or {}
                if zone_ref.get("zoneTextSha256") and _sha_text(raw_zone) != zone_ref["zoneTextSha256"]:
                    raise ValueError(f"Frozen source-zone hash mismatch: {zone_id}")
                if row.get("rowText") and row["rowText"] not in raw_zone:
                    raise ValueError(f"Exact row text is absent from source zone {zone_id}")
                key = (str(row["documentId"]), str(row["tableId"]), int(row["page"]), int(row["sourceRow"]))
                row_cells = cells_by_key.get(key, [])
                value_refs = [
                    c for c in row_cells
                    if c.get("recordType") == "TABLE_VALUE_CELL"
                    and c.get("status") == "SOURCE_CELL_STRUCTURALLY_RESOLVED"
                    and c.get("sourceSpan")
                    and c.get("resolvedHeaderPath")
                ]
                value_refs.sort(key=lambda c: (int(c["gridColumn"]), int(c["sourceCell"])))
                for cell in value_refs:
                    if cell["sourceSpan"].get("quote") != cell["text"]:
                        raise ValueError(f"Source-cell quote mismatch: {cell['recordId']}")
                    label_span = cell.get("rowLabelSourceSpan")
                    if not label_span or label_span.get("quote") != cell.get("rowLabelText"):
                        raise ValueError(f"Source row-label quote mismatch: {cell['recordId']}")
                    for header in cell["resolvedHeaderPath"]:
                        if not header.get("sourceSpan") or header["sourceSpan"].get("quote") != header["text"]:
                            raise ValueError(f"Header quote/span mismatch: {cell['recordId']}")
                cell_context_count = max(0, len(row_cells) - len(value_refs))
                resolved_value_count += len(value_refs)
                unqualified_context_count += cell_context_count
                frame_lines = [
                    "[GENERATED SOURCE-CELL BINDINGS; structural only; semantic=NOT_ASSESSED; graph=NONE]",
                ]
                if value_refs:
                    frame_lines.append(f"row-label={_quoted(str(value_refs[0].get('rowLabelText') or ''))}")
                frame_lines.append(f"unqualified-row-cells={cell_context_count}")
                for cell in value_refs:
                    header_labels = " > ".join(_quoted(str(h["text"])) for h in cell["resolvedHeaderPath"])
                    frame_lines.append(
                        f"c{int(cell['gridColumn'])} | header=[{header_labels}] | cell={_quoted(str(cell['text']))}"
                    )
                frame_lines.append("[END GENERATED BINDINGS]")
                frame = "\n".join(frame_lines) + "\n"
                if not raw_zone.endswith("\n"):
                    frame = "\n" + frame
                text_parts.append(frame)
                cursor += len(frame)
                generated_chars += len(frame)
            else:
                non_table_zone_count += 1
                cell_context_count = 0

            snippet_end = cursor
            snippets.append({
                "sourceRowRecordId": row["recordId"] if row else None,
                "documentId": str(zone["rangeId"]),
                "tableId": row["tableId"] if row else None,
                "page": row["page"] if row else None,
                "sourceRow": row["sourceRow"] if row else None,
                "zoneId": zone_id,
                "zoneKind": str(zone["kind"]),
                "sourceStart": z_start,
                "sourceEnd": z_end,
                "sourceTextChars": len(raw_zone),
                "sourceTextSha256": _sha_text(raw_zone),
                "projectionStart": snippet_start,
                "projectionEnd": snippet_end,
                "projectionTextSha256": _sha_text("".join(text_parts)[snippet_start:snippet_end]),
                "resolvedCellRecordIds": [c["recordId"] for c in value_refs],
                "resolvedValueCellCount": len(value_refs),
                "unqualifiedContextCellCount": cell_context_count,
                "fullSourceRowZoneIncluded": zone.get("kind") == "table-row",
                "nonTableZoneContextOnly": zone.get("kind") != "table-row",
                "semanticStatus": "NOT_ASSESSED",
            })
            local_cursor = z_end

        tail = raw_range[local_cursor - source_start:]
        if tail:
            gap_projection_start = cursor
            text_parts.append(tail)
            cursor += len(tail)
            reconstructed.append(tail)
            source_gaps.append({
                "rangeId": range_id,
                "sourceStart": local_cursor,
                "sourceEnd": source_end,
                "textSha256": _sha_text(tail),
                "projectionStart": gap_projection_start,
                "projectionEnd": cursor,
            })
            gap_chars += len(tail)
        if "".join(reconstructed) != raw_range:
            raise ValueError(f"Source range was not reconstructed exactly: {range_id}")
        source_range_chars += len(raw_range)
        source_range_records.append({
            "rangeId": range_id,
            "sourceStart": source_start,
            "sourceEnd": source_end,
            "sourceTextChars": len(raw_range),
            "sourceTextSha256": _sha_text(raw_range),
            "projectionStart": range_projection_start,
            "projectionEnd": cursor,
            "sourceRangeReconstructedExactly": True,
        })

    if seen_zones != set(zones_by_id):
        raise ValueError("Some frozen source zones are absent from source ranges")
    if len([s for s in snippets if s["zoneKind"] == "table-row"]) != len(all_rows):
        raise ValueError("Not every frozen source packet produced a row-preserving range")

    text = "".join(text_parts)
    if source_range_chars != sum(len(str(r["text"])) for r in source_ranges):
        raise ValueError("Frozen source-range character accounting mismatch")

    return {
        "schema": "hyper-source-native-projection-v1",
        "profile": "all-frozen-rows-plus-source-native-structural-cell-references",
        "sourceNativeFreezeSha256": enumeration["freezeSha256"],
        "sourceNativeEnumerationSha256": None,
        "sourceBundleSha256": enumeration["sourceBundleSha256"],
        "tableSidecarSha256": enumeration["tableSidecarSha256"],
        "paddleRawSha256": enumeration["paddleRawSha256"],
        "text": text,
        "textSha256": _sha_text(text),
        "snippets": snippets,
        "sourceGaps": source_gaps,
        "sourceRanges": source_range_records,
        "summary": {
            "sourceRowsIncluded": sum(s["zoneKind"] == "table-row" for s in snippets),
            "sourceRowsWithResolvedValueCells": sum(s["zoneKind"] == "table-row" and s["resolvedValueCellCount"] > 0 for s in snippets),
            "sourceZonesIncluded": len(snippets),
            "nonTableContextZonesIncluded": non_table_zone_count,
            "sourceCellRecords": len(all_cells),
            "resolvedCellCandidates": resolved_value_count,
            "contextCellsIncludedButUnqualified": unqualified_context_count,
            "rawSourceZoneChars": source_zone_chars,
            "sourceRangeGapChars": gap_chars,
            "rawSourceRangeChars": source_range_chars,
            "generatedFramingChars": generated_chars,
            "projectionChars": len(text),
            "sourceChars": int(bundle.get("sourceChars", 0)),
            "rawZoneCoveragePct": round(100 * source_zone_chars / max(1, int(bundle.get("sourceChars", 0))), 2),
            "rawRangeCoveragePct": round(100 * source_range_chars / max(1, sum(len(str(r["text"])) for r in source_ranges)), 2),
            "sourceRangesReconstructedExactly": all(r["sourceRangeReconstructedExactly"] for r in source_range_records),
            "completeLiteralHeaderAndRowContextKept": True,
            "headerCellGridUsedAsSemanticAuthority": False,
            "sourceTextModified": False,
            "semanticStatus": "NOT_ASSESSED",
            "candidateGraphIncluded": False,
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
        },
        "origin": "SOURCE_NATIVE_TABLE_CELL",
        "candidateGraphIncluded": False,
        "semanticStatus": "NOT_ASSESSED",
        "goldQuestionsOrMetricsUsed": False,
        "modelCalls": 0,
    }


def main() -> None:
    root = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
    raw = root / ".local/hyper-extraction-repair-20261025"
    report = root / "reports/oxr-thai-2026-10-25/hyper-extraction-repair-v1"
    enumeration_path = raw / "source-native-enumeration.json"
    bundle_path = root / ".local/hyper-relation-audit-20261025/run-5/source-bundle.json"
    output_path = raw / "source-native-projection.json"
    freeze_path = raw / "source-native-projection-freeze.json"
    enumeration = json.loads(enumeration_path.read_text(encoding="utf-8"))
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    bundle_file_sha = hashlib.sha256(bundle_path.read_bytes()).hexdigest()
    if bundle_file_sha != enumeration["sourceBundleSha256"]:
        raise SystemExit("Source bundle file digest differs from enumeration freeze")
    projection = build_source_projection(enumeration, bundle)
    projection["sourceNativeEnumerationSha256"] = hashlib.sha256(enumeration_path.read_bytes()).hexdigest()
    output_path.write_text(json.dumps(projection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    freeze = {
        "schema": "hyper-source-native-projection-freeze-v1",
        "profile": projection["profile"],
        "sourceNativeFreezeSha256": enumeration["freezeSha256"],
        "sourceNativeEnumerationSha256": projection["sourceNativeEnumerationSha256"],
        "sourceBundleSha256": enumeration["sourceBundleSha256"],
        "sourceNativeProjectionSha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
        "implementationSha256": {
            "sourceNative": hashlib.sha256((report / "source_native.py").read_bytes()).hexdigest(),
            "prepareSourceNative": hashlib.sha256((report / "prepare_source_native.py").read_bytes()).hexdigest(),
            "projectionBuilder": hashlib.sha256(Path(__file__).resolve().read_bytes()).hexdigest(),
        },
        "policy": {
            "allSourceRowsIncluded": True,
            "onlySourceNativeResolvedCellReferencesListed": True,
            "rawRowAndHeaderZoneCopiedUnmodified": True,
            "heldValuesRemainContextOnly": True,
            "graphAdmission": "NONE",
            "semanticStatus": "NOT_ASSESSED",
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
        },
    }
    freeze_path.write_text(json.dumps(freeze, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    freeze["freezeFileSha256"] = hashlib.sha256(freeze_path.read_bytes()).hexdigest()
    print(json.dumps({"freeze": freeze["freezeFileSha256"], "summary": projection["summary"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
