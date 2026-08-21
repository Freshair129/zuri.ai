---
version: "0.1.0b"
created_at: "2026-08-21T20:35:00+07:00,ATHER"
last_update: "2026-08-21T20:35:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "doc-governance"
  doc_type: "root-cause-analysis"
  scope: "API method-level inventory and OpenAPI coverage"
---

# RCA — API path coverage did not govern API method coverage

## Symptom

The full verification suite failed because `DELETE /api/agent/heartbeat` was
implemented by the route handler but absent from the generated OpenAPI
document. Appendix A also listed only `GET/POST` for that path.

## Evidence

- Commit `5aa5d4b` added `export async function DELETE` to
  `src/app/api/agent/heartbeat/route.js`.
- `src/modules/project-manager/api-docs/openapi.js` still listed only
  `GET/POST` for `/api/agent/heartbeat`.
- `docs/appendices/A-api-spec.md` still listed only `GET/POST` for the same
  endpoint.
- `scripts/domain-state.mjs` compared API paths but not API methods, so its
  route check remained green.
- `tests/integration/openapi-docs.test.js` failed with:
  `DELETE /api/agent/heartbeat is missing from OpenAPI`.

## Root Cause

The route tree, human API appendix and machine-readable inventory stored method
coverage separately, while the governance projection reduced the comparison to
path coverage. Adding a method therefore bypassed the governance check until
the OpenAPI integration test ran.

## Why the issue escaped detection

The feature change touched the route and its UI but did not update the API
inventory. The existing path-only check treated the already-known heartbeat
path as fully documented, and the verification chain did not reach its later
stages because the method-level test failed first.

## Proposed prevention

Keep the three current-operation surfaces synchronized and make `apiCheck`
compare `METHOD path` pairs for both Appendix A and the OpenAPI inventory. Keep
the integration test as the executable contract for every route handler.
