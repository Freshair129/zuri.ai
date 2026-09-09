---
id: ZAI:FR-149-P2
version: "0.1.1b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-10T00:00:00+07:00,Claude Opus 5"
title: "Server-owned LINE conversation transport"
parent_requirement: FR-149
phase_id: FR-149-P2
phase_order: 2
domain: line-oa-studio
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
    target: ZAI:FR-149-P1
  - type: relates_to
    target: ZAI:FR-149-P3
---

# FR-149-P2 — Server-owned LINE conversation transport

## Responsibility

Atomically admit CRM inbound and durable work. Coordinate one transaction for CRM inbound and the uniquely keyed LineConversationJob. Since PR #306 that transaction runs after the acknowledgement, not before it: the ingress answers LINE once the event is durably captured as raw evidence, and this phase admits from that capture, in-process and retried. Apply account ownership epoch and version/lease fences.

## Entry condition

P1 verified event; FR-148 namespace and CRM contract are available.

## Output and next handoff

A committed job for SERVER answer processing, or FR-150 optional EDGE execution.

Next: [[ZAI:FR-149-P3]].

## Failure and acceptance

Replay must not duplicate CRM/job records. No acknowledgment based only on an in-memory queue. Non-text evidence does not claim binary support.

## Source and validation anchors

- [Implementation or wire contract](../../../../apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js)
- [Server verification anchor](../../../../apps/server/tests/integration/server-line-webhook.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-10 | candidate | Corrected the admission ordering: acknowledgement is durable capture and admission follows it, matching the route since PR #306 | working-tree | Claude Opus 5 |
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
