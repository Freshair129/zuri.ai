import unittest

from build_source_projection import build_source_projection


class SourceProjectionTests(unittest.TestCase):
    def test_projection_keeps_full_raw_row_and_qualifies_only_resolved_cells(self):
        row_text = "จังหวัดตัวอย่าง\t100\t200"
        source_zone = "## table row\nh1 c1=Population\nh2 c1=Total\n" + row_text + "\n[table-row-end]\n\n"
        source_start = 100
        enumeration = {
            "sourceBundleSha256": "bundle-hash",
            "tableSidecarSha256": "sidecar-hash",
            "paddleRawSha256": {"economy": "eco-hash", "population": "pop-hash"},
            "freezeSha256": "source-freeze-hash",
            "summary": {"sourcePackets": 1, "sourceCells": 3, "structurallyResolvedCellCandidates": 1, "heldCells": 2},
            "tables": [{"rows": [{
                "recordId": "src-row:population:p0:t:r3",
                "documentId": "population",
                "tableId": "t",
                "page": 0,
                "sourceRow": 3,
                "rowText": row_text,
                "rowTextSha256": "row-hash",
                "rowSourceSpan": {"zoneId": "zone-1", "rangeId": "population", "start": 100, "end": 200},
                "rowSequenceStatus": "ROW_SEQUENCE_RESOLVED",
                "structurallyResolvedCellCount": 1,
                "heldCellCount": 2,
                "semanticStatus": "NOT_ASSESSED",
            }], "cells": [
                {"recordId": "label", "documentId": "population", "tableId": "t", "page": 0, "sourceRow": 3, "recordType": "ROW_LABEL_CELL", "status": "SOURCE_CELL_STRUCTURALLY_RESOLVED", "text": "จังหวัดตัวอย่าง", "rowLabelText": "จังหวัดตัวอย่าง", "semanticStatus": "NOT_ASSESSED", "sourceSpan": {"rangeId": "population", "start": 130, "end": 145, "quote": "จังหวัดตัวอย่าง"}, "resolvedHeaderPath": []},
                {"recordId": "value-good", "documentId": "population", "tableId": "t", "page": 0, "sourceRow": 3, "sourceCell": 2, "gridColumn": 2, "recordType": "TABLE_VALUE_CELL", "status": "SOURCE_CELL_STRUCTURALLY_RESOLVED", "text": "100", "rowLabelText": "จังหวัดตัวอย่าง", "semanticStatus": "NOT_ASSESSED", "sourceSpan": {"rangeId": "population", "start": 146, "end": 149, "quote": "100"}, "rowLabelSourceSpan": {"rangeId": "population", "start": 130, "end": 145, "quote": "จังหวัดตัวอย่าง"}, "resolvedHeaderPath": [{"row": 1, "cell": 0, "text": "Total", "status": "RESOLVED", "physicalColumns": [2], "sourceSpan": {"rangeId": "population", "start": 125, "end": 130, "quote": "Total"}}]},
                {"recordId": "value-held", "documentId": "population", "tableId": "t", "page": 0, "sourceRow": 3, "sourceCell": 3, "gridColumn": 3, "recordType": "TABLE_VALUE_CELL", "status": "HELD", "text": "200", "rowLabelText": "จังหวัดตัวอย่าง", "semanticStatus": "NOT_ASSESSED", "sourceSpan": {"rangeId": "population", "start": 150, "end": 153, "quote": "200"}, "resolvedHeaderPath": []},
            ]}],
        }
        bundle = {
            "sourceChars": len(source_zone),
            "sourceRanges": [{"id": "population", "sourceStart": source_start, "sourceEnd": source_start + len(source_zone), "text": source_zone}],
            "zones": [{
                "id": "zone-1", "kind": "table-row", "rangeId": "population", "sourceStart": source_start, "sourceEnd": source_start + len(source_zone),
                "text": source_zone, "packet": {"tableId": "t", "row": 3},
            }],
        }

        result = build_source_projection(enumeration, bundle)
        self.assertEqual(result["summary"]["sourceRowsIncluded"], 1)
        self.assertEqual(result["summary"]["resolvedCellCandidates"], 1)
        self.assertEqual(result["summary"]["contextCellsIncludedButUnqualified"], 2)
        snippet = result["snippets"][0]
        self.assertIn(source_zone, result["text"])
        self.assertEqual(snippet["resolvedCellRecordIds"], ["value-good"])
        self.assertIn("Total", result["text"])
        self.assertIn("NOT_ASSESSED", result["text"])
        self.assertNotIn("value-held", result["text"])
        self.assertFalse(result["candidateGraphIncluded"])

    def test_projection_preserves_full_source_range_and_non_table_zones(self):
        row_text = "จังหวัดตัวอย่าง\t100"
        section = "## source heading\nsource context\n"
        table_zone = "## table row\nh1 c1=Count\n" + row_text + "\n"
        prose = "## prose\nsource footnote\n"
        prefix = "\n"
        gap = "\n"
        suffix = "\n"
        original = prefix + section + gap + table_zone + gap + prose + suffix
        start = 500
        section_start = start + len(prefix)
        table_start = section_start + len(section) + len(gap)
        prose_start = table_start + len(table_zone) + len(gap)
        table_end = table_start + len(table_zone)
        enumeration = {
            "sourceBundleSha256": "bundle-hash",
            "tableSidecarSha256": "sidecar-hash",
            "paddleRawSha256": {"population": "pop-hash"},
            "freezeSha256": "source-freeze-hash",
            "tables": [{
                "rows": [{
                    "recordId": "src-row:population:p0:t:r3",
                    "documentId": "population", "tableId": "t", "page": 0,
                    "sourceRow": 3, "rowText": row_text,
                    "rowSourceSpan": {"zoneId": "table-zone", "rangeId": "population", "start": table_start, "end": table_end},
                    "semanticStatus": "NOT_ASSESSED",
                }],
                "cells": [{
                    "recordId": "value-good", "documentId": "population", "tableId": "t", "page": 0,
                    "sourceRow": 3, "sourceCell": 1, "gridColumn": 1,
                    "recordType": "TABLE_VALUE_CELL", "status": "SOURCE_CELL_STRUCTURALLY_RESOLVED",
                    "text": "100", "rowLabelText": "จังหวัดตัวอย่าง", "semanticStatus": "NOT_ASSESSED",
                    "sourceSpan": {"rangeId": "population", "start": table_start + len("## table row\nh1 c1=Count\nจังหวัดตัวอย่าง\t"), "end": table_start + len("## table row\nh1 c1=Count\nจังหวัดตัวอย่าง\t100"), "quote": "100"},
                    "rowLabelSourceSpan": {"rangeId": "population", "start": table_start + len("## table row\nh1 c1=Count\n"), "end": table_start + len("## table row\nh1 c1=Count\nจังหวัดตัวอย่าง"), "quote": "จังหวัดตัวอย่าง"},
                    "resolvedHeaderPath": [{"row": 1, "cell": 0, "text": "Count", "status": "RESOLVED", "physicalColumns": [1], "sourceSpan": {"rangeId": "population", "start": table_start + len("## table row\nh1 c1="), "end": table_start + len("## table row\nh1 c1=Count"), "quote": "Count"}}],
                }],
            }],
        }
        bundle = {
            "sourceChars": len(original),
            "sourceRanges": [{"id": "population", "sourceStart": start, "sourceEnd": start + len(original), "text": original}],
            "zones": [
                {"id": "section-zone", "kind": "source-section", "rangeId": "population", "sourceStart": section_start, "sourceEnd": section_start + len(section), "text": section},
                {"id": "table-zone", "kind": "table-row", "rangeId": "population", "sourceStart": table_start, "sourceEnd": table_end, "text": table_zone, "packet": {"tableId": "t", "row": 3}},
                {"id": "prose-zone", "kind": "prose", "rangeId": "population", "sourceStart": prose_start, "sourceEnd": prose_start + len(prose), "text": prose},
            ],
        }

        result = build_source_projection(enumeration, bundle)

        self.assertIn(section, result["text"])
        self.assertIn(prose, result["text"])
        self.assertEqual(result["summary"]["nonTableContextZonesIncluded"], 2)
        self.assertEqual(result["summary"]["rawSourceRangeChars"], len(original))
        self.assertEqual(result["summary"]["rawRangeCoveragePct"], 100.0)
        self.assertTrue(result["summary"]["sourceRangesReconstructedExactly"])


if __name__ == "__main__":
    unittest.main()
