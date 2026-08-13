---
title: "Phase 6: LINE Group Assistant and Governed Actions"
doc_id: "PLAN-LINE-OA-PHASE-06"
status: "candidate"
version: "0.1.0b"
created_at: "2026-08-14T02:12:07+07:00,ATHER"
last_update: "2026-08-14T02:12:07+07:00,ATHER"
owner: "Boss (บอส)"
attributes:
  domain: "conversation-intelligence"
  doc_type: "phase-plan"
  scope: "group participation summaries proactive assistance and actions"
---

# Phase 6: LINE Group Assistant and Governed Actions

## Objective

Make Zuri a governed participant in approved LINE groups: listen under policy, answer on mention,
produce scheduled summaries, provide bounded proactive help, and execute explicitly authorized
actions such as appointment creation.

## Dependencies

- Phase 5 accepted;
- group consent/audience/retention policy approved;
- action gateway, audit, step-up, calendar provider, and human rollback flows approved.

## Modes

```text
LISTEN_ONLY
MENTION_ONLY
SCHEDULED_SUMMARY
PROACTIVE_ASSIST
ACTION_ENABLED
```

Modes are independent policy grants. Enabling one never implies the next.

## In scope

- approved group binding and participant policy;
- mention detection and deterministic trigger rules;
- daily/period summaries sourced from authorized MSP events;
- proactive suggestion candidate -> policy/quality gate -> reply;
- appointment action through Zuri Action Gateway with normalized arguments, idempotency, audit,
  approval/step-up, and delivery receipt;
- group controls, mute, quiet hours, retention, erasure, and incident kill switch.

## Out of scope

- unrestricted listening in unknown groups;
- model-granted permissions;
- direct model writes to calendars/CRM;
- OmiChat operator UI;
- autonomous payment, refund, customer-update, or order mutation.

## Acceptance criteria

- unapproved groups produce no retained transcript or response;
- mention/proactive/summary/action triggers are separately configurable and auditable;
- every disclosed fact passes actor + business + audience + capability + sensitivity checks;
- action approval binds normalized arguments, target, policy version, expiry, and single-use token;
- duplicate LINE events or retries cannot duplicate appointments;
- members can stop summaries/proactive behavior according to policy.

## Success and exit criteria

- mention and summary scenarios pass approved group fixtures;
- proactive precision meets an owner-set threshold before activation;
- calendar canary proves create, duplicate prevention, denial, and rollback/cancel behavior;
- action/audit/security review passes;
- Phase 7 remains separately planned and unauthorized.

## Rollback

Step down modes in order: `ACTION_ENABLED -> PROACTIVE_ASSIST -> SCHEDULED_SUMMARY ->
MENTION_ONLY -> LISTEN_ONLY -> disabled`; revoke action tokens and keep required audit evidence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Group assistant and governed-action phase | working-tree | ATHER |
