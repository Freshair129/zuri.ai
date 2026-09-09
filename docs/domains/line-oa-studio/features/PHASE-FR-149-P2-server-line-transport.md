---
id: ZAI:FR-149-P2
version: "0.1.1b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-10T04:30:00+07:00,Claude Opus 5"
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

Atomically admit CRM inbound and durable work. Coordinate one transaction for CRM inbound and the uniquely keyed LineConversationJob. Apply account ownership epoch and version/lease fences.

Since PR #306 that transaction no longer runs *before* acknowledgment — LINE is answered on P1's durable evidence capture, and admission runs after it. This phase therefore owns two further duties, added 2026-09-10 (ADR-061 D4):

- **Reconcile abandoned admissions.** An evidence row is labelled `ADMITTING` before the first attempt; the bounded worker tick re-admits rows stranded there past a threshold that clears the in-process retry ladder, using the payload already stored. A reconciled event carries no reply token (P1 strips it at capture, and LINE's is dead by then), so the job it creates leaves by Push where the account allows delayed Push, and otherwise ends `FAILED` — visible, never discarded.
- **Give terminal failures an owner.** `FAILED` jobs are counted with their `errorCode` for the selected Business on the Studio conversation surface. Of the first 12 production jobs, 4 ended `FAILED / LOCAL_POLICY_UNAVAILABLE` and no screen said so.

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
| 0.1.1b | 2026-09-10 | candidate | Acknowledgment moved to P1 evidence capture (PR #306); this phase gains reconciliation of abandoned admissions from stored evidence and an operator-visible terminal-failure count (ADR-061 D4) | base 2fa9a256 | Claude Opus 5 |
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
