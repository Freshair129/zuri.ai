---
version: "0.1.0"
created_at: "2026-08-20T00:20:00+07:00,ChatGPT"
last_update: "2026-08-20T00:20:00+07:00,ChatGPT"
status: "accepted"
superseded_by: null
attributes:
  domain: "market-intelligence"
  doc_type: "architecture-decision"
  scope: "Market Intelligence product-domain boundary, integration/GKS/commerce ownership, navigation identity and modular-monolith runtime shape"
---

# ADR-038 — Market Intelligence is a first-class Zuri domain inside the Modular Monolith

**Status:** Accepted architecture boundary. Runtime implementation is not authorized without global requirement IDs and tests.

**Decided by:** Boss (owner), captured from issue #74 and the approved continuation of that work.

**Relates to:** ADR-025 (domain-driven documentation), ADR-029 (stable product/technical domain identities), FR-081 (raw external ingestion), `docs/domains/integration/CHARTER.md`, `docs/domains/knowledge/CHARTER.md`, `docs/domains/market-intelligence/SRS.md`, `docs/SITEMAP-DOMAIN-NAV.md`.

**Amends:** ADR-029 D2 by adding `DOM-MARKET-INTELLIGENCE` to the product-domain catalog. It does not change any existing domain ID.

## Context

Zuri needs to observe external markets: public/private listings, retail prices, promotions, availability, supplier candidates, competitor changes, demand signals and category movement. The first concrete scenarios are a used-product watch (for example RTX 3060 under a target price) and cross-retailer unit-price comparison.

Two bad decompositions were considered during design:

1. making Facebook, Lotus's, Shopee and other sources separate business domains/services;
2. putting all market collection, raw evidence, canonical product knowledge and procurement execution into one Market module.

Both violate existing Zuri boundaries. Zuri is a Domain-Driven Modular Monolith; Integration already owns raw external ingestion and connection state (FR-081), Knowledge/GKS owns governed canonical knowledge, and Commerce/Procurement owns purchasing execution.

The missing capability is the layer between raw external evidence and business action: **translated external market state plus derived intelligence**.

## Decision

### D1 — Add one first-class Product Domain: Market Intelligence

The accepted product-domain catalog gains:

```text
DOM-MARKET-INTELLIGENCE
route key: market
display label: Market Intelligence
technical owner: TD-MARKET-INTELLIGENCE
```

The stable ID is the identity. `market` and `Market Intelligence` are projections and may change only under the existing label/route governance rules; they are not foreign keys.

Market Intelligence is a peer Business capability domain alongside Commerce, CRM, Marketing, Operations, HR / People and Development. Business Home remains a non-owning projection and Platform remains the system/configuration domain.

### D2 — The six intelligence families are capabilities inside this domain, not six more Tier-2 domains

The Market Intelligence domain contains:

```text
Price Intelligence
Demand Intelligence
Supplier Intelligence
Competitive Intelligence
Category Intelligence
Market Research
```

plus shared Market Search, Watch & Alerts, and Market Observation / Provenance capability.

Creating a Tier-2 domain for each would split one evidence model and one source graph into arbitrary UI boundaries and make cross-analysis depend on domain-to-domain plumbing with no ownership benefit.

### D3 — Integration owns acquisition and raw evidence

Existing Integration authority is unchanged.

Integration owns provider/connection/credential metadata, ingestion runs, raw records, cursors, external refs and dead letters. Market sources such as Facebook, Lotus's, 7-Eleven, Makro, Big C, Shopee, Lazada and TikTok Shop are **Integration provider adapters**.

Canonical flow:

```text
External Source
   ↓
Integration Provider Adapter
   ↓
RawExternalRecord                (Integration authority)
   ↓
Market translation contract
   ↓
MarketObservation                (Market Intelligence authority)
```

Market Intelligence must not create a second raw-ingestion store, secret manager, cursor store or dead-letter path.

### D4 — Market Intelligence owns translated market observations and derived signals

`TD-MARKET-INTELLIGENCE` is the technical owner of translated market state such as:

- MarketObservation;
- ExternalOffer / ExternalListing;
- PriceObservation;
- AvailabilityObservation;
- PromotionObservation;
- DemandSignal;
- SupplierCandidate and supplier-market signals;
- CompetitorSignal;
- CategoryMarketSignal;
- MarketSnapshot;
- MarketResearchRun;
- Watchlist / WatchRule / MarketAlert state.

Every derived record keeps lineage to its source evidence where available. Reprocessing may correct translated market state; it never rewrites what Integration actually received.

### D5 — Knowledge/GKS remains canonical identity authority

Market Intelligence may extract a candidate such as `ASUS 3060 Dual 12GB` and resolve it through the Knowledge/GKS contract, but it does not become the owner of canonical Product, Brand, Category or semantic alias truth merely because it observed the string externally.

An unresolved candidate is valid. A probabilistic match carries confidence. External evidence may become a KnowledgeCandidate, but canonical promotion follows the existing governed Knowledge process.

### D6 — Procurement Intelligence stays under Commerce / Procurement

Supplier Intelligence asks:

> Who appears able to supply this product, at what observed market terms?

Procurement Intelligence asks:

> Given our inventory, demand, budget, approved vendor policy and market evidence, what should this Business buy and how?

The first belongs to Market Intelligence. The second remains Commerce / Procurement and may consume Market Intelligence through public contracts/read models.

Market Intelligence never directly approves a Vendor, creates a Purchase Order, receives goods or mutates stock.

### D7 — Navigation is reserved before routes exist

The target Tier-2 navigation projection is:

```text
Market Intelligence
├── Dashboard
├── Market Search
├── Prices
├── Demand
├── Suppliers
├── Competitors
├── Categories
├── Research
└── Watchlists
```

`DOM-MARKET-INTELLIGENCE` may be documented in the stable product-domain catalog immediately. Runtime `src/config/domains.js` wiring and pages/routes are **not** authorized by this ADR alone: the implementation slice must first reserve global FR/SDD/SEC/NFR identifiers and add route/code tests under AGENTS.md §16–18.

Until that slice ships, the domain is a planned/disabled module rather than a fake clickable surface.

### D8 — Worker process is an execution topology, not a microservice boundary

Polling, browser automation or heavy translation may run in a Zuri worker process:

```text
ONE ZURI CODEBASE / RELEASE
        ├── Web runtime
        └── Worker runtime
               ↓
        same Integration + Market application contracts
               ↓
        same domain ownership model
```

A worker does not get its own business truth or private network API by default. Extraction to a service requires the real operational triggers already named by the Modular Monolith architecture (independent load, deployment cadence, security/compliance, availability or ownership), not architectural fashion.

### D9 — GitHub issue #74 is the initiative state anchor

Issue #74 records architecture state, active PR/branch and the implementation backlog. Follow-up issues must reference #74. Future sessions should recover state from GitHub rather than reconstruct architecture from chat memory.

Global `FR-*` / `NFR-*` / `BR-*` / `SEC-*` / `SDD-*` IDs are reserved **per authorized implementation slice**, not by inventing domain-local FR families. The SRS therefore uses `MI-RQ-*` local clause identifiers only.

## Context map

```text
                    ┌─────────────────┐
                    │  Knowledge/GKS  │
                    │ canonical truth │
                    └────────▲────────┘
                             │ resolve / candidate
                             │
Integration ── raw evidence ─► Market Intelligence
                             │
                 ┌───────────┼────────────┐
                 ▼           ▼            ▼
              Commerce    Marketing   Business Home
                 │
                 ▼
          Procurement Intelligence
                 │
                 ▼
            RFQ / PO / GRN
```

Agent is a consumer/orchestrator through approved tools; it owns none of the Market records.

## Consequences

- Zuri gains a market-facing intelligence lane without introducing microservices.
- Existing Integration investment (FR-081) becomes the acquisition substrate rather than being duplicated.
- Product/category identity remains governed by GKS instead of being source-dependent.
- Procurement can use market evidence without allowing crawlers or market parsers to write operational purchasing state.
- Source failures can degrade market freshness while CRM, Commerce, Projects and other core Zuri capabilities remain available.
- Cost accepted: Phase 0 creates a real architectural/domain lane before runtime pages exist. Runtime navigation remains disabled until an implementation FR makes it truthful.

## Alternatives rejected

**One service/repository per source.** Rejected: premature microservices, duplicated acquisition infrastructure and no business-domain ownership benefit.

**Put Market Intelligence under Commerce only.** Rejected: competitor, demand, category and research signals are also consumed by Marketing and Business Home; Commerce is a major consumer, not the owner of the external-market truth.

**Put Competitive Intelligence under Marketing.** Rejected: competitor price/assortment signals also drive procurement, pricing and strategy.

**Let Market Intelligence own raw ingestion.** Rejected: FR-081 and the Integration charter already own the raw evidence/replay boundary.

**Let Market Intelligence own canonical Product identity.** Rejected: the Knowledge charter already defines product identity as governed canonical knowledge.
