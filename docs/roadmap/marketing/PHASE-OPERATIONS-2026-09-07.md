---
phase: marketing-operations
status: locally-verified
date: 2026-09-07
owner: RWANG
scope: "MKT-W1-OPERATIONS; FR-161; MKT-UI-044, MKT-UI-045, MKT-UI-046, MKT-UI-047, MKT-UI-069, MKT-UI-070, MKT-UI-082"
version: "0.1.0b"
created_at: "2026-09-07T09:40:00+07:00,RWANG"
last_update: "2026-09-07T09:40:00+07:00,RWANG"
---

# Marketing Operations phase evidence

This phase delivers the Operations composition boundary for the Marketing domain. It keeps Marketing-owned
Intake records in the Marketing schema while reading PM-owned roadmap data through the existing owner port.
The aggregate exposes Intake, Calendar, Approvals and Handoffs with explicit source states and does not create
a second task, conversation, stock, campaign-provider or CRM system.

## Verified behavior

- Intake is Business and Tenant scoped, requires an active responsible owner when supplied, persists a version,
  and records create/update/archive AuditEvents.
- Update and archive use optimistic compare-and-set on the current version; a stale version returns a conflict
  without mutating the record.
- Calendar is projected from the PM roadmap owner port and deduplicated by stable project, workstream and work
  item identity. Marketing does not write PM tasks or calendar rows.
- Approvals are read from existing Marketing plan reviews and decisions. Handoffs use validated owner receipts;
  an unavailable PM owner read remains visible as `UNAVAILABLE` rather than becoming fake completion.
- Every detail route guards the requested Business identity, and the UI keeps the four tabs in one Operations
  shell with distinct empty, unavailable, partial and error states.

## Evidence

- Contract and UI tests: `apps/server/tests/unit/marketing/marketing-operations-contract.test.js`,
  `marketing-operations-route.test.js`, `marketing-operations-service.test.js`, and
  `marketing-operations-ui.test.js`.
- Persistence and scope integration: `apps/server/tests/integration/marketing-operations.test.js`.
- SQLite migration: `apps/server/prisma/migrations/20260907090000_marketing_operations/migration.sql`.
- Supabase migration: `apps/server/supabase/migrations/20260907090000_marketing_operations.sql`.
- Service contract: `apps/server/src/modules/marketing/application/marketing-operations-service.js`.

## Remaining gate

This is local implementation evidence, not live PM intake evidence. SmartGift remains the requested Business
name, but the target Zuri instance, Workspace and authenticated user identity are still unresolved. No server
Project Manager import, live PM mutation or external provider action is claimed by this phase.
