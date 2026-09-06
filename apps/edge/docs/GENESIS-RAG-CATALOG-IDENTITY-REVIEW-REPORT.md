---
id: "GENESIS-RAG-CATALOG-IDENTITY-REVIEW-REPORT"
version: "0.2.0b"
created_at: "2026-08-23T05:56:00+07:00, ATHER"
last_update: "2026-08-23T06:18:00+07:00, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Read-only graph-native atomic-product identity review from semantic and pricing catalog evidence"
  parent: "GENESIS-RAG-CATALOG-IDENTITY-REVIEW-SPEC"
  snapshot: "5488a37eec8819bf1b744e0a2e6b09e7b7afe832dbcda99cba53ff14859bc8e0"
  approval: "graph-native atomic ProductMaster and canonical SKU component edge approved by user, 2026-08-23; authority promotion pending"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Catalog — Graph-Native Atomic Product Identity Review Report

## 0. Decision summary

The review now treats the atomic product as the canonical identity and treats a
multi-item SKU as one `CatalogOffer` node with component edges. It is **not** a stock
report and does not change the active `family_v2` runtime or taxonomy authority.

Current result: **425 provisional atomic products**. Only 43 are internally consistent;
327 need owner/data review and 55 remain unclassified. The number is not production-ready.

## 1. Source and snapshot

| Source | Rows | Unique codes | SHA-256 |
|---|---:|---:|---|
| semantic catalog | 994 | 994 | `a5c6542066f160da5562a09475189c39179a32ea885bab56f13814c75f5b0eb2` |
| pricing catalog | 1,017 | 1,016 | `5399499d3031ed58be66c958c2ee98fc57401190ee6ddd0a7d40b315842544c2` |

The merged identity-review snapshot contains 1,016 source offers and has snapshot id
`5488a37eec8819bf1b744e0a2e6b09e7b7afe832dbcda99cba53ff14859bc8e0`. Semantic evidence
is read-only; the active pricing snapshot and `data/genesis_smartgift_store_family_v2`
remain unchanged.

## 2. Atomic identity counts

| Layer | Count | Meaning |
|---|---:|---|
| Atomic `ProductMaster` | 425 | Provisional original physical products/components |
| Auto atomic products | 43 | Deterministic evidence is internally consistent |
| Review-required atomic products | 327 | Physical, taxonomy, or component evidence needs review |
| Unclassified atomic products | 55 | Preserved as unknown product nodes; no safe category |
| `PhysicalVariant` | 1,126 | Product-level color/size/material/packaging combinations |
| `CustomizationProfile` | 1 | Supported set: screen logo, laser logo, message card |
| `CatalogOffer` / source SKU | 1,016 | Price, MOQ, source and provenance records |
| Single-product offers | 30 | Offers resolved directly to one atomic product |
| Set/bundle offers | 984 | One SKU with two or more component edges |
| Unclassified offers | 2 | Preserved but not safely decomposed |
| `CONTAINS_COMPONENT` links | 3,166 | SKU-to-atomic-product component relationships |
| Existing source families | 837 | Provisional family records in the merged input |

These counts are intentionally separate. A set SKU is not counted as another atomic
product, and an atomic product can occur in many set SKUs.

## 3. Graph relation counts

| Edge | Count | Direction |
|---|---:|---|
| `OFFERS` | 32 | `CatalogOffer -> ProductMaster` (30 single plus 2 unclassified direct links) |
| `CONTAINS_COMPONENT` | 3,166 | `CatalogOffer -> ProductMaster` |
| `HAS_VARIANT` | 1,126 | `ProductMaster -> PhysicalVariant` |
| `HAS_ATTRIBUTE` | 4,840 | `PhysicalVariant -> AttributeValue` |
| `SUPPORTS_CUSTOMIZATION` | 994 | `CatalogOffer -> CustomizationProfile` |

Each relationship is stored once. Reverse lookup uses incoming traversal or an indexed
adjacency lookup; no duplicate reverse edge and no SKU-id array is stored on product nodes.
The graph artifact contains 2,769 nodes and 10,158 edges.

## 4. Review signals

| Signal | Atomic product records |
|---|---:|
| Taxonomy assignment needs review | 240 |
| Physical anchor conflict | 281 |
| Missing component evidence | 150 |
| Missing physical evidence | 34 |
| Unclassified component | 55 |

Signals may overlap. Unknown components remain visible as unclassified nodes and edges;
they are not silently dropped from a set SKU.

## 5. Business interpretation

- A red and blue version of the same cup points to one `ProductMaster` and separate
  `PhysicalVariant` records.
- A SKU such as `mug + pen + USB` remains one `CatalogOffer` with three
  `CONTAINS_COMPONENT` edges.
- Searching an atomic product can return every set SKU that contains it by traversing
  the same edge in reverse query direction.
- Branding remains a customization relationship and does not create a new product.
- Source SKU remains necessary for price, MOQ, supplier and provenance resolution.

## 6. Local artifact and verification

The detailed row-level graph artifact is generated locally at
`data/catalog_identity_review_v1/identity-review.json` and is Git-ignored. The
generator is `scripts/build-catalog-identity-review.ts`.

Targeted graph-identity fixtures pass 5/5. Typecheck and build pass. The full repository
suite passes 290/292 tests with 0 failures and 2 environment-gated skips. Two replay
runs produce the same artifact SHA-256:
`87D473B870C133ABB6EBC4BAC1BC3B6D86FC7887D72BB6FAF3AFC683A985F36B`.

## 7. Activation boundary

This report authorizes no identity or category promotion. Until owner review is complete:

- active runtime remains on `family_v2`;
- `taxonomy_v3` remains `proposed`, `activated: false`, with zero approved categories;
- no source, price, offer, or inventory record is overwritten;
- no customer-specific logo is inferred from generic branding text;
- no stock-on-hand claim is made.

## References

- `docs/GENESIS-RAG-CATALOG-IDENTITY-REVIEW-SPEC.md`
- `docs/GENESIS-RAG-CATALOG-FAMILY-VARIANT-SPEC.md`
- `docs/GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN.md`
- `src/rag/catalog-identity.ts`
- `scripts/build-catalog-identity-review.ts`

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.2.0b | 2026-08-23 | candidate | Reported graph-native atomic ProductMaster counts and one-way SKU component edges | ATHER |
| 0.1.1b | 2026-08-23 | candidate | Refreshed identity evidence after attribute-extraction correction and recorded verification | ATHER |
| 0.1.0b | 2026-08-23 | candidate | Recorded the first read-only base-product, variant, customization, and offer identity review | ATHER |
