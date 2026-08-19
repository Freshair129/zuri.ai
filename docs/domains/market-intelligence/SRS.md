---
domain: market-intelligence
stable_domain_id: DOM-MARKET-INTELLIGENCE
status: proposed
version: 0.1.0
date: 2026-08-20
architecture: domain-driven-modular-monolith
state_issue: 74
---

# SRS — Market Intelligence Domain

**System:** Zuri AI  
**Repository:** `Freshair129/zuri.ai`  
**Document type:** Software Requirements Specification  
**Domain:** Market Intelligence  
**Stable domain ID:** `DOM-MARKET-INTELLIGENCE`  
**Status:** Proposed  
**Version:** Draft v0.1

## 1. Purpose

This document defines the software requirements for the **Market Intelligence** domain inside Zuri.

Market Intelligence observes, normalizes, preserves, searches and analyzes external market signals so Zuri can answer questions such as:

- What is the current observed market price of a product?
- Has a new matching product listing appeared?
- Which supplier candidates are offering a product and at what observed terms?
- Are competitors changing price, promotion or assortment?
- Is demand for a category rising or falling?
- Is the current price unusual compared with recent history?
- Which market evidence supports a business recommendation?

Initial source classes include Facebook Groups / Marketplace, Lotus's, 7-Eleven, Makro, Big C, Shopee, Lazada, TikTok Shop, external APIs, open-data feeds, files and approved manual imports.

## 2. Architectural constraints

Market Intelligence SHALL conform to Zuri's Domain-Driven Modular Monolith architecture.

The domain SHALL:

- live in the Zuri codebase;
- expose explicit application/module contracts;
- own writes to its operational data;
- use approved cross-domain contracts, projections or read models;
- support in-process domain events initially;
- remain extractable later only if a real scaling, security, availability or deployment requirement justifies extraction.

The domain SHALL NOT require an independent network microservice for ordinary intra-Zuri calls.

External market sources SHALL be implemented as **integration adapters**, not product domains and not autonomous owners of market truth.

Long-running collection MAY execute in a separate worker process while remaining part of the same Zuri application, release, domain model and persistence authority.

## 3. Domain mission and boundary

Market Intelligence answers:

> What is happening in the external market, what evidence supports it, and what signals can Zuri derive from it?

It is primarily an **Observe + Understand** domain.

Commerce / Procurement remains responsible for **Decide + Execute** business operations such as approved vendors, purchase requests, RFQs, purchase orders, goods receipt and inventory mutation.

### 3.1 Market Intelligence owns

Market Intelligence SHALL own the business meaning and write authority for:

- MarketSource configuration references and source health state;
- RawObservation references / retained evidence metadata;
- MarketObservation;
- ExternalOffer / ExternalListing;
- PriceObservation;
- AvailabilityObservation;
- PromotionObservation;
- DemandSignal;
- SupplierCandidate and supplier market signals;
- CompetitorSignal;
- CategoryMarketSignal;
- MarketSnapshot;
- MarketResearchRun;
- Watchlist;
- WatchRule;
- MarketAlert state;
- MarketEvidence and Provenance;
- market-derived metrics and projections.

### 3.2 GKS owns canonical knowledge

GKS remains the authority for governed canonical knowledge, including canonical product identity, canonical brand identity, governed category taxonomy, semantic aliases and validated entity relationships.

Market Intelligence MAY resolve observations against GKS and MAY emit a `KnowledgeCandidate`, but SHALL NOT silently promote unverified external data into canonical GKS knowledge.

Required flow:

```text
External Observation
        ↓
Market Intelligence
        ↓
Knowledge Candidate
        ↓
Validation / Governance
        ↓
GKS Canonical Knowledge
```

### 3.3 Commerce / Procurement owns execution

Commerce SHALL remain authority for internal operational commerce entities such as internal products/SKUs, inventory, warehouses, approved vendors and procurement transactions.

`Procurement Intelligence` SHALL remain under Commerce / Procurement. It MAY consume Market Intelligence but Market Intelligence SHALL NOT directly create purchase orders, approve vendors or mutate inventory.

## 4. Subdomains and capabilities

`DOM-MARKET-INTELLIGENCE` SHALL contain these major capabilities:

1. **Price Intelligence** — current and historical observed pricing, normalization, distribution, anomaly and market-value evidence.
2. **Demand Intelligence** — external demand signals plus approved aggregated internal signals.
3. **Supplier Intelligence** — discovery and evaluation signals for supplier candidates before vendor approval.
4. **Competitive Intelligence** — competitor pricing, promotion, product and assortment movement.
5. **Category Intelligence** — market analysis above an individual product/SKU.
6. **Market Research** — evidence-backed analytical runs over governed Market Intelligence data.
7. **Market Search** — unified structured and semantic discovery over eligible market observations.
8. **Watch & Alerts** — saved watchlists, rules, matching, deduplication and notification triggers.
9. **Market Observation Core** — source, evidence, provenance, temporal history, normalization and resolution boundaries shared by all capabilities.

## 5. Core information model

Conceptual model:

```text
MarketSource
    │
    └── RawObservation
            │
            ▼
      MarketObservation
            │
     ┌──────┼──────────────┐
     ▼      ▼              ▼
   Offer   DemandSignal   MarketSignal
     │
     ├── PriceObservation
     ├── AvailabilityObservation
     ├── PromotionObservation
     ├── Seller / Supplier Candidate
     └── Location

MarketObservation
    ├── CanonicalProductRef? → GKS
    ├── CategoryRef?         → GKS
    └── BusinessScope
```

An adapter reports **what it observed**. It SHALL NOT independently declare a canonical Zuri product identity.

## 6. Functional requirements

### 6.1 Domain registration and scope

**FR-MI-001 — Domain registration**  
The system SHALL register `DOM-MARKET-INTELLIGENCE` as a stable Zuri product-domain identity.

**FR-MI-002 — Route and label**  
The proposed route key SHALL be `market` and proposed display label SHALL be `Market Intelligence`, subject to the accepted navigation ADR.

**FR-MI-003 — Per-Business enablement**  
Market Intelligence SHALL support per-Business enablement through Zuri's domain/module registry.

**FR-MI-004 — Business isolation**  
Business-owned watchlists, private observations, research runs, source configuration references, rules and alerts SHALL enforce Zuri authorization/isolation boundaries.

### 6.2 Source integration

**FR-MI-010 — Source registry**  
The system SHALL maintain a registry of configured Market Sources including source identity, source type, provider, supported capabilities, collection mode, health state and authentication reference where applicable.

**FR-MI-011 — Common adapter contract**  
All market-source adapters SHALL expose a common application-facing contract equivalent to:

```text
validateConfiguration()
collect()
fetchNext()
checkpoint()
healthCheck()
```

Source-specific implementation details SHALL NOT leak into Market Intelligence domain logic.

**FR-MI-012 — Collection modes**  
The platform SHALL support appropriate combinations of API, webhook, polling, browser automation, file import and manual import subject to provider policy and authorization.

**FR-MI-013 — Scheduled collection**  
Polling sources SHALL support configurable scheduled collection through Zuri worker/job infrastructure.

**FR-MI-014 — Checkpointing**  
Adapters SHOULD maintain cursor/checkpoint state where supported to reduce duplicate or unnecessary collection.

**FR-MI-015 — Retry and idempotency**  
Temporary source failures SHALL support controlled retries and SHALL NOT create duplicate logical observations.

**FR-MI-016 — Source health**  
The system SHALL represent source status such as `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `AUTH_REQUIRED` and `RATE_LIMITED`.

### 6.3 Observation, evidence and provenance

**FR-MI-020 — Observation-first ingestion**  
All external market input SHALL first enter Market Intelligence as an observation/evidence record before derived intelligence is produced.

**FR-MI-021 — External reference**  
Every observation SHALL retain an external identity/reference when the source provides one.

**FR-MI-022 — Provenance**  
Every material structured observation SHALL identify source, observed time, captured time, source reference, confidence and evidence; parser/adapter version SHALL be retained where relevant.

**FR-MI-023 — Raw evidence**  
The system SHALL retain enough original evidence or an evidence reference to audit/reproduce extraction where policy permits.

**FR-MI-024 — Temporal history**  
Historical observations required for analysis SHALL NOT be destructively overwritten.

**FR-MI-025 — Data freshness**  
The system SHALL expose freshness/last-observed metadata and SHALL NOT describe polled data as real-time unless the source guarantees real-time delivery semantics.

### 6.4 Entity resolution

**FR-MI-030 — Candidate extraction**  
The system SHALL extract product/entity candidates from structured or unstructured source records.

**FR-MI-031 — Alias resolution**  
Resolution SHALL support aliases and alternative spellings such as `RTX3060`, `RTX 3060`, `3060 12GB` and source-specific titles.

**FR-MI-032 — GKS resolution**  
Where governed identity exists, Market Intelligence SHALL resolve product/category identity through GKS or its approved contract.

**FR-MI-033 — Resolution confidence**  
Entity resolution SHALL produce a confidence level where matching is probabilistic.

**FR-MI-034 — Unresolved state**  
The system SHALL permit an unresolved product/entity state rather than force an incorrect canonical match.

### 6.5 Offer and listing intelligence

**FR-MI-040 — External offer model**  
An ExternalOffer SHALL support source, external reference, product candidate, optional canonical product reference, seller candidate, location, intent, condition, quantity, price, availability, promotion, source URL/reference and observation times.

**FR-MI-041 — Listing intent**  
Marketplace/classified content SHOULD distinguish at least `SELL`, `BUY_WANTED`, `TRADE` and `UNKNOWN`.

**FR-MI-042 — Condition**  
Where applicable, offers SHALL support `NEW`, `USED`, `REFURBISHED`, `OPEN_BOX` and `UNKNOWN`.

**FR-MI-043 — Offer change tracking**  
The system SHOULD detect material changes to a previously observed offer, including price, availability or status changes.

### 6.6 Price Intelligence

**FR-MI-050 — Price observation**  
A PriceObservation SHALL support amount, currency, quantity, unit, price type, promotion state and observed time.

**FR-MI-051 — Unit normalization**  
The system SHALL calculate normalized unit price when quantity/unit information is sufficient.

**FR-MI-052 — Historical price**  
The system SHALL expose eligible price history by product/variant, source, seller and location where data exists.

**FR-MI-053 — Price distribution**  
The system SHOULD calculate minimum, maximum, median, percentile and sample count for comparable observations.

**FR-MI-054 — Fair-market estimate**  
The system MAY calculate a fair-market estimate but SHALL expose evidence/sample size and confidence sufficient to distinguish it from an observed fact.

**FR-MI-055 — Price anomaly**  
The system SHOULD detect materially unusual prices relative to comparable observations.

### 6.7 Availability and promotion

**FR-MI-060 — Availability**  
Availability SHALL support `IN_STOCK`, `OUT_OF_STOCK`, `LIMITED` and `UNKNOWN` when source evidence allows.

**FR-MI-061 — Availability history**  
Availability history SHOULD be retained when useful for intelligence.

**FR-MI-062 — Promotion observation**  
The system SHOULD model discounts, member prices, bundles and promotion validity separately from ordinary price where source evidence permits.

### 6.8 Watch and alerts

**FR-MI-070 — Watchlists**  
Authorized users SHALL be able to create Business-scoped Watchlists.

**FR-MI-071 — Watch rules**  
WatchRule SHALL support combinations of product/category, keyword, listing intent, condition, price threshold, location/distance, seller/supplier, source, promotion, availability and confidence threshold.

Example:

```text
Product = RTX 3060
Intent = SELL
Condition = USED
Price <= 5500 THB
Distance <= 30 km
Exclude = RTX 3060 Ti
```

**FR-MI-072 — Matching methods**  
Rules MAY combine exact matching, aliases, fuzzy matching, semantic matching and structured filters.

**FR-MI-073 — Duplicate alert suppression**  
The same logical item SHALL NOT repeatedly alert a user unless a configured material change occurs.

**FR-MI-074 — Zuri Notification integration**  
Alerts SHALL use Zuri's approved Notification capability/channels; Market Intelligence SHALL NOT implement independent per-source notification stacks.

**FR-MI-075 — Material-change triggers**  
Rules MAY trigger on new listings, price drops, restock, new supplier candidates, competitor promotions, demand spikes or category anomalies.

### 6.9 Supplier Intelligence

**FR-MI-080 — Supplier candidate**  
Market Intelligence SHALL maintain external SupplierCandidate identity separately from a Commerce-approved Vendor.

**FR-MI-081 — Supplier evidence**  
SupplierCandidate analysis MAY use observed pricing, product coverage, availability, geography, lead-time evidence, capacity evidence and historical reliability evidence.

**FR-MI-082 — Supplier handoff**  
An authorized workflow SHALL be able to hand a SupplierCandidate to Commerce / Procurement for vendor review; Market Intelligence SHALL NOT approve the vendor itself.

### 6.10 Competitive Intelligence

**FR-MI-090 — Competitor registry**  
Authorized Business users SHALL be able to define relevant competitors.

**FR-MI-091 — Competitor correlation**  
The system SHOULD correlate observations to competitors when sufficient identity evidence exists.

**FR-MI-092 — Competitor change detection**  
The system SHOULD identify material changes in competitor price, promotion, product presence and assortment.

### 6.11 Demand Intelligence

**FR-MI-100 — External demand signals**  
The system SHALL accept supported external DemandSignals derived from market observations.

**FR-MI-101 — Internal signal consumption**  
Demand Intelligence MAY consume approved aggregated internal signals from Commerce, CRM, Marketing and Inventory through their public contracts/read models.

**FR-MI-102 — Methodology metadata**  
Demand metrics SHALL retain source scope, time range, methodology and confidence where derived.

**FR-MI-103 — Observed vs inferred**  
Demand forecasts and inferred demand SHALL be explicitly distinguishable from directly observed facts.

### 6.12 Category Intelligence

**FR-MI-110 — Governed category mapping**  
Market observations SHALL support mapping to governed categories through GKS.

**FR-MI-111 — Category aggregation**  
The system SHALL support category-level aggregation across eligible products, brands, prices, promotions, demand, supply and competitor activity.

**FR-MI-112 — Category opportunity signal**  
The system MAY derive category opportunity/risk signals when methodology and supporting evidence are retained.

### 6.13 Market Research

**FR-MI-120 — Research run**  
Authorized users or Agents SHALL be able to initiate a MarketResearchRun.

**FR-MI-121 — Evidence-backed findings**  
Research findings SHALL retain references to underlying MarketEvidence or approved source records.

**FR-MI-122 — Confidence and insufficiency**  
Research output SHOULD state confidence and insufficient-data conditions instead of fabricating completeness.

**FR-MI-123 — Reproducibility metadata**  
A ResearchRun SHALL persist the question, scope, source set, execution time and evidence references sufficient to understand how the result was produced.

### 6.14 Market Search

**FR-MI-130 — Unified search**  
The system SHALL provide a unified Market Search over eligible observations/offers supporting product, category, brand, seller/supplier, competitor, keyword, source, price range, location and date range.

**FR-MI-131 — Semantic supplementation**  
Semantic search MAY supplement structured search but SHALL NOT override authoritative structured filters.

## 7. Cross-domain contracts

Market Intelligence SHALL expose explicit application contracts. Conceptual examples:

```text
marketIntel.searchMarket()
marketIntel.getCurrentPrices()
marketIntel.getPriceHistory()
marketIntel.getSupplierCandidates()
marketIntel.getDemandSignals()
marketIntel.getCategorySnapshot()
marketIntel.getCompetitorSignals()
marketIntel.evaluateWatchRule()
marketIntel.runResearch()
```

Other domains SHALL NOT directly write Market Intelligence-owned persistence.

### 7.1 Commerce / Procurement consumption

A procurement recommendation use case MAY compose:

```text
Inventory.getPosition()
MarketIntel.getPriceTrend()
MarketIntel.getSupplierCandidates()
MarketIntel.getDemandForecast()
        ↓
Procurement.createRecommendation()
```

Purchase execution remains Commerce-owned.

### 7.2 Marketing consumption

Marketing MAY consume competitor price/promotion changes, category demand, market trends and product-launch signals while retaining ownership of campaigns, ads, broadcasts and marketing execution.

### 7.3 Business Home consumption

Business Home MAY expose read-only Market Intelligence projections such as market opportunities, major competitor movement, price anomalies, supplier risks, category trends and demand changes.

## 8. Agent requirements

**FR-MI-140 — Contract-only agent access**  
Zuri Agent SHALL access Market Intelligence through approved application capabilities/tools, not arbitrary SQL.

**FR-MI-141 — Epistemic labeling**  
AI-derived output SHALL distinguish observed fact, normalized fact, inference and recommendation.

**FR-MI-142 — No silent GKS promotion**  
AI SHALL NOT silently promote a market observation into canonical GKS knowledge.

## 9. Domain events

Initial events MAY be in-process. Recommended event vocabulary includes:

```text
MarketObservationReceived
MarketObservationNormalized
MarketOfferObserved
MarketOfferChanged
MarketPriceObserved
MarketPriceChanged
MarketAvailabilityChanged
PromotionDetected
DemandSignalDetected
SupplierCandidateDiscovered
SupplierSignalChanged
CompetitorPriceChanged
CompetitorPromotionStarted
CompetitorProductDetected
CompetitorAssortmentChanged
CategorySignalChanged
WatchRuleMatched
MarketResearchCompleted
```

The design SHOULD remain compatible with a future transactional outbox without requiring distributed messaging infrastructure now.

## 10. Navigation requirements

Proposed domain navigation:

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

Source credentials/configuration SHOULD remain under:

```text
Platform
└── Integrations
    └── Market Sources
```

Market Intelligence MAY surface source-health status read-only.

## 11. Runtime and source-structure target

Zuri remains one product/codebase. A conceptual target is:

```text
src/
├── modules/
│   ├── market-intelligence/
│   │   ├── domain/
│   │   │   ├── observation/
│   │   │   ├── offer/
│   │   │   ├── price/
│   │   │   ├── demand/
│   │   │   ├── supplier/
│   │   │   ├── competitor/
│   │   │   ├── category/
│   │   │   ├── research/
│   │   │   └── watch/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── api/
│   └── commerce/
│       └── procurement/
│           └── intelligence/
├── platform/
│   ├── scheduling/
│   ├── jobs/
│   ├── events/
│   ├── notification/
│   ├── authorization/
│   └── observability/
└── integrations/
    └── market-sources/
        ├── facebook/
        ├── lotus/
        ├── seven-eleven/
        ├── makro/
        ├── bigc/
        ├── shopee/
        └── lazada/
```

Physical source layout SHALL follow the final accepted Zuri architecture/ADR conventions rather than this document overriding repository structure by itself.

## 12. Security requirements

**SEC-MI-001 — Business isolation**  
All Business-scoped Market Intelligence data SHALL enforce Zuri authorization boundaries.

**SEC-MI-002 — Credential handling**  
Source credentials SHALL use approved Zuri secret/integration infrastructure and SHALL NOT be persisted in ordinary Market Intelligence entities.

**SEC-MI-003 — Private source visibility**  
Private-source observations SHALL NOT become globally visible outside their authorized scope.

**SEC-MI-004 — Agent authorization**  
Agent tools SHALL preserve the same authorization boundary as interactive users.

**SEC-MI-005 — Secret redaction**  
Cookies, tokens, passwords and sensitive session material SHALL NOT appear in ordinary UI, evidence payloads or logs.

## 13. Data quality requirements

**DQ-MI-001 — Provenance required**  
Every material observation SHALL have identifiable source provenance.

**DQ-MI-002 — Confidence**  
Probabilistic extraction/resolution SHALL retain confidence where applicable.

**DQ-MI-003 — Unknown is not false/zero**  
The system SHALL distinguish unknown data from known negative/zero states; e.g. `availability=UNKNOWN` is not `OUT_OF_STOCK`.

**DQ-MI-004 — Sample size**  
Derived analytics SHALL retain sample size where statistically relevant.

**DQ-MI-005 — Comparable-set discipline**  
Price/category statistics SHALL not silently combine materially incomparable variants, quantities, conditions or markets.

## 14. Non-functional requirements

**NFR-MI-001 — Modular Monolith**  
Market Intelligence SHALL remain deployable as part of the Zuri Modular Monolith.

**NFR-MI-002 — Domain ownership**  
Only the owning module SHALL write Market Intelligence operational data.

**NFR-MI-003 — Idempotent ingestion**  
Repeated source records SHALL not create duplicate logical state.

**NFR-MI-004 — Source fault isolation**  
Failure of a source adapter SHALL degrade only the affected market capability/source and SHALL NOT make core Zuri CRM, Commerce, Project or identity flows unavailable.

**NFR-MI-005 — Freshness transparency**  
The UI/API SHALL expose freshness sufficient to distinguish current, stale and unknown market state.

**NFR-MI-006 — Observability**  
The platform SHALL expose source health, ingestion success/failure, last successful sync, retries, processing backlog, normalization failure and entity-resolution failure metrics/logs appropriate to Zuri observability conventions.

**NFR-MI-007 — Auditability**  
Material user configuration changes, especially WatchRules and source configuration changes, SHALL be auditable.

**NFR-MI-008 — Worker scalability**  
The architecture SHALL permit batch ingestion, worker concurrency and partitioned jobs without requiring premature microservice extraction.

## 15. Source compliance requirements

Market-source adapters SHALL respect provider-specific authentication, permissions, rate limits, licensing, automated-access restrictions and redistribution policies.

Technical ability to retrieve data SHALL NOT be treated as proof of permission to ingest, retain or redistribute it.

## 16. Primary user stories

**US-MI-001 — Product Watch**  
As a user, I want to watch for RTX 3060 listings under a target price so I can inspect attractive offers quickly.

**US-MI-002 — Retail Price Comparison**  
As a user, I want to compare the same product across retail sources using normalized unit prices and freshness so I can identify the best observed price.

**US-MI-003 — Price History**  
As a user, I want historical prices so I can judge whether the current price is genuinely unusual.

**US-MI-004 — Competitor Monitoring**  
As a Business user, I want to know when relevant competitors materially change pricing, promotion or assortment.

**US-MI-005 — Supplier Discovery**  
As a procurement user, I want Market Intelligence to discover supplier candidates so Commerce / Procurement can evaluate them.

**US-MI-006 — Category Analysis**  
As a Business user, I want category price/demand/supply trends so I can identify risks and opportunities.

**US-MI-007 — Market Research**  
As a user or Agent, I want evidence-backed market research whose findings are traceable to sources and observations.

## 17. Acceptance scenarios

### 17.1 RTX 3060 listing watch

Given a WatchRule:

```text
Product = RTX 3060
Intent = SELL
Condition = USED
Price <= 5500 THB
Distance <= 30 km
Exclude = RTX 3060 Ti
```

When an eligible source produces a new listing, the system SHALL:

1. capture an observation and provenance;
2. classify listing intent;
3. extract the product candidate and price;
4. resolve canonical identity through the approved GKS boundary where possible;
5. preserve unresolved state rather than force a wrong match;
6. evaluate the WatchRule;
7. suppress duplicate alerts;
8. request notification through the Zuri Notification capability.

### 17.2 Retail unit-price comparison

Given observations:

```text
Lotus       27 THB × 1
7-Eleven    32 THB × 1
Makro      156 THB × 6
```

The system SHALL be able to normalize the observations to comparable unit prices when units are equivalent:

```text
Lotus       27 THB / unit
7-Eleven    32 THB / unit
Makro       26 THB / unit
```

The result SHALL retain source and freshness/provenance and SHALL NOT imply that the price is guaranteed real-time beyond the source's actual collection semantics.

## 18. Out of scope for the initial domain

The initial Market Intelligence domain SHALL NOT include:

- automatic checkout/payment;
- direct Purchase Order creation;
- vendor approval;
- inventory mutation;
- arbitrary Agent database access;
- automatic ungoverned promotion into GKS;
- guaranteed real-time coverage of every source;
- one microservice/database per source;
- source-specific business logic leaking into the core domain.

## 19. Delivery phases

### Phase 0 — Domain architecture

- SRS
- Domain Charter
- Context Map / ownership matrix
- Ubiquitous language
- Event catalog
- architecture/navigation ADR
- document graph/governance updates

### Phase 1 — Market Observation core

- MarketSource
- RawObservation / Evidence reference
- MarketObservation
- ExternalOffer
- Provenance
- temporal history
- entity-resolution / GKS boundary

### Phase 2 — Price + Watch MVP

- Market Search
- PriceObservation
- price history
- unit normalization
- Watchlist / WatchRule
- duplicate suppression
- notification integration
- first listing adapter
- first structured retail-price adapter

### Phase 3 — Supplier + Category Intelligence

- SupplierCandidate
- supplier comparison/signals
- category snapshots
- category price distribution/trends

### Phase 4 — Competitive + Demand Intelligence

- competitor registry/signals
- price/promotion/assortment changes
- external demand signals
- approved internal aggregated signals
- demand trends / supply-demand gap

### Phase 5 — Market Research

- ResearchRun
- evidence sets
- findings/confidence
- Agent research tools

### Phase 6 — Procurement Intelligence integration

```text
Market Intelligence
        ↓
Commerce / Procurement Intelligence
        ↓
Recommendation
        ↓
Human / governed decision
        ↓
Procurement execution
```

## 20. MVP exit criteria

Market Intelligence MVP SHALL NOT be considered complete until:

- [ ] `DOM-MARKET-INTELLIGENCE` is registered through the accepted domain registry mechanism.
- [ ] Domain ownership and public contracts are documented.
- [ ] At least one listing source is integrated through an adapter.
- [ ] At least one structured retail-price source is integrated through an adapter.
- [ ] Observations retain provenance/evidence references.
- [ ] Duplicate ingestion is controlled.
- [ ] Product resolution supports aliases and safe unresolved state.
- [ ] Historical price observations are retained.
- [ ] Unit-price normalization works for comparable units.
- [ ] WatchRule supports product + price + exclusions.
- [ ] Duplicate alerts are suppressed.
- [ ] Alert delivery uses Zuri Notification capability.
- [ ] Business authorization/isolation is enforced.
- [ ] Source health/freshness is observable.
- [ ] Source failure does not break unrelated Zuri domains.
- [ ] Agent access occurs through approved module contracts.
- [ ] Market Intelligence cannot directly write Commerce operational state.
- [ ] GKS canonical knowledge cannot be silently modified from external observations.
- [ ] Repository tests, build and documentation governance required by Zuri are green.

## 21. Architectural summary

```text
                              ZURI
                     MODULAR MONOLITH
                              │
 ┌────────────────────────────┼─────────────────────────────┐
 │                            │                             │
 ▼                            ▼                             ▼
GKS                    Market Intelligence               Commerce
 │                            │                             │
Canonical               Price Intelligence               Products
Product                  Demand Intelligence              Inventory
Category                 Supplier Intelligence            Procurement
Knowledge                Competitive Intelligence              │
                         Category Intelligence                 ▼
                         Market Research              Procurement Intel
                              │                             │
                       Watch / Search                       │
                              ▲                             │
                              │                             │
                   Integration Adapters                    │
                              │                             │
             Facebook / Lotus / Shopee / ...               │
                              │                             │
                         Intelligence ──────────────────────┘
```

Core rule:

> External sources produce observations. Market Intelligence converts observations into traceable market intelligence. GKS governs canonical knowledge. Commerce owns operational commerce/procurement state. Procurement Intelligence converts market intelligence into business recommendations. Zuri remains a Domain-Driven Modular Monolith until a concrete operational reason justifies selective extraction.

## 22. Work-state authority

GitHub issue **#74** is the persistent work-state anchor for this initiative. Future work SHOULD inspect that issue, this SRS, the active PR/branch state and current repository architecture before continuing implementation.