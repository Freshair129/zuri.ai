"""Build the fact-audit TEXT arm without changing frozen plain/table arms."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
OUT = ROOT / ".local/hyper-fact-audit-20261025"
BASE = ROOT / ".local/thai-table-chunking-20261025/run-v2/native-input.json"
V6_INPUT = ROOT / ".local/hyper-relation-audit-20261025/run-5-validator-v6/native-input.json"
PROJECTION = OUT / "source-projection-geometry-v1.json"
VALIDATION = OUT / "validated-evidence-geometry-v1.json"
AUDIT = ROOT / "reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/mechanical-audit.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def hash_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def hash_text(text: str) -> str:
    return hash_bytes(text.encode("utf-8"))


def main() -> None:
    base = read_json(BASE)
    old = read_json(V6_INPUT)
    projection = read_json(PROJECTION)
    validation = read_json(VALIDATION)
    audit = read_json(AUDIT)
    inference_freeze_path = ROOT / ".local/hyper-relation-audit-20261025/run-5/freeze.json"
    old_arms = {arm["parser"]: arm for arm in old["arms"]}
    base_arms = {arm["parser"]: arm for arm in base["arms"]}
    if set(base_arms) != {"plain", "table"}:
        raise SystemExit("Frozen baseline input does not contain exactly plain/table arms")
    for parser in ("plain", "table"):
        if old_arms[parser]["contentSha256"] != base_arms[parser]["contentSha256"] or old_arms[parser]["content"] != base_arms[parser]["content"]:
            raise SystemExit(f"Existing {parser} arm differs from the frozen table-chunking baseline")
    old_hyper = old_arms.get("hyper-evidence-v6")
    if not old_hyper:
        raise SystemExit("Missing v6 arm for retaining its unchanged benchmark fixture prefix")
    marker = "# Public PDF economy\n\n"
    marker_index = old_hyper["content"].find(marker)
    if marker_index < 0:
        raise SystemExit("Could not locate source boundary in old v6 arm")
    fixture_prefix = old_hyper["content"][:marker_index]
    if "# Public PDF population" in fixture_prefix or "## economy-table" in fixture_prefix:
        raise SystemExit("Expected only the unchanged non-PDF harness fixture prefix")

    content = fixture_prefix + projection["text"]
    ranges = []
    for snippet in projection["snippets"]:
        start = len(fixture_prefix) + int(snippet["projectionStart"])
        end = len(fixture_prefix) + int(snippet["projectionEnd"])
        text = content[start:end]
        if text != snippet["text"] or hash_text(text) != snippet["sourceTextSha256"]:
            raise SystemExit(f"Native source range failed exact source check: {snippet['zoneId']}")
        ranges.append({
            "id": snippet["zoneId"],
            "doc": snippet["sourceId"],
            "zoneId": snippet["zoneId"],
            "start": start,
            "end": end,
            "textSha256": hash_text(text),
            "chars": len(text),
            "sourceStart": snippet["sourceStart"],
            "sourceEnd": snippet["sourceEnd"],
            "sourceTextSha256": snippet["sourceTextSha256"],
            "candidateIds": snippet["candidateIds"],
        })

    arm = {
        "parser": "hyper-fact-geometry-v1",
        "content": content,
        "contentSha256": hash_text(content),
        "ranges": ranges,
        "projection": {
            "type": "source-text-only subset selected by exact parser cells and Paddle OCR-box geometry",
            "sourceBundleSha256": projection["sourceBundleSha256"],
            "inferenceFreezeSha256": hash_bytes(inference_freeze_path.read_bytes()),
            "candidateReceiptSha256": projection["candidateReceiptSha256"],
            "validationFileSha256": projection["validationFileSha256"],
            "sourceTextSha256": projection["textSha256"],
            "selectedZones": projection["selectedZones"],
            "totalZones": projection["totalZones"],
            "selectedSourceChars": projection["selectedSourceChars"],
            "totalSourceChars": projection["totalSourceChars"],
            "graphFieldsIncluded": False,
            "candidateTextIncluded": False,
            "semanticStatus": "NOT_ASSESSED",
        },
    }
    result = {
        "controlFileSha256": base["controlFileSha256"],
        "arms": [copy.deepcopy(base_arms["plain"]), copy.deepcopy(base_arms["table"]), arm],
        "hyperCandidateSidecar": {
            "schema": "non-authoritative-hyper-fact-audit-ref-v1",
            "admission": "NONE; no candidate fact or relation is sent to GenesisRAG17",
            "graphStatus": "SIDE_CAR_ONLY_NOT_INGESTED",
            "candidateReceiptSha256": projection["candidateReceiptSha256"],
            "validationFileSha256": projection["validationFileSha256"],
            "mechanicalAuditSha256": hash_bytes(AUDIT.read_bytes()),
            "sourceProjectionSha256": hash_bytes(PROJECTION.read_bytes()),
            "semanticStatus": "NOT_ASSESSED",
            "summary": audit["summary"],
        },
    }
    out_path = OUT / "native-input-geometry-v1.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "path": str(out_path),
        "arm": arm["parser"],
        "contentChars": len(content),
        "contentSha256": arm["contentSha256"],
        "ranges": len(ranges),
        "plainUnchanged": arm["parser"] == "hyper-fact-geometry-v1" and result["arms"][0]["contentSha256"] == base_arms["plain"]["contentSha256"],
        "tableUnchanged": result["arms"][1]["contentSha256"] == base_arms["table"]["contentSha256"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
