---
domain_id: DOM-ASSET-MANAGEMENT
domain: asset-management
modules:
  - asset-management
owns_models:
  - RegisteredAsset
  - AssetIntake
  - AssetEvidence
  - AssetProcurementRef
  - AssetLot
  - AssetResponsibility
  - AssetLocationHistory
  - AssetProjectAllocation
  - AssetDepreciationCandidate
technical_owner: TD-ASSET-MANAGEMENT
status: active-foundation
version: "1.0.0"
created_at: "2026-09-01T00:00:00+07:00"
updated_at: "2026-09-01T00:00:00+07:00"
---

# Asset Management domain charter

## Mission

Asset Management is the Business-scoped authority for the physical identity and
operational lifecycle of company assets: evidence-backed intake, registration,
custody, use, location, project allocation, maintenance/stocktake/disposal history
and the handoff of reviewable financial facts.

The domain answers four questions without relying on a parallel spreadsheet:

1. What physical unit or controlled lot is this?
2. Who is accountable for it and who is using it now?
3. Where is it and which Project, if any, is using it?
4. Which evidence, procurement references and decisions explain its current state?

## Owned records

- `RegisteredAsset` and stable Business-scoped Asset ID.
- `AssetIntake`, its validation/approval state and source correlation.
- `AssetEvidence` metadata and review status, referencing existing `FileAsset`
  content rather than duplicating it.
- `AssetProcurementRef` as an Asset-side typed reference to PR, PO, lines, GRN,
  invoice and supplier identities owned elsewhere.
- `AssetLot` for expiry-controlled categories.
- `AssetResponsibility` effective intervals for accountable person, custodian and
  actual user.
- `AssetLocationHistory` effective intervals beneath an optional Branch.
- `AssetProjectAllocation` effective intervals linking an asset to a Project or
  Workstream without moving ownership into Project Manager.
- `AssetDepreciationCandidate` deterministic preview evidence. It is not an
  accounting book, journal or posting authority.

## Explicitly not owned

| Concept | Authority | Asset behavior |
|---|---|---|
| `FileAsset` bytes/storage metadata | existing file-management authority | reference only |
| Supplier, PR, PO, GRN and procurement return | future Commerce/Procurement | typed reference only |
| Person, Membership and employment status | Identity/People | read reference only |
| Department/Org Unit master | future People organization authority | external typed ref until one exists |
| Branch master | Business hierarchy | read reference only |
| Project intent/request and Project Inventory | Project Manager | consume request; publish read projection |
| Capitalization, depreciation book and journal | future Finance/Accounting | submit/review candidate only |
| Pipeline execution ledger | Integration platform | reuse definition-neutral ledger |
| LINE signature, binary retrieval and Reply API | zuri-cli transport owner | accept trusted artifact handoff only |

## Scope and authorization

Every owned row carries `tenantId` and `businessId`. The server derives them from a
trusted viewer and selected visible Business. Payload, workbook, prompt, OCR result,
LINE event or QR code cannot establish or widen scope.

The stable domain route key is `assets`; the canonical entry path is `/assets`.
The first foundation surface is a Business-scoped dashboard and preview-only intake
validator. Mutation roles and approval policy are expanded only by declared FRs.

## Aggregate invariants

- Internal keys are UUIDs; Asset ID, serial, lot, PO and payment references are not
  primary keys.
- An Asset ID is unique inside one Business and is never recycled.
- Original evidence remains linked after extraction or human correction.
- Procurement-origin approval requires payment proof plus PR and PO references.
- Expiry-controlled categories require a lot and expiry date.
- Responsibility, location and Project allocation changes close one interval and
  append the next; history is never overwritten.
- Exclusive Project allocations cannot overlap.
- OCR/Vision output is a candidate and can never approve itself.
- Depreciation candidates can be previewed/reviewed but cannot post journals.
- Meaningful writes are transactional, versioned and append `AuditEvent` evidence.

## Intake contract

Web, REST, Excel/CSV, Google Sheet, Agent/MCP and LINE OA/LIFF converge on the same
strict `AssetIntakeEnvelope`. The pipeline definition is
`DPL-ASSET-REGISTER-IMPORT-V1` under execution contract
`EXC-ASSET-REGISTER-IMPORT-V1`. It reuses the shared pipeline ledger but not the
knowledge pipeline's identity.

## Source layout

```text
src/modules/asset-management/
├── application/       validation and review use cases
├── domain/            strict vocabularies, schemas and calculations
└── index.js            stable module exports
```

Runtime surfaces are under `/assets` and `/api/assets`. The domain must not import a
page/route to reach another domain's private repository; cross-domain work uses an
explicit contract or read projection.

## Delivery state

The foundation declares and locally proves the canonical contract, validation,
pipeline identity, schema shape, backup coverage and dashboard. Provider-backed OCR,
LINE binary handoff, Google Sheets live sync, Procurement lookup, Finance posting and
Project Inventory projection are gated adapters, not implied by this status.

## References

- [CR-014](../../change-requests/CR-014-ASSET-MANAGEMENT-DOMAIN.md)
- [ADR-055](../../decisions/ADR-055-ASSET-MANAGEMENT-DOMAIN-AND-PHYSICAL-ASSET-LIFECYCLE-BOUNDARY.md)
- [ZV2-CR-009](../../changes/ZV2-CR-009-ASSET-MANAGEMENT-DOMAIN.md)
- [Context map](CONTEXT-MAP.md)
- [FR-133 foundation feature](features/FR-133-asset-management-foundation.md)

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-01 | active-foundation | Established Asset Management ownership, scope, invariants, intake convergence and explicit external boundaries | working-tree | Codex |
