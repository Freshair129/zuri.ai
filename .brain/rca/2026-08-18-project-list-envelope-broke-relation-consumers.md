---
version: "0.1.0b"
created_at: "2026-08-18T04:47:48+07:00,ATHER"
last_update: "2026-08-18T04:47:48+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "stable Project list DTO introduced without an explicit compatibility boundary"
---

# Incident — stable Project list envelope broke relation-rich consumers

## Symptom

After `GET /api/projects` changed from a bare Project array to the approved
stable `{ items, limit, truncated }` envelope, the Project list itself loaded,
but existing Business Overview and global Timeline consumers failed. Overview
attempted array operations on the envelope, and Timeline could no longer find
the relation-rich `workstreams` and `milestones` data needed to render dated
bars.

## Evidence

- The first full E2E run after the DTO change failed at `tests/e2e/smoke.spec.js:63`
  (`timeline renders dated bars`) because `PRJ-B01-TRANSFORM` never appeared.
- The same run exposed `TypeError: (projects || []).reduce is not a function`
  in `src/app/(pm)/overview/page.jsx`, proving that the consumer still expected
  an array rather than the new response envelope.
- Unit tests, integration tests, and the production build were green before the
  full consumer E2E run; after adding explicit compatibility views, the focused
  Timeline and Workspace E2E checks passed and the final suite passed 45 tests
  with 4 existing skips and no flaky pass.

## Root Cause

The read endpoint had an implicit, relation-rich response contract shared by
multiple UI projections. The new stable list contract changed that response
shape at the route boundary, but the consumers had not been enumerated and
migrated together. The coupling was hidden because the old route returned
Prisma-shaped arrays and the `/projects` page was the only consumer in the
approved slice.

## Why the issue escaped detection

The initial contract tests proved the new DTO and the Project list page, but did
not prove every existing `/api/projects` caller's expected shape. Focused unit
and integration tests therefore passed while the full browser suite was the
first test to exercise Overview and global Timeline against real route data.

## Fix

- Keep the stable DTO as the default `view=list` response for `/projects`.
- Add explicit `view=overview`, `view=timeline`, and `view=workspace` compatibility
  reads that preserve the existing relation-rich array shape for those consumers.
- Make each consumer request its compatibility view explicitly; the Project list
  page consumes `items` and reports `truncated`.
- Add route-dispatch, source-contract, focused integration, and focused E2E
  coverage for the boundary.

## Proposed prevention

- Before changing a shared read shape, enumerate all route consumers with a
  repository search and verify each one against the contract.
- Keep stable DTOs and legacy compatibility projections as named boundaries;
  do not make a stable list DTO carry unrelated relation graphs.
- Require the full `npm run test:e2e -- --fail-on-flaky` gate after cross-consumer
  read-model changes, in addition to focused unit and integration tests.
