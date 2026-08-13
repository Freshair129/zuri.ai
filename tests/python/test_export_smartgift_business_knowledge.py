import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import duckdb


SCRIPT = Path(__file__).parents[2] / "scripts" / "export_smartgift_business_knowledge.py"
PILOT_APPROVAL = Path(__file__).parents[2] / "contracts" / "approvals" / "smartgift-phase1-pilot.json"
SPEC = importlib.util.spec_from_file_location("smartgift_export", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SmartGiftExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "fixture.duckdb"
        con = duckdb.connect(str(self.db_path))
        con.execute("create table catalog_source(source_sha256 varchar, sellable boolean, status varchar)")
        con.execute("create table catalog_sku(source_sha256 varchar, page_no integer, code varchar, name varchar, brand varchar)")
        con.execute("create table stg_product(source_sha256 varchar, source_row integer, product_code varchar, name varchar, unit varchar, category varchar, description varchar, unit_price double, buy_price double, margin_pct double)")
        con.execute("create table price_staging(approved_at varchar, approved_by varchar)")
        sha = "a" * 64
        con.execute("insert into catalog_source values (?, true, 'extracted')", [sha])
        con.execute("insert into stg_product values (?, 1, 'USB-001', 'แฟลชไดรฟ์ไม้', 'ชิ้น', 'USB', '32GB', 120, 70, 41.6)", [sha])
        con.close()
        self.sha = sha

    def tearDown(self):
        self.temp.cleanup()

    def test_no_manifest_means_no_publishable_rows(self):
        con = duckdb.connect(str(self.db_path), read_only=True)
        try:
            self.assertEqual(MODULE.extract_records(con, "smartgift", {}), [])
        finally:
            con.close()

    def test_manifest_controls_price_and_forbidden_fields_never_export(self):
        manifest = Path(self.temp.name) / "approval.json"
        manifest.write_text(json.dumps({"contractVersion": "1.0.0", "sources": [{
            "source_sha256": self.sha, "approved_by": "owner", "approved_at": "2026-08-14T00:00:00+07:00",
            "as_of": "2026-08-12T00:00:00+07:00", "publish_price": False,
        }]}), encoding="utf-8")
        approvals = MODULE.load_approvals(manifest)
        con = duckdb.connect(str(self.db_path), read_only=True)
        try:
            rows = MODULE.extract_records(con, "smartgift", approvals)
        finally:
            con.close()
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), set(MODULE.PUBLIC_FIELDS))
        self.assertIsNone(rows[0]["sell_price"])
        rendered = json.dumps(rows[0])
        self.assertNotIn("buy_price", rendered)
        self.assertNotIn("margin_pct", rendered)

    def test_checked_in_pilot_approval_is_bounded_to_verified_public_catalog(self):
        approvals = MODULE.load_approvals(PILOT_APPROVAL)

        self.assertEqual(
            set(approvals),
            {"017e72b6748d5f3ad99d2c85da0d3df71cf0e7e3d66fe79e67591066f2788c76"},
        )
        approval = next(iter(approvals.values()))
        self.assertEqual(approval["approved_by"], "Boss (บอส)")
        self.assertFalse(approval["publish_price"])

    def test_jsonl_digest_matches_exact_written_bytes_on_windows(self):
        records = [{"knowledge_id": "smartgift:product:one", "name": "ของขวัญ"}]
        artifact = MODULE.render_jsonl(records)
        output = Path(self.temp.name) / "business-knowledge.jsonl"

        output.write_bytes(artifact)

        self.assertNotIn(b"\r\n", output.read_bytes())
        self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), MODULE.artifact_sha256(records))


if __name__ == "__main__":
    unittest.main()
