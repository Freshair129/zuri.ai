---
domain: market-intelligence
feature: FR-092
module: market-intelligence
source: v2-native
version: 0.1.1b
status: beta
issue: 76
---

# FR-092 — Market translation core

> **Governance note:** `FR-092` was reserved in issue #76 after current `main` consumed FR-090 and FR-091. It is registered in `docs/PRD-SDD-v1.0.md` and the implementation merged through PR #88 (`1136863cb21563777cd680d4070eb7e8780487be`). This note records rationale; it does not replace the global requirement registry.

## Delivery status

The translation core is shipped in PR #88 under the governed identity set
`FR-092 / NFR-018 / BR-019 / SDD-049 / SEC-017`. The merged slice includes the
provider-neutral translator, `MarketObservation` persistence, deterministic
lineage/replay protection, trusted Integration scope, and governed Knowledge/GKS
resolution. No production database or live Supabase migration was applied.

## Why this slice exists

FR-081 already owns external acquisition and immutable raw evidence. Market Intelligence
needs a separate translation seam that turns one eligible `RawExternalRecord` into a
provider-neutral Market observation without creating a second ingestion subsystem or
allowing source payloads to choose Zuri authorization scope.

## Locked boundary

```text
RawExternalRecord (Integration authority)
        ↓
Market translation application contract
        ├─ trusted scope from raw envelope only
        ├─ injected source/candidate extractor
        ├─ injected GKS resolver
        ├─ valid UNRESOLVED outcome
        └─ deterministic source-lineage identity
        ↓
MarketObservation draft / persistence (Market authority)
```

The extractor may interpret provider payload fields but cannot authoritatively set
`tenantId`, `businessId`, `connectionId`, raw-record identity or payload hash. Those
values are copied from the Integration-owned raw envelope.

## Replay identity

The first translation contract derives a deterministic lineage key from:

```text
rawRecordId
+ source payloadHash
+ translationSchemaVersion
+ observationType
```

Replaying the same immutable raw evidence through the same translation schema therefore
resolves to the same logical Market observation. A changed payload hash or translation
schema may create a new observation version while retaining its source lineage.

Concurrent replay is also one logical observation: persistence is required to use an
atomic create-if-absent boundary backed by the unique lineage identity, not an
application-level `find → insert` sequence that can race between workers.

## GKS resolution

Canonical Product/Category resolution is an injected Knowledge/GKS port. A missing or
null resolver result produces `UNRESOLVED`; the translator never invents a canonical
identity to make the pipeline look complete. The current governed Knowledge contract
exposes canonical Product records but only a category label, so this phase resolves a
canonical Product reference and deliberately leaves `canonicalCategoryRef = null`.

## Phase boundary

This FR intentionally does **not** introduce PriceObservation, ExternalOffer,
SupplierCandidate, WatchRule or source-specific Facebook/retail adapters. Those belong
to #77/#82/#83 after the translation seam and Market persistence are proven.
