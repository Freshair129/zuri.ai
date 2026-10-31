---
status: implementation-plan
version: "0.1.0"
---

# Office design receiver implementation plan

**Goal:** Register the existing Office design handoff in a scoped Zuri DB without creating runtime Agents or approvals.

**Architecture:** Business module service, pinned producer validation worker, Prisma registry repository and existing persisted-session route identity. Immutable design revisions and GLB bytes commit with crosswalks, receipt and audit.

**Spec:** [Owner scope and contract](../change-requests/project-manager/office-design-receiver-20261031.md).

## Tasks

- [x] Pin producer source/schema/provenance and real ZIP fixture. Add failing package/HTTP persistence tests; establish existing identity/import baseline.
- [x] Implement bounded worker verification and schema/DB models under `apps/server/src/modules/business/office-design/`; generate PostgreSQL schema and additive SQL migration. Test graph/custom GLB/hash refusals and real DB persistence.
- [x] Add authenticated POST/GET and asset GET routes under `api/businesses/[id]/office-designs`; implement target authorization, transactional CAS, stable internal IDs, idempotency and audit. Test full HTTP lifecycle, cross-scope/revocation, rollback/concurrency and DB reopen.
- [x] Run relevant regressions, build, disposable PostgreSQL, docs generators/governance and independent whole-patch review. Record actual results and remaining limits; preserve unrelated primary checkout/runtime state. See the [local verification report](../../reports/office-design-receiver-20261031.md).

## Review focus

Reject body-controlled scope and executable/network resources. Verify empty/oversized/truncated ZIPs, rehashed semantic tampering and measured custom dimensions. Check simultaneous initial imports and retry after commit, stable crosswalks across revisions, revoked authority, no phantom Agent/approval rows, no shared DB target and no successful partial registration.
