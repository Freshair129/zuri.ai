---
version: "1.0.0"
created_at: "2026-09-06T23:50:00+07:00,Claude Fable 5.1"
last_update: "2026-09-06T23:50:00+07:00,Claude Fable 5.1"
status: "accepted"
superseded_by: null
attributes:
  domain: "crm"
  doc_type: "architecture-decision"
  scope: "the legacy ERD's Task, reframed as a CRM sales activity record (SalesTask) and kept apart from project-manager's WorkItem"
---

# ADR-064 — Sales Tasks Are a CRM Activity Record, Not a Project Task

**Status:** Accepted. Implemented by FR-161 (FEAT-022) in the same change.
**Date:** 2026-09-06
**Decided by:** Boss (instruction of 2026-09-06: "ดัดแปลง 7. CORE: Tasks เป็น task ของ sale
เดี๋ยวปนกันกับ projectmanager" — adapt the legacy Tasks section into *sales* tasks, or it
will be confused with project-manager)
**Relates to:** [ADR-054](ADR-054-LEGACY-ERD-IS-PRIOR-ART-FOR-CRM-INTELLIGENCE.md) (D3, D4, D5),
[ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md) (D7), FR-161, FEAT-022, BR-001,
BR-002, FR-061, FR-072, FR-076, `docs/domains/crm/CHARTER.md`,
`docs/architecture/database-erd/full-schema.md` §19.

## Context

The legacy product's ERD (`Freshair129/zuri1.0`, §7 "CORE: Tasks") has one `Task` table
that mixes three things: a salesperson's follow-up (FOLLOW_UP / CALL / EMAIL / MEETING /
DEMO, tied to a Customer and an assignee), a calendar item (SINGLE with a time window,
RANGE with start and due dates), and a small project (`taskType: PROJECT` with a
`milestones[]` JSON). ADR-054 D5 refused that table because the third thing is what
project-manager's `Project` / `Workstream` / `WorkItem` already are, with real progress
roll-up, gates and dependencies — a second, JSON-shaped copy would drift.

The owner's instruction separates the first thing from the third: the follow-up a
salesperson owes a customer is a **CRM activity**, and it was being lost between two
refusals. It has a customer, an assignee, a due day, an outcome; it has no progress,
no gates, no children. Putting it under project-manager would confuse two vocabularies
that both happen to contain the word "task".

## Decision

### D1 — A sales task is a CRM record

`SalesTask` lands under the crm charter as its fifth narrow writer. It is
Business-scoped (the team that owes the follow-up), optionally linked to a `Customer`
and a `Conversation` of the same Tenant — reached through the Business's tenant only,
the same BR-001 bound `conversation-read-model` reads through (ADR-054 D3) — and
optionally assigned to a `Person` who holds an ACTIVE Membership covering the
Business. Its identity is an internal UUID with a generated human code
`TSK-YYYYMMDD-NNN` (BR-002).

### D2 — What survives from the legacy shape, and what is corrected on the way in

| Legacy `Task` | `SalesTask` | Why |
|---|---|---|
| `type` FOLLOW_UP · CALL · EMAIL · MEETING · DEMO | `type` + `LINE_MESSAGE`, `QUOTE` | LINE is this product's primary surface; a quote is the commonest sales step |
| `status` PENDING · **URGENT** · IN_PROGRESS · COMPLETED · CANCELLED | `status` OPEN · IN_PROGRESS · DONE · CANCELLED; `priority` URGENT · HIGH · NORMAL · LOW | URGENT is a priority, not a state; L1–L4 become words |
| `taskType` SINGLE · RANGE | `scheduleKind` SINGLE (one day, optional `timeStart`/`timeEnd`) · RANGE (`startDate` → `dueDate`) | kept as the calendar needs it |
| `taskType` **PROJECT** + `milestones[]` | **refused** | that is a `Project` in project-manager (ADR-054 D5 stands for this half) |
| `assigneeId` → Employee | `assigneePersonId` → `Person` with a covering Membership | there is no Employee here (ADR-054 D5) |
| `createdById` → Employee | `createdByPersonId` (the viewer's principal, scalar) | the audit row is the authority on who acted |
| `notionId` (bidirectional sync) | **not a column** | an external id belongs in `ExternalRef` when a sync exists (BR-002, ADR-054 D4) |
| overdue / due-today | **computed on read** against the Business calendar (Asia/Bangkok) | a stored "overdue" is a fact about yesterday's now |

### D3 — Authority

Reading needs Business visibility plus the `customer` domain grant (FR-061) and answers
the FR-072 404 without it — the same order `customer-consent-service` uses, so a
principal never learns from a status code that a Business is real and merely
unlicensed. Writing needs Business OWNER or the new `SALES_REP` role binding
(permission `crm.sales-task.write`, FR-076 pattern); a member who holds the domain but
not the role gets an honest 403.

### D4 — The status machine and the write discipline

OPEN → IN_PROGRESS → DONE; OPEN | IN_PROGRESS → CANCELLED; DONE | CANCELLED → OPEN
only through REOPEN. UPDATE and ASSIGN are refused on a closed task. Every action is a
compare-and-swap on `version` with one audit row; nothing is deleted.

### D5 — What this does not decide

The LINE intake of a sales task ("บอทสร้างงานติดตามให้จากแชท") is a converter onto this
writer, not a second writer; it follows as its own FR. Reminders and push notifications,
Notion or calendar sync, and any per-task revenue attribution wait for their own
decisions.

## Consequences

- `docs/domains/crm/CHARTER.md` claims `SalesTask`; the ERD §19 row for the legacy
  "7. CORE: Tasks" changes from *target* to *built, relabelled*.
- ADR-054 D5's refusal of `Task` is narrowed, not reversed: the PROJECT half is still
  project-manager's; the sales half now has a home.
- A reader looking for "tasks" finds two vocabularies on purpose: `WorkItem` under
  Development, `SalesTask` under CRM, and this ADR says why.
