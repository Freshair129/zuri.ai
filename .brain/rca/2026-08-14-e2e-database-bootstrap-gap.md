---
version: "0.2.0b"
created_at: "2026-08-14T05:55:00+07:00,ATHER"
last_update: "2026-08-14T06:00:00+07:00,ATHER"
status: "beta"
attributes:
  domain: "test-infrastructure"
  doc_type: "root-cause-analysis"
  scope: "Playwright database bootstrap"
---

# RCA — Playwright database bootstrap gap

## Symptom

`npm run test:e2e` does not complete reliably in a clean worktree. The suite retries broad UI
failures until the outer command times out. A bounded single-test replay reaches `/businesses`
after demo login but renders `SESSION_UNAVAILABLE` instead of the Business Routing heading.

## Evidence

- the first full run exceeded 304 seconds without a terminal Playwright result;
- a second four-worker run produced retry artifacts across FR-040, FR-041, FR-044, FR-045,
  FR-046 and smoke tests;
- isolated replay of `tests/e2e/fr046-entry-contract.spec.js` fails in 20.3 seconds because
  `/api/entry` returns `503 {"error":"SESSION_UNAVAILABLE"}` after the demo cookie is set;
- the failure screenshot shows `Unable to load Business Routing / SESSION_UNAVAILABLE`;
- `playwright.config.js` supplies `ZURI_LOCAL_DEMO_AUTH=1` but does not supply `DATABASE_URL`
  or initialize/seed an E2E database;
- the clean publication worktree has no `.env` or `prisma/dev.db`; `.env.example` documents
  `DATABASE_URL="file:./dev.db"`, but ignored local files are not a test dependency;
- Vitest passes because `tests/global-setup.js` explicitly creates `prisma/test.db` and passes
  its own `DATABASE_URL` to Prisma.

## Root Cause

The Playwright harness depends implicitly on a developer-created `.env` and seeded SQLite file.
Unlike Vitest, it does not own a deterministic database bootstrap. Prisma therefore cannot resolve
the local datasource in a clean worktree; `resolveRequestViewer()` intentionally masks that adapter
failure as `SESSION_UNAVAILABLE`, causing many browser tests to retry the same infrastructure error.

## Why the issue escaped detection

Earlier E2E runs occurred in a workspace where `.env` and local seed state already existed. The
Playwright configuration verified the demo-auth flag but never asserted that all required runtime
state was created by the suite itself. The outer timeout also obscured the first actionable failure.

## Proposed prevention

1. Give Playwright a dedicated ignored `prisma/e2e.db` through an explicit `DATABASE_URL`.
2. Add a Playwright global setup that deletes only that exact test database, runs `prisma db push`,
   and executes the idempotent seed with the same environment.
3. Keep development `.env` and `prisma/dev.db` outside the E2E contract.
4. Add a focused infrastructure assertion proving the E2E server receives the isolated URL.
5. Re-run the isolated FR-046 flow first, then all 38 Playwright tests, full tests, build and docs.

## Acceptance and exit gates

- isolated FR-046 browser flow passes from a clean `prisma/e2e.db`;
- all 38 Playwright tests finish with an explicit pass/fail result;
- no dev/test database other than the exact E2E target is deleted or modified;
- `npm test`, production build, docs graph/check/preflight and diff check remain green.

## Implementation result

Approved on 2026-08-14 and implemented with `tests/e2e/global-setup.js`. Playwright now
deletes only its explicit `prisma/e2e.db`/journal targets, pushes the schema, runs the idempotent
seed, and starts a non-reused Next dev server with the same `DATABASE_URL`. The isolated FR-046
flow passed 1/1; the full browser suite completed with 34 passed and 4 intentionally skipped.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Evidence-backed E2E bootstrap root cause and bounded prevention proposed | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Approved isolated E2E database bootstrap implemented and browser suite completed | working-tree | ATHER |
