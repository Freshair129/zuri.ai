---
id: "GENESIS-RAG-DB-MIGRATION-REPORT"
version: "0.1.0b"
created_at: "2026-08-22T22:22:17+07:00, ATHER"
last_update: "2026-08-22T22:22:17+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  doc_type: "migration-report"
  scope: "local GenesisBlock catalog store"
  risk: "HIGH"
---

# GenesisBlock Catalog Database Migration Report

## Result

The catalog family/variant/offer projection is now available in the versioned
local store `data/genesis_smartgift_store_family_v2`. The legacy
`data/genesis_smartgift_store` was preserved and was not overwritten.

## Source and snapshot

| Field | Value |
|---|---|
| Source role | `pricing` |
| Source | `D:\workspace\smartgift-pricing\public\catalog\giftset.json` |
| Source SHA-256 | `5399499d3031ed58be66c958c2ee98fc57401190ee6ddd0a7d40b315842544c2` |
| Raw rows | 1,017 |
| Canonical offers | 1,016 |
| Exact duplicate row | 1 (`TPT11-7`) |
| Conflicting duplicate code | 0 |
| Snapshot ID | `d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31` |

## Built database

| Metric | Result |
|---|---:|
| Product families | 845 |
| Product variants | 1,016 |
| Catalog offers | 1,016 |
| Review-required families | 107 |
| Graph nodes | 2,877 |
| Graph edges | 2,032 |
| Vector index | `not_built` |

## Verification

- First initialization returned `ready: true` and `ingest_empty_store`.
- A second initialization opened the same store and returned `skip_same_snapshot`.
- Exact code search for `TJS23-2` returned its family and both retained offers.
- Default `GenesisLocalRag()` opened `data/genesis_smartgift_store_family_v2`.
- `npm run typecheck` passed after the runtime/default-store change.
- `npm test` passed: 247/249 tests, 0 failures, 2 intentional skips.
- `npm run build` passed.

## Safety boundary

This is a local derived database update, not a production migration. The
semantic Downloads file is not used by the active runtime and was not deleted.
The old unmanifested store remains available for rollback/reference. Snapshot
changes continue to fail closed rather than silently overwriting a store.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0b | 2026-08-22 | beta | Built and verified the versioned family/variant/offer GenesisBlock store from the approved pricing snapshot | ATHER |
