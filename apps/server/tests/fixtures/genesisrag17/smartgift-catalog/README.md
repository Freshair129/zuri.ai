# SmartGift catalog fixture — genesisrag17 raw entrypoint

Frozen, PII-free fixture for the proposed FR-187 "structured-record source
adapter before Stage 1", which will feed SmartGift catalog records into the
17-stage knowledge ingestion pipeline (`genesisrag17.v1`, ADR-073). It exists
so Phase 1/2 tests of that adapter can run from a raw entrypoint without
touching the live `business-01-smart-gift` repository.

## Provenance

All content is a subset of four files under
`business-01-smart-gift/data-pipeline/02_prepared/`:

- `ProductMaster.json` — canonical product identity, SRP price tiers, and the
  FlowAccount factory model code (`factory_product_code`) for 5 products.
- `BundleOffer.json` — 2 canonical gift-set/bundle records, each with a BOM
  (`price_reference.component_srp_qty1_reference`) that lists the 5 products
  above by quantity and SRP.
- `pricelist_master.json` — `srp_qty_comparisons`, filtered to 3 quantity
  tiers (1 / 100 / 500) for the same 5 products.
- `smartgift_catalog_master.json` — supplementary dimensions (`dimensions_cm`)
  and unit weight (`unit_weight_kg`) for the same 5 products. `material` and
  `color` were checked but are `"generic"` / `"unspecified"` for every one of
  these 5 products in this file, so they were omitted rather than kept as
  empty/uninformative values.

`CatalogOffer.json` was read as a cross-reference only (see "Why TMS06-3 and
TMS06-4 are documented but not included" below); none of its content is
reproduced in this fixture.

Exact upstream sha256, byte size, and the git commit that last touched each
file are recorded in `manifest.json`, alongside a check against
`data-pipeline/01_raw/exports_registry.json`,
`factory_cost_registry.json` and `pricing_formula_registry.json` (none of the
four 02_prepared files above have a registry entry — those registries track
raw `01_raw` exports and pricing-formula documents, not derived/prepared
outputs; they do independently confirm `tenant_id=Org-EtohGroup`,
`business_id=SmartGift`).

`data-pipeline/01_raw/05_crm_customer_data/` was never read to build this
fixture, and nothing under it is reproduced here, directly or indirectly.

## What was kept and what was stripped

**Kept:** canonical product code, Thai/English names, category, product
family, FlowAccount factory model code (for example `BW00-0`), dimensions in
cm, unit weight in kg, SRP price tiers (THB), bundle code/name/occasion/gift
tier/recipient segment, BOM components (product + qty + SRP), and bundle-level
offer price tiers.

**Stripped (Zero-PII / zero-cost invariant — see below):**

- Any factory/base cost: `base_cost`, `factory_provenance.exw_cost_thb`,
  `factory_provenance.exw_price`, `factory_unit_cny`.
- Landed cost: `total_landed_cost_thb`, `delivered_unit_cost`.
- Margin/profit: `margin_percent`, `unit_profit`, every
  `*_gross_margin_pct` / `*_gross_profit_*` column.
- Freight/logistics cost: `freight_*`, `sea_freight_thb`,
  `domestic_freight_thb`, `logistics_freight_est`, and the rate-bearing parts
  of `packaging_carton` (freight/CBM rates — dimensions/weight were kept,
  rates were not).
- Supplier and internal-reviewer identity: `factory_provenance.note`,
  `factory_provenance.mapping_confirmed_by` (an internal reviewer name),
  `factory_provenance.confidence`, and the cost-registry source file
  references inside `factory_provenance`.
- Anything customer-related: no customer name, contact, quotation, or
  purchase history was read or copied. `data-pipeline/01_raw/05_crm_customer_data/`
  was never opened.

Nothing was invented: a field present in the upstream record but not listed
above as "kept" was dropped, not synthesized; a field that was itself absent
upstream was simply not written. One borderline case: `packaging_carton`
dimensions were considered and excluded in full, rather than keeping the box
dimensions and stripping only the freight rate, to keep the strip boundary
unambiguous — see the final task report for that and other uncertain cases.

### Zero-PII invariant, cited

This mirrors `business-01-smart-gift`'s own boundary, not an invention of
this fixture:

- `docs/ZURI_ECOSYSTEM_BOUNDARIES.md` §3.1 ("ขอบเขตความปลอดภัยของข้อมูลลูกค้า
  (Zero-PII Invariant ใน Vector Vault)"): the product/catalog vault may hold
  product data only — never customer names, phone numbers, addresses, or
  financial history.
- `pipeline/knowledge_registry/core.py`, `DENIED` pattern:
  `05_crm_customer_data|customer|contact|quotation|ลูกค้า|ใบเสนอราคา`. This
  fixture was grepped against that same pattern after being written (see the
  final task report for the grep and its result).

## Why TMS06-3(P-06) and TMS06-4(P-16) are documented but not included

`TMS06-3(P-06)` and `TMS06-4(P-16)` are real, named FlowAccount SKUs —
documented in `business-01-smart-gift/docs/specs/TMS06-3-PRICING-CATALOG-INFOGRAPHIC-2026-09-10.md`
and the `TMS06-4` counterpart, and present as raw offer codes
(`OFFER_TMS06-3`, `OFFER_TMS06-4`) in `CatalogOffer.json`'s
`source_projection`. They were not turned into a bundle record here because,
within the four permitted `02_prepared` files, neither has a non-empty BOM or
SRP tier set: `BundleOffer.json`'s `bom` array (the only structured,
already-cost-annotated BOM source) has no rows referencing either offer, and
`CatalogOffer.json`'s own `price_rows` / `price_comparisons` and its raw
`source_projection` entries both carry `source_price_tiers: []` for these two
codes. Building a bundle record for them would have meant inventing component
or price data, which task rule 2 forbids.

`BW00-0(P-BAG)` is included, faithfully: it is the `flowaccountModelCode`
(upstream `factory_product_code`) of canonical product `PM-TMB` (Thermal
Tumbler SUS316) in `ProductMaster.json`, with `factory_match_status:
"confirmed_supplier_mapping"`. `PM-TMB` is in `products.json` and is a BOM
component of the `PKG-NY-2027-REACH-OPS` bundle in `bundles.json`.

## Files

- `products.json` — 5 `ProductMaster` records (`PM-BOTTLE-LED`, `PM-NB`,
  `PM-PB10K`, `PM-PEN`, `PM-TMB`).
- `bundles.json` — 2 `BundleOffer` records (`PKG-XMAS-2026-SIGNATURE-CLEVEL`,
  `PKG-NY-2027-REACH-OPS`), each with a `components` BOM referencing the
  products above.
- `pricelist.json` — 15 `PriceListEntry` records: the 5 products above at 3
  quantity tiers each (1 / 100 / 500).
- `manifest.json` — per-file sha256/size/record count, upstream file
  sha256/size/git commit, registry lookups, and the intended scope.

## Intended mapping: one record to one RawExternalRecord

Per the flow doc, each record in `products.json` / `bundles.json` /
`pricelist.json` becomes exactly one `RawExternalRecord` row (`payloadJson`
= the canonical JSON of that record, `entityType`/`externalId` as shown,
`provider` = `SMARTGIFT_CATALOG`) and exactly one `KnowledgeRawArtifact`
row derived from it (`content` = the frozen byte-stable JSON text of the
record, `contentHash` = sha256 of that text, `sourceId` =
`smartgift-catalog:<file>`, `version` = `manifest.json`'s `fixtureVersion`).
Bytes are frozen: `manifest.json` pins the sha256 and byte size of each of
the three fixture files, so a Stage 1 test can assert the ingested
`KnowledgeRawArtifact.contentHash` against a value fixed at fixture-build
time, not recomputed from a mutable file.

Intended scope for the adapter (see `manifest.json.scope`): tenant
`Org-EtohGroup`, business `SmartGift`, source provider `SMARTGIFT_CATALOG`,
classification `product_metadata`. These are the business-facing names
`business-01-smart-gift` itself uses for `tenant_id`/`business_id`
(confirmed in `factory_cost_registry.json` and
`pricing_formula_registry.json`); the adapter resolves them to zuri-ai's
runtime `genesisrag17.v1` scope object
(`portfolioId`/`tenantId`/`businessId`/`workspaceId`/`agentId`/`visibility`,
per `apps/server/src/modules/knowledge/genesisrag17-contract.js`) at
ingestion time — this fixture does not assign runtime UUIDs.

## Five query questions this fixture should answer, with citations

1. Which components make up the `PKG-XMAS-2026-SIGNATURE-CLEVEL` gift set,
   and what is each component's SRP at quantity 1? — answered from
   `bundles.json`'s `components` array (`PM-NB` 750 THB, `PM-PB10K` 690 THB,
   `PM-PEN` 190 THB), each component traceable back to its own record in
   `products.json`.
2. What is the SRP unit price of `PM-TMB` (FlowAccount model `BW00-0`) at a
   quantity of 500? — answered from `pricelist.json`'s
   `PM-TMB@qty500` record (200 THB) and cross-checked against
   `products.json`'s `PM-TMB.priceTiersThb` entry for `minQty: 500`.
3. What is the FlowAccount factory model code for the Thermal Tumbler
   SUS316, and which bundle includes it? — answered from
   `products.json`'s `PM-TMB.flowaccountModelCode` (`BW00-0`) and
   `bundles.json`'s `PKG-NY-2027-REACH-OPS.components`.
4. What are the physical dimensions and unit weight of the MagSafe Wireless
   Powerbank 10000mAh (`PM-PB10K`)? — answered from `products.json`'s
   `PM-PB10K.dimensionsCm` (10.5 x 6.8 x 1.6 cm) and `unitWeightKg` (0.22 kg).
5. At what quantity does the `PKG-XMAS-2026-SIGNATURE-CLEVEL` bundle's own
   offer price per set drop to 820 THB? — answered from `bundles.json`'s
   `PKG-XMAS-2026-SIGNATURE-CLEVEL.offerPriceTiersThb` (`minQty: 100` maps to
   `unitPriceThb: 820`).

Every answer above is contained entirely within `products.json`,
`bundles.json` and `pricelist.json` — no external lookup is required.
