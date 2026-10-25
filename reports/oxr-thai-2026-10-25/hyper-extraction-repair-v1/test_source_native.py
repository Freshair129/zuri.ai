import unittest

from source_native import (
    header_path_for_column,
    infer_label_column,
    match_row_to_ocr_cells,
    resolve_header_geometry,
)


class SourceNativeTests(unittest.TestCase):
    def test_label_column_is_inferred_from_table_shape_not_a_domain_name_list(self):
        rows = [
            [
                {"col": 0, "text": "๒"},
                {"col": 1, "text": "จังหวัดก"},
                {"col": 2, "text": "101"},
            ],
            [
                {"col": 0, "text": "3"},
                {"col": 1, "text": "จังหวัดข"},
                {"col": 2, "text": "202"},
            ],
            [
                {"col": 0, "text": "๔"},
                {"col": 1, "text": "จังหวัดค"},
                {"col": 2, "text": "303"},
            ],
        ]
        result = infer_label_column(rows)
        self.assertEqual(result["status"], "RESOLVED")
        self.assertEqual(result["column"], 1)

    def test_duplicate_values_bind_only_when_the_entire_row_sequence_matches(self):
        cells = [
            {"row": 1, "cell": 0, "col": 0, "text": "Series A"},
            {"row": 1, "cell": 1, "col": 1, "text": "2.25"},
            {"row": 1, "cell": 2, "col": 2, "text": "2.25"},
            {"row": 1, "cell": 3, "col": 3, "text": "4.0"},
        ]
        result = match_row_to_ocr_cells(
            cells=cells,
            rec_texts=["Series A", "2.25", "2.25", "4.0"],
            rec_boxes=[
                [10, 40, 70, 54],
                [100, 42, 130, 52],
                [200, 42, 230, 52],
                [300, 42, 330, 52],
            ],
            page_width=400,
            page_height=100,
            table_bounds=[0, 0, 400, 100],
            label_column=0,
        )
        self.assertEqual(result["status"], "ROW_SEQUENCE_RESOLVED")
        self.assertEqual([x["recordIndex"] for x in result["cellBindings"]], [0, 1, 2, 3])

    def test_duplicate_values_hold_when_any_source_cell_is_missing_or_misordered(self):
        cells = [
            {"row": 1, "cell": 0, "col": 0, "text": "Series A"},
            {"row": 1, "cell": 1, "col": 1, "text": "2.25"},
            {"row": 1, "cell": 2, "col": 2, "text": "2.25"},
        ]
        result = match_row_to_ocr_cells(
            cells=cells,
            rec_texts=["Series A", "2.25", "2.26"],
            rec_boxes=[[10, 40, 70, 54], [100, 42, 130, 52], [200, 42, 230, 52]],
            page_width=400,
            page_height=100,
            table_bounds=[0, 0, 400, 100],
            label_column=0,
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "ROW_SEQUENCE_TEXT_MISMATCH")

    def test_leaf_header_uses_unique_physical_alignment_when_html_column_is_shifted(self):
        result = resolve_header_geometry(
            header_cells=[{"row": 0, "cell": 0, "col": 0, "colEnd": 0, "text": "Month X"}],
            header_records=[{"index": 0, "text": "Month X", "box": [98, 10, 132, 22]}],
            column_boxes={1: [95, 135], 2: [195, 235]},
        )
        self.assertEqual(result["bindings"][0]["status"], "RESOLVED")
        self.assertEqual(result["bindings"][0]["physicalColumns"], [1])
        self.assertEqual(result["bindings"][0]["gridColumns"], [0])

    def test_merged_header_is_held_when_text_geometry_conflicts_with_declared_span(self):
        result = resolve_header_geometry(
            header_cells=[{"row": 1, "cell": 0, "col": 1, "colEnd": 2, "text": "Group X"}],
            header_records=[{"index": 0, "text": "Group X", "box": [295, 10, 330, 22]}],
            column_boxes={1: [95, 135], 2: [195, 235], 3: [295, 335]},
        )
        self.assertEqual(result["bindings"][0]["status"], "HELD")
        self.assertEqual(result["bindings"][0]["reason"], "HEADER_GEOMETRY_CONFLICT")

    def test_singleton_unmerged_header_in_multicolumn_table_stays_table_context(self):
        result = resolve_header_geometry(
            header_cells=[
                {"row": 2, "cell": 0, "col": 1, "colEnd": 1, "text": "2567"},
                {"row": 4, "cell": 0, "col": 0, "colEnd": 0, "text": "Month A"},
                {"row": 4, "cell": 1, "col": 1, "colEnd": 1, "text": "Month B"},
                {"row": 4, "cell": 2, "col": 2, "colEnd": 2, "text": "Month C"},
            ],
            header_records=[
                {"index": 0, "text": "2567", "box": [46, 10, 74, 22]},
                {"index": 1, "text": "Month A", "box": [4, 35, 36, 47]},
                {"index": 2, "text": "Month B", "box": [44, 35, 76, 47]},
                {"index": 3, "text": "Month C", "box": [84, 35, 116, 47]},
            ],
            column_boxes={
                0: [0, 40], 1: [40, 80], 2: [80, 120],
            },
        )
        binding = next(item for item in result["bindings"] if item["text"] == "2567")
        self.assertEqual(binding["status"], "CONTEXT_ONLY")
        self.assertEqual(binding["reason"], "SINGLETON_HEADER_WITHOUT_DECLARED_SPAN")
        self.assertEqual(binding["text"], "2567")
        self.assertNotIn("2567", [h["text"] for h in header_path_for_column(1, result["bindings"])["headers"]])
        self.assertIn("Month B", [h["text"] for h in header_path_for_column(1, result["bindings"])["headers"]])

    def test_singleton_header_can_bind_when_it_covers_a_single_column_table(self):
        result = resolve_header_geometry(
            header_cells=[{"row": 0, "cell": 0, "col": 0, "colEnd": 0, "text": "Count"}],
            header_records=[{"index": 0, "text": "Count", "box": [10, 10, 40, 22]}],
            column_boxes={0: [0, 60]},
        )
        self.assertEqual(result["bindings"][0]["status"], "RESOLVED")

    def test_leaf_header_is_held_when_its_geometry_overlaps_multiple_sibling_columns(self):
        result = resolve_header_geometry(
            header_cells=[{"row": 1, "cell": 0, "col": 1, "colEnd": 1, "text": "Leaf X"}],
            header_records=[{"index": 0, "text": "Leaf X", "box": [105, 10, 225, 22]}],
            column_boxes={1: [95, 135], 2: [195, 235], 3: [295, 335]},
        )
        self.assertEqual(result["bindings"][0]["status"], "HELD")
        self.assertEqual(result["bindings"][0]["reason"], "HEADER_GEOMETRY_AMBIGUOUS")

    def test_only_physically_swapped_header_siblings_are_held(self):
        result = resolve_header_geometry(
            header_cells=[
                {"row": 1, "cell": 0, "col": 2, "colEnd": 2, "text": "A"},
                {"row": 1, "cell": 1, "col": 3, "colEnd": 3, "text": "B"},
                {"row": 1, "cell": 2, "col": 4, "colEnd": 4, "text": "C"},
            ],
            header_records=[
                {"index": 0, "text": "A", "box": [95, 10, 115, 22]},
                {"index": 1, "text": "B", "box": [295, 10, 315, 22]},
                {"index": 2, "text": "C", "box": [195, 10, 215, 22]},
            ],
            column_boxes={2: [90, 120], 3: [190, 220], 4: [290, 320]},
        )
        by_cell = {item["cell"]: item for item in result["bindings"]}
        self.assertEqual(by_cell[0]["status"], "RESOLVED")
        self.assertEqual(by_cell[1]["reason"], "HEADER_SOURCE_ORDER_PHYSICAL_ORDER_CONFLICT")
        self.assertEqual(by_cell[2]["reason"], "HEADER_SOURCE_ORDER_PHYSICAL_ORDER_CONFLICT")

    def test_distant_table_context_is_not_promoted_into_a_cell_header_path(self):
        result = header_path_for_column(1, [
            {"row": 0, "cell": 1, "text": "Prepared by", "status": "RESOLVED", "physicalColumns": [1, 2, 3]},
            {"row": 2, "cell": 0, "text": "Year", "status": "RESOLVED", "physicalColumns": [1]},
            {"row": 4, "cell": 0, "text": "Month X", "status": "RESOLVED", "physicalColumns": [1]},
        ])
        self.assertEqual(result["status"], "RESOLVED")
        self.assertEqual([h["row"] for h in result["headers"]], [2, 4])
        self.assertEqual(result["excludedDistantContextHeaderCount"], 1)


if __name__ == "__main__":
    unittest.main()
