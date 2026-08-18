---
version: "0.1.0b"
created_at: "2026-08-18T20:00:18+07:00,ATHER"
last_update: "2026-08-18T20:00:18+07:00,ATHER"
status: "candidate"
attributes:
  domain: "crm"
  doc_type: "root-cause-analysis"
  scope: "FR-078 customer review adapter"
---

# RCA - Customer review adapter drifted between local and Postgres paths

## Complexity and risk

- **Complexity:** C-2 - cross-adapter contract and API semantic fix
- **Risk:** HIGH - customer identity decisions and audit/version integrity

## Symptom

The production customer-review adapter could repeat a decision version on a
second decision, return an empty target label for `LINK_EXISTING`, and report
`applied: true` even though the operation only appended a decision and did not
publish a Customer.

## Evidence

- The local Prisma path stores and reads `decisionVersion`, while the Postgres
  path selected `decision_version` and then read the mapped object using the
  snake_case name again.
- The Postgres target query selected `c.display_name` but returned raw rows;
  the service expects `displayName`.
- The decision service returned `applied: true` together with
  `publishesCustomers: false`.
- The new regression tests first failed on all three behaviors, then passed
  after the adapter normalization and response contract changes.

## Root Cause

The adapter boundary did not normalize PostgreSQL snake_case rows before the
shared service contract consumed them. The version calculation therefore used
two different field conventions, while target lookup exposed a database field
name to a camelCase service. The response reused an apply-oriented flag even
though the review extension intentionally has a separate no-publish apply gate.

## Why the issue escaped detection

The existing service tests used an in-memory fixture already shaped like the
Prisma camelCase output. No test exercised the Postgres row shape or a second
decision version. The response test asserted the ambiguous `applied` field
without asserting that it meant decision-recorded rather than customer-applied.

## Proposed prevention

1. Normalize all Postgres adapter rows at the adapter boundary.
2. Use one version-increment helper for both local and Postgres paths.
3. Test first and second decision versions, snake_case target mapping and the
   no-publish response semantics.
4. Keep the approved base contract version separate from the candidate review
   extension version; do not promote the extension without its own gate.
5. Keep the separate owner/data-security apply gate before any Customer or
   Analytics publication.

## Acceptance criteria

- A second decision receives version `2` rather than repeating version `1`.
- Postgres target rows expose `displayName` to the service/UI boundary.
- The decision response says `decisionRecorded: true`,
  `applyRequired: true`, and `publishesCustomers: false`.
- No Customer row, Analytics aggregate or review decision is written by this
  RCA change itself.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | candidate | Captured local/Postgres adapter drift in the customer review decision path | working-tree | ATHER |
