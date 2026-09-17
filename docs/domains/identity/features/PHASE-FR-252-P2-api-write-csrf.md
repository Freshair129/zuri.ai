---
id: ZAI:FR-252-P2
title: Session-bound API write CSRF
parent_requirement: FR-252
phase_id: FR-252-P2
phase_order: 2
domain: identity
version: "0.1.0b"
status: beta
created_at: "2026-09-17T02:46:11+07:00,RWANG,approved e5ccfd7a"
last_update: "2026-09-17T02:46:11+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# FR-252-P2 — Session-bound API write CSRF

## Entry condition and predecessor

B1/B2 and independent frozen-packet PASS. This is the Identity dependency of W4 and may run alongside P1 on disjoint files; phase_order expresses the cross-domain handoff, not permission to edit shared schemas.

## Input

The approved GET /api/auth/csrf and issueApiWriteCsrfToken/assertApiWriteCsrfToken contract. Reuse live zuri_session and requireSessionSecret. PUBLIC_BASE_URL is the sole configured Origin authority; plugin-consent tokens are rejected.

## Output and next handoff

Identity-owned issuer/verifier and thin GET route, readable no-store token response and exported guard consumed by P3. Browser stores the token in memory only. No new token table, secret source or credential migration.

## Failure, retry and acceptance

Prove audience and constant-time session binding, 15-minute/session-expiry cap, future/expired/revoked/rotated-session refusal, cross/missing/null mutation Origin rejection and safe configuration 503. Issuer GET alone allows the contracted same-origin signal when Origin is absent. Use existing viewer fixtures and no secret-bearing assertions/logs.

Current state: PLANNED_NOT_RUN. This registered slice does not claim implementation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Register slice of the approved Phase B design; no new behavior | e5ccfd7a | RWANG |
