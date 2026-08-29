# RCA — Preview Plugin Auth loopback verifier mismatch

> **Id note (2026-08-30):** this investigation was written against `FR-094` /
> `ADR-045`, which main has since assigned to Canonical IAM. The plugin auth
> boundary it describes now carries **FR-123 / ADR-052 / SDD-074 / SEC-022**.
> The evidence below is unchanged; only the id labels were renumbered when the
> work was re-applied to main (PR: re-apply plugin-auth boundary).

## Symptom

The Preview authorize endpoint returned `400 INVALID_REQUEST` when the test
request registered `http://127.0.0.1:43123/callback`. The same implementation
accepted a safe HTTPS callback and a loopback callback when both loopback host
spellings were registered.

## Evidence

- Preview login succeeded with HTTP 200, so the session cookie and database
  connection were usable.
- A database read after authorize showed the persisted `redirectUri` as
  `http://localhost:43123/callback` even though the verifier sent
  `http://127.0.0.1:43123/callback`.
- Registering both `http://localhost:43123/callback` and
  `http://127.0.0.1:43123/callback` produced authorize 302 with the original
  state and code.
- With the transport-visible `localhost` value, token exchange returned 200,
  capabilities returned 200 with seven capabilities, revoke returned 200 twice,
  and a post-revoke capabilities request returned 401.
- The source validator allows a safe HTTP URI with a host, and the local unit
  tests use the exact 127.0.0.1 callback.

## Root Cause

The Vercel `curl`/protection verification transport rewrites the loopback host
from `127.0.0.1` to `localhost` before the request reaches the Preview
application. Exact redirect matching then rejects the request when only the
127.0.0.1 spelling is registered. This is a verifier transport mismatch, not a
PKCE, database, or application redirect-validation defect.

## Why the issue escaped detection

The smoke verifier treated Vercel `curl` as a transparent HTTP client and only
checked the final HTTP status. It did not compare the redirect URI persisted by
the authorize transaction with the URI sent by the verifier.

## Proposed prevention

1. Keep the application allowlist exact and do not weaken redirect matching.
2. Verify loopback PKCE through a direct client/browser path that does not
   normalize the callback host, or use a callback endpoint reachable by the
   verifier.
3. In future external smoke tests, assert the persisted sanitized redirect
   value before treating a 302 as proof of an exact redirect contract.

Prevention 1 is now held down by a test rather than by this document alone:
`tests/unit/fr123-plugin-auth-service.test.js` asserts that `localhost` and
`127.0.0.1` are **not** interchangeable, so a later reader who reaches for host
normalization to make a verifier pass has to delete an assertion that says why
not.

## Scope note

Only Preview environment variables were cleaned and restored. Production
environment variables, database schema, migrations, roles, and
`ZURI_SESSION_SECRET` were not changed.
