import unittest

from build_extraction_crosswalk import build_crosswalk


class ExtractionCrosswalkTests(unittest.TestCase):
    def fixture(self):
        header_markup = "h1 c2=Month A\nh1 c3=Month B\n"
        source_text = header_markup + "1\tMetric\t100\t200\nOutside\t900\n"
        row_start = len(header_markup)
        header_a_start = len("h1 c2=")
        header_b_start = len("h1 c2=Month A\nh1 c3=")
        label_start = row_start + len("1\t")
        first_row_end = row_start + len("1\tMetric\t100\t200\n")
        chunk_text = source_text[:first_row_end]
        chunk = {"sourceStart": 0, "sourceEnd": first_row_end, "textSha256": _sha(chunk_text), "inputText": chunk_text}
        facts = [
            {"subject": "Metric", "predicate": "has value", "value": "100", "description": "candidate", "headerQuote": "Month A", "evidenceQuote": "Metric\t100", "rowQuote": "Metric\t100\t200"},
            {"subject": "Metric", "predicate": "has value", "value": "100", "description": "duplicate", "headerQuote": "Month A", "evidenceQuote": "Metric\t100", "rowQuote": "Metric\t100\t200"},
            {"subject": "Metric", "predicate": "has values", "value": "100\t200", "description": "row", "headerQuote": "Month A", "evidenceQuote": "Metric\t100\t200", "rowQuote": "Metric\t100\t200"},
            {"subject": "Metric", "predicate": "has value", "value": "100", "description": "different source header", "headerQuote": "Month B", "evidenceQuote": "Metric\t100", "rowQuote": "Metric\t100\t200"},
            {"subject": "Outside", "predicate": "has value", "value": "900", "description": "outside chunk", "headerQuote": "Month A", "evidenceQuote": "Outside\t900", "rowQuote": "Outside\t900"},
            {"subject": "Metric", "predicate": "has value", "value": "100", "description": "absent header", "headerQuote": "Month Z", "evidenceQuote": "Metric\t100", "rowQuote": "Metric\t100\t200"},
        ]
        receipt = {
            "documents": [{"sourceId": "doc", "chunks": [{"chunkIndex": 0, **chunk, "facts": facts}]}],
        }
        audit_records = []
        for i, fact in enumerate(facts):
            audit_records.append({
                "candidateId": f"doc:0:fact:{i}",
                "sourceId": "doc",
                "chunkIndex": 0,
                "candidateFields": {k: fact.get(k) for k in ("subject", "predicate", "value", "description", "headerQuote")},
                "primaryRootCause": {"subtype": "diagnostic"},
                "frozenValidator": {"v6Status": "HELD"},
            })

        def cell(record_id, record_type, source_cell, text, start, header=None, header_start=None):
            span = {"rangeId": "doc", "zoneId": "row-1" if start < first_row_end else "row-2", "start": start, "end": start + len(text), "quote": text}
            return {
                "recordId": record_id,
                "recordType": record_type,
                "documentId": "doc",
                "tableId": "t",
                "page": 0,
                "sourceRow": 1 if start < first_row_end else 2,
                "sourceCell": source_cell,
                "gridColumn": source_cell,
                "status": "SOURCE_CELL_STRUCTURALLY_RESOLVED",
                "semanticStatus": "NOT_ASSESSED",
                "text": text,
                "rowLabelText": "Metric" if start < first_row_end else "Outside",
                "sourceSpan": span,
                "rowLabelSourceSpan": {"rangeId": "doc", "zoneId": span["zoneId"], "start": row_start if start < first_row_end else first_row_end, "end": (row_start if start < first_row_end else first_row_end) + len("Metric" if start < first_row_end else "Outside"), "quote": "Metric" if start < first_row_end else "Outside"},
                "resolvedHeaderPath": ([{"text": header, "sourceSpan": {"rangeId": "doc", "zoneId": "row-1", "start": header_start, "end": header_start + len(header), "quote": header}}] if header else []),
            }

        row_label_span = {"rangeId": "doc", "zoneId": "row-1", "start": label_start, "end": label_start + len("Metric"), "quote": "Metric"}
        cells = [
            cell("ordinal-1", "TABLE_VALUE_CELL", 0, "1", row_start),
            cell("label-1", "ROW_LABEL_CELL", 1, "Metric", label_start),
            cell("cell-100", "TABLE_VALUE_CELL", 2, "100", label_start + len("Metric\t"), "Month A", header_a_start),
            cell("cell-200", "TABLE_VALUE_CELL", 3, "200", label_start + len("Metric\t100\t"), "Month B", header_b_start),
            cell("label-2", "ROW_LABEL_CELL", 0, "Outside", first_row_end),
            cell("cell-900", "TABLE_VALUE_CELL", 1, "900", first_row_end + len("Outside\t"), "Month A", 0),
        ]
        # Exact label offsets replace the minimal per-cell helper's placeholder spans.
        cells[1]["sourceSpan"] = row_label_span
        cells[1]["rowLabelSourceSpan"] = row_label_span
        cells[2]["rowLabelSourceSpan"] = row_label_span
        cells[3]["rowLabelSourceSpan"] = row_label_span
        cells[4]["rowLabelSourceSpan"] = {"rangeId": "doc", "zoneId": "row-2", "start": first_row_end, "end": first_row_end + len("Outside"), "quote": "Outside"}
        cells[5]["rowLabelSourceSpan"] = cells[4]["rowLabelSourceSpan"]
        enumeration = {"tables": [{"rows": [
            {"recordId": "row-1", "documentId": "doc", "tableId": "t", "page": 0, "sourceRow": 1, "labelText": "Metric"},
            {"recordId": "row-2", "documentId": "doc", "tableId": "t", "page": 0, "sourceRow": 2, "labelText": "Outside"},
        ], "cells": cells}]}
        bundle = {
            "sourceRanges": [{"id": "doc", "sourceStart": 0, "sourceEnd": len(source_text), "text": source_text}],
            "zones": [
                {"id": "row-1", "kind": "table-row", "rangeId": "doc", "sourceStart": 0, "sourceEnd": first_row_end, "text": source_text[:first_row_end], "packet": {"tableId": "t", "row": 1}},
                {"id": "row-2", "kind": "table-row", "rangeId": "doc", "sourceStart": first_row_end, "sourceEnd": len(source_text), "text": source_text[first_row_end:], "packet": {"tableId": "t", "row": 2}},
            ],
        }
        audit = {"records": audit_records}
        return audit, receipt, enumeration, bundle

    def test_exact_cell_links_and_duplicate_emissions_are_many_to_one(self):
        audit, receipt, enumeration, bundle = self.fixture()
        result = build_crosswalk(audit=audit, candidate_receipt=receipt, enumeration=enumeration, bundle=bundle)
        by_id = {r["candidateId"]: r for r in result["records"]}
        self.assertEqual(by_id["doc:0:fact:0"]["sourceCellRecordIds"], ["cell-100"])
        self.assertEqual(by_id["doc:0:fact:1"]["sourceCellRecordIds"], ["cell-100"])
        self.assertEqual(result["summary"]["duplicateCandidateLinksToAlreadyLinkedCell"], 4)
        self.assertEqual(by_id["doc:0:fact:0"]["linkStatus"], "EXACT_SUBJECT_VALUE_HEADER_CELL_CANDIDATE")

    def test_whole_row_value_links_multiple_source_cells_without_semantic_admission(self):
        audit, receipt, enumeration, bundle = self.fixture()
        result = build_crosswalk(audit=audit, candidate_receipt=receipt, enumeration=enumeration, bundle=bundle)
        row_record = next(r for r in result["records"] if r["candidateId"] == "doc:0:fact:2")
        self.assertEqual(row_record["sourceCellRecordIds"], ["cell-100", "cell-200"])
        self.assertEqual(row_record["linkStatus"], "EXACT_SUBJECT_FULL_ROW_VALUE_SEQUENCE")
        self.assertEqual(row_record["semanticStatus"], "NOT_ASSESSED")
        self.assertEqual(row_record["graphAdmission"], "NONE")

    def test_other_source_header_is_retained_as_partial_cell_link(self):
        audit, receipt, enumeration, bundle = self.fixture()
        result = build_crosswalk(audit=audit, candidate_receipt=receipt, enumeration=enumeration, bundle=bundle)
        record = next(r for r in result["records"] if r["candidateId"] == "doc:0:fact:3")
        self.assertEqual(record["sourceCellRecordIds"], ["cell-100"])
        self.assertEqual(record["linkStatus"], "EXACT_SUBJECT_VALUE_CELL_HEADER_UNRESOLVED")
        self.assertEqual(record["sourceCellMatches"][0]["candidateHeaderStatus"], "SOURCE_HEADER_PRESENT_BUT_BINDING_HELD_OR_NOT_FOR_THIS_CELL")

    def test_source_cell_outside_emitting_chunk_is_not_linked(self):
        audit, receipt, enumeration, bundle = self.fixture()
        result = build_crosswalk(audit=audit, candidate_receipt=receipt, enumeration=enumeration, bundle=bundle)
        record = next(r for r in result["records"] if r["candidateId"] == "doc:0:fact:4")
        self.assertEqual(record["sourceCellRecordIds"], [])
        self.assertEqual(record["linkStatus"], "NO_EXACT_SOURCE_NATIVE_ROW_CELL_MATCH")

    def test_candidate_header_absent_from_exact_table_header_cells_is_reported(self):
        audit, receipt, enumeration, bundle = self.fixture()
        result = build_crosswalk(audit=audit, candidate_receipt=receipt, enumeration=enumeration, bundle=bundle)
        record = next(r for r in result["records"] if r["candidateId"] == "doc:0:fact:5")
        self.assertEqual(record["sourceCellRecordIds"], ["cell-100"])
        self.assertEqual(record["sourceCellMatches"][0]["candidateHeaderStatus"], "CANDIDATE_HEADER_NOT_PRESENT_IN_SOURCE_ROW")


def _sha(text):
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    unittest.main()
