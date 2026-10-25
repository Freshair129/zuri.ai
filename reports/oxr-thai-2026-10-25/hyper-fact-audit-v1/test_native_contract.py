import hashlib
import json
import unittest
from pathlib import Path


ROOT = next(p for p in Path(__file__).resolve().parents if (p / "AGENTS.md").is_file())
LOCAL = ROOT / ".local/hyper-fact-audit-20261025"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class NativeProjectionContractTests(unittest.TestCase):
    def test_arm_is_source_only_and_preserves_frozen_baseline_arms(self):
        native = read_json(LOCAL / "native-input-geometry-v1.json")
        base = read_json(ROOT / ".local/thai-table-chunking-20261025/run-v2/native-input.json")
        projection = read_json(LOCAL / "source-projection-geometry-v1.json")
        by_parser = {arm["parser"]: arm for arm in native["arms"]}
        base_by_parser = {arm["parser"]: arm for arm in base["arms"]}
        self.assertEqual(set(by_parser), {"plain", "table", "hyper-fact-geometry-v1"})
        self.assertEqual(by_parser["plain"]["contentSha256"], base_by_parser["plain"]["contentSha256"])
        self.assertEqual(by_parser["table"]["contentSha256"], base_by_parser["table"]["contentSha256"])

        arm = by_parser["hyper-fact-geometry-v1"]
        self.assertTrue(arm["content"].endswith(projection["text"]))
        self.assertEqual(arm["projection"]["sourceTextSha256"], projection["textSha256"])
        self.assertEqual(arm["contentSha256"], sha(arm["content"]))
        self.assertFalse(arm["projection"]["graphFieldsIncluded"])
        self.assertFalse(arm["projection"]["candidateTextIncluded"])
        self.assertEqual(arm["projection"]["semanticStatus"], "NOT_ASSESSED")
        self.assertEqual(native["hyperCandidateSidecar"]["admission"], "NONE; no candidate fact or relation is sent to GenesisRAG17")

    def test_every_native_range_is_the_exact_selected_source_zone(self):
        native = read_json(LOCAL / "native-input-geometry-v1.json")
        projection = read_json(LOCAL / "source-projection-geometry-v1.json")
        bundle = read_json(ROOT / ".local/hyper-relation-audit-20261025/run-5/source-bundle.json")
        arm = next(x for x in native["arms"] if x["parser"] == "hyper-fact-geometry-v1")
        zones = {z["id"]: z for z in bundle["zones"]}
        snippets = {x["zoneId"]: x for x in projection["snippets"]}
        self.assertEqual(set(x["id"] for x in arm["ranges"]), set(snippets))
        for item in arm["ranges"]:
            source_zone = zones[item["zoneId"]]
            snippet = snippets[item["zoneId"]]
            text = arm["content"][item["start"]:item["end"]]
            self.assertEqual(text, source_zone["text"])
            self.assertEqual(text, snippet["text"])
            self.assertEqual(sha(text), item["textSha256"])
            self.assertEqual(item["doc"], source_zone["rangeId"])


if __name__ == "__main__":
    unittest.main()
