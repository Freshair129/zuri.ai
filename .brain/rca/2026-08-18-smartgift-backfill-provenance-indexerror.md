---
title: "SmartGift customer backfill provenance insert IndexError"
date: "2026-08-18"
status: "resolved"
severity: "high"
---

# Symptom

`py -3.13 scripts/apply_smartgift_customer_backfill.py --apply` returned
`{"status":"FAILED","code":"IndexError"}`. The command did not publish
customer rows.

# Evidence

- The traceback located the failure at the provenance `cursor.execute` call in
  `scripts/apply_smartgift_customer_backfill.py` line 406.
- The live post-failure verification reported `customer=0`,
  `customer_import_batch=0` and `customer_import_provenance=0`.
- The provenance SQL contains 13 `%s` parameters and one literal `'NONE'`
  match method, but the parameter tuple supplied only 12 values.

# Root Cause

The importer omitted `row["resolutionStatus"]` from the provenance insert
parameter tuple. The database transaction was correctly rolled back, but the
client-side parameter mismatch raised `IndexError` before commit.

# Why the issue escaped detection

The existing tests covered source resolution and contract gating, but did not
exercise the parameter construction for the provenance insert against a real
Postgres transaction. The dry-run path never reaches this insert.

# Prevention

- Centralize provenance parameter construction in a small tested helper.
- Assert the helper returns all 13 placeholder values in the expected order.
- Keep the post-apply target verification and transaction rollback checks as
  mandatory gates.
