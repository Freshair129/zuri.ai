---
id: ZAI:PM-EXISTING-DELIVERY-PLAN-20261023
title: Existing PM delivery qualification plan
doc_type: implementation-plan
status: approved
version: "0.1.1"
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
`docs/domains/project-manager/SRS.md` section 6 only when an actual conflict is
closed. Canonical records and frozen historical snapshots are read inputs.

**Interfaces:** consume exact source commit ancestry, source files, accepted
decisions and dated results; produce current supporting-note/roadmap wording
that distinguishes implementation-present, verification-pending and release-open.

- [ ] Inspect the current Feature service/API/UI and commits `052821a7`/`67ffc906`; reconcile the old W3 wording with actual composition. Inspect `02f54a52`, `54e7e357`, `8a2fd498` for strategy and `ee5d789e` for bounded bootstrap. Verify ancestry on the selected execution base, not only on this planning snapshot.
- [ ] Read the exact canonical row, source-preserved wrapper and controlling ADR for each conflict. Correct explanatory notes such as the design-only FR-271 note using exact code/evidence references; do not label current runtime healthy from old evidence.
- [ ] If a canonical delivery cell must change, prepare a precise reviewed-migration proposal preserving ID, subject, statement meaning and membership. Mark that change held until its exact migration is approved; no manual hash/ledger repair. This need not block isolated behavior qualification.
- [ ] Recheck the 62 retained FRs through the SRS capability map and the current gap assessment. Record any newly demonstrated missing/partial behavior as a source-linked finding and amend the affected plan before coding it; do not infer all are accepted from their `current` lifecycle.
- [ ] Run canonical-registry checks, regenerate owned document views and run governance/corpus checks. Independent review then commits only these explanatory changes as `docs(pm): reconcile current implementation evidence`; retain remaining acceptance gates.

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

- [ ] Add tests `missing_scope_cannot_read_or_write`, `foreign_business_is_invisible`, `scope_settings_do_not_leak_across_reused_connections` and `authorized_service_binds_scope_locally`. Direct role queries must return no foreign rows or refuse writes; service refusals remain redacted. Verify catalog policies/grants as well as behavior.
- [ ] Add `membership_expiry_after_project_lock_refuses_write`, `competing_versions_have_one_winner`, `allocation_overflow_race_rolls_back` and `audit_failure_preserves_feature_and_receipt`. Use real sessions and observed lock waits. Do not replace authorization clocks or policy with fixtures that merely return success.
- [ ] Add/extend recovery assertions for checksum mismatch, non-empty target refusal, missing authoritative family, revoked/retained personal fields, exact receipt/audit links and fail-closed inventory mismatch. Invoke the actual protected-export and clean-target-restore CLIs on synthetic owned targets; confirm preview/no-confirm performs no insertion and explicit clean-target confirmation is required.
- [ ] Run the real-role proof, then current SQLite recovery/service regressions. Expected results are executed assertions, zero required skips and verified cleanup; test code or SQL-text inspection alone does not close this task.

```text
npm --prefix apps/server run test:postgres -- tests/postgres/phase-b-runtime-role.test.js
npm --prefix apps/server test -- tests/integration/project-feature-mutations.test.js tests/integration/project-feature-graph.test.js tests/integration/project-feature-read-routes.test.js tests/integration/project-feature-erasure.test.js tests/integration/phase-b-recovery.test.js tests/integration/phase-b-web-recovery.test.js tests/integration/phase-b-identity-erasure.test.js tests/unit/phase-b-feature-migration.test.js tests/unit/phase-b-backup.test.js
```

- [ ] If tests expose a defect, add the failing assertion, repair only its owning port/transaction, rerun the affected engines and relevant Identity/CRM consumers. Obtain independent review of the exact composed patch, run build/governance and commit as `test(pm): qualify Feature runtime isolation and recovery` (or a scoped fix).

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

- [ ] Extend PostgreSQL explicit selection to the three FR-268/269/270 mutation files; the two provisioning files are already included. Add parity assertions only where missing: foreign Business refusal, audit rollback, third concurrent WIG refused, selected lag invariant preserved, manual Goal progress refused when derived, and idempotent template/default-Space creation.
- [ ] Run selected SQLite and real PostgreSQL files. The PostgreSQL global setup regenerates schema/client and creates a disposable schema; report this as adapter parity, with B2/provider migration proof kept separate.

```text
npm --prefix apps/server test -- tests/integration/fr268-business-key-result-mutation.test.js tests/integration/fr269-business-kpi-mutation.test.js tests/integration/fr270-business-wig-execution.test.js tests/integration/business-provisioning-template.test.js tests/integration/business-provisioning-backup.test.js tests/unit/fr271-smart-checks.test.js
npm --prefix apps/server run test:postgres -- tests/integration/fr268-business-key-result-mutation.test.js tests/integration/fr269-business-kpi-mutation.test.js tests/integration/fr270-business-wig-execution.test.js tests/integration/business-provisioning-template.test.js tests/integration/business-provisioning-backup.test.js
npm --prefix apps/server run test:e2e -- tests/e2e/fr269-business-kpi-scorecard.spec.js tests/e2e/fr270-business-wig-execution.spec.js tests/e2e/fr041-business-first.spec.js tests/e2e/project-feature-view.spec.js tests/e2e/project-feature-mutations.spec.js
```

- [ ] Cover SMART feedback, focus preservation under delayed rendering, stale responses and refusal states; preserve 4DX's existing two-WIG and Bangkok-week contracts. Use isolated seeded browser data and the worktree's own port, never the primary dev/UAT database.
- [ ] Run the selected related regressions/build/governance, independent review and exact-head CI. Commit qualification changes and current evidence as one scoped deliverable. An unchanged implementation may need no new product code.

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
