---
version: "0.2.2b"
created_at: "2026-08-22T00:00:00+07:00,ATHER"
last_update: "2026-08-23T00:00:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "implementation-plan"
  scope: "Issue #99 / FR-094..FR-098"
---

# Implementation plan — Issue #99 production IAM

## Complexity and risk

Architecture/security change, C-3, HIGH risk. The P0 slice covers the identity
module, session persistence, Membership lifecycle and shared policy adoption.
The approved production extension adds a separate database-runtime role
cutover; it does not activate a provider or introduce an IAM microservice.

## Work order

| Work | Deliverable | Proof |
|---|---|---|
| W0 | Register FR-094..098, NFR-019, BR-020, SEC-018, SDD-052, FEAT-010 and ADR-045 | `npm run govern` |
| W1 | Add Session/ChannelIdentity schema and Membership lifecycle fields | Prisma format, local schema push, Postgres schema parity |
| W2 | Persist and revalidate sessions; revoke current session | session unit/integration tests |
| W3 | Implement one identity-owned authorization context and fail-closed scope decision | policy unit tests and viewer regression tests |
| W4 | Bind agent action and tool invocation to the shared context | forged-scope and suspended-membership tests |
| W5 | Preserve backup/restore and generated documentation coverage | snapshot coverage and docs preflight |
| W6 | Review provider/production gates | explicit NOT_RUN evidence; no activation claim |
| W7 | Prepare the production database runtime cutover | `zuri_web_login` is `LOGIN`, `NOBYPASSRLS`, inherits only `zuri_app_runtime`; public app tables remain server-owned and are not exposed to Data API roles |
| W8 | Rotate the deployment connection and prove the non-privileged path | credential is set outside Git, `current_user`/`has_table_privilege`/RLS probes pass, auth/IAM canary passes before retiring `postgres` runtime use |

## Production evidence — 2026-08-23

- W7 is applied to `zuri-v2` (`qcnmhyglarzcpudjorzc`): both canonical IAM
  migrations are present in remote migration history.
- The direct post-apply dry-run is up to date. Live catalog checks confirm the
  IAM tables have RLS and forced RLS, `zuri_web_login` is non-privileged and
  inherits only `zuri_app_runtime`, and runtime DML policy/grant coverage is
  present for 61 public tables.
- A schema/data/roles logical backup was written outside the repository before
  apply. The free plan's managed backup/PITR features were not enabled and no
  billing action was taken.
- W8 database/runtime-secret portion is applied: Vercel Production
  `DATABASE_URL` now uses the non-privileged `zuri_web_login` through the
  transaction pooler (`6543` with `pgbouncer=true`), and the existing
  production artifact was redeployed successfully. The direct login canary
  reports `current_user = zuri_web_login` with IAM table access.
- Preview `DATABASE_URL`, Preview `DIRECT_URL`, and all `ZURI_PLUGIN_*` variables
  were left unchanged. `DIRECT_URL` Production also remains unchanged for
  migration/admin use.
- The authenticated application canary remains open. The redeployed artifact
  is the existing `main` production artifact rather than the unmerged
  `codex/issue-99-iam` worktree, and no production user credential was used for
  a login/logout/revocation/cross-tenant test. Do not claim the full Issue #99
  application cutover production-ready yet.

## Exit gates for this slice

- no protected operation relies only on a signed cookie when a live Session store
  is available;
- inactive Membership rows contribute no visibility, staff classification or
  authorization;
- payload/model/tool scope cannot widen server-owned authorization;
- policy denial occurs before retrieval or tool side effects;
- schema models are in the snapshot restore contract;
- targeted IAM tests, build and governance pass;
- the application runtime no longer depends on the `postgres` role or any
  `BYPASSRLS` role;
- the runtime login has no DDL/admin privilege, public Data API roles have no
  base-table access, and every public server-owned table has an explicit
  runtime policy before the connection secret is rotated;
- credential rotation and application canary are proven separately from the
  additive schema migration.

## Deferred gates

LINE Login/LIFF verified onboarding, OIDC, MFA, recovery, device management,
provider credentials, full API/MCP route inventory, and live LINE canary remain
open until separately evidenced. The role cutover still requires an external
deployment-secret change; no secret is stored in this repository.

## Rollback

Disable the shared agent/tool adoption behind the existing compatibility seam,
preserve Session rows and audit evidence, and do not delete external identity or
provider data. If the runtime canary fails, restore the previous deployment
connection secret through the deployment system, keep the additive schema and
roles for inspection, and do not return the application to a privileged role
without an incident gate. A schema rollback requires an inspected migration and
backup; there is no destructive automatic rollback.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-22 | beta | Approved P0 IAM vertical slice for Issue #99 | working-tree | ATHER |
| 0.2.0 | 2026-08-23 | beta | Boss approved the production runtime-role cutover extension after remote preflight found `postgres` runtime use | working-tree | ATHER |
| 0.2.1b | 2026-08-23 | beta | Recorded free-plan logical backup and live W7 migration evidence; W8 credential/canary gate remains open | working-tree | ATHER |
| 0.2.2b | 2026-08-23 | beta | Recorded Vercel Production runtime-secret rotation, redeploy and direct transaction-pooler canary; authenticated app canary remains open | working-tree | ATHER |
