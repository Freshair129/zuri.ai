---
id: ZAI:FR-148-P1
version: "0.1.0b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
title: "Account-scoped CRM conversations"
parent_requirement: FR-148
phase_id: FR-148-P1
phase_order: 1
domain: line-oa-studio
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
    target: ZAI:FR-148-P2
---

# FR-148-P1 — Account-scoped CRM conversations

## Responsibility

Resolve the trusted account namespace. Derive the namespace from the trusted binding code or stable account UUID. Never trust an account namespace supplied by model output or a caller.

## Entry condition

An authenticated/enabled account or the explicitly retained legacy entry point.

## Output and next handoff

Trusted Tenant, Business and channelAccountId for the CRM port.

Next: [[ZAI:FR-148-P2]].

## Failure and acceptance

Reject cross-scope input; a legacy transcript remains LEGACY:LINE and is never guessed into a new account.

## Source and validation anchors

- [Implementation or wire contract](../../../../apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js)
- [Server verification anchor](../../../../apps/server/tests/integration/line-account-isolation.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
