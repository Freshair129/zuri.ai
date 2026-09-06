---
id: ZAI:FR-150-P2
version: "0.1.1b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
title: "Optional Edge conversation execution"
parent_requirement: FR-150
phase_id: FR-150-P2
phase_order: 2
domain: agent
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
    target: ZAI:FR-150-P1
  - type: relates_to
    target: ZAI:FR-150-P3
---

# FR-150-P2 — Optional Edge conversation execution

## Responsibility

Apply the executor contract on the optional device. Own the answer contract boundary; the implementation is the external Edge application. Local process placement and external-model permission are separate choices.

## Entry condition

The minimized P1 envelope and the device local execution policy.

## Output and next handoff

Bounded text and protocol/lease identifiers returned to P3; never delivery authority.

Next: [[ZAI:FR-150-P3]].

## Failure and acceptance

No arbitrary executable, URL, SQL or tenant selection from job data. Edge [PR #22](https://github.com/Freshair129/zuri-edge-device/pull/22) merged into master as `b089320` on 2026-09-06; hosted verify passed for head `f7e047a`. Stateless Codex is temporarily rejected with `LOCAL_POLICY_UNAVAILABLE` before execution, without provider fallback. Installed-device and production activation require separate evidence.

## Source and validation anchors

- [Implementation or wire contract](../../../../apps/server/contracts/line-conversation-execution.schema.json)
- [Server verification anchor](../../../../apps/server/tests/integration/server-line-jobs.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
