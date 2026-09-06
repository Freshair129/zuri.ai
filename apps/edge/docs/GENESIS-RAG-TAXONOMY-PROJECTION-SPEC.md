---
id: "GENESIS-RAG-TAXONOMY-PROJECTION-SPEC"
version: "0.2.0"
created_at: "2026-08-23T04:12:34+07:00, ATHER"
last_update: "2026-08-23T04:28:17+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "P3 side-by-side GenesisBlock taxonomy projection"
  parent: "GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN"
  p2_approval: "approved by user, 2026-08-23"
  p3_approval: "approved by user, 2026-08-23"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Taxonomy — P3 Projection Specification

## 0. Boundary

P2 approved the aggregate review report and the `visible_no_promotion` policy.
This specification defines the next side-by-side projection only. It does not
activate category serving, change `family_v2`, build vectors, or alter pricing.

Current approved category count remains zero. Candidate and review evidence may be
materialized for inspection, but it is not an authoritative business mapping.

Target store:

```text
data/genesis_smartgift_store_taxonomy_v3
```

The existing `data/genesis_smartgift_store_family_v2` store and the pricing source
remain unchanged and are the rollback/reference authorities.

## 1. Inputs and provenance

The projection consumes only:

- the canonical catalog snapshot used by `taxonomy-review-v1`;
- `taxonomy-p0-v1` deterministic assignments;
- the P2 report snapshot ID and source lineage;
- the existing family, variant, and offer identities.

Every projected node and the projection manifest must carry the catalog snapshot ID,
taxonomy rule version, report version, and source role/reference appropriate to the
node. No model-generated mapping, image inference, price, inventory quantity, or raw
secret is an input.

## 2. Identity and node contract

Existing identity is retained exactly:

| Node | ID authority | Required projection properties |
|---|---|---|
| ProductFamily | existing `familyId` | `familyId`, `mergeStatus`, `taxonomyStatus`, `candidateCategoryIds`, `componentSignature`, `reviewReasons`, `catalogVersion`, `taxonomyRuleVersion` |
| ProductVariant | existing `variantId` | existing variant properties plus `catalogVersion` |
| CatalogOffer | existing `offerId` | existing offer/provenance properties plus `catalogVersion` |
| Category | stable `categoryId` from P0 vocabulary | `categoryId`, `status: candidate`, `taxonomyVersion`, `catalogVersion` |

No family, variant, or offer may be duplicated under a taxonomy-specific ID. A
category ID is not derived from display text at projection time; it comes from the
versioned P0 vocabulary.

## 3. Relationship contract

Existing identity edges remain:

```text
ProductFamily -[:HAS_VARIANT]-> ProductVariant
ProductVariant -[:HAS_OFFER]-> CatalogOffer
```

Taxonomy evidence uses a non-authoritative edge:

```text
ProductFamily -[:CANDIDATE_CATEGORY]-> Category
```

`CANDIDATE_CATEGORY` is allowed for `auto` and `review_required` assignments and
must carry `taxonomyStatus`, `ruleVersion`, `reportVersion`, and `snapshotId`.
It is a review/provenance edge only; serving queries must not treat it as an
approved category filter.

`BELONGS_TO_CATEGORY` is reserved for a future approved assignment. The current
projection must emit zero such edges because `approvedBaseCategoryCount = 0`.

Unclassified families remain visible as family nodes with no category edge and with
their `unclassified` status and review reasons retained.

## 4. Projection manifest

The side-by-side store must contain a separate `taxonomy-manifest.json` with:

| Field | Rule |
|---|---|
| `schemaVersion` | `1` for this projection contract |
| `projectionVersion` | `taxonomy-v3-projection-v1` |
| `catalogSnapshotId` | exact P2 snapshot ID |
| `taxonomyRuleVersion` | `taxonomy-p0-v1` |
| `reviewReportVersion` | `taxonomy-review-v1` |
| `status` | `proposed` or `ready_for_review`, never active |
| `promotionPolicy` | `visible_no_promotion` |
| `activated` | `false` |
| `approvedBaseCategoryCount` | `0` for the current snapshot |
| `candidateCategoryCount` | `29` for the current snapshot |
| `familyCount` | `845` |
| `variantCount` | `1,016` |
| `offerCount` | `1,016` |
| `candidateCategoryEdgeCount` | derived and verified from the batch |
| `approvedCategoryEdgeCount` | `0` |
| `vector` | `not_built`; no vector work in P3 |

The manifest is written atomically only into the new store. Snapshot mismatch or
an existing incompatible manifest must fail closed; it must never overwrite the
source or `family_v2`.

## 5. Determinism and verification

The implementation must provide pure builders before native-store mutation:

1. same catalog snapshot and rule/report versions produce byte-equivalent logical
   node and edge IDs;
2. family/variant/offer counts remain 845/1,016/1,016;
3. candidate category count is 29 and approved category edge count is 0;
4. taxonomy status reconciliation remains 611/222/12;
5. existing merge-review reconciliation remains 102/5/0;
6. every candidate edge points to an emitted category node and an existing family;
7. unclassified families have no candidate category edge;
8. second initialization returns `skip_same_snapshot` and does not duplicate data;
9. a changed snapshot fails closed and leaves the previous side-by-side store intact;
10. `family_v2` files, runtime defaults, retrieval filters, pricing, and vectors are
    unchanged.

## 6. Explicit non-scope

- no `BELONGS_TO_CATEGORY` edges until approved assignments exist;
- no category runtime/filter/MCP/CLI integration;
- no vector index or embedding model decision;
- no source, family_v2, price, offer, or inventory mutation;
- no automatic promotion of `auto` into `approved`;
- no claim that the side-by-side store is production-ready.

## 7. Implementation status

The approved contract has been implemented and materialized in the isolated local
store. Evidence is recorded in GENESIS-RAG-TAXONOMY-PROJECTION-REPORT.md.

The projection remains `status: proposed` and `activated: false`. P4 serving and
runtime selection remain separately gated.

## 8. Approval gate

P3 implementation began after approval of this projection contract. After the pure
batch and isolated store were verified, a separate serving/activation decision remains
required before P4 integration or runtime selection.

## References

- GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN.md
- GENESIS-RAG-TAXONOMY-CONTRACT.md
- GENESIS-RAG-TAXONOMY-REVIEW-REPORT.md
- GENESIS-RAG-CATALOG-FAMILY-VARIANT-SPEC.md
- GENESIS-RAG-DB-MIGRATION-REPORT.md

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.2.0 | 2026-08-23 | beta | P3 contract approved and verified through isolated taxonomy_v3 materialization; P4 remains gated | ATHER |
| 0.1.0b | 2026-08-23 | candidate | Drafted P3 side-by-side taxonomy projection, candidate-edge, manifest, and non-activation contract | ATHER |
