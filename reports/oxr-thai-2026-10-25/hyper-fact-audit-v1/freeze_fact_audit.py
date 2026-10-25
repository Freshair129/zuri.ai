"""Write a small hash binding for the frozen geometry revalidation/projection."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
OUT = ROOT / ".local/hyper-fact-audit-20261025"
REPORT = ROOT / "reports/oxr-thai-2026-10-25/hyper-fact-audit-v1"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel_hashes(files: dict[str, Path]) -> dict[str, str]:
    return {name: file_hash(path) for name, path in files.items()}


def main() -> None:
    run5 = ROOT / ".local/hyper-relation-audit-20261025/run-5"
    v6 = ROOT / ".local/hyper-relation-audit-20261025/run-5-validator-v6"
    table_run = ROOT / ".local/thai-table-chunking-20261025/run-v2"
    paddle = ROOT / ".local/thai-native-20261025/paddle-2"
    hyper = ROOT / "reports/oxr-thai-2026-10-25/hyper-extract-v1"
    relation_report = ROOT / "reports/oxr-thai-2026-10-25/hyper-relation-audit-v1"
    real_native = ROOT / "reports/oxr-thai-2026-10-25/real-native"

    input_files = {
        "run5Freeze": run5 / "freeze.json",
        "candidateReceipt": run5 / "evidence-candidates.json",
        "chunks": run5 / "chunks.json",
        "sourceBundle": run5 / "source-bundle.json",
        "v6ValidationBaseline": v6 / "validated-evidence.json",
        "tableSidecar": table_run / "table-sidecar.json",
        "economyPaddleRaw": paddle / "economy.json",
        "populationPaddleRaw": paddle / "population.json",
        "sourceEconomyPdf": ROOT / ".local/thai-native-20261025/input/economy.pdf",
        "sourcePopulationPdf": ROOT / ".local/thai-native-20261025/input/population.pdf",
        "baselineNativeInput": table_run / "native-input.json",
        "v6NativeInputPrefixSource": v6 / "native-input.json",
    }
    output_files = {
        "mechanicalAudit": REPORT / "mechanical-audit.json",
        "geometryValidation": OUT / "validated-evidence-geometry-v1.json",
        "sourceProjection": OUT / "source-projection-geometry-v1.json",
        "nativeInput": OUT / "native-input-geometry-v1.json",
    }
    code_files = {
        "geometryResolver": REPORT / "geometry_binding.py",
        "geometryTests": REPORT / "test_geometry_binding.py",
        "nativeContractTests": REPORT / "test_native_contract.py",
        "revalidator": REPORT / "revalidate_facts.py",
        "projectionBuilder": REPORT / "build_projection.py",
        "nativeInputBuilder": REPORT / "build_native_input.py",
        "freezeWriter": REPORT / "freeze_fact_audit.py",
        "nativeRunner": REPORT / "run-native-fact-audit.ps1",
        "nativeLauncher": relation_report / "launch-native-v6.mjs",
        "nativeTest": hyper / "native.test.js",
        "nativeTestConfig": real_native / "native.config.mjs",
        "nativeMetrics": real_native / "metrics.mjs",
        "goldManifest": real_native / "evidence-manifest.json",
    }
    for group in (input_files, output_files, code_files):
        for name, path in group.items():
            if not path.is_file():
                raise SystemExit(f"Missing frozen fact-audit file {name}: {path}")

    candidate = read_json(input_files["candidateReceipt"])
    validation = read_json(output_files["geometryValidation"])
    audit = read_json(output_files["mechanicalAudit"])
    projection = read_json(output_files["sourceProjection"])
    native_input = read_json(output_files["nativeInput"])
    native_arm = next(a for a in native_input["arms"] if a["parser"] == "hyper-fact-geometry-v1")
    run5_freeze = read_json(input_files["run5Freeze"])

    code_hashes = rel_hashes(code_files)
    input_hashes = rel_hashes(input_files)
    output_hashes = rel_hashes(output_files)
    result = {
        "schema": "hyper-fact-audit-freeze-v1",
        "runId": "run-5-frozen-candidates-geometry-revalidation-v1",
        "purpose": "source-boundary diagnosis and non-production GenesisRAG17 TEXT-only retest",
        "inputFiles": input_hashes,
        "outputFiles": output_hashes,
        "codeFiles": code_hashes,
        "extractionFreezeSha256": input_hashes["run5Freeze"],
        "candidateReceiptSha256": input_hashes["candidateReceipt"],
        "sourceBundleFileSha256": input_hashes["sourceBundle"],
        "sourceBundleContentSha256": candidate["sourceBundleSha256"],
        "tableSidecarSha256": input_hashes["tableSidecar"],
        "economyPdfSha256": input_hashes["sourceEconomyPdf"],
        "populationPdfSha256": input_hashes["sourcePopulationPdf"],
        "validationFileSha256": output_hashes["geometryValidation"],
        "mechanicalAuditSha256": output_hashes["mechanicalAudit"],
        "projectionFileSha256": output_hashes["sourceProjection"],
        "nativeInputFileSha256": output_hashes["nativeInput"],
        "runnerSha256": code_hashes["nativeRunner"],
        "launcherSha256": code_hashes["nativeLauncher"],
        "baselineArmContentSha256": {
            arm["parser"]: arm["contentSha256"]
            for arm in native_input["arms"] if arm["parser"] in ("plain", "table")
        },
        "nativeArm": {
            "parser": native_arm["parser"],
            "contentSha256": native_arm["contentSha256"],
            "rangeCount": len(native_arm["ranges"]),
            "selectedZones": projection["selectedZones"],
            "selectedSourceChars": projection["selectedSourceChars"],
            "projectionTextSha256": projection["textSha256"],
            "graphFieldsIncluded": False,
            "candidateTextIncluded": False,
            "semanticStatus": "NOT_ASSESSED",
        },
        "candidateRevalidation": {
            "recheckedFacts": len(validation["facts"]),
            "heldByV6Rechecked": audit["summary"]["heldInV6Rechecked"],
            "admittedByV6Rechecked": audit["summary"]["admittedInV6Rechecked"],
            "v7SourceStatuses": validation["summary"]["facts"],
            "mechanicalAuditSummary": audit["summary"],
            "semanticStatus": "NOT_ASSESSED",
        },
        "modelCalls": 0,
        "goldQuestionsOrMetricsUsedBeforeFreeze": False,
        "sourceTextChanged": False,
        "productionAdoption": False,
    }
    path = OUT / "fact-audit-freeze.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "path": str(path),
        "sha256": file_hash(path),
        "candidateRevalidation": result["candidateRevalidation"],
        "nativeArm": result["nativeArm"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
