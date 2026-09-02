---
version: "1.0.0"
status: accepted
domain: asset-management
---

# Asset Management context map

## Runtime relationships

```text
                    trusted viewer / scope / audit
                      Platform + Identity
                              │
                              ▼
Web · API · Sheet · Agent · LINE ──► Asset Intake ──► Registered Asset
                  FileAsset ref ▲       │                    │
                                │       │ typed refs         ├── responsibility history ─► Person
                                │       ├───────────────────► PR / PO / GRN (Procurement)
                                │       ├───────────────────► payment / book (Finance)
                                │       ├───────────────────► lot / expiry
                                │       └───────────────────► Project allocation
                                │                                  │
                         existing content                           ▼
                         storage authority                Project Inventory
                                                          read projection only
```

## Contracts

| Provider | Consumer | Contract | Direction / ownership |
|---|---|---|---|
| Platform/Identity | Asset | trusted viewer, Business visibility, `AuditEvent` | Platform owns identity; Asset calls it |
| File management | Asset | `FileAsset.id`, MIME, hash, active state | file authority owns bytes; Asset owns evidence role/review |
| Procurement | Asset | typed PR/PO/line/GRN/invoice refs | Procurement → Asset; reference-only while provider absent |
| People/Identity | Asset | Person/Membership lookup | People → Asset; Asset owns temporal role interval |
| Business hierarchy | Asset | Branch lookup | hierarchy → Asset; Asset owns physical location detail/history |
| Project Manager | Asset | future `ProjectAssetRequest` | PM requests; Asset decides/allocates |
| Asset | Project Manager | `AssetProjectAllocation` read projection | Asset → Project Inventory; no mutation from read model |
| Asset | Finance | depreciation/acquisition candidate | Asset proposes; Finance decides/posts |
| Integration platform | Asset | pipeline ledger | shared ledger, Asset-specific definition IDs |
| zuri-cli LINE transport | Asset | trusted uploaded artifact reference | transport fetches bytes; zuri-ai never receives LINE secret/token |

## Anti-corruption rules

1. External document numbers remain values plus system/type/line metadata; they are
   never used as internal relational keys.
2. A missing provider is represented as an unresolved typed reference, not a locally
   invented supplier/PO/department/accounting row.
3. Project Inventory accepts a stable DTO projection only after Asset allocation
   persistence exists; it never queries private Asset tables ad hoc from a page.
4. A payment slip or OCR field is evidence, not proof of authorization or truth.
5. `FileAsset` remains content identity. `RegisteredAsset` remains physical identity.

## Change protocol

Any new writer, bidirectional synchronization, external approval or transfer of
authority requires a new ADR or an explicit amendment to ADR-055. Adding an adapter
that implements an existing one-way contract does not transfer ownership.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-01 | accepted | Fixed providers, consumers, direction and anti-corruption rules for Asset integrations | working-tree | Codex |
