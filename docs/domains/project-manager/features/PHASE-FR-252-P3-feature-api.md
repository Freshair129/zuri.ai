---
id: ZAI:FR-252-P3
title: Feature read and transactional mutation API
parent_requirement: FR-252
phase_id: FR-252-P3
phase_order: 3
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

# FR-252-P3 — Feature read and transactional mutation API

## Entry condition and predecessor

P1 frozen repository ports for W3 reads; P1 plus P2 for W4 mutation admission. Root owns shared contracts. Service and API workers use disjoint allowlists, including the project-level feature-work-links route.

## Input

The exact 14-operation OpenAPI, Project hierarchy authority, canonical Domain IDs, Project/WorkItem/Repository references and approved snapshot verifier port. Body scope is untrusted; all receipt lookup/replay follows authorization.

## Output and next handoff

Scoped read aggregate/list/detail, base and complete-set mutations, graph redistribution, soft delete/restore, verified snapshot capture, atomic audit and typed durable receipts. UI consumes the frozen direct DTOs without inventing snapshots, status, progress or wrappers.

## Failure, retry and acceptance

Run positive/negative scope tests plus deterministic multi-writer CAS/allocation races, idempotent replay with one effect/audit, exact graph membership, tombstone uniqueness/cohorts, 200-feature capacity, invalid provenance and source refusal. Both adapters preserve per-WorkItem bounds and weighted progress. Runtime OpenAPI parity must match the selected contract.

Current state: PLANNED_NOT_RUN. This registered slice does not claim implementation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Register slice of the approved Phase B design; no new behavior | e5ccfd7a | RWANG |
