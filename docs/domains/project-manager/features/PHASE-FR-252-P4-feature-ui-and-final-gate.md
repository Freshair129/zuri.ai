---
id: ZAI:FR-252-P4
title: Feature UI and final verification
parent_requirement: FR-252
phase_id: FR-252-P4
phase_order: 4
domain: project-manager
version: "0.5.0b"
status: beta
created_at: "2026-09-17T02:46:11+07:00,RWANG,approved e5ccfd7a"
last_update: "2026-09-17T20:28:51+07:00,RWANG final integrator"
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# FR-252-P4 — Feature UI and final verification

## Entry condition and predecessor

W3 read/UI work may run in parallel on frozen DTOs after P1; W5 create/edit/binding forms require P3 writers and P2 CSRF. Preserve one writer for navigation and shared contracts. W6 consumes immutable implementation packets.

## Input

Approved plan24 wireframes/state matrix, FR-250 navigation, FR-251 Domain view and Feature API fixtures. Reuse the authorized Project shell; keep Business planned disclosures and all seven Work views.

## Output and next handoff

One Features entry under Project Delivery Design, accessible list/detail drawer, authorized create/edit/binding forms, lifecycle/restore and allocation explanations with honest unavailable states. Independent Luna Max verification precedes root W7 composition, governance, tests, build and browser checks.

## Failure, retry and acceptance

Prove loading/empty/error/stale Project transitions, redacted refusal, optimistic conflict handling, successful receipt then re-read, keyboard/focus/Back behavior and 390px layout. Existing Inventory/Team/Import/navigation/progress regressions remain gates. Report local, hosted CI and production separately; actual RLS/grant/isolation evidence and separately authorized release are required before production writes.

Current state: LOCAL_IMPLEMENTATION_PASS_HOSTED_RELEASE_PENDING. The Feature list/detail shell and
dd.features navigation are implemented. Composed W3 browser evidence passes
21 cases with zero flaky outcomes after the documented rendering/locator
corrections; the narrow correction has an independent Luna Max PASS.

W5 owner forms now target the composed W4 writers and snapshot capture service.
The owner-only aggregate ETag controls presentation of owner actions, while the
server rechecks actual authority for every write. UI verification must include
CSRF, stable retry intent, CAS conflicts, exact snapshot/receipt identity,
relationship/delete/restore flows and actual transport persistence. W3's pass
does not prove these later forms. The first actual browser/CSRF/API/SQLite
create/edit/delete/restore flow passes. Its companion mocked delete journey
failed because the fixture returned PUT in a DELETE receipt; strict runtime
validation is retained and the fixture is corrected before rerunning.

The independently identified section 7 gaps are closed in the frozen source:
canonical Domain and scoped WorkItem pickers, per-item allocation total/remainder,
review summaries, uncertain-intent retention across dialog closure and parent
reload, linked/focused field errors, monotonic lifecycle and read-only requirement
subjects. Parent loading/refusal masks cached detail. Only the active dialog owns
modal semantics and focus; stale callbacks cannot close a different action.
An independent Luna Max source review passes, focused Forms/picker tests pass
25/25, the final full Server suite passes 6376 tests (32 skips), and the final
optimized build passes. Browser coverage closes through 45 passing checks
(including warmup) and a separate passing privacy regression after its one-line
locator correction. Both runs have zero skips/flaky outcomes; the composed
45-pass/one-failure report is retained as FAIL, not relabelled as a full pass.
Only that browser test file changed between runs; product source is identical.
The earlier 42-pass/four-failure run and its RCA are also preserved. Final
governance results are recorded in the integration report. CRM's narrow service closure has its own independent PostgreSQL PASS.
See the [integration report](../../../../.brain/reports/2026-09-17-project-feature-phase-b.md)
for frozen proof and release boundaries.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.5.0b | 2026-09-17 | beta | Close approved UI conformance findings with independent source and 25-test proof; record final Server suite/build and retain exact browser/release gate status | 052821a7 + 892f23f3 | RWANG |
| 0.4.0b | 2026-09-17 | beta | Record actual owner transport journey, preserve strict receipt fixture failure, and track independently found UI conformance repairs before final verification | 052821a7 + 892f23f3 | RWANG |
| 0.3.0b | 2026-09-17 | beta | Record W3 browser/independent PASS and active W5 owner-form verification; distinguish historical reads from new write flows | 052821a7 + 892f23f3 | RWANG |
| 0.2.0b | 2026-09-17 | beta | Record passed P1 entry and disjoint W3 UI handoff; preserve W4 prerequisite for forms | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | beta | Register slice of the approved Phase B design; no new behavior | e5ccfd7a | RWANG |
