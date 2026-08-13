---
title: "Phase 3: Identity and Permission"
doc_id: "PLAN-LINE-OA-PHASE-03"
status: "candidate"
version: "0.1.0b"
created_at: "2026-08-14T02:12:07+07:00,ATHER"
last_update: "2026-08-14T02:12:07+07:00,ATHER"
owner: "Boss (บอส)"
attributes:
  domain: "identity-security"
  doc_type: "phase-plan"
  scope: "LINE identity linking and deterministic disclosure authorization"
---

# Phase 3: Identity and Permission

## Objective

Resolve a verified LINE sender to one Zuri principal and decide deterministically which business
knowledge that principal may receive before retrieval or model generation.

## Dependencies

- Phase 2 accepted;
- Supabase Auth topology approved;
- consent, retention, role, and business-sharing policy approved.

## In scope

- Supabase Auth as identity provider for web/account-linking flows;
- `Person`, `Membership`, and `ExternalIdentity` mapping for LINE/Gmail/Google subject IDs;
- one-time account linking with expiry, replay protection, revoke, unlink, and recovery;
- separate customer and staff identity paths;
- deterministic authorization context: actor, tenant, business, channel/thread audience,
  capability, sensitivity, consent, and policy version;
- read/disclosure gate before retrieval and after candidate answer generation;
- audited allow/deny/step-up decisions.

## Out of scope

- model-based authorization decisions;
- trusting email/role claims typed in chat;
- MSP transcript memory;
- GKS semantic promotion;
- write actions.

## Effective permission

```text
actor membership
  intersect business scope
  intersect channel/thread audience
  intersect capability
  intersect data sensitivity
  intersect consent and retention
```

The policy engine is the authority. A model may flag anomalies but cannot grant access.

## Acceptance criteria

- LINE signature authenticates transport but never grants business access by itself;
- unlinked users receive only the public policy or a safe linking prompt;
- account links are single-use, short-lived, tenant-bound, and auditable;
- revoked membership/identity is denied without waiting for stale model/session context;
- cross-tenant and over-sensitivity reads fail closed;
- customer and employee permissions cannot be confused or merged silently.

## Success and exit criteria

- identity-link, revoke, replay, stale-token, cross-tenant, impersonation, and disclosure tests pass;
- security review approves the AuthContext and policy matrix;
- every model request records a policy decision reference, not raw authorization secrets;
- Phase 4 remains unauthorized until separately approved.

## Rollback

Disable account linking and private knowledge, retain public Phase 2 behavior, revoke affected
sessions/identities, and preserve audit evidence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Identity-link and disclosure-authorization phase | working-tree | ATHER |
