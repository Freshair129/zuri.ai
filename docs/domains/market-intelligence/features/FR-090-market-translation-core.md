---
feature: FR-090
module: market-intelligence
source: v2-native
status: proposed
issue: 76
---

# FR-090 — Market translation core

> **Governance note:** `FR-090` is reserved in issue #76 and must be registered in
> `docs/PRD-SDD-v1.0.md` before this branch is mergeable. This note records rationale;
> it does not replace the global requirement registry.

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

## GKS resolution

Canonical Product/Category resolution is an injected Knowledge/GKS port. A missing or
null resolver result produces `UNRESOLVED`; the translator never invents a canonical
identity to make the pipeline look complete.

## Phase boundary

This FR intentionally does **not** introduce PriceObservation, ExternalOffer,
SupplierCandidate, WatchRule or source-specific Facebook/retail adapters. Those belong
to #77/#82/#83 after the translation seam and Market persistence are proven.
