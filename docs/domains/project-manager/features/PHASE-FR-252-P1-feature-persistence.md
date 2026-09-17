---
id: ZAI:FR-252-P1
title: Feature persistence and protected restore
parent_requirement: FR-252
phase_id: FR-252-P1
phase_order: 1
domain: project-manager
version: "0.1.0b"
status: beta
created_at: "2026-09-17T02:46:11+07:00,RWANG,approved e5ccfd7a"
last_update: "2026-09-17T02:46:11+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# FR-252-P1 — Feature persistence and protected restore

## Entry condition and predecessor

B1 owner approval, B2 registration/governance and independent frozen-packet PASS. Own W1 schema followed by W2 repository/restore interfaces. Production role remediation is a separate gate; no live database mutation is permitted by this slice.

## Input

The six-record selected data contract, plan24 sections 4/6/8, existing SQLite/Postgres schemas, protected backup families and real parent hierarchy. Reuse the Project lock; do not add a graph-state table.

## Output and next handoff

Additive SQLite/Postgres schema parity, reviewed migration/check/index/RLS definitions, repository ports, protected-family export/validation/restore and tested immutable identity/version behavior. Hand frozen transaction/read interfaces to P3 and restore evidence to root.

## Failure, retry and acceptance

Validate both schemas, execute local isolated adapter and restore tests, reject cross-scope/malformed/missing protected-family snapshots before mutation, preserve legacy compatibility and show rollback retention. No production migration; no unrelated schema cleanup.

Current state: PLANNED_NOT_RUN. This registered slice does not claim implementation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Register slice of the approved Phase B design; no new behavior | e5ccfd7a | RWANG |
