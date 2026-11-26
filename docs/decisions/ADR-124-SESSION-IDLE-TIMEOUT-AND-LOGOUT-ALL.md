---
id: ZAI:ADR-124
title: Authentication sessions get an idle timeout, throttled last-seen writes and a logout-all route
version: "1.0.1"
status: accepted
created_at: "2026-11-25"
last_update: "2026-11-26"
author: Claude Sonnet 5.5
superseded_by: null
approval_scope: session-idle-timeout-throttle-logout-all-no-schema-change-no-migration
approved_on: "2026-11-25"
approved_by: "Owner decision 2026-11-25, relayed by the lead Claude session (D-D10). This is a human owner decision; it is not an Astra or delegated decision"
attributes:
  doc_type: architecture-decision
  domain: identity
  scope: "Idle timeout of 12 hours (72 hours for remember-me) on the persisted Session; lastSeenAt write throttle; POST /api/auth/logout-all; the seven-day ceiling and 900-second step-up window are unchanged"
relations:
  - type: relates_to
    target: ZAI:FR-046
  - type: relates_to
    target: ZAI:FR-095
  - type: relates_to
    target: ZAI:ADR-045
---

# ADR-124 — Session idle timeout, throttled last-seen writes and logout-all

**Status:** Accepted on 2026-11-25. Owner decision D-D10, relayed by the lead
Claude session. **Next review: 2026-12-12.** (The earlier review date,
2026-11-21, lapsed with no record; this ADR resets it.)

## Context

An authentication session was valid for exactly seven days from issue, with no
idle timeout, no refresh and no rotation
([SYSTEM-DIAGRAM §6](../domains/identity/SYSTEM-DIAGRAM.md#6-session-contract)).
`Session.lastSeenAt` was written on every request and never read. The review
deferred D-D10 because the seven-day ceiling was accepted but a permanent
absence of an idle limit was not, and asked for an idle, step-up and revocation
contract with multi-instance tests. Evidence:
[D9/D10/D12 evidence note](../plans/D9-D10-D12-DEFERRED-DECISIONS-EVIDENCE-20261125.md).

## Decision

### D1 — Idle timeout

A session is also dead when it has not been used for:

| Session | Idle limit |
|---|---|
| Normal (browser-session cookie) | 12 hours |
| "Remember me" (password sign-in with the tick, and passkey sign-in, which sets a seven-day cookie) | 72 hours |

The seven-day absolute ceiling (`SESSION_MAX_AGE_SECONDS`) is unchanged and is
never extended by activity. There is still no refresh and no rotation.

### D2 — Enforcement and throttle

Enforcement is in `session-port.js`, on the read path, from the persisted
`Session.lastSeenAt`:

- An idle-expired session is revoked (`status REVOKED`, `revokeReason
  IDLE_TIMEOUT`, `version` incremented) and the request is unauthenticated. Every
  application instance reads the same row, so the verdict is the same on all of
  them.
- `lastSeenAt` is written at most once per 60 seconds per session. The write is
  a conditional `updateMany` guarded by `lastSeenAt < now - 60s`, so concurrent
  requests, on one instance or many, cannot error and do not pile up writes.
- A missing or invalid `lastSeenAt` is treated as idle-expired (fail closed).
- A store error on read, revoke or touch raises `SESSION_STORE_UNAVAILABLE`. The
  request is refused with 503, never authenticated. This is the existing
  fail-closed contract, now extended from "store absent" to "store unreachable".

Precision: the idle clock is accurate to the 60-second throttle. A session can
be up to 60 seconds more idle than the stored value shows.

### D3 — How a session knows it is "remember me"

The server did not know: the choice only set the cookie `maxAge`. No new column
is added. The choice becomes a signed claim `rem: 1` in the session token
payload, written only at issue. The token is HMAC-signed and bound to the row by
`tokenHash`, so a client cannot add or remove the claim. It only selects the
idle limit and cannot lengthen the seven-day ceiling (the `exp - iat` bound is
unchanged). A schema column was rejected because the migration is an owner-only
step (ADR-057), and reading a column that production did not yet have would
break every request.

Consequence at roll-out: tokens issued before this change carry no claim and
get the 12-hour limit, including a remembered session. Those users sign in
again once after at most 12 idle hours.

### D4 — Step-up

Unchanged. The step-up window stays 900 seconds
(`session-assurance.js`), and the existing TOTP and WebAuthn step-up routes are
untouched.

### D5 — Revocation

- **Added:** `POST /api/auth/logout-all`. It resolves the live session, requires
  the session-bound API-write CSRF token like the sibling write routes, calls
  `revokeAllSessions` (reason `LOGOUT_ALL`), and clears the cookie. The revoke and an
  `AuditEvent` (`SESSION` / `SESSIONS_REVOKED_LOGOUT_ALL`, actor = the Person, payload
  reason and revoked count, no token material) commit in one transaction. An idle-timeout
  revoke likewise writes `SESSION` / `SESSION_REVOKED_IDLE_TIMEOUT` (system actor), only when
  its conditional update claims the row. The profile page exposes the control (Thai copy).
- **Change password:** no change-password route exists in the repository.
  Password change happens only through owner-assisted reset, which already
  revokes every session (`reason PASSWORD_RESET`). No new path is invented here;
  if a self-service change-password route is added, it must call
  `revokeAllSessions` for the other sessions in the same change.

### D6 — Deferred

- Session list and device management.
- Token rotation and refresh.

Each needs its own decision. Neither is implied by this ADR.

### D7 — Evidence

- `tests/unit/session-idle-timeout.test.js`: boundaries, throttle, claim, outage.
- `tests/unit/fr046-logout-all-route.test.js`: the route contract.
- `tests/integration/session-idle-multi-instance.test.js`: two session-port
  instances over one real database: a revoke on A is seen by B on its next
  request; idle expiry is seen by both; concurrent `lastSeenAt` writes do not
  error; store outage fails closed.

**Limit of the evidence.** The multi-instance test runs on the SQLite
integration database. It proves the logic and the shared-row contract. It does
not prove PostgreSQL row-lock or isolation behaviour for the conditional
update; that rests on the statement being a single guarded `UPDATE`.

## Consequences

No schema change and no migration. Behaviour changes at deploy: sessions idle
beyond the limit stop working at the next request, and `lastSeenAt` write load
falls from one per request to at most one per minute per session. No FR record
was added or reworded: the behaviour refines FR-046 and FR-095 (persisted,
revocable, fail-closed sessions) and is specified here and in the Identity
SYSTEM-DIAGRAM.

## Version history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-11-25 | Claude Sonnet 5.5 | Initial decision, from owner decision D-D10. |
| 1.0.1 | 2026-11-26 | Claude Sonnet 5.5 | Gap G10 closed, no new decision: `LOGOUT_ALL` and `IDLE_TIMEOUT` revocations now write an `AuditEvent` in the same transaction as the revoke (audit failure rolls the revoke back; the route returns 503). The profile page gets a "log out of all devices" control. No schema change. |
