---
version: "1.1.0"
created_at: "2026-09-01T00:00:00+07:00,Codex"
last_update: "2026-09-01T00:00:00+07:00,Codex"
status: "accepted-planning"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "change-request"
  scope: "Cross-cutting delivery envelope for the Asset Management domain across documentation, navigation, authorization, schema, API, UI, audit, backup and tests"
---

# ZV2-CR-009 — Asset Management domain delivery

**Status:** Accepted as a planning and change-control envelope. Runtime work remains
gated by Phase 3 global requirements and tests.

**Date:** 2026-09-01

**Owner:** Boss

**Source proposal:** [`CR-014`](../change-requests/CR-014-ASSET-MANAGEMENT-DOMAIN.md)

**Architecture decision:** [`ADR-055`](../decisions/ADR-055-ASSET-MANAGEMENT-DOMAIN-AND-PHYSICAL-ASSET-LIFECYCLE-BOUNDARY.md)

**Execution plan:** [`PLAN-ASSET-MANAGEMENT-4-PHASES.md`](../roadmap/PLAN-ASSET-MANAGEMENT-4-PHASES.md)

## 1. Purpose

Provide one bounded change record for the work that crosses documentation, domain
navigation, authorization, Prisma schema, application services, API routes, UI,
audit, backup/restore and tests when Zuri adds Asset Management.

This document is not a second requirement registry and not a mutable substitute for
FR/FEAT/SDD/SEC IDs. Phase 3 declares those immutable behaviors before code is
written.

## 2. Scope

### Included in the first implementation slice

- `DOM-ASSET-MANAGEMENT` / `TD-ASSET-MANAGEMENT` identity projection.
- Business-bound visibility and guarded `/assets` route family.
- Receiving and physical inspection of durable equipment.
- Approval and concurrency-safe company Asset ID issuance.
- `RegisteredAsset` register list, detail and search.
- Custody assignment and transfer with immutable history.
- AuditEvent entries for meaningful lifecycle transitions.
- Safe QR/barcode label representation.
- SQLite/Postgres schema parity, migration, backup/restore treatment and tests.
- Thai back-office UI using the existing Zuri shell and design system.

### Explicitly deferred

- authoritative accounting capitalization, depreciation or journal posting;
- a complete external Procurement connector when no runtime contract exists;
- a complete HR/offboarding connector when no runtime contract exists;
- maintenance, stocktake and disposal beyond the FRs actually declared for the slice;
- network sync, service extraction or an independent asset database;
- a native mobile application;
- `assets.zuri.ai`.

## 3. Affected ownership boundaries

| Boundary | Change | Single writer after change |
|---|---|---|
| Asset lifecycle | New owned aggregate and histories | Asset Management |
| Supplier/PO/GRN | Reference only; no write transfer | Commerce / Procurement |
| Person/Membership | Reference only; no write transfer | Existing People/Identity authority |
| Viewer/RBAC | Reuse established server-side viewer | Platform / Identity |
| AuditEvent | Append through established audit seam | Existing audit authority called by Asset application service |
| FileAsset | No semantic or ownership change | Project Manager/file-management authority |
| Accounting | No authoritative implementation in MVP | Future Accounting / Finance |

## 4. Anticipated file/change inventory

The exact inventory is frozen only after Phases 1 and 2 enumerate the live tree.
Expected change classes are:

### Documentation sources

```text
docs/decisions/ADR-055-...
docs/changes/ZV2-CR-009-...
docs/roadmap/PLAN-ASSET-MANAGEMENT-4-PHASES.md
docs/domains/asset-management/CHARTER.md          (atomic with its module)
docs/PRD-SDD-v1.0.md                              (Phase 3)
docs/FEATURES.md                                  (Phase 3)
docs/SITEMAP-DOMAIN-NAV.md                        (Phase 3)
docs/roadmap/ROADMAP.md                           (Phase 3 delivery row)
```

Generated views update only through `npm run govern`.

### Runtime candidates

```text
src/config/domains.js
src/modules/asset-management/**
src/app/(pm)/assets/**
src/app/api/assets/**
src/lib/validation/enums.js
prisma/schema.prisma
prisma/schema.postgres.prisma
prisma/migrations/**
tests/unit/**asset**
tests/integration/**asset**
tests/e2e/**asset**
```

This list is an impact hypothesis, not authority to create every path.

## 5. Migration and compatibility

### Additive migration rule

- New physical-asset tables and indexes are additive.
- No existing table is dropped or repurposed.
- `FileAsset` remains unchanged in name, meaning and ownership.
- A migration must be tested against a copy of a populated database as well as a clean database.
- SQLite and Postgres schema bodies remain in parity under the repository's generator/validation workflow.

### Existing data

The first slice does not infer `RegisteredAsset` rows from `FileAsset`, Project
Inventory, Product or seed files. Any future import is a separate intake requirement
following validate → dry run → preview → transaction → audit.

### External references

PO, GRN, Supplier serial number, invoice number and external system identifiers are
references, never primary keys. A missing Procurement runtime may be represented by
an authorized typed reference or non-PO intake; the Asset domain must not invent a
parallel Procurement source of truth.

## 6. Security and authorization inventory

The implementation requirements and tests must prove:

1. Tenant and Business scope come from the server viewer/context, never request body authority.
2. Cross-Business list, detail and mutation attempts fail closed.
3. Domain visibility and deep-link route authorization use the same predicate.
4. Asset code issuance is safe under concurrent requests.
5. QR/barcode possession grants no permission.
6. Label/export payloads exclude unnecessary internal IDs, cost and personal data.
7. Lifecycle transitions are role/capability checked and append audit evidence.
8. Disposed Asset IDs are not recycled.
9. Person/Branch deletion or deactivation does not erase historical custody/location evidence.

## 7. Test and verification inventory

The four-phase plan must produce:

- unit tests for navigation, validation, state transitions, schema contract and API/UI contract;
- integration tests for registration transaction, uniqueness, rollback, audit and Business isolation;
- end-to-end tests for authorized and denied workflows plus responsive navigation;
- migration/parity and populated-database verification;
- backup/export/restore policy tests for any persisted model;
- final `npm run verify` evidence with no new skipped or flaky tests.

## 8. Rollback strategy

### Before runtime migration

Revert the documentation branch. No product state exists.

### After code but before production data

Disable the Business module projection, remove routes/module code and revert the
additive migration through a reviewed migration. Do not use reset commands against a
user database.

### After production data exists

Do not drop physical-asset tables as a routine rollback. Disable writes/navigation,
retain readable/auditable data, export if required and deliver a separate retirement
or migration change record. Asset IDs and disposal history remain non-recyclable.

## 9. Phase gates

| Phase | Gate | Required evidence |
|---|---|---|
| 1 — repository survey | Baseline understood | enumerated structure report; baseline test/build/govern result |
| 2 — relevant survey | Boundaries and writing topology fixed from evidence | impact report; ownership/threat/test matrices; MVP file hypothesis; exact `ADD`/`UPDATE`/`GENERATE`/`NO CHANGE` document tree accepted by the owner |
| 3 — docs + tests first | Requirements attributable | pinned IDs; source docs; generated views; intentional focused RED evidence |
| 4 — implementation + verification | Ready to deliver | focused GREEN; full tests/build/govern/e2e; migration and denial evidence |

Phase 3 RED is a test-first checkpoint inside the same working branch, not a mergeable
state. Only Phase 4 GREEN may be submitted.

## 10. Completion

This change record is complete only when:

- ADR-055 remains the accepted boundary or is explicitly superseded;
- every runtime behavior is declared under global IDs and pinned by the ledger;
- the Asset domain has one charter and one technical owner;
- the receiving → approval → Asset ID → register path works;
- Business isolation, audit, history and non-recycling invariants are proven;
- `FileAsset` semantics and existing behavior remain intact;
- `npm run verify` passes;
- the Phase 4 report records commit SHA, migrations, test counts and limitations.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.1.0 | 2026-09-01 | accepted-planning | Required an explicit, owner-reviewed documentation topology before Phase 3 writes source documents or tests | working-tree | Codex |
| 1.0.0 | 2026-09-01 | accepted-planning | Created the cross-cutting delivery, migration, compatibility, authorization, rollback and verification envelope for ADR-055 | working-tree | Codex |
