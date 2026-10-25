"""Build a source-text-only projection from unique geometry-bound fact rows."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
OUT = ROOT / ".local/hyper-fact-audit-20261025"
REPORT = ROOT / "reports/oxr-thai-2026-10-25/hyper-fact-audit-v1"
RUN5 = ROOT / ".local/hyper-relation-audit-20261025/run-5"
V7 = OUT / "validated-evidence-geometry-v1.json"
MECHANICAL = REPORT / "mechanical-audit.json"
BUNDLE = RUN5 / "source-bundle.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def main() -> None:
    validation = read_json(V7)
    audit = read_json(MECHANICAL)
    bundle = read_json(BUNDLE)
    fact_by_id = {f["candidateId"]: f for f in validation["facts"]}
    chosen = [
        f for f in validation["facts"]
        if f.get("sourceStatus") == "LEXICALLY_GROUNDED_FACT_CANDIDATE"
        and f.get("sourceEvidence")
    ]
    audit_by_id = {x["candidateId"]: x for x in audit["facts"]}
    zone_map: dict[str, dict[str, Any]] = {}
    candidate_ids_by_zone: dict[str, list[str]] = {}
    for fact in chosen:
        evidence = fact["sourceEvidence"]
        matches = [
            z for z in bundle["zones"]
            if z.get("kind") == "table-row"
            and z.get("packet", {}).get("tableId") == evidence["tableId"]
            and int(z.get("packet", {}).get("row", -1)) == int(evidence["row"])
        ]
        if len(matches) != 1:
            raise SystemExit(f"Expected one source zone for {fact['candidateId']}, got {len(matches)}")
        zone = matches[0]
        audit_fact = audit_by_id[fact["candidateId"]]
        if audit_fact.get("modelExtractionDisposition") == "DUPLICATE_EMISSION":
            raise SystemExit(f"Duplicate model emission reached projection: {fact['candidateId']}")
        if audit_fact.get("mechanicalDisposition") not in {"UNIQUE_GEOMETRIC_BINDING", "DUPLICATE_MODEL_EMISSION"}:
            raise SystemExit(f"Non-grounded candidate reached projection: {fact['candidateId']}")
        zone_map[zone["id"]] = zone
        candidate_ids_by_zone.setdefault(zone["id"], []).append(fact["candidateId"])

    selected_zones = sorted(zone_map.values(), key=lambda z: (int(z["sourceStart"]), z["id"]))
    docs = sorted({z["rangeId"] for z in selected_zones})
    chunks: list[str] = []
    snippets = []
    cursor = 0
    for doc_id in docs:
        heading = f"# Public PDF {doc_id}\n\n"
        chunks.append(heading)
        cursor += len(heading)
        for zone in [z for z in selected_zones if z["rangeId"] == doc_id]:
            text = zone["text"]
            start = cursor
            chunks.append(text)
            cursor += len(text)
            snippets.append({
                "zoneId": zone["id"],
                "sourceId": doc_id,
                "sourceStart": zone["sourceStart"],
                "sourceEnd": zone["sourceEnd"],
                "sourceTextSha256": digest(text.encode("utf-8")),
                "projectionStart": start,
                "projectionEnd": cursor,
                "projectionTextSha256": digest(text.encode("utf-8")),
                "candidateIds": sorted(candidate_ids_by_zone[zone["id"]]),
                "text": text,
            })
            if not text.endswith("\n"):
                chunks.append("\n")
                cursor += 1
            chunks.append("\n")
            cursor += 1
    projection_text = "".join(chunks)
    # Confirm every projection snippet is still the exact frozen source-zone text.
    for snippet in snippets:
        if projection_text[snippet["projectionStart"]:snippet["projectionEnd"]] != snippet["text"]:
            raise SystemExit(f"Projection offsets failed exact text check for {snippet['zoneId']}")
    projection = {
        "schema": "hyper-fact-source-projection-v1",
        "type": "source-text-only subset selected by exact Paddle cells and unique OCR-box geometry",
        "runId": validation["runId"],
        "candidateReceiptSha256": validation["candidateReceiptSha256"],
        "sourceBundleSha256": validation["sourceBundleSha256"],
        "sourceBundleFileSha256": validation["sourceBundleFileSha256"],
        "priorValidationSha256": validation["priorValidationSha256"],
        "mechanicalAuditSha256": validation["mechanicalAuditSha256"],
        "validationFileSha256": digest(V7.read_bytes()),
        "text": projection_text,
        "textSha256": digest(projection_text.encode("utf-8")),
        "snippets": snippets,
        "selectedZones": len(selected_zones),
        "totalZones": len(bundle["zones"]),
        "selectedSourceChars": sum(len(z["text"]) for z in selected_zones),
        "totalSourceChars": bundle["sourceChars"],
        "omittedSourceChars": bundle["sourceChars"] - sum(len(z["text"]) for z in selected_zones),
        "coveragePct": round(100 * sum(len(z["text"]) for z in selected_zones) / bundle["sourceChars"], 2),
        "sourceTextOnly": True,
        "candidateDescriptionsIncluded": False,
        "candidateGraphIncluded": False,
        "candidateFactsCount": len(chosen),
        "uniqueSourceZonesCount": len(selected_zones),
        "semanticStatus": "NOT_ASSESSED",
        "graphAdmission": "NONE; GenesisRAG17 native harness accepts TEXT only; candidate facts remain non-authoritative",
        "sourceTextIsUnmodifiedFrozenOCR": True,
        "goldQuestionsOrMetricsUsed": False,
        "modelCalls": 0,
    }
    path = OUT / "source-projection-geometry-v1.json"
    path.write_text(json.dumps(projection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: projection[k] for k in (
        "selectedZones", "totalZones", "selectedSourceChars", "totalSourceChars",
        "coveragePct", "candidateFactsCount", "textSha256",
    )}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
