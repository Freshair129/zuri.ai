---
domain: market-intelligence
stable_domain_id: DOM-MARKET-INTELLIGENCE
status: proposed
version: 0.2.0
date: 2026-08-20
architecture: domain-driven-modular-monolith
state_issue: 74
---

# SRS — Market Intelligence Domain

**System:** Zuri AI  
**Repository:** `Freshair129/zuri.ai`  
**Document type:** Software Requirements Specification  
**Domain:** Market Intelligence  
**Stable product-domain ID:** `DOM-MARKET-INTELLIGENCE`  
**Technical owner ID:** `TD-MARKET-INTELLIGENCE`  
**Status:** Proposed  
**Version:** Draft v0.2

> **Requirement-ID note.** `MI-RQ-*` identifiers in this SRS are local clause IDs only. They are **not** Zuri global `FR-*` / `NFR-*` / `BR-*` / `SEC-*` identifiers. Zuri's global requirement IDs remain defined only in `docs/PRD-SDD-v1.0.md` under the AGENTS.md §18 immutable-ID contract. Implementation slices SHALL reserve global IDs before code is annotated or shipped.

## 1. Purpose

Market Intelligence observes, translates, normalizes, searches and analyzes external market evidence so Zuri can answer questions such as:

- What is the current observed market price of a product?
- Has a matching listing appeared?
- Which supplier candidates offer a product, at what observed terms?
- Are competitors changing price, promotion or assortment?
- Is demand for a category rising or falling?
- Is a current price unusual relative to recent history?
- Which source evidence supports an insight or recommendation?

Initial source classes include Facebook Groups / Marketplace, Lotus's, 7-Eleven, Makro, Big C, Shopee, Lazada, TikTok Shop, external APIs, open-data feeds, files and approved manual imports.

## 2. Architectural constraints

Market Intelligence SHALL conform to Zuri's Domain-Driven Modular Monolith architecture.

It SHALL:

- live in the Zuri codebase and release boundary;
- own only its declared operational market-intelligence state;
- expose explicit application/module contracts;
- use approved cross-domain contracts, projections or read models;
- use in-process events initially where eventing is useful;
- support worker processes for polling/browser collection without creating an independent business service;
- remain selectively extractable only if future scale, security, availability or deployment requirements justify extraction.

It SHALL NOT require an independent network microservice for ordinary intra-Zuri calls.

## 3. Authority and domain boundaries

### 3.1 Integration owns acquisition evidence

The existing `integration` domain remains authority for external-provider connection and raw-ingestion state, including:

- `IntegrationProvider`;
- `IntegrationConnection`;
- `IntegrationCredential` metadata / opaque secret references;
- `IngestionRun`;
- `RawExternalRecord`;
- `SyncCursor`;
- `ExternalEntityRef`;
- `DeadLetterRecord`.

External market sources SHALL therefore enter through the existing integration substrate (FR-081) and source/provider adapters. Market Intelligence SHALL consume eligible raw records through an explicit translation contract.

Correct boundary:

```text
External Source
    ↓
Integration Adapter
    ↓
RawExternalRecord        ← Integration authority / replayable evidence
    ↓
Market Translation
    ↓
MarketObservation        ← Market Intelligence authority
    ↓
Signals / Offers / Analytics
```

Market Intelligence SHALL NOT create a competing raw-ingestion store, secret manager, connection registry, cursor store or dead-letter mechanism.

### 3.2 Market Intelligence owns translated market meaning

Market Intelligence SHALL own business meaning and write authority for:

- `MarketObservation`;
- `ExternalOffer` / `ExternalListing`;
- `PriceObservation`;
- `AvailabilityObservation`;
- `PromotionObservation`;
- `DemandSignal`;
- `SupplierCandidate` and supplier-market signals;
- `CompetitorSignal`;
- `CategoryMarketSignal`;
- `MarketSnapshot`;
- `MarketResearchRun`;
- `Watchlist`;
- `WatchRule`;
- `MarketAlert` state;
- market-derived evidence links, confidence, methodology and projections.

A Market Intelligence record SHALL retain lineage back to its Integration raw-record identity whenever it is derived from an ingested external record.

### 3.3 GKS owns governed canonical knowledge

The `knowledge` domain / GKS remains authority for governed canonical knowledge such as canonical product identity, canonical brand identity, governed category taxonomy, approved aliases and validated semantic relations.

Market Intelligence MAY resolve observations against GKS and MAY produce a knowledge candidate, but SHALL NOT silently promote unverified external data into GKS.

```text
MarketObservation
      ↓
Knowledge Candidate
      ↓
Validation / Governance
      ↓
GKS Canonical Knowledge
```

### 3.4 Commerce / Procurement owns business execution

Commerce remains authority for internal operational products/SKUs, inventory, warehouses, approved vendors and procurement transactions.

`Procurement Intelligence` remains under Commerce / Procurement. It MAY consume Market Intelligence but Market Intelligence SHALL NOT directly approve a vendor, create a Purchase Order, receive goods or mutate stock.

Market Intelligence answers **Observe + Understand**. Commerce / Procurement answers **Decide + Execute**.

## 4. Capability map

`DOM-MARKET-INTELLIGENCE` contains these product capabilities:

1. Price Intelligence
2. Demand Intelligence
3. Supplier Intelligence
4. Competitive Intelligence
5. Category Intelligence
6. Market Research
7. Market Search
8. Watch & Alerts
9. Market Observation / Provenance Core

These are subdomains/capabilities of one Market Intelligence product domain, not independent top-level Zuri domains.

## 5. Core information model

```text
Integration.RawExternalRecord
            │
            ▼
      MarketObservation
            │
     ┌──────┼────────────────┐
     ▼      ▼                ▼
   Offer   DemandSignal    MarketSignal
     │
     ├── PriceObservation
     ├── AvailabilityObservation
     ├── PromotionObservation
     ├── Seller/Supplier Candidate
     └── Location evidence

MarketObservation
    ├── rawExternalRecordRef
    ├── canonicalProductRef? → GKS
    ├── categoryRef?         → GKS
    ├── Business scope / visibility class
    ├── observedAt
    ├── confidence
    └── methodology / provenance
```

An adapter reports what the source delivered. Integration preserves that raw evidence. Market Intelligence interprets it. GKS decides governed canonical identity.

## 6. Software requirements

### 6.1 Domain registration and scope

**MI-RQ-001 — Stable product-domain identity**  
The accepted domain catalog SHALL include `DOM-MARKET-INTELLIGENCE` independent of display label and route key.

**MI-RQ-002 — Navigation projection**  
The target route key is `market` and the target display label is `Market Intelligence`. Runtime navigation wiring requires its own global functional requirement before implementation.

**MI-RQ-003 — Per-Business enablement**  
The domain SHALL support per-Business enablement using Zuri's Business-bound domain visibility model.

**MI-RQ-004 — Business isolation**  
Business-owned watchlists, private research runs, rules, alerts and non-public market configuration SHALL obey trusted Zuri scope/authorization boundaries.

### 6.2 Integration-to-market translation

**MI-RQ-010 — Existing ingestion substrate**  
External market acquisition SHALL reuse the Integration domain's FR-081 normalized ingestion/raw-record path rather than introducing a second raw-write path.

**MI-RQ-011 — Adapter placement**  
Facebook, retail, marketplace and other source-specific acquisition logic SHALL be provider adapters under the Integration boundary, not Market Intelligence business entities.

**MI-RQ-012 — Translation contract**  
Market Intelligence SHALL expose or consume an explicit translation contract that converts an eligible `RawExternalRecord` into zero or more typed Market observations while retaining source lineage.

**MI-RQ-013 — Translation idempotency**  
Re-translating the same raw-record version SHALL NOT create duplicate logical Market observations.

**MI-RQ-014 — Translation failure**  
A translation failure SHALL preserve the Integration raw record unchanged and SHALL surface a retry/reviewable failure state without corrupting existing Market truth.

**MI-RQ-015 — Worker compatibility**  
Polling/browser collection MAY run in a worker process, but the worker SHALL use the same Integration and Market application contracts as the web runtime.

### 6.3 Observation, evidence and provenance

**MI-RQ-020 — Observation-first market state**  
Derived intelligence SHALL originate from typed `MarketObservation` records linked to source evidence rather than directly from scraper/provider payloads.

**MI-RQ-021 — Source lineage**  
Every derived observation SHALL retain the Integration raw-record reference or an approved equivalent evidence reference.

**MI-RQ-022 — Provenance**  
Every material observation SHALL retain source/provider, observed time, captured/translated time, external reference when available, confidence and parser/translator version where relevant.

**MI-RQ-023 — Temporal history**  
Historical observations required for trend analysis SHALL NOT be destructively overwritten.

**MI-RQ-024 — Freshness**  
The system SHALL expose freshness/last-observed metadata and SHALL NOT describe polled data as real-time unless the source guarantees real-time delivery semantics.

**MI-RQ-025 — Unknown is not false**  
Missing evidence SHALL remain `UNKNOWN` rather than being silently coerced into zero, false, out-of-stock or no-demand states.

### 6.4 Entity resolution

**MI-RQ-030 — Candidate extraction**  
Market translation SHALL extract product/entity candidates from structured or unstructured records.

**MI-RQ-031 — Alias matching**  
Resolution MAY use exact identifiers, governed aliases, fuzzy matching, embeddings and LLM fallback where appropriate.

**MI-RQ-032 — GKS resolution**  
Where governed identity exists, canonical product/category references SHALL resolve through the Knowledge/GKS contract.

**MI-RQ-033 — Confidence**  
Probabilistic entity resolution SHALL expose confidence/methodology sufficient for downstream rules to require a threshold.

**MI-RQ-034 — Unresolved state**  
The system SHALL permit an unresolved product/entity state rather than forcing an incorrect canonical match.

### 6.5 Offer and listing intelligence

**MI-RQ-040 — External offer**  
An `ExternalOffer` SHALL support source lineage, external reference, product candidate, optional canonical product reference, seller/supplier candidate, location, intent, condition, quantity, price, availability, promotion, source URL/reference and observation times.

**MI-RQ-041 — Listing intent**  
Marketplace/classified observations SHOULD distinguish `SELL`, `BUY_WANTED`, `TRADE` and `UNKNOWN`.

**MI-RQ-042 — Condition**  
Where applicable, offers SHALL support at least `NEW`, `USED`, `REFURBISHED`, `OPEN_BOX` and `UNKNOWN`.

**MI-RQ-043 — Offer lifecycle**  
The system SHOULD detect material changes to a previously observed offer including price, availability, seller status or disappearance where source evidence permits.

### 6.6 Price Intelligence

**MI-RQ-050 — Price observation**  
A `PriceObservation` SHALL support amount, currency, quantity, unit, price type, promotional context and observed time.

**MI-RQ-051 — Unit normalization**  
Comparable offers SHALL calculate normalized unit price when quantity/unit evidence is sufficient.

**MI-RQ-052 — Historical price**  
The system SHALL support eligible price history by resolved product/variant, source, seller and location.

**MI-RQ-053 — Market distribution**  
Price Intelligence SHOULD calculate distribution statistics only over comparable observations and SHALL expose sample count/scope.

**MI-RQ-054 — Fair-market estimate**  
A fair-market estimate MAY be produced but SHALL be labelled as derived, with evidence scope and confidence distinct from observed prices.

**MI-RQ-055 — Price anomaly**  
The system SHOULD detect materially unusual prices relative to comparable recent observations.

### 6.7 Availability and promotion

**MI-RQ-060 — Availability states**  
Availability SHALL support `IN_STOCK`, `OUT_OF_STOCK`, `LIMITED` and `UNKNOWN` when evidence allows.

**MI-RQ-061 — Availability history**  
Availability history SHOULD be retained when useful for restock/supply intelligence.

**MI-RQ-062 — Promotion observation**  
Discounts, member prices, bundles, coupons and validity windows SHOULD be modeled separately from ordinary price when evidence permits.

### 6.8 Watch and alerts

**MI-RQ-070 — Watchlists**  
Authorized users SHALL be able to create Business-scoped Watchlists.

**MI-RQ-071 — Watch rules**  
A rule SHALL support combinations of product/category, keywords, listing intent, condition, price threshold, location/distance, seller/supplier, source, promotion, availability and confidence threshold.

Example:

```text
Product = RTX 3060
Intent = SELL
Condition = USED
Price <= 5500 THB
Distance <= 30 km
Exclude = RTX 3060 Ti
```

**MI-RQ-072 — Matching**  
Rule evaluation MAY combine structured filters with governed aliases, fuzzy or semantic matching.

**MI-RQ-073 — Duplicate alert suppression**  
The same logical item SHALL NOT repeatedly alert unless a configured material change occurs.

**MI-RQ-074 — Notification contract**  
Market Intelligence SHALL emit notification intent through Zuri's approved Notification capability rather than implement a separate notification stack per source.

**MI-RQ-075 — Trigger classes**  
Rules MAY trigger on new listings, price drops, restock, new supplier candidates, competitor promotions, demand spikes or category anomalies.

### 6.9 Supplier Intelligence

**MI-RQ-080 — Supplier candidate**  
An external `SupplierCandidate` SHALL remain distinct from a Commerce-approved Vendor.

**MI-RQ-081 — Supplier evidence**  
Supplier analysis MAY use observed pricing, product coverage, availability, geography, lead-time evidence, capacity evidence and historical reliability evidence.

**MI-RQ-082 — Procurement handoff**  
An authorized workflow MAY hand a SupplierCandidate reference and evidence packet to Commerce / Procurement for review; Market Intelligence SHALL NOT approve the vendor itself.

### 6.10 Competitive Intelligence

**MI-RQ-090 — Competitor registry**  
Authorized Business users SHALL be able to define relevant competitor identities/references without granting those records any authority over source truth.

**MI-RQ-091 — Competitor correlation**  
The system SHOULD correlate observations to competitors only when sufficient identity evidence exists.

**MI-RQ-092 — Change detection**  
Competitive Intelligence SHOULD identify material changes in competitor pricing, promotion, product presence and assortment.

### 6.11 Demand Intelligence

**MI-RQ-100 — External demand signals**  
Demand Intelligence SHALL support demand signals derived from eligible external observations.

**MI-RQ-101 — Internal signal consumption**  
Demand Intelligence MAY consume approved aggregated internal signals through owning-domain read contracts; it SHALL NOT directly read/write another domain's operational tables as an implementation shortcut.

**MI-RQ-102 — Methodology metadata**  
Derived demand metrics SHALL retain source scope, time range, methodology and confidence.

**MI-RQ-103 — Observed versus inferred**  
Forecasts and inferred demand SHALL be explicitly distinguishable from directly observed facts.

### 6.12 Category Intelligence

**MI-RQ-110 — Governed category mapping**  
Market observations SHALL support mapping to governed categories through GKS.

**MI-RQ-111 — Category aggregation**  
The system SHALL support category-level aggregation across eligible products, brands, prices, promotions, demand, supply and competitor activity.

**MI-RQ-112 — Opportunity/risk signals**  
Category opportunity/risk signals MAY be derived only when methodology and supporting evidence are retained.

### 6.13 Market Research

**MI-RQ-120 — Research run**  
Authorized users or Agents SHALL be able to initiate a `MarketResearchRun` through an approved application/tool contract.

**MI-RQ-121 — Evidence-backed findings**  
Research findings SHALL retain references to Market observations and underlying source evidence.

**MI-RQ-122 — Confidence and insufficiency**  
Research output SHOULD state confidence and insufficient-data conditions instead of fabricating completeness.

**MI-RQ-123 — Reproducibility**  
A ResearchRun SHALL persist question, scope, source/evidence set, methodology/version and execution time sufficient to understand how the result was produced.

### 6.14 Market Search

**MI-RQ-130 — Unified market search**  
The system SHALL support search over eligible Market observations/offers by product, category, brand, seller/supplier, competitor, keyword, source, price, location and time.

**MI-RQ-131 — Semantic supplementation**  
Semantic search MAY supplement structured search but SHALL NOT override explicit authoritative filters.

## 7. Cross-domain application contracts

Conceptual Market Intelligence read/application contracts include:

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

These names are design vocabulary, not committed public API signatures until their implementation FR is approved.

### 7.1 Commerce / Procurement

A future Procurement Intelligence use case MAY compose Market Intelligence with Commerce-owned state:

```text
Inventory.getPosition()
MarketIntel.getPriceTrend()
MarketIntel.getSupplierCandidates()
MarketIntel.getDemandForecast()
        ↓
Procurement.createRecommendation()
```

Purchase execution remains Commerce-owned.

### 7.2 Marketing

Marketing MAY consume competitor price/promotion changes, category demand and market trends while retaining ownership of campaigns, ads, broadcasts and marketing execution.

### 7.3 Business Home

Business Home MAY expose read-only Market Intelligence projections such as major price anomalies, competitor movements, supplier risks, category changes and market opportunities. It owns none of those records.

### 7.4 Agent

Zuri Agent SHALL access Market Intelligence only through approved tool/application contracts. Arbitrary SQL over market tables is forbidden. AI output SHALL distinguish observed fact, normalized fact, inference and recommendation.

## 8. Event candidates

Initial in-process event vocabulary MAY include:

```text
MarketObservationCreated
MarketObservationResolved
ExternalOfferObserved
ExternalOfferChanged
MarketPriceObserved
MarketPriceChanged
MarketAvailabilityChanged
PromotionDetected
DemandSignalDetected
SupplierCandidateDiscovered
CompetitorPriceChanged
CompetitorPromotionStarted
CategorySignalChanged
WatchRuleMatched
MarketResearchCompleted
```

Event names are candidates until a global implementation requirement adopts them. Integration raw-ingestion events remain owned by the Integration domain.

## 9. Navigation target

Target Tier-2 domain:

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

Source credentials, provider connections, raw-ingestion health and secret status remain under `Platform → Integrations`; Market Intelligence may display approved read-only source freshness/health projections where useful.

## 10. Suggested source boundaries

```text
src/
├── modules/
│   ├── market-intelligence/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── api/
│   └── commerce/
│       └── procurement/
│
├── platform/
│   └── integrations/
│       ├── core/                 # existing FR-081 raw-ingestion authority
│       └── providers/
│           ├── facebook/
│           ├── retail/
│           └── marketplace/
│
└── platform/jobs/                # future scheduler/worker composition if adopted
```

Exact physical paths remain subordinate to accepted architecture and implementation ADRs; this SRS defines ownership, not a mandatory folder migration.

## 11. Security and data-quality requirements

**MI-RQ-200 — Trusted scope**  
Business-scoped Market data SHALL enforce trusted Zuri viewer/authorization boundaries.

**MI-RQ-201 — Secret isolation**  
Provider credentials, cookies, tokens and session material SHALL remain under approved Integration/SecretManager authority and SHALL NOT be copied into Market Intelligence records.

**MI-RQ-202 — Private-source visibility**  
Evidence from private/authenticated sources SHALL preserve its visibility/legal scope and SHALL NOT become globally visible merely because it was translated.

**MI-RQ-203 — Agent authorization**  
Agent tools SHALL never widen access beyond the principal's Business/domain authorization.

**MI-RQ-210 — Provenance completeness**  
Material derived intelligence SHALL be traceable to evidence and methodology.

**MI-RQ-211 — Confidence**  
Probabilistic extraction/resolution SHALL carry confidence rather than masquerade as deterministic fact.

**MI-RQ-212 — Comparable-sample guard**  
Price/demand/category aggregates SHALL expose sample scope/count and SHALL not mix obviously incomparable unit/variant/condition records without normalization.

## 12. Non-functional requirements

**MI-RQ-300 — Modular-monolith deployment**  
No independent Market Intelligence network service is required for normal operation.

**MI-RQ-301 — Failure containment**  
Failure of one external source/adapter SHALL degrade only the affected acquisition/intelligence path and SHALL NOT make core Zuri domains unavailable.

**MI-RQ-302 — Idempotency**  
Raw re-delivery and re-translation SHALL be safe against duplicate logical Market state.

**MI-RQ-303 — Observability**  
Operators SHALL be able to inspect source/connection health (Integration), translation failures/backlog, last successful observation and unresolved entity-resolution counts without exposing secrets or sensitive payloads.

**MI-RQ-304 — Auditability**  
Material configuration changes, WatchRule mutation and governed handoffs SHALL be auditable through Zuri's approved audit boundary.

**MI-RQ-305 — Scale path**  
The design SHALL support batch ingestion, worker concurrency and read projections before considering microservice extraction.

## 13. Primary acceptance scenarios

### AC-MI-01 — RTX 3060 watch

Given a WatchRule:

```text
Product = RTX 3060
Intent = SELL
Condition = USED
Price <= 5,500 THB
Exclude = RTX 3060 Ti
```

when an approved source adapter ingests a matching external record, Integration preserves the raw evidence, Market Intelligence translates/resolves it, evaluates the rule once, and Zuri emits one eligible notification with source/provenance and freshness.

### AC-MI-02 — Retail unit-price comparison

Given comparable observations for one governed product/variant, including a bundle such as `156 THB / 6 units`, Price Intelligence normalizes unit price (`26 THB/unit`), shows observation freshness/source evidence, and never labels stale polled data as guaranteed real-time.

### AC-MI-03 — Supplier handoff

Given sufficient supplier-market evidence, Market Intelligence creates/updates a SupplierCandidate and an authorized user may hand its reference/evidence to Commerce Procurement review; no Approved Vendor or Purchase Order is created by Market Intelligence.

### AC-MI-04 — Raw replay safety

Given a translation defect, the original Integration `RawExternalRecord` remains unchanged and replayable; after a translator fix, reprocessing creates the corrected Market state idempotently without rewriting raw evidence.

## 14. Out of scope for the first implementation slices

- automatic checkout or payment;
- direct Purchase Order creation by Market Intelligence;
- vendor approval;
- inventory mutation;
- automatic GKS promotion;
- guaranteed real-time coverage for every source;
- independent source microservices/databases;
- a second raw-ingestion/secret/cursor/dead-letter subsystem;
- arbitrary Agent database access;
- bypassing source terms, permissions, rate limits or legal restrictions.

## 15. Delivery sequence

1. Architecture boundary: ADR, charter, context map, domain catalog/navigation target.
2. Global requirement reservation for the first implementation slice.
3. Market translation core over Integration `RawExternalRecord` + GKS resolution boundary.
4. Price Intelligence + Watch MVP.
5. Supplier + Category Intelligence.
6. Competitive + Demand Intelligence.
7. Market Research.
8. Commerce Procurement Intelligence integration.

## 16. Phase-0 exit criteria

Phase 0 is complete when:

- the architecture decision is accepted or explicitly marked proposed for owner review;
- the Market Intelligence charter defines ownership and public contracts;
- the context map names Integration, GKS, Commerce, Marketing, Business Home and Agent dependencies;
- `DOM-MARKET-INTELLIGENCE` / `TD-MARKET-INTELLIGENCE` identity is documented;
- navigation target is documented without pretending routes exist;
- implementation backlog exists in GitHub and references issue #74;
- global FR/NFR/BR/SEC/SDD IDs are reserved only when an implementation slice is authorized;
- generated documentation state is produced by `npm run govern`, never edited by hand.

## 17. Core rule

> Integration preserves what external systems sent. Market Intelligence translates that evidence into observed market state and derived intelligence. GKS governs canonical knowledge. Commerce owns operational products, inventory and procurement execution. Zuri stays a Domain-Driven Modular Monolith until a real operational reason justifies extraction.
