"""Add the frozen source-native arm beside the unchanged native TEXT baseline."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _sha_text(text: str) -> str:
    return _sha(text.encode("utf-8"))


def build_native_input(base_input: dict[str, Any], projection: dict[str, Any], freeze_refs: dict[str, str]) -> dict[str, Any]:
    arms = [dict(arm) for arm in base_input.get("arms", [])]
    by_parser = {str(arm.get("parser")): arm for arm in arms}
    if set(by_parser) != {"plain", "table"}:
        raise ValueError("Frozen baseline must contain exactly the plain and table arms")
    table_arm = by_parser["table"]
    plain_arm = by_parser["plain"]
    prefix_end = int(table_arm["ranges"][0]["start"])
    if prefix_end != int(plain_arm["ranges"][0]["start"]):
        raise ValueError("Baseline arms do not share the same control prefix length")
    control_prefix = str(table_arm["content"][:prefix_end])
    if str(plain_arm["content"][:prefix_end]) != control_prefix:
        raise ValueError("Baseline arms do not share the exact frozen control prefix")
    for arm in (plain_arm, table_arm):
        if _sha_text(str(arm["content"])) != arm["contentSha256"]:
            raise ValueError(f"Frozen baseline content hash mismatch: {arm['parser']}")
        for source_range in arm.get("ranges", []):
            if not source_range.get("id"):
                raise ValueError(f"Baseline range has no document id: {arm['parser']}")
            source_range["doc"] = str(source_range["id"])

    source_text = str(projection["text"])
    if not projection.get("summary", {}).get("sourceRangesReconstructedExactly"):
        raise ValueError("Source-native projection does not conserve all frozen source ranges")
    if float(projection.get("summary", {}).get("rawRangeCoveragePct", 0)) != 100.0:
        raise ValueError("Source-native projection has incomplete raw source-range coverage")
    content = control_prefix + source_text
    ranges: list[dict[str, Any]] = []

    for source_range in projection.get("sourceRanges", []):
        start = prefix_end + int(source_range["projectionStart"])
        end = prefix_end + int(source_range["projectionEnd"])
        ranges.append({
            "id": str(source_range["rangeId"]),
            "doc": str(source_range["rangeId"]),
            "start": start,
            "end": end,
            "textSha256": _sha_text(content[start:end]),
            "sourceStart": int(source_range["sourceStart"]),
            "sourceEnd": int(source_range["sourceEnd"]),
            "sourceTextSha256": str(source_range["sourceTextSha256"]),
            "rangeKind": "SOURCE_RANGE_WITH_SEPARATE_GENERATED_FRAMES",
        })
    for snippet in projection.get("snippets", []):
        start = prefix_end + int(snippet["projectionStart"])
        end = prefix_end + int(snippet["projectionEnd"])
        raw_end = prefix_end + int(snippet["projectionStart"]) + int(snippet["sourceTextChars"])
        ranges.append({
            "id": str(snippet["zoneId"]),
            "doc": str(snippet["documentId"]),
            "zoneId": str(snippet["zoneId"]),
            "zoneKind": str(snippet["zoneKind"]),
            "start": start,
            "end": end,
            "textSha256": _sha_text(content[start:end]),
            "rawSourceStart": start,
            "rawSourceEnd": raw_end,
            "rawSourceTextSha256": str(snippet["sourceTextSha256"]),
            "sourceStart": int(snippet["sourceStart"]),
            "sourceEnd": int(snippet["sourceEnd"]),
            "resolvedSourceCellRecordIds": list(snippet.get("resolvedCellRecordIds", [])),
            "resolvedValueCellCount": int(snippet.get("resolvedValueCellCount", 0)),
            "unqualifiedContextCellCount": int(snippet.get("unqualifiedContextCellCount", 0)),
            "semanticStatus": "NOT_ASSESSED",
        })
    for gap in projection.get("sourceGaps", []):
        start = prefix_end + int(gap["projectionStart"])
        end = prefix_end + int(gap["projectionEnd"])
        ranges.append({
            "id": f"source-gap:{gap['rangeId']}:{gap['sourceStart']}-{gap['sourceEnd']}",
            "doc": str(gap["rangeId"]),
            "zoneKind": "source-range-gap",
            "start": start,
            "end": end,
            "textSha256": _sha_text(content[start:end]),
            "sourceStart": int(gap["sourceStart"]),
            "sourceEnd": int(gap["sourceEnd"]),
            "sourceTextSha256": str(gap["textSha256"]),
            "semanticStatus": "NOT_ASSESSED",
        })
    ranges.sort(key=lambda r: (int(r["start"]), int(r["end"]), str(r["id"])))
    for source_range in ranges:
        start, end = int(source_range["start"]), int(source_range["end"])
        if start < prefix_end or end <= start or end > len(content):
            raise ValueError(f"Invalid native range bounds: {source_range['id']}")
        if _sha_text(content[start:end]) != source_range["textSha256"]:
            raise ValueError(f"Native range text hash mismatch: {source_range['id']}")

    source_arm = {
        "parser": "source-native-all-rows-v1",
        "content": content,
        "ranges": ranges,
        "contentSha256": _sha_text(content),
        "projection": {
            "profile": projection["profile"],
            "sourceNativeFreezeSha256": freeze_refs["sourceNativeFreezeSha256"],
            "sourceNativeProjectionFreezeSha256": freeze_refs["sourceNativeProjectionFreezeSha256"],
            "sourceNativeProjectionSha256": freeze_refs["sourceNativeProjectionSha256"],
            "sourceTextSha256": projection["textSha256"],
            "sourceTextChars": len(source_text),
            "sourceRangeChars": int(projection["summary"]["rawSourceRangeChars"]),
            "generatedFramingChars": int(projection["summary"]["generatedFramingChars"]),
            "sourceRangeCoveragePct": float(projection["summary"]["rawRangeCoveragePct"]),
            "sourceZonesIncluded": int(projection["summary"]["sourceZonesIncluded"]),
            "tableRowsIncluded": int(projection["summary"]["sourceRowsIncluded"]),
            "nonTableZonesContextOnly": int(projection["summary"]["nonTableContextZonesIncluded"]),
            "resolvedValueCellCandidates": int(projection["summary"]["resolvedCellCandidates"]),
            "unqualifiedContextCellRecords": int(projection["summary"]["contextCellsIncludedButUnqualified"]),
            "semanticStatus": "NOT_ASSESSED",
            "graphAdmission": "NONE",
            "candidateFactsIncluded": False,
            "candidateDescriptionsIncluded": False,
            "candidateGraphIncluded": False,
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
        },
    }
    return {
        "schema": "zuri.hyper-source-native-native-input.v1",
        "profile": "current-table-baseline-plus-source-native-all-rows",
        "controlFileSha256": base_input["controlFileSha256"],
        "arms": [plain_arm, table_arm, source_arm],
        "sourceNativeTreatment": source_arm["projection"],
        "candidateSidecarIncluded": False,
    }


def main() -> None:
    root = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
    raw = root / ".local/hyper-extraction-repair-20261025"
    report = root / "reports/oxr-thai-2026-10-25/hyper-extraction-repair-v1"
    baseline_path = root / ".local/thai-table-chunking-20261025/run-v2/native-input.json"
    enumeration_path = raw / "source-native-enumeration.json"
    native_freeze_path = raw / "source-native-freeze.json"
    projection_path = raw / "source-native-projection.json"
    projection_freeze_path = raw / "source-native-projection-freeze.json"
    bundle_path = root / ".local/hyper-relation-audit-20261025/run-5/source-bundle.json"
    output_path = raw / "native-input-source-native-v1.json"
    freeze_path = raw / "native-input-source-native-freeze.json"
    inputs = {
        "baselineNativeInput": baseline_path,
        "sourceNativeEnumeration": enumeration_path,
        "sourceNativeFreeze": native_freeze_path,
        "sourceNativeProjection": projection_path,
        "sourceNativeProjectionFreeze": projection_freeze_path,
        "sourceBundle": bundle_path,
    }
    hashes = {name: _sha(path.read_bytes()) for name, path in inputs.items()}
    load = lambda path: json.loads(path.read_text(encoding="utf-8"))
    base, enumeration, native_freeze, projection, projection_freeze, bundle = (load(p) for p in inputs.values())
    if enumeration.get("freezeSha256") != hashes["sourceNativeFreeze"]:
        raise SystemExit("Source-native enumeration differs from its freeze")
    if native_freeze.get("inputSha256", {}).get("sourceBundle") != hashes["sourceBundle"]:
        raise SystemExit("Source-native freeze does not bind the current source bundle")
    if projection_freeze.get("sourceNativeFreezeSha256") != hashes["sourceNativeFreeze"]:
        raise SystemExit("Projection freeze does not bind the current source-native freeze")
    if projection_freeze.get("sourceNativeEnumerationSha256") != hashes["sourceNativeEnumeration"]:
        raise SystemExit("Projection freeze does not bind the current source-native enumeration")
    if projection_freeze.get("sourceNativeProjectionSha256") != hashes["sourceNativeProjection"]:
        raise SystemExit("Projection output differs from its freeze")
    if enumeration.get("sourceBundleSha256") != hashes["sourceBundle"] or bundle.get("sourceChars") != projection.get("summary", {}).get("sourceChars"):
        raise SystemExit("Frozen source bundle dimensions/hash mismatch")
    freeze_refs = {
        "sourceNativeFreezeSha256": hashes["sourceNativeFreeze"],
        "sourceNativeProjectionFreezeSha256": hashes["sourceNativeProjectionFreeze"],
        "sourceNativeProjectionSha256": hashes["sourceNativeProjection"],
    }
    native_input = build_native_input(base, projection, freeze_refs)
    output_path.write_text(json.dumps(native_input, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    freeze = {
        "schema": "zuri.hyper-source-native-native-input-freeze.v1",
        "profile": native_input["profile"],
        "inputSha256": hashes,
        "nativeInputSha256": _sha(output_path.read_bytes()),
        "implementationSha256": {
            "builder": _sha(Path(__file__).resolve().read_bytes()),
            "nativeInputTests": _sha((report / "test_native_input.py").read_bytes()),
        },
        "arms": [
            {"parser": arm["parser"], "contentSha256": arm["contentSha256"], "contentChars": len(arm["content"]), "rangeCount": len(arm["ranges"])}
            for arm in native_input["arms"]
        ],
        "policy": {
            "plainAndTableContentUnchanged": True,
            "sourceNativeAllSourceRangesCopiedExactly": True,
            "nonTableSourceZonesRemainUnqualifiedContext": True,
            "heldCellsRemainContextOnly": True,
            "candidateOutputUsed": False,
            "candidateGraphIncluded": False,
            "goldQuestionsOrMetricsUsed": False,
            "modelCalls": 0,
            "graphAdmission": "NONE",
            "semanticStatus": "NOT_ASSESSED",
        },
        "runtime": {"python": sys.version.split()[0]},
    }
    freeze_path.write_text(json.dumps(freeze, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"nativeInputSha256": freeze["nativeInputSha256"], "arms": freeze["arms"], "freeze": _sha(freeze_path.read_bytes())}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
