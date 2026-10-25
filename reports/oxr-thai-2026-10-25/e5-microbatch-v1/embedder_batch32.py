#!/usr/bin/env python3
"""Minimal, deterministic CPU embedding sidecar for the pinned E5 model.

The Node worker verifies the revision and every artifact hash before starting
this process. This sidecar only loads those exact paths and has no fallback
model or network behavior.
"""

import json
import hashlib
import os
import sys
import time
import traceback
import uuid

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


MODEL_DIMENSIONS = 384
MAX_LENGTH = 512
MAX_EMBED_BATCH = 32
_CAPTURE_SESSION_ID = None
_CAPTURE_SESSION_STARTED_NS = None
_CAPTURE_REQUEST_ORDINAL = 0
_CAPTURE_VECTOR_COUNTS = {"passage": 0, "query": 0}


def fail(message):
    raise RuntimeError(message)


def configured_batch_size(encoded_count):
    raw_value = os.environ.get("KI17_EMBED_BATCH_SIZE", str(MAX_EMBED_BATCH))
    try:
        requested = int(raw_value)
    except ValueError:
        fail("EMBED_BATCH_SIZE_INVALID")
    if requested not in (0, MAX_EMBED_BATCH):
        fail("EMBED_BATCH_SIZE_UNSUPPORTED")
    return encoded_count if requested == 0 else MAX_EMBED_BATCH


def capture_vectors(mode, texts, vectors):
    global _CAPTURE_SESSION_ID, _CAPTURE_SESSION_STARTED_NS, _CAPTURE_REQUEST_ORDINAL

    capture_root = os.environ.get("KI17_EMBED_CAPTURE_DIR")
    if not capture_root:
        return
    if mode not in _CAPTURE_VECTOR_COUNTS:
        fail("EMBED_CAPTURE_MODE_INVALID")
    if _CAPTURE_SESSION_ID is None:
        _CAPTURE_SESSION_ID = f"{os.getpid()}-{uuid.uuid4().hex}"
        _CAPTURE_SESSION_STARTED_NS = time.time_ns()
    session_dir = os.path.join(capture_root, _CAPTURE_SESSION_ID)
    os.makedirs(session_dir, exist_ok=True)

    vector_file = f"{mode}-vectors.f64"
    vector_start = _CAPTURE_VECTOR_COUNTS[mode]
    array = np.asarray(vectors, dtype="<f8")
    if array.shape != (len(texts), MODEL_DIMENSIONS):
        fail("EMBED_CAPTURE_VECTOR_SHAPE")
    vector_path = os.path.join(session_dir, vector_file)
    with open(vector_path, "ab") as handle:
        array.tofile(handle)

    record = {
        "schema": "genesisrag17-embedding-capture-v1",
        "sessionId": _CAPTURE_SESSION_ID,
        "processId": os.getpid(),
        "sessionStartedAtNs": _CAPTURE_SESSION_STARTED_NS,
        "requestCapturedAtNs": time.time_ns(),
        "requestOrdinal": _CAPTURE_REQUEST_ORDINAL,
        "mode": mode,
        "vectorCount": len(vectors),
        "dimension": MODEL_DIMENSIONS,
        "dtype": "<f8",
        "vectorFile": vector_file,
        "vectorStartIndex": vector_start,
        "orderedTextSha256": hashlib.sha256(
            json.dumps(texts, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
    }
    with open(os.path.join(session_dir, "requests.jsonl"), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, separators=(",", ":")) + "\n")
    _CAPTURE_VECTOR_COUNTS[mode] += len(vectors)
    _CAPTURE_REQUEST_ORDINAL += 1


def load(model_dir):
    tokenizer_path = os.path.join(model_dir, "tokenizer.json")
    model_path = os.path.join(model_dir, "onnx", "model.onnx")
    tokenizer = Tokenizer.from_file(tokenizer_path)
    tokenizer.enable_truncation(max_length=MAX_LENGTH)
    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    input_names = {item.name for item in session.get_inputs()}
    if input_names != {"input_ids", "attention_mask", "token_type_ids"}:
        fail("ONNX_INPUT_SCHEMA_MISMATCH")
    outputs = session.get_outputs()
    if len(outputs) != 1 or outputs[0].name != "last_hidden_state":
        fail("ONNX_OUTPUT_SCHEMA_MISMATCH")
    shape = outputs[0].shape
    if len(shape) != 3 or shape[-1] != MODEL_DIMENSIONS:
        fail("ONNX_OUTPUT_DIMENSION_MISMATCH")
    return tokenizer, session


def embed(tokenizer, session, texts, mode):
    if mode not in ("query", "passage"):
        fail("EMBED_MODE_INVALID")
    prefix = "query: " if mode == "query" else "passage: "
    encoded = tokenizer.encode_batch([prefix + text for text in texts])
    if not encoded:
        return []
    vectors = []
    batch_size = configured_batch_size(len(encoded))
    for offset in range(0, len(encoded), batch_size):
        batch = encoded[offset:offset + batch_size]
        max_len = max(len(item.ids) for item in batch)
        max_len = min(max_len, MAX_LENGTH)
        ids = np.zeros((len(batch), max_len), dtype=np.int64)
        attention = np.zeros((len(batch), max_len), dtype=np.int64)
        type_ids = np.zeros((len(batch), max_len), dtype=np.int64)
        for row, item in enumerate(batch):
            size = min(len(item.ids), max_len)
            ids[row, :size] = item.ids[:size]
            attention[row, :size] = item.attention_mask[:size]
            type_ids[row, :size] = item.type_ids[:size]
        output = session.run(["last_hidden_state"], {
            "input_ids": ids,
            "attention_mask": attention,
            "token_type_ids": type_ids,
        })[0]
        mask = attention.astype(np.float32)[..., None]
        pooled = (output * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1e-9)
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        if np.any(norms <= 0) or not np.isfinite(norms).all():
            fail("EMBEDDING_ZERO_OR_NONFINITE")
        normalized = pooled / norms
        vectors.extend(normalized.astype(np.float64).tolist())
    capture_vectors(mode, texts, vectors)
    return vectors


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "MODEL_DIR_REQUIRED"}), flush=True)
        return 2
    try:
        tokenizer, session = load(sys.argv[1])
        print(json.dumps({"ready": True, "dimensions": MODEL_DIMENSIONS, "provider": "CPUExecutionProvider"}), flush=True)
        for line in sys.stdin:
            if not line.strip():
                continue
            request_id = None
            try:
                request = json.loads(line)
                request_id = request.get("id")
                texts = request.get("texts")
                if not isinstance(texts, list) or any(not isinstance(text, str) for text in texts):
                    fail("EMBED_TEXTS_INVALID")
                vectors = embed(tokenizer, session, texts, request.get("mode", "passage"))
                print(json.dumps({"id": request_id, "vectors": vectors, "dimensions": MODEL_DIMENSIONS}, separators=(",", ":")), flush=True)
            except Exception as error:
                print(json.dumps({"id": request_id, "error": str(error)}, separators=(",", ":")), flush=True)
    except Exception as error:
        print(json.dumps({"error": str(error), "trace": traceback.format_exc(limit=1)}), flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
