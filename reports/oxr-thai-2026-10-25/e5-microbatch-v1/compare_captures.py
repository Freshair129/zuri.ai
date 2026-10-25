"""Compare captured GenesisRAG17 E5 outputs without reading query text."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

DIMENSIONS = 384
MAX_ABS_TOLERANCE = 1e-5
MIN_COSINE = 0.999999


def ordered_text_sha(texts: list[str]) -> str:
    encoded = json.dumps(texts, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def read_capture(root: str | Path) -> list[dict]:
    root = Path(root)
    if not root.is_dir():
        raise RuntimeError(f"missing capture directory: {root}")
    records: list[dict] = []
    seen_sessions: set[str] = set()
    for session_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        request_path = session_dir / "requests.jsonl"
        if not request_path.is_file():
            raise RuntimeError(f"capture session has no request manifest: {session_dir.name}")
        session_records = [
            json.loads(line)
            for line in request_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if not session_records:
            raise RuntimeError(f"empty capture session: {session_dir.name}")
        session_id = session_records[0].get("sessionId")
        if not isinstance(session_id, str) or session_id in seen_sessions:
            raise RuntimeError("missing or duplicate capture session ID")
        seen_sessions.add(session_id)
        per_mode_next: dict[str, int] = {"passage": 0, "query": 0}
        for ordinal, record in enumerate(session_records):
            if record.get("schema") != "genesisrag17-embedding-capture-v1":
                raise RuntimeError("unknown capture schema")
            if record.get("sessionId") != session_id or record.get("requestOrdinal") != ordinal:
                raise RuntimeError("capture session order/identity mismatch")
            mode = record.get("mode")
            count = record.get("vectorCount")
            if mode not in per_mode_next or not isinstance(count, int) or count <= 0:
                raise RuntimeError("invalid capture mode or vector count")
            if record.get("dimension") != DIMENSIONS or record.get("dtype") != "<f8":
                raise RuntimeError("capture dimension/dtype mismatch")
            if not isinstance(record.get("orderedTextSha256"), str) or len(record["orderedTextSha256"]) != 64:
                raise RuntimeError("missing ordered-input hash")
            expected_start = per_mode_next[mode]
            if record.get("vectorStartIndex") != expected_start:
                raise RuntimeError("capture vector offsets are not contiguous")
            expected_name = f"{mode}-vectors.f64"
            if record.get("vectorFile") != expected_name:
                raise RuntimeError("unexpected vector filename")
            vector_path = session_dir / expected_name
            if not vector_path.is_file():
                raise RuntimeError(f"missing vector data: {expected_name}")
            record["_sessionDir"] = str(session_dir)
            record["_vectorsPath"] = str(vector_path)
            per_mode_next[mode] += count
        for mode, expected_count in per_mode_next.items():
            vector_path = session_dir / f"{mode}-vectors.f64"
            if expected_count == 0:
                if vector_path.exists():
                    raise RuntimeError(f"unexpected empty vector file for {mode}")
                continue
            expected_bytes = expected_count * DIMENSIONS * 8
            if vector_path.stat().st_size != expected_bytes:
                raise RuntimeError(f"vector byte count mismatch for {mode}")
        records.extend(session_records)
    if not records:
        raise RuntimeError(f"capture directory has no sidecar sessions: {root}")
    records.sort(key=lambda row: (int(row["requestCapturedAtNs"]), int(row["sessionStartedAtNs"]), row["sessionId"], row["requestOrdinal"]))
    return records


def vectors_for(records: list[dict], mode: str) -> tuple[list[dict], np.ndarray]:
    selected = [record for record in records if record["mode"] == mode]
    if not selected:
        return [], np.empty((0, DIMENSIONS), dtype=np.float64)
    pieces: list[np.ndarray] = []
    for record in selected:
        start = record["vectorStartIndex"]
        count = record["vectorCount"]
        with open(record["_vectorsPath"], "rb") as handle:
            handle.seek(start * DIMENSIONS * 8)
            raw = handle.read(count * DIMENSIONS * 8)
        vectors = np.frombuffer(raw, dtype="<f8")
        if vectors.size != count * DIMENSIONS:
            raise RuntimeError("short vector read")
        vectors = vectors.reshape((count, DIMENSIONS)).astype(np.float64, copy=False)
        if not np.isfinite(vectors).all():
            raise RuntimeError("non-finite captured vector")
        norms = np.linalg.norm(vectors, axis=1)
        if np.any(norms == 0):
            raise RuntimeError("zero captured vector")
        pieces.append(vectors)
    return selected, np.concatenate(pieces, axis=0)


def signatures(records: list[dict]) -> list[tuple[str, str, int, int]]:
    occurrences: dict[tuple[str, str, int], int] = {}
    result = []
    for record in records:
        key = (record["mode"], record["orderedTextSha256"], record["vectorCount"])
        occurrence = occurrences.get(key, 0)
        occurrences[key] = occurrence + 1
        result.append((*key, occurrence))
    return result


def compare(left: np.ndarray, right: np.ndarray) -> dict:
    if left.shape != right.shape or left.ndim != 2 or left.shape[1] != DIMENSIONS:
        raise RuntimeError("paired vector matrices differ in shape")
    if not np.isfinite(left).all() or not np.isfinite(right).all():
        raise RuntimeError("non-finite paired embedding")
    delta = np.abs(left - right)
    dots = np.einsum("ij,ij->i", left, right)
    norms = np.linalg.norm(left, axis=1) * np.linalg.norm(right, axis=1)
    if np.any(norms == 0):
        raise RuntimeError("zero paired embedding")
    cosines = dots / norms
    max_abs = float(delta.max(initial=0.0))
    min_cosine = float(cosines.min(initial=1.0))
    return {
        "vectorCount": int(left.shape[0]),
        "dimension": DIMENSIONS,
        "maxAbsDifference": max_abs,
        "minCosine": min_cosine,
        "maxAbsTolerance": MAX_ABS_TOLERANCE,
        "minCosineThreshold": MIN_COSINE,
        "pass": max_abs <= MAX_ABS_TOLERANCE and min_cosine >= MIN_COSINE,
    }


def main() -> int:
    if len(sys.argv) != 5:
        raise RuntimeError(
            "usage: compare_captures.py global_capture_dir batch32_capture_dir chunks.json output.json"
        )
    global_dir, batch_dir, chunks_path, output_path = sys.argv[1:]
    chunks = json.loads(Path(chunks_path).read_text(encoding="utf-8"))
    passage_texts = [chunk["text"] for chunk in chunks]
    expected_passage_hash = ordered_text_sha(passage_texts)
    if len(passage_texts) != 302:
        raise RuntimeError("expected frozen 302-chunk input")

    global_records = read_capture(global_dir)
    batch_records = read_capture(batch_dir)
    for label, records in (("global", global_records), ("batch32", batch_records)):
        passage_requests = [record for record in records if record["mode"] == "passage"]
        query_requests = [record for record in records if record["mode"] == "query"]
        if len(passage_requests) != 1 or passage_requests[0]["vectorCount"] != 302:
            raise RuntimeError(f"{label} must contain exactly one 302-vector passage request")
        if not query_requests or sum(record["vectorCount"] for record in query_requests) <= 0:
            raise RuntimeError(f"{label} must contain at least one query vector")
    if signatures(global_records) != signatures(batch_records):
        raise RuntimeError("global and batch32 request sequence/multiplicity differs")

    for record in global_records + batch_records:
        if record["mode"] == "passage":
            if record["vectorCount"] != 302 or record["orderedTextSha256"] != expected_passage_hash:
                raise RuntimeError("passage trace does not bind the exact ordered frozen chunks")

    summaries = {}
    for mode in ("passage", "query"):
        global_requests, global_vectors = vectors_for(global_records, mode)
        batch_requests, batch_vectors = vectors_for(batch_records, mode)
        result = compare(global_vectors, batch_vectors)
        if mode == "passage" and result["vectorCount"] != 302 * len(global_requests):
            raise RuntimeError("passage capture count/request count mismatch")
        summaries[mode] = {
            **result,
            "requestCount": len(global_requests),
            "globalCaptureSessions": len({row["sessionId"] for row in global_requests}),
            "batch32CaptureSessions": len({row["sessionId"] for row in batch_requests}),
        }

    report = {
        "schema": "e5-captured-vector-parity-v1",
        "status": "PASS" if all(item["pass"] for item in summaries.values()) else "FAIL",
        "input": {
            "chunksFileSha256": hashlib.sha256(Path(chunks_path).read_bytes()).hexdigest(),
            "orderedPassageTextSha256": expected_passage_hash,
            "passageCountPerRequest": len(passage_texts),
        },
        "requestSequence": {
            "globalRequestCount": len(global_records),
            "batch32RequestCount": len(batch_records),
            "queryVectorCount": summaries["query"]["vectorCount"],
            "sequenceMatches": signatures(global_records) == signatures(batch_records),
            "signatures": [
                {"mode": mode, "orderedTextSha256": digest, "vectorCount": count, "occurrence": occurrence}
                for mode, digest, count, occurrence in signatures(global_records)
            ],
        },
        "modes": summaries,
        "rawTextStored": False,
    }
    Path(output_path).write_text(json.dumps(report, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "status": report["status"],
        "requests": report["requestSequence"]["globalRequestCount"],
        "passage": summaries["passage"],
        "query": summaries["query"],
    }, separators=(",", ":")))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
