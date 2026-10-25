"""Pure source-geometry tests for derived PDF baseline rows."""

from __future__ import annotations

import unittest

from pdf_baseline_rows import bind_raw_ocr_value, derive_header_layout, reconstruct_baselines


def word(index: int, text: str, center_x: float, top: float = 10.0, width: float = 2.0) -> dict:
    return {
        "wordIndex": index,
        "text": text,
        "box": [center_x - width / 2, top, center_x + width / 2, top + 8.0],
    }


class PdfBaselineRowsTests(unittest.TestCase):
    def test_derives_header_centers_from_unique_pdf_words_and_source_rules(self) -> None:
        source_headers = [
            {"row": 4, "cell": slot, "recordIndex": 100 + slot, "text": f"H{slot}",
             "box": [center * 2 - 2, 2, center * 2 + 2, 18], "gridColumns": [slot]}
            for slot, center in enumerate((10.0, 20.0, 30.0))
        ]
        page_words = [
            {"wordIndex": 1, "text": "Year", "box": [18, 0.5, 22, 2.5]},
            {"wordIndex": 2, "text": "H0", "box": [9, 3, 11, 9]},
            {"wordIndex": 3, "text": "H1", "box": [19, 3, 21, 9]},
            {"wordIndex": 4, "text": "H2", "box": [29, 3, 31, 9]},
        ]
        horizontal_edges = [
            {"x0": 4, "x1": 36, "top": 1},
            {"x0": 4, "x1": 36, "top": 10},
        ]
        vertical_edges = [
            {"x0": 4, "x1": 4, "top": 1, "bottom": 10},
            {"x0": 36, "x1": 36, "top": 1, "bottom": 10},
        ]

        layout = derive_header_layout(
            page_words=page_words,
            source_header_records=source_headers,
            horizontal_edges=horizontal_edges,
            vertical_edges=vertical_edges,
            paddle_per_pdf_point_scale=[2.0, 2.0],
        )

        self.assertEqual(layout["status"], "RESOLVED")
        self.assertEqual(layout["headerCentersPdfPoints"], [10.0, 20.0, 30.0])
        self.assertEqual(layout["slotBoundariesPdfPoints"], [4.0, 15.0, 25.0, 36.0])
        self.assertEqual([item["text"] for item in layout["bindings"]], ["H0", "H1", "H2"])
        self.assertNotIn("Year", [item["text"] for item in layout["bindings"]])
        self.assertEqual(layout["contextWords"][0]["text"], "Year")
        self.assertEqual(layout["contextWords"][0]["bindingStatus"], "TABLE_CONTEXT_ONLY")
        self.assertEqual(layout["verticalRuleBandsPdfPoints"], {"left": [4.0, 4.0], "right": [36.0, 36.0]})

    def test_header_word_match_must_be_unique_and_exact(self) -> None:
        headers = [
            {"row": 1, "cell": i, "recordIndex": i, "text": f"H{i}", "box": [x * 2 - 2, 2, x * 2 + 2, 18]}
            for i, x in enumerate((10.0, 20.0, 30.0))
        ]
        words = [
            {"wordIndex": i, "text": f"H{i}", "box": [x - 1, 3, x + 1, 9]}
            for i, x in enumerate((10.0, 20.0, 30.0))
        ]
        words.append({"wordIndex": 3, "text": "H1", "box": [19.5, 3, 20.5, 9]})
        edges = [{"x0": 4, "x1": 36, "top": 1}, {"x0": 4, "x1": 36, "top": 10}]
        vertical_edges = [{"x0": 4, "x1": 4, "top": 1, "bottom": 10}, {"x0": 36, "x1": 36, "top": 1, "bottom": 10}]

        layout = derive_header_layout(
            page_words=words,
            source_header_records=headers,
            horizontal_edges=edges,
            vertical_edges=vertical_edges,
            paddle_per_pdf_point_scale=[2.0, 2.0],
        )

        self.assertEqual(layout["status"], "HELD")
        self.assertEqual(layout["reason"], "SOURCE_HEADER_TO_PDF_WORD_NOT_UNIQUE")

    def test_header_layout_holds_when_source_rule_is_missing_or_header_rows_tie(self) -> None:
        headers = [
            {"row": 1, "cell": i, "recordIndex": i, "text": f"H{i}", "box": [x * 2 - 2, 2, x * 2 + 2, 18]}
            for i, x in enumerate((10.0, 20.0, 30.0))
        ]
        words = [
            {"wordIndex": i, "text": f"H{i}", "box": [x - 1, 3, x + 1, 9]}
            for i, x in enumerate((10.0, 20.0, 30.0))
        ]
        vertical_edges = [{"x0": 4, "x1": 4, "top": 1, "bottom": 10}, {"x0": 36, "x1": 36, "top": 1, "bottom": 10}]
        no_edges = derive_header_layout(
            page_words=words,
            source_header_records=headers,
            horizontal_edges=[],
            vertical_edges=vertical_edges,
            paddle_per_pdf_point_scale=[2.0, 2.0],
        )
        tied_rows = derive_header_layout(
            page_words=words,
            source_header_records=headers + [
                {**header, "row": 2, "recordIndex": header["recordIndex"] + 10}
                for header in headers
            ],
            horizontal_edges=[{"x0": 4, "x1": 36, "top": 1}, {"x0": 4, "x1": 36, "top": 10}],
            vertical_edges=vertical_edges,
            paddle_per_pdf_point_scale=[2.0, 2.0],
        )

        self.assertEqual(no_edges["reason"], "SOURCE_HEADER_OUTER_RULES_MISSING")
        self.assertEqual(tied_rows["reason"], "SOURCE_HEADER_ROW_SELECTION_TIED")

    def test_header_layout_requires_declared_complete_slot_set(self) -> None:
        headers = [
            {"row": 1, "cell": i, "recordIndex": i, "text": f"H{i}", "box": [x * 2 - 2, 2, x * 2 + 2, 18]}
            for i, x in enumerate((10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0))
        ]
        headers[6]["box"] = None
        words = [
            {"wordIndex": i, "text": f"H{i}", "box": [x - 1, 3, x + 1, 9]}
            for i, x in enumerate((10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0))
            if i < 6
        ]
        edges = [{"x0": 4, "x1": 76, "top": 1}, {"x0": 4, "x1": 76, "top": 10}]
        vertical_edges = [{"x0": 4, "x1": 4, "top": 1, "bottom": 10}, {"x0": 76, "x1": 76, "top": 1, "bottom": 10}]

        layout = derive_header_layout(
            page_words=words,
            source_header_records=headers,
            horizontal_edges=edges,
            vertical_edges=vertical_edges,
            paddle_per_pdf_point_scale=[2.0, 2.0],
        )

        self.assertEqual(layout["status"], "HELD")
        self.assertEqual(layout["reason"], "SOURCE_HEADER_CELL_MISSING")

    def test_header_rule_that_includes_a_wide_stub_is_held(self) -> None:
        headers = [
            {"row": 1, "cell": i, "recordIndex": i, "text": f"H{i}", "box": [x * 2 - 2, 2, x * 2 + 2, 18]}
            for i, x in enumerate((10.0, 20.0, 30.0))
        ]
        words = [
            {"wordIndex": i, "text": f"H{i}", "box": [x - 1, 3, x + 1, 9]}
            for i, x in enumerate((10.0, 20.0, 30.0))
        ]
        words.append({"wordIndex": 3, "text": "Row label", "box": [1, 3, 6, 9]})
        edges = [{"x0": 0, "x1": 36, "top": 1}, {"x0": 0, "x1": 36, "top": 10}]
        vertical_edges = [
            {"x0": 0, "x1": 0, "top": 1, "bottom": 10},
            {"x0": 8, "x1": 8, "top": 1, "bottom": 10},
            {"x0": 36, "x1": 36, "top": 1, "bottom": 10},
        ]

        layout = derive_header_layout(
            page_words=words,
            source_header_records=headers,
            horizontal_edges=edges,
            vertical_edges=vertical_edges,
            paddle_per_pdf_point_scale=[2.0, 2.0],
        )

        self.assertEqual(layout["status"], "HELD")
        self.assertEqual(layout["reason"], "SOURCE_HEADER_HORIZONTAL_RULE_INCLUDES_STUB_OR_MISALIGNED")

    def test_header_match_uses_independent_x_and_y_scale(self) -> None:
        headers = [
            {"row": 1, "cell": i, "recordIndex": i, "text": f"H{i}", "box": [x * 2 - 2, 20, x * 2 + 2, 40]}
            for i, x in enumerate((10.0, 20.0, 30.0))
        ]
        words = [
            {"wordIndex": i, "text": f"H{i}", "box": [x - 1, 6, x + 1, 9]}
            for i, x in enumerate((10.0, 20.0, 30.0))
        ]
        edges = [{"x0": 4, "x1": 36, "top": 5}, {"x0": 4, "x1": 36, "top": 10}]
        vertical_edges = [{"x0": 4, "x1": 4, "top": 5, "bottom": 10}, {"x0": 36, "x1": 36, "top": 5, "bottom": 10}]

        layout = derive_header_layout(
            page_words=words,
            source_header_records=headers,
            horizontal_edges=edges,
            vertical_edges=vertical_edges,
            paddle_per_pdf_point_scale=[2.0, 4.0],
        )

        self.assertEqual(layout["status"], "RESOLVED")
        self.assertEqual(layout["headerCentersPdfPoints"], [10.0, 20.0, 30.0])

    def test_builds_new_row_from_same_baseline_label_and_bounded_value_slots(self) -> None:
        result = reconstruct_baselines(
            [
                word(0, "Source label", 3.0),
                word(1, "10.0", 10.0),
                word(2, "20.0", 20.0),
                word(3, "30.0", 30.0),
            ],
            [10.0, 20.0, 30.0],
        )

        accepted = [group for group in result["groups"] if group["status"] == "SOURCE_ROW_CANDIDATE"]
        self.assertEqual(len(accepted), 1)
        self.assertEqual(accepted[0]["labelText"], "Source label")
        self.assertEqual([cell["text"] for cell in accepted[0]["cells"]], ["10.0", "20.0", "30.0"])
        self.assertEqual([cell["slot"] for cell in accepted[0]["cells"]], [0, 1, 2])

    def test_exact_midpoint_tie_is_held(self) -> None:
        result = reconstruct_baselines(
            [word(0, "Source label", 3.0), word(1, "10", 10.0), word(2, "20", 15.0), word(3, "30", 30.0)],
            [10.0, 20.0, 30.0],
        )

        self.assertFalse(any(group["status"] == "SOURCE_ROW_CANDIDATE" for group in result["groups"]))
        self.assertIn("COLUMN_MIDPOINT_TIE", {reason for group in result["groups"] for reason in group["holdReasons"]})

    def test_duplicate_and_missing_slots_are_held(self) -> None:
        result = reconstruct_baselines(
            [
                word(0, "Source label", 3.0),
                word(1, "10", 10.0),
                word(2, "11", 10.5),
                word(3, "20", 20.0),
            ],
            [10.0, 20.0, 30.0],
        )

        self.assertFalse(any(group["status"] == "SOURCE_ROW_CANDIDATE" for group in result["groups"]))
        self.assertIn("DUPLICATE_VALUE_SLOT", {group["reason"] for group in result["groups"]})

    def test_label_on_adjacent_baseline_does_not_complete_data_line(self) -> None:
        result = reconstruct_baselines(
            [
                word(0, "Source label", 3.0, top=0.0),
                word(1, "10", 10.0, top=10.0),
                word(2, "20", 20.0, top=10.0),
                word(3, "30", 30.0, top=10.0),
            ],
            [10.0, 20.0, 30.0],
        )

        self.assertFalse(any(group["status"] == "SOURCE_ROW_CANDIDATE" for group in result["groups"]))
        self.assertIn("ROW_LABEL_MISSING", {group["reason"] for group in result["groups"]})

    def test_non_numeric_value_slot_text_is_held(self) -> None:
        result = reconstruct_baselines(
            [word(0, "Source label", 3.0), word(1, "10", 10.0), word(2, "n.a.", 20.0), word(3, "30", 30.0)],
            [10.0, 20.0, 30.0],
        )

        self.assertFalse(any(group["status"] == "SOURCE_ROW_CANDIDATE" for group in result["groups"]))
        self.assertIn("NONNUMERIC_VALUE_SLOT", {reason for group in result["groups"] for reason in group["holdReasons"]})

    def test_balanced_parenthetical_numeric_cells_are_preserved_but_malformed_tokens_hold(self) -> None:
        result = reconstruct_baselines(
            [word(0, "Change", 3.0), word(1, "(0.3)", 10.0), word(2, "(1.2)", 20.0), word(3, "(2.0)", 30.0)],
            [10.0, 20.0, 30.0],
        )
        malformed = reconstruct_baselines(
            [word(0, "Change", 3.0), word(1, "(0.3", 10.0), word(2, "(1.2)", 20.0), word(3, "(2.0)", 30.0)],
            [10.0, 20.0, 30.0],
        )

        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual([cell["text"] for cell in result["rows"][0]["cells"]], ["(0.3)", "(1.2)", "(2.0)"])
        self.assertFalse(malformed["rows"])
        self.assertIn("NONNUMERIC_VALUE_SLOT", {reason for group in malformed["groups"] for reason in group["holdReasons"]})

    def test_repeated_labels_at_distinct_baselines_remain_distinct_rows(self) -> None:
        result = reconstruct_baselines(
            [
                word(0, "Repeated label", 3.0, top=10.0),
                word(1, "10", 10.0, top=10.0),
                word(2, "20", 20.0, top=10.0),
                word(3, "30", 30.0, top=10.0),
                word(4, "Repeated label", 3.0, top=22.0),
                word(5, "40", 10.0, top=22.0),
                word(6, "50", 20.0, top=22.0),
                word(7, "60", 30.0, top=22.0),
            ],
            [10.0, 20.0, 30.0],
        )

        accepted = [group for group in result["groups"] if group["status"] == "SOURCE_ROW_CANDIDATE"]
        self.assertEqual(len(accepted), 2)
        self.assertNotEqual(accepted[0]["rowKey"], accepted[1]["rowKey"])

    def test_seven_slot_row_with_wide_stub_uses_source_outer_bounds(self) -> None:
        centers = [30.0, 42.0, 54.0, 66.0, 78.0, 90.0, 102.0]
        result = reconstruct_baselines(
            [word(0, "Wide row label", 5.0), *[
                word(index + 1, str(index + 1), center, width=3.0)
                for index, center in enumerate(centers)
            ]],
            centers,
            outer_bounds=[18.0, 108.0],
        )

        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual([cell["slot"] for cell in result["rows"][0]["cells"]], list(range(7)))
        self.assertEqual(result["slotBoundariesPdfPoints"][0], 18.0)
        self.assertEqual(result["slotBoundariesPdfPoints"][-1], 108.0)

    def test_seven_slot_row_with_missing_cell_is_held(self) -> None:
        centers = [30.0, 42.0, 54.0, 66.0, 78.0, 90.0, 102.0]
        result = reconstruct_baselines(
            [word(0, "Wide row label", 5.0), *[
                word(index + 1, str(index + 1), center, width=3.0)
                for index, center in enumerate(centers)
                if index != 3
            ]],
            centers,
            outer_bounds=[18.0, 108.0],
        )

        self.assertFalse(result["rows"])
        self.assertTrue(any("INCOMPLETE_VALUE_ROW" in group["holdReasons"] for group in result["groups"]))

    def test_unclassified_trailing_footnote_is_not_silently_dropped(self) -> None:
        result = reconstruct_baselines(
            [
                word(0, "Source label", 3.0),
                word(1, "10", 10.0),
                word(2, "20", 20.0),
                word(3, "30", 30.0),
                word(4, "footnote", 37.0),
            ],
            [10.0, 20.0, 30.0],
            outer_bounds=[4.0, 36.0],
        )

        self.assertFalse(result["rows"])
        held = next(group for group in result["groups"] if group["reason"] != "NO_VALUE_TOKENS")
        self.assertIn("TRAILING_WORD_OUTSIDE_GRID", held["holdReasons"])
        self.assertEqual(held["extraWords"][0]["text"], "footnote")

    def test_raw_ocr_value_needs_unique_exact_text_and_box_overlap(self) -> None:
        source = word(0, "๑,๒๓๖", 10.0, width=4.0)
        exact = bind_raw_ocr_value(
            source,
            raw_texts=["1,236", "999"],
            raw_boxes=[[18.0, 20.0, 22.0, 36.0], [40.0, 20.0, 44.0, 36.0]],
            paddle_per_pdf_point_scale=[2.0, 2.0],
            slot_bounds_pdf_points=[4.0, 16.0],
        )
        self.assertEqual(exact["status"], "CORROBORATED")
        self.assertEqual(exact["match"]["recordIndex"], 0)

        duplicate = bind_raw_ocr_value(
            source,
            raw_texts=["1,236", "1,236"],
            raw_boxes=[[18.0, 20.0, 22.0, 36.0], [18.5, 20.0, 22.5, 36.0]],
            paddle_per_pdf_point_scale=[2.0, 2.0],
            slot_bounds_pdf_points=[4.0, 16.0],
        )
        outside_slot = bind_raw_ocr_value(
            source,
            raw_texts=["1,236"],
            raw_boxes=[[18.0, 20.0, 22.0, 36.0]],
            paddle_per_pdf_point_scale=[2.0, 2.0],
            slot_bounds_pdf_points=[11.0, 16.0],
        )
        self.assertEqual(duplicate["reason"], "PADDLE_VALUE_BOX_NOT_UNIQUE")
        self.assertEqual(outside_slot["reason"], "PADDLE_VALUE_BOX_NOT_UNIQUE")


if __name__ == "__main__":
    unittest.main()
