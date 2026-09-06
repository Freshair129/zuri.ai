---
id: ZAI:FR-148-P2
version: "0.1.0b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
title: "Account-scoped CRM conversations"
parent_requirement: FR-148
phase_id: FR-148-P2
phase_order: 2
domain: crm
bundle: FEAT-019
relations:
  - type: relates_to
    target: ZAI:FR-148
  - type: relates_to
    target: ZAI:FR-148-NOTE
  - type: relates_to
    target: ZAI:FEAT-019
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:FR-148-P1
---

# FR-148-P2 — Account-scoped CRM conversations

## Responsibility

Persist isolated history and preserve legacy rows. Apply account-aware conversation identity and message idempotency. Inbound/outbound writes can join the caller transaction; CRM remains the writer.

## Entry condition

The trusted scope produced by P1.

## Output and next handoff

Account-scoped Conversation/Message identity for FR-149 admission and acceptance reconciliation.

This completes this FR subflow; see the shared map for the caller/next FR.

## Failure and acceptance

The same external subject/thread across two OAs must produce distinct histories. Migration preserves LEGACY:LINE without attribution guesses.

## Source and validation anchors

- [Implementation or wire contract](../../../../apps/server/src/modules/crm/line-ingest-service.js)
- [Server verification anchor](../../../../apps/server/tests/unit/conversation-channel-account-migration.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
