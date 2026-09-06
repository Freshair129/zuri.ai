---
id: ZAI:FR-148-NOTE
version: "0.1.0b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
domain: crm
feature: FR-148
bundle: FEAT-019
source: v2-native
relations:
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:FEAT-019
  - type: relates_to
    target: ZAI:FR-148
  - type: relates_to
    target: ZAI:FR-148-P1
  - type: relates_to
    target: ZAI:FR-148-P2
---

# FR-148 — Account-scoped CRM conversations

The global subject remains exactly the FR-148 registry entry. This note explains ownership and handoffs; it does not declare a new requirement or certify deployment.

## Domain-owned runtime parts

| Phase | Owning domain | Handoff |
|---|---|---|
| [FR-148-P1](../../line-oa-studio/features/PHASE-FR-148-P1-account-scoped-conversations.md) | line-oa-studio | Resolve the trusted account namespace |
| [FR-148-P2](PHASE-FR-148-P2-account-scoped-conversations.md) | crm | Persist isolated history and preserve legacy rows |

[Shared phase map and rollout gates](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md) explains cross-FR dependencies. Phase order is the runtime handoff order, not a new deployment scheduler. Each phase keeps the same FR name and has its own stable document ID.

## Evidence boundary

Server implementation and hosted CI are present through PR #243. That proves the server branch, not the installed device or provider canary. Edge PR #22 remains open as of 2026-09-06; production migrations, credential provisioning, ownership handoff and live canary require separate evidence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
