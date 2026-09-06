---
id: ZAI:FR-149-P4
version: "0.1.0b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
title: "Server-owned LINE conversation transport"
parent_requirement: FR-149
phase_id: FR-149-P4
phase_order: 4
domain: integration
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
    target: ZAI:FR-149-P3
  - type: relates_to
    target: ZAI:FR-149-P5
---

# FR-149-P4 — Server-owned LINE conversation transport

## Responsibility

Send through the authorized LINE port. Use the sealed valid Reply token, or explicitly permitted delayed Push. Preserve immutable Push recipient/body/retry UUID and bounded retries.

## Entry condition

Studio has durably prepared the answer and authorized delivery under the current account epoch.

## Output and next handoff

Provider acceptance evidence, permanent failure or an explicitly uncertain outcome for P5.

Next: [[ZAI:FR-149-P5]].

## Failure and acceptance

Lost Reply response is UNKNOWN, not permission to Push again. A retry-key 409 counts as acceptance only with accepted-request evidence.

## Source and validation anchors

- [Implementation or wire contract](../../../../apps/server/src/platform/integrations/providers/line/server-line-transport.js)
- [Server verification anchor](../../../../apps/server/tests/unit/platform/server-line-transport.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
