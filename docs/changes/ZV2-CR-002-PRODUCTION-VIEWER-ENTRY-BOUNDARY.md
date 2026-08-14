# ZV2-CR-002 — Production viewer and entry boundary

| Field | Value |
|---|---|
| **Version** | 0.2.0b |
| **Status** | Implemented — beta |
| **Date** | 2026-08-14 |
| **Risk** | HIGH |
| **Authority** | ADR-017, FR-046, SDD-024, SEC-008 |

## Change intent

Replace the demo-only two-fetch Business Routing contract with one trusted,
viewer-filtered server response while preserving existing route URLs and rollback.

## Compatibility matrix

| Surface | Current | Proposed | Compatibility/rollback |
|---|---|---|---|
| `/businesses` | fetches `/api/viewer` + broad `/api/scope`; filters in client | fetches only `/api/entry` | restore old page during rollback; no data migration |
| `GET /api/entry` | absent | minimal viewer + allowed Business ancestry | additive route; remove on rollback |
| `GET /api/viewer` | implicit development fallback | request-session scoped compatibility endpoint | retain until consumers migrate; never accept client principal |
| `GET /api/scope` | broad inventory and mutation interface | no longer used for Business Routing | route remains; production hardening is separately gated |
| `resolveViewer()` | accepts trusted arguments but routes call without request identity | called through `resolveRequestViewer(request)` | pure resolver contract retained |
| demo login | UI transition only | explicit non-production session capability | feature flag rollback; impossible in production |

## Migration and removal rules

1. This slice is additive and introduces no destructive schema migration.
2. `/api/viewer` is retained until repository search and contract tests prove there
   are no pre-shell consumers requiring its legacy response.
3. `/api/scope` is not deleted; only its use by `/businesses` is removed.
4. No legacy identity/session code is deleted unless the same PR records exact usage
   evidence and rollback.
5. If an eventual session provider needs persistence, its model/migration requires a
   separate approved amendment to this CR.

## Rollback

- disable the new entry/session feature flag;
- restore the FR-044 Business Routing fetch pair in non-production only;
- remove the additive `/api/entry` route and request-session adapter;
- run OWNER/MEMBER/DEV and cross-tenant contract tests;
- do not weaken production to implicit demo fallback during rollback.

## Gate

Approval of this CR authorizes implementation of the contract, not selection of a
login provider or new session database model.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Proposed additive viewer-scoped entry boundary and compatibility plan | pending | ATHER |
| 0.2.0b | 2026-08-14 | beta | Approved change implemented; no schema migration or provider selection introduced | pending | ATHER |
