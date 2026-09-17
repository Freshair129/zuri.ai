---
id: ZAI:FR-252-P2
title: Session-bound API write CSRF
parent_requirement: FR-252
phase_id: FR-252-P2
phase_order: 2
domain: identity
version: "0.2.1b"
status: beta
created_at: "2026-09-17T02:46:11+07:00,RWANG,approved e5ccfd7a"
last_update: "2026-09-17T05:10:00+07:00,RWANG"
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

Current state: IMPLEMENTED_LOCAL_VERIFICATION. The Identity issuer/verifier,
thin GET route, persisted session expiry handoff and runtime Swagger are
implemented. Seven focused files / 64 tests passed on 2026-09-17, covering the
token and route contract, real route/Prisma/session composition, session
regression, plugin-token separation and OpenAPI. Malformed percent-encoded
cookies now return 401 rather than a false session-store 503; the failure was
reproduced before the narrow shared-cookie-parser fix. Configuration is checked
before the route reads a cookie, so a short
or missing signing secret and an invalid configured origin fail with redacted
503 rather than silently appearing as an expired login.

Independent Luna Max implementation review passed after the parser correction
and real composition tests. Post-fix composition with W1 passes 67 tests across
eight files and the optimized build. Composed governance reports one CRITICAL
for W1's six missing backup families and two existing warnings; P1/W2 must
close that gate before merge/deploy. Hosted implementation CI is NOT_RUN. This is not a
production rollout, a Feature mutation endpoint or closure of the separate P1
database/restore gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.1b | 2026-09-17 | beta | Record post-fix composed tests/build PASS and separate the P1/W2 governance blocker | bd99651f | RWANG |
| 0.2.0b | 2026-09-17 | beta | Record Identity implementation, 64 focused passing tests and independent review; composed gates remain separate | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | beta | Register slice of the approved Phase B design; no new behavior | e5ccfd7a | RWANG |
