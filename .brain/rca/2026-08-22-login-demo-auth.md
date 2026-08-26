---
version: "0.3.0b"
created_at: "2026-08-22T06:10:16+07:00,ATHER"
last_update: "2026-08-22T07:54:35+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "identity-security"
  doc_type: "root-cause-analysis"
  scope: "Replace credential-free login and remove demo identity paths"
---

# RCA — Login still creates a demo identity

## Complexity and risk

- **Complexity:** C-3 — documentation-driven authentication boundary change.
- **Risk:** HIGH — authentication, session integrity and tenant authorization.

## Symptom

The `/login` screen appears to be a real owner login, but submitting an empty
`POST /api/session/login` creates a session without checking a username,
password, identity provider or persisted credential.

## Evidence

- `src/app/api/session/login/route.js` redirects every POST to `/businesses` and
  writes `LIVE_OWNER_PRINCIPAL_ID`; it reads no request credentials.
- The same route switches to `LOCAL_DEMO_COOKIE` whenever
  `NODE_ENV !== production` and `ZURI_LOCAL_DEMO_AUTH=1`.
- `src/modules/identity/session-port.js` accepts `LOCAL_DEMO_COOKIE` and returns
  an authenticated session with `principalId: null` and `localDemo: true`.
- `src/modules/identity/request-viewer.js` turns that flag into
  `allowDevelopmentFallback: true`, which resolves the seeded `PER-OWNER`.
- `run.bat` and `playwright.config.js` enable `ZURI_LOCAL_DEMO_AUTH=1`.
- `prisma/seed.js` creates `PER-OWNER` / `owner@local` as a demo identity with
  no authentication credential.
- `src/modules/identity/profile-permission-service.js` and the profile UI label
  the active session `LOCAL_DEMO`.
- `PersonCredential` and `PasswordResetToken` are already declared in both Prisma
  schemas, but `main` has no credential-auth service or `/api/auth/login` route.

## Root cause

The accepted FR-044/ADR-015 routing proof was intentionally implemented as a
credential-free demo. Later changes renamed the button and added a
`/api/session/login` route, but that route only renamed the transition: it did
not replace the demo identity provider. The production viewer contract (FR-046 /
ADR-017) deliberately left the concrete provider as a separate decision, so the
demo fallback remains the active local path.

## Why the issue escaped detection

The current tests assert that a server-owned cookie is issued, but they submit no
credentials and explicitly set the demo capability for E2E. The UI contract also
asserts that login contains no password or token handling. A hard-coded principal
therefore satisfies the existing tests while failing the product meaning of
“login”.

## Proposed prevention

1. Add and approve a concrete credential-auth contract before implementation;
   do not repurpose FR-044, FR-046 or FR-090, whose identities are already pinned.
2. Authenticate against the existing `PersonCredential` record and issue only a
   signed, expiring, HttpOnly session cookie; missing or invalid credentials must
   return `401`.
3. Remove `LOCAL_DEMO_COOKIE`, `ZURI_LOCAL_DEMO_AUTH`, the seeded-owner fallback,
   `allowDevelopmentFallback` from request authentication, and all demo labels
   from the login/profile surfaces.
4. Keep test-only credentials inside isolated E2E/test setup; never add a
   production password, owner UUID fallback or bypass to application code.
5. Add tests for empty/invalid credentials, valid credentials, tampered/expired
   sessions, logout, unauthenticated protected reads and absence of demo paths.

## Resolution implemented

The owner approved the change with “ลุย”. The application now authenticates an
email or account code against `PersonCredential` using scrypt, then issues a
signed, expiring `zuri_session` HttpOnly cookie. Login rejects missing or
invalid credentials with a generic `401`; logout clears the cookie. The
legacy `/api/session/login` route, local-demo cookie, environment bypass,
request-viewer fallback and demo profile labels were removed. Seed and E2E
setup provision credentials only from explicit test/local environment values.

## Global-view follow-up

The first post-auth E2E run exposed four failures. The three data views were
calling their compatibility APIs without a scope after the demo operator
fallback was removed:

- Dependencies called `GET /api/dependencies`.
- Milestones & Gates called `GET /api/milestones`.
- Schedule called `GET /api/projects?view=timeline`.

The route guards were correct to reject those installation-wide reads for an
ordinary owner. The defect was at the global-view boundary: the BusinessShell
had a selected Business, but the views did not pass it. The views now pass that
Business, the APIs authorize visibility with `seesBusiness`, and the read
models filter the returned data to that Business. Business dependency reads
require both endpoints to belong to the selected Business, so a cross-Business
edge cannot disclose its other endpoint.

The fourth failure was the audit smoke assertion. Audit remains intentionally
installation-wide and operator-only under FR-075; the test now proves that an
ordinary owner receives the explicit operator-authority error instead of
creating a test-only operator bypass.

## Verification

- Focused authentication tests: 21 passed.
- Full Vitest suite: 248 files passed, 4 skipped; 1,847 tests passed, 14
  skipped.
- Production build: passed; route output contains `/api/auth/login` and
  `/api/auth/logout`, with no legacy session-login route.
- Targeted regression units: 25 tests passed across the route, service and UI
  scope contracts.
- Targeted Playwright smoke: 28 passed, 4 skipped. Dependencies, Milestones &
  Gates, Schedule and the audit operator boundary are green.
- Governance: passed with 0 critical and 0 warning findings.
- Full Playwright suite: 58 passed, 4 skipped; no flaky tests.

## Status

Authentication implementation and the global-view scope follow-up are fully
verified locally. Production deployment and hosted-provider configuration remain
separate operational gates.

## Changelog

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.2.0b | 2026-08-22 | unstable | Replaced credential-free demo login with PersonCredential authentication and signed sessions; recorded verification follow-up. | — | ATHER |
| 0.3.0b | 2026-08-22 | beta | Repaid the four global-view smoke failures with selected-Business reads and a truthful operator-only audit assertion. | — | ATHER |
