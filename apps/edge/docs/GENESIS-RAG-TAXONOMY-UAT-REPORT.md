---
id: "GENESIS-RAG-TAXONOMY-UAT-REPORT"
version: "0.1.1b"
created_at: "2026-08-23T05:10:00+07:00, ATHER"
last_update: "2026-08-23T05:15:00+07:00, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "P5 read-only taxonomy preview UAT and activation recommendation"
  parent: "GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN"
  snapshot: "d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Taxonomy — P5 UAT and Operations Evidence

## 0. Decision summary

The bounded preview path passes the current read-only UAT set. Activation is
**HOLD / DO NOT ACTIVATE** because the projection still has zero approved
categories and zero authoritative `BELONGS_TO_CATEGORY` edges. The active
runtime remains `data/genesis_smartgift_store_family_v2`.

This report does not authorize category promotion, production runtime
selection, vector construction, pricing changes, or delivery changes.

## 1. Snapshot and reconciliation

| Metric | Result |
|---|---:|
| Catalog snapshot | `d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31` |
| Query alias version | `taxonomy-query-alias-v1` |
| Candidate categories | 29 |
| Approved categories | 0 |
| Families | 845 |
| Bundle families | 753 |
| Variants | 1,016 |
| Offers | 1,016 |
| Candidate category edges | 2,447 |
| Authoritative category edges | 0 |
| Taxonomy status | 611 auto / 222 review_required / 12 unclassified |
| Merge-review reconciliation | 102 auto / 5 review_required / 0 unclassified |
| Projection status | `proposed`, `activated: false` |
| Vector | `not_built` |

## 2. UAT cases

| Case | Input / check | Result | Evidence |
|---|---|---|---|
| English text | `mug`, limit 3, exclude review | PASS | 212 matched auto families; bounded results |
| English category | `drinkware`, limit 3, exclude review | PASS | 459 matched auto families; category evidence only |
| Thai query alias | `แก้ว`, limit 1, exclude review | PASS | 459 matched families; candidate category includes `drinkware` |
| Thai query alias | `ร่ม`, limit 1, exclude review | PASS | 211 matched families; candidate category includes `umbrella` |
| Thai query alias | `ปากกา`, limit 1, exclude review | PASS | 212 matched families; candidate category includes `pen` |
| Exact offer lookup | `TMK0514`, limit 1, exclude review | PASS | `exact_code`; family/variant/offer identity preserved |
| Mixed bundle separation | `drinkware+pen` vs `drinkware+pen+usb_flash_drive` | PASS | 3 vs 2 families; family-ID overlap 0 |
| Unknown visibility | first unclassified family queried with default review visibility | PASS | same family returned with `taxonomyStatus: unclassified` |
| Bounded input | empty query, limit 51 | PASS | rejected as `TAXONOMY_QUERY_INVALID` |
| Snapshot drift | altered projection snapshot | PASS | rejected as `TAXONOMY_PROJECTION_UNAVAILABLE` |

Thai aliases are query-only expansion. They do not change the canonical
`taxonomy-p0-v1` classification, projection manifest counts, category edges,
or native store contents.

## 3. Rollback and reference check

- Active reference remains `data/genesis_smartgift_store_family_v2`.
- Side-by-side `data/genesis_smartgift_store_taxonomy_v3` remains intact and
  explicitly non-active.
- Re-running the projection command with the same snapshot must return
  `skip_same_snapshot`; no source or v2 files are overwritten.
- Rollback is a runtime selection/reference decision back to v2; no deletion
  of the v3 store is required or authorized.

## 4. Verification

- `npm run typecheck`: passed;
- `npm run build`: passed;
- `npm test`: 287 tests, 285 passed, 0 failed, 2 intentional DuckDB skips;
- taxonomy serving suite after Thai alias fix: 6/6 passed;
- CLI and pure-service UAT use the same `taxonomy-serving-v1` response;
- no raw price, raw source row, secret, or local source path is returned by the
  serving response.

## 5. Activation recommendation

**Recommendation: HOLD.** Before activation, the owner/business reviewer must
accept the 29 candidate categories, resolve or explicitly retain the 222
review-required and 12 unclassified families, and approve a separate
promotion/rollback gate. Until then, keep preview mode available only as
non-authoritative evidence.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.1b | 2026-08-23 | candidate | Refreshed final P5 verification evidence after the Thai query-alias test was added | ATHER |
| 0.1.0b | 2026-08-23 | candidate | Recorded P5 read-only UAT, Thai query alias coverage, reconciliation, and HOLD activation recommendation | ATHER |
