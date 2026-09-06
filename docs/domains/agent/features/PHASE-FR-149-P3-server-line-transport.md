---
id: ZAI:FR-149-P3
version: "0.1.0b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
title: "Server-owned LINE conversation transport"
parent_requirement: FR-149
phase_id: FR-149-P3
phase_order: 3
domain: agent
bundle: FEAT-019
relations:
  - type: relates_to
    target: ZAI:FR-149
  - type: relates_to
    target: ZAI:FR-149-NOTE
  - type: relates_to
    target: ZAI:FEAT-019
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:FR-149-P2
  - type: relates_to
    target: ZAI:FR-149-P4
---

# FR-149-P3 — Server-owned LINE conversation transport

## Responsibility

Compute the scoped server answer. Invoke the established scoped business-answer adapter; return bounded text without choosing Tenant, recipients or delivery policy.

## Entry condition

A leased SERVER job from P2. EDGE jobs take the FR-150 subflow instead.

## Output and next handoff

Answer candidate returned to the Studio worker and durably prepared before P4.

Next: [[ZAI:FR-149-P4]].

## Failure and acceptance

Do not widen the knowledge read policy or silently substitute an external model for an EDGE job.

## Source and validation anchors

- [Implementation or wire contract](../../../../src/modules/agent/server-line-answer.js)
- [Server verification anchor](../../../../tests/unit/server-line-answer.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
