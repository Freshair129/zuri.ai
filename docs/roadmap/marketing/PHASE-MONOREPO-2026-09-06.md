---
version: "0.1.0b"
created_at: "2026-09-06T22:35:00+07:00,RWANG,3f4fd4d2"
last_update: "2026-09-06T22:35:00+07:00,RWANG"
status: under review
superseded_by: null
attributes:
  domain: marketing
  doc_type: phase-report
---

# Marketing continuation on the published monorepo

Operations is the next approved Marketing slice. Before adding code, fetched main
5ab5df9f requires reconciliation: ADR-062 relocates Server into apps/server, and
Warehouse publishes IDs that this unpublished Marketing branch had independently
allocated. Complexity C-3, risk HIGH; user continuation covers this prerequisite.
No product scope, execution mode, permission, external action or production data changes.

## Plan and acceptance

1. Preserve published Warehouse subjects; move only this branch's unpublished IDs
   through the ledger writer's documented abandon path.
2. Merge main with rename-aware Git handling. Server code/tests/Prisma/migrations
   follow apps/server; canonical Marketing documents remain under root docs.
3. Regenerate ledgers/graphs with their owner tools, then validate Server tests,
   build, browser and combined governance. Preserve Edge snapshot provenance;
   never read device secrets or mutate the original Edge checkout.
4. Resume Operations only against the reconciled paths/contracts. Do not mark new
   Operations interfaces delivered merely because this integration passed.

| Previous unpublished Marketing ID | New Marketing ID | Published main authority retained |
|---|---|---|
| FR-154 PM handoff | FR-158 | FR-154 Inventory catalogue |
| FR-155 Strategy | FR-159 | FR-155 Inventory stock ledger |
| FR-156 Campaign | FR-160 | FR-156 Recipe / bill of materials |
| FEAT-020 Marketing | FEAT-021 | FEAT-020 Inventory |

FR-157 Content and SDD-086/087/088 remain unchanged. Historical validation in
previous phase reports remains evidence for its original commits, not proof that
the newly merged checkout passes. Local tracking remains 5 DONE /7 IN_PROGRESS/
35 PLANNED until another bounded capability is verified. SmartGift intake remains
unbound and has no actual server import receipt.

## Evidence

Reconciliation and verification in progress. No release, push or migration applied.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | under review | Record required published-main path and ID reconciliation | See git history | RWANG |
