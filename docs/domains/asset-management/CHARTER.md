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
  - AssetExtractionJob
owns_routes:
  - src/app/api/edge/extraction-jobs/**
technical_owner: TD-ASSET-MANAGEMENT
status: active-evidence-intake-beta
version: "1.3.0b"
created_at: "2026-09-01T00:00:00+07:00"
updated_at: "2026-09-06T13:30:00+07:00"
---

# Asset Management domain charter

## Mission

Asset Management is the Business-scoped authority for the physical identity and
operational lifecycle of company assets: evidence-backed intake, registration,
custody, use, location, project allocation, maintenance/stocktake/disposal history
and the handoff of reviewable financial facts.

The domain answers eight operational questions across its lifecycle (SRS.md):

1. What physical unit or controlled lot is this?
2. Which evidence, procurement references and human decisions prove its intake?
3. Who is currently accountable, who holds custody, and who is actually using it?
4. Where is it physically located right now, and where has it been?
5. Which Project or Workstream is using it, and under what condition was it returned?
6. What is its maintenance schedule, calibration record, and service history?
7. Is it physically present where the records say it is?
8. How was it decommissioned or disposed of, and what depreciation schedule did it follow?

## Subdomain Taxonomy

```text
Asset Management (DOM-ASSET-MANAGEMENT)
├── 1. Receiving & Evidence Intake (Web, API, Excel/Sheet, Agent, LINE)
├── 2. Register, Identity & Tagging (AST-YYYY-*, QR lookup, Tag printing)
├── 3. Custody & Location Management (Accountable, Custodian, User, Handover)
├── 4. Project & Workstream Allocation (Project booking, return condition)
├── 5. Maintenance, Warranty & Service (Preventive schedule, tickets, costs)
├── 6. Stocktake & Physical Audit (Campaigns, mobile QR scan, reconciliation)
├── 7. Decommissioning & Disposal (Scrap, sell, donate, loss proof)
└── 8. Depreciation Candidate Handoff (Deterministic straight-line preview)
```

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
- `AssetExtractionJob` (FR-143, ADR-059) — the queued unit of work that lets the
  customer-premise Zuri Edge Device execute FR-138 extraction. The domain owns the
  job's lifecycle (QUEUED → CLAIMED → COMPLETED | FAILED | CANCELLED), its 10-minute
  lease and its result; it does **not** own the device's identity, which is
  identity's `EdgeDeviceCredential` (FR-144).

## Explicitly not owned

| Concept | Authority | Asset behavior |
|---|---|---|
| `FileAsset` bytes/storage metadata | existing file-management authority | reference only |
| Supplier, PR, PO, GRN and procurement return | Procurement (`docs/domains/procurement/CHARTER.md`, FR-160 / FR-161 — `Supplier`, `PurchaseOrder`, `GoodsReceipt` exist since 2026-09-07); PR and returns still future | typed reference only — `AssetProcurementRef.value` may name a Procurement code, but stays a string until a later FR resolves it |
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
The foundation surface is a Business-scoped dashboard and preview validator. FR-137
adds Business-owner or `ASSET_RECEIVER` intake writes; FR-138 adds owner or
`ASSET_REVIEWER` review writes. Neither role can widen Business scope, create a
RegisteredAsset, mutate Procurement or post Finance records.

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
├── import/            Excel and bounded Sheet snapshot adapters
├── infrastructure/    provider adapters behind Asset-owned ports
└── index.js            stable module exports
```

Runtime surfaces are under `/assets` and `/api/assets`. The domain must not import a
page/route to reach another domain's private repository; cross-domain work uses an
explicit contract or read projection.

The device-authenticated extraction routes are a separate family,
`/api/edge/extraction-jobs/**` (claim · evidence · complete · fail), and are the one
place in this domain where the caller is **not** a session viewer: they authenticate
through identity's `resolveEdgeDeviceContext` (FR-144) and are scoped to the Business
of the presented credential. They are named in `owns_routes` because they sit outside
the `/api/assets` prefix and would otherwise fall to project-manager's
`src/app/api/**` catch-all. `GET .../[id]/evidence` streams bytes to the
lease-holding device only and never hands out a bucket URL, signed link or storage
credential (SEC-025, ADR-041 D3).

## Delivery state

The foundation declares and locally proves the canonical contract, validation,
pipeline identity, schema shape, backup coverage and dashboard. CR-015/ADR-056 adds
the beta evidence intake execution lane: private managed-object evidence, candidate
OCR/Vision with human review, Excel/bounded Sheet snapshot import-export and trusted
LINE FileAsset handoff. FR-143/ADR-059 delivers pull-based on-premise Edge extraction.
SRS.md (v0.3.0) specifies the complete 8-subdomain physical lifecycle: Registration &
Tagging, Custody Handover, Project Allocation Return, Maintenance, Stocktake, Disposal,
and Finance candidate handoff.

## References

- [SRS — Software Requirements Specification](SRS.md)
- [DATA-PIPELINE — Pipeline Specification](DATA-PIPELINE.md)
- [CR-014](../../change-requests/CR-014-ASSET-MANAGEMENT-DOMAIN.md)
- [ADR-055](../../decisions/ADR-055-ASSET-MANAGEMENT-DOMAIN-AND-PHYSICAL-ASSET-LIFECYCLE-BOUNDARY.md)
- [ZV2-CR-009](../../changes/ZV2-CR-009-ASSET-MANAGEMENT-DOMAIN.md)
- [Context map](CONTEXT-MAP.md)
- [FR-133 foundation feature](features/FR-133-asset-management-foundation.md)
- [CR-015 evidence execution](../../change-requests/CR-015-ASSET-EVIDENCE-INTAKE-EXECUTION.md)
- [ADR-056 cloud and extraction boundary](../../decisions/ADR-056-ASSET-EVIDENCE-CLOUD-AND-EXTRACTION-BOUNDARY.md)
- [FR-137 evidence execution feature](features/FR-137-asset-evidence-intake-execution.md)
- [ADR-059 edge-executed evidence extraction](../../decisions/ADR-059-EDGE-EXECUTED-EVIDENCE-EXTRACTION.md)
- [FR-143 edge-executed extraction feature](features/FR-143-edge-executed-evidence-extraction.md)

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.3.0b | 2026-09-06 | active-evidence-intake-beta | Refined 8-subdomain lifecycle architecture and added SRS.md reference | working-tree | Gemini (Antigravity) |
| 1.2.0b | 2026-09-04 | active-evidence-intake-beta | Claimed `AssetExtractionJob` and the device-authenticated `/api/edge/extraction-jobs/**` route family for FR-143 / ADR-059 | working-tree | Claude Code |
| 1.1.0b | 2026-09-02 | beta | Added receiver/reviewer capabilities and the provider-neutral evidence, extraction, workbook/snapshot and LINE handoff execution lane | working-tree | RWANG |
| 1.0.0 | 2026-09-01 | active-foundation | Established Asset Management ownership, scope, invariants, intake convergence and explicit external boundaries | working-tree | Codex |
