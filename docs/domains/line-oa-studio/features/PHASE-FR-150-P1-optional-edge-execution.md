---
id: ZAI:FR-150-P1
version: "0.1.0b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
title: "Optional Edge conversation execution"
parent_requirement: FR-150
phase_id: FR-150-P1
phase_order: 1
domain: line-oa-studio
bundle: FEAT-019
relations:
  - type: relates_to
    target: ZAI:FR-150
  - type: relates_to
    target: ZAI:FR-150-NOTE
  - type: relates_to
    target: ZAI:FEAT-019
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:FR-150-P2
---

# FR-150-P1 — Optional Edge conversation execution

## Responsibility

Dispatch minimized leased computation. Own the job and lease endpoints; bind claimant, scope, version and expiry. Return only the versioned minimized computation envelope.

## Entry condition

FR-149 P2 job explicitly configured for EDGE; Identity authenticates an active Business device credential.

## Output and next handoff

Scoped input/lease for the external Edge executor in P2.

Next: [[ZAI:FR-150-P2]].

## Failure and acceptance

Offline Edge stays waiting or expires; no SERVER fallback. Neither LINE credentials, reply tokens nor recipient identifiers are in the job.

## Source and validation anchors

- [Implementation or wire contract](../../../../apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js)
- [Server verification anchor](../../../../apps/server/tests/integration/server-line-jobs.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
