import unittest

from geometry_binding import exact_source_span_in_chunk, resolve_geometry_binding


def fixture(**overrides):
    data = {
        "subject": "Series A",
        "value": "92.9",
        "header_quote": "Dec",
        "table_cells": [
            {"row": 4, "cell": 6, "col": 6, "text": "Dec"},
            {"row": 6, "cell": 0, "col": 0, "text": "Series A"},
            {"row": 6, "cell": 7, "col": 7, "text": "92.9"},
            {"row": 6, "cell": 1, "col": 1, "text": "91.0"},
        ],
        "header_row_count": 6,
        "rec_texts": ["Series A", "92.9", "91.0", "Dec"],
        "rec_boxes": [
            [10, 40, 70, 52],
            [98, 40, 132, 52],
            [198, 40, 230, 52],
            [99, 10, 131, 22],
        ],
        "page_width": 300,
        "page_height": 100,
        "emitting_chunk_text": "Series A 92.9 Dec",
    }
    data.update(overrides)
    return data


def resolve(**overrides):
    d = fixture(**overrides)
    return resolve_geometry_binding(
        subject=d["subject"],
        value=d["value"],
        header_quote=d["header_quote"],
        table_cells=d["table_cells"],
        header_row_count=d["header_row_count"],
        rec_texts=d["rec_texts"],
        rec_boxes=d["rec_boxes"],
        page_width=d["page_width"],
        page_height=d["page_height"],
        emitting_chunk_text=d["emitting_chunk_text"],
    )


class GeometryBindingTests(unittest.TestCase):
    def test_source_span_must_be_the_same_absolute_occurrence_in_chunk(self):
        self.assertTrue(exact_source_span_in_chunk(
            source_start=104, source_end=107, expected_text="Dec",
            chunk_start=100, chunk_text="Dec Dec", source_range_start=100,
            source_range_text="Dec Dec",
        ))
        self.assertFalse(exact_source_span_in_chunk(
            source_start=204, source_end=207, expected_text="Dec",
            chunk_start=100, chunk_text="Dec Dec", source_range_start=200,
            source_range_text="xxxDec",
        ))
        self.assertFalse(exact_source_span_in_chunk(
            source_start=108, source_end=111, expected_text="Dec",
            chunk_start=100, chunk_text="Dec Dec", source_range_start=100,
            source_range_text="Dec Dec xxxDec",
        ))

    def test_uses_exact_physical_alignment_when_html_grid_is_shifted(self):
        result = resolve()
        self.assertEqual(result["status"], "LEXICALLY_GROUNDED_FACT_CANDIDATE")
        self.assertEqual(result["semanticStatus"], "NOT_ASSESSED")
        self.assertEqual(result["headerGridColumnDiff"], -1)

    def test_rejects_header_that_is_only_adjacent_to_value(self):
        d = fixture(rec_boxes=[
            [10, 40, 70, 52], [98, 40, 132, 52], [198, 40, 230, 52], [160, 10, 192, 22],
        ])
        result = resolve(**d)
        self.assertEqual(result["reason"], "NO_UNIQUE_PHYSICAL_HEADER_VALUE_ALIGNMENT")

    def test_rejects_wide_header_overlapping_multiple_row_cells(self):
        d = fixture(rec_boxes=[
            [10, 40, 70, 52], [98, 40, 132, 52], [198, 40, 230, 52], [90, 10, 235, 22],
        ])
        result = resolve(**d)
        self.assertEqual(result["reason"], "NO_UNIQUE_PHYSICAL_HEADER_VALUE_ALIGNMENT")

    def test_rejects_duplicate_source_value_cell(self):
        cells = fixture()["table_cells"] + [{"row": 6, "cell": 8, "col": 8, "text": "92.9"}]
        self.assertEqual(resolve(table_cells=cells)["reason"], "DUPLICATE_VALUE_ROW_SEQUENCE_NOT_ONE_TO_ONE")

    def test_resolves_duplicate_value_only_after_exact_full_row_sequence_and_unique_header(self):
        cells = [
            {"row": 4, "cell": 6, "col": 6, "text": "Dec"},
            {"row": 6, "cell": 0, "col": 0, "text": "Series A"},
            {"row": 6, "cell": 1, "col": 1, "text": "2.25"},
            {"row": 6, "cell": 2, "col": 2, "text": "2.25"},
            {"row": 6, "cell": 3, "col": 3, "text": "2.25"},
            {"row": 6, "cell": 4, "col": 4, "text": "2.0"},
        ]
        result = resolve(
            value="2.25",
            table_cells=cells,
            rec_texts=["Series A", "2.25", "2.25", "2.25", "2.0", "Dec"],
            rec_boxes=[
                [10, 40, 70, 52], [98, 40, 120, 52], [198, 40, 220, 52],
                [298, 40, 320, 52], [398, 40, 420, 52], [298, 10, 320, 22],
            ],
            page_width=500,
            emitting_chunk_text="Series A 2.25 Dec",
        )
        self.assertEqual(result["status"], "LEXICALLY_GROUNDED_FACT_CANDIDATE")
        self.assertEqual(result["valueCell"], 3)

    def test_rejects_duplicate_values_when_header_overlaps_multiple_value_boxes(self):
        cells = [
            {"row": 4, "cell": 6, "col": 6, "text": "Dec"},
            {"row": 6, "cell": 0, "col": 0, "text": "Series A"},
            {"row": 6, "cell": 1, "col": 1, "text": "2.25"},
            {"row": 6, "cell": 2, "col": 2, "text": "2.25"},
            {"row": 6, "cell": 3, "col": 3, "text": "2.25"},
            {"row": 6, "cell": 4, "col": 4, "text": "2.0"},
        ]
        result = resolve(
            value="2.25",
            table_cells=cells,
            rec_texts=["Series A", "2.25", "2.25", "2.25", "2.0", "Dec"],
            rec_boxes=[
                [10, 40, 70, 52], [98, 40, 120, 52], [198, 40, 220, 52],
                [298, 40, 320, 52], [398, 40, 420, 52], [90, 10, 325, 22],
            ],
            page_width=500,
            emitting_chunk_text="Series A 2.25 Dec",
        )
        self.assertEqual(result["reason"], "NO_UNIQUE_PHYSICAL_HEADER_VALUE_ALIGNMENT")

    def test_rejects_duplicate_values_when_full_row_sequence_differs(self):
        cells = [
            {"row": 4, "cell": 6, "col": 6, "text": "Dec"},
            {"row": 6, "cell": 0, "col": 0, "text": "Series A"},
            {"row": 6, "cell": 1, "col": 1, "text": "2.25"},
            {"row": 6, "cell": 2, "col": 2, "text": "2.25"},
        ]
        result = resolve(
            value="2.25",
            table_cells=cells,
            rec_texts=["Series A", "2.25", "2.26", "Dec"],
            rec_boxes=[[10, 40, 70, 52], [98, 40, 120, 52], [198, 40, 220, 52], [98, 10, 120, 22]],
            page_width=300,
            emitting_chunk_text="Series A 2.25 Dec",
        )
        self.assertEqual(result["reason"], "DUPLICATE_VALUE_ROW_SEQUENCE_TEXT_MISMATCH")

    def test_rejects_duplicate_header_cell(self):
        cells = fixture()["table_cells"] + [{"row": 5, "cell": 2, "col": 2, "text": "Dec"}]
        self.assertEqual(resolve(table_cells=cells)["reason"], "HEADER_CELL_NOT_UNIQUE")

    def test_rejects_missing_or_clipped_subject_box(self):
        d = fixture(rec_boxes=[[-2, 40, 70, 52], [98, 40, 132, 52], [198, 40, 230, 52], [99, 10, 131, 22]])
        self.assertEqual(resolve(**d)["reason"], "SUBJECT_HAS_NO_VALID_OCR_BOX")

    def test_rejects_atom_outside_emitting_chunk(self):
        self.assertEqual(resolve(emitting_chunk_text="Series A 92.9")["reason"], "ATOM_NOT_PRESENT_IN_EMITTING_CHUNK")


if __name__ == "__main__":
    unittest.main()
