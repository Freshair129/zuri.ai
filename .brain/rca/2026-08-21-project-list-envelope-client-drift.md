---
version: "0.1.0b"
created_at: "2026-08-21T21:10:00+07:00,ATHER"
last_update: "2026-08-21T21:10:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "root-cause-analysis"
  scope: "client consumers of the stable project-list response envelope"
---

# RCA — a new work surface still assumed the retired project-list array

## Symptom

The `/work` E2E smoke test crashed while rendering the closed task-creation
modal. The browser reported `TypeError: (projects || []).filter is not a
function` in `StandaloneTaskModal`.

## Evidence

- The current `GET /api/projects` contract returns `{ items, limit, truncated }`.
- `StandaloneTaskModal` treated the response as a raw array and called
  `.filter` on the envelope object.
- The failure reproduced twice, including the Playwright retry, at
  `tests/e2e/smoke.spec.js:58`.
- The consumer also fetched `/api/businesses` and `/api/workspaces`, neither of
  which is a current route; `/api/scope` already returns the visible
  businesses, workspaces and projects needed by the modals.

## Root Cause

The stable project-list envelope was introduced in `45cc222`, but the later
unbundled-work surfaces were written against the earlier array-shaped client
assumption. The route inventory governed handlers, not the response shapes
consumed by every UI caller.

## Why the issue escaped detection

No unit contract covered `StandaloneTaskModal`, and the full E2E suite did not
exercise the current envelope until the `/work` smoke route rendered the modal's
hooks. The obsolete endpoint strings were also not checked against the current
route inventory.

## Proposed prevention

Use the canonical `/api/scope` read model for the shared scope collections and
keep a small response-shape contract test beside the consumer. Treat a response
envelope change as a consumer migration, not only a route change.
