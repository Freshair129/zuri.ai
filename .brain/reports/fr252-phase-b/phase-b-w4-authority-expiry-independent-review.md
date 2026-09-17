---
id: QA:PM-PHASE-B-W4-AUTHORITY-EXPIRY-INDEPENDENT-REVIEW
title: Independent review of integrated W4 authority-row expiry proof
version: "0.1.0b"
status: candidate
created_at: "2026-09-17T18:46:36+07:00,Luna Max"
last_update: "2026-09-17T18:48:00+07:00,Luna Max"
superseded_by: null
attributes:
  doc_type: verification-report
  domain: project-manager
  scope: "FR-252 W4 mutation authority reproof"
  evidence_level: "ISOLATED LOOPBACK POSTGRES; SYNTHETIC ONLY"
relations:
  - type: verifies
    target: ZAI:FR-252
---

# Independent W4 authority-row expiry review

## Verdict

**PASS — 19/19 cases.** The runner executed against the integrated composed
worktree after C's frozen service handoff. It used the non-bypass
`zuri_web_login` role and a uniquely named database in the owned loopback
container. The final JSON records `sourceFrozen: true`, and the database was
dropped after the run.

## Authority wait evidence

The mutation was observed waiting on each intended post-Project authority row
lock in `pg_stat_activity` before the blocker released it:

- `Session` — the blocker committed a past `expiresAt`; the mutation returned
  `AUTH_REQUIRED` / 401 with no Feature, receipt, or AuditEvent change.
- `Membership` — the persisted Session was set to expire shortly after the
  mutation began; the mutation held Session, waited on Membership, crossed the
  persisted deadline, then returned `AUTH_REQUIRED` / 401 with no writes.
- `PlatformGrant` — the fixture created a real persisted `SUPERADMIN` grant;
  the mutation held Session and Membership, waited on that grant row, crossed
  the persisted Session deadline, then returned `AUTH_REQUIRED` / 401 with no
  writes. The grant remained active and was verified after the case.
- `PlatformGrant` expiry — a viewer resolved from a real persisted
  `SUPERADMIN` grant lost that grant while its row was locked, with Membership
  demoted, and received the expected redacted 404 with no writes.

The same run retained the baseline Project-lock revocation, Membership
demotion, post-lock expiry, idempotency, CAS, graph/tombstone, rollback,
foreign-scope, RLS and runtime-role cases.

## Source and harness integrity

Proof JSON: `phase-b-w4-authority-expiry-postgres-proof.json`
Proof log: `phase-b-w4-authority-expiry-postgres-proof.log`
QA runner SHA-256:
`6170546499231D28BDE86872DCDF896387C3346B359506AAC3ED2B1918B9DDE8`

The source map is recorded in the proof JSON. The integrated service hash is
`FF84935E4FBA98AD72D80B762C5FDFCD4CB0A40A5BCC81B7EDFC3CB1DD8377A3` and the
before/after map is identical.

## Limits

This is isolated synthetic loopback evidence. It does not prove production
role grants, deployment configuration, public HTTP transport, provider
credentials, snapshot production, or production concurrency behavior.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Independent review of Session, Membership and PlatformGrant lock expiry proof | Luna Max |
