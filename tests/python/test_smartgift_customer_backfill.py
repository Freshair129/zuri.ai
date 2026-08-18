import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import duckdb


SCRIPT = Path(__file__).parents[2] / "scripts" / "apply_smartgift_customer_backfill.py"
SPEC = importlib.util.spec_from_file_location("smartgift_customer_backfill", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SmartGiftCustomerBackfillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "fixture.duckdb"
        connection = duckdb.connect(str(self.db_path))
        connection.execute(
            """
            create table customer (
              customer_key varchar,
              display_name varchar,
              normalized_name varchar,
              tax_id varchar,
              email varchar,
              phone_e164 varchar,
              postcode varchar,
              contact_type varchar
            )
            """
        )
        connection.executemany(
            "insert into customer values (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("C-001", "Alpha", "alpha", "T-001", "a@example.test", "+661", "10", "mobile"),
                ("C-002", "Alpha", "alpha", "T-002", "b@example.test", "+662", "10", "mobile"),
                ("C-003", "Beta", "beta", "T-003", None, None, None, None),
                ("C-004", None, "missing", "T-004", None, None, None, None),
            ],
        )
        connection.close()

    def tearDown(self):
        self.temp.cleanup()

    def test_resolution_is_fail_closed_and_hashes_are_unique(self):
        rows = MODULE.read_source_rows(self.db_path, "a" * 64)
        self.assertEqual(MODULE.summarize(rows), {
            "NEW_CANDIDATE": 1,
            "REVIEW_REQUIRED": 2,
            "UNRESOLVED": 0,
            "REJECTED": 1,
        })
        self.assertEqual(len({row["sourceSha256"] for row in rows}), 4)
        self.assertIsNone(rows[1]["personId"])
        self.assertIsNotNone(rows[2]["personId"])

    def test_current_contract_is_not_import_ready(self):
        contract_path = Path(__file__).parents[2] / "contracts/migrations/smartgift-customer-data-contract.json"
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
        ready, reasons = MODULE.approval_gate(contract)
        self.assertFalse(ready)
        self.assertIn("contract_status:CANDIDATE", reasons)
        self.assertIn("approval:CUSTOMER_DATA_OWNER:UNASSIGNED", reasons)


if __name__ == "__main__":
    unittest.main()
