---
version: "0.2.6b"
created_at: "2026-08-22T00:00:00+07:00,ATHER"
last_update: "2026-09-22T07:29:28+07:00,Codex"
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
- The IAM code was merged by PR #100 into `main` at
  `0f636e61c040769a331120e9f1a4041151288680` after `changes`, `verify`, and
  `e2e` checks passed. A clean worktree at that merge commit was deployed to
  Vercel Production as `dpl_6PApLxAm5LFGt9ocWwz2TVn2HhNW` and is READY at
  `zuri-cgvz7ivwa-pornpons-projects.vercel.app`; the production aliases are
  `zuri-ai-woad.vercel.app` and `zuri-ai-pornpons-projects.vercel.app`.
- The post-deploy negative/auth-boundary canary passed on the canonical
  production alias: `/` returned HTTP 200, `/api/viewer` returned HTTP 401
  `AUTH_REQUIRED`, fake credentials at `/api/auth/login` returned HTTP 401
  `INVALID_CREDENTIALS` with the route matched, and `/api/auth/logout`
  returned HTTP 200. No real production credential or user fixture was used.
- Preview `DATABASE_URL`, Preview `DIRECT_URL`, and all `ZURI_PLUGIN_*` variables
  were left unchanged. `DIRECT_URL` Production also remains unchanged for
  migration/admin use.
- A fresh 2026-09-22 production-tail canary used the synthetic 48-hour test
  account: login succeeded, only the SmartGift Business was listed, the
  protected Projects surface returned SmartGift data, a crafted EMC Project
  identifier returned not-present-in-current-scope, and logout caused the next
  protected request to return to `/login`. The final active session count was
  zero. No credential, cookie or token was recorded.
- The same receipt refreshed the runtime boundary: `current_user` was
  `zuri_web_login`, the role was non-privileged and `NOBYPASSRLS`, `Person`,
  `Membership` and `Session` had RLS and forced RLS, and the Data API/service
  roles had no `Person` SELECT grant. The idempotent repair is
  `apps/server/supabase/migrations/20260922100000_force_person_rls.sql`, and
  its production receipt is recorded as
  `20260922100000 / force_person_rls` in `supabase_migrations.schema_migrations`.
- Provider/channel onboarding, agent/tool/MSP side-effect denial and owner SOT
  acceptance remain open. This evidence does not make the full Issue #99
  application cutover production-ready.
- A production-only effective-key defect was repaired after the live account
  showed `bindingCode = NULL`: admission used `bindingCode || account.id`, but
  the server-bound Project/Work tool compared the nullable field directly. The
  fix and null-binding-code regression are in
  `apps/server/src/modules/agent/line-project-work-tools.js` and
  `apps/server/tests/integration/line-project-work-tools.test.js`.
- The repair was built from the deployed `5c5f12d3` baseline with the pinned
  KI17 contexts and deployed as
  `zuri-ai-web-ki17:task-zai-001-20260922` at manifest digest
  `sha256:b727a64c7167f78995188cff8b6801359eb7b3f38b080ffe0581dbf237c66261`.
  A signed loopback canary proved that the linked verified subject reached the
  Project tool while a pending subject received the generic denial. The
  synthetic provider reply was rejected with `LINE_HTTP_400`, so delivery is
  not claimed.
- Focused agent/identity/LINE/project tests passed: 7 files, 60 tests. The
  production MSP memory flag remains disabled, so the forged-agent/MSP
  side-effect gate and owner SOT acceptance remain open.
- The pinned MSP acceptance then exposed a stale zuri child-environment
  allowlist. `MSP_GLOBAL_PRIVATE_GRANT_REQUIRED`,
  `MSP_IDENTITY_HMAC_KEY_VERSION`, `MSP_IDENTITY_HMAC_KEYRING` and the
  non-secret `NODE_EXTRA_CA_CERTS` path are now explicitly forwarded; server
  secrets and transport knobs remain excluded. Transport/MSP regressions pass
  4 files and 38 tests, and the real pinned MSP process acceptance passes 1/1
  on synthetic data with temporary SQLite.
- The allowlist repair was deployed with the effective-key repair as
  `zuri-ai-web-ki17:task-zai-001-20260922-r2` at manifest digest
  `sha256:147b9784cb5a193a0f6235b29ffe24686c4ce9a2e5e181afc4cf8121b31c2046`.
  A repeat live signed canary preserved the active/pending tool boundary. The
  production memory flag and owner SOT acceptance remain open.
- The documented read-only KI17 relay smoke initially caught a stale shared
  namespace after web recreation (`pipeline_worker_unavailable`, TCP refused on
  19417). Recreating the existing pinned `genesis-worker` container repaired
  the namespace without changing its image; the final smoke passed both
  `msp_pipeline_evidence=empty_page` and
  `msp_pipeline_query=published_generation`. No batch or receipt was written.

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
open until separately evidenced. The external deployment-secret change for W8
is complete; no secret is stored in this repository.

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
| 0.3.0b | 2026-09-22 | beta | Recorded Person force-RLS repair, fresh runtime catalog proof and authenticated/cross-business canary; provider and agent gates remain open | working-tree | Codex |
| 0.1.0b | 2026-08-22 | beta | Approved P0 IAM vertical slice for Issue #99 | working-tree | ATHER |
| 0.2.0 | 2026-08-23 | beta | Boss approved the production runtime-role cutover extension after remote preflight found `postgres` runtime use | working-tree | ATHER |
| 0.2.1b | 2026-08-23 | beta | Recorded free-plan logical backup and live W7 migration evidence; W8 credential/canary gate remains open | working-tree | ATHER |
| 0.2.2b | 2026-08-23 | beta | Recorded Vercel Production runtime-secret rotation, redeploy and direct transaction-pooler canary; authenticated app canary remains open | working-tree | ATHER |
| 0.2.3b | 2026-08-23 | beta | Recorded PR #100 merge, clean Production deployment and negative application auth canary; authenticated session and tenant evidence remain open | working-tree | ATHER |
| 0.2.4b | 2026-09-22 | beta | Recorded the effective channel-key repair, pinned production-baseline deployment, signed active/pending tool canaries and 60 focused tests; MSP side-effect and owner gates remain open | working-tree | Codex |
| 0.2.5b | 2026-09-22 | beta | Recorded the MSP environment allowlist repair, real pinned-MSP acceptance and second production-baseline deployment; production memory activation and owner gate remain open | working-tree | Codex |
| 0.2.6b | 2026-09-22 | beta | Recorded the KI17 shared-namespace repair and final read-only MSP-to-GKS-to-worker smoke; production memory activation and owner gate remain open | working-tree | Codex |
