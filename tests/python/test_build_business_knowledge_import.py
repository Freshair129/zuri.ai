import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[2] / "scripts" / "build_business_knowledge_import.py"
SPEC = importlib.util.spec_from_file_location("business_knowledge_import", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BusinessKnowledgeImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.record = {
            "knowledge_id": "smartgift:catalog:abc:SKU-1",
            "business_id": "smartgift",
            "knowledge_type": "PRODUCT",
            "product_code": "SKU-1",
            "name": "ของขวัญ",
            "category": "General",
            "description": None,
            "unit": None,
            "sell_price": None,
            "currency": None,
            "moq": None,
            "colors": [],
            "specification": {},
            "source_ref": "duckdb:catalog_sku:" + "a" * 64 + ":page:1",
            "source_sha256": "a" * 64,
            "as_of": "2026-08-11T20:02:26Z",
            "approved_at": "2026-08-13T20:31:18Z",
            "is_active": True,
            "sensitivity": "PUBLIC",
            "contract_version": "1.0.0",
        }

    def tearDown(self):
        self.temp.cleanup()

    def _artifacts(self, records):
        payload = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in records).encode("utf-8")
        data_path = self.root / "business-knowledge.jsonl"
        report_path = self.root / "reconciliation.json"
        data_path.write_bytes(payload)
        report_path.write_text(json.dumps({
            "contractVersion": "1.0.0",
            "status": "READY",
            "publishableRowCount": len(records),
            "outputSha256": hashlib.sha256(payload).hexdigest(),
        }), encoding="utf-8")
        return data_path, report_path

    def test_builds_transactional_direct_postgres_upsert(self):
        data_path, report_path = self._artifacts([self.record])

        sql = MODULE.build_import_sql(data_path, report_path)

        self.assertIn("begin;", sql.lower())
        self.assertIn("jsonb_to_recordset", sql)
        self.assertIn("on conflict (business_id, product_code)", sql.lower())
        self.assertIn("commit;", sql.lower())
        self.assertNotIn("ของขวัญ", sql)

    def test_rejects_artifact_when_reconciliation_hash_does_not_match(self):
        data_path, report_path = self._artifacts([self.record])
        data_path.write_bytes(data_path.read_bytes() + b"\n")

        with self.assertRaisesRegex(ValueError, "SHA-256"):
            MODULE.build_import_sql(data_path, report_path)

    def test_rejects_duplicate_business_product_keys(self):
        duplicate = dict(self.record, knowledge_id="smartgift:catalog:def:SKU-1")
        data_path, report_path = self._artifacts([self.record, duplicate])

        with self.assertRaisesRegex(ValueError, "duplicate business/product"):
            MODULE.build_import_sql(data_path, report_path)


if __name__ == "__main__":
    unittest.main()
