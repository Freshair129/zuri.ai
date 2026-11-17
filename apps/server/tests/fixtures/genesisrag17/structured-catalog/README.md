# Structured catalog fixture — genesisrag17 raw entrypoint

Frozen, **synthetic** fixture for the structured-record source adapter before
Stage 1 of the 17-stage knowledge ingestion pipeline (`genesisrag17.v1`,
ADR-073). Every name, price, model code, dimension and provenance value is
invented; ids (`PM-*`, `PKG-*`) and record shapes are kept so tests run the
real parser, policy and admission paths.

- `products.json` — 5 ProductMaster records with price tiers.
- `bundles.json` — 2 BundleOffer records with a bill of components.
- `pricelist.json` — 15 PriceListEntry rows (3 quantity tiers for the 5 products).
- `manifest.json` — record counts, SHA-256 and sizes of the three files.

The persisted values `SMARTGIFT_CATALOG` (provider), `SMARTGIFT_CATALOG_V1`
(format) and the `smartgift-catalog:` source-key prefix are unchanged by
ADR-119; they are identifiers the pipeline stores, not content.
