---
id: ZAI:FR-252-P3
title: Feature read and transactional mutation API
parent_requirement: FR-252
phase_id: FR-252-P3
phase_order: 3
domain: project-manager
version: "0.4.1b"
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

# FR-252-P3 — Feature read and transactional mutation API

## Entry condition and predecessor

P1 frozen repository ports for W3 reads; P1 plus P2 for W4 mutation admission. Root owns shared contracts. Service and API workers use disjoint allowlists, including the project-level feature-work-links route.

## Input

The exact 14-operation OpenAPI, Project hierarchy authority, canonical Domain IDs, Project/WorkItem/Repository references and approved snapshot verifier port. Body scope is untrusted; all receipt lookup/replay follows authorization.

## Output and next handoff

Scoped read aggregate/list/detail, base and complete-set mutations, graph redistribution, soft delete/restore, verified snapshot capture, atomic audit and typed durable receipts. UI consumes the frozen direct DTOs without inventing snapshots, status, progress or wrappers.

## Failure, retry and acceptance

Run positive/negative scope tests plus deterministic multi-writer CAS/allocation races, idempotent replay with one effect/audit, exact graph membership, tombstone uniqueness/cohorts, 200-feature capacity, invalid provenance and source refusal. Both adapters preserve per-WorkItem bounds and weighted progress. Runtime OpenAPI parity must match the selected contract.

Current state: LOCAL_API_AND_PROVIDER_PASS_RELEASE_PENDING. The four
GET handlers and nine writes are implemented alongside the existing P2 CSRF
issuer. The current read, writer, provenance and OpenAPI suite passes 65 tests
across eight files. The complete PM/CRM/Identity focused composition passes
122 tests across fourteen files. Real Git commits, exact capture replay identity
and authority expiry after each lock are covered.

Independent actual PostgreSQL verification passes 19 cases with frozen source:
persisted Session and SUPERADMIN grant expiry after observed authority-row waits,
revocation, idempotency, race/CAS, graph/tombstone invariants, rollback and RLS.
The authority clock defect found by the independent source review is repaired
and closed by this separate provider gate. The synthetic non-bypass lab is not
evidence of production grants or public HTTP contention behavior.

OpenAPI v0.3.6b retains fourteen operations and makes capture receipt/resource
identity explicit. Owner aggregate/detail GET headers supply current graph and
Feature CAS tokens. Runtime Swagger covers 308 paths and 411 operations after
composition. The final Server suite passes 6376 tests with 32 skips and the
optimized build passes on the frozen implementation. Independent UI source
review passes; browser and release gates are recorded in P4 and the
[integration report](../../../../.brain/reports/2026-09-17-project-feature-phase-b.md).
No hosted or production result is implied by these local checks.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.4.1b | 2026-09-17 | beta | Record final 6376-test and optimized-build PASS; delegate composed browser status to P4 without changing API scope | 052821a7 + 892f23f3 | RWANG |
| 0.4.0b | 2026-09-17 | beta | Close the independently found authority-clock defect with deterministic and real-provider proof; record 65 API/provenance and 122 total focused passes, retaining UI and release gates | 052821a7 + 892f23f3 | RWANG |
| 0.3.0b | 2026-09-17 | beta | Record implemented reads/writes/provenance, composed 61-test and isolated PostgreSQL evidence; retain independent and release gates | 052821a7 + 892f23f3 | RWANG |
| 0.2.0b | 2026-09-17 | beta | Record passed P1/P2 entry and bounded W3 parallel handoff; make existing snapshot query refusal explicit in API contract | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | beta | Register slice of the approved Phase B design; no new behavior | e5ccfd7a | RWANG |
