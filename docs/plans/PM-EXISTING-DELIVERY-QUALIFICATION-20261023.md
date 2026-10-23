---
id: ZAI:PM-EXISTING-DELIVERY-PLAN-20261023
title: Existing PM delivery qualification plan
doc_type: implementation-plan
status: approved
version: "0.5.0"
approved_at: "2026-10-23"
approved_plan_commit: "c291afcd601a9036a0f188656b96a233c20d4979"
source_revision: "e1014247b01cd42bca589e679c840d2c2c8f2857"
relations:
  - type: references
    target: ZAI:PM-DOMAIN-SRS
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:ADR-101
  - type: references
    target: ZAI:ADR-104
---

# Existing PM Delivery Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify existing Feature, strategy and Business-bootstrap behavior and prepare a narrowly selected release without reimplementing merged capabilities.

**Architecture:** Preserve existing PM/Identity services and recovery boundaries. Use real non-bypass roles for policy proof and the current generated adapters for parity. Keep source reconciliation, isolated qualification and external activation as distinct task exits.

**Tech Stack:** Existing Prisma adapters, PostgreSQL policy SQL, Vitest, Playwright, protected recovery CLI, Docker release tooling and document governance.

**Spec:** [Approved SRS](../domains/project-manager/SRS.md), [FR-252](../requirements/FR-252.md), [Feature evidence](../domains/project-manager/features/FR-252-project-feature-authority.md), [FR-270 delivery evidence](../domains/project-manager/features/FR-270-4dx-weekly-execution.md), [Business template contract](../change-requests/business-provisioning/STANDARD-BUSINESS-TEMPLATE-V1.md).

## Global Constraints

All [master-plan constraints](PROJECT-MANAGER-IMPLEMENTATION-20261023.md#global-constraints) apply.
Source presence, generated DDL, local tests, hosted CI and external acceptance
must be recorded independently. A disposable cluster's administrative user is
not effective runtime-role proof. Generated schema setup is not proof that
committed provider migrations have been applied correctly.

## Review Focus

The tests below own pooled-scope leakage, bypass-role false positives, expiry
after row-lock waits, partial/corrupt recovery and cross-Business strategy or
bootstrap mutations. Deployment target/profile confusion is owned by B4.

## Task B1: Reconcile current delivery sources

**Files:** current `docs/roadmap/ROADMAP.md`, PM notes for FR-252 and FR-268–272,
`docs/domains/project-manager/SRS.md` section 6 when an actual conflict is
closed (with necessary version/history and approval-context metadata). Canonical records and frozen historical snapshots are read inputs.

**Interfaces:** consume exact source commit ancestry, source files, accepted
decisions and dated results; produce current supporting-note/roadmap wording
that distinguishes implementation-present, verification-pending and release-open.

- [x] Inspect the current Feature service/API/UI and commits `052821a7`/`67ffc906`; reconcile the old W3 wording with actual composition. Inspect `02f54a52`, `54e7e357`, `8a2fd498` for strategy and `ee5d789e` for bounded bootstrap. Verify ancestry on the selected execution base, not only on this planning snapshot.
- [x] Read the exact canonical row, source-preserved wrapper and controlling ADR for each conflict. Correct explanatory notes such as the design-only FR-271 note using exact code/evidence references; do not label current runtime healthy from old evidence.
- [x] If a canonical delivery cell must change, prepare a precise reviewed-migration proposal preserving ID, subject, statement meaning and membership. Mark that change held until its exact migration is approved; no manual hash/ledger repair. This need not block isolated behavior qualification.
- [x] Recheck the 62 retained FRs through the SRS capability map and the current gap assessment. Record any newly demonstrated missing/partial behavior as a source-linked finding and amend the affected plan before coding it; do not infer all are accepted from their `current` lifecycle.
- [x] Run canonical-registry checks, regenerate owned document views and run governance/corpus checks. Independent review then commits only these explanatory changes as `docs(pm): reconcile current implementation evidence`; retain remaining acceptance gates.

**Exit:** each SRS source conflict has a truthful disposition and exact evidence
pointer, or an explicit canonical-migration hold. No application change is needed
to make an old status sentence look green.

## Task B2: Feature policy, service and recovery qualification

**Files (Server-relative):**

- Create `tests/helpers/pm-role-target.js`: owns a disposable PostgreSQL target, reviewed role setup, runtime Prisma client and guaranteed teardown; accepts no external URL.
- Create `tests/postgres/phase-b-runtime-role.test.js`: real role + repository/service tests; explicitly add to `vitest.postgres.config.js`.
- Existing regression inputs: `tests/integration/project-feature-{mutations,graph,read-routes,erasure}.test.js`, `tests/integration/phase-b-{recovery,web-recovery,identity-erasure}.test.js`, `tests/unit/phase-b-feature-migration.test.js` and `tests/unit/phase-b-backup.test.js`.
- Candidate repair boundaries only after a reproduced defect: `src/modules/project-manager/application/project-feature-{repository,service,erasure}.js`, `phase-b-backup.js`, the owned recovery scripts and the current schema inventory. Do not rewrite issued migration files to mask deployed drift.

**Interfaces:**

- Proposed test helper: `startPmRoleTarget() -> Promise<{admin, runtime, inventory, stop}>`; construct from `tests/helpers/embedded-postgres.js`, generated full schema and the committed `supabase/migrations/20260917041000_add_phase_b_feature_authority.sql` policy artifact. Create prerequisite roles only inside that disposable target.
- `runtime` uses the actual `zuri_app_runtime` / `zuri_web_login` relationship selected by the reviewed policy, with catalog-verified `rolsuper=false` and `rolbypassrls=false`; neither the schema owner nor a superuser may stand in for it.
- Consume `createProjectFeatureRepository({db:runtime,dialect:'postgres'}).withProjectTransaction({projectId,viewer,mode}, callback)` and the existing Feature services; never emulate RLS in JavaScript.
- Consume `loadFrozenSchemaInventory()`, `runProtectedExport(...)` and `runCleanTargetRestore(...)` from the existing recovery scripts. Use the current inventory and exact schema/snapshot digests; the old 175/177/179-model proofs are historical.

- [x] Add tests `missing_scope_cannot_read_or_write`, `foreign_business_is_invisible`, `scope_settings_do_not_leak_across_reused_connections` and `authorized_service_binds_scope_locally`. Direct role queries must return no foreign rows or refuse writes; service refusals remain redacted. Verify catalog policies/grants as well as behavior.
- [x] Add `membership_expiry_after_project_lock_refuses_write`, `competing_versions_have_one_winner`, `allocation_overflow_race_rolls_back` and `audit_failure_preserves_feature_and_receipt`. Use real sessions and observed lock waits. Do not replace authorization clocks or policy with fixtures that merely return success.
- [x] Add/extend recovery assertions for checksum mismatch, non-empty target refusal, missing authoritative family, revoked/retained personal fields, exact receipt/audit links and fail-closed inventory mismatch. Invoke the actual protected-export and clean-target-restore CLIs on synthetic owned targets; confirm preview/no-confirm performs no insertion and explicit clean-target confirmation is required.
- [x] Run the real-role proof, then current SQLite recovery/service regressions. Expected results are executed assertions, zero required skips and verified cleanup; test code or SQL-text inspection alone does not close this task.

```text
npm --prefix apps/server run test:postgres -- tests/postgres/phase-b-runtime-role.test.js
npm --prefix apps/server test -- tests/integration/project-feature-mutations.test.js tests/integration/project-feature-graph.test.js tests/integration/project-feature-read-routes.test.js tests/integration/project-feature-erasure.test.js tests/integration/phase-b-recovery.test.js tests/integration/phase-b-web-recovery.test.js tests/integration/phase-b-identity-erasure.test.js tests/unit/phase-b-feature-migration.test.js tests/unit/phase-b-backup.test.js
```

- [x] If tests expose a defect, add the failing assertion, repair only its owning port/transaction, rerun the affected engines and relevant Identity/CRM consumers. Obtain independent review of the exact composed patch, run build/governance and commit as `test(pm): qualify Feature runtime isolation and recovery` (or a scoped fix).

**Exit:** isolated role/policy/service/recovery proof is reproducible. The actual
deployment's current role and grants still require the separately authorized
ADR-097 environment proof; a synthetic target does not close that external gate.

## Task B3: Strategy and bootstrap adapter/browser qualification

**Files (Server-relative):** existing FR-268/269/270 mutation suites, FR-271
calculator tests, Business provisioning/backup suites, `vitest.postgres.config.js`,
`tests/e2e/fr269-business-kpi-scorecard.spec.js`,
`tests/e2e/fr270-business-wig-execution.spec.js`,
`tests/e2e/fr041-business-first.spec.js`, and Feature browser suites.
Modify their owning services/UI only for a reproduced source-contract failure.

**Interfaces:** reuse `createKeyResult`, `updateKeyResult`,
`recordKeyResultCheckIn`, `recordBusinessKpiObservation`, `setGoalWig` in
`business-strategy-mutation-service.js`; `smartChecks` and existing progress/week
calculators; the current provisioning service. No parallel strategy or bootstrap
writer is introduced. Existing test files supply their exact fixture contracts.

- [x] **B1 finding: reconcile FR-271 server SMART semantics before a correction.** At B1 source `2c13f616`, `smartChecks` exists and the UI calls it, but `createKeyResult`/`updateKeyResult` do not. The create schema allows nullable dates, and the patch path has no shared Time-bound evaluation. Resolve the write-time result/refusal contract against FR-271/ADR-101 D3 while preserving FR-268's explicitly optional due date; do not silently make due dates mandatory from the older supporting note. Document the exact agreed handling of null/past/Goal-exceeding dates, existing rows and Specific warnings before writing a fix. If this requires changing canonical meaning, hold that change for reviewed adoption; it does not block B2.
- [x] Then add failing service/API create and patch cases for the adopted SMART handling, including existing-row partial patches, target/baseline and date boundaries, shared client/server results, Specific handling and `null` Achievable/Relevant. Extend `tests/integration/fr268-business-key-result-mutation.test.js` and use `tests/unit/fr271-smart-checks.test.js` as calculator regressions. Exercise the actual registered POST/PATCH routes and current authorized fixtures. Repair the smallest owning writer/UI path only after the chosen invariant is reproduced; do not count calculator-only tests as server proof. Rerun the selected engines/browser cases and independent review before claiming FR-271 complete.

- [x] Extend PostgreSQL explicit selection to the three FR-268/269/270 mutation files; the two provisioning files are already included. Add parity assertions only where missing: foreign Business refusal, audit rollback, third concurrent WIG refused, selected lag invariant preserved, manual Goal progress refused when derived, and idempotent template/default-Space creation.
- [x] Run selected SQLite and real PostgreSQL files. The PostgreSQL global setup regenerates schema/client and creates a disposable schema; report this as adapter parity, with B2/provider migration proof kept separate.

```text
npm --prefix apps/server test -- tests/integration/fr268-business-key-result-mutation.test.js tests/integration/fr269-business-kpi-mutation.test.js tests/integration/fr270-business-wig-execution.test.js tests/integration/business-provisioning-template.test.js tests/integration/business-provisioning-backup.test.js tests/unit/fr271-smart-checks.test.js
npm --prefix apps/server run test:postgres -- tests/integration/fr268-business-key-result-mutation.test.js tests/integration/fr269-business-kpi-mutation.test.js tests/integration/fr270-business-wig-execution.test.js tests/integration/business-provisioning-template.test.js tests/integration/business-provisioning-backup.test.js
npm --prefix apps/server run test:e2e -- tests/e2e/fr269-business-kpi-scorecard.spec.js tests/e2e/fr270-business-wig-execution.spec.js tests/e2e/fr041-business-first.spec.js tests/e2e/project-feature-view.spec.js tests/e2e/project-feature-mutations.spec.js tests/e2e/fr271-smart-feedback.spec.js
```

- [x] Cover SMART feedback, focus preservation under delayed rendering, stale responses and refusal states; preserve 4DX's existing two-WIG and Bangkok-week contracts. Use isolated seeded browser data and the worktree's own port, never the primary dev/UAT database.
- [x] Run the selected related regressions/build/governance and independent review; retain local evidence below.
- [ ] Exact-head hosted CI remains required before merge; it has not run for B3. Local qualification does not close this integration gate.

**Exit:** current engine/UI behavior has fresh scoped evidence, and source notes
state what ran. Existing production migration/live-Business gaps remain explicit.

## Task B4: Selected release and environment acceptance

**Entry:** A1/B1–B3 accepted for the chosen artifact; include C1–C4 only when the
release contains Pipeline Builder. Read the current deployment runbook and
ADR-097/104/112 on the actual target before mutation.

**Files:** prepare the selected release's existing deployment/runbook and current
domain evidence paths. Review `scripts/production-migration-reconcile.mjs` and
the exact `supabase/migrations/*.sql` files named by the selected cohort.

- [ ] Identify the active app, image SHA, Compose project, database, volume, runtime role and migration ledger with read-only observations. Explicitly distinguish primary dev, UAT and production; loopback binding plus an active tunnel is still externally reachable.
- [ ] Compare actual catalog/security effects to the exact migration manifest. ADR-104's September approved set is not blanket authority for later Feature/KPI/4DX/bootstrap SQL; any extension needs its own exact reviewed apply scope. Never replay destructive historical SQL, insert ledger rows manually or use `prisma db push` against production.
- [ ] Prepare a logical snapshot, demonstrate recovery on an isolated empty target, verify file/schema/snapshot hashes and obtain the selected environment's authority. Then execute the existing rolled-back dry run before any separately approved apply. No credential values belong in tracked evidence.
- [ ] Build/release the exact reviewed artifact in a separate configured runtime; do not promote by repointing the primary dev container/database. Preserve previous image/configuration for rollback and document the additive-data rollback boundary.
- [ ] Run authenticated selected-Business acceptance: Feature reads/writes with foreign-scope refusal, strategy/KPI/WIG flow and bootstrap as applicable. Verify actual non-bypass-role isolation and approval flow if present. Health/login alone cannot close these cases.
- [ ] Independently check exact remote head/base/reviews/CI, image/source parity and post-merge results. Record actual migration/deploy/activation and remaining gaps in current notes/roadmap; keep historical proof files unchanged.

**Exit:** only the selected environment/cohort is accepted. Missing access,
unreviewed migration extensions or unavailable live actors remain blocked for
this task; local qualification work can still be delivered independently.

## Version history

0.1.0 (2026-10-23): initial proposed existing-delivery qualification plan.
No command above has been executed as application acceptance during planning.

0.1.1 (2026-10-23): owner approved the implementation-plan package at c291afcd; only A1 is selected for this increment. Track B/C execution and C0 contract adoption remain unstarted.

## B1 source reconciliation — 2026-10-23

**Scope:** owner selected B1 after A1; source inspected is
`2c13f6166bc865dd14aadcab3904b0f3eea42197`. This is a static source/ancestry
and document reconciliation. No application, adapter, browser, provider or
production acceptance command was run by B1. A1's results remain separately
bound to `6888ecc6`; dated results in older notes remain historical. B2/B3/B4
and C remain unstarted. B1 local closure requires the documentation checks and
independent review recorded with its commit; the unchecked B2 tasks above are
not authorized or completed by this status.

### Selected implementation and evidence disposition

Every commit below passed `git merge-base --is-ancestor <commit> 2c13f616`.
These are ancestors of the chosen execution base, not assertions of fresh
remote-head parity or current production state.

| Scope | Exact implementation ancestor | Current source observation and next gate |
|---|---|---|
| FR-252 persistence/recovery | `052821a79a5c3c9bc0f2c841068c5a07de53db36` | W1/W2 repository/service/recovery sources present; their old proof counts are not current-role proof |
| FR-252 composed read/API/UI | `67ffc9061802b7079c54579a8654b4e3faf194f6` | `project-feature-service.js`, scoped repository, read model, Feature collection/item routes, `ProjectFeatureView`/`ProjectFeatureForms` and tests are present. B2 role/service/recovery qualification and external ADR-097 runtime-role gate remain open |
| FR-060 Phase 0 attention | `314d95b8cfbdd5127b7a5d0c59147477571c79f9` | Existing Business Home goal/Key Result attention path is present; the canonical cell's local/unmerged wording is stale. This is not fresh Dashboard runtime acceptance |
| FR-268 and FR-271 Phase 1 | `02f54a5210d32b1a63dff565beac2a590fa3dda0` | Key Result persistence/writers/check-ins/read/UI and pure SMART calculator exist. FR-271 is partial: shared server SMART evaluation is missing, detailed below |
| FR-269 KPI | `54e7e35780002237cc418e5525e683b1362908d1` | Writer/read model, Business routes, `BusinessKpiScorecard` in Overview and integration/browser suites exist. B3 fresh qualification and B4 release remain open |
| FR-270 weekly execution | `8a2fd4984a868923291c68c0169b16a8f0716768` | WIG/lag mutation, weekly service, `BusinessWigExecution`, routes and tests exist. B3 fresh qualification and B4 release remain open |
| FR-286 bounded bootstrap | `ee5d789e3f504fc8ea1fbac91193b7e449607d54` | Existing provisioning service/template/default-Space and backup fixtures align with bounded PR667 scope. Task13's historical done status does not establish current live activation; B3/B4 retain their gates |
| FR-272 approval | `6888ecc629cca769866d8cc2f715cb5414746c5f` | A1's [source-bound note](../domains/project-manager/features/FR-272-approval-gateway-admission.md) already records local proof and current hold boundaries; no further note repair or test rerun is needed for B1 |

The locally observed `origin/main` ref was `55f9413b4961874b90a86ccedca2bd26f6f395c2`.
The Feature service/repository, strategy mutation service, SMART calculator and
Key Result modal have no byte diff between that ref and this B1 base. No remote
fetch, hosted check or deployment observation is claimed by this comparison.

### Newly demonstrated partial behavior: FR-271 shared server evaluation

Read inputs: [canonical FR-271](../features/FEAT-002/requirements/FR-271.md),
[FR-268](../features/FEAT-002/requirements/FR-268.md),
[ADR-101 D3](../decisions/ADR-101-BUSINESS-GOALS-BECOME-OKR-SMART-BSC-4DX.md),
[calculator](../../apps/server/src/modules/project-manager/progress/smart-checks.js),
[writer](../../apps/server/src/modules/project-manager/application/business-strategy-mutation-service.js),
[modal](../../apps/server/src/modules/project-manager/components/StrategyEditModals.jsx),
and [integration test source](../../apps/server/tests/integration/fr268-business-key-result-mutation.test.js).
`zKeyResultCreateInput` permits `dueAt: z.coerce.date().nullish()` and only
refines target unequal to baseline. `zKeyResultPatchInput` permits nullable dates;
`updateKeyResult` repeats the numeric inequality check. Neither writer imports or
calls `smartChecks`, nor reads Goal target dates for its Time-bound calculation.
The registered POST/PATCH routes directly invoke those writers. The existing
successful integration fixtures omit due dates. The client does call the pure
calculator, but the checklist is not shared server enforcement.

**Disposition:** implementation-present/partial, not design-only and not fully
accepted. B3 now explicitly requires contract reconciliation and service/API
regressions before coding a correction. The canonical optional due date and the
older note's hard-refusal wording must not be resolved by silently inventing a
new required field. This is a static finding; no failing runtime reproduction or
fix is claimed by B1. No new requirement or route is created.

### Retained 62-FR process recheck

The [SRS capability map/index](../domains/project-manager/SRS.md#2-process-and-capability-map)
selects 73 FRs. Excluding FR-252/268/269/270/271/272/286 and FR-082–085 leaves
exactly the following 62. Each exact canonical source row was re-read; its pinned
`source_row_sha256` still matches the dated [assessment matrix](../../reports/gap-analysis-2026-10-23/requirements-matrix.json).
All of those matrix implementation/test paths exist at this base (zero missing
paths). This table is inspection coverage and representative current source,
not another requirement registry, exhaustive clause certification or a test pass.

| Capability and retained IDs | Inspected source / existing test input | B1 disposition |
|---|---|---|
| Scope: FR-001, FR-074 | [scope writer](../../apps/server/src/modules/project-manager/application/scope-service.js); [CRUD tests](../../apps/server/tests/integration/fr001-scope-crud.test.js) | General update/archive exports and transactional CAS/audit now exist. Initial report F01 is historical; follow its application-fix evidence |
| Neutral Project/work: FR-003, FR-004, FR-005, FR-043 | [Project writer](../../apps/server/src/modules/project-manager/application/project-service.js); [work writer](../../apps/server/src/modules/project-manager/application/work-service.js); [core tests](../../apps/server/tests/integration/project-core.test.js) | CRUD/Business ownership and shared neutral-model paths present; current engine/UI acceptance not rerun |
| Milestones/dependencies/WBS: FR-006, FR-007, FR-040 | [milestone writer](../../apps/server/src/modules/project-manager/application/milestone-gate-service.js); [dependency writer](../../apps/server/src/modules/project-manager/application/dependency-service.js) | Existing register/map and self/cycle paths present; planned canvas contract/edit/hold behavior stays Track C |
| Modes/progress: FR-009, FR-010, FR-011 | [strategies](../../apps/server/src/modules/project-manager/progress/strategies.js); [weighted roll-up](../../apps/server/src/modules/project-manager/progress/rollup.js); [tests](../../apps/server/tests/unit/rollup.test.js) | Existing seven-mode/weighted model retained; no universal task-ratio substitution |
| Repository metadata: FR-008, FR-073 | [repository writer](../../apps/server/src/modules/project-manager/application/repository-service.js); [scope tests](../../apps/server/tests/integration/fr073-repository-scope.test.js) | Local metadata/link ownership source present; external GitHub access not inferred |
| Shared intake: FR-012, FR-017, FR-018, FR-019, FR-065, FR-108 | [plan writer](../../apps/server/src/modules/project-manager/import/plan-import-service.js); [bundle tests](../../apps/server/tests/integration/execution-plan-bundle.test.js) | Existing authorized preview/commit lane retained; no delta or above-Business authority invented |
| Backup/audit/demo: FR-013, FR-014, FR-016 | [backup](../../apps/server/src/modules/project-manager/application/backup-service.js); [audit](../../apps/server/src/modules/project-manager/application/audit.js); [seed](../../apps/server/prisma/seed.js) | Source present; current restore families/roles need B2/B3 evidence, not old snapshot counts |
| Shell/context/entry: FR-002, FR-015, FR-020, FR-032, FR-033, FR-034, FR-035, FR-039, FR-044, FR-046, FR-056 | [ScopeContext](../../apps/server/src/context/ScopeContext.jsx); [Topbar](../../apps/server/src/components/layouts/Topbar.jsx); [entry tests](../../apps/server/tests/unit/entry-surfaces.test.js) | Read alongside newer Business-only context, Dashboard action and credential-entry decisions. Older selector/New Project/login-stub wording does not authorize rebuilding retired shell behavior |
| Strategy/Home: FR-041, FR-059, FR-060 | [strategy read](../../apps/server/src/modules/business/application/business-strategy-service.js); [Home](../../apps/server/src/modules/business/application/business-home-read-model.js); [mutation tests](../../apps/server/tests/integration/fr059-business-strategy-mutation.test.js) | Existing read/mutation/attention source present; FR-060 old merge wording included in held proposal |
| Team/People read: FR-036, FR-042, FR-089 | [Project members](../../apps/server/src/modules/project-manager/application/project-team-service.js); [grouping](../../apps/server/src/modules/project-manager/application/team-service.js); [no-grant tests](../../apps/server/tests/unit/fr089-br018-team-grants-nothing.test.js) | Membership access and Team grouping remain separate; no capacity/payroll/workforce adoption |
| File compatibility: FR-037, FR-045, FR-058 | [legacy refs](../../apps/server/src/modules/project-manager/application/project-file-service.js); [managed views](../../apps/server/src/modules/project-manager/application/file-manager-read-model.js) | Source present; Files charter cohort and managed-content/metadata ownership retained |
| Board/schedule: FR-063, FR-064 | [Board](../../apps/server/src/app/%28pm%29/projects/%5BprojectId%5D/board/page.jsx); [Timeline](../../apps/server/src/app/%28pm%29/projects/%5BprojectId%5D/timeline/page.jsx) | Derived status/date views remain separate from proposed canvas persistence and holds |
| Roadmap/Blueprint/trace: FR-068, FR-069, FR-070 | [trace service](../../apps/server/src/modules/project-manager/application/project-execution-trace-service.js); [trace tests](../../apps/server/tests/integration/project-execution-trace.test.js) | Existing source present; A1 trace regressions remain historical evidence for their own source |
| Viewer/visibility/grants: FR-031, FR-061, FR-067, FR-072 | [resolver](../../apps/server/src/modules/identity/resolve-viewer.js); [authorization](../../apps/server/src/modules/project-manager/application/project-authorization.js) | Existing peer-owned authorization paths retained; Team/Employment add no grants and above-Business refusal remains declared |
| Dashboard/PIC/priority: FR-086, FR-087, FR-088 | [Dashboard projection](../../apps/server/src/modules/project-manager/application/projects-dashboard-read-model.js); [tests](../../apps/server/tests/integration/projects-dashboard.test.js) | Existing distinct headcount/team/PIC/priority source retained; no staffing algorithm inferred |
| Employment/legal: FR-193, FR-194 | [employment service](../../apps/server/src/modules/people/application/employment-service.js); [schema](../../apps/server/prisma/schema.prisma) | Existing peer scope/legal context retained; historical production row is not fresh migration authority |
| Inventory: FR-077 | [projection](../../apps/server/src/modules/project-manager/application/project-inventory-read-model.js); [DTO tests](../../apps/server/tests/unit/project-inventory-read-model.test.js) | Asset allocation DTO/section now present. Initial report F04 is historical; the source correction does not freshly certify FR-135 |
| Product readiness: FR-124 | [projection generator](../../apps/server/scripts/domain-state.mjs); [tests](../../apps/server/tests/unit/domain-state.test.js) | Binding projection present; declared methodology/owner acceptance limit remains. Readiness figures are not runtime acceptance |
| Domain/navigation: FR-250, FR-251 | [Feature-adjacent domain view](../../apps/server/src/modules/project-manager/components/ProjectDomainView.jsx); [UI tests](../../apps/server/tests/e2e/fr250-navigation.spec.js) | Existing Project-local source and dated release note retained; no new live-environment check |
| Persistence profile: FR-030 | [boundary](../../apps/server/src/lib/db-boundary.js); [tests](../../apps/server/tests/unit/db-boundary.test.js) | SQLite/PG configuration and external-store separation retained; no database selection/migration performed |

The [initial gap assessment](../../reports/gap-analysis-2026-10-23/README.md)
remains pinned to `e3474ef3`; its [application-fix follow-up](../../reports/gap-analysis-2026-10-23/application-fixes.md)
and current source distinguish F01/F04 corrections from the original missing
paths. No frozen matrix/report is rewritten. This recheck demonstrates no newly
missing bound path among these 62; it does not prove all clauses complete or
supplant their unresolved source/owner/acceptance limits. The newly demonstrated
FR-271 writer gap is in the six-item qualification cohort above, and is assigned
to B3 before any behavior edit.

### Held canonical delivery-cell proposal

**PROPOSED / NOT APPLIED.** B1 repairs explanatory notes and roadmap only.
The following exact replacement delivery-cell strings are bound to the existing
canonical rows by their full `source_row_sha256`. They change no ID, leading
subject, normative statement, applicability or FEAT membership. FR-060/268–271
remain explicitly bundled in FEAT-002; FR-252 remains unbundled. Statement cells,
source wrappers, index, exports and ID ledger are unchanged by B1.
FR-269/270's future planned-to-current normalization requires explicit reviewed
migration acceptance; plan approval or source presence alone cannot apply it.
The FR-271 proposal records partial implementation, not a new due-date rule.

| Canonical record | Current source-row SHA-256 | Proposed delivery cell (exact text; held) |
|---|---|---|
| [FR-060](../features/FEAT-002/requirements/FR-060.md) | `5330e3efe2acffc957577830122b297e901c7eaf7a10fd976209f8cbfcf8134b` | Phase 0 attention correction merged via PR525 at 314d95b8; source present at B1 base 2c13f616. Current runtime/live acceptance is not established by B1. |
| [FR-252](../requirements/FR-252.md) | `99b09bd38dc7017b8eae5ea96dacf905acd0c0b7e3aa270565707e6fdfc1f34f` | Feature persistence, protected recovery and composed read/API/UI implementation are present through ancestors 052821a7 and 67ffc906 at B1 base 2c13f616. Current B2 role/service/recovery qualification and external production gates remain open; no live acceptance claimed. |
| [FR-268](../features/FEAT-002/requirements/FR-268.md) | `059a8968dadd5aa82f0ce55f4ed811c914972e9c96a40e3d07ad4408b0c1ae69` | Phase 1 Key Result implementation merged via PR528 at 02f54a52; present at B1 base 2c13f616. FR-271 shared server evaluation remains partial; B3 qualification and release remain open. Optional due-date and OWNER-only authority contracts are unchanged. |
| [FR-269](../features/FEAT-002/requirements/FR-269.md) | `ca2a95735db08d01fba37586208513d282bf20d73a5db65e6124ae00f5557bf6` | Phase 2 KPI implementation merged via PR645 at 54e7e357; source present at B1 base 2c13f616. Dated checks remain historical; current B3 adapter/browser qualification and B4 migration/live acceptance remain open. |
| [FR-270](../features/FEAT-002/requirements/FR-270.md) | `d584c2822a9511e3c82b6b2eab0cfcb194b4449f4838afd8550a08ce277e3847` | Phase 3 WIG/weekly execution implementation merged via PR647 at 8a2fd498; source present at B1 base 2c13f616. Dated checks remain historical; current B3 adapter/browser qualification and B4 migration/live acceptance remain open. |
| [FR-271](../features/FEAT-002/requirements/FR-271.md) | `51f4b26e6a560157cf10693354b3cc712a758834bd0ea400e0d6283b5e6b8214` | PARTIAL at B1 base 2c13f616: pure SMART calculator and shared live client checklist are present from 02f54a52; shared server write-time evaluation/time-bound handling remains open for B3 contract reconciliation and regression proof. No new mandatory due date, runtime completion or production acceptance is asserted. |

Before applying any of these cells, the existing reviewed-record migration must
bind the exact before/after bytes, preserve subject/membership, reconcile the
FR-271 handling above, and obtain approval for that concrete migration. Regenerate
registry/compatibility outputs with the sanctioned tools then validate lifecycle
and identity behavior; never patch row hashes or the ledger manually. This hold
does not block B2 isolated qualification. B1 approval is not migration approval.

### B1 acceptance and handoff

Current explanatory conflicts are resolved in the FR-252/268–271 notes, roadmap
and SRS section 6, while canonical delivery changes remain explicitly held above.
FR-271 is partial and its B3 task is amended before code. The 62-item retained
scope is covered at the stated static depth; no fresh application acceptance is
claimed. B1 passed documentation governance and independent review at
`56b6ed973b8aac2804a7e91b59b08950a22bdc2f`. The owner subsequently selected
B2 isolated qualification, recorded below; its environment boundary remains.
This B1 document introduces no controller record, DDC procedure or alternate
requirement registry. Documentation checks/review results are retained with the
B1 commit/session summary, separately from historic runtime results.


0.2.0 (2026-10-23): complete B1 source reconciliation and held six-row delivery proposal; record static FR-271 partial behavior and amend B3 before any correction. B2/B3 execution, hosted integration and release remain open.

## B2 isolated qualification — 2026-10-23

This is supporting execution evidence for Task B2 against base
`56b6ed973b8aac2804a7e91b59b08950a22bdc2f`, not a canonical delivery-cell
migration or deployment acceptance. The owner authorized isolated PostgreSQL
role/service/recovery tests and independent review; production and B3 remain
outside this increment.

### Target and authority

The [target helper](../../apps/server/tests/helpers/pm-role-target.js) accepts no
connection URL. It starts an owned PostgreSQL 17 cluster on loopback with fresh
synthetic credentials, applies the current full generated schema, then recreates
only the six empty Phase B tables with the **unchanged issued**
[provider migration](../../apps/server/supabase/migrations/20260917041000_add_phase_b_feature_authority.sql).
This preserves the provider CHECK/index/policy definitions that Prisma alone
cannot represent. It is not replay of every historical provider migration.

Only this disposable cluster receives the prerequisite roles. The fixture models
existing application-table privileges on the other tables; it does not claim to
reproduce the deployed installation's complete ACLs. The issued SQL supplies the
bounded six-table privileges. `zuri_web_login` inherits the non-login
`zuri_app_runtime` role. Catalog assertions check both roles are non-superuser and
non-bypass, neither owns a protected table, all six tables force RLS, the eight
policy bindings require both scope keys, no PUBLIC/direct login/anonymous/service-role
grants or runtime grant options exist, and the immutable tables have only
SELECT/INSERT privileges.

Both competing Prisma clients log in as `zuri_web_login`; the suite never swaps
them to admin or emulates policy in JavaScript. Admin is used for schema/fixture
arrangement, lock observation and the separately privileged maintenance CLIs.
Every client disconnects before the helper's verified cluster shutdown; the
source and each clean recovery target are disposed in `finally`/suite teardown.

### Executed behavior and evidence limits

The [PostgreSQL suite](../../apps/server/tests/postgres/phase-b-runtime-role.test.js)
uses the existing repository and service with persisted Person, Membership and
authenticated Session rows. It exercises missing/partial/foreign scope, including
different Businesses within one Tenant and a foreign Tenant, both local scope
keys on a reused one-connection pool after commit and rollback, service audit/receipt
linkage, immutable receipt refusal, elapsed Membership expiry while a real
Project lock is held, competing versions, allocation overflow and audit-failure
rollback. Race barriers observe distinct backend PIDs and PostgreSQL lock
blockers before releasing the leader. No authorization result or clock is mocked.

Recovery spawns the actual protected-export and clean-target-restore processes
against owned source/clean targets. All six families contain rows and survive a
restore/re-export comparison, including exact UUID/version/receipt/audit links.
Synthetic governance evidence is arrangement; no Git verifier or browser capture
acceptance is asserted. A reviewed PM erasure runs through the actual runtime
transaction before export: the erased field stays erased and unreviewed fields
remain. Synthetic disabled-person and revoked-session state remains revoked
after restore; the existing portable-session contract preserves records and
token hashes, not raw session tokens.

The suite verifies no-confirm preview inserts into none of the current 208
application tables, explicit clean-target confirmation, nonempty-target refusal,
checksum mismatch, missing authoritative family and unexpected catalog table
refusal with their specific error codes. An ordinary runtime-role protected
export must refuse complete visibility rather than emit a partial snapshot.
Recovery intentionally uses a privileged maintenance connection only for owned
synthetic targets; it does not grant recovery privilege to runtime.

The current inventory binds schema SHA-256
`579afacd11ae1ad34c11183a9617896812c2af94d6b5c7187f382d3f37f418e8`
and target inventory SHA-256
`af3a57bba8079615e6f8c85718e731eade38aa8de5840e78958231e50fc5e683`.
Each CLI artifact's exact byte digest is recomputed and checked at runtime;
temporary synthetic snapshots and credentials are removed with the target.

Initial execution exposed two test-expectation errors: the service's existing
CAS error is `VERSION_MISMATCH`, and portable recovery deliberately retains
Session records. Source/contract inspection corrected the expectations. The
11-case targeted rerun and the nine-file SQLite regression command above passed
11/11 and 98/98 respectively. No application defect was reproduced and no
application service, schema, issued migration or canonical record was changed.

The extended configured PostgreSQL profile executed 126 cases: 124 passed and
two failed. The new runtime-export refusal was correct but the assertion omitted
the `PHASE_B_` error prefix; it now uses the exported error-code constant. The
pre-existing memory-erasure held-page scan timed out at 30 seconds. No unrelated
test timeout or application behavior was changed. The following focused rerun
passed **16/16** with zero skips: all **12 B2 cases** and all four memory-erasure
cases (the previously timed-out case completed in 5.6 seconds).

```text
npm --prefix apps/server run test:postgres
# FAIL: 124/126; assertion-prefix mismatch and existing scan timeout
npm --prefix apps/server run test:postgres -- tests/postgres/phase-b-runtime-role.test.js tests/integration/line-memory-erasure-due-query.test.js
# PASS: 16/16 after the assertion correction; B2 12/12 included
```

This is composed verification, **not a single clean 126-case suite run**. The
full-profile timing failure remains recorded; an isolated rerun does not prove
that its performance is stable in the combined profile.

Independent GPT-6 Luna Max review found gaps in the proof, not a reproduced
product defect: tenant-setting reset/policy coverage, PUBLIC/grant-option checks,
same-Tenant cross-Business isolation, and an unasserted retained Session hash.
These were corrected with direct catalog/behavior assertions and exact retained
hash/revocation comparisons. The added partial-key case brings B2 to **13 cases**.
The final sibling-Business fixture explicitly populates all six families under
the same Tenant as the first Business; every negative read proves source rows
exist, so tenant-only filtering cannot pass the cross-Business test. The reviewer
confirmed those source/test gaps are closed with no remaining substantive blocker.

### Final local acceptance

| Check | Executed result |
|---|---|
| Task B2 PostgreSQL command above, after review corrections | PASS **13/13**, zero skips; final run 16:55:38 +07:00 |
| Nine-file SQLite service/recovery/Identity command above | PASS **98/98**, zero skips |
| Broader configured PostgreSQL profile | FAIL **124/126**, followed by focused **16/16** and final B2 **13/13** as explained above; no single clean full-profile claim |
| Generated projection consumers | PASS **51/51** across five files with the command below |
| `npm --prefix apps/server run build` | PASS, including lint/type checking; existing multiple-lockfile workspace-root warning remains |
| `npm run docs:graph`, `npm run docs:views`, `npm run govern` | PASS: 552 canonical records, 96 views, zero dangling edges; preflight **0 critical / 0 warning / 43 info** |
| `npm run docs:llms`, `npm run docs:llms:check` | PASS; 409 KB ignored corpus, not staged |
| Independent review | GPT-6 Luna Max; identified proof gaps corrected and source/test design accepted; final composed evidence reviewed before commit |
| Target teardown | All owned PM clusters verified stopped/removed after the runs; synthetic snapshots removed |

```text
npm --prefix apps/server test -- tests/unit/domain-state.test.js tests/unit/capability-registry.test.js tests/unit/domain-model-source.test.js tests/unit/doc-graph-retired-rules.test.js tests/unit/data-pipeline-map.test.js
```

Only the tests/config, this plan/master-plan evidence, and the required generated
`apps/server/runtime/domain-state.json` projection are included. That projection
adds the new test path and changes the three FR-252 test-file counts from 47 to
48; its `verified` labels describe generated bindings, not production acceptance.
No application writer, issued provider migration, current schema inventory or
held canonical row was changed. B2's **isolated qualification exit** is met.
Hosted exact-head CI and the broader full-profile timing caveat remain explicit.
The actual installation's current role/grants, production writes/migrations and
release still require separate ADR-097/environment authority. **B3 has not started.**

0.3.0 (2026-10-23): record owned PostgreSQL runtime-role/service/recovery
qualification without adopting the held canonical rows or opening B3/production.


## B3 local qualification — 2026-10-23

**Base:** `45b2d72b6798bc88c90accb8a8329cb53be8ae06` on the isolated
`codex/pm-domain-srs-20261023` branch. The owner selected B3, optional dates,
adapter/browser tests and review, with production excluded. This section
supersedes earlier unstarted statements only for B3; B1/B2 evidence stays historical.

### Contract, reproduced failures and correction

Before code, the [SMART contract](../domains/project-manager/features/FR-271-smart-validation-contract.md#b3-interpretation-before-implementation--2026-10-23)
was reconciled against canonical FR-268/271 and ADR-101 D3 and independently
reviewed. Optional/null/cleared dates are accepted with `timeBound: false`;
Specific duplicates warn; Achievable/Relevant remain null. New/changed invalid,
past or Goal-exceeding dates refuse; unchanged historical dates permit valid
edits. No canonical statement, membership, subject anchor or held status row changed.

New service/API assertions reproduced five missing SMART behaviors after fixing
the test fixture's required parent references. The owning writer now evaluates
the merged row using the shared calculator after the Business write fence and
returns nonpersisted `smartChecks`/`smartCheckedAt`. Empty patches provide fresh
feedback without durable effects; existing status edits retain Business version
increments. The fence serializes KR/WIG writes, not concurrent Goal target-only
edits. Rollback tests inject audit failure through a proxy while retaining real
adapter transactions. Existing foreign-Business, concurrent two-WIG cap,
selected-lag, derived-progress and idempotent provisioning proofs are retained.

A pure-calculator RED case exposed blank/null numeric coercion; the shared
calculator now requires actual numeric values or nonblank finite numeric input.
A browser RED run on the previous built UI had 2 failures / 1 pass: missing
optional/Specific guidance and a stale success callback closing a replacement
modal. Guidance and request-epoch guards fix those failures. Delayed refusals
preserve draft/focus. Closing a form does not cancel an already submitted write.
Review also caught a changed Business-version side effect; a RED regression and
restored status increment resolved it before final adapter qualification.

### Commands, results and limits

The exact engine/browser commands are listed in Task B3 above. Logs are ignored
local diagnostics under `apps/server/node_modules/.cache/zuri-test-proof/b3-*.log`.

| Check | Observed result |
|---|---|
| Selected six-file SQLite strategy/provisioning/calculator command | **64 passed / 1 skipped**; existing provider-only PostgreSQL SQL application case skipped on SQLite and covered on PostgreSQL |
| Selected five-file PostgreSQL strategy/provisioning command | **52/52**, zero skips, disposable generated schema; adapter parity, not full configured PostgreSQL suite or deployed-role proof |
| Related strategy validation/edit UI, week/progress/rollup and WIG UI regressions plus FR-268 writer | **144/144**, eight files |
| Five generated projection consumer files listed in B2 | **51/51**, zero skips |
| Six selected browser specs including new FR-271 | **23/23**, zero skips/flaky retries, isolated seeded SQLite at port 3127 |
| `npm --prefix apps/server run build` | PASS, including lint/type validity; existing multiple-lockfile root warning |
| `npm run docs:graph`, `npm run docs:views`, `npm run govern` | PASS, 552 canonical records / 96 views; 0 critical, 0 warning, 43 info |
| Independent review | GPT-6 Luna Max reviewed the contract before code and the composed implementation; final tree acceptance recorded with the local commit |
| Hosted exact-head CI / production | Not run; remain integration/release gates |

Related command:

```text
npm --prefix apps/server test -- tests/integration/fr059-business-strategy-mutation.test.js tests/unit/fr059-strategy-validation.test.js tests/unit/fr059-strategy-edit-ui.test.js tests/unit/fr268-week.test.js tests/unit/fr268-key-result-progress.test.js tests/unit/fr268-goal-rollup.test.js tests/unit/fr270-business-wig-execution-ui.test.js tests/integration/fr268-business-key-result-mutation.test.js
```

The browser target was `http://localhost:3127` with worktree-owned
`apps/server/prisma/e2e-3127.db`. Initial dev-server warm-up was stopped before
spec execution because compilation stalled; this is not a browser pass. Final
qualification used `E2E_SERVER_MODE=production`, the existing configuration for
running the locally built artifact with test configuration and an isolated DB;
no production runtime or credentials were used. The new real API/browser case
creates an optional-date KR and reloads persisted data. Delayed refusal/success
cases use controlled network fixtures; existing KPI/WIG/Feature synthetic UI
proofs are not promoted to backend or production acceptance. Existing Business
shell and persisted Feature CRUD browser journeys also passed.

Tracked `apps/server/runtime/domain-state.json` and FEAT-002 verification bindings
were regenerated; their labels describe graph evidence, not release acceptance.
Ignored graph/maps/reports/corpus and diagnostics are not staged. No schema,
provider migration, production grants, dev/UAT stack or held canonical migration
changed. B3 local qualification is complete subject to final same-tree review;
B4 and C remain unstarted. Exact-head hosted CI remains required before merge.

0.4.0 (2026-10-23): record B3 contract reconciliation, test-first SMART correction,
selected adapter/browser qualification and explicit hosted/release boundaries.


## B4 PR and release-readiness preparation — 2026-10-23

The owner selected PR preparation, exact-head hosted CI and independent release
readiness review, explicitly excluding PR merge and production. The product
candidate combines locally accepted A1/B1/B2/B3 through `4c31ab99` with current
main `77be99c8cb7b564408e37ba3358f3835b25d520e`. Main contributed 17 commits
since the original branch base `5d79760b`; its current sources and CI policy
are included rather than treating old local results as composed-tree acceptance.

Integration preserves both sides of PostgreSQL explicit test selection (PM
races/runtime-role/strategy and current main stock-price/consent suites). The
roadmap keeps both delivery histories and unchanged task counts. Generated
bindings are rebuilt serially from the composed inputs. Local integration and
hosted results are reported in the PR with their exact commit/run URLs; results
from earlier A1/B2/B3 commits remain dated evidence. B2's 124/126 then focused
16/16 caveat and B3's SQLite provider-only skip remain unchanged.

**Readiness boundaries:**

- PR preparation and CI/reviewer qualification are selected; this is not full
  B4 environment acceptance. The B4 environment checkboxes remain unchecked.
- No production target is selected or inspected in this increment. Active image,
  Compose/database/volume/runtime-role/ledger, exact migration apply set and
  source/image parity are **NOT_VERIFIED** for this candidate.
- Actual non-bypass-role installation grants, migration lineage/dry run, complete
  snapshot/storage/config recovery, authenticated selected-Business live acceptance,
  release artifact/rollback image and post-merge verification remain external
  release gates under ADR-097/104/112. Earlier isolated proofs cannot close them.
- No schema migration or provider grant change is introduced by the PM patch.
  Main's existing migrations are baseline, not an authorized production apply set.
- Hosted E2E/Desktop skips remain skips under the current workflows. A green PR
  status cannot establish full browser, device or selected-environment acceptance.
- C/Pipeline Builder and held canonical delivery-row migrations remain excluded.
  No auto-merge, PR merge, deployment, production read/write or credential access.

0.5.0 (2026-10-23): select B4 PR/CI/readiness preparation, reconcile current main
and retain the unexecuted environment/release gates. Final hosted evidence lives
in the PR description bound to its head; changing that text does not change head.
