---
feature: FR-055
module: agent
source: v2-native
version: "0.3.0b"
created_at: "2026-08-14T09:24:00+07:00,ATHER"
last_update: "2026-08-14T10:50:00+07:00,ATHER"
status: "beta"
---

# FR-055 — Controlled LINE activation and receipt

## Rationale

FR-054 proves readiness and intentionally cannot mutate a binding or call LINE. FR-055 is the
separate operator boundary that installs only HMAC hashes, enables one expiring binding, supports
routing-first rollback and records transport acceptance without claiming display or read.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-055-01 | Command defaults to dry-run and has no browser/webhook/agent-tool entry point. |
| AC-055-02 | Raw destination, bearer and pepper are environment/secret-store only and absent from argv, files, logs and receipts. |
| AC-055-03 | Exact scope, binding identity/version/status/null hashes, approval window and evidence hashes are re-read and locked before mutation; binding expiry is future-dated and no later than approval expiry. |
| AC-055-04 | Activation updates one row and appends one event atomically through a dedicated least-privilege operator role. |
| AC-055-05 | Duplicate correlation, stale evidence, wrong version/scope or already-active binding performs zero mutation. |
| AC-055-06 | Rollback changes routing first (`ACTIVE -> INACTIVE`), appends an event and preserves imported/source data. |
| AC-055-07 | Receipt contract separates generated, evidence-verified and LINE-accepted states; display/read remain unknown. |
| AC-055-08 | `zuri-cli` artifact is hash-pinned and redacted; reply token, destination, auth headers, content and PII are rejected. |
| AC-055-09 | PostgreSQL integration proves CAS, grants, atomic event append, idempotency and rollback. |
| AC-055-10 | One signed canary remains externally operator-approved and cannot broaden into general traffic. |

## Exit gate

Local implementation may proceed under ADR-020. Production execution additionally requires fresh
PASS artifacts for Golden evaluation and live isolation, recovery approval/rehearsal, exact
destination/provider/model, pinned `zuri-cli`, and an approved mutation window.

## Implementation status

AC-055-01 through AC-055-09 pass locally, including a composed disposable PostgreSQL 17 run through
the real login, role, RLS, CAS, event and rollback path. The harness requires an explicit destructive
opt-in plus an exact per-run cluster marker before role DDL, and proves rollback/cleanup after a
forced mid-migration failure. AC-055-10 is `NOT_RUN`. The production
binding remains outside this local proof and no LINE request was made.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-approved controlled installer, rollback and append-only receipt contract | working-tree | ATHER |
| 0.1.1b | 2026-08-14 | beta | Clarified future binding expiry is capped by the approved window | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | W0-W4 local implementation and composed PostgreSQL 17 proof complete; external canary remains NOT_RUN | working-tree | ATHER |
| 0.3.0b | 2026-08-14 | beta | Hardened W4 disposable-cluster guard and failure-path role/schema cleanup; independent review PASS | working-tree | ATHER |
