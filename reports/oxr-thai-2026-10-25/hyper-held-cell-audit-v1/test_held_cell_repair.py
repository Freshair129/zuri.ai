import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

try:
    from held_cell_repair import resolve_header_slots
except ModuleNotFoundError:
    resolve_header_slots = None


class PdfVectorHeaderBindingTests(unittest.TestCase):
    def test_exact_text_boxes_bind_to_independent_pdf_cells_with_different_raw_spans(self):
        # The PDF cell rectangles are independent vector-boundary evidence.
        # The source HTML's last two labels/spans are deliberately transposed.
        cells = [
            {"row": 1, "cell": 0, "col": 2, "colEnd": 4, "rowEnd": 1, "text": "Group A"},
            {"row": 1, "cell": 1, "col": 5, "colEnd": 7, "rowEnd": 1, "text": "Group C"},
            {"row": 1, "cell": 2, "col": 8, "colEnd": 8, "rowEnd": 2, "text": "Group B"},
        ]
        records = [
            {"index": 10, "text": "Group A", "box": [4, 10, 26, 20]},
            {"index": 11, "text": "Group C", "box": [40, 10, 58, 20]},
            {"index": 12, "text": "Group B", "box": [62, 10, 68, 20]},
        ]
        pdf_cells = [
            {"id": "pdfcell-1", "box": [0, 0, 30, 30], "rowStart": 1, "rowEnd": 1},
            {"id": "pdfcell-2", "box": [30, 0, 60, 30], "rowStart": 1, "rowEnd": 1},
            {"id": "pdfcell-3", "box": [60, 0, 70, 50], "rowStart": 1, "rowEnd": 2},
        ]
        columns = {0: [0, 10], 1: [10, 20], 2: [20, 30], 3: [30, 40], 4: [40, 50], 5: [50, 60], 6: [60, 70]}

        self.assertIsNotNone(resolve_header_slots)
        result = resolve_header_slots(header_cells=cells, header_records=records, pdf_cells=pdf_cells, column_boxes=columns)

        self.assertEqual(result["status"], "RESOLVED")
        by_text = {item["text"]: item for item in result["bindings"]}
        self.assertEqual(by_text["Group A"]["physicalColumns"], [0, 1, 2])
        self.assertEqual(by_text["Group C"]["physicalColumns"], [3, 4, 5])
        self.assertEqual(by_text["Group B"]["physicalColumns"], [6])
        self.assertEqual(by_text["Group C"]["pdfVectorRowSpan"], 1)
        self.assertEqual(by_text["Group B"]["pdfVectorRowSpan"], 2)
        self.assertEqual(by_text["Group C"]["gridColumns"], [5, 6, 7])

    def test_box_on_pdf_cell_boundary_is_held(self):
        result = resolve_header_slots(
            header_cells=[{"row": 0, "cell": 0, "col": 0, "colEnd": 0, "text": "A"}],
            header_records=[{"index": 0, "text": "A", "box": [15, 10, 25, 20]}],
            pdf_cells=[
                {"id": "left", "box": [0, 0, 20, 30], "rowStart": 0, "rowEnd": 0},
                {"id": "right", "box": [20, 0, 40, 30], "rowStart": 0, "rowEnd": 0},
            ],
            column_boxes={0: [0, 40]},
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "PDF_VECTOR_CELL_ASSIGNMENT_NOT_UNIQUE")

    def test_duplicate_source_header_text_is_not_used_to_pair_records(self):
        result = resolve_header_slots(
            header_cells=[
                {"row": 0, "cell": 0, "col": 0, "colEnd": 0, "text": "Repeated"},
                {"row": 0, "cell": 1, "col": 1, "colEnd": 1, "text": "Repeated"},
            ],
            header_records=[
                {"index": 0, "text": "Repeated", "box": [1, 10, 10, 20]},
                {"index": 1, "text": "Repeated", "box": [30, 10, 39, 20]},
            ],
            pdf_cells=[
                {"id": "a", "box": [0, 0, 20, 30], "rowStart": 0, "rowEnd": 0},
                {"id": "b", "box": [20, 0, 40, 30], "rowStart": 0, "rowEnd": 0},
            ],
            column_boxes={0: [0, 20], 1: [20, 40]},
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "DUPLICATE_HEADER_TEXT_IDENTITY_AMBIGUOUS")

    def test_missing_exact_header_record_holds_the_row(self):
        result = resolve_header_slots(
            header_cells=[
                {"row": 0, "cell": 0, "col": 0, "colEnd": 0, "text": "A"},
                {"row": 0, "cell": 1, "col": 1, "colEnd": 1, "text": "B"},
            ],
            header_records=[{"index": 0, "text": "A", "box": [1, 10, 10, 20]}],
            pdf_cells=[{"id": "a", "box": [0, 0, 20, 30], "rowStart": 0, "rowEnd": 0}],
            column_boxes={0: [0, 20], 1: [20, 40]},
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "HEADER_CELL_RECORD_COUNT_MISMATCH")

    def test_overlapping_pdf_cell_rectangles_are_held(self):
        result = resolve_header_slots(
            header_cells=[{"row": 0, "cell": 0, "col": 0, "colEnd": 0, "text": "A"}],
            header_records=[{"index": 0, "text": "A", "box": [10, 10, 20, 20]}],
            pdf_cells=[
                {"id": "a", "box": [0, 0, 25, 30], "rowStart": 0, "rowEnd": 0},
                {"id": "b", "box": [15, 0, 40, 30], "rowStart": 0, "rowEnd": 0},
            ],
            column_boxes={0: [0, 40]},
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "PDF_VECTOR_CELLS_OVERLAP")

    def test_column_center_claimed_by_two_adjacent_vector_cells_is_held(self):
        result = resolve_header_slots(
            header_cells=[
                {"row": 0, "cell": 0, "col": 0, "colEnd": 0, "text": "A"},
                {"row": 0, "cell": 1, "col": 1, "colEnd": 1, "text": "B"},
            ],
            header_records=[
                {"index": 0, "text": "A", "box": [2, 10, 8, 20]},
                {"index": 1, "text": "B", "box": [32, 10, 38, 20]},
            ],
            pdf_cells=[
                {"id": "left", "box": [0, 0, 20, 30], "rowStart": 0, "rowEnd": 0},
                {"id": "right", "box": [20, 0, 40, 30], "rowStart": 0, "rowEnd": 0},
            ],
            column_boxes={0: [10, 30]},
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "PDF_VECTOR_COLUMN_ASSIGNMENT_NOT_UNIQUE")


if __name__ == "__main__":
    unittest.main()
