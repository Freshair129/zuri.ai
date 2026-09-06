"""Run the local Round-1 embedding sidecar benchmark.

This script is intentionally sidecar-only. It reads the generated vector input,
encodes ProductMaster and CatalogOffer documents, performs exact cosine search
with NumPy, and writes immutable benchmark artifacts under the new benchmark
directory. It never writes the active Genesis store or the prior review outputs.
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
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import psutil
import sentence_transformers
import torch
from sentence_transformers import SentenceTransformer


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = Path(os.environ.get(
    "GENESIS_VECTOR_INPUT_PATH",
    ROOT / "data/catalog_vector_benchmark_round1_v1/vector-input-round1.json",
)).resolve()
OUTPUT_DIR = Path(os.environ.get(
    "GENESIS_VECTOR_OUTPUT_DIR",
    ROOT / "data/catalog_vector_benchmark_round1_v1",
)).resolve()
MODEL_NAME = os.environ.get("GENESIS_EMBEDDING_MODEL", "intfloat/multilingual-e5-small")
BATCH_SIZE = int(os.environ.get("GENESIS_EMBEDDING_BATCH_SIZE", "32"))
TOP_K = 20
SEED = 20260823
METRIC_SET_ID = "METRICS1_benchmark-measurement-v1"
PROTOCOL_VERSION = "vector-benchmark-round1-v1"
CALCULATION_VERSION = "benchmark-measurement-v1"
LOGIC_EVIDENCE_ID = os.environ.get(
    "GENESIS_LOGIC_EVIDENCE_ID",
    "EVIDENCE1_GENESIS-RAG-CATALOG-VECTOR-BENCHMARK-ROUND1-SPEC@0.5.0b",
)


def text_contract(model_name: str) -> dict[str, str]:
    normalized = model_name.lower()
    if "e5" in normalized:
        return {
            "id": "e5_query_passage_v1",
            "queryPrefix": "query: ",
            "corpusPrefix": "passage: ",
        }
    if "bge-m3" in normalized:
        return {
            "id": "bge_m3_raw_text_v1",
            "queryPrefix": "",
            "corpusPrefix": "",
        }
    return {
        "id": "raw_text_v1",
        "queryPrefix": "",
        "corpusPrefix": "",
    }


def arm_id_for_model(model_name: str) -> str:
    normalized = model_name.lower()
    if "multilingual-e5-small" in normalized:
        return "EMB_ONLY_E5S"
    if "bge-m3" in normalized:
        return "EMB_ONLY_BGE_M3"
    safe_name = re.sub(r"[^A-Za-z0-9]+", "_", model_name).strip("_").upper()
    return f"EMB_ONLY_{safe_name}"


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


def run_command(args: list[str]) -> str | None:
    try:
        completed = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=False)
        value = completed.stdout.strip()
        return value or None
    except OSError:
        return None


def package_version(module: Any) -> str | None:
    return getattr(module, "__version__", None)


def model_revision(model: SentenceTransformer) -> str | None:
    candidates: list[str | None] = []
    candidates.append(getattr(model, "revision", None))
    candidates.append(getattr(model, "_revision", None))
    try:
        auto_model = model[0].auto_model
        candidates.append(getattr(auto_model.config, "_commit_hash", None))
        candidates.append(getattr(auto_model.config, "revision", None))
    except Exception:
        pass
    for candidate in candidates:
        if candidate and candidate not in {"main", "None"}:
            return str(candidate)
    return None


def normalize_environment(
    model_revision_value: str | None,
    config_hash: str,
    dimension: int,
    contract: dict[str, str],
    arm_id: str,
) -> dict[str, Any]:
    memory = psutil.virtual_memory()
    environment = {
        "schemaVersion": 1,
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
            "ramTotalBytes": memory.total,
            "ramAvailableBytesAtStart": memory.available,
        },
        "gpu": {
            "vendor": None,
            "model": None,
            "vramBytes": None,
            "driver": None,
            "device": "cuda" if torch.cuda.is_available() else "cpu",
            "availability": "measured" if torch.cuda.is_available() else "unavailable",
        },
        "runtime": {
            "python": platform.python_version(),
            "pythonImplementation": platform.python_implementation(),
            "pytorch": package_version(torch),
            "sentenceTransformers": package_version(sentence_transformers),
            "numpy": package_version(np),
        },
        "repository": {
            "repoId": "zuri-edge-device",
            "branch": run_command(["git", "branch", "--show-current"]),
            "commitSha": run_command(["git", "rev-parse", "HEAD"]),
            "gitDirty": bool(run_command(["git", "status", "--porcelain"])),
            "scriptVersion": PROTOCOL_VERSION,
        },
        "model": {
            "modelId": MODEL_NAME,
            "revision": model_revision_value,
            "revisionAvailability": "measured" if model_revision_value else "unavailable",
            "precision": "float32",
            "maxSequenceLength": None,
            "textContract": contract,
        },
        "execution": {
            "device": "cuda" if torch.cuda.is_available() else "cpu",
            "batchSize": BATCH_SIZE,
            "workers": 1,
            "threads": torch.get_num_threads(),
            "seed": SEED,
            "deterministic": True,
            "armId": arm_id,
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
    return environment


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


def percentile(values: list[float], value: float) -> float | None:
    if not values:
        return None
    return float(np.percentile(np.asarray(values, dtype=np.float64), value))


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


def main() -> int:
    global QUERY_SET_ID
    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"Vector input not found: {INPUT_PATH}")
    data = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    QUERY_SET_ID = data["querySetId"]
    dataset_id = data["datasetId"]
    dataset_revision_id = data["datasetRevisionId"]
    input_sha = sha256_bytes(INPUT_PATH.read_bytes())

    config = {
        "protocolVersion": PROTOCOL_VERSION,
        "datasetRevisionId": dataset_revision_id,
        "model": MODEL_NAME,
        "textContract": text_contract(MODEL_NAME),
        "batchSize": BATCH_SIZE,
        "topK": TOP_K,
        "metric": "cosine",
        "normalization": "l2",
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "seed": SEED,
    }
    config_hash = sha256_json(config)
    benchmark_id = f"BMR1_{dataset_revision_id[5:17]}_{PROTOCOL_VERSION}_{config_hash[:12]}"
    started_at = utc_now()
    run_id = f"RUN1_{benchmark_id[:20]}_{started_at.replace('-', '').replace(':', '').replace('.', '')}_01"

    stage_times: dict[str, dict[str, Any]] = {}
    process_start = psutil.Process(os.getpid())
    start_rss = process_start.memory_info().rss

    normalize_started = utc_now()
    product_docs = sorted(data["productMasters"], key=lambda row: row["productId"])
    offer_docs = sorted(data["catalogOffers"], key=lambda row: row["offerId"])
    contract = text_contract(MODEL_NAME)
    arm_id = arm_id_for_model(MODEL_NAME)
    product_ids = [row["productId"] for row in product_docs]
    product_index = {product_id: index for index, product_id in enumerate(product_ids)}
    product_texts = [f"{contract['corpusPrefix']}{row['text']}" for row in product_docs]
    offer_texts = [f"{contract['queryPrefix']}{row['text']}" for row in offer_docs]
    normalize_ended = utc_now()
    stage_times["normalize"] = stage("normalize", normalize_started, normalize_ended, count=len(product_docs) + len(offer_docs))

    encode_started = utc_now()
    model = SentenceTransformer(MODEL_NAME, device="cuda" if torch.cuda.is_available() else "cpu")
    revision = model_revision(model)
    if getattr(model, "max_seq_length", None) is not None:
        max_sequence_length = int(model.max_seq_length)
    else:
        max_sequence_length = None
    product_vectors = model.encode(
        product_texts,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    ).astype(np.float32, copy=False)
    offer_vectors = model.encode(
        offer_texts,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    ).astype(np.float32, copy=False)
    encode_ended = utc_now()
    stage_times["encode"] = stage("encode", encode_started, encode_ended, count=len(product_vectors) + len(offer_vectors), dimension=int(product_vectors.shape[1]))

    if product_vectors.ndim != 2 or offer_vectors.ndim != 2 or product_vectors.shape[1] != offer_vectors.shape[1]:
        raise RuntimeError(
            f"Embedding dimension mismatch: product={product_vectors.shape}, offer={offer_vectors.shape}"
        )
    dimension = int(product_vectors.shape[1])

    normalized_environment = normalize_environment(revision, config_hash, dimension, contract, arm_id)
    normalized_environment["model"]["maxSequenceLength"] = max_sequence_length
    environment_id = f"ENV1_{sha256_json({key: value for key, value in normalized_environment.items() if key != 'configHash'})[:20]}"
    embedding_model_id = f"MODEL1_HF_{re.sub(r'[^A-Za-z0-9]+', '_', MODEL_NAME).strip('_')}_{(revision or 'revision_unavailable')[:12]}"
    embedding_space_id = f"SPACE1_{embedding_model_id[:12]}_{dimension}_cosine_l2"

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

    resolved_product_ids = {
        row["productId"]
        for row in product_docs
        if "COHORT_R1_RESOLVED_375" in row["cohortMembership"]
    }
    unclassified_product_ids = {
        row["productId"]
        for row in product_docs
        if "COHORT_R1_UNCLASSIFIED_55" in row["cohortMembership"]
    }
    unclassified_offer_ids = {
        offer_id
        for row in product_docs
        if "COHORT_R1_UNCLASSIFIED_55" in row["cohortMembership"]
        for offer_id in row["offerIds"]
    }

    benchmark_rows: list[dict[str, Any]] = []
    candidate_rows: list[dict[str, Any]] = []
    error_rows: list[dict[str, Any]] = []
    for query_index, offer in enumerate(offer_docs):
        target_ids = sorted(set(offer.get("targetProductIds", [])))
        reference_target_ids = sorted(set(offer.get("referenceTargetProductIds", [])))
        available_target_ids = sorted(target_id for target_id in reference_target_ids if target_id in product_index)
        resolved_targets = sorted(target_id for target_id in available_target_ids if target_id in resolved_product_ids)
        unclassified_targets = sorted(target_id for target_id in available_target_ids if target_id in unclassified_product_ids)
        vector_hits: dict[int, list[str]] = {}
        for k in (1, 5, 10, TOP_K):
            vector_hits[k] = [product_ids[index] for index in top_indices[query_index, :k]]
        ranks = [vector_hits[TOP_K].index(target_id) + 1 for target_id in available_target_ids if target_id in vector_hits[TOP_K]]
        component_target_ids = sorted({item["productId"] for item in offer.get("componentTargets", []) if item.get("productId") in product_index})
        component_ranks = [vector_hits[TOP_K].index(target_id) + 1 for target_id in component_target_ids if target_id in vector_hits[TOP_K]]
        top_score = float(scores[query_index, top_indices[query_index, 0]]) if len(top_indices[query_index]) else None
        exact_available = bool(available_target_ids)
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
            "targetProductIds": target_ids,
            "referenceTargetProductIds": reference_target_ids,
            "availableTargetProductIds": available_target_ids,
            "resolvedTargetProductIds": resolved_targets,
            "unclassifiedTargetProductIds": unclassified_targets,
            "componentTargetProductIds": component_target_ids,
            "vectorTopK": [
                {
                    "productId": product_ids[index],
                    "rank": rank,
                    "score": float(scores[query_index, index]),
                }
                for rank, index in enumerate(top_indices[query_index], start=1)
            ],
            "targetRanks": ranks,
            "componentTargetRanks": component_ranks,
            "topScore": top_score,
            "exactBaseline": {
                "available": exact_available,
                "targetAt1": exact_available,
                "targetProductIds": available_target_ids,
            },
            "ruleResult": {
                "selfSetMatch": self_match,
                "hardConflict": False,
                "falseMergeCandidate": bool(self_match and offer["offerKind"] == "set"),
                "decision": status,
            },
            "lineage": {
                "sourceRowIds": offer["sourceRowIds"],
                "componentLinkIds": offer["componentLinkIds"],
            },
        }
        benchmark_rows.append(row)
        for rank, index in enumerate(top_indices[query_index], start=1):
            candidate_id = product_ids[index]
            target_hit = candidate_id in available_target_ids
            component_hit = candidate_id in component_target_ids
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
                "targetHit": target_hit,
                "componentHit": component_hit,
                "hardRuleResult": "kept_separate_by_rule" if (rank == 1 and self_match and offer["offerKind"] == "set") else "no_conflict_observed",
                "evidence": {
                    "sourceRowIds": offer["sourceRowIds"],
                    "targetProductIds": target_ids,
                },
            })
        if available_target_ids and not ranks:
            error_rows.append({
                "schemaVersion": 1,
                "runId": run_id,
                "benchmarkId": benchmark_id,
                "errorType": "target_not_in_vector_top20",
                "offerId": offer["offerId"],
                "offerKind": offer["offerKind"],
                "targetProductIds": available_target_ids,
                "topCandidateProductIds": [product_ids[index] for index in top_indices[query_index, :5]],
                "topScore": top_score,
            })

    evaluate_started = utc_now()
    resolved_rows = [row for row in benchmark_rows if row["resolvedTargetProductIds"]]
    set_rows = [row for row in benchmark_rows if row["offerKind"] == "set" and row["componentTargetProductIds"]]
    unclassified_rows = [row for row in benchmark_rows if row["offerId"] in unclassified_offer_ids]
    metric_rows: list[dict[str, Any]] = []
    for cohort_id, rows in [
        ("COHORT_R1_RESOLVED_375", resolved_rows),
        ("COHORT_R1_SET_986", set_rows),
        ("COHORT_R1_UNCLASSIFIED_55", unclassified_rows),
    ]:
        for k in (1, 5, 10):
            numerator = sum(1 for row in rows if any(rank <= k for rank in row["targetRanks"]))
            applicable = cohort_id != "COHORT_R1_UNCLASSIFIED_55"
            metric_rows.append(metric("MET_QUALITY_RECALL_AT_" + str(k), run_id, cohort_id, "vector_only", "measured" if rows and applicable else "not_applicable", numerator / len(rows) if rows and applicable else None, numerator if rows and applicable else None, len(rows) if rows and applicable else None, reason=None if rows and applicable else ("frozen-unclassified cohort has no independent gold target" if not applicable else "no target-bearing queries in cohort"), evidence=["benchmark-results.jsonl"]))
        reciprocal = [1.0 / min(row["targetRanks"]) for row in rows if row["targetRanks"]]
        applicable = cohort_id != "COHORT_R1_UNCLASSIFIED_55"
        metric_rows.append(metric("MET_QUALITY_MRR", run_id, cohort_id, "vector_only", "measured" if rows and applicable else "not_applicable", sum(reciprocal) / len(rows) if rows and applicable else None, len(reciprocal) if rows and applicable else None, len(rows) if rows and applicable else None, reason=None if rows and applicable else ("frozen-unclassified cohort has no independent gold target" if not applicable else "no target-bearing queries in cohort"), evidence=["benchmark-results.jsonl"]))
    for k in (1, 5, 10):
        component_hits = sum(sum(1 for rank in row["componentTargetRanks"] if rank <= k) for row in set_rows)
        component_total = sum(len(row["componentTargetProductIds"]) for row in set_rows)
        metric_rows.append(metric("MET_COMPONENT_RECALL_AT_" + str(k), run_id, "COHORT_R1_SET_986", "vector_only", "measured" if component_total else "not_applicable", component_hits / component_total if component_total else None, component_hits if component_total else None, component_total if component_total else None, reason=None if component_total else "no component targets available in baseline corpus", evidence=["benchmark-results.jsonl"]))
    component_available = sum(len(row["componentTargetProductIds"]) for row in set_rows)
    component_declared = sum(len(row["componentTargets"]) for row in offer_docs if row["offerKind"] == "set")
    metric_rows.append(metric("MET_COMPONENT_TARGET_COVERAGE", run_id, "COHORT_R1_COMPONENTS_3170", "reference_binding", "measured" if component_declared else "not_applicable", component_available / component_declared if component_declared else None, component_available if component_declared else None, component_declared if component_declared else None, reason=None if component_declared else "no component links", evidence=["vector-input-round1.json"]))
    coverage_numerator = sum(1 for row in unclassified_rows if row["vectorTopK"])
    metric_rows.append(metric("MET_UNCLASSIFIED_NEAREST_CANDIDATE_COVERAGE", run_id, "COHORT_R1_UNCLASSIFIED_55", "vector_only", "measured" if unclassified_rows else "not_applicable", coverage_numerator / len(unclassified_rows) if unclassified_rows else None, coverage_numerator if unclassified_rows else None, len(unclassified_rows) if unclassified_rows else None, evidence=["benchmark-results.jsonl"]))
    target_coverage = sum(1 for row in unclassified_rows if row["availableTargetProductIds"])
    metric_rows.append(metric("MET_UNCLASSIFIED_REFERENCE_TARGET_COVERAGE", run_id, "COHORT_R1_UNCLASSIFIED_55", "reference_binding", "measured" if unclassified_rows else "not_applicable", target_coverage / len(unclassified_rows) if unclassified_rows else None, target_coverage if unclassified_rows else None, len(unclassified_rows) if unclassified_rows else None, evidence=["vector-input-round1.json"]))
    exact_hits = len(resolved_rows)
    metric_rows.append(metric("MET_EXACT_BASELINE_HIT_AT_1", run_id, "COHORT_R1_RESOLVED_375", "exact_baseline", "measured" if resolved_rows else "not_applicable", exact_hits / len(resolved_rows) if resolved_rows else None, exact_hits if resolved_rows else None, len(resolved_rows) if resolved_rows else None, evidence=["vector-input-round1.json"]))
    self_matches = sum(1 for row in benchmark_rows if row["ruleResult"]["falseMergeCandidate"])
    metric_rows.append(metric("MET_SET_SELF_FALSE_MATCH_RATE", run_id, "COHORT_R1_SET_986", "vector_only", "measured" if set_rows else "not_applicable", self_matches / len(set_rows) if set_rows else None, self_matches if set_rows else None, len(set_rows) if set_rows else None, evidence=["benchmark-results.jsonl"]))
    input_data = data
    lineage_rows = sum(1 for row in offer_docs if row.get("sourceRowIds"))
    metric_rows.append(metric("MET_DATASET_SOURCE_LINEAGE_COVERAGE", run_id, "COHORT_R1_ALL_OFFERS_1016", "integrity", "measured", lineage_rows / len(offer_docs), lineage_rows, len(offer_docs), evidence=["vector-input-round1.json"]))
    id_complete = sum(1 for row in offer_docs if row.get("offerId") and row.get("sourceCode"))
    metric_rows.append(metric("MET_DATASET_ID_COMPLETENESS", run_id, "COHORT_R1_ALL_OFFERS_1016", "integrity", "measured", id_complete / len(offer_docs), id_complete, len(offer_docs), evidence=["vector-input-round1.json"]))
    evaluate_ended = utc_now()
    stage_times["evaluate"] = stage("evaluate", evaluate_started, evaluate_ended, count=len(benchmark_rows))

    export_started = utc_now()
    document_rows: list[dict[str, Any]] = []
    for index, row in enumerate(product_docs):
        document_rows.append({
            "schemaVersion": 1,
            "runId": run_id,
            "benchmarkId": benchmark_id,
            "datasetRevisionId": dataset_revision_id,
            "cohortId": "COHORT_R1_RESOLVED_375" if "COHORT_R1_RESOLVED_375" in row["cohortMembership"] else "COHORT_R1_UNCLASSIFIED_55",
            "querySetId": QUERY_SET_ID,
            "metricSetId": METRIC_SET_ID,
            "benchmarkRecordId": short_id("VBR1_PM", f"{data['canonicalSnapshotId']}|{row['productId']}"),
            "documentKind": "product_master",
            "nativeId": row["productId"],
            "sourceRowIds": row["sourceRowIds"],
            "offerIds": row["offerIds"],
            "productIds": [row["productId"]],
            "textHash": sha256_bytes(row["text"].encode("utf-8")),
            "embeddingId": short_id("EMB1", f"{embedding_model_id}|{revision}|{row['productId']}|{row['text']}"),
            "modelId": embedding_model_id,
            "modelRevision": revision,
            "dimension": int(product_vectors.shape[1]),
            "metric": "cosine",
            "normalization": "l2",
            "embeddingRow": index,
            "createdAt": started_at,
        })
    offer_row_offset = len(product_docs)
    for index, row in enumerate(offer_docs):
        document_rows.append({
            "schemaVersion": 1,
            "runId": run_id,
            "benchmarkId": benchmark_id,
            "datasetRevisionId": dataset_revision_id,
            "cohortId": "COHORT_R1_ALL_OFFERS_1016",
            "querySetId": QUERY_SET_ID,
            "metricSetId": METRIC_SET_ID,
            "benchmarkRecordId": short_id("VBR1_OFFER", f"{data['canonicalSnapshotId']}|{row['offerId']}"),
            "documentKind": "catalog_offer",
            "nativeId": row["offerId"],
            "sourceRowIds": row["sourceRowIds"],
            "offerIds": [row["offerId"]],
            "productIds": row["targetProductIds"],
            "textHash": sha256_bytes(row["text"].encode("utf-8")),
            "embeddingId": short_id("EMB1", f"{embedding_model_id}|{revision}|{row['offerId']}|{row['text']}"),
            "modelId": embedding_model_id,
            "modelRevision": revision,
            "dimension": int(offer_vectors.shape[1]),
            "metric": "cosine",
            "normalization": "l2",
            "embeddingRow": offer_row_offset + index,
            "createdAt": started_at,
        })
    write_jsonl(OUTPUT_DIR / "documents.jsonl", document_rows)
    matrix = np.vstack([product_vectors, offer_vectors]).astype(np.float32, copy=False)
    matrix.tofile(OUTPUT_DIR / "embeddings.f32.bin")
    write_jsonl(OUTPUT_DIR / "candidate-links.jsonl", candidate_rows)
    write_jsonl(OUTPUT_DIR / "benchmark-results.jsonl", benchmark_rows)
    write_jsonl(OUTPUT_DIR / "metrics.jsonl", metric_rows)
    write_jsonl(OUTPUT_DIR / "error-analysis.jsonl", error_rows)
    export_ended = utc_now()
    stage_times["export"] = stage("export", export_started, export_ended, count=len(document_rows) + len(candidate_rows))

    ended_at = utc_now()
    stage_times["preflight"] = stage(started_at, started_at, started_at, "passed", inputSha256=input_sha)
    stage_times = {name: stage_times[name] for name in ["preflight", "normalize", "encode", "index", "retrieve_vector", "evaluate", "export"]}
    artifact_paths = [
        "documents.jsonl",
        "embeddings.f32.bin",
        "candidate-links.jsonl",
        "benchmark-results.jsonl",
        "metrics.jsonl",
        "error-analysis.jsonl",
    ]
    artifact_hashes = {name: sha256_bytes((OUTPUT_DIR / name).read_bytes()) for name in artifact_paths}
    artifact_sizes = {name: (OUTPUT_DIR / name).stat().st_size for name in artifact_paths}
    end_rss = process_start.memory_info().rss
    normalized_environment["resource"] = {
        "processStartRssBytes": start_rss,
        "processEndRssBytes": end_rss,
        "processPeakRssBytes": max(start_rss, end_rss),
        "gpuTelemetry": "unavailable" if not torch.cuda.is_available() else "measured",
    }
    write_json(OUTPUT_DIR / "environment-manifest.json", {
        "environmentId": environment_id,
        "benchmarkId": benchmark_id,
        "runId": run_id,
        **normalized_environment,
    })
    write_json(OUTPUT_DIR / "dataset-manifest.json", {
        "schemaVersion": 1,
        "datasetId": dataset_id,
        "datasetRevisionId": dataset_revision_id,
        "canonicalSnapshotId": data["canonicalSnapshotId"],
        "sourceRows": data["counts"]["sourceRows"],
        "canonicalOffers": data["counts"]["canonicalOffers"],
        "productMasters": data["counts"]["productMasters"],
        "cohorts": [
            {"cohortId": "COHORT_R1_ALL_OFFERS_1016", "count": len(offer_docs), "labelStatus": "provisional_owner_reference"},
            {"cohortId": "COHORT_R1_RESOLVED_375", "count": len(resolved_product_ids), "labelStatus": "provisional_owner_reference"},
            {"cohortId": "COHORT_R1_UNCLASSIFIED_55", "count": len(unclassified_product_ids), "labelStatus": "unclassified"},
            {"cohortId": "COHORT_R1_COMPONENTS_3170", "count": data["counts"]["ownerComponentLinks"], "labelStatus": "provisional_owner_reference"},
        ],
        "sourceManifest": data["sourceManifest"],
        "inputArtifactSha256": input_sha,
        "corpusMode": data["corpusMode"],
    })
    write_json(OUTPUT_DIR / "run-manifest.json", {
        "schemaVersion": 1,
        "runId": run_id,
        "benchmarkId": benchmark_id,
        "datasetId": dataset_id,
        "datasetRevisionId": dataset_revision_id,
        "environmentId": environment_id,
        "modelId": embedding_model_id,
        "embeddingSpaceId": embedding_space_id,
        "indexId": index_id,
        "querySetId": QUERY_SET_ID,
        "metricSetId": METRIC_SET_ID,
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationMs": round((datetime.fromisoformat(ended_at.replace("Z", "+00:00")) - datetime.fromisoformat(started_at.replace("Z", "+00:00"))).total_seconds() * 1000, 3),
        "timezone": "Asia/Bangkok",
        "status": "completed",
        "armId": arm_id,
        "modelName": MODEL_NAME,
        "modelRevision": revision,
        "textContract": contract,
        "dimension": dimension,
        "stages": stage_times,
        "counts": {
            "productMasterDocuments": len(product_docs),
            "catalogOfferDocuments": len(offer_docs),
            "candidatePairs": len(candidate_rows),
            "benchmarkResults": len(benchmark_rows),
            "metrics": len(metric_rows),
            "errors": len(error_rows),
        },
        "artifactHashes": artifact_hashes,
        "artifactSizes": artifact_sizes,
    })
    manifest = {
        "schemaVersion": 1,
        "manifestId": short_id("ART1", f"{run_id}|manifest"),
        "protocolVersion": PROTOCOL_VERSION,
        "runId": run_id,
        "benchmarkId": benchmark_id,
        "datasetId": dataset_id,
        "datasetRevisionId": dataset_revision_id,
        "canonicalSnapshotId": data["canonicalSnapshotId"],
        "logicRunId": f"LOGIC_C_VECTOR_{config_hash[:12]}",
        "authoringModelId": "AUTHMODEL1_LUNA_5_6",
        "logicEvidenceId": LOGIC_EVIDENCE_ID,
        "environmentId": environment_id,
        "modelId": embedding_model_id,
        "embeddingSpaceId": embedding_space_id,
        "indexId": index_id,
        "querySetId": QUERY_SET_ID,
        "metricSetId": METRIC_SET_ID,
        "armId": arm_id,
        "modelName": MODEL_NAME,
        "modelRevision": revision,
        "textContract": contract,
        "dimension": dimension,
        "metric": "cosine",
        "normalization": "l2",
        "counts": {
            "sourceRows": data["counts"]["sourceRows"],
            "canonicalOffers": len(offer_docs),
            "productMasters": len(product_docs),
            "resolvedProductMasters": len(resolved_product_ids),
            "frozenUnclassifiedProductMasters": len(unclassified_product_ids),
            "componentLinks": data["counts"]["ownerComponentLinks"],
            "candidatePairs": len(candidate_rows),
        },
        "startedAt": started_at,
        "endedAt": ended_at,
        "status": "completed",
        "metricAvailability": {
            "closedCatalogRetrieval": "measured",
            "maskedHoldout": "unavailable",
            "gpuTelemetry": "unavailable" if not torch.cuda.is_available() else "measured",
            "modelRevision": "measured" if revision else "unavailable",
        },
        "artifactHashes": artifact_hashes,
        "artifactSizes": artifact_sizes,
        "inputArtifactSha256": input_sha,
        "sourceMutation": "none_observed",
    }
    write_json(OUTPUT_DIR / "manifest.json", manifest)
    checksum_names = ["manifest.json", "dataset-manifest.json", "environment-manifest.json", "run-manifest.json", *artifact_paths]
    checksum_path = OUTPUT_DIR / "checksums.sha256"
    checksum_lines = [f"{sha256_bytes((OUTPUT_DIR / name).read_bytes())}  {name}" for name in checksum_names]
    checksum_path.write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")

    print(json.dumps({
        "status": "completed",
        "runId": run_id,
        "benchmarkId": benchmark_id,
        "environmentId": environment_id,
        "modelId": embedding_model_id,
        "embeddingSpaceId": embedding_space_id,
        "indexId": index_id,
        "querySetId": QUERY_SET_ID,
        "metricSetId": METRIC_SET_ID,
        "modelRevision": revision,
        "outputDir": str(OUTPUT_DIR),
        "counts": {
            "productMasters": len(product_docs),
            "offers": len(offer_docs),
            "candidatePairs": len(candidate_rows),
            "metrics": len(metric_rows),
            "errors": len(error_rows),
        },
        "artifactHashes": artifact_hashes,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    raise SystemExit(main())
