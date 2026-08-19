---
domain: market-intelligence
module: src/modules/market-intelligence
owns_models: []
owns_code:
  - src/modules/market-intelligence/**
---

# Domain charter — market-intelligence

Market Intelligence owns Zuri's **translated external market state and derived market intelligence**: what external markets appear to be doing, with source lineage and confidence sufficient for another domain or a Human to act on it.

It is a Business capability domain inside the Zuri Modular Monolith. It does not own raw provider ingestion, canonical knowledge, internal stock or procurement execution.

Stable identities:

```text
Product domain:   DOM-MARKET-INTELLIGENCE
Technical owner:  TD-MARKET-INTELLIGENCE
Target route key: market
```

## Boundaries

- **Integration owns acquisition evidence.** `IntegrationProvider`, `IntegrationConnection`, `IntegrationCredential`, `IngestionRun`, `RawExternalRecord`, `SyncCursor`, `ExternalEntityRef` and `DeadLetterRecord` remain owned by the Integration domain / FR-081.
- Source-specific Facebook/retailer/marketplace acquisition logic is an Integration adapter. This domain consumes eligible raw-record references through a translation contract; it never creates a second raw-ingestion/secret/cursor/dead-letter stack.
- **Knowledge/GKS owns canonical knowledge.** Canonical Product/Brand/Category identity and governed aliases are resolved through the Knowledge contract. A market observation may remain unresolved and may emit a KnowledgeCandidate; it never silently promotes itself.
- **Commerce owns operational commerce state.** Internal Product/SKU, Inventory, approved Vendor and Procurement execution remain Commerce authority.
- `SupplierCandidate` is external market evidence, not an approved Vendor.
- `Procurement Intelligence` is downstream under Commerce/Procurement and may consume this domain's read contracts. This domain never creates RFQ/PO/GRN or changes stock.
- Marketing may consume competitor/demand/category signals but does not own them merely because a campaign uses them.
- Business Home may project read-only Market health/opportunity signals but owns none of the underlying records.
- Agent may query/operate only through explicit tools/application contracts and is never a database superuser.
- Private/authenticated source evidence preserves its source visibility/legal scope. Translation does not make private evidence globally public.

## Owned concepts (target; models land only with an approved global implementation requirement)

The charter reserves the semantic lane, not Prisma tables that do not yet exist. Candidate owned concepts are:

- `MarketObservation`
- `ExternalOffer` / `ExternalListing`
- `PriceObservation`
- `AvailabilityObservation`
- `PromotionObservation`
- `DemandSignal`
- `SupplierCandidate`
- `CompetitorSignal`
- `CategoryMarketSignal`
- `MarketSnapshot`
- `MarketResearchRun`
- `Watchlist`
- `WatchRule`
- `MarketAlert`

When a model is added, this frontmatter SHALL be updated in the same implementation slice so preflight can enforce unique model ownership. Until then `owns_models: []` is truthful.

## Capability map

```text
Market Intelligence
├── Price Intelligence
├── Demand Intelligence
├── Supplier Intelligence
├── Competitive Intelligence
├── Category Intelligence
├── Market Research
├── Market Search
├── Watch & Alerts
└── Market Observation / Provenance Core
```

These are subdomains/capabilities of one product domain, not peer Tier-2 domains.

## Public contract direction

The following names describe the intended boundary; they are not committed code signatures until global FRs authorize implementation:

```text
translateRawRecord(rawExternalRecordRef)
searchMarket(query)
getCurrentPrices(productRef, scope)
getPriceHistory(productRef, scope)
getSupplierCandidates(productRef, scope)
getDemandSignals(scope)
getCategorySnapshot(categoryRef, scope)
getCompetitorSignals(scope)
evaluateWatchRule(ruleId, observationId)
runResearch(request)
```

Cross-domain consumers call these contracts/read models rather than writing Market-owned tables directly.

## Evidence invariant

Every material derived market fact must be able to answer:

```text
What did we observe?
From which source/raw record?
When was it observed?
How was it translated/resolved?
How confident are we?
Is this observed, normalized, inferred or recommended?
```

A record that cannot answer those questions is not fit to drive price, supplier, competitor, demand or research intelligence.

## Runtime topology

Long-running polling/browser/translation work may execute in a separate worker **process** while remaining one Zuri codebase/release and using the same Integration + Market application contracts. A worker is not an independently owned service.

## Related state

- SRS: `docs/domains/market-intelligence/SRS.md`
- Architecture decision: `docs/decisions/ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md`
- Context map: `docs/domains/market-intelligence/CONTEXT-MAP.md`
- Persistent initiative state: GitHub issue #74
