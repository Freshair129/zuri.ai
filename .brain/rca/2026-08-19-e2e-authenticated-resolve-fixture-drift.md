---
version: "0.1.0b"
created_at: "2026-08-19T03:49:00+07:00,ATHER"
last_update: "2026-08-19T03:59:09+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "identity-security"
  doc_type: "root-cause-analysis"
  scope: "E2E fixtures used a protected resolve read before establishing a viewer"
---

# RCA — E2E resolve fixture used a protected read before authentication

## Symptom

The authorization seam PR passed unit tests and the governance/build checks, but
its full Windows E2E run failed with 9 failures, 42 passes, and 4 skips. The
failures clustered around Project pages, plan import, file views, inventory,
and the external-id resolve contract.

## Evidence

- GitHub Actions run `32182083415`, E2E job `95859929321`, checked out PR #66's
  merge ref `1b2be7893e5037f0e776c6a6ead8056214f8bfd3`.
- The job reported `9 failed`, `42 passed`, and `4 skipped`.
- The failing Project-page specs called `request.get('/api/resolve?...')`
  before their `chooseBusiness`/`enterBusiness` helper. The protected route
  returned 401, so the following URL contained an undefined Project id and the
  expected page landmarks never rendered.
- The FR-019 unmapped external-id test expected 404 from an unauthenticated
  request, while the new route correctly returned 401 before lookup.
- The same PR's targeted authorization tests passed, including the
  unauthenticated fail-closed boundary.

## Root Cause

The test transport context lagged behind the route contract. The authorization
change made `/api/resolve` require a trusted viewer, but several E2E tests still
treated the Playwright `request` fixture as an unauthenticated public lookup.
The tests therefore failed at fixture setup, not because the scope guard
returned the wrong result.

## Why the issue escaped detection

The unit tests exercised the route guard with explicit viewer fixtures, while
the E2E tests exercised the UI with a logged-in `page` but resolved the Project
id through a separate unauthenticated `request` fixture before login. The
targeted tests did not cover the boundary between those two transport
contexts, and the existing FR-019 test encoded the pre-guard 404 behavior.

## Proposed prevention

1. Authenticate before any protected fixture lookup and use `page.request` so
   the browser's demo-session cookie is carried into the API call.
2. In API-only E2E tests, create the demo session explicitly before asserting
   an authenticated 404/400 lookup contract.
3. Keep a separate unauthenticated assertion that expects 401, so the test
   suite proves both fail-closed transport and authenticated not-found behavior.

## Remediation target

Update only the affected E2E setup and assertions. Do not weaken the
`/api/resolve` authorization guard or expose Project identifiers to anonymous
callers.

## Remediation result

The affected specs now establish the demo session before resolving a Project
and use `page.request` when the UI login owns the cookie. The API-only
not-found assertion establishes its own demo session, while the separate
unauthenticated inventory assertion continues to prove a 401 fail-closed
response. The route guard itself was not relaxed.

Targeted verification on the authorization branch passed:

- FR-040 Project Work: 4/4 including warmup.
- FR-058 project file view: 3/3 including warmup.
- FR-077 Project Inventory: 6/6 including warmup.
- Plan import: 2/2 including warmup.
- Excel intake: 2/2 including warmup.
- FR-019 unmapped external id: 3/3 including warmup.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0b | 2026-08-19 | beta | Evidence-backed E2E fixture/authorization contract drift | working-tree | ATHER |
