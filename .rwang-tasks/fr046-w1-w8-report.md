# FR-046 W1-W8 implementation report

| Field | Value |
|---|---|
| Date | 2026-08-14 |
| Status | Complete — beta |
| Risk | HIGH |
| Authority | ADR-017, FR-046, SDD-024, SEC-008, ZV2-CR-002 |

## Delivered

- Provider-neutral `SessionPort` and `resolveRequestViewer(request)` fail closed.
- Explicit non-production demo session uses an HttpOnly SameSite=Lax cookie; production denies it.
- `GET /api/entry` returns a strict minimized viewer and authorized Business ancestry DTO.
- Business Routing uses one entry fetch; entry surfaces do not prefetch broad `/api/scope`.
- `/api/viewer`, People, Business Strategy, managed Files, Profile and Platform Users
  compatibility routes use trusted request identity before resource authorization.
- No schema migration or concrete authentication provider was introduced.

## Verification evidence

- RED: missing request-session/read-model modules and legacy two-fetch page; later RED
  proved invalid principal mapped to 503 and profile/platform routes bypassed request identity.
- GREEN focused: 10 files / 26 tests.
- Full Vitest: 80 files / 412 tests passed.
- Focused Playwright entry compatibility: 3 tests passed.
- Full Playwright: initial run found two API-request fixtures missing the new session;
  fixtures were corrected, focused regression passed 5/5, and the final full rerun
  passed 34 with 4 explicitly skipped superseded tests.
- `npm run build`: passed; `/api/entry` and `/api/session/demo` compiled.
- Live `run.bat` smoke on port 3100: anonymous entry `401`, demo POST `303`,
  cookie-authenticated entry `200` with one stored cookie.
- Governance: 679 nodes / 1210 edges / 0 dangling; preflight 0 critical / 0 warning;
  docs check and diff check passed.

## Security and rollback

- Client headers/body/query are not identity inputs.
- Cross-tenant integration proof returns only the member Business and its ancestry.
- Rollback is additive: remove entry/demo routes and request adapter, restore the FR-044
  local two-fetch page only outside production; no database rollback is required.
- Remaining decision: select the concrete login/session provider and persistence model.
