---
version: "0.1.0b"
created_at: "2026-08-21T07:00:00+07:00,ATHER"
last_update: "2026-08-21T07:00:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "runtime-contracts"
  doc_type: "root-cause-analysis"
  scope: "LINE webhook, session, viewer and OpenAPI contract regressions"
---

# RCA — Zuri suite contract regressions

## Symptom

The full Zuri test suite reported 17 failing files and 53 failing tests. The
failures appeared in LINE webhook processing, evidence convergence, session
login, viewer resolution, runtime cutover, and OpenAPI inventory.

## Evidence

- The focused reproduction before remediation reported 15 failing files and
  37 failing tests across the affected contract groups.
- `src/app/api/agent/line-webhook/route.js` had bypassed the canonical agent
  turn path, used a hard-coded reply path, swallowed evidence errors, and
  omitted response/evidence fields required by the transport contract.
- `src/modules/identity/resolve-viewer.js` called `person.findFirst`, while
  the repository contract and viewer fixtures expose `person.findUnique`.
- The session changes allowed authenticated development fallback, added a live
  cookie branch, and made the demo route bypass its trusted-local guard.
- The login page attempted to set cookies and call the demo endpoint from the
  client instead of using the explicit server-owned form action.
- The OpenAPI inventory omitted the existing
  `/api/platform/integrations/line-registry` route.
- After remediation, the full suite completed with 232 passed files, 1,682
  passed tests, 4 skipped files, and 14 skipped tests.

## Root Cause

Several dirty working-tree edits changed established contracts instead of
extending them. The LINE route no longer delegated to the canonical runtime,
the identity/session changes weakened server-owned authentication boundaries,
the viewer implementation diverged from the repository seam used by tests,
and the generated API inventory was not updated when a route was added.

## Why the issue escaped detection

The changes were spread across runtime, identity, UI, and documentation
surfaces, so targeted bridge tests did not cover the complete regression set.
The full suite had not been rerun after the cross-cutting edits, and the
OpenAPI count assertion did not include the newer line-registry route.

## Remediation

1. Restore the LINE route's canonical scope, evidence, runtime turn, response,
   and fail-closed error contracts; keep reply transport outside Zuri.
2. Restore server-owned local-demo session gating and an HTTP-only demo cookie;
   keep authenticated session resolution fail-closed.
3. Align viewer resolution with the existing repository interface and preserve
   explicit principal-not-found errors.
4. Add the line-registry route to the OpenAPI inventory and update its contract
   count.
5. Run the full suite before build/governance verification.

## Prevention

- Treat LINE transport, session, and viewer contract tests as a single required
  regression group for cross-cutting runtime changes.
- Keep provider reply ownership, session cookie ownership, and tenant scope
  resolution server-side; do not replace them with client or hard-coded paths.
- Run `npm test -- --reporter=dot` after any change crossing runtime and UI
  boundaries, then run `npm run build` and `npm run govern`.
- Update route inventory assertions whenever a route is added.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0b | 2026-08-21 | beta | Evidence-backed cross-cutting contract regression repair | working-tree | ATHER |
