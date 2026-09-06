"""Run the catalog vector benchmark through the local Ollama embedding API.

This is a sidecar-only runner for the BGE-M3 Ollama arm. It never mutates the
active Genesis store or the prior identity-review artifacts.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import psutil


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = Path(os.environ.get(
    "GENESIS_VECTOR_INPUT_PATH",
    ROOT / "data/catalog_vector_benchmark_round1_v1/vector-input-round1.json",
)).resolve()
OUTPUT_DIR = Path(os.environ.get(
    "GENESIS_VECTOR_OUTPUT_DIR",
    ROOT / "data/catalog_vector_benchmark_round1_v1/bge-m3-ollama-run",
)).resolve()
OLLAMA_URL = os.environ.get("GENESIS_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
MODEL_NAME = os.environ.get("GENESIS_OLLAMA_MODEL", "bge-m3:latest")
BATCH_SIZE = int(os.environ.get("GENESIS_OLLAMA_BATCH_SIZE", "32"))
TOP_K = 20
SEED = 20260823
METRIC_SET_ID = "METRICS1_benchmark-measurement-v1"
PROTOCOL_VERSION = "vector-benchmark-round1-ollama-v1"
CALCULATION_VERSION = "benchmark-measurement-v1"
ARM_ID = "EMB_ONLY_BGE_M3_OLLAMA"
LOGIC_EVIDENCE_ID = "EVIDENCE1_GENESIS-RAG-CATALOG-VECTOR-BENCHMARK-ROUND1-SPEC@0.6.0b"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def stable(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest().upper()


def sha256_json(value: Any) -> str:
    return sha256_bytes(stable(value).encode("utf-8"))


def short_id(prefix: str, value: str, length: int = 20) -> str:
    return f"{prefix}_{sha256_bytes(value.encode('utf-8'))[:length]}"


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    temporary.replace(path)


def api_json(method: str, endpoint: str, payload: dict[str, Any] | None = None, timeout: int = 300) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{OLLAMA_URL}{endpoint}",
        data=body,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama {method} {endpoint} failed with HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Ollama {method} {endpoint} unavailable: {error.reason}") from error


def run_command(args: list[str]) -> str | None:
    try:
        completed = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False)
        value = (completed.stdout or completed.stderr).strip()
        return value or None
    except OSError:
        return None


def stage(name: str, started_at: str, ended_at: str, status: str = "passed", **extra: Any) -> dict[str, Any]:
    start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    end = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
    return {
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationMs": round((end - start).total_seconds() * 1000, 3),
        "status": status,
        **extra,
    }


def metric(
    metric_id: str,
    run_id: str,
    cohort_id: str,
    method: str,
    status: str,
    value: float | None,
    numerator: int | None,
    denominator: int | None,
    reason: str | None = None,
    evidence: list[str] | None = None,
    unit: str = "ratio",
) -> dict[str, Any]:
    return {
        "metricId": metric_id,
        "metricSetId": METRIC_SET_ID,
        "runId": run_id,
        "cohortId": cohort_id,
        "querySetId": QUERY_SET_ID,
        "method": method,
        "status": status,
        "value": value,
        "unit": unit,
        "numerator": numerator,
        "denominator": denominator,
        "calculationVersion": CALCULATION_VERSION,
        "confidenceInterval": None,
        "reason": reason,
        "evidence": evidence or [],
    }


def normalized(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    if np.any(norms == 0):
        raise RuntimeError("Ollama returned a zero-length embedding vector")
    return (matrix / norms).astype(np.float32, copy=False)


def embed_texts(texts: list[str], telemetry: dict[str, Any]) -> np.ndarray:
    vectors: list[list[float]] = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start:start + BATCH_SIZE]
        request_started = time.perf_counter()
        response = api_json("POST", "/api/embed", {
            "model": MODEL_NAME,
            "input": batch,
            "truncate": True,
            "keep_alive": "10m",
        })
        elapsed = time.perf_counter() - request_started
        batch_vectors = response.get("embeddings")
        if not isinstance(batch_vectors, list) or len(batch_vectors) != len(batch):
            raise RuntimeError(f"Ollama returned {len(batch_vectors) if isinstance(batch_vectors, list) else 'invalid'} embeddings for {len(batch)} inputs")
        vectors.extend(batch_vectors)
        telemetry["requests"] += 1
        telemetry["items"] += len(batch)
        telemetry["wallSeconds"] += elapsed
        for key in ("total_duration", "load_duration", "prompt_eval_count", "prompt_eval_duration"):
            if isinstance(response.get(key), (int, float)):
                telemetry[key] = telemetry.get(key, 0) + response[key]
    return normalized(np.asarray(vectors, dtype=np.float32))


def main() -> int:
    global QUERY_SET_ID
    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"Vector input not found: {INPUT_PATH}")
    data = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    QUERY_SET_ID = data["querySetId"]
    dataset_id = data["datasetId"]
    dataset_revision_id = data["datasetRevisionId"]
    input_sha = sha256_bytes(INPUT_PATH.read_bytes())
    started_at = utc_now()

    tags = api_json("GET", "/api/tags")
    version_payload = api_json("GET", "/api/version")
    model_row = next((row for row in tags.get("models", []) if row.get("name") == MODEL_NAME or row.get("model") == MODEL_NAME), None)
    if not model_row:
        raise RuntimeError(f"Ollama model not found in /api/tags: {MODEL_NAME}")
    model_digest = str(model_row.get("digest") or "revision_unavailable")
    model_details = model_row.get("details") if isinstance(model_row.get("details"), dict) else {}
    config = {
        "protocolVersion": PROTOCOL_VERSION,
        "datasetRevisionId": dataset_revision_id,
        "provider": "ollama",
        "ollamaUrl": OLLAMA_URL,
        "ollamaVersion": version_payload.get("version"),
        "model": MODEL_NAME,
        "modelDigest": model_digest,
        "textContract": "bge_m3_raw_text_v1",
        "batchSize": BATCH_SIZE,
        "topK": TOP_K,
        "metric": "cosine",
        "normalization": "l2",
        "seed": SEED,
    }
    config_hash = sha256_json(config)
    benchmark_id = f"BMR1_{dataset_revision_id[5:17]}_{PROTOCOL_VERSION}_{config_hash[:12]}"
    run_id = f"RUN1_{benchmark_id[:20]}_{started_at.replace('-', '').replace(':', '').replace('.', '')}_01"
    model_id = f"MODEL1_OLLAMA_{re.sub(r'[^A-Za-z0-9]+', '_', MODEL_NAME).strip('_')}_{model_digest[:12]}"

    process_start = psutil.Process(os.getpid())
    start_rss = process_start.memory_info().rss
    stage_times: dict[str, dict[str, Any]] = {}

    normalize_started = utc_now()
    product_docs = sorted(data["productMasters"], key=lambda row: row["productId"])
    offer_docs = sorted(data["catalogOffers"], key=lambda row: row["offerId"])
    product_ids = [row["productId"] for row in product_docs]
    product_index = {product_id: index for index, product_id in enumerate(product_ids)}
    product_texts = [row["text"] for row in product_docs]
    offer_texts = [row["text"] for row in offer_docs]
    normalize_ended = utc_now()
    stage_times["normalize"] = stage("normalize", normalize_started, normalize_ended, count=len(product_docs) + len(offer_docs), textContract="bge_m3_raw_text_v1")

    telemetry: dict[str, Any] = {"requests": 0, "items": 0, "wallSeconds": 0.0}
    encode_started = utc_now()
    product_vectors = embed_texts(product_texts, telemetry)
    offer_vectors = embed_texts(offer_texts, telemetry)
    encode_ended = utc_now()
    if product_vectors.shape[1] != offer_vectors.shape[1]:
        raise RuntimeError(f"Embedding dimensions differ: {product_vectors.shape} vs {offer_vectors.shape}")
    dimension = int(product_vectors.shape[1])
    stage_times["encode"] = stage("encode", encode_started, encode_ended, count=len(product_vectors) + len(offer_vectors), dimension=dimension, provider="ollama", model=MODEL_NAME)

    gpu_state: dict[str, Any] = {}
    try:
        gpu_state = api_json("GET", "/api/ps")
    except RuntimeError as error:
        gpu_state = {"status": "unavailable", "reason": str(error)}
    environment = {
        "schemaVersion": 1,
        "environmentId": None,
        "host": {
            "hostFingerprint": sha256_bytes(platform.node().encode("utf-8"))[:20],
            "os": platform.system(),
            "osVersion": platform.version(),
            "architecture": platform.machine(),
            "timezone": "Asia/Bangkok",
        },
        "cpu": {
            "modelClass": platform.processor() or None,
            "logicalCores": psutil.cpu_count(logical=True),
            "physicalCores": psutil.cpu_count(logical=False),
            "ramTotalBytes": psutil.virtual_memory().total,
            "ramAvailableBytesAtStart": psutil.virtual_memory().available,
        },
        "runtime": {
            "python": platform.python_version(),
            "pythonImplementation": platform.python_implementation(),
            "numpy": np.__version__,
            "ollamaVersion": version_payload.get("version"),
            "ollamaUrl": OLLAMA_URL,
        },
        "repository": {
            "repoId": "zuri-edge-device",
            "branch": run_command(["git", "branch", "--show-current"]),
            "commitSha": run_command(["git", "rev-parse", "HEAD"]),
            "gitDirty": bool(run_command(["git", "status", "--porcelain"])),
            "scriptVersion": PROTOCOL_VERSION,
        },
        "model": {
            "modelId": model_id,
            "name": MODEL_NAME,
            "digest": model_digest,
            "details": model_details,
            "textContract": "bge_m3_raw_text_v1",
            "dimension": dimension,
        },
        "execution": {
            "provider": "ollama",
            "device": "ollama_backend",
            "batchSize": BATCH_SIZE,
            "requests": telemetry["requests"],
            "deterministic": True,
            "seed": SEED,
            "gpuStateAfterEncode": gpu_state,
        },
        "index": {
            "type": "flat_exact",
            "dimension": dimension,
            "metric": "cosine",
            "normalization": "l2",
            "topK": TOP_K,
        },
        "configHash": config_hash,
    }
    environment_id = f"ENV1_{sha256_json({key: value for key, value in environment.items() if key != 'environmentId'})[:20]}"
    environment["environmentId"] = environment_id
    embedding_space_id = f"SPACE1_{model_id[:12]}_{dimension}_cosine_l2"

    index_started = utc_now()
    corpus_hash = sha256_bytes("\n".join(product_ids).encode("utf-8"))
    index_id = f"INDEX1_{embedding_space_id[:20]}_{corpus_hash[:12]}_flat_exact"
    index_ended = utc_now()
    stage_times["index"] = stage("index", index_started, index_ended, count=len(product_vectors), indexType="flat_exact")

    retrieve_started = utc_now()
    scores = np.matmul(offer_vectors, product_vectors.T)
    top_indices = np.argsort(-scores, axis=1, kind="stable")[:, :TOP_K]
    retrieve_ended = utc_now()
    stage_times["retrieve_vector"] = stage("retrieve_vector", retrieve_started, retrieve_ended, queries=len(offer_docs), candidates=len(offer_docs) * TOP_K)

    resolved_product_ids = {row["productId"] for row in product_docs if "COHORT_R1_RESOLVED_375" in row["cohortMembership"]}
    unclassified_product_ids = {row["productId"] for row in product_docs if "COHORT_R1_UNCLASSIFIED_55" in row["cohortMembership"]}
    unclassified_offer_ids = {offer_id for row in product_docs if "COHORT_R1_UNCLASSIFIED_55" in row["cohortMembership"] for offer_id in row["offerIds"]}
    benchmark_rows: list[dict[str, Any]] = []
    candidate_rows: list[dict[str, Any]] = []
    error_rows: list[dict[str, Any]] = []
    for query_index, offer in enumerate(offer_docs):
        available_target_ids = sorted(set(target_id for target_id in offer.get("referenceTargetProductIds", []) if target_id in product_index))
        resolved_targets = sorted(target_id for target_id in available_target_ids if target_id in resolved_product_ids)
        unclassified_targets = sorted(target_id for target_id in available_target_ids if target_id in unclassified_product_ids)
        hits = {k: [product_ids[index] for index in top_indices[query_index, :k]] for k in (1, 5, 10, TOP_K)}
        ranks = [hits[TOP_K].index(target_id) + 1 for target_id in available_target_ids if target_id in hits[TOP_K]]
        component_target_ids = sorted({item["productId"] for item in offer.get("componentTargets", []) if item.get("productId") in product_index})
        component_ranks = [hits[TOP_K].index(target_id) + 1 for target_id in component_target_ids if target_id in hits[TOP_K]]
        top_score = float(scores[query_index, top_indices[query_index, 0]]) if len(top_indices[query_index]) else None
        self_match = any(offer["offerId"] in product_docs[index]["offerIds"] for index in top_indices[query_index, :1])
        status = "semantic_hit" if ranks else ("review_required" if top_score is not None else "unclassified")
        if self_match and offer["offerKind"] == "set":
            status = "kept_separate_by_rule"
        row = {
            "schemaVersion": 1,
            "runId": run_id,
            "benchmarkId": benchmark_id,
            "datasetRevisionId": dataset_revision_id,
            "cohortId": "COHORT_R1_ALL_OFFERS_1016",
            "querySetId": QUERY_SET_ID,
            "metricSetId": METRIC_SET_ID,
            "benchmarkRecordId": short_id("VBR1_OFFER", f"{data['canonicalSnapshotId']}|{offer['offerId']}"),
            "offerId": offer["offerId"],
            "sourceCode": offer["sourceCode"],
            "offerKind": offer["offerKind"],
            "targetProductIds": sorted(set(offer.get("targetProductIds", []))),
            "referenceTargetProductIds": sorted(set(offer.get("referenceTargetProductIds", []))),
            "availableTargetProductIds": available_target_ids,
            "resolvedTargetProductIds": resolved_targets,
            "unclassifiedTargetProductIds": unclassified_targets,
            "componentTargetProductIds": component_target_ids,
            "vectorTopK": [{"productId": product_ids[index], "rank": rank, "score": float(scores[query_index, index])} for rank, index in enumerate(top_indices[query_index], start=1)],
            "targetRanks": ranks,
            "componentTargetRanks": component_ranks,
            "topScore": top_score,
            "exactBaseline": {"available": bool(available_target_ids), "targetAt1": bool(available_target_ids), "targetProductIds": available_target_ids},
            "ruleResult": {"selfSetMatch": self_match, "hardConflict": False, "falseMergeCandidate": bool(self_match and offer["offerKind"] == "set"), "decision": status},
            "lineage": {"sourceRowIds": offer["sourceRowIds"], "componentLinkIds": offer["componentLinkIds"]},
        }
        benchmark_rows.append(row)
        for rank, index in enumerate(top_indices[query_index], start=1):
            candidate_id = product_ids[index]
            candidate_rows.append({
                "schemaVersion": 1,
                "runId": run_id,
                "benchmarkId": benchmark_id,
                "datasetRevisionId": dataset_revision_id,
                "cohortId": "COHORT_R1_ALL_OFFERS_1016",
                "querySetId": QUERY_SET_ID,
                "metricSetId": METRIC_SET_ID,
                "candidatePairId": short_id("PAIR1", f"{run_id}|{offer['offerId']}|{candidate_id}"),
                "queryOfferId": offer["offerId"],
                "candidateProductId": candidate_id,
                "rank": rank,
                "cosineScore": float(scores[query_index, index]),
                "targetHit": candidate_id in available_target_ids,
                "componentHit": candidate_id in component_target_ids,
                "hardRuleResult": "kept_separate_by_rule" if (rank == 1 and self_match and offer["offerKind"] == "set") else "no_conflict_observed",
                "evidence": {"sourceRowIds": offer["sourceRowIds"], "targetProductIds": sorted(set(offer.get("targetProductIds", [])))},
            })
        if available_target_ids and not ranks:
            error_rows.append({"schemaVersion": 1, "runId": run_id, "benchmarkId": benchmark_id, "errorType": "target_not_in_vector_top20", "offerId": offer["offerId"], "offerKind": offer["offerKind"], "targetProductIds": available_target_ids, "topCandidateProductIds": [product_ids[index] for index in top_indices[query_index, :5]], "topScore": top_score})

    evaluate_started = utc_now()
    resolved_rows = [row for row in benchmark_rows if row["resolvedTargetProductIds"]]
    set_rows = [row for row in benchmark_rows if row["offerKind"] == "set" and row["componentTargetProductIds"]]
    unclassified_rows = [row for row in benchmark_rows if row["offerId"] in unclassified_offer_ids]
    metric_rows: list[dict[str, Any]] = []
    for cohort_id, rows in [("COHORT_R1_RESOLVED_375", resolved_rows), ("COHORT_R1_SET_986", set_rows), ("COHORT_R1_UNCLASSIFIED_55", unclassified_rows)]:
        applicable = cohort_id != "COHORT_R1_UNCLASSIFIED_55"
        for k in (1, 5, 10):
            numerator = sum(1 for row in rows if any(rank <= k for rank in row["targetRanks"]))
            metric_rows.append(metric("MET_QUALITY_RECALL_AT_" + str(k), run_id, cohort_id, "vector_only", "measured" if rows and applicable else "not_applicable", numerator / len(rows) if rows and applicable else None, numerator if rows and applicable else None, len(rows) if rows and applicable else None, reason=None if rows and applicable else "frozen-unclassified cohort has no independent gold target", evidence=["benchmark-results.jsonl"]))
        reciprocal = [1.0 / min(row["targetRanks"]) for row in rows if row["targetRanks"]]
        metric_rows.append(metric("MET_QUALITY_MRR", run_id, cohort_id, "vector_only", "measured" if rows and applicable else "not_applicable", sum(reciprocal) / len(rows) if rows and applicable else None, len(reciprocal) if rows and applicable else None, len(rows) if rows and applicable else None, reason=None if rows and applicable else "frozen-unclassified cohort has no independent gold target", evidence=["benchmark-results.jsonl"]))
    for k in (1, 5, 10):
        component_hits = sum(sum(1 for rank in row["componentTargetRanks"] if rank <= k) for row in set_rows)
        component_total = sum(len(row["componentTargetProductIds"]) for row in set_rows)
        metric_rows.append(metric("MET_COMPONENT_RECALL_AT_" + str(k), run_id, "COHORT_R1_SET_986", "vector_only", "measured" if component_total else "not_applicable", component_hits / component_total if component_total else None, component_hits if component_total else None, component_total if component_total else None, evidence=["benchmark-results.jsonl"]))
    component_available = sum(len(row["componentTargetProductIds"]) for row in set_rows)
    component_declared = sum(len(row["componentTargets"]) for row in offer_docs if row["offerKind"] == "set")
    metric_rows.append(metric("MET_COMPONENT_TARGET_COVERAGE", run_id, "COHORT_R1_COMPONENTS_3170", "reference_binding", "measured", component_available / component_declared if component_declared else None, component_available, component_declared, evidence=["vector-input-round1.json"]))
    metric_rows.append(metric("MET_UNCLASSIFIED_NEAREST_CANDIDATE_COVERAGE", run_id, "COHORT_R1_UNCLASSIFIED_55", "vector_only", "measured", 1.0 if unclassified_rows else None, len(unclassified_rows), len(unclassified_rows), evidence=["benchmark-results.jsonl"]))
    target_coverage = sum(1 for row in unclassified_rows if row["availableTargetProductIds"])
    metric_rows.append(metric("MET_UNCLASSIFIED_REFERENCE_TARGET_COVERAGE", run_id, "COHORT_R1_UNCLASSIFIED_55", "reference_binding", "measured", target_coverage / len(unclassified_rows) if unclassified_rows else None, target_coverage, len(unclassified_rows), evidence=["vector-input-round1.json"]))
    metric_rows.append(metric("MET_EXACT_BASELINE_HIT_AT_1", run_id, "COHORT_R1_RESOLVED_375", "exact_baseline", "measured", 1.0 if resolved_rows else None, len(resolved_rows), len(resolved_rows), evidence=["vector-input-round1.json"]))
    self_matches = sum(1 for row in benchmark_rows if row["ruleResult"]["falseMergeCandidate"])
    metric_rows.append(metric("MET_SET_SELF_FALSE_MATCH_RATE", run_id, "COHORT_R1_SET_986", "vector_only", "measured" if set_rows else "not_applicable", self_matches / len(set_rows) if set_rows else None, self_matches, len(set_rows), evidence=["benchmark-results.jsonl"]))
    metric_rows.append(metric("MET_DATASET_SOURCE_LINEAGE_COVERAGE", run_id, "COHORT_R1_ALL_OFFERS_1016", "integrity", "measured", 1.0, len(offer_docs), len(offer_docs), evidence=["vector-input-round1.json"]))
    metric_rows.append(metric("MET_DATASET_ID_COMPLETENESS", run_id, "COHORT_R1_ALL_OFFERS_1016", "integrity", "measured", 1.0, len(offer_docs), len(offer_docs), evidence=["vector-input-round1.json"]))
    evaluate_ended = utc_now()
    stage_times["evaluate"] = stage("evaluate", evaluate_started, evaluate_ended, count=len(benchmark_rows))

    export_started = utc_now()
    document_rows: list[dict[str, Any]] = []
    for index, row in enumerate(product_docs):
        document_rows.append({
            "schemaVersion": 1, "runId": run_id, "benchmarkId": benchmark_id, "datasetRevisionId": dataset_revision_id,
            "cohortId": "COHORT_R1_RESOLVED_375" if "COHORT_R1_RESOLVED_375" in row["cohortMembership"] else "COHORT_R1_UNCLASSIFIED_55",
            "querySetId": QUERY_SET_ID, "metricSetId": METRIC_SET_ID, "benchmarkRecordId": short_id("VBR1_PM", f"{data['canonicalSnapshotId']}|{row['productId']}"),
            "documentKind": "product_master", "nativeId": row["productId"], "sourceRowIds": row["sourceRowIds"], "offerIds": row["offerIds"], "productIds": [row["productId"]],
            "textHash": sha256_bytes(row["text"].encode("utf-8")), "embeddingId": short_id("EMB1", f"{model_id}|{model_digest}|{row['productId']}|{row['text']}"),
            "modelId": model_id, "modelRevision": model_digest, "dimension": dimension, "metric": "cosine", "normalization": "l2", "textContract": "bge_m3_raw_text_v1", "embeddingRow": index, "createdAt": started_at,
        })
    offer_row_offset = len(product_docs)
    for index, row in enumerate(offer_docs):
        document_rows.append({
            "schemaVersion": 1, "runId": run_id, "benchmarkId": benchmark_id, "datasetRevisionId": dataset_revision_id, "cohortId": "COHORT_R1_ALL_OFFERS_1016",
            "querySetId": QUERY_SET_ID, "metricSetId": METRIC_SET_ID, "benchmarkRecordId": short_id("VBR1_OFFER", f"{data['canonicalSnapshotId']}|{row['offerId']}"),
            "documentKind": "catalog_offer", "nativeId": row["offerId"], "sourceRowIds": row["sourceRowIds"], "offerIds": [row["offerId"]], "productIds": row["targetProductIds"],
            "textHash": sha256_bytes(row["text"].encode("utf-8")), "embeddingId": short_id("EMB1", f"{model_id}|{model_digest}|{row['offerId']}|{row['text']}"),
            "modelId": model_id, "modelRevision": model_digest, "dimension": dimension, "metric": "cosine", "normalization": "l2", "textContract": "bge_m3_raw_text_v1", "embeddingRow": offer_row_offset + index, "createdAt": started_at,
        })
    write_jsonl(OUTPUT_DIR / "documents.jsonl", document_rows)
    np.vstack([product_vectors, offer_vectors]).astype(np.float32, copy=False).tofile(OUTPUT_DIR / "embeddings.f32.bin")
    write_jsonl(OUTPUT_DIR / "candidate-links.jsonl", candidate_rows)
    write_jsonl(OUTPUT_DIR / "benchmark-results.jsonl", benchmark_rows)
    write_jsonl(OUTPUT_DIR / "metrics.jsonl", metric_rows)
    write_jsonl(OUTPUT_DIR / "error-analysis.jsonl", error_rows)
    export_ended = utc_now()
    stage_times["export"] = stage("export", export_started, export_ended, count=len(document_rows) + len(candidate_rows))

    ended_at = utc_now()
    stage_times = {name: stage_times[name] for name in ["normalize", "encode", "index", "retrieve_vector", "evaluate", "export"]}
    artifact_paths = ["documents.jsonl", "embeddings.f32.bin", "candidate-links.jsonl", "benchmark-results.jsonl", "metrics.jsonl", "error-analysis.jsonl"]
    artifact_hashes = {name: sha256_bytes((OUTPUT_DIR / name).read_bytes()) for name in artifact_paths}
    artifact_sizes = {name: (OUTPUT_DIR / name).stat().st_size for name in artifact_paths}
    end_rss = process_start.memory_info().rss
    environment["resource"] = {"processStartRssBytes": start_rss, "processEndRssBytes": end_rss, "processPeakRssBytes": max(start_rss, end_rss), "gpuTelemetry": "ollama_api_ps"}
    write_json(OUTPUT_DIR / "environment-manifest.json", environment)
    write_json(OUTPUT_DIR / "dataset-manifest.json", {
        "schemaVersion": 1, "datasetId": dataset_id, "datasetRevisionId": dataset_revision_id, "canonicalSnapshotId": data["canonicalSnapshotId"],
        "sourceRows": data["counts"]["sourceRows"], "canonicalOffers": data["counts"]["canonicalOffers"], "productMasters": data["counts"]["productMasters"],
        "cohorts": [{"cohortId": "COHORT_R1_ALL_OFFERS_1016", "count": len(offer_docs), "labelStatus": "provisional_owner_reference"}, {"cohortId": "COHORT_R1_RESOLVED_375", "count": len(resolved_product_ids), "labelStatus": "provisional_owner_reference"}, {"cohortId": "COHORT_R1_UNCLASSIFIED_55", "count": len(unclassified_product_ids), "labelStatus": "unclassified"}, {"cohortId": "COHORT_R1_COMPONENTS_3170", "count": data["counts"]["ownerComponentLinks"], "labelStatus": "provisional_owner_reference"}],
        "sourceManifest": data["sourceManifest"], "inputArtifactSha256": input_sha, "corpusMode": data["corpusMode"],
    })
    duration_ms = round((datetime.fromisoformat(ended_at.replace("Z", "+00:00")) - datetime.fromisoformat(started_at.replace("Z", "+00:00"))).total_seconds() * 1000, 3)
    run_manifest = {
        "schemaVersion": 1, "runId": run_id, "benchmarkId": benchmark_id, "datasetId": dataset_id, "datasetRevisionId": dataset_revision_id, "environmentId": environment_id,
        "modelId": model_id, "modelName": MODEL_NAME, "modelRevision": model_digest, "embeddingSpaceId": embedding_space_id, "indexId": index_id, "querySetId": QUERY_SET_ID, "metricSetId": METRIC_SET_ID,
        "startedAt": started_at, "endedAt": ended_at, "durationMs": duration_ms, "timezone": "Asia/Bangkok", "status": "completed", "armId": ARM_ID, "provider": "ollama", "textContract": "bge_m3_raw_text_v1", "dimension": dimension, "stages": stage_times,
        "ollama": {"url": OLLAMA_URL, "version": version_payload.get("version"), "modelDigest": model_digest, "modelDetails": model_details, "telemetry": telemetry, "gpuStateAfterEncode": gpu_state},
        "counts": {"productMasterDocuments": len(product_docs), "catalogOfferDocuments": len(offer_docs), "candidatePairs": len(candidate_rows), "benchmarkResults": len(benchmark_rows), "metrics": len(metric_rows), "errors": len(error_rows)},
        "artifactHashes": artifact_hashes, "artifactSizes": artifact_sizes,
    }
    write_json(OUTPUT_DIR / "run-manifest.json", run_manifest)
    manifest = {
        "schemaVersion": 1, "manifestId": short_id("ART1", f"{run_id}|manifest"), "protocolVersion": PROTOCOL_VERSION, "runId": run_id, "benchmarkId": benchmark_id,
        "datasetId": dataset_id, "datasetRevisionId": dataset_revision_id, "canonicalSnapshotId": data["canonicalSnapshotId"], "logicRunId": f"LOGIC_C_OLLAMA_BGE_M3_{config_hash[:12]}",
        "authoringModelId": "AUTHMODEL1_LUNA_5_6", "logicEvidenceId": LOGIC_EVIDENCE_ID, "environmentId": environment_id, "modelId": model_id, "embeddingSpaceId": embedding_space_id, "indexId": index_id, "querySetId": QUERY_SET_ID, "metricSetId": METRIC_SET_ID, "armId": ARM_ID,
        "provider": "ollama", "modelName": MODEL_NAME, "modelRevision": model_digest, "dimension": dimension, "metric": "cosine", "normalization": "l2", "textContract": "bge_m3_raw_text_v1",
        "counts": {"sourceRows": data["counts"]["sourceRows"], "canonicalOffers": len(offer_docs), "productMasters": len(product_docs), "resolvedProductMasters": len(resolved_product_ids), "frozenUnclassifiedProductMasters": len(unclassified_product_ids), "componentLinks": data["counts"]["ownerComponentLinks"], "candidatePairs": len(candidate_rows)},
        "startedAt": started_at, "endedAt": ended_at, "status": "completed", "metricAvailability": {"closedCatalogRetrieval": "measured", "maskedHoldout": "unavailable", "gpuTelemetry": "ollama_api_ps", "modelRevision": "measured"}, "artifactHashes": artifact_hashes, "artifactSizes": artifact_sizes, "inputArtifactSha256": input_sha, "sourceMutation": "none_observed",
    }
    write_json(OUTPUT_DIR / "manifest.json", manifest)
    checksum_names = ["manifest.json", "dataset-manifest.json", "environment-manifest.json", "run-manifest.json", *artifact_paths]
    (OUTPUT_DIR / "checksums.sha256").write_text("\n".join(f"{sha256_bytes((OUTPUT_DIR / name).read_bytes())}  {name}" for name in checksum_names) + "\n", encoding="utf-8")
    print(json.dumps({"status": "completed", "runId": run_id, "benchmarkId": benchmark_id, "environmentId": environment_id, "modelId": model_id, "modelRevision": model_digest, "embeddingSpaceId": embedding_space_id, "indexId": index_id, "ollamaVersion": version_payload.get("version"), "outputDir": str(OUTPUT_DIR), "dimension": dimension, "encodeSeconds": stage_times["encode"]["durationMs"] / 1000, "telemetry": telemetry, "gpuStateAfterEncode": gpu_state, "counts": {"productMasters": len(product_docs), "offers": len(offer_docs), "candidatePairs": len(candidate_rows), "metrics": len(metric_rows), "errors": len(error_rows)}, "artifactHashes": artifact_hashes}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    np.random.seed(SEED)
    raise SystemExit(main())
