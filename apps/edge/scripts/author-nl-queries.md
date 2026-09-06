---
id: ZEDGE:SYNTHETIC-QUERIES
version: 0.2.1b
created_at: "2026-09-06T21:00:00+07:00,RWANG,a470a458"
last_update: "2026-09-06T21:00:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: zuri-edge-device
  scope: synthetic-query-fixtures
relations:
  - type: relates_to
    target: ZAI:ADR-062
---

# Synthetic query authoring

The approved snapshot fixture boundary replaces customer-derived test inputs in an
isolated preparation branch. Original source history remains in the private Edge
repository. See [fixture provenance](../tests/fixtures/v4/SYNTHETIC.md).
`ZAI:ADR-062` is an external Server reference, not a local document alias.

Run `node scripts/generate-synthetic-fixtures.mjs`. This deterministic generator
reads only the committed type aliases and category map. It never reads a customer
data root or transcripts. Expected IDs resolve against `synthetic-50.json`.

- `QS_NL_SYNTHETIC_v1`: 60 queries, 15 per group and intent, at least 3 in every
  group/intent cell, 18 specific-model targets. Exclude, quantity and budget each
  retain at least 12 cases. No product codes in natural-language queries.
- `QS_LINE_SYNTHETIC_v1`: six authored queries, four excluding drinkware with an
  unmet 200-baht budget, one drinkware color query and one drinkware find query.
- `QS_OFFER_SYNTHETIC_v1`: 1,005 query cases over 82 synthetic offers, with expected
  component model IDs. This is not 1,005 distinct offers or the historical cohort.

Bundled evaluation loaders and metric query-set labels use these synthetic names.
Evaluate them only against a matching synthetic ingest. Existing real-catalog
benchmark results remain historical; synthetic replay does not establish semantic
recall, embedding quality, production latency or historical LINE behavior.

The legacy `--gen-offer-self` operation still builds a query set from an explicitly
supplied data root, but writes to `catalog_eval_v4/generated/QS_OFFER_SELF_v1.jsonl`
under that data root, outside the committed synthetic fixtures. It was not run.

## Version diff / CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.2.0b | 2026-09-06 | beta | Replace customer-derived authoring with reproducible synthetic inputs and explicit evaluation limits | a470a458 (base) | RWANG |

Version diff 0.2.0b → 0.2.1b: add the monorepo-qualified document metadata ID;
query data and coverage invariants are unchanged.
