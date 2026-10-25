import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from derive_pdf_cell_values import resolve_cell_numeric_word
from held_cell_repair import numeric_word_key


def cell(text="bad", source_row=3, grid_column=2):
    return {
        "recordId": "source-cell-fixture",
        "recordType": "TABLE_VALUE_CELL",
        "status": "SOURCE_CELL_STRUCTURALLY_RESOLVED",
        "headerStatus": "RESOLVED",
        "text": text,
        "sourceRow": source_row,
        "gridColumn": grid_column,
        "ocrBox": [10, 10, 30, 30],
    }


def geometry(words, row_start=3, row_end=3, column_start=2, column_end=2):
    return {
        "topologyCheck": {"status": "USABLE"},
        "vectorCells": [{
            "id": "vector-cell", "box": [0, 0, 40, 40],
            "rowStart": row_start, "rowEnd": row_end,
            "vectorColumnStart": column_start, "vectorColumnEnd": column_end,
        }],
        "numericTextLayerWords": words,
    }


def word(text, box, index=1):
    return {
        "wordIndex": index,
        "text": text,
        "comparisonCanonical": numeric_word_key(text),
        "pdfBox": [box[0] / 2, box[1] / 2, box[2] / 2, box[3] / 2],
        "box": box,
    }


class PdfCellValueCorrectionTests(unittest.TestCase):
    def test_unique_numeric_pdf_word_creates_distinct_source_correction(self):
        result = resolve_cell_numeric_word(
            cell=cell("bm๙'"),
            table_geometry=geometry([word("639", [12, 12, 28, 28])]),
        )
        self.assertEqual(result["status"], "SOURCE_TEXT_LAYER_CORRECTION")
        self.assertEqual(result["rawOcrText"], "bm๙'")
        self.assertEqual(result["derivedPdfText"], "639")
        self.assertEqual(result["origin"], "ORIGINAL_PDF_TEXT_LAYER_NUMERIC_WORD")
        self.assertTrue(result["replacementRequired"])

    def test_unicode_decimal_equivalence_does_not_rewrite_raw_ocr(self):
        raw = "๑,๒๓๖,๔๗๑"
        result = resolve_cell_numeric_word(
            cell=cell(raw),
            table_geometry=geometry([word("1,236,471", [12, 12, 28, 28])]),
        )
        self.assertEqual(numeric_word_key(raw), "1,236,471")
        self.assertEqual(result["status"], "SOURCE_TEXT_LAYER_AGREES")
        self.assertEqual(result["rawOcrText"], raw)
        self.assertFalse(result["replacementRequired"])

    def test_word_outside_ocr_cell_box_is_held(self):
        result = resolve_cell_numeric_word(
            cell=cell("wrong"),
            table_geometry=geometry([word("639", [31, 12, 39, 28])]),
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "PDF_NUMERIC_WORD_NOT_UNIQUE")

    def test_vector_cell_must_match_exact_source_row(self):
        result = resolve_cell_numeric_word(
            cell=cell("wrong", source_row=4),
            table_geometry=geometry([word("639", [12, 12, 28, 28])], row_start=3, row_end=3),
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "PDF_VECTOR_CELL_SOURCE_ROW_MISMATCH")

    def test_vector_cell_must_match_exact_source_column(self):
        result = resolve_cell_numeric_word(
            cell=cell("wrong", grid_column=2),
            table_geometry=geometry(
                [word("639", [12, 12, 28, 28])],
                column_start=3,
                column_end=3,
            ),
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "PDF_VECTOR_CELL_SOURCE_COLUMN_MISMATCH")

    def test_multiple_numeric_words_inside_same_cell_are_held(self):
        result = resolve_cell_numeric_word(
            cell=cell("wrong"),
            table_geometry=geometry([
                word("63", [11, 12, 19, 28], 1),
                word("9", [20, 12, 29, 28], 2),
            ]),
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "PDF_NUMERIC_WORD_NOT_UNIQUE")
        self.assertEqual(result["numericWordCandidateCount"], 2)

    def test_duplicate_identical_pdf_word_box_is_held(self):
        duplicate = word("639", [12, 12, 28, 28], 2)
        result = resolve_cell_numeric_word(
            cell=cell("wrong"),
            table_geometry=geometry([word("639", [12, 12, 28, 28], 1), duplicate]),
        )
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "PDF_NUMERIC_WORD_NOT_UNIQUE")
        self.assertEqual(result["numericWordCandidateCount"], 2)

    def test_non_numeric_or_invalid_source_word_is_not_used(self):
        malformed = word("6O9", [12, 12, 28, 28])
        self.assertIsNone(numeric_word_key(malformed["text"]))
        result = resolve_cell_numeric_word(cell=cell("wrong"), table_geometry=geometry([malformed]))
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["numericWordCandidateCount"], 0)

    def test_malformed_numeric_punctuation_is_not_a_source_word(self):
        malformed_values = (
            "--1", "1..2", "1,,2", "1-2", "12,34", "+-2",
            "++2", "1,234,56", "1,23,456", "1,234.5.6", ".5", "1.",
            "1,+2", "+1-2", "1,234,+5", "1,234,567.8,9", "1 234",
        )
        for malformed in malformed_values:
            with self.subTest(malformed=malformed):
                self.assertIsNone(numeric_word_key(malformed))
        self.assertEqual(numeric_word_key("-1,234.50"), "-1,234.50")
        self.assertEqual(numeric_word_key("＋１，２３４．５０"), "+1,234.50")
        self.assertEqual(numeric_word_key("๑,๒๓๖,๔๗๑"), "1,236,471")

    def test_control_and_private_use_characters_are_not_numeric_words(self):
        invalid_values = ("12\x00", "1\uE0002", "\uE001639")
        for invalid in invalid_values:
            with self.subTest(invalid=repr(invalid)):
                self.assertIsNone(numeric_word_key(invalid))
                result = resolve_cell_numeric_word(
                    cell=cell("wrong"),
                    table_geometry=geometry([word(invalid, [12, 12, 28, 28])]),
                )
                self.assertEqual(result["status"], "HELD")
                self.assertEqual(result["numericWordCandidateCount"], 0)

    def test_overlapping_vector_cells_make_source_cell_ambiguous(self):
        g = geometry([word("639", [12, 12, 28, 28])])
        g["vectorCells"].append({"id": "overlap", "box": [20, 0, 50, 40], "rowStart": 3, "rowEnd": 3})
        result = resolve_cell_numeric_word(cell=cell("wrong"), table_geometry=g)
        self.assertEqual(result["status"], "HELD")
        self.assertEqual(result["reason"], "PDF_VECTOR_DATA_CELL_NOT_UNIQUE")


if __name__ == "__main__":
    unittest.main()
