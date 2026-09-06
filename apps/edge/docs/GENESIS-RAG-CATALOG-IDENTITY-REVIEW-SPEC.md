---
id: "GENESIS-RAG-CATALOG-IDENTITY-REVIEW-SPEC"
version: "0.2.0b"
created_at: "2026-08-23T06:00:00+07:00, ATHER"
last_update: "2026-08-23T06:18:00+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Read-only original-product identity review for SmartGift catalog"
  parent: "GENESIS-RAG-CATALOG-FAMILY-VARIANT-SPEC"
  approval: "model approved by user, 2026-08-23; identity review remains non-authoritative"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Catalog — Graph-Native Atomic Product Identity Review

## 1. Decision

The system must not count source SKU rows or bundle combinations as atomic products.
The review projection uses one atomic-product registry and graph-native relationships:

```text
ProductMaster (atomic product)
  -> PhysicalVariant -> AttributeValue

CatalogOffer / SKU
  -> OFFERS -> ProductMaster                 (single-product offer)
  -> CONTAINS_COMPONENT -> ProductMaster[]  (set/bundle offer)
```

The projection is a read-only, versioned review artifact. It does not replace the
active `family_v2` catalog, does not promote taxonomy categories, and does not claim
stock-on-hand.

## 2. Identity semantics

| Layer | Meaning | Example | Count meaning |
|---|---|---|---|
| `ProductMaster` | Canonical atomic physical product/design lineage | one cup model | original product count |
| `PhysicalVariant` | Physical option within that product | red/blue, 350/500 ml | variant count |
| `CatalogOffer` | Source/commercial record | supplier SKU, price, MOQ | offer/SKU count |
| `CustomizationProfile` | Branding or customer artwork option | screen logo, laser logo | customization options, not products |
| `CONTAINS_COMPONENT` edge | A SKU-level set composition | cup + pen | component links, not products |

## 3. Deterministic grouping rules

### 3.1 Auto-group

Offers may point to the same `ProductMaster` only when all available evidence agrees on:

1. component signature;
2. physical anchor signature after removing explicit color, packaging, and commercial text;
3. material, capacity, dimensions, model, and construction where supplied;
4. no conflicting component or category evidence.

The source code is never an identity key. It remains an offer-level identity and is
always retained for price and provenance lookup. A source SKU with multiple explicit
components remains one `CatalogOffer` node with multiple `CONTAINS_COMPONENT` edges;
the set itself is not counted as another atomic `ProductMaster`.

### 3.2 Physical variants

The review extracts, when explicitly present:

- color and color option list;
- size/capacity and unit;
- material;
- model/shape/construction;
- packaging choice when it affects the offer.

Color differences alone do not create a new `ProductMaster`. A material, capacity,
dimension, model, or construction conflict creates a separate physical variant or a
`review_required` decision according to the evidence strength.

### 3.3 Customization

Supported branding methods such as screen logo, laser logo, and message card are
represented as `CustomizationProfile` options. A customer logo/artwork is an
order/quote configuration, not a new original product. The system must not infer a
customer-specific logo from the word `logo` when the source only describes a physical
feature such as a light-up logo power bank.

### 3.4 Separate or review

Keep products separate or send them to review when:

- component signatures differ;
- physical anchors conflict;
- the source only provides a generic name with insufficient evidence;
- a bundle composition is different;
- a color/size/material statement cannot be parsed deterministically.

LLM similarity alone is never a merge decision.

## 4. Graph-native identity and provenance

### 4.1 Stable keys

- `ProductMaster.productId` is the stable primary key for an atomic product.
- `PhysicalVariant.variantId` is the stable key for one physical attribute combination;
  its uniqueness is scoped by `productId` and its normalized attribute signature.
- `CatalogOffer.offerId` is the stable key for a source/commercial SKU; `sourceCode`
  remains unique within its source lineage.
- Colors, sizes, materials, and other properties are keyed beneath the product/variant;
  they are never keyed by source SKU alone.

### 4.2 Canonical edges

```text
(:CatalogOffer)-[:OFFERS]->(:ProductMaster)
(:CatalogOffer)-[:CONTAINS_COMPONENT {quantity, position, role, variantId}]->(:ProductMaster)
(:ProductMaster)-[:HAS_VARIANT]->(:PhysicalVariant)
(:PhysicalVariant)-[:HAS_ATTRIBUTE]->(:AttributeValue)
(:CatalogOffer)-[:SUPPORTS_CUSTOMIZATION]->(:CustomizationProfile)
```

Store each business relationship once, in one canonical direction. Reverse lookup uses
the incoming direction of the same edge or an indexed adjacency lookup; no duplicate
reverse edge and no `skuIds` array on `ProductMaster` is required.

`CatalogOffer` remains a node because price, MOQ, source code, dimensions, supplier
provenance, and source evidence belong to the SKU. A set SKU is identified by having
two or more component edges. Edge properties retain quantity, order/position, role,
variant constraint, evidence, and review status.

### 4.3 Search contract

Search first uses exact, full-text, or vector indexes over `ProductMaster` and
`PhysicalVariant` fields. It then performs bounded graph expansion to retrieve source
offers and set membership. Graph traversal is for relationship context; it does not
replace node indexes. Search must support both directions at the query layer without
duplicating stored edges.

## 5. Provenance and status

The review artifact carries:

- `reviewVersion`;
- catalog snapshot id and source hashes;
- source family ids, offer ids, and source codes;
- extracted evidence and rule reasons;
- `auto`, `review_required`, or `unclassified` status;
- a future owner decision may add a `manualDecisionId` without changing source offer identity.

The optional semantic catalog may supply description, component, color, and supported-branding
evidence for this review only. The active pricing catalog and `family_v2` store remain
the runtime/reference boundary.

## 6. Graph projection shape

The future governed projection uses bounded, explicit relationships:

```text
(:CatalogOffer)-[:OFFERS]->(:ProductMaster)
(:CatalogOffer)-[:CONTAINS_COMPONENT]->(:ProductMaster)
(:ProductMaster)-[:HAS_VARIANT]->(:PhysicalVariant)
(:PhysicalVariant)-[:HAS_ATTRIBUTE]->(:AttributeValue)
(:CatalogOffer)-[:SUPPORTS_CUSTOMIZATION]->(:CustomizationProfile)
```

No global branding supernode, duplicate reverse edge, or unbounded traversal is introduced. The first
implementation produces review evidence; authoritative graph edges remain gated.

## 7. Acceptance criteria

- red and blue versions of one cup resolve to one `ProductMaster` with separate variant evidence;
- a customer logo does not create another `ProductMaster`;
- price/source SKU remains a separate `CatalogOffer`;
- a set SKU links to every explicit atomic component with one directed edge per component;
- reverse traversal from an atomic product returns the set SKUs containing it;
- changed material, capacity, dimensions, construction, or component composition is not silently merged;
- ambiguous records are visible in `review_required` or `unclassified`;
- atomic-product, variant, customization, offer, and component-link counts are reported separately;
- active `family_v2`, pricing source, quote authority, delivery, and taxonomy activation remain unchanged;
- the same snapshot replays deterministically.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.2.0b | 2026-08-23 | beta | Replaced separate cross-link modeling with a graph-native atomic ProductMaster and canonical SKU component edges | ATHER |
| 0.1.1b | 2026-08-23 | beta | Clarified artifact-level versioning and future owner-decision metadata | ATHER |
| 0.1.0b | 2026-08-23 | beta | Approved original-product identity model and bounded read-only review contract | ATHER |
