import hashlib
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from build_held_cell_projection import build_native_input, build_repair_overlay


PDF_SHA = "a" * 64


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def span(range_id, zone_id, absolute_start, quote, zone_start):
    return {
        "rangeId": range_id,
        "zoneId": zone_id,
        "start": absolute_start + zone_start,
        "end": absolute_start + zone_start + len(quote),
        "zoneStart": zone_start,
        "zoneEnd": zone_start + len(quote),
        "quote": quote,
    }


def fixture():
    row_text = "Town\t12\t34"
    header_text = "Region\tM\tN"
    row_zone = {
        "id": "d:t row 1", "rangeId": "d", "sourceStart": 100,
        "sourceEnd": 100 + len(row_text), "text": row_text,
    }
    header_zone = {
        "id": "d:t header 1", "rangeId": "d", "sourceStart": 10,
        "sourceEnd": 10 + len(header_text), "text": header_text,
    }
    header_path = lambda label, column: [{
        "status": "RESOLVED", "text": label,
        "physicalColumns": [column], "pdfVectorCellId": f"h{column}",
        "pdfVectorCellBounds": [column * 20, 0, column * 20 + 20, 20],
        "pdfVectorRowStart": 0, "pdfVectorRowEnd": 0,
        "sourceSpan": span("d", header_zone["id"], 10, label, header_text.index(label)),
    }]
    row_span = {
        "rangeId": "d", "zoneId": row_zone["id"], "start": 100,
        "end": 100 + len(row_text), "zoneTextSha256": sha(row_text),
    }
    cells = [
        {
            "recordId": "label-1", "recordType": "ROW_LABEL_CELL",
            "status": "SOURCE_CELL_STRUCTURALLY_RESOLVED", "headerStatus": "ROW_LABEL_NO_HEADER_REQUIRED",
            "documentId": "d", "tableId": "t", "page": 0, "sourceRow": 1,
            "sourceCell": 0, "gridColumn": 0, "text": "Town", "rowLabelText": "Town",
            "sourceSpan": span("d", row_zone["id"], 100, "Town", 0),
            "rowLabelSourceSpan": span("d", row_zone["id"], 100, "Town", 0),
            "resolvedHeaderPath": [],
        },
        {
            "recordId": "value-1", "recordType": "TABLE_VALUE_CELL",
            "status": "SOURCE_CELL_STRUCTURALLY_RESOLVED", "headerStatus": "RESOLVED",
            "documentId": "d", "tableId": "t", "page": 0, "sourceRow": 1,
            "sourceCell": 1, "gridColumn": 1, "text": "12",
            "sourceSpan": span("d", row_zone["id"], 100, "12", 5),
            "ocrBox": [22, 10, 38, 30], "resolvedHeaderPath": header_path("M", 1),
        },
        {
            "recordId": "value-2", "recordType": "TABLE_VALUE_CELL",
            "status": "SOURCE_CELL_STRUCTURALLY_RESOLVED", "headerStatus": "RESOLVED",
            "documentId": "d", "tableId": "t", "page": 0, "sourceRow": 1,
            "sourceCell": 2, "gridColumn": 2, "text": "34",
            "sourceSpan": span("d", row_zone["id"], 100, "34", 8),
            "ocrBox": [42, 10, 58, 30], "resolvedHeaderPath": header_path("N", 2),
        },
    ]
    evidence = []
    for cell, pdf_value, word_index, vector_id, box, status in (
        (cells[1], "12", 1, "v1", [22, 10, 38, 30], "SOURCE_TEXT_LAYER_AGREES"),
        (cells[2], "35", 2, "v2", [42, 10, 58, 30], "SOURCE_TEXT_LAYER_CORRECTION"),
    ):
        evidence.append({
            "recordId": cell["recordId"], "recordType": "TABLE_VALUE_CELL",
            "documentId": "d", "tableId": "t", "pageIndex": 0,
            "sourcePdfSha256": PDF_SHA, "sourceStatus": cell["status"],
            "sourceText": cell["text"], "sourceSpan": cell["sourceSpan"],
            "evidence": {
                "status": status, "rawOcrText": cell["text"],
                "derivedPdfText": pdf_value, "derivedNumericKey": pdf_value,
                "replacementRequired": status == "SOURCE_TEXT_LAYER_CORRECTION",
                "pdfWordIndex": word_index, "pdfWordText": pdf_value,
                "pdfWordBox": box, "pdfWordBoxPdfPoints": [x / 2 for x in box],
                "pdfVectorCellId": vector_id,
                "pdfVectorCellBounds": [box[0] - 2, 0, box[2] + 2, 40],
                "origin": "ORIGINAL_PDF_TEXT_LAYER_NUMERIC_WORD",
            },
        })
    table = {
        "tableId": "t", "documentId": "d", "page": 0,
        "pdfVectorTopology": {"status": "USABLE", "sourcePdfSha256": PDF_SHA},
        "rows": [{
            "recordId": "row-1", "tableId": "t", "documentId": "d", "page": 0,
            "sourceRow": 1, "rowText": row_text, "rowSourceSpan": row_span,
            "rowSequenceStatus": "ROW_SEQUENCE_RESOLVED",
        }],
        "cells": cells,
    }
    geometry = {"tables": {"t": {
        "sourcePdfSha256": PDF_SHA,
        "topologyCheck": {"status": "USABLE"},
        "vectorCells": [
            {"id": "v1", "box": [20, 0, 40, 40], "rowStart": 1, "rowEnd": 1,
             "vectorColumnStart": 1, "vectorColumnEnd": 1},
            {"id": "v2", "box": [40, 0, 60, 40], "rowStart": 1, "rowEnd": 1,
             "vectorColumnStart": 2, "vectorColumnEnd": 2},
        ],
        "numericTextLayerWords": [
            {"wordIndex": 1, "text": "12", "comparisonCanonical": "12", "box": [22, 10, 38, 30], "pdfBox": [11, 5, 19, 15]},
            {"wordIndex": 2, "text": "35", "comparisonCanonical": "35", "box": [42, 10, 58, 30], "pdfBox": [21, 5, 29, 15]},
        ],
    }}}
    bundle = {"zones": [row_zone, header_zone]}
    value_evidence = {"cells": evidence}
    return {"tables": [table]}, bundle, value_evidence, geometry


def baseline_input():
    control = "control fixture"
    prefix = control + "\n\n"
    plain_content = prefix + "plain source"
    table_content = prefix + "Town\t12\t34"
    return {
        "controlFileSha256": "fixture-control",
        "arms": [
            {"parser": "plain", "content": plain_content, "contentSha256": sha(plain_content), "ranges": []},
            {"parser": "table", "content": table_content, "contentSha256": sha(table_content),
             "ranges": [{"id": "d", "start": len(prefix), "end": len(table_content),
                         "textSha256": sha("Town\t12\t34")}],
             "packets": [{"tableId": "t", "row": 1, "start": len(prefix), "end": len(table_content),
                          "text": "Town\t12\t34", "textSha256": sha("Town\t12\t34")} ]},
        ],
    }


class HeldCellProjectionTests(unittest.TestCase):
    def test_complete_row_overlay_keeps_baseline_bytes_and_separate_pdf_origin(self):
        enumeration, bundle, evidence, geometry = fixture()
        overlay = build_repair_overlay(enumeration, bundle, evidence, geometry)
        self.assertEqual(overlay["summary"]["completeCorrectedRows"], 1)
        self.assertEqual(overlay["summary"]["pdfSourceCorrectionCells"], 1)
        self.assertIn('c2["N"]="35"', overlay["text"])
        row_block = overlay["completeRowBlocks"][0]["text"]
        body_heading = "## Source row cells (full header paths and PDF text; semantics NOT_ASSESSED)\n"
        self.assertIn(body_heading, row_block)
        body_lines = [line for line in row_block.splitlines() if line.startswith('row=')]
        self.assertEqual(len(body_lines), 1)
        body_line = body_lines[0]
        self.assertLess(row_block.index(body_heading), row_block.index(body_line))
        self.assertTrue(body_line.startswith('row="Town"|'))
        self.assertIn('c1["M"]="12"', body_line)
        self.assertIn('c2["N"]="35"', body_line)
        self.assertIn("34", [cell["rawOcrText"] for cell in overlay["completeRowBlocks"][0]["cells"]])
        self.assertEqual(overlay["completeRowBlocks"][0]["semanticStatus"], "NOT_ASSESSED")
        native = build_native_input(baseline_input(), overlay, {
            "projectionFreezeSha256": "f" * 64,
            "projectionSha256": "e" * 64,
        })
        base_table = baseline_input()["arms"][1]
        table = next(arm for arm in native["arms"] if arm["parser"] == "table")
        treatment = next(arm for arm in native["arms"] if arm["parser"] == "source-pdf-repair-v1")
        self.assertEqual(table["content"], base_table["content"])
        self.assertEqual(treatment["content"][:len(base_table["content"])], base_table["content"])
        self.assertEqual(treatment["ranges"][0]["textSha256"], base_table["ranges"][0]["textSha256"])
        self.assertTrue(all("sourceStart" not in r for r in treatment["ranges"] if r.get("origin")))

    def test_incomplete_row_does_not_emit_full_corrected_row(self):
        enumeration, bundle, evidence, geometry = fixture()
        evidence["cells"][0]["evidence"]["status"] = "HELD"
        overlay = build_repair_overlay(enumeration, bundle, evidence, geometry)
        self.assertEqual(overlay["summary"]["completeCorrectedRows"], 0)
        self.assertEqual(overlay["summary"]["partialCorrectionCells"], 1)
        self.assertNotIn("PDF-derived complete row", overlay["text"])
        self.assertIn("qualified cell only", overlay["text"])

    def test_bad_sibling_source_span_withholds_full_row(self):
        enumeration, bundle, evidence, geometry = fixture()
        enumeration["tables"][0]["cells"][1]["sourceSpan"]["quote"] = "forged"
        overlay = build_repair_overlay(enumeration, bundle, evidence, geometry)
        self.assertEqual(overlay["summary"]["completeCorrectedRows"], 0)
        self.assertEqual(overlay["summary"]["partialCorrectionCells"], 1)


if __name__ == "__main__":
    unittest.main()
