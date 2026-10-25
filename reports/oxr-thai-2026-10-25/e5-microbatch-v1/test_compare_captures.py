"""No-model contract tests for the captured-vector comparer."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


def load_module(path: str):
    spec = importlib.util.spec_from_file_location("compare_captures_under_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load comparator: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CaptureComparisonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if len(sys.argv) < 2:
            raise RuntimeError("provide compare_captures.py path as argv[1]")
        cls.comparator = load_module(sys.argv[1])

    def test_nonempty_capture_records_and_vector_ranges_are_read(self):
        with tempfile.TemporaryDirectory() as temp:
            session = Path(temp) / "123-session"
            session.mkdir()
            vectors = np.zeros((2, 384), dtype="<f8")
            vectors[:, 0] = 1.0
            vectors.tofile(session / "passage-vectors.f64")
            record = {
                "schema": "genesisrag17-embedding-capture-v1",
                "sessionId": "123-session",
                "processId": 123,
                "sessionStartedAtNs": 10,
                "requestCapturedAtNs": 11,
                "requestCapturedAtNs": 11,
                "requestOrdinal": 0,
                "mode": "passage",
                "vectorCount": 2,
                "dimension": 384,
                "dtype": "<f8",
                "vectorFile": "passage-vectors.f64",
                "vectorStartIndex": 0,
                "orderedTextSha256": "a" * 64,
            }
            (session / "requests.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")

            records = self.comparator.read_capture(temp)
            selected, actual = self.comparator.vectors_for(records, "passage")

            self.assertEqual(len(records), 1)
            self.assertEqual(len(selected), 1)
            self.assertEqual(actual.shape, (2, 384))
            self.assertTrue(np.array_equal(actual, vectors))

    def test_empty_capture_cannot_pass_as_zero_vector_parity(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(RuntimeError, "no sidecar sessions"):
                self.comparator.read_capture(temp)

    def test_orphan_or_truncated_vector_bytes_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            session = Path(temp) / "123-session"
            session.mkdir()
            (session / "passage-vectors.f64").write_bytes(b"\x00" * 8)
            record = {
                "schema": "genesisrag17-embedding-capture-v1",
                "sessionId": "123-session",
                "sessionStartedAtNs": 10,
                "requestCapturedAtNs": 11,
                "requestOrdinal": 0,
                "mode": "passage",
                "vectorCount": 1,
                "dimension": 384,
                "dtype": "<f8",
                "vectorFile": "passage-vectors.f64",
                "vectorStartIndex": 0,
                "orderedTextSha256": "b" * 64,
            }
            (session / "requests.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "byte count mismatch"):
                self.comparator.read_capture(temp)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
