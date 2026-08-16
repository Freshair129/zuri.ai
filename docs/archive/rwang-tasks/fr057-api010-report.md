---
version: "0.1.0b"
created_at: "2026-08-15T00:00:00+07:00,ATHER"
last_update: "2026-08-15T23:50:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "identity-security-memory"
  doc_type: "phase-report"
  scope: "FR-057 / Issue #11 API-010 follow-up"
---

# FR-057 API-010 canonical resolver — phase report

## Scope

This follow-up closes the Zuri-side API-010 integration gap identified after
PR #12. The canonical path now resolves the GoVibe/MSP vault set on every
authorized private-memory operation, consumes the opaque Workspace Private ID
for API-009, and keeps the former scope-key adapter behind explicit
`compatibilityMode`.

No GoVibe/MSP schema or migration was changed. Production LINE activation and
MSP rollout remain gated; the adapter is available when a trusted runtime wires
an MSP transport and supplies the required server-owned workspace/project scope.

## Acceptance evidence

| Acceptance area | Evidence |
|---|---|
| API-010 request contract | `src/modules/agent/msp-vault-resolver.js` emits the canonical snake_case request and carries server-derived tenant, principal, agent, workspace, project, conversation, and policy fields. |
| Opaque authorized set | Canonical memory reads/writes use only `workspacePrivateVaultId`; Global/Shared IDs and permissions remain on the resolved set. |
| Fail closed | Missing scope, denied/malformed API-010 response, unsupported operation, invalid authorization, and transport failure stop before API-009. |
| Tenant/principal/workspace isolation | AuthContext and authorized-scope equality checks cover tenant, principal, agent, workspace, and project; regression tests cover forged principal/workspace scopes. |
| Legacy boundary | Direct scope-key `recall`/`remember` and legacy authorized access require explicit `compatibilityMode`. |

## Verification

- Focused API-010/FR-057 suite: 5 files, 41 tests passed.
- Full Vitest: 104 files passed, 3 opt-in PostgreSQL files skipped; 606 tests
  passed, 9 skipped.
- Production build: PASS; Next.js generated 25 static pages and completed type
  checking.
- Playwright E2E: 34 passed, 4 superseded tests skipped.
- Documentation: graph 789 nodes / 1490 edges / 0 dangling; FR code/test
  coverage 57/57; preflight 0 critical / 0 warning; `docs:check` PASS.
- Integrity: `git diff --check` PASS; exact conflict-marker scan PASS; no
  `.env` or secret value file was added by this change.

## Remaining boundary

The Phase 1 LINE runtime remains production-disabled and does not implicitly
activate MSP. A production cutover must separately provide a trusted
workspace/project binding, wire the MSP transport, and pass the existing
activation gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-15 | beta | API-010 canonical resolver and opaque-ID API-009 adapter verified locally | working-tree | ATHER |
