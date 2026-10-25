"""Revalidate the frozen run-5 fact set using exact cells and Paddle OCR boxes.

No model calls, QA inputs, gold data, manual per-candidate decisions, or OCR edits.
Outputs are confined to this task's ignored experiment directory/report folder.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from geometry_binding import exact_source_span_in_chunk, resolve_geometry_binding


ROOT = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
OUT = ROOT / ".local/hyper-fact-audit-20261025"
REPORT = ROOT / "reports/oxr-thai-2026-10-25/hyper-fact-audit-v1"
RUN5 = ROOT / ".local/hyper-relation-audit-20261025/run-5"
V6 = ROOT / ".local/hyper-relation-audit-20261025/run-5-validator-v6"
SIDECAR = ROOT / ".local/thai-table-chunking-20261025/run-v2/table-sidecar.json"
PADDLE = ROOT / ".local/thai-native-20261025/paddle-2"

INPUTS = {
    "candidates": RUN5 / "evidence-candidates.json",
    "sourceBundle": RUN5 / "source-bundle.json",
    "chunks": RUN5 / "chunks.json",
    "v6Validation": V6 / "validated-evidence.json",
    "tableSidecar": SIDECAR,
    "economyPaddle": PADDLE / "economy.json",
    "populationPaddle": PADDLE / "population.json",
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def all_occurrences(text: str, needle: str) -> list[tuple[int, int]]:
    if not needle:
        return []
    found: list[tuple[int, int]] = []
    start = 0
    while True:
        i = text.find(needle, start)
        if i < 0:
            return found
        found.append((i, i + len(needle)))
        start = i + max(1, len(needle))


def load_paddle_pages(doc_id: str) -> dict[int, dict[str, Any]]:
    path = INPUTS["economyPaddle"] if doc_id == "economy" else INPUTS["populationPaddle"]
    wrapper = read_json(path)
    pages: dict[int, dict[str, Any]] = {}
    for entry in wrapper.get("raw", []):
        res = entry.get("res", {})
        page_index = res.get("page_index")
        if page_index is None:
            continue
        pages[int(page_index)] = {
            "width": res.get("width"),
            "height": res.get("height"),
            "tables": res.get("table_res_list", []),
        }
    return pages


def index_candidates(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for doc in data.get("documents", []):
        source_id = doc["sourceId"]
        for chunk in doc.get("chunks", []):
            for fact_idx, fact in enumerate(chunk.get("facts", [])):
                candidate_id = f"{source_id}:{chunk['chunkIndex']}:fact:{fact_idx}"
                index[candidate_id] = {
                    "candidate": fact,
                    "sourceId": source_id,
                    "chunkIndex": chunk["chunkIndex"],
                    "chunk": chunk,
                }
    return index


def packet_index(sidecar: dict[str, Any]) -> dict[tuple[str, int], dict[str, Any]]:
    return {(p["tableId"], int(p["row"])): p for p in sidecar.get("packets", [])}


def table_page_ocr(table: dict[str, Any], pages_by_doc: dict[str, dict[int, dict[str, Any]]]) -> dict[str, Any] | None:
    page = pages_by_doc.get(table["doc"], {}).get(int(table["page"]))
    if not page:
        return None
    tables = page.get("tables", [])
    if len(tables) != 1:
        return None
    pred = (tables[0].get("table_ocr_pred") or {})
    return {
        "pageWidth": page.get("width"),
        "pageHeight": page.get("height"),
        "recTexts": pred.get("rec_texts", []),
        "recBoxes": pred.get("rec_boxes", []),
        "recScores": pred.get("rec_scores", []),
        "tableCountOnPage": len(tables),
    }


def source_span(
    *,
    packet: dict[str, Any] | None,
    source_range: dict[str, Any],
    expected_text: str,
    kind: str,
    row: int,
    cell: int,
) -> dict[str, Any] | None:
    if not packet:
        return None
    matches = [
        span for span in packet.get("sourceSpans", [])
        if span.get("kind") == kind and int(span.get("row", -1)) == row
        and int(span.get("cell", -1)) == cell
    ]
    if len(matches) != 1:
        return None
    span = matches[0]
    start = int(packet["start"]) + int(span["start"])
    end = int(packet["start"]) + int(span["end"])
    range_start = int(source_range["sourceStart"])
    text = source_range["text"][start - range_start:end - range_start]
    return {
        "kind": kind,
        "row": row,
        "cell": cell,
        "start": start,
        "end": end,
        "text": text,
        "exactSlice": text == expected_text,
    }


def chunk_spans(chunk: dict[str, Any], text: str, source_range: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    range_start = int(source_range["sourceStart"])
    source_text = source_range["text"]
    for a, b in all_occurrences(chunk.get("inputText", ""), text):
        global_start = int(chunk["sourceStart"]) + a
        global_end = int(chunk["sourceStart"]) + b
        sliced = source_text[global_start - range_start:global_end - range_start]
        result.append({
            "start": global_start,
            "end": global_end,
            "chunkOffsetStart": a,
            "chunkOffsetEnd": b,
            "text": sliced,
            "exactSourceSlice": sliced == text,
        })
    return result


def candidate_table_attempts(
    *,
    candidate: dict[str, Any],
    source_id: str,
    chunk: dict[str, Any],
    tables: list[dict[str, Any]],
    pages_by_doc: dict[str, dict[int, dict[str, Any]]],
) -> list[dict[str, Any]]:
    attempts = []
    for table in tables:
        if table.get("doc") != source_id:
            continue
        ocr = table_page_ocr(table, pages_by_doc)
        if not ocr:
            attempts.append({"tableId": table["id"], "result": {"status": "HELD", "reason": "OCR_TABLE_UNAVAILABLE_OR_MULTIPLE"}})
            continue
        result = resolve_geometry_binding(
            subject=candidate.get("subject", ""),
            value=candidate.get("value", ""),
            header_quote=candidate.get("headerQuote", ""),
            table_cells=table.get("cells", []),
            header_row_count=int(table.get("headerRowCount", 0)),
            rec_texts=ocr["recTexts"],
            rec_boxes=ocr["recBoxes"],
            page_width=int(ocr["pageWidth"]),
            page_height=int(ocr["pageHeight"]),
            emitting_chunk_text=chunk.get("inputText", ""),
        )
        result["pageIndex"] = table.get("page")
        result["geometrySource"] = "frozen Paddle table_ocr_pred.rec_boxes"
        result["ocrTextSource"] = "frozen Paddle table_ocr_pred.rec_texts"
        result["ocrTableHash"] = INPUT_HASHES["economyPaddle" if source_id == "economy" else "populationPaddle"]
        attempts.append({"tableId": table["id"], "result": result, "ocr": ocr})
    return attempts


def main() -> None:
    global INPUT_HASHES
    INPUT_HASHES = {name: sha256_file(path) for name, path in INPUTS.items()}
    candidates_doc = read_json(INPUTS["candidates"])
    old_validation = read_json(INPUTS["v6Validation"])
    source_bundle = read_json(INPUTS["sourceBundle"])
    chunk_index = read_json(INPUTS["chunks"])
    sidecar = read_json(INPUTS["tableSidecar"])
    candidate_by_id = index_candidates(candidates_doc)
    held = [f for f in old_validation["facts"] if f.get("sourceStatus") == "HELD_NO_UNIQUE_ATOMIC_TABLE_BINDING"]
    if len(held) != 115:
        raise SystemExit(f"Expected 115 held facts from immutable v6, found {len(held)}")
    source_ranges = {r["id"]: r for r in source_bundle["sourceRanges"]}
    chunks_by_doc = {
        d["sourceId"]: {int(c["chunkIndex"]): c for c in d.get("chunks", [])}
        for d in chunk_index.get("documents", [])
    }
    pages_by_doc = {doc: load_paddle_pages(doc) for doc in ("economy", "population")}
    packet_by_key = packet_index(sidecar)

    audit_records = []
    v7_fact_by_id = {}
    for old in old_validation["facts"]:
        baseline_fact = dict(old)
        baseline_fact["priorV6SourceStatus"] = old.get("sourceStatus")
        baseline_fact["sourceStatus"] = "HELD_NO_UNIQUE_ATOMIC_TABLE_BINDING"
        baseline_fact["semanticStatus"] = "NOT_ASSESSED"
        baseline_fact["sourceEvidence"] = None
        baseline_fact["evidence"] = None
        v7_fact_by_id[old["candidateId"]] = baseline_fact

    for old in old_validation["facts"]:
        cid = old["candidateId"]
        if cid not in candidate_by_id:
            raise SystemExit(f"Frozen candidate missing: {cid}")
        item = candidate_by_id[cid]
        candidate = item["candidate"]
        source_id = item["sourceId"]
        chunk = chunks_by_doc[source_id][int(item["chunkIndex"])]
        source_range = source_ranges[source_id]
        attempts = candidate_table_attempts(
            candidate=candidate,
            source_id=source_id,
            chunk=chunk,
            tables=sidecar["tables"],
            pages_by_doc=pages_by_doc,
        )
        successful = [a for a in attempts if a["result"].get("status") == "LEXICALLY_GROUNDED_FACT_CANDIDATE"]
        chosen = successful[0] if len(successful) == 1 else None
        reason = None
        if len(successful) > 1:
            reason = "MULTIPLE_SOURCE_TABLES_GEOMETRICALLY_RESOLVE"
        elif not successful:
            # Retain all table reasons, while exposing the best exact-cell
            # candidate attempt. No reason is upgraded to a semantic verdict.
            preference = [
                "NO_UNIQUE_PHYSICAL_HEADER_VALUE_ALIGNMENT",
                "HEADER_CELL_NOT_UNIQUE",
                "SUBJECT_VALUE_ROW_BINDING_NOT_UNIQUE",
                "SUBJECT_NOT_EXACT_SOURCE_DATA_CELL",
                "VALUE_NOT_EXACT_SOURCE_DATA_CELL",
                "HEADER_NOT_EXACT_SOURCE_HEADER_CELL",
                "ATOM_NOT_PRESENT_IN_EMITTING_CHUNK",
            ]
            reasons = [a.get("result", {}).get("reason") for a in attempts]
            reason = next((x for x in preference if x in reasons), reasons[0] if reasons else "NO_SOURCE_TABLE_FOR_DOCUMENT")

        record: dict[str, Any] = {
            "candidateId": cid,
            "sourceId": source_id,
            "chunkIndex": int(item["chunkIndex"]),
            "auditCohort": "HELD_IN_V6" if old.get("sourceStatus") == "HELD_NO_UNIQUE_ATOMIC_TABLE_BINDING" else "ADMITTED_IN_V6_RECHECK",
            "originalV6Status": old.get("sourceStatus"),
            "candidate": {
                "subject": candidate.get("subject"),
                "predicate": candidate.get("predicate"),
                "value": candidate.get("value"),
                "description": candidate.get("description"),
                "headerQuote": candidate.get("headerQuote"),
                "tableIdMetadata": candidate.get("tableId"),
                "tableRowLabelMetadata": candidate.get("tableRowLabel"),
                "subjectColumnIndexMetadata": candidate.get("subjectColumnIndex"),
                "columnIndexMetadata": candidate.get("columnIndex"),
            },
            "emittingChunk": {
                "sourceStart": chunk.get("sourceStart"),
                "sourceEnd": chunk.get("sourceEnd"),
                "textSha256": chunk.get("textSha256"),
                "candidateTextSpans": {
                    key: chunk_spans(chunk, candidate.get(key, ""), source_range)
                    for key in ("subject", "value", "headerQuote")
                },
            },
            "tableAttempts": [
                {"tableId": a.get("tableId"), **a.get("result", {})}
                for a in attempts
            ],
            "mechanicalDisposition": "UNIQUE_GEOMETRIC_BINDING" if chosen else "HELD",
            "mechanicalReason": None if chosen else reason,
            "semanticStatus": "NOT_ASSESSED",
        }

        if chosen:
            result = chosen["result"]
            table = next(t for t in sidecar["tables"] if t["id"] == chosen["tableId"])
            packet = packet_by_key.get((table["id"], int(result["sourceRow"])))
            source_evidence = {
                "subject": source_span(
                    packet=packet, source_range=source_range, expected_text=candidate["subject"],
                    kind="data", row=int(result["sourceRow"]), cell=int(result["subjectCell"]),
                ),
                "value": source_span(
                    packet=packet, source_range=source_range, expected_text=candidate["value"],
                    kind="data", row=int(result["sourceRow"]), cell=int(result["valueCell"]),
                ),
                "header": source_span(
                    packet=packet, source_range=source_range, expected_text=candidate["headerQuote"],
                    kind="header", row=int(result["headerRow"]), cell=int(result["headerCell"]),
                ),
            }
            if not all(s and s["exactSlice"] for s in source_evidence.values()):
                record["mechanicalDisposition"] = "HELD"
                record["mechanicalReason"] = "SOURCE_SPAN_NOT_EXACT"
                record["sourceEvidence"] = source_evidence
            else:
                source_chunk_matches = {}
                for atom_name in ("subject", "value", "header"):
                    atom_text = candidate["subject" if atom_name == "subject" else "value" if atom_name == "value" else "headerQuote"]
                    span = source_evidence[atom_name]
                    expected_start, expected_end = int(span["start"]), int(span["end"])
                    source_chunk_matches[atom_name] = exact_source_span_in_chunk(
                        source_start=expected_start,
                        source_end=expected_end,
                        expected_text=atom_text,
                        chunk_start=int(chunk["sourceStart"]),
                        chunk_text=chunk["inputText"],
                        source_range_start=int(source_range["sourceStart"]),
                        source_range_text=source_range["text"],
                    )
                source_evidence["emittingChunkExactOffsetMatch"] = source_chunk_matches
                if not all(source_chunk_matches.values()):
                    record["mechanicalDisposition"] = "HELD"
                    record["mechanicalReason"] = "SOURCE_SPAN_NOT_BOUND_TO_EMITTING_CHUNK"
                    record["sourceEvidence"] = source_evidence
                else:
                    record["sourceEvidence"] = source_evidence
                    record["resolvedTableId"] = table["id"]
                    record["resolvedPageIndex"] = table["page"]
                    record["resolvedRow"] = result["sourceRow"]
                    record["resolvedColumns"] = {
                        "subject": result["subjectColumn"],
                        "value": result["valueColumn"],
                        "headerGrid": result["headerGridColumn"],
                        "headerValueGridOffset": result["headerGridColumnDiff"],
                    }
                    record["ocrBoxes"] = result["ocrBoxes"]
                    record["headerValueXOverlapRatio"] = result["headerValueXOverlapRatio"]
                    v7 = v7_fact_by_id[cid]
                    v7["sourceStatus"] = "LEXICALLY_GROUNDED_FACT_CANDIDATE"
                    v7["semanticStatus"] = "NOT_ASSESSED"
                    v7["sourceEvidenceOrigin"] = "FROZEN_PADDLE_REC_BOX_GEOMETRY_DERIVED_BINDING"
                    v7["sourceEvidence"] = {
                        "tableId": table["id"],
                        "pageIndex": table["page"],
                        "row": result["sourceRow"],
                        "subjectColumn": result["subjectColumn"],
                        "valueColumn": result["valueColumn"],
                        "headerGridColumn": result["headerGridColumn"],
                        "headerValueGridOffset": result["headerGridColumnDiff"],
                        "sourceSpans": source_evidence,
                        "ocrBoxes": result["ocrBoxes"],
                        "headerValueXOverlapRatio": result["headerValueXOverlapRatio"],
                        "descriptionDisposition": "NOT_PROJECTED_UNVERIFIED_PARAPHRASE",
                    }
        audit_records.append(record)

    # Suppress repeated emissions of one identical source-bound cell claim. Keep
    # every stable candidate ID and classify the later copies as extraction
    # duplicates; they do not create additional native evidence.
    by_binding: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    for record in audit_records:
        if record["mechanicalDisposition"] != "UNIQUE_GEOMETRIC_BINDING":
            continue
        c = record["candidate"]
        key = (
            record["sourceId"], record["resolvedTableId"], record["resolvedRow"],
            record["resolvedColumns"]["subject"], record["resolvedColumns"]["value"],
            c.get("subject"), c.get("predicate"), c.get("value"), c.get("headerQuote"),
        )
        by_binding.setdefault(key, []).append(record)
    for group in by_binding.values():
        if len(group) < 2:
            group[0]["modelExtractionDisposition"] = "UNIQUE_EMISSION"
            continue
        canonical = group[0]
        canonical["modelExtractionDisposition"] = "CANONICAL_EMISSION_FOR_DUPLICATE_GROUP"
        canonical["duplicateGroupSize"] = len(group)
        for duplicate in group[1:]:
            duplicate["mechanicalDisposition"] = "DUPLICATE_MODEL_EMISSION"
            duplicate["mechanicalReason"] = "DUPLICATE_OF_SAME_SOURCE_CELL_CLAIM"
            duplicate["modelExtractionDisposition"] = "DUPLICATE_EMISSION"
            duplicate["duplicateOf"] = canonical["candidateId"]
            v7_fact_by_id[duplicate["candidateId"]]["sourceStatus"] = "HELD_DUPLICATE_MODEL_EMISSION"
            v7_fact_by_id[duplicate["candidateId"]]["sourceEvidence"] = None

    counts = Counter(r["mechanicalDisposition"] for r in audit_records)
    reason_counts = Counter(r["mechanicalReason"] for r in audit_records if r["mechanicalReason"])
    input_hashes = {name: sha256_file(path) for name, path in INPUTS.items()}
    audit = {
        "schema": "hyper-fact-mechanical-audit-v1",
        "type": "mechanical exact-cell and frozen OCR-box audit; no semantic verdicts",
        "candidateReceiptSha256": sha256_file(INPUTS["candidates"]),
        "v6ValidationSha256": sha256_file(INPUTS["v6Validation"]),
        "sourceBundleSha256": candidates_doc["sourceBundleSha256"],
        "sourceBundleFileSha256": sha256_file(INPUTS["sourceBundle"]),
        "inputFileSha256": input_hashes,
        "method": {
            "source": "frozen run-5 candidates/chunks/source bundle, v6 hold statuses, v2 table sidecar, Paddle run-2 raw table OCR text and boxes",
            "candidateIDs": "all 120 facts from v6, including the 115 held candidates and rechecking the prior 5 admissions, keyed by frozen sourceId:chunkIndex:factIndex",
            "geometryRule": "exact unique parser subject/value/header cell text; selected subject/value/header source offsets must be the same exact occurrences inside the emitting chunk; exact OCR records with valid page boxes; header must be above and physically x-aligned to exactly one non-subject OCR box in the same visual row",
            "modelTableRowAndColumnMetadata": "recorded for comparison; not used to locate source cells",
            "semanticClaims": "none; every source candidate remains NOT_ASSESSED",
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
            "ocrTextChanged": False,
            "sourceHtmlOrTableProfileChanged": False,
        },
        "summary": {
            "recheckedCandidateFacts": len(old_validation["facts"]),
            "heldInV6Rechecked": len(held),
            "admittedInV6Rechecked": len(old_validation["facts"]) - len(held),
            "geometryBoundCandidateRecords": counts.get("UNIQUE_GEOMETRIC_BINDING", 0) + counts.get("DUPLICATE_MODEL_EMISSION", 0),
            "uniqueGeometryBoundSourceClaims": sum(1 for x in audit_records if x.get("modelExtractionDisposition") in {"UNIQUE_EMISSION", "CANONICAL_EMISSION_FOR_DUPLICATE_GROUP"}),
            "duplicateModelEmissions": counts.get("DUPLICATE_MODEL_EMISSION", 0),
            "heldAfterGeometry": counts.get("HELD", 0),
            "heldReasons": dict(sorted(reason_counts.items())),
        },
        "facts": audit_records,
    }
    out_path = REPORT / "mechanical-audit.json"
    out_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    facts = list(v7_fact_by_id.values())
    v7_counts = Counter(f.get("sourceStatus", "UNKNOWN") for f in facts)
    v7 = {
        "schema": "hyper-fact-geometry-revalidation-v1",
        "runId": "run-5-frozen-candidates-geometry-revalidation-v1",
        "candidateReceiptSha256": sha256_file(INPUTS["candidates"]),
        "sourceBundleSha256": candidates_doc["sourceBundleSha256"],
        "sourceBundleFileSha256": sha256_file(INPUTS["sourceBundle"]),
        "priorValidationSha256": sha256_file(INPUTS["v6Validation"]),
        "mechanicalAuditSha256": sha256_file(out_path),
        "summary": {"facts": dict(sorted(v7_counts.items())), "relations": "not revalidated; excluded from this fact pass"},
        "graphAdmission": "NONE; native interface accepts TEXT only",
        "semanticStatus": "NOT_ASSESSED",
        "facts": facts,
        "relations": [],
        "goldQuestionsOrMetricsUsed": False,
        "modelCalls": 0,
    }
    (OUT / "validated-evidence-geometry-v1.json").write_text(
        json.dumps(v7, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"audit": str(out_path), "summary": audit["summary"], "v7Facts": dict(v7_counts)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
