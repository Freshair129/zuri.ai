---
title: "Phase 2: Cloud Runtime and Operations"
doc_id: "PLAN-LINE-OA-PHASE-02"
status: "candidate"
version: "0.1.0b"
created_at: "2026-08-14T02:12:07+07:00,ATHER"
last_update: "2026-08-14T02:12:07+07:00,ATHER"
owner: "Boss (บอส)"
attributes:
  domain: "line-ai"
  doc_type: "phase-plan"
  scope: "always-on runtime and operational controls"
---

# Phase 2: Cloud Runtime and Operations

## Objective

Move the accepted Phase 1 pilot from a workstation/tunnel dependency to an always-on governed
runtime with clear ownership of LINE credentials, reply delivery, retries, secrets, audit, and
provider operations.

## Dependencies

- Phase 1 accepted with migration and canary evidence;
- selected hosting and secret-store decision;
- approved operational owner, budget, retention, and incident contact.

## In scope

- public HTTPS webhook with LINE signature validation;
- Zuri-owned LINE integration configuration and encrypted secret references;
- durable inbound idempotency and reply/outbox records;
- bounded retry/dead-letter policy;
- model-provider health, budget, rate-limit, circuit breaker, credential rotate/revoke;
- logs, metrics, traces, alerting, incident runbook, backup, and rollback;
- Supabase connection pooling, least-privilege roles, RLS/grants review, and migration deployment;
- separation of `ACCEPTED_BY_LINE`, failed, retried, expired, and operator-disabled states.

## Out of scope

- end-user account linking or private data permissions;
- transcript/episodic memory;
- semantic graph/vector memory;
- group assistant, actions, or OmiChat UI.

## Work packages

1. Hosting and network topology ADR.
2. Zuri inbound gateway and durable idempotency.
3. Zuri delivery outbox as the sole LINE sender; retire direct pilot delivery exception.
4. Secret-store integration and credential lifecycle.
5. Provider quotas/budgets/health and operator controls.
6. Observability, alerting, backup, disaster recovery, and incident runbook.
7. Staging-to-production gate with synthetic traffic and rollback drill.

## Acceptance criteria

- workstation and tunnel may be offline while the webhook remains healthy;
- only one service owns LINE delivery credentials and outbox calls;
- provider/Supabase secrets never enter public clients, logs, or repository files;
- retry does not produce duplicate LINE replies;
- degraded providers fail closed or use an explicitly approved fallback;
- operator can disable a business/provider/channel and see an audit event;
- alerts cover signature failures, reply failures, model errors, quota exhaustion, and stale
  knowledge.

## Success and exit criteria

- staging soak and bounded production canary meet the approved latency/error budget;
- restore and rollback drills pass;
- provider billing/usage reconciles with internal usage records;
- production runbook and on-call owner are approved;
- Phase 3 remains unauthorized until separately approved.

## Rollback

Disable webhook/agent routing, keep inbound audit, revert to human LINE OA handling, revoke runtime
credentials, and restore the last known-good deployment without deleting migrated knowledge.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Always-on runtime and operations phase | working-tree | ATHER |
