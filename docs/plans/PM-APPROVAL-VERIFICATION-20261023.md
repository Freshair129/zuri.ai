---
id: ZAI:PM-APPROVAL-PLAN-20261023
title: PM approval gateway verification implementation plan
doc_type: implementation-plan
status: approved
version: "0.1.2"
approved_at: "2026-10-23"
approved_plan_commit: "c291afcd601a9036a0f188656b96a233c20d4979"
source_revision: "e1014247b01cd42bca589e679c840d2c2c8f2857"
relations:
  - type: references
    target: ZAI:PM-DOMAIN-SRS
  - type: references
    target: ZAI:FR-272
  - type: references
    target: ZAI:ADR-103
---

# PM Approval Gateway Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the roadmap's unverified PM concurrency/audit proofs with deterministic PostgreSQL evidence, fixing only a reproduced contract failure.

**Architecture:** Exercise the existing PM approval service and real transactions with two independent clients and persisted Identity fixtures. Keep the Agent quorum gateway separate; its passing race tests are not FR-272 evidence.

**Tech Stack:** Existing Vitest, generated `@zuri/prisma-postgres`, embedded PostgreSQL, PM services and viewer factories.

**Spec:** [Approved SRS](../domains/project-manager/SRS.md), [FR-272](../requirements/FR-272.md), [ADR-103](../decisions/ADR-103-PM-APPROVAL-GATEWAY-ADMISSION.md), [A-01–A-12 design matrix](../architecture/project-manager-system/29-APPROVAL-GATEWAY-ADMISSION-DESIGN.md#6-acceptance-matrix).

## Global Constraints

All [master-plan constraints](PROJECT-MANAGER-IMPLEMENTATION-20261023.md#global-constraints) apply.
Use actual PostgreSQL sessions, not mocked `updateMany` races or `Promise.all`
without a controlled overlap. No real effect executor or external database is used.
The existing service's digest, scope, TTL, replay and capability contracts remain
unchanged unless a failing proof demonstrates a defect against ADR-103.

## Review Focus

Opposing decisions, identical retries, concurrent admission, transaction failure
and authority changes during contention are owned by A1 below. Same-decision
idempotency and opposing-decision conflicts have different expected results.

## Task A1: Deterministic PM races and audit rollback

**Files (Server-relative):**

- Create `tests/helpers/pm-approval-fixture.js`: extract the persisted scope/run/step/viewer fixture from the existing PM suite; no hand-built viewer.
- Create `tests/postgres/project-approval-gateway-races.test.js`: PostgreSQL-only proof; this path is outside the default SQLite integration glob.
- Modify `vitest.postgres.config.js`: explicitly include the new file; retain all existing suites/global setup.
- Modify `tests/integration/project-approval-gateway.test.js` only to reuse the fixture and preserve its existing cases.
- Modify `src/modules/project-manager/application/approval-gateway.js` or its trace/Identity collaborators only for a reproduced invariant failure, with its regression test in this task.
- Evidence/navigation: `docs/domains/project-manager/features/FR-272-approval-gateway-admission.md` and the existing `TASK-FR-272` row in `docs/roadmap/ROADMAP.md`; no new task ledger.

**Interfaces:**

- Consume `requestApproval(input,{viewer,db,now})`.
- Consume `decideApproval(approvalRequestId,input,{viewer,projectId,executionRunId,db,now})`.
- Consume `admitApprovedStep(approvalRequestId,requestDigest,leaseEpoch,executor,{db,now})`.
- Proposed fixture: `createPmApprovalFixture({db,label}) -> Promise<{project,run,step,requester,reviewer,executor,requestInput}>`; it uses the existing scope/viewer factories and persists whatever current Identity contracts require.
- Produce a reusable test-only `withDecisionBarrier(clients, callback)` in the fixture helper: wait for an observed row-lock wait using separate PostgreSQL backend IDs, release the held transaction, await both results, then always disconnect. Bounded deadlines fail the test rather than skip it.
- Consume the injected `testDatabaseUrl` from existing PG setup to create two generated Prisma clients; refuse a non-PostgreSQL URL. Never read a target URL from the environment.

- [x] **Step 1: Pin opposing and identical decision races.** Test `opposing_decisions_have_one_cas_winner`: submit APPROVE and REJECT to one PENDING request with separate persisted reviewers, prove overlap, then assert one terminal winner, one `APPROVAL_ALREADY_DECIDED`/409 loser, one matching transition audit, and no fabricated admission. Test `identical_decision_retry_has_one_transition`: same decision retry returns the canonical projection/idempotent result with no second transition audit.

```js
expect(opposingResults.filter(result => result.status === 'fulfilled')).toHaveLength(1)
expect(opposingLoser.reason).toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED', status: 409 })
expect(transitionAudits).toHaveLength(1)
expect(retry.approval.requestDigest).toBe(first.approval.requestDigest)
```
- [x] **Step 2: Pin admission concurrency.** Test `one_approved_step_yields_one_admission_under_contention`: two independent clients admit the same digest/lease, only one returns an admission receipt, the other receives the existing consumed-state refusal, one CONSUMED audit exists and run/step state is consistent. Assert the admission expiry follows the exported `APPROVAL_ADMISSION_TTL_MS`; never renew or replay a raw one-use token to make retries pass.
- [x] **Step 3: Pin atomic failure and changing authority.** Test `audit_failure_rolls_back_decision_and_trace` injects failure at `tx.auditEvent.create` through the existing `db` transaction seam after the state CAS; assert request, audit count, run and step equal their pre-call values. Repeat for admission. Test `revoked_or_expired_authority_during_wait_cannot_admit` changes the persisted reviewer/session/grant using its owner service while a claim is held; the subsequent protected transition must use current proof and leave no effect/admission on refusal.
- [x] **Step 4: Build the fixture and execute the new proof.** Add the explicit PG include before invoking the guarded runner. Missing fixtures/configuration are failures, never a zero-test success. Existing product code may pass the new proof on its first execution; missing evidence does not require inventing a product defect or forcing a RED result.

```text
npm --prefix apps/server run test:postgres -- tests/postgres/project-approval-gateway-races.test.js
```

Expected: all named cases execute, zero skip/flaky/failure, actual PostgreSQL
connection/backend evidence, verified teardown. A serial SQLite result is not this exit.

- [x] **Step 5: If a proof fails, reproduce once and fix the smallest owning invariant.** Keep CAS, audit and trace writes in one transaction; recheck authoritative state at the transition. Preserve error envelopes and public signatures. Do not hide lock errors with unbounded retry, sleeps or weakened assertions. Rerun the failing case, then the full new file.
- [x] **Step 6: Run PM regressions and the behavior-appropriate build.**

```text
npm --prefix apps/server test -- tests/integration/project-approval-gateway.test.js tests/integration/project-execution-trace.test.js
npm --prefix apps/server run build
```

If an Identity or shared transaction helper changed, expand to the related
Identity/Agent consumers selected by the verification policy. Keep the separate
Agent approval tests identified as regressions, not substitute PM acceptance.

- [x] **Step 7: Local independent review, source-linked evidence and commit.** Record the exact source SHA, fixture/provider, commands/results and the precise A-07/A-08/atomic-audit cases closed. Keep release/live gates open and update only the matching current roadmap wording. Run governance after note edits, then commit the task-owned files as `test(pm): prove approval concurrency and atomic audit` (or `fix(pm): ...` if product code changed).

- [ ] **Future merge/release gate (outside A1 local acceptance):** obtain required exact-head hosted CI and the existing merge/release authority before integration or release. No hosted check or production acceptance is claimed by the completed local steps.

**Exit:** deterministic real-engine proofs accepted by independent review;
existing five PM cases and trace/replay regressions remain valid. No production
migration, approval effect, provider call or full PM-plan completion is implied.

## Handoff and version history

Pass A1's exact evidence to B4 for a release containing PM approval. B2 separately
owns effective runtime-role isolation; A1 does not establish production grants.

0.1.0 (2026-10-23): initial proposed verification unit; commands above are planned,
not executed while preparing this document.

0.1.1 (2026-10-23): owner approved the implementation-plan package at c291afcd; only A1 is selected for this increment. Track B/C execution and C0 contract adoption remain unstarted.

## A1 execution result — local acceptance

Completed against application/test commit `6888ecc629cca769866d8cc2f715cb5414746c5f`.
See the [source-linked acceptance evidence](../domains/project-manager/features/FR-272-approval-gateway-admission.md#a1-acceptance-evidence--2026-10-23)
for the reproduced stale-authority defect, bounded correction, 13 PG proofs, full
114/114 configured PG profile, 39/39 related SQLite checks, build and independent
review. Two P2 evidence gaps were fixed and accepted in re-review. Required hosted
CI is a future merge gate, not a local pass. Track B/C and release remain unstarted.

0.1.2 (2026-10-23): record A1 local acceptance and actual verification/review; no
hosted, production or broader-plan completion claim.
