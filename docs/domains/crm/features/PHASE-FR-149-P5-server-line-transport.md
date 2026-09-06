---
id: ZAI:FR-149-P5
version: "0.1.0b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
title: "Server-owned LINE conversation transport"
parent_requirement: FR-149
phase_id: FR-149-P5
phase_order: 5
domain: crm
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
    target: ZAI:FR-149-P4
---

# FR-149-P5 — Server-owned LINE conversation transport

## Responsibility

Record accepted output and reconcile receipts. Use the CRM outbound port within the Studio reconciliation transaction. ACCEPTED jobs repair CRM recording without invoking LINE again.

## Entry condition

Persisted provider acceptance plus the original account/inbound identity.

## Output and next handoff

Account-scoped outbound evidence in the conversation, or visible uncertainty requiring review.

This completes this FR subflow; see the shared map for the caller/next FR.

## Failure and acceptance

Acceptance is not delivery/read. UNKNOWN never becomes a fabricated outbound success. Restore must not automatically resume sends.

## Source and validation anchors

- [Implementation or wire contract](../../../../apps/server/src/modules/crm/line-ingest-service.js)
- [Server verification anchor](../../../../apps/server/tests/integration/server-line-jobs.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
