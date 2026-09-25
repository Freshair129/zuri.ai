---
id: ZAI:CONVERSATION-RUNTIME-HANDOFF
version: "0.3.9b"
status: candidate
last_update: "2026-09-26T02:29:07+07:00,Codex"
attributes:
  domain: agent
  scope: conversation-runtime-extraction-checkpoint
relations:
  - type: relates_to
    target: ZAI:ADR-106
  - type: relates_to
    target: ZAI:SDD-108
  - type: relates_to
    target: ZAI:FR-149
  - type: relates_to
    target: ZAI:FR-171
---

# Conversation Runtime extraction handoff

**Checkpoint state:** partial. One durable LINE direct-message vertical slice now runs through the independent Conversation Runtime process, the authenticated Core façade and Core-owned SQLite queue/receipts. `executionMode` remains `SERVER`; `LineOaAccount.runtimeOwner` defaults to `SERVER` and is snapshotted onto each job to pin the eligible, opted-in runtime cohort. Ineligible and default jobs remain in the Server cohort. PR #542 stays draft; this is not the completion of the extraction.

## Provenance and boundaries

- Repository: `Freshair129/zuri.ai`
- Branch: `codex/conversation-runtime-service`
- Worktree: `C:\Users\pc\workspace\zuri-ai\.worktrees\conversation-runtime-session1`
- Current published source snapshot: PR #542 head remains `70f8cee8a1c3a0c48973528c20fa78c61d631a56`; PR base is `d302eb0849b00b3c85934eeda6763d7dd4941443`. The S1 branch contains the main merge at that base. This closeout commit is local and has not been pushed. No reset or force-push was performed.
- Reviewed PR baseline: head `189c60766323655149b84928e5db4c16c5e6afb8`, base `fad8ec6252941ca3de01afdb3116484f86b366c3`.
- PR #573's merge is included in the current base; its older review result is historical, not a pending S1 gate.
- Draft PR: [#542](https://github.com/Freshair129/zuri.ai/pull/542). The PR remains open and draft. No PR merge or production deployment was performed.
- Governing documents: ADR-106 and SDD-108; contract: `conversation-runtime.v1`.
- Risk: **HIGH** — queue ownership and a private Core API boundary change with additive account/job schema fields. SQLite and Postgres migration artifacts are listed below; neither was applied to production.
- Session 2 remains read-only preparation. Session 3 may continue in Files-owned scope. This tranche did not change Files storage, shared Files contracts, MSP/GKS, MinIO, or the Knowledge 17-stage pipeline.
- Production deployment, production migration, live LINE send and real model call: **NOT_RUN**. All credentials, provider endpoints, webhook signatures and delivery adapters used for tests are synthetic or local controlled fixtures.

## Latest checkpoint after the PR head check

The published PR head remains `70f8cee8a1c3a0c48973528c20fa78c61d631a56`. The corrections below are committed on the local S1 branch but have not been pushed, so they are not yet on PR #542:

- `services/conversation-runtime/scripts/verify-compose-paths.mjs` now enables the `conversation-runtime` Compose profile before checking resolved service paths. The hosted failure was caused by omitting the profile, which made Compose omit the runtime service from `config`; the base web context resolving to `apps/server` was expected.
- The retired-rule coverage test now expects FR-050/FR-140 in `fr_planned` and FR-141/FR-144 in `fr_superseded`, matching the approved registry statuses. `docs/.id-ledger.json` was updated only through the sanctioned `--review` writer for same-subject FR-265 and SDD-108 digest changes; their pinned subjects and IDs remain unchanged.
- `.github/workflows/edge-ci.yml` no longer runs the packaged Edge Device worker lifecycle step, and the Edge Device-only `.github/workflows/release-edge.yml` workflow is removed. The regular Edge verify job remains for the retained Knowledge/RAG runtime.

Latest closeout evidence: `npm run govern` exited 0 with 0 critical, 1 warning and 32 info; the graph reports 10 known dangling edges and `docs:check` is up to date. The focused admission and Postgres migration unit files passed 25/25. The FR-149 E2E button locator was corrected after a captured trace showed the old expected label, but the test was not rerun after that correction. Edge desktop E2E printed 30 passed and one stale-copy assertion failure; after correcting the copy expectation, a filtered run printed two passed tests but hung in Playwright teardown and was interrupted (exit 1), so Edge E2E is **NOT_VERIFIED**. The FR-149/Edge combined rerun was blocked before test start because `localhost:3100` was already in use. The Phase-B frozen schema inventory remains invalidated against the current Prisma schema; S2's read-only review is pending, so the inventory and recovery script were left untouched and full `npm run verify` was not run. Docker image build and smoke are **NOT_RUN** for this local closeout commit; Docker is unavailable locally and no corrected-head hosted run has been started.

At the published head, GitHub run `36171058414` had failed the Conversation Runtime job at Compose-resolved path verification and the governance job at the two tests corrected above; the Server test job was still running when last queried. Run `36171058430` had failed the Edge desktop job because it still invoked the removed `apps/edge/scripts/package-desktop.mjs`; the workflow correction above is not yet in that remote run. The hosted Server build and Edge verify jobs passed. MC0 separately reported 811 Edge tests passed, 3 skipped, at the published head; this is host evidence, not a rerun of the changed workflow.

The worktree also retains modified Playwright PNG artifacts and untracked `apps/server/debug.log`/PNG outputs from earlier activity. They are unrelated to this tranche and remain untouched and excluded from the S1 source changes.

## Old path and current vertical slice

| Step | Prior/remaining path | Checkpoint path and owner |
|---|---|---|
| Signed LINE ingress | Next webhook verifies the signature and records durable admission before acknowledgement. | Same webhook and admission owner. Eligible direct, verified messages on an account opted into `runtimeOwner=CONVERSATION_RUNTIME` pin the durable job to that cohort; ineligible work remains `SERVER`. |
| Queue and claim | Server worker claims and executes Server-owned jobs. | Core owns the queue row, cohort routing, claims, leases, authority revalidation and protected transitions. Both cohorts use `executionMode=SERVER`; legacy claims and READY sends filter to `runtimeOwner=SERVER`, while runtime claims filter to `runtimeOwner=CONVERSATION_RUNTIME`. |
| Context and answer | Server `createServerLineAnswer` composed context and ran provider/model behavior. | Core `prepare` returns authorized question/evidence/references. Runtime composes the context and invokes its provider port in a separate Node process. It does not call the old answer/model loop. |
| Project/Work | Server parsed commands and called canonical Project Manager writers. | Runtime dispatches the fixed WorkToolPort operations. Core validates and calls canonical writers. Proposal, explicit human confirmation, canonical mutation and durable receipt remain Core-owned. A reclaimed runtime checks the same stable proposal receipt before another execution. |
| Completion and trace | Server worker wrote answer-ready state and execution trace. | Runtime coordinates the turn; Core atomically commits READY and its trace. Stable answer identity is `${jobId}:turn-answer`; model identity is `${jobId}:runtime-model`. A lost completion response is reconciled from Core status before fail or send. |
| LINE delivery | Server worker owned orchestration and transport send. | Runtime coordinates delivery through Core. **Transitional boundary:** the LINE sender, reply-token lifecycle, durable SENDING/ACCEPTED/UNKNOWN state and CRM outbound receipt still belong to Core. Core checks that state before any new transport attempt; no exactly-once delivery claim is made. |

The included end-to-end path is: fake signed webhook → real durable admission/queue → authenticated Core v1 operations over HTTP → separate Conversation Runtime process → controlled local provider → fake LINE sender → durable job, trace and outbound receipt.

The account's durable `runtimeOwner` defaults to `SERVER`; Core snapshots it onto each admitted job. `executionMode` stays `SERVER` for both cohorts. Runtime liveness/readiness is operational health only; it is not the ownership or concurrency gate. Core owns and enforces job scope, identity, account binding, transport epoch, consent/erasure state, claims, leases, receipts and protected transitions. A service bearer authenticates the process; it does not authorize a caller-selected actor, tenant, business or account.

## Failure and retry semantics

- Logical completion keeps `${jobId}:turn-answer` across retries and reclaim. Core status is checked after a lost completion response; a committed READY is not overwritten as FAILED.
- Model invocation keeps `${jobId}:runtime-model` across execution IDs. A durable STARTED receipt from another execution is UNKNOWN and does not trigger another model call.
- Proposal operation identity is `${jobId}:work-proposal`; confirmed mutation identity is the original proposal ID, not the current execution ID. Runtime checks the Work receipt before executing after reclaim. Core’s canonical confirmation transaction records the mutation and deterministic receipt together.
- Delivery uncertainty is separate from model/completion uncertainty. Core’s persisted send state and LINE acceptance receipt decide whether the sender can be called again. A response loss is not proof of non-delivery.
- Tests kill Runtime before model start, then reclaim and finish once; and kill it after a canonical Work commit, then recover the saved receipt without another WorkItem or duplicate reply.

## Checkpoint status

The table below records prior focused and full-suite evidence at the source snapshots identified in each row. The “Latest checkpoint” section above supersedes any row that calls `4d06bff` or an earlier SHA current. No full mandatory regression has passed on the final corrected tree yet.

| Dimension | Status | Evidence boundary |
|---|---|---|
| Code | **PARTIAL** | Real independent runtime and real Core-owned queue are connected for eligible direct verified messages; other admitted flows remain Server-owned. |
| Contract | **PASS — focused** | Both sides validate the versioned operation/request/response envelopes, deadlines, fields and payload bounds. Core derives authority; forged scope is rejected. |
| Integration | **PASS — focused** | Eleven disposable-database vertical-slice tests cover signed admission, duplicate ingress, separate process, fake provider/delivery, receipts, default and opted-in cohorts, owner quiescence, legacy/runtime exclusivity, lease/revocation/consent/erasure fences, process restart, and the acknowledged-admission owner-switch race. The owner-only switch preserves the epoch and admits under the new owner; a real policy epoch change still skips stale admission. The account suite's 8/8 and combined 18/18 are prior focused results, not a current combined run. Current-head provider/consumer conformance remains pending. |
| Data ownership | **PASS — checkpoint** | Queue, runtime-owner routing, authoritative claims/leases/receipts, identity/consent/transport authority, canonical Work writes, LINE transport and durable CRM/trace receipts remain in Core. Runtime has no Prisma access. Additive artifacts: `apps/server/prisma/migrations/20260925120000_line_conversation_runtime_owner/migration.sql` (SQLite) and the canonical Supabase migration. The generated Postgres snapshot `apps/server/prisma/postgres/0001_init.sql` was refreshed; the invalid append-only `0003_line_conversation_runtime_owner.sql` was removed. No migration was applied to production. Production ownership/cutover is not verified. |
| Hosted image build | **NOT_RUN for this local commit** | Docker is unavailable locally and the corrections have not been pushed to trigger corrected-head CI. Do not infer `HOSTED_IMAGE_BUILD=PASS` from prior jobs at the published head. |
| Image startup/readiness/drain/shutdown | **NOT_RUN for this local commit** | The disposable Compose smoke uses a synthetic Core/provider sidecar to hold an in-flight context request. It has not run for these corrections. No production stack, .env, secret or volume is mounted. |
| CI | **FAIL — published head; local corrections unpushed** | Run `36171058414` failed Compose path resolution and two governance tests at `70f8cee8`; run `36171058430` failed the retired Edge desktop packaging step. The Server tests job was still in progress at the last query. Current local focused corrections pass as recorded above; no corrected-head hosted run or aggregate verification pass is claimed. |
| Production/cutover | **NOT_RUN** | No deployment, production migration, live LINE send or real model call. |

## Evidence and commands

All commands below ran in the Session 1 worktree on Windows. Server integration tests use their disposable per-run SQLite database, never a production database.

| Check | Result | Evidence |
|---|---|---|
| Runtime unit suite | **PASS** | From `services/conversation-runtime`, `npm test`: 33 passed, 0 failed, 0 skipped. |
| Runtime boundary build | **PASS** | From `services/conversation-runtime`, `npm run build`: 8 source files, Node 24.19.0. |
| Durable vertical slice | **PASS — focused at source HEAD 4d06bff** | From `apps/server`, the `vitest/node` `startVitest` API ran `tests/integration/conversation-runtime-vertical-slice.test.js` with inline config and isolated global setup: 11 passed, 0 failed, 0 skipped. The new deterministic case holds a signed event after its durable `ADMITTING` marker, switches owner without changing the epoch, then confirms `ADMITTED` under the new owner. It also confirms a delivery-policy epoch change still skips stale admission; the expected diagnostic is 409 `LINE_ACCOUNT_NOT_SERVER_OWNED`. |
| Runtime owner/account control | **PASS — prior focused run** | A prior isolated `startVitest` invocation ran `tests/integration/fr146-line-oa-account.test.js`: 8 passed; the earlier combined vertical-slice/account run was 18/18. That combined result predates the current race-fix test and is not a current combined count. The standard `npm test` wrapper's prior zero-test sandbox failure is not a pass. |
| Independent read-only review | **PASS — source HEAD 4d06bff** | The owner-only transport-epoch race fix received an independent read-only review at this source snapshot. This is a local source review; no commit, push or PR update is claimed. |
| Provider/consumer conformance | **PENDING — current-head rerun** | The prior 10/10 result is historical. Conformance has not been rerun for source `HEAD` `4d06bffcdf80f3e624c234f569e9c43bc19b9593`; current provider/consumer evidence remains pending. |
| Static Compose/COPY paths | **PASS** | `node services/conversation-runtime/scripts/verify-compose-paths.mjs` resolved base web context to `apps/server`, runtime overlay and both disposable smoke build contexts to repository root, and verified both Dockerfiles and all COPY inputs exist. |
| Actual Compose-resolved paths | **HOSTED CHECK PENDING** | The local static result has `composeResolvedPaths=null` because Docker is unavailable locally. CI runs `docker compose config --format json` with `--project-directory apps/server`. |
| Local diff whitespace | **PASS — current closeout diff** | `git diff --check` exited 0 after the current source, snapshot and handoff corrections. |
| Prior mandatory repository regression | **PASS — historical baseline only** | Before S1(a) retirement edits and the local-main sync, `npm run verify` exited 0: Runtime 18 passed; Server Vitest 801 files and 6,728 tests passed, 32 skipped; production build passed; Playwright 223 passed and 4 skipped out of 227, with no failures/flakes. This result does not verify the current composed tree. |
| Hosted image and smoke | **NOT_RUN for this local commit** | No corrected-head hosted job has been started. The required evidence remains `HOSTED_IMAGE_BUILD=PASS` and `IMAGE_START_SMOKE=PASS` from the real CI workflow and disposable Compose project. |
| Prior S1(a) governance before local-main synchronization | **PASS — local** | `npm run govern` exited 0 with 0 critical, 22 warnings and 33 info. The Edge doc-graph was explicitly **SKIPPED** per approved scope; this result does not claim Edge doc-graph freshness. |
| Last recorded composed-tree governance | **PASS — current local closeout** | `npm run govern` exited 0. Server doc graph: 3,741 nodes, 15,822 edges, 10 known dangling edges, 1 changed node; `docs:check` was up to date. Server preflight: 0 critical, 1 warning and 32 info. Data-pipeline map: 82 nodes, 114 edges, 22 chains. Domain state: 14 domains, overall partial, 47 gaps. The Edge doc-graph was explicitly **SKIPPED** and is not covered by this result. |
| Previously recorded S1(a) focused checks | **PASS — focused** | OpenAPI integration: 18/18; focused affected unit batch: 79/79; Edge config reload: 13/13. The E2E selector's separate one-shot 14/14 result at source `HEAD` `4d06bff` is recorded below. Exact commands and the Edge dependency-resolution boundary are recorded below. |
| Earlier `npm run verify` attempt | **BLOCKED — prior preflight state** | At the earlier source snapshot, `npm run verify` ran Runtime tests (18/18) and Runtime build (8 source files, Node 24.19.0), then exited 1 at Server strict preflight. It did not start the Server test, Server build or Playwright stages. This predates the current zero-critical governance result and is not current composite verification evidence. |
| Prior Server `npm test` attempt | **BLOCKED — 0 tests** | Server Vitest did not discover or execute tests because esbuild could not access `../../../../../..` while resolving the isolated Vitest config. The same path denial was reproduced in a TEMP/workspace snapshot. This prior attempt is not current-head verification and is not a pass. |
| Full `npm run verify` | **BLOCKED — Phase-B contract review pending** | The frozen Phase-B inventory digest (`9ca8618d…`) does not match the current Prisma schema digest (`ffa2c121…`). S2's read-only review is pending; the inventory and `phase-b-recovery.mjs` were not changed. The full verification chain was not run. |
| Commit, push and PR update | **COMMITTED LOCALLY — NOT PUSHED** | This closeout commit is on `codex/conversation-runtime-service`; PR #542 still points at published head `70f8cee8a1c3a0c48973528c20fa78c61d631a56`. No push or PR update has been made. |
| Prior full Server Vitest suite | **PASS — prior local run** | `npx vitest run --root . --config ./vitest.config.js` from `apps/server`: 793 files total, 788 passed and 5 skipped; 6,825 tests total, 6,784 passed and 41 skipped; exit code 0, duration 574.21s. Skipped tests include opt-in PostgreSQL suites. `id-anchor-stability` passed 70/70 after sanctioned ID-ledger digest review. This separate successful run does not replace the current blocked wrapper attempt. |
| Previously recorded Server production build | **PASS — prior local run** | `npm run build` from `apps/server`; Next.js 14.2.35 compiled successfully, lint/type checks completed, static page generation 97/97, exit code 0. A current `npm run verify` has not completed. |
| Current model-key card unit | **PASS — focused follow-up** | `npx vitest run --root . --config ./vitest.config.js tests/unit/line-oa-model-key-card-render.test.js` from `apps/server`: 14/14; checks current child-owned copy in rendered markup and that the parent console does not advertise dispatching to a paired device. |
| Runtime checks | **PASS — focused** | `npm run conversation-runtime:test`: 33/33; `npm run conversation-runtime:build`: PASS. These focused checks do not replace full `npm run verify`. |
| Current Edge config reload | **PASS — focused** | `apps/edge/tests/unit/config-reload.test.ts`: 13/13. Worktree dependencies were unavailable, so the run used a temporary resolver with the primary checkout's installed `tsx` and `dotenv`; the test source and Edge runtime source came from this worktree. |
| Current OpenAPI inventory | **PASS — focused** | `npx vitest run --root . --config ./vitest.config.js tests/integration/openapi-docs.test.js` from `apps/server`: 18/18; the route walk confirms 318 paths and 423 operations. |
| One-shot E2E selector | **PASS — focused at source HEAD 4d06bff** | `npx vitest run --root . --config ./vitest.config.js tests/unit/ci-select-e2e.test.js` from `apps/server`: 14/14. This checks the selector only; the full Playwright suite remains pending. |
| Current affected unit batch | **PASS — focused** | From `apps/server`, `npx vitest run --root . --config ./vitest.config.js tests/unit/edge-surface-retirement.test.js tests/unit/line-studio-account-console-render.test.js tests/unit/doc-views.test.js tests/unit/programme-member-view.test.js tests/unit/programme-usage-reports.test.js tests/unit/api-path-reachability.test.js tests/unit/asset-intake-adapters-contract.test.js tests/unit/public-base-url.test.js`: 8 files, 79/79. |
| Closeout focused units | **PASS — current local closeout** | From `apps/server`, `npx vitest run --root . --config ./vitest.config.js tests/unit/line-admission-after-ack.test.js tests/unit/profile-identity-fields-migration.test.js`: 2 files, 25/25. |
| FR-149 E2E locator | **NOT_RERUN after correction** | The captured trace showed the test expected `บันทึกนโยบายการส่ง` while the UI rendered `บันทึกนโยบายและ cohort`; the locator now follows the rendered label. The combined rerun command was blocked because `localhost:3100` was already in use. No post-fix E2E result is claimed. |
| Edge desktop E2E | **NOT_VERIFIED** | With `E2E_PORT=31917`, `npm run test:e2e -- --no-deps --retries=0 tests/e2e/edge-desktop-ui.spec.js` printed 30 passed and 1 failed on the old save-copy expectation (`บันทึกแล้ว` vs `บันทึกผู้ให้บริการแล้ว`). After correction, the filtered run with `E2E_PORT=31918` printed 2 passed tests (including the target) but Playwright hung during teardown; it was interrupted and exited 1. The whole Edge E2E suite is not verified. |
| Phase-B schema contract | **BLOCKED — S2 review pending** | `docs/architecture/project-manager-system/contracts/phase-b/target-schema.inventory.json` remains frozen at a schema digest that differs from the current Prisma schema. S1 left this shared contract and `apps/server/scripts/phase-b-recovery.mjs` untouched pending S2's read-only review. |
| Retired-FR coverage regression | **PASS — focused, prior scope** | `npx vitest run --root . --config ./vitest.config.js tests/unit/doc-graph-retired-rules.test.js` from `apps/server`: 1 file, 6/6 tests, exit 0. Retired FR-220/221/222 remain visible in the graph but no longer inflate active gaps. Its earlier FR-050/140/141/144 gap snapshot predates the approved status decisions recorded below. RCA: `.brain/rca/2026-09-25-retired-fr-coverage-counted-as-active.md`. |
| Prior generator checks | **PASS — local** | `npm run docs:llms:check`, `node apps/server/scripts/programme-containers.mjs --check`, and the prior S1(a) governance run exited 0 with 0 critical, 22 warnings and 33 info. Edge doc-graph was explicitly skipped per approved scope. |

Compose provenance was checked from the tracked files. The base is `apps/server/docker-compose.yml`; the build command explicitly supplies `apps/server/docker-compose.conversation-runtime.yml` as its overlay and sets project directory to `apps/server`. No `docker-compose.override.yml` is loaded by that explicit command. With that project directory, the base web context resolves to `apps/server`; overlay context `../..` resolves to the repository root. The previous `..` would resolve to `apps`, which is not the runtime Dockerfile’s repository-root context. CI verifies the actual resolved Compose JSON before image build.

The first local Vitest invocation and the `npm test` wrapper were denied parent-path traversal by the sandbox before tests started; esbuild reported `Cannot read directory "../../../../../..": Access is denied`, so those attempts executed zero tests. During this closeout, the exact full-suite command above first hit the same sandbox denial; an approved worktree-scoped retry of that unchanged command completed with the results above. An approved worktree-scoped retry also ran the focused integration tests. A later test-name-filter invocation passed its selected crash case but began enumerating the server workspace; it was interrupted, so it is not counted as a completed check. During S1(a), the supported focused selector invocation and the other affected tests completed as listed above. A separate prior Server `npm test` attempt again executed zero tests when esbuild could not access `../../../../../..` while resolving the isolated Vitest config; this was reproduced in a TEMP/workspace snapshot. A full `npm run verify` at the current source snapshot remains pending.

The first mandatory `npm run verify` after the initial runtime tranche exposed five failures in `line-admission-after-ack.test.js`: a runtime identity lookup was running on the unchanged Server execution path, whose fixtures intentionally have no channel identity. The runtime eligibility guard now runs that lookup only for opted-in `CONVERSATION_RUNTIME` direct-message cohorts. The root cause is recorded in `.brain/rca/2026-09-24-runtime-admission-identity-lookup-leaked-to-server-path.md`; the focused admission tests passed 20/20 and the subsequent full regression passed at that earlier, pre-S1(a) checkpoint. It is historical evidence, not a pass for the current tree.

## Remaining Server-owned or unverified flows

- Memory-sync opt-in, out-of-hours handling, group/room audiences, unverified identities, and invalid/unsupported legacy Work command syntax remain on Server paths.
- Non-message LINE event admission, webhook reconciliation/maintenance and unrelated LINE OA workers remain Core/Server-owned.
- The vertical slice covers one eligible direct-message cohort and controlled test data; it does not prove all account configurations, traffic patterns or production behavior.
- Hosted Compose resolution, Linux image build and disposable image smoke have not run locally and remain pending the GitHub check.
- The prior full Server Vitest run passed after the sanctioned digest review: 788/793 files passed, 5 skipped; 6,784/6,825 tests passed, 41 skipped. The Server production build passed. The current closeout governance run exited 0 with 0 critical, 1 warning and 32 info; the graph reports 10 known dangling edges. Edge doc-graph remains skipped. Full `npm run verify` is blocked pending S2's Phase-B contract review; provider conformance, hosted image build/smoke and full Playwright remain unverified. No full extraction, rollout readiness or production cutover is claimed.

## S1(a) Edge Device retirement reconciliation

- S1(a) removes the Server-owned Edge Device and harness pairing, credential, heartbeat and extraction surfaces, plus the Edge callers and Edge extraction contract. Historical records are retained. Signed LINE webhook ingress, the PRP LocalWorker API-key flow, and Knowledge/RAG runtime remain in scope and are preserved. The public `baseUrl` remains as a legacy follow-up.
- The composed Server route inventory is **318 paths / 423 operations**, verified by the actual route-tree integration test (18/18).
- ADR-109 D5 per-ID review is partial: FR-220, FR-221 and FR-222 plus FEAT-035 are retired in the Server surface registry; FR-221 historical report data remains readable, while new usage writes use the deployment-bearer FR-218 path. Per the approved scope, FR-141 and FR-144 are superseded; FR-050 and FR-140 remain planned. Their rationale remains in `docs/PRD-SDD-v1.0.md`; the ID ledger is current but has no per-ID reason-note field.
- FR-143, SEC-025, SDD-085 and FEAT-017 retain their existing active/deferred status pending owner reconciliation. The prior mismatch from Edge callers targeting removed Server routes is addressed by removing those callers and the Edge extraction contract in S1(a); this does not establish production behavior or resolve unrelated requirements. The Edge doc-graph was explicitly **SKIPPED** per approved scope; no Edge graph freshness is claimed.
- The current closeout Server governance run exited 0 with 0 critical, 1 warning and 32 info; the graph reports 10 known dangling edges. The Edge doc-graph remains skipped. FR-050/140 remain planned, FR-141/144 are superseded, and the prior retired-FR coverage correction remains in effect; no requirement anchors or meanings were invented to suppress findings.

## Cutover and rollback gates

- [x] Sync the S1 branch with the current PR base `d302eb0849b00b3c85934eeda6763d7dd4941443`; PR #573's merge is part of this base.
- [ ] Commit the current focused corrections and hand the exact SHA to OPERATOR for branch push; do not push directly from this environment.
- [ ] Update the PR body and re-run hosted CI on the corrected head, including actual Compose resolution, hosted image build and disposable startup smoke.
- [ ] Run full `npm run verify`, current-head provider/consumer conformance, and full Playwright regression without overwriting retained unrelated artifacts.
- [ ] Complete and review the original extraction acceptance scope, including the remaining Server-owned flows.
- [ ] Confirm hosted `HOSTED_IMAGE_BUILD=PASS`, `IMAGE_START_SMOKE=PASS`, and aggregate CI `verify=PASS`; the local Server `npm test` zero-test attempt must be rerun outside the sandbox first.
- [ ] Confirm all required contracts, ownership/revoke races, crash/restart and provider/consumer conformance evidence.
- [ ] Before any separately authorized cutover, reconcile active leases and SENDING/ACCEPTED/UNKNOWN/admission states; stop exactly one executor before enabling the other for a cohort.
- [ ] Keep draft until the original acceptance scope is complete and explicitly reviewed.
- [ ] Production deployment, production migration, live LINE traffic and real model calls require separate authorization; none are part of this checkpoint.

## Version diff

`0.3.8b → 0.3.9b`: keeps published PR #542 at `70f8cee8` and records the current local closeout commit as unpushed. Adds current governance (0 critical, 1 warning, 10 known dangling edges), 25/25 focused Vitest evidence, the FR-149 locator correction without a post-fix rerun, incomplete Edge desktop E2E evidence, the pending Phase-B schema review, and the removal of the invalid append-only Postgres SQL file after regenerating the canonical snapshot. Hosted CI remains red at the published head; corrected-head CI, Docker build/smoke and full regression are not verified. No production migration, deployment, live LINE send or real model call is claimed.
