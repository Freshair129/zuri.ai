---
title: "Phase 7: OmiChat Unified Inbox"
doc_id: "PLAN-LINE-OA-PHASE-07"
status: "candidate"
version: "0.1.0b"
created_at: "2026-08-14T02:12:07+07:00,ATHER"
last_update: "2026-08-14T02:12:07+07:00,ATHER"
owner: "Boss (บอส)"
attributes:
  domain: "omichat"
  doc_type: "phase-plan"
  scope: "future unified chat operator surface"
---

# Phase 7: OmiChat Unified Inbox

## Objective

Provide an operator-facing unified inbox that consumes the shared identity, thread, transcript,
permission, AI invocation, action, and delivery contracts built in earlier phases without making
the UI a second conversation authority.

## Dependencies

- explicit OmiChat product-roadmap approval;
- Phase 4 conversation contracts accepted;
- required Phase 6 action/delivery contracts accepted;
- channel parity and human-handoff requirements approved.

## In scope

- conversation/thread list and participant view;
- full authorized transcript view with source/delivery states;
- AI answer, evidence, policy decision, and action audit visibility;
- human takeover/assignment, reply, note, search, filters, and handoff state;
- LINE first, with channel adapter boundaries for later channels;
- shared back-end contracts rather than copied LINE history.

## Out of scope

- rebuilding MSP memory or GKS knowledge inside OmiChat;
- making browser/client state authoritative for delivery;
- adding every social channel before LINE workflow acceptance;
- training models from transcripts without separate consent and governance.

## Acceptance criteria

- UI access is tenant/business/thread scoped and matches policy decisions used by the agent;
- operator and AI messages retain truthful queued/sent/accepted/failed/read semantics where the
  channel provides them;
- human takeover prevents simultaneous AI replies according to an explicit state machine;
- transcript search cannot bypass retention, erasure, or disclosure rules;
- OmiChat failure does not stop LINE ingress, MSP persistence, or governed delivery.

## Success and exit criteria

- authorized operator can inspect and take over one LINE conversation end-to-end;
- security, accessibility, responsive UI, performance, and E2E tests pass;
- source systems remain the authorities for identity, memory, knowledge, action, and delivery;
- product owner accepts the LINE-first OmiChat workflow before additional channels.

## Rollback

Disable the OmiChat surface while keeping channel ingress, MSP, agent, and outbox services active;
operators fall back to LINE Official Account Manager during recovery.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Future OmiChat unified-inbox phase | working-tree | ATHER |
