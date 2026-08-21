---
domain: market-intelligence
doc_type: context-map
version: "0.1.0b"
status: proposed
state_issue: 74
---

# Context map — Market Intelligence

This document records how Market Intelligence collaborates with existing Zuri authorities. It is intentionally about **ownership and contracts**, not deployment topology; every context below remains inside the Zuri Modular Monolith unless a later ADR authorizes extraction.

## System context

```text
                          ┌────────────────────┐
                          │    Knowledge/GKS   │
                          │ canonical identity │
                          └─────────▲──────────┘
                                    │ resolve / candidate
                                    │
┌─────────────────┐        ┌────────┴────────────┐
│   Integration   │───────►│ Market Intelligence │
│ raw acquisition │ raw    │ observed/derived    │
│ + replay        │ record │ market state        │
└───────▲─────────┘        └───────┬─────────────┘
        │                           │
        │                           ├──────────────► Marketing
 External sources                  │                consume competitor/demand signals
                                    │
                                    ├──────────────► Business Home
                                    │                read-only projection
                                    │
                                    ├──────────────► Agent
                                    │                approved tools only
                                    │
                                    ▼
                                Commerce
                                    │
                                    ▼
                         Procurement Intelligence
                                    │
                                    ▼
                               RFQ / PO / GRN
```

## Context relationships

### Integration → Market Intelligence

**Relationship:** upstream evidence provider / conformist translation input.

Integration owns provider connections, credential references, raw ingestion, cursors, external refs and dead letters. Market Intelligence accepts eligible `RawExternalRecord` identities and translates them into typed market observations.

Contract properties:

- raw evidence is immutable from Market Intelligence's perspective;
- the translation input is source/version identifiable;
- re-translation is idempotent;
- a translation failure does not destroy or mutate the raw record;
- Market records retain raw-record lineage;
- source-specific provider behavior does not leak into Market domain rules after translation.

### Knowledge/GKS ↔ Market Intelligence

**Relationship:** canonical identity authority + governed candidate promotion.

Market Intelligence asks Knowledge/GKS to resolve canonical Product/Brand/Category identity where governed knowledge exists. It may send an unresolved/novel candidate into the governed promotion process.

Rules:

- observed source titles are not canonical identities;
- probabilistic matches carry confidence;
- unresolved is a valid state;
- a Market record cannot silently update GKS;
- canonical aliases/taxonomy remain Knowledge-owned.

### Market Intelligence → Commerce / Procurement

**Relationship:** upstream intelligence provider.

Market Intelligence supplies market facts/signals such as observed prices, price history, supplier candidates, demand/category signals and evidence. Commerce owns internal SKU, stock, approved vendors and purchase execution.

Supplier boundary:

```text
SupplierCandidate (Market)
       ↓ evidence handoff
Vendor Review (Commerce / Procurement)
       ↓ approval
Approved Vendor (Commerce)
```

Procurement Intelligence belongs to Commerce and composes internal state with Market read contracts.

### Market Intelligence → Marketing

**Relationship:** upstream intelligence provider.

Marketing may consume competitor pricing/promotion, assortment changes, demand signals and category movement. Campaigns, Ads, Broadcasts and Marketing execution remain Marketing-owned.

A signal does not change ownership because a campaign reacts to it.

### Market Intelligence → Business Home

**Relationship:** read-only projection source.

Business Home may show market freshness, major price anomalies, competitor movements, supplier risk/opportunity and category/demand change. Business Home stores no duplicate Market truth.

### Agent → Market Intelligence

**Relationship:** authorized application/tool consumer.

Agent may search, query, research or request an authorized Market action only through explicit Market tools/application contracts. Agent never queries arbitrary Market tables, Integration raw payloads or source credentials.

Agent output must distinguish:

```text
Observed fact
Normalized fact
Inference
Recommendation
```

### Platform / Integrations UI → Integration

**Relationship:** configuration/operations surface outside Market Intelligence ownership.

Source connection metadata, credential status and raw-ingestion/provider health remain under Platform → Integrations. Market Intelligence may surface an approved read-only freshness/health projection but must not introduce a second source-credential UI.

## Shared concepts and ownership

| Concept | Authority | Market Intelligence usage |
|---|---|---|
| IntegrationProvider / Connection / Credential | Integration | reference/read only |
| RawExternalRecord | Integration | translation input + lineage |
| SyncCursor / DeadLetter | Integration | operational acquisition state, no ownership |
| Canonical Product / Brand / Category | Knowledge/GKS | resolved reference |
| MarketObservation / ExternalOffer | Market Intelligence | owner |
| Price / Availability / Promotion observation | Market Intelligence | owner |
| Demand / Competitor / Category signal | Market Intelligence | owner |
| SupplierCandidate | Market Intelligence | owner until handoff |
| Internal Product/SKU | Commerce | reference/consumer boundary |
| Inventory | Commerce | downstream decision input |
| Approved Vendor | Commerce / Procurement | never created directly by Market |
| Purchase Order / Goods Receipt | Commerce / Procurement | out of Market write boundary |
| Campaign | Marketing | downstream consumer |
| Market widgets on Business Home | Business Home projection | derived read only |

## Event direction candidates

```text
Integration raw record available
        ↓
Market translation
        ↓
MarketObservationCreated
        ├── Price/Availability/Promotion projections
        ├── Demand/Competitor/Category projections
        ├── Watch evaluation
        └── Research/search indexes

MarketPriceChanged ─────────► Commerce / Marketing / Business Home consumers
DemandSignalDetected ───────► Marketing / Commerce consumers
SupplierCandidateDiscovered ► Procurement review consumer
WatchRuleMatched ───────────► Zuri Notification boundary
```

These are event vocabulary candidates only. A global implementation requirement must authorize concrete events/outbox/schema changes.

## Anti-corruption boundaries

Source provider vocabularies must terminate at Integration/translation boundaries. Examples:

```text
Facebook post / Marketplace listing
Lotus item response
Shopee listing payload
```

must not become domain model shapes directly. They normalize into Zuri concepts such as:

```text
MarketObservation
ExternalOffer
PriceObservation
AvailabilityObservation
PromotionObservation
```

Likewise, source IDs never become Zuri primary keys; they remain external references/lineage per BR-002.

## Deployment statement

All contexts in this map are logical boundaries. They do not imply network services or separate databases. Worker processes may be used for collection/translation load while remaining one application architecture.
