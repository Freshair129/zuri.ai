"""Contract tests for the experiment-only GenesisRAG17 E5 sidecar.

Run inside the pinned worker image with the target embedder.py path as argv[1].
The tokenizer and ONNX session are deterministic test doubles here so these
tests exercise batching/order/mask behavior without model inference.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
import tempfile
import unittest
from hashlib import sha256
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace


def load_embedder(path: str):
    spec = importlib.util.spec_from_file_location("embedder_under_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load embedder source: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeTokenizer:
    def __init__(self):
        self.inputs: list[str] = []
        self.encodings = []

    def encode_batch(self, texts):
        self.inputs = list(texts)
        self.encodings = []
        for text in texts:
            index = int(text.rsplit("-", 1)[1])
            ids = [101, index + 1, 102] + [200 + index] * (index % 7)
            self.encodings.append(SimpleNamespace(
                ids=ids,
                attention_mask=[1] * len(ids),
                type_ids=[0] * len(ids),
            ))
        return self.encodings


class FakeSession:
    def __init__(self):
        self.calls = []

    def run(self, output_names, feed):
        import numpy as np

        ids = feed["input_ids"]
        mask = feed["attention_mask"]
        type_ids = feed["token_type_ids"]
        self.calls.append({
            "output_names": list(output_names),
            "ids": ids.copy(),
            "mask": mask.copy(),
            "type_ids": type_ids.copy(),
        })
        hidden = np.zeros((ids.shape[0], ids.shape[1], 384), dtype=np.float32)
        hidden[:, :, 0] = ids + 1
        hidden[:, :, 1] = 1
        return [hidden]


def expected_vector(ids):
    first = sum(token_id + 1 for token_id in ids) / len(ids)
    norm = math.sqrt(first * first + 1)
    return first / norm, 1 / norm


class EmbedderBatchingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if len(sys.argv) < 2:
            raise RuntimeError("provide the embedder.py path as argv[1]")
        cls.embedder = load_embedder(sys.argv[1])

    def setUp(self):
        self.batch_env = patch.dict(os.environ, {"KI17_EMBED_BATCH_SIZE": "32"}, clear=False)
        self.batch_env.start()
        self.addCleanup(self.batch_env.stop)
        self.embedder._CAPTURE_SESSION_ID = None
        self.embedder._CAPTURE_SESSION_STARTED_NS = None
        self.embedder._CAPTURE_REQUEST_ORDINAL = 0
        self.embedder._CAPTURE_VECTOR_COUNTS = {"passage": 0, "query": 0}

    def test_passage_calls_are_capped_at_32_in_input_order(self):
        texts = [f"entry-{index:03d}" for index in range(65)]
        tokenizer = FakeTokenizer()
        session = FakeSession()

        vectors = self.embedder.embed(tokenizer, session, texts, "passage")

        # A single 65-row ONNX call is the current failure this change fixes.
        self.assertEqual([call["ids"].shape[0] for call in session.calls], [32, 32, 1])
        self.assertEqual(tokenizer.inputs, [f"passage: {text}" for text in texts])
        self.assertEqual(len(vectors), len(texts))

        for index, (vector, encoding) in enumerate(zip(vectors, tokenizer.encodings)):
            first, second = expected_vector(encoding.ids)
            self.assertAlmostEqual(vector[0], first, places=6, msg=f"row order at {index}")
            self.assertAlmostEqual(vector[1], second, places=6, msg=f"row order at {index}")
            self.assertEqual(len(vector), 384)

    def test_each_batch_uses_its_local_padding_and_masks(self):
        texts = [f"entry-{index:03d}" for index in range(65)]
        tokenizer = FakeTokenizer()
        session = FakeSession()

        self.embedder.embed(tokenizer, session, texts, "passage")

        self.assertEqual([call["ids"].shape for call in session.calls], [(32, 9), (32, 9), (1, 4)])
        offset = 0
        for call in session.calls:
            count, width = call["ids"].shape
            for row in range(count):
                encoding = tokenizer.encodings[offset + row]
                length = len(encoding.ids)
                self.assertEqual(call["ids"][row, :length].tolist(), encoding.ids)
                self.assertEqual(call["mask"][row, :length].tolist(), [1] * length)
                self.assertEqual(call["type_ids"][row, :length].tolist(), [0] * length)
                self.assertEqual(call["ids"][row, length:width].tolist(), [0] * (width - length))
                self.assertEqual(call["mask"][row, length:width].tolist(), [0] * (width - length))
                self.assertEqual(call["type_ids"][row, length:width].tolist(), [0] * (width - length))
            offset += count
        self.assertEqual(offset, len(texts))

    def test_query_prefix_and_small_batch_contract_are_unchanged(self):
        texts = ["query-000", "query-001"]
        tokenizer = FakeTokenizer()
        session = FakeSession()

        vectors = self.embedder.embed(tokenizer, session, texts, "query")

        self.assertEqual(tokenizer.inputs, [f"query: {text}" for text in texts])
        self.assertEqual([call["ids"].shape[0] for call in session.calls], [2])
        self.assertEqual(len(vectors), 2)

    def test_global_control_is_one_batch_without_changing_vector_order(self):
        texts = [f"entry-{index:03d}" for index in range(65)]
        tokenizer = FakeTokenizer()
        session = FakeSession()

        with patch.dict(os.environ, {"KI17_EMBED_BATCH_SIZE": "0"}, clear=False):
            vectors = self.embedder.embed(tokenizer, session, texts, "passage")

        self.assertEqual([call["ids"].shape[0] for call in session.calls], [65])
        self.assertEqual(len(vectors), 65)
        self.assertEqual(tokenizer.inputs, [f"passage: {text}" for text in texts])

    def test_optional_capture_writes_ordered_vectors_and_no_text(self):
        import numpy as np

        texts = [f"entry-{index:03d}" for index in range(65)]
        tokenizer = FakeTokenizer()
        session = FakeSession()
        with patch.dict(os.environ, {"KI17_EMBED_CAPTURE_DIR": ""}, clear=False):
            vectors_without_capture = self.embedder.embed(tokenizer, session, texts, "passage")
        tokenizer = FakeTokenizer()
        session = FakeSession()
        with tempfile.TemporaryDirectory() as capture_dir:
            with patch.dict(os.environ, {"KI17_EMBED_CAPTURE_DIR": capture_dir}, clear=False):
                vectors = self.embedder.embed(tokenizer, session, texts, "passage")

            session_dirs = list(Path(capture_dir).iterdir())
            self.assertEqual(len(session_dirs), 1)
            session_dir = session_dirs[0]
            request_path = session_dir / "requests.jsonl"
            vectors_path = session_dir / "passage-vectors.f64"
            records = [json.loads(line) for line in request_path.read_text(encoding="utf-8").splitlines()]
            stored = np.fromfile(vectors_path, dtype="<f8").reshape((65, 384))
            expected = np.asarray(vectors, dtype="<f8")

            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["mode"], "passage")
            self.assertEqual(records[0]["vectorCount"], 65)
            self.assertEqual(records[0]["requestOrdinal"], 0)
            self.assertEqual(
                records[0]["orderedTextSha256"],
                sha256(json.dumps(texts, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest(),
            )
            self.assertTrue(np.array_equal(stored, expected))
            self.assertEqual(vectors, vectors_without_capture)
            capture_text = request_path.read_text(encoding="utf-8")
            self.assertNotIn("entry-", capture_text)

    def test_capture_hash_distinguishes_different_text_arrays_with_newlines(self):
        texts_a = ["entry-000\nentry-001", "entry-002"]
        texts_b = ["entry-000", "entry-001\nentry-002"]
        tokenizer = FakeTokenizer()
        session = FakeSession()

        with tempfile.TemporaryDirectory() as capture_dir:
            with patch.dict(os.environ, {"KI17_EMBED_CAPTURE_DIR": capture_dir}, clear=False):
                self.embedder.embed(tokenizer, session, texts_a, "passage")
                self.embedder.embed(tokenizer, session, texts_b, "passage")

            session_dirs = list(Path(capture_dir).iterdir())
            self.assertEqual(len(session_dirs), 1)
            records = [
                json.loads(line)
                for line in (session_dirs[0] / "requests.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(len(records), 2)
            self.assertNotEqual(records[0]["orderedTextSha256"], records[1]["orderedTextSha256"])

    def test_global_and_fixed32_fake_vectors_match_exactly(self):
        texts = [f"entry-{index:03d}" for index in range(65)]
        with patch.dict(os.environ, {"KI17_EMBED_BATCH_SIZE": "0"}, clear=False):
            global_vectors = self.embedder.embed(FakeTokenizer(), FakeSession(), texts, "passage")
        with patch.dict(os.environ, {"KI17_EMBED_BATCH_SIZE": "32"}, clear=False):
            batch_vectors = self.embedder.embed(FakeTokenizer(), FakeSession(), texts, "passage")
        self.assertEqual(global_vectors, batch_vectors)

    def test_separate_sidecar_processes_do_not_overwrite_capture_trace(self):
        second_embedder = load_embedder(self.embedder.__file__)
        texts = ["entry-000"]

        with tempfile.TemporaryDirectory() as capture_dir:
            with patch.dict(os.environ, {"KI17_EMBED_CAPTURE_DIR": capture_dir}, clear=False):
                self.embedder.embed(FakeTokenizer(), FakeSession(), texts, "passage")
                second_embedder.embed(FakeTokenizer(), FakeSession(), texts, "passage")

            session_dirs = list(Path(capture_dir).iterdir())
            self.assertEqual(len(session_dirs), 2)
            session_ids = {
                json.loads((session_dir / "requests.jsonl").read_text(encoding="utf-8").splitlines()[0])["sessionId"]
                for session_dir in session_dirs
            }
            self.assertEqual(len(session_ids), 2)

    def test_only_global_or_fixed_32_batch_profiles_are_accepted(self):
        texts = ["entry-000"]
        tokenizer = FakeTokenizer()
        session = FakeSession()

        with patch.dict(os.environ, {"KI17_EMBED_BATCH_SIZE": "16"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "EMBED_BATCH_SIZE_UNSUPPORTED"):
                self.embedder.embed(tokenizer, session, texts, "passage")

        self.assertEqual(session.calls, [])


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
