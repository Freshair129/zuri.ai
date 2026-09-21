# RCA — TASK-ZAI-001 production session-store boundary

## Symptom

The credential/session implementation could treat a missing Session persistence
adapter as a successful login or logout in production. A valid signed cookie
could also be classified as `401 AUTH_REQUIRED` when the production Session
lookup method was unavailable, conflating infrastructure failure with an invalid
credential.

## Evidence

- `apps/server/src/modules/identity/auth-service.js` returned `null` from
  `persistSession()` when `db.session.create` was absent, and returned `false`
  from revocation helpers when `db.session.updateMany` was absent.
- `apps/server/src/modules/identity/session-port.js` returned
  `UNAUTHENTICATED` when `db.session.findUnique` was absent in production.
- The authority contract requires persisted, revocable sessions and a
  non-disclosing `503` for session-adapter failure: ADR-017 D2-D3, ADR-045 D2,
  FR-046 AC-046-08/12 and FR-095 P0 acceptance 1.
- Existing focused tests covered valid persistence and revoked rows, but not
  production-mode missing-store methods.

## Root Cause

Development/test compatibility no-op branches were shared with production
without a production-only fail-closed guard. The signed token was treated as
enough to continue minting or reporting lifecycle success even though the live
Session row was the authority.

## Why the issue escaped detection

The normal focused and browser paths use a complete Prisma test schema, so the
missing-method branches were not exercised. Existing negative coverage tested
invalid, tampered, expired and revoked credentials, but not an unavailable
Session adapter.

## Proposed prevention

Keep development compatibility explicit, but make production persistence,
lookup and revocation failures raise a non-disclosing store error. Route
boundaries map that error to `503 SESSION_UNAVAILABLE` or `AUTH_UNAVAILABLE`,
and focused tests pin the production missing-store cases so a future
compatibility fallback cannot silently widen the production boundary.
