---
id: ZAI:FR-149-NOTE
version: "0.1.1b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
domain: line-oa-studio
feature: FR-149
bundle: FEAT-019
source: v2-native
relations:
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:FEAT-019
  - type: relates_to
    target: ZAI:FR-149
  - type: relates_to
    target: ZAI:FR-149-P1
  - type: relates_to
    target: ZAI:FR-149-P2
  - type: relates_to
    target: ZAI:FR-149-P3
  - type: relates_to
    target: ZAI:FR-149-P4
  - type: relates_to
    target: ZAI:FR-149-P5
---

# FR-149 — Server-owned LINE conversation transport

The global subject remains exactly the FR-149 registry entry. This note explains ownership and handoffs; it does not declare a new requirement or certify deployment.

## Domain-owned runtime parts

| Phase | Owning domain | Handoff |
|---|---|---|
| [FR-149-P1](../../integration/features/PHASE-FR-149-P1-server-line-transport.md) | integration | Verify native ingress and channel identity |
| [FR-149-P2](PHASE-FR-149-P2-server-line-transport.md) | line-oa-studio | Atomically admit CRM inbound and durable work |
| [FR-149-P3](../../agent/features/PHASE-FR-149-P3-server-line-transport.md) | agent | Compute the scoped server answer |
| [FR-149-P4](../../integration/features/PHASE-FR-149-P4-server-line-transport.md) | integration | Send through the authorized LINE port |
| [FR-149-P5](../../crm/features/PHASE-FR-149-P5-server-line-transport.md) | crm | Record accepted output and reconcile receipts |

[Shared phase map and rollout gates](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md) explains cross-FR dependencies. Phase order is the runtime handoff order, not a new deployment scheduler. Each phase keeps the same FR name and has its own stable document ID.

## Evidence boundary

Server implementation and hosted CI are present through PR #243. That proves the server branch, not the installed device or provider canary. Edge [PR #22](https://github.com/Freshair129/zuri-edge-device/pull/22) merged into master as `b089320` on 2026-09-06; hosted verify passed for head `f7e047a`. Stateless Codex is temporarily rejected with `LOCAL_POLICY_UNAVAILABLE` before execution, without provider fallback. Installed-device and production activation require separate evidence. However, production migrations, credential provisioning, ownership handoff and live canary require separate evidence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
