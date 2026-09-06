---
id: "GENESIS-RAG-TAXONOMY-PROJECTION-REPORT"
version: "0.2.1"
created_at: "2026-08-23T04:28:17+07:00, ATHER"
last_update: "2026-08-23T05:15:00+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "P3 isolated GenesisBlock taxonomy_v3 projection evidence"
  parent: "GENESIS-RAG-TAXONOMY-PROJECTION-SPEC"
  approval: "P3 contract approved by user, 2026-08-23"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Taxonomy — P3 Projection Evidence

## 0. Result boundary

P3 projection was materialized in a new local GenesisBlock store. The projection
is a proposed review artifact, not an active serving index.

| Field | Result |
|---|---|
| Store | `data/genesis_smartgift_store_taxonomy_v3` |
| Projection version | `taxonomy-v3-projection-v1` |
| Status | `proposed` |
| Activated | `false` |
| Promotion policy | `visible_no_promotion` |
| Vector | `not_built` |
| Runtime default | unchanged on `data/genesis_smartgift_store_family_v2` |

## 1. Provenance

| Field | Value |
|---|---|
| Catalog snapshot | `d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31` |
| Taxonomy rule | `taxonomy-p0-v1` |
| Review report | `taxonomy-review-v1` |
| Source role | `pricing` |
| Source SHA-256 | `5399499d3031ed58be66c958c2ee98fc57401190ee6ddd0a7d40b315842544c2` |
| Source rows | 1,017 |
| Canonical offers | 1,016 |

## 2. Projection counts

| Metric | Result |
|---|---:|
| Candidate categories | 29 |
| Approved categories | 0 |
| Product families | 845 |
| Variants | 1,016 |
| Offers | 1,016 |
| Nodes | 2,906 |
| Edges | 4,479 |
| Candidate category edges | 2,447 |
| Authoritative `BELONGS_TO_CATEGORY` edges | 0 |

Node reconciliation:

```text
29 category + 845 family + 1,016 variant + 1,016 offer = 2,906 nodes
```

Edge reconciliation:

```text
2,447 CANDIDATE_CATEGORY + 1,016 HAS_VARIANT + 1,016 HAS_OFFER = 4,479 edges
```

Taxonomy status remains:

```text
611 auto + 222 review_required + 12 unclassified = 845 families
```

Existing merge-review reconciliation remains:

```text
102 auto + 5 review_required + 0 unclassified = 107 families
```

## 3. Lifecycle verification

| Check | Evidence |
|---|---|
| First materialization | `ingest_empty_store` |
| Replay with same snapshot | `skip_same_snapshot` |
| Snapshot drift behavior | unit test returns `snapshot_changed` and does not refresh |
| Legacy materialized store without manifest | unit test returns `legacy_unmanifested` |
| v2 store | retained; no writes in the projection command |
| Source catalog | unchanged; only read during build |

Native materialization created the target manifest atomically after successful
GenesisBlock state persistence. The target manifest records `activated: false`.

## 4. Verification commands

- targeted RAG/taxonomy/projection tests: 23/23 passed;
- P4/P5 taxonomy serving tests: 6/6 passed;
- `npm run typecheck`: passed;
- `npm run build`: passed;
- `npm run taxonomy:project`: first run ingested, second run skipped the same snapshot.

The current full repository suite completed with 287 tests: 285 passed, 0 failed, and 2
intentional DuckDB skips because `SMARTGIFT_DUCKDB_PATH` is not configured.

## 5. Not activated

- no authoritative category serving/filter/MCP/CLI integration;
- P4 now exposes a separate read-only `taxonomy_preview` service for evidence;
- no runtime default change;
- no vector index or embedding model decision;
- no authoritative category edge;
- no source, price, offer, inventory, or family_v2 mutation.

P4 serving behavior is defined in GENESIS-RAG-TAXONOMY-SERVING-SPEC.md. The preview
path consumes only reconciled evidence and remains non-authoritative; activation
still requires the P5/UAT gate.

## References

- GENESIS-RAG-TAXONOMY-PROJECTION-SPEC.md
- GENESIS-RAG-TAXONOMY-REVIEW-REPORT.md
- GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN.md
- data/genesis_smartgift_store_taxonomy_v3/taxonomy-manifest.json

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.2.1 | 2026-08-23 | beta | Refreshed final P4/P5 serving and repository verification counts after the query-alias UAT test | ATHER |
| 0.2.0 | 2026-08-23 | beta | Linked the verified P4 read-only preview boundary while retaining non-activation evidence | ATHER |
| 0.1.0 | 2026-08-23 | beta | Recorded isolated P3 taxonomy_v3 materialization, counts, provenance, and idempotency evidence | ATHER |
