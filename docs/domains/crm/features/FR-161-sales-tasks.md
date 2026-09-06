---
domain: crm
feature: FR-161
module: crm
source: legacy-prior-art
bundle: FEAT-022
requirements:
  - FR-161
version: "0.1.0"
status: building
---

# FR-161 — Sales tasks (งานขาย)

## Intent

The follow-up a salesperson owes a customer — a call, a LINE message, a
meeting, a demo, a quote — as a CRM record with a due day, an assignee and an
outcome. The legacy product's "7. CORE: Tasks" section, adapted on the owner's
instruction into a *sales* task so it cannot be confused with project-manager's
`WorkItem` ([ADR-064](../../../decisions/ADR-064-SALES-TASKS-ARE-A-CRM-ACTIVITY-NOT-A-PROJECT-TASK.md)).

## Decisions worth recording

**Fifth narrow writer of the crm charter.** `sales-task-service.js` is the only
writer of `SalesTask`, beside the ingest seam, the reply recorder, the consent
writer and the erasure writer. It follows the consent writer's gate order: the
`customer` domain first (a 404 for a viewer without the CRM, FR-072), then
Business OWNER or the new `SALES_REP` binding for a write (an honest 403).

**Linked through the tenant, never through the payload.** A task belongs to a
Business; its optional Customer and Conversation must be of that Business's
Tenant and visible to the viewer (the same BR-001 bound the inbox reads
through). A Conversation supplies its Customer when none is named and refuses
a different one (`CONVERSATION_CUSTOMER_MISMATCH`). An assignee must hold an
ACTIVE Membership covering the Business (`ASSIGNEE_NOT_MEMBER`).

**Legacy corrections at the border.** URGENT became a priority, PROJECT tasks
with milestones stayed refused, the Notion id is not a column, and overdue /
due-today are computed on read against the Business calendar
(`Asia/Bangkok`) rather than stored — the same reasoning as progress.

**A generated code, a versioned status machine.** `TSK-YYYYMMDD-NNN` per
Business per day; OPEN → IN_PROGRESS → DONE, cancel from either open state,
REOPEN out of a closed one; compare-and-swap on `version`, one audit row per
action, nothing deleted.

## Delivered (local, 2026-09-06)

- `SalesTask` in both schemas; migrations
  `prisma/migrations/20260906235000_crm_sales_task` and
  `supabase/migrations/20260906235000_crm_sales_task.sql` (**not applied**).
- `src/modules/crm/sales-task-domain.js` — contracts, status machine, code,
  due state, summary; `src/modules/crm/sales-task-service.js` — the writer
  and readers.
- `GET/POST /api/crm/sales-tasks`, `GET/PATCH /api/crm/sales-tasks/[id]`;
  the `/customer/sales-tasks` page; `SALES_REP` role
  (`crm.sales-task.write`); snapshot coverage after Customer and Conversation.
- Tests: `tests/integration/fr161-sales-task.test.js` (AC-161.1–.6),
  `tests/unit/sales-task-domain.test.js`, `tests/unit/sales-task-routes.test.js`,
  `tests/e2e/fr161-sales-tasks.spec.js`.

## Not in this slice

Creating a task from a LINE chat (a converter onto this writer, its own FR);
reminders and push notifications; Notion or calendar sync (`ExternalRef` when
it exists); a per-customer timeline on the Inbox; production application of the
migration (ADR-057).
