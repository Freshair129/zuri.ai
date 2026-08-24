---
domain: integration
feature: FR-100
module: integration
source: v2-native
version: "0.1.0"
status: proposed
---

# FR-100 — SoT approval inbox and decision export

## Rationale

The SoT pipeline stages thousands of extracted facts (price rows recovered from
ใบราคา PDFs, entity candidates, file classifications) that must be approved by a
human before they become servable truth — the knowledge charter's rule
("knowledge enters through governed import/approval") applied to business data.
Today those approvals happen in CSV files that nothing reads back: Boss approved
13 price rows in `price_approval.csv` and every one of `price_staging`'s 17,702
rows is still unapproved in the store. The loop is open exactly where it matters.

FR-100 closes it with one queue: the pipeline **submits** pending decisions, a
human **decides** in the browser, and the pipeline **pulls** decided items and
applies them to its own stores. zuri-ai never writes into DuckDB or the graph —
the data plane fetches decisions and applies them itself, which keeps Tier 1
inside the ADR-043 boundary during the approved interim (`:8888`) period.

## Contract

1. **One model.** `SotDecision`: tenant/business-scoped;
   `decisionType` ∈ {PRICE_ROW, ENTITY, FILE_CLASSIFICATION, PHASE_GATE};
   `subjectRef` (the data plane's stable key, e.g. staging row id or base code —
   an external id, never a primary key, BR-002); `phaseId` (links to FR-099);
   `payloadJson` (what is being approved, verbatim); `status` ∈
   {PENDING, APPROVED, REJECTED}; `decisionVersion` (a re-submitted subject gets
   a new version, the old row is never mutated); `decidedByPersonId`, `reason`,
   `auditEventId`, timestamps. Unique on
   (`tenantId`, `decisionType`, `subjectRef`, `decisionVersion`).
2. **Submit is idempotent.** `POST /api/platform/sot/decisions` (batch) upserts
   by identity; re-submitting an already-pending subject with an identical
   payload hash returns `UNCHANGED`, a changed payload creates the next
   `decisionVersion` as PENDING. `.strict()` Zod envelope (SEC-002).
3. **Decide is audited.** `POST /api/platform/sot/decisions/[id]/decide` with
   `{ decision: APPROVED|REJECTED, reason? }`. The viewer must hold Business
   authority (`viewer-authority`); the decision records who, when and why, and
   emits an audit event. A decided row is immutable — changing your mind means a
   new version submitted by the pipeline.
4. **Export is a pull.** `GET /api/platform/sot/decisions/export?since=<cursor>`
   returns decided rows in decision order with a stable cursor
   (`updatedAt` + id tiebreak). The data plane polls it, applies what it reads
   to DuckDB/graph, and remembers its own cursor. No push, no webhook, no
   zuri-ai write path into the substrate.
5. **Inbox surface.** `/platform/sot-pipeline/inbox` lists PENDING decisions
   filterable by type and phase, shows the payload with its provenance fields,
   and offers exactly two actions: approve, reject (with reason). Bulk approve
   is allowed only within one decisionType filter and is recorded as individual
   decisions.

## Not in scope

No automatic approval rules, no editing of the payload in the browser (a wrong
payload is rejected and re-extracted), no direct DuckDB/GenesisBlock access from
this repository, and no replacement of FR-078's customer-import review (that
queue keeps its own contract; FR-100 is the generic data-fact queue).
