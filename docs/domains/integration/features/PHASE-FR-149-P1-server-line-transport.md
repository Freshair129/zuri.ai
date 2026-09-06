---
id: ZAI:FR-149-P1
version: "0.1.0b"
status: candidate
created_at: "2026-09-06T13:26:50+07:00,RWANG,base 4c0cbe3"
last_update: "2026-09-06T13:26:50+07:00,RWANG"
title: "Server-owned LINE conversation transport"
parent_requirement: FR-149
phase_id: FR-149-P1
phase_order: 1
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
    target: ZAI:FR-149-P2
---

# FR-149-P1 — Server-owned LINE conversation transport

## Responsibility

Verify native ingress and channel identity. Verify the raw-body LINE signature before parsing; require matching destination and scoped server credentials. This is an Integration capability invoked by the Studio route.

## Entry condition

A native request addressed to a configured account locator.

## Output and next handoff

Verified event and trusted account context for P2.

Next: [[ZAI:FR-149-P2]].

## Failure and acceptance

Invalid signature or destination fails closed, including empty verification requests. Raw reply tokens stay out of logs and evidence.

## Source and validation anchors

- [Implementation or wire contract](../../../../src/platform/integrations/providers/line/server-line-transport.js)
- [Server verification anchor](../../../../tests/integration/server-line-webhook.test.js)
- [Shared map, explicit rollout gates and repository evidence](../../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md)

These anchors identify available coverage; this phase note does not assert that an external device, production database or real LINE delivery has been verified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Documented current requirement ownership and phase handoffs; release gates remain separate | base 4c0cbe3 | RWANG |
