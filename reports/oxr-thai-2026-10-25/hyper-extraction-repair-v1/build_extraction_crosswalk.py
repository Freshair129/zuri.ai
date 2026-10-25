"""Build a post-freeze diagnostic link from 93 model candidates to source cells.

The crosswalk never changes candidate status or source-native output. It is
created only after the all-row source-native enumeration/projection are frozen;
links require exact row labels, cell values and (for single-cell candidates)
exact source header paths contained in the candidate's emitting chunk.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _sha_text(text: str) -> str:
    return _sha256(text.encode("utf-8"))


def _span_in_chunk(span: dict[str, Any] | None, chunk: dict[str, Any]) -> bool:
    if not span:
        return False
    try:
        start, end = int(span["start"]), int(span["end"])
        return start < end and int(chunk["sourceStart"]) <= start and end <= int(chunk["sourceEnd"])
    except (KeyError, TypeError, ValueError):
        return False


def _span_receipt(span: dict[str, Any] | None) -> dict[str, Any] | None:
    if not span:
        return None
    return {
        "rangeId": span.get("rangeId"),
        "zoneId": span.get("zoneId"),
        "start": span.get("start"),
        "end": span.get("end"),
        "quote": span.get("quote"),
    }


def _span_exact_in_range(
    span: dict[str, Any] | None,
    source_range: dict[str, Any],
    expected: str | None = None,
) -> bool:
    if not span or str(span.get("rangeId")) != str(source_range.get("id")):
        return False
    try:
        start, end = int(span["start"]), int(span["end"])
        base = int(source_range["sourceStart"])
        raw = str(source_range["text"])
        quote = str(span["quote"])
    except (KeyError, TypeError, ValueError):
        return False
    if start < base or end > base + len(raw) or start >= end:
        return False
    actual = raw[start - base:end - base]
    return actual == quote and (expected is None or quote == expected)


def _make_candidate_index(receipt: dict[str, Any]) -> dict[str, tuple[dict[str, Any], dict[str, Any]]]:
    index: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for document in receipt.get("documents", []):
        source_id = str(document["sourceId"])
        for chunk in document.get("chunks", []):
            chunk_index = int(chunk["chunkIndex"])
            input_text = str(chunk.get("inputText", ""))
            if _sha_text(input_text) != chunk.get("textSha256"):
                raise ValueError(f"Frozen candidate chunk text hash mismatch: {source_id}:{chunk_index}")
            for fact_index, fact in enumerate(chunk.get("facts", [])):
                candidate_id = f"{source_id}:{chunk_index}:fact:{fact_index}"
                if candidate_id in index:
                    raise ValueError(f"Duplicate candidate ID in frozen receipt: {candidate_id}")
                index[candidate_id] = (chunk, fact)
    return index


def _index_source_cells(enumeration: dict[str, Any]) -> tuple[dict[tuple[str, str, int, int], list[dict[str, Any]]], dict[tuple[str, str, int, int], dict[str, Any]], dict[tuple[str, str, int], dict[str, Any]]]:
    cells_by_row: dict[tuple[str, str, int, int], list[dict[str, Any]]] = defaultdict(list)
    rows_by_key: dict[tuple[str, str, int, int], dict[str, Any]] = {}
    tables_by_key: dict[tuple[str, str, int], dict[str, Any]] = {}
    for table in enumeration.get("tables", []):
        table_key = (str(table.get("documentId")), str(table.get("tableId")), int(table.get("page", -1)))
        tables_by_key[table_key] = table
        for row in table.get("rows", []):
            key = (str(row["documentId"]), str(row["tableId"]), int(row["page"]), int(row["sourceRow"]))
            if key in rows_by_key:
                raise ValueError(f"Duplicate source-native row key: {key}")
            rows_by_key[key] = row
        for cell in table.get("cells", []):
            key = (str(cell["documentId"]), str(cell["tableId"]), int(cell["page"]), int(cell["sourceRow"]))
            cells_by_row[key].append(cell)
    for row_cells in cells_by_row.values():
        row_cells.sort(key=lambda c: (int(c.get("sourceCell", -1)), str(c.get("recordId", ""))))
    return cells_by_row, rows_by_key, tables_by_key


def _source_header_spans(
    *,
    bundle: dict[str, Any],
    table_id: str,
    source_range: dict[str, Any],
    chunk: dict[str, Any],
    quote: str,
) -> list[dict[str, Any]]:
    """Locate exact serialized header-cell spans in this table and chunk."""
    matches: list[dict[str, Any]] = []
    pattern = re.compile(r"^h(?P<row>\d+) c(?P<columns>\d+(?:-\d+)?)=(?P<text>.*)$")
    base = int(source_range["sourceStart"])
    for zone in bundle.get("zones", []):
        if zone.get("kind") != "table-row" or zone.get("rangeId") != source_range.get("id"):
            continue
        packet = zone.get("packet", {})
        if str(packet.get("tableId")) != table_id:
            continue
        zone_start = int(zone["sourceStart"])
        if int(zone["sourceEnd"]) <= int(chunk["sourceStart"]) or zone_start >= int(chunk["sourceEnd"]):
            continue
        raw_zone = str(zone["text"])
        local_offset = 0
        for line in raw_zone.splitlines(keepends=True):
            line_value = line.rstrip("\r\n")
            match = pattern.fullmatch(line_value)
            if match and match.group("text") == quote:
                start = zone_start + local_offset + line_value.index("=") + 1
                span = {
                    "rangeId": str(source_range["id"]),
                    "zoneId": str(zone["id"]),
                    "start": start,
                    "end": start + len(quote),
                    "quote": quote,
                }
                if _span_exact_in_range(span, source_range, quote) and _span_in_chunk(span, chunk):
                    matches.append({
                        "sourceSpan": span,
                        "tableId": table_id,
                        "headerRow": int(match.group("row")),
                        "serializedColumns": match.group("columns"),
                    })
            local_offset += len(line)
    unique: dict[tuple[int, int], dict[str, Any]] = {}
    for item in matches:
        span = item["sourceSpan"]
        unique[(int(span["start"]), int(span["end"]))] = item
    return [unique[key] for key in sorted(unique)]


def build_crosswalk(
    *,
    audit: dict[str, Any],
    candidate_receipt: dict[str, Any],
    enumeration: dict[str, Any],
    bundle: dict[str, Any],
) -> dict[str, Any]:
    """Link diagnostic audit IDs to exact frozen source-native cells."""
    candidates = _make_candidate_index(candidate_receipt)
    cells_by_row, rows_by_key, tables_by_key = _index_source_cells(enumeration)
    ranges = {str(r["id"]): r for r in bundle.get("sourceRanges", [])}
    records: list[dict[str, Any]] = []
    id_counts: Counter[str] = Counter()
    source_links: Counter[str] = Counter()
    by_doc: Counter[str] = Counter()

    for audit_record in audit.get("records", []):
        candidate_id = str(audit_record["candidateId"])
        if candidate_id not in candidates:
            raise ValueError(f"Audit candidate is absent from frozen candidate receipt: {candidate_id}")
        chunk, fact = candidates[candidate_id]
        source_id = str(audit_record["sourceId"])
        if source_id not in ranges or fact.get("subject") != audit_record.get("candidateFields", {}).get("subject"):
            raise ValueError(f"Audit/candidate binding mismatch: {candidate_id}")
        if int(chunk["chunkIndex"]) != int(audit_record["chunkIndex"]):
            raise ValueError(f"Audit/candidate chunk binding mismatch: {candidate_id}")
        for field in ("predicate", "value", "description", "headerQuote"):
            if fact.get(field) != audit_record.get("candidateFields", {}).get(field):
                raise ValueError(f"Audit/candidate {field} mismatch: {candidate_id}")
        source_range = ranges[source_id]
        chunk_start, chunk_end = int(chunk["sourceStart"]), int(chunk["sourceEnd"])
        if chunk_start < int(source_range["sourceStart"]) or chunk_end > int(source_range["sourceEnd"]):
            raise ValueError(f"Candidate chunk is outside its frozen source range: {candidate_id}")
        expected_chunk_text = str(source_range["text"])[chunk_start - int(source_range["sourceStart"]):chunk_end - int(source_range["sourceStart"])]
        if expected_chunk_text != str(chunk["inputText"]):
            raise ValueError(f"Candidate chunk is not an exact frozen source-range slice: {candidate_id}")

        subject = str(fact.get("subject", ""))
        value = str(fact.get("value", ""))
        header_quote = str(fact.get("headerQuote", ""))
        row_value_matches: list[dict[str, Any]] = []
        header_bound_matches: list[dict[str, Any]] = []
        exact_sequence_matches: list[list[dict[str, Any]]] = []
        row_matches: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []

        for row_key, source_row in rows_by_key.items():
            doc, table_id, page, row_index = row_key
            if doc != source_id or source_row.get("labelText") != subject:
                continue
            row_cells = cells_by_row.get(row_key, [])
            value_cells = [c for c in row_cells if c.get("recordType") == "TABLE_VALUE_CELL"]
            label_cells = [c for c in row_cells if c.get("recordType") == "ROW_LABEL_CELL"]
            if len(label_cells) != 1:
                continue
            label_span = label_cells[0].get("sourceSpan")
            if not _span_exact_in_range(label_span, source_range, subject) or not _span_in_chunk(label_span, chunk):
                continue
            row_matches.append((source_row, value_cells))
            table = tables_by_key.get((doc, table_id, page), {})
            candidate_header_source_spans = _source_header_spans(
                bundle=bundle,
                table_id=table_id,
                source_range=source_range,
                chunk=chunk,
                quote=header_quote,
            ) if header_quote else []
            for cell in value_cells:
                value_span = cell.get("sourceSpan")
                if cell.get("text") != value or not _span_exact_in_range(value_span, source_range, value) or not _span_in_chunk(value_span, chunk):
                    continue
                header_matches = [
                    h for h in cell.get("resolvedHeaderPath", [])
                    if h.get("text") == header_quote
                    and cell.get("status") == "SOURCE_CELL_STRUCTURALLY_RESOLVED"
                    and _span_exact_in_range(h.get("sourceSpan"), source_range, header_quote)
                    and _span_in_chunk(h.get("sourceSpan"), chunk)
                ]
                item = {
                    "sourceCellRecordId": cell["recordId"],
                    "sourceCellStatus": cell.get("status"),
                    "semanticStatus": "NOT_ASSESSED",
                    "rowSourceRecordId": source_row["recordId"],
                    "rowLabelSourceSpan": _span_receipt(label_span),
                    "valueSourceSpan": _span_receipt(value_span),
                    "headerMatches": [
                        {"text": h["text"], "sourceSpan": _span_receipt(h.get("sourceSpan"))}
                        for h in header_matches
                    ],
                    "candidateHeaderSourceSpans": candidate_header_source_spans,
                    "candidateHeaderStatus": (
                        "HEADER_MATCHES_RESOLVED_CELL_PATH" if header_matches
                        else "SOURCE_HEADER_PRESENT_BUT_BINDING_HELD_OR_NOT_FOR_THIS_CELL" if candidate_header_source_spans
                        else "CANDIDATE_HEADER_NOT_PRESENT_IN_SOURCE_ROW"
                    ),
                    "sourceCellHeaderStatus": cell.get("headerStatus"),
                    "sourceCellHoldReasons": cell.get("holdReasons", []),
                    "allEvidenceOffsetsInsideEmittingChunk": bool(header_matches),
                }
                row_value_matches.append(item)
                if header_matches:
                    header_bound_matches.append(item)

            candidate_parts = value.split("\t")
            if len(candidate_parts) > 1 and all(candidate_parts):
                for start_index in range(0, len(value_cells) - len(candidate_parts) + 1):
                    window = value_cells[start_index:start_index + len(candidate_parts)]
                    if [str(c.get("text", "")) for c in window] != candidate_parts:
                        continue
                    if not all(_span_in_chunk(c.get("sourceSpan"), chunk) for c in window) or not _span_in_chunk(label_span, chunk):
                        continue
                    if all(_span_exact_in_range(c.get("sourceSpan"), source_range, str(c.get("text", ""))) for c in window):
                        exact_sequence_matches.append(window)

        chosen_ids: list[str] = []
        if len(header_bound_matches) == 1:
            chosen_ids = [str(header_bound_matches[0]["sourceCellRecordId"])]
            link_status = "EXACT_SUBJECT_VALUE_HEADER_CELL_CANDIDATE"
        elif len(header_bound_matches) > 1:
            chosen_ids = sorted({str(x["sourceCellRecordId"]) for x in header_bound_matches})
            link_status = "AMBIGUOUS_MULTIPLE_EXACT_SUBJECT_VALUE_HEADER_CELLS"
        elif len(exact_sequence_matches) == 1:
            chosen_ids = [str(c["recordId"]) for c in exact_sequence_matches[0]]
            link_status = "EXACT_SUBJECT_FULL_ROW_VALUE_SEQUENCE"
        elif len(exact_sequence_matches) > 1:
            chosen_ids = sorted({str(c["recordId"]) for seq in exact_sequence_matches for c in seq})
            link_status = "AMBIGUOUS_MULTIPLE_EXACT_ROW_SEQUENCES"
        elif row_value_matches:
            chosen_ids = sorted({str(x["sourceCellRecordId"]) for x in row_value_matches})
            link_status = "EXACT_SUBJECT_VALUE_CELL_HEADER_UNRESOLVED"
        elif row_matches:
            link_status = "EXACT_SUBJECT_ROW_NO_EXACT_VALUE_CELL"
        else:
            link_status = "NO_EXACT_SOURCE_NATIVE_ROW_CELL_MATCH"

        unique_ids = list(dict.fromkeys(chosen_ids))
        id_counts.update(unique_ids)
        source_links[source_id] += len(unique_ids)
        by_doc[source_id] += 1
        records.append({
            "candidateId": candidate_id,
            "sourceId": source_id,
            "chunkIndex": int(chunk["chunkIndex"]),
            "candidateFactIndex": int(candidate_id.rsplit(":fact:", 1)[1]),
            "candidateFields": {
                "subject": subject,
                "predicate": fact.get("predicate"),
                "value": value,
                "description": fact.get("description"),
                "headerQuote": header_quote,
            },
            "candidateEvidenceQuote": fact.get("evidenceQuote"),
            "candidateRowQuote": fact.get("rowQuote"),
            "emittingChunk": {
                "sourceStart": chunk_start,
                "sourceEnd": chunk_end,
                "textSha256": chunk.get("textSha256"),
                "sourceSliceExact": True,
            },
            "auditSubtypeDiagnosticOnly": audit_record.get("primaryRootCause", {}).get("subtype"),
            "originalV6Status": audit_record.get("frozenValidator", {}).get("v6Status"),
            "sourceCellRecordIds": unique_ids,
            "sourceCellMatches": row_value_matches,
            "fullyBoundSingleCellMatches": [x for x in header_bound_matches],
            "fullRowSequenceMatches": [
                [str(c["recordId"]) for c in sequence]
                for sequence in exact_sequence_matches
            ],
            "linkStatus": link_status,
            "candidateDispositionChanged": False,
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
        })

    duplicate_links = sum(max(0, count - 1) for count in id_counts.values())
    subtype_counts = Counter(str(r.get("auditSubtypeDiagnosticOnly", "unspecified")) for r in records)
    duplicate_subtype = [r for r in records if r.get("auditSubtypeDiagnosticOnly") == "duplicate_fact_emission"]
    duplicate_subtype_with_links = sum(bool(r["sourceCellRecordIds"]) for r in duplicate_subtype)
    summary = {
        "candidateCount": len(records),
        "candidateCountBySource": dict(sorted(by_doc.items())),
        "auditSubtypeCountsDiagnosticOnly": dict(sorted(subtype_counts.items())),
        "linkStatusCounts": dict(sorted(Counter(r["linkStatus"] for r in records).items())),
        "candidateHeaderStatusCountsWithinExactSubjectValueCellMatches": dict(sorted(Counter(
            match["candidateHeaderStatus"] for record in records for match in record["sourceCellMatches"]
        ).items())),
        "candidatesWithAtLeastOneSourceCellLink": sum(bool(r["sourceCellRecordIds"]) for r in records),
        "uniqueSourceCellRecordIdsLinked": len(id_counts),
        "candidateToSourceCellLinks": sum(len(r["sourceCellRecordIds"]) for r in records),
        "duplicateCandidateLinksToAlreadyLinkedCell": duplicate_links,
        "duplicateSubtypeCandidateCountDiagnosticOnly": len(duplicate_subtype),
        "duplicateSubtypeCandidatesWithSourceCellLinks": duplicate_subtype_with_links,
        "semanticStatus": "NOT_ASSESSED",
        "graphAdmission": "NONE",
    }
    return {
        "schema": "hyper-extraction-source-native-crosswalk-v1",
        "purpose": "post-freeze diagnostic crosswalk; no candidate status or native selection is changed",
        "origin": "MODEL_CANDIDATE_TO_SOURCE_NATIVE_DIAGNOSTIC_LINK",
        "candidateOutputUsedForSourceEnumeration": False,
        "crosswalkCreatedAfterSourceNativeFreeze": True,
        "candidateIdsUsedOnlyForDiagnosticJoin": True,
        "goldQuestionsOrMetricsUsed": False,
        "modelCalls": 0,
        "semanticStatus": "NOT_ASSESSED",
        "graphAdmission": "NONE",
        "summary": summary,
        "records": records,
    }


def main() -> None:
    root = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
    raw = root / ".local/hyper-extraction-repair-20261025"
    report = root / "reports/oxr-thai-2026-10-25/hyper-extraction-repair-v1"
    run5 = root / ".local/hyper-relation-audit-20261025/run-5"
    audit_path = report / "extraction-audit.json"
    candidate_path = run5 / "evidence-candidates.json"
    run_freeze_path = run5 / "freeze.json"
    chunks_path = run5 / "chunks.json"
    enumeration_path = raw / "source-native-enumeration.json"
    enumeration_freeze_path = raw / "source-native-freeze.json"
    projection_path = raw / "source-native-projection.json"
    projection_freeze_path = raw / "source-native-projection-freeze.json"
    bundle_path = run5 / "source-bundle.json"
    output_path = raw / "extraction-crosswalk.json"
    freeze_path = raw / "extraction-crosswalk-freeze.json"

    files = {
        "audit": audit_path,
        "candidateReceipt": candidate_path,
        "candidateFreeze": run_freeze_path,
        "candidateChunks": chunks_path,
        "sourceNativeEnumeration": enumeration_path,
        "sourceNativeFreeze": enumeration_freeze_path,
        "sourceNativeProjection": projection_path,
        "sourceNativeProjectionFreeze": projection_freeze_path,
        "sourceBundle": bundle_path,
    }
    hashes = {name: _sha256(path.read_bytes()) for name, path in files.items()}
    load = lambda path: json.loads(path.read_text(encoding="utf-8"))
    audit, receipt = load(audit_path), load(candidate_path)
    enumeration, native_freeze = load(enumeration_path), load(enumeration_freeze_path)
    projection, projection_freeze = load(projection_path), load(projection_freeze_path)
    bundle = load(bundle_path)
    if enumeration.get("freezeSha256") != hashes["sourceNativeFreeze"]:
        raise SystemExit("Source-native enumeration does not match its freeze file")
    if projection_freeze.get("sourceNativeFreezeSha256") != hashes["sourceNativeFreeze"]:
        raise SystemExit("Projection does not bind the current source-native freeze")
    if projection_freeze.get("sourceNativeEnumerationSha256") != hashes["sourceNativeEnumeration"]:
        raise SystemExit("Projection does not bind the current source-native enumeration")
    if projection_freeze.get("sourceNativeProjectionSha256") != hashes["sourceNativeProjection"]:
        raise SystemExit("Projection text does not match its freeze")
    run_freeze = load(run_freeze_path)
    if receipt.get("sourceBundleSha256") != run_freeze.get("source", {}).get("sourceBundleSha256"):
        raise SystemExit("Frozen candidate receipt content hash differs from its run freeze")
    if run_freeze.get("source", {}).get("sourceBundleFileSha256") != hashes["sourceBundle"]:
        raise SystemExit("Run freeze file hash differs from the frozen source-bundle bytes")
    if receipt.get("freezeSha256") != hashes["candidateFreeze"]:
        raise SystemExit("Frozen candidate receipt does not bind the run freeze")
    if receipt.get("chunksFileSha256") != hashes["candidateChunks"]:
        raise SystemExit("Frozen candidate receipt does not bind the chunk manifest")
    if native_freeze.get("inputSha256", {}).get("sourceBundle") != hashes["sourceBundle"]:
        raise SystemExit("Source-native freeze does not bind the source bundle")
    crosswalk = build_crosswalk(audit=audit, candidate_receipt=receipt, enumeration=enumeration, bundle=bundle)
    crosswalk["inputSha256"] = hashes
    crosswalk["sourceNativeFreezeSha256"] = hashes["sourceNativeFreeze"]
    crosswalk["sourceNativeProjectionFreezeSha256"] = hashes["sourceNativeProjectionFreeze"]
    crosswalk["candidateReceiptSha256"] = hashes["candidateReceipt"]
    crosswalk["sourceBundleContentSha256"] = receipt["sourceBundleSha256"]
    crosswalk["sourceBundleFileSha256"] = hashes["sourceBundle"]
    output_path.write_text(json.dumps(crosswalk, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    freeze = {
        "schema": "hyper-extraction-source-native-crosswalk-freeze-v1",
        "crosswalkSha256": _sha256(output_path.read_bytes()),
        "crosswalkBuilderSha256": _sha256(Path(__file__).resolve().read_bytes()),
        "crosswalkTestsSha256": _sha256((report / "test_extraction_crosswalk.py").read_bytes()),
        "inputSha256": hashes,
        "policy": {
            "createdAfterSourceNativeProjectionFreeze": True,
            "candidateIDsAffectSourceEnumeration": False,
            "candidateIDsAffectNativeProjection": False,
            "auditLabelsAffectLinks": False,
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
        },
    }
    freeze_path.write_text(json.dumps(freeze, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    freeze["freezeFileSha256"] = _sha256(freeze_path.read_bytes())
    print(json.dumps({"freeze": freeze["freezeFileSha256"], "summary": crosswalk["summary"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
