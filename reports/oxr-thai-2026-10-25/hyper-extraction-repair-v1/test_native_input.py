"""No-model contract checks for the source-native GenesisRAG17 input arm."""

import hashlib
import unittest

from build_native_input import build_native_input


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class NativeInputTests(unittest.TestCase):
    def test_preserves_baselines_and_binds_exact_source_projection(self):
        prefix = "control\n\n"
        plain_text = prefix + "plain source"
        table_text = prefix + "table source"
        base = {
            "controlFileSha256": "control-hash",
            "arms": [
                {"parser": "plain", "content": plain_text, "contentSha256": sha(plain_text),
                 "ranges": [{"id": "economy", "start": len(prefix), "end": len(plain_text),
                             "textSha256": sha("plain source")}]},
                {"parser": "table", "content": table_text, "contentSha256": sha(table_text),
                 "ranges": [{"id": "economy", "start": len(prefix), "end": len(table_text),
                             "textSha256": sha("table source")}]},
            ],
        }
        raw = "raw row\n"
        frame = "[CELL refs]\n"
        projection_text = raw + frame
        projection = {
            "profile": "test",
            "text": projection_text,
            "textSha256": sha(projection_text),
            "summary": {"sourceRangesReconstructedExactly": True,
                        "rawRangeCoveragePct": 100.0, "rawSourceRangeChars": len(raw),
                        "generatedFramingChars": len(frame), "sourceZonesIncluded": 1,
                        "sourceRowsIncluded": 1, "nonTableContextZonesIncluded": 0,
                        "resolvedCellCandidates": 1, "contextCellsIncludedButUnqualified": 0},
            "sourceRanges": [{"rangeId": "economy", "projectionStart": 0,
                              "projectionEnd": len(projection_text), "sourceStart": 10,
                              "sourceEnd": 10 + len(raw), "sourceTextSha256": sha(raw)}],
            "snippets": [{"zoneId": "zone-1", "documentId": "economy",
                          "zoneKind": "table-row", "projectionStart": 0,
                          "projectionEnd": len(projection_text), "sourceTextChars": len(raw),
                          "sourceStart": 10, "sourceEnd": 10 + len(raw),
                          "sourceTextSha256": sha(raw), "resolvedCellRecordIds": ["cell-1"],
                          "resolvedValueCellCount": 1, "unqualifiedContextCellCount": 0}],
            "sourceGaps": [],
        }
        native = build_native_input(base, projection, {
            "sourceNativeFreezeSha256": "native-freeze",
            "sourceNativeProjectionFreezeSha256": "projection-freeze",
            "sourceNativeProjectionSha256": "projection-output",
        })
        arms = {arm["parser"]: arm for arm in native["arms"]}
        self.assertEqual(arms["plain"]["content"], plain_text)
        self.assertEqual(arms["plain"]["contentSha256"], sha(plain_text))
        self.assertEqual(arms["table"]["content"], table_text)
        self.assertEqual(arms["table"]["contentSha256"], sha(table_text))
        self.assertEqual(arms["plain"]["ranges"][0]["doc"], "economy")
        self.assertEqual(arms["table"]["ranges"][0]["doc"], "economy")
        source = arms["source-native-all-rows-v1"]
        self.assertEqual(source["content"], prefix + projection_text)
        self.assertEqual(source["content"][source["ranges"][0]["start"]:
                                             source["ranges"][0]["end"]], projection_text)
        self.assertEqual(source["projection"]["sourceRangeCoveragePct"], 100.0)
        self.assertEqual(source["projection"]["semanticStatus"], "NOT_ASSESSED")
        self.assertEqual(source["projection"]["graphAdmission"], "NONE")
        self.assertFalse(native["candidateSidecarIncluded"])


if __name__ == "__main__":
    unittest.main()
