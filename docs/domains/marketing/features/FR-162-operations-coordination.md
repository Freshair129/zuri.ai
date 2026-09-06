---
feature: FR-162
module: marketing
source: v2-native
domain: marketing
version: "0.1.1b"
created_at: "2026-09-07T09:40:00+07:00,RWANG"
last_update: "2026-09-07T09:40:00+07:00,RWANG"
status: beta
superseded_by: null
---

# FR-162 — Marketing Operations coordination

## Purpose

Marketing Operations gives the team one scoped place to see requests, delivery
dates, review decisions and cross-domain handoffs. It composes records owned by
Marketing and its owner domains; it does not become a task, conversation, stock
or provider database.

## Surface contract

The collection route is `GET /api/growth/operations?businessId=<id>` and returns
one aggregate DTO with `businessId`, `generatedAt`, `canWrite`, bounded rows for
`intake`, `calendar`, `approvals` and `handoffs`, plus per-section `state`,
`source`, `lastUpdated`, `warnings` and `truncated`. The page is
`/growth/operations` with the URL tabs `intake`, `calendar`, `approvals` and
`handoffs`. These tabs are one keyboard-addressable tab row; no second tab bar is
introduced inside a tab.

The detail routes are:

- `GET/PATCH /api/growth/operations/intake/:intakeId` and
  `/growth/operations/intake/:intakeId` for a Business-scoped intake record.
- `GET /api/growth/operations/handoffs/:handoffId` and
  `/growth/operations/handoffs/:handoffId` for a validated handoff receipt.
- `POST /api/growth/operations` creates an intake from the new-intake form.

## Ownership and source boundaries

`MarketingOperationsIntake` is a Business-scoped request record. Marketing is
its only writer. Its fields are the request title, capability, objective,
required date, evidence reference, responsible owner reference, lifecycle
status and optimistic `version`; create/update/archive each write one
`AuditEvent`. Business ownership and `growth` visibility are resolved from the
server viewer, never from a client-selected tenant or owner.

Calendar rows come from the protected Project Manager `getProjectRoadmap`
owner port and retain the PM project/workstream/container/item IDs. Marketing
does not copy or update those records. Approvals are derived from current
Marketing Plan and Content review/decision evidence. Handoffs are derived from
the validated Marketing-to-PM execution receipt and its owner-domain status;
invalid, stale, missing or out-of-scope receipts are returned as an explicit
unavailable state.

The aggregate must not call provider APIs or write Commerce stock, CRM
conversations or Project Manager work. Meta, TikTok, Instagram, GA4 and SEO
remain planning/source selectors owned by their existing Integration or
measurement contracts.

## State and guard rules

Each section reports `READY`, `EMPTY`, `PARTIAL`, `STALE`, `UNAVAILABLE` or
`FORBIDDEN` with a human-readable warning. Zero is shown only when a source was
actually measured. Detail readers verify the returned row identity and
`businessId` before rendering. A Business switch clears old IDs and the
collection remains safe on reload, browser Back and copied URLs.

## Acceptance

1. A Business owner can create, update and archive an intake with an expected
   version; stale writes return a conflict and no partial audit/write occurs.
2. One collection response renders all four Operations tabs without duplicate
   PM tasks, conversations or stock records.
3. Calendar rows are authorized PM roadmap projections, and Handoff rows are
   authorized receipts with exact source IDs and explicit unavailable states.
4. Tests cover scope refusal, CAS conflict, audit, source-state mapping, route
   identity guards and the tab/form/detail UI contracts.

## Out of scope

PM task creation/import, CRM message creation, Commerce or inventory mutation,
provider activation/spend/publishing, automatic approval, and live SmartGift
Project Manager imports remain separate owner-authorized work.
