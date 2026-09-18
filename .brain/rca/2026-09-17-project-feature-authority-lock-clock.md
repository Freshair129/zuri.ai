# RCA — Project-feature authority clock captured before live authority locks

**Date:** 2026-09-17
**Scope:** FR-252 project-feature mutation authority reproof and effect context

## Symptom

A PostgreSQL project-feature mutation could authorize a Session after its expiry
when the transaction waited for a live authority-row lock. The mutation entered
the transaction with a clock value that was captured before the Session,
Membership, and PlatformGrant locks completed.

## Evidence

- Before this correction, `project-feature-service.js` captured `now` at the
  start of `runMutation`, while `reproveMutationAuthority` could wait on three
  PostgreSQL authority locks before checking Session expiry and grant validity.
- The Session check, operator and superadmin grant checks, and `resolveViewer`
  all consumed that pre-lock clock.
- `tests/unit/project-feature-service.test.js` now delays each authority lock
  independently by 100 ms while the Session expires 50 ms after the transaction
  starts. The Session, Membership, and PlatformGrant cases all refuse with
  `AUTH_REQUIRED` before callback, receipt lookup/create, or AuditEvent work.
- A positive case delays the Session lock by 100 ms and verifies that the effect
  context receives the post-lock clock. The focused Vitest proof is recorded at
  `pm-parallel-qa/20260917/phase-b-w4-authority-clock-tests.json` with 11/11
  assertions passing.

## Root Cause

The mutation transaction's initial `now` value was reused after potentially
blocking live-authority locks. Lock acquisition can advance wall-clock time,
but the old value made an expired Session or grant appear valid. The same stale
value also reached the mutation effect context and its audit/receipt timestamps.

## Why the issue escaped detection

Existing authority tests verified that live Session and grant rows were reread,
but did not model a wait between transaction entry and the live authority
decision. The normal uncontended path keeps the two clock reads close enough that
the defect is invisible without deterministic lock-delay coverage.

## Implemented prevention

`reproveMutationAuthority` captures `authorityNow` only after every PostgreSQL
authority lock completes, uses it for Session expiry, operator/superadmin grant
checks, and `resolveViewer`, and returns it to `runMutation`. The mutation effect
context now uses that same post-lock instant. Parameterized lock-delay tests
cover all three authority-row waits and assert that no mutation side effect is
started after expiry.

The focused proof is unit-level with a deterministic PostgreSQL transaction
double. Independent Luna Max verification subsequently passed 19 actual
PostgreSQL cases on the frozen integrated service hash
FF84935E4FBA98AD72D80B762C5FDFCD4CB0A40A5BCC81B7EDFC3CB1DD8377A3.
Observed Session, Membership and PlatformGrant waits each crossed persisted
Session expiry and refused before any Feature, receipt or audit write. An
actual SUPERADMIN-only grant expired during its row lock and lost authority
with redacted 404. The baseline CAS/idempotency/RLS/rollback cases also passed.
The synthetic database was dropped; this does not prove production grants or
HTTP transport. Proof JSON SHA256:
06A084F3BF43357DC565BABDD85351AE72194847B4BAF1304652C35033F2221A.
