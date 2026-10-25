"""No-QA integration checks for the source-only economy row arm."""

from __future__ import annotations

import json
import unittest

from build_native_input import (
    BASELINE_PATH,
    PRIOR_NATIVE_PATH,
    PRIOR_PROJECTION_PATH,
    ROWS_PATH,
    _sha_bytes,
    build_native_input,
)


class NativeInputTests(unittest.TestCase):
    def test_row_overlay_preserves_table_arm_and_binds_only_source_rows(self) -> None:
        base = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
        prior_native = json.loads(PRIOR_NATIVE_PATH.read_text(encoding="utf-8"))
        prior_projection = json.loads(PRIOR_PROJECTION_PATH.read_text(encoding="utf-8"))
        source_rows = json.loads(ROWS_PATH.read_text(encoding="utf-8"))
        built = build_native_input(
            base,
            prior_native,
            prior_projection,
            source_rows,
            hashes={"pdfBaselineRows": _sha_bytes(ROWS_PATH.read_bytes())},
        )

        baseline = next(arm for arm in base["arms"] if arm["parser"] == "table")
        current_table = next(arm for arm in built["arms"] if arm["parser"] == "table")
        candidate = next(arm for arm in built["arms"] if arm["parser"] == "source-pdf-repair-plus-economy-rows-v1")
        self.assertEqual(current_table["content"], baseline["content"])
        self.assertEqual(current_table["contentSha256"], baseline["contentSha256"])
        previous_candidate = next(arm for arm in prior_native["arms"] if arm["parser"] == "source-pdf-repair-v1")
        self.assertTrue(candidate["content"].startswith(previous_candidate["content"]))
        self.assertEqual(
            candidate["ranges"][:len(previous_candidate["ranges"])],
            previous_candidate["ranges"],
            "prior repair range records must remain an exact metadata prefix",
        )
        self.assertTrue(candidate["content"].startswith(baseline["content"]))
        self.assertEqual(candidate["derivedRowProfile"]["sourceRows"], 37)
        self.assertEqual(candidate["derivedRowProfile"]["sourceValueCells"], 259)

        row_ranges = [item for item in candidate["ranges"] if item.get("rangeKind") == "PDF_NATIVE_BASELINE_ROW_CANDIDATE"]
        context = [item for item in candidate["ranges"] if item.get("rangeKind") == "PDF_TABLE_CONTEXT_ONLY"]
        self.assertEqual(len(row_ranges), 37)
        self.assertEqual(len(context), 1)
        for item in row_ranges:
            text = candidate["content"][item["start"]:item["end"]]
            self.assertEqual(text.split(" | ")[0], f"row={json.dumps(item['rowLabelText'], ensure_ascii=False, separators=(',', ':'))}")
            self.assertEqual(len(item["cells"]), 7)
            self.assertNotIn("sourceStart", item)
            self.assertNotIn("sourceEnd", item)
            self.assertEqual(item["semanticStatus"], "NOT_ASSESSED")
        self.assertEqual(candidate["content"][context[0]["start"]:context[0]["end"]], 'table_context="2567" (context only; not assigned to month columns)')
        self.assertEqual(candidate["derivedRowProfile"]["legacySourceCellStatusesCarried"], 0)
        self.assertFalse(built["goldQuestionsOrMetricsUsed"])


if __name__ == "__main__":
    unittest.main()
