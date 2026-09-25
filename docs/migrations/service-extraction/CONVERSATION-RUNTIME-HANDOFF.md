---
id: ZAI:CONVERSATION-RUNTIME-HANDOFF
version: "0.3.3b"
status: candidate
last_update: "2026-09-25T09:39:14+07:00,Codex"
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

**Checkpoint state:** partial. One durable LINE direct-message vertical slice now runs through the independent Conversation Runtime process, the authenticated Core façade and Core-owned SQLite queue/receipts. Other flows remain on the Server executor. PR #542 stays draft; this is not the completion of the extraction.

## Provenance and boundaries

- Repository: `Freshair129/zuri.ai`
- Branch: `codex/conversation-runtime-service`
- Worktree: `C:\Users\pc\workspace\zuri-ai\.worktrees\conversation-runtime-session1`
- Reviewed PR baseline: head `189c60766323655149b84928e5db4c16c5e6afb8`, base `fad8ec6252941ca3de01afdb3116484f86b366c3`.
- Current local integration base: main `68f1d5b220c838f4c344b2e1997dfb3795f43d36` (includes #568). The merge is prepared in the index/worktree; `HEAD` remains `810e425e666667d7b83b38011af8244f3a0821b53` and the merge commit is not yet created. No pushed PR head is claimed.
- Draft PR: [#542](https://github.com/Freshair129/zuri.ai/pull/542). No reset, force-push, PR merge or production deployment was performed.
- Governing documents: ADR-106 and SDD-108; contract: `conversation-runtime.v1`.
- Risk: **MEDIUM** — queue ownership and a private Core API boundary change; no schema migration is included.
- Session 2 remains read-only preparation. Session 3 may continue in Files-owned scope. This tranche did not change Files storage, shared Files contracts, MSP/GKS, MinIO, or the Knowledge 17-stage pipeline.
- Production deployment, production migration, live LINE send and real model call: **NOT_RUN**. All credentials, provider endpoints, webhook signatures and delivery adapters used for tests are synthetic or local controlled fixtures.

## Old path and current vertical slice

| Step | Prior/remaining path | Checkpoint path and owner |
|---|---|---|
| Signed LINE ingress | Next webhook verifies the signature and records durable admission before acknowledgement. | Same webhook and admission owner. Eligible direct, verified messages on an account opted into `CONVERSATION_RUNTIME` pin the durable job to that cohort. |
| Queue and claim | Server worker claims and executes Server-owned jobs. | Core owns the queue row, cohort routing, claims, leases, authority revalidation and protected transitions. Legacy claims and READY sends filter to `executionMode=SERVER`; runtime claims only `CONVERSATION_RUNTIME`. |
| Context and answer | Server `createServerLineAnswer` composed context and ran provider/model behavior. | Core `prepare` returns authorized question/evidence/references. Runtime composes the context and invokes its provider port in a separate Node process. It does not call the old answer/model loop. |
| Project/Work | Server parsed commands and called canonical Project Manager writers. | Runtime dispatches the fixed WorkToolPort operations. Core validates and calls canonical writers. Proposal, explicit human confirmation, canonical mutation and durable receipt remain Core-owned. A reclaimed runtime checks the same stable proposal receipt before another execution. |
| Completion and trace | Server worker wrote answer-ready state and execution trace. | Runtime coordinates the turn; Core atomically commits READY and its trace. Stable answer identity is `${jobId}:turn-answer`; model identity is `${jobId}:runtime-model`. A lost completion response is reconciled from Core status before fail or send. |
| LINE delivery | Server worker owned orchestration and transport send. | Runtime coordinates delivery through Core. **Transitional boundary:** the LINE sender, reply-token lifecycle, durable SENDING/ACCEPTED/UNKNOWN state and CRM outbound receipt still belong to Core. Core checks that state before any new transport attempt; no exactly-once delivery claim is made. |

The included end-to-end path is: fake signed webhook → real durable admission/queue → authenticated Core v1 operations over HTTP → separate Conversation Runtime process → controlled local provider → fake LINE sender → durable job, trace and outbound receipt.

The owner is pinned on the durable job by Core. Runtime liveness/readiness is operational health only; it is not the ownership or concurrency gate. Core derives job scope, identity, account binding, transport epoch, consent/erasure state, lease and execution claim from authoritative state on protected operations. A service bearer authenticates the process; it does not authorize a caller-selected actor, tenant, business or account.

## Failure and retry semantics

- Logical completion keeps `${jobId}:turn-answer` across retries and reclaim. Core status is checked after a lost completion response; a committed READY is not overwritten as FAILED.
- Model invocation keeps `${jobId}:runtime-model` across execution IDs. A durable STARTED receipt from another execution is UNKNOWN and does not trigger another model call.
- Proposal operation identity is `${jobId}:work-proposal`; confirmed mutation identity is the original proposal ID, not the current execution ID. Runtime checks the Work receipt before executing after reclaim. Core’s canonical confirmation transaction records the mutation and deterministic receipt together.
- Delivery uncertainty is separate from model/completion uncertainty. Core’s persisted send state and LINE acceptance receipt decide whether the sender can be called again. A response loss is not proof of non-delivery.
- Tests kill Runtime before model start, then reclaim and finish once; and kill it after a canonical Work commit, then recover the saved receipt without another WorkItem or duplicate reply.

## Checkpoint status

| Dimension | Status | Evidence boundary |
|---|---|---|
| Code | **PARTIAL** | Real independent runtime and real Core-owned queue are connected for eligible direct verified messages; other admitted flows remain Server-owned. |
| Contract | **PASS — focused** | Both sides validate the versioned operation/request/response envelopes, deadlines, fields and payload bounds. Core derives authority; forged scope is rejected. |
| Integration | **PASS — focused** | Seven disposable-database vertical-slice tests cover signed admission, duplicate ingress, separate process, fake provider/delivery, receipts, ownership contention, lease/revocation/consent/erasure fences and process restart. Provider consumer conformance is 10/10. |
| Data ownership | **PASS — checkpoint** | Queue, identity/consent/transport authority, canonical Work writes, LINE transport and durable CRM/trace receipts remain in Core. Runtime has no Prisma access. No schema migration was created. Production ownership/cutover is not verified. |
| Hosted image build | **PENDING** | CI builds through the real base Compose plus Conversation Runtime overlay. Local Docker is unavailable; the hosted job must report `HOSTED_IMAGE_BUILD=PASS`. |
| Image startup/readiness/drain/shutdown | **PENDING HOSTED SMOKE** | Disposable Compose smoke uses a synthetic Core/provider sidecar to hold an in-flight context request. It checks readiness becomes 503 during SIGTERM, releases the controlled turn, and requires one provider call, completion, send and clean exit. No production stack, .env, secret or volume is mounted. |
| CI | **PENDING HOSTED** | Current `npm run verify` was run and stops at strict preflight with one critical and one warning; it does not proceed to Server tests/build or Playwright. The hosted `conversation-runtime` job and aggregate `verify` must finish successfully on PR #542 after push. |
| Production/cutover | **NOT_RUN** | No deployment, migration, live LINE send or real model call. |

## Evidence and commands

All commands below ran in the Session 1 worktree on Windows. Server integration tests use their disposable per-run SQLite database, never a production database.

| Check | Result | Evidence |
|---|---|---|
| Runtime unit suite | **PASS** | From `services/conversation-runtime`, `npm test`: 18 passed, 0 failed, 0 skipped. |
| Runtime boundary build | **PASS** | From `services/conversation-runtime`, `npm run build`: 8 source files, Node 24.19.0. |
| Durable vertical slice | **PASS** | From `apps/server`, `npm run test -- tests/integration/conversation-runtime-vertical-slice.test.js`: 7 passed, 0 failed, 0 skipped. The harness calls the actual versioned route handlers backed by the real Core façade. |
| Provider/consumer conformance | **PASS** | From `apps/server`, `npm run test -- tests/integration/conversation-runtime-model-conformance.test.js`: 10 passed, 0 failed, 0 skipped. It compares request, response and failures for OpenRouter, OpenAI, Anthropic, Gemini, Groq and PRP, including HTTP/JSON/empty-response errors and deadlines. Credentials are synthetic. |
| Static Compose/COPY paths | **PASS** | `node services/conversation-runtime/scripts/verify-compose-paths.mjs` resolved base web context to `apps/server`, runtime overlay and both disposable smoke build contexts to repository root, and verified both Dockerfiles and all COPY inputs exist. |
| Actual Compose-resolved paths | **HOSTED CHECK PENDING** | The local static result has `composeResolvedPaths=null` because Docker is unavailable locally. CI runs `docker compose config --format json` with `--project-directory apps/server`. |
| Local diff whitespace | **BLOCKED — ADR-109 formatting** | `git diff --check` passes for unstaged changes; `git diff --cached --check` reports one extra blank line at EOF in staged `docs/decisions/ADR-109-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md`. The file was left unchanged under the instruction not to edit ADR-109. |
| Prior mandatory repository regression | **PASS — historical baseline only** | Before S1(a) retirement edits and the local-main sync, `npm run verify` exited 0: Runtime 18 passed; Server Vitest 801 files and 6,728 tests passed, 32 skipped; production build passed; Playwright 223 passed and 4 skipped out of 227, with no failures/flakes. This result does not verify the current composed tree. |
| Hosted image and smoke | **PENDING** | The CI build uses `docker compose --project-directory apps/server -f apps/server/docker-compose.yml -f apps/server/docker-compose.conversation-runtime.yml build conversation-runtime`. The CI smoke uses a separate disposable Compose project with a Core/provider stub and no volumes; it must emit `IMAGE_START_SMOKE=PASS`. |
| Current S1(a) governance | **BLOCKED — preflight** | Latest `npm run govern`: graph generation and `docs:check` pass; strict preflight exits 1 with one critical for active FR-050, FR-140, FR-141 and FR-144, plus one warning for 10 dangling annotation edges. FR-220/221/222 are retired and are no longer counted as active code/test gaps. This is not a green governance run. |
| Current S1(a) focused checks | **PASS — focused** | OpenAPI integration: 18/18; E2E selector unit: 14/14; focused affected unit batch: 79/79. Exact commands are recorded below. |
| Current `npm run verify` | **FAIL — strict preflight** | `npm run verify` ran Runtime tests (18/18) and Runtime build (8 source files, Node 24.19.0), then exited 1 at Server strict preflight. It did not start the Server test, Server build or Playwright stages. The separate full Server Vitest and Server build passed as recorded below; full Playwright was not run. |
| Current full Server Vitest suite | **PASS — local** | `npx vitest run --root . --config ./vitest.config.js` from `apps/server`: 793 files total, 788 passed and 5 skipped; 6,825 tests total, 6,784 passed and 41 skipped; exit code 0, duration 574.21s. Skipped tests include opt-in PostgreSQL suites. `id-anchor-stability` passed 70/70 after sanctioned ID-ledger digest review. |
| Current Server production build | **PASS** | `npm run build` from `apps/server`; Next.js 14.2.35 compiled successfully, lint/type checks completed, static page generation 97/97, exit code 0. |
| Current model-key card unit | **PASS — focused follow-up** | `npx vitest run --root . --config ./vitest.config.js tests/unit/line-oa-model-key-card-render.test.js` from `apps/server`: 14/14; checks current child-owned copy in rendered markup and that the parent console does not advertise dispatching to a paired device. |
| Current Runtime checks | **PASS** | `npm run conversation-runtime:test`: 18/18; `npm run conversation-runtime:build`: 8 source files, Node 24.19.0. |
| Current OpenAPI inventory | **PASS — focused** | `npx vitest run --root . --config ./vitest.config.js tests/integration/openapi-docs.test.js` from `apps/server`: 18/18; the route walk confirms 318 paths and 423 operations. |
| Current E2E selector | **PASS — focused** | `npx vitest run --root . --config ./vitest.config.js tests/unit/ci-select-e2e.test.js` from `apps/server`: 14/14. |
| Current affected unit batch | **PASS — focused** | From `apps/server`, `npx vitest run --root . --config ./vitest.config.js tests/unit/edge-surface-retirement.test.js tests/unit/line-studio-account-console-render.test.js tests/unit/doc-views.test.js tests/unit/programme-member-view.test.js tests/unit/programme-usage-reports.test.js tests/unit/api-path-reachability.test.js tests/unit/asset-intake-adapters-contract.test.js tests/unit/public-base-url.test.js`: 8 files, 79/79. |
| Retired-FR coverage regression | **PASS — focused** | `npx vitest run --root . --config ./vitest.config.js tests/unit/doc-graph-retired-rules.test.js` from `apps/server`: 1 file, 6/6 tests, exit 0. Retired FR-220/221/222 remain visible in the graph but no longer inflate active gaps; FR-050/140/141/144 remain active gaps. RCA: `.brain/rca/2026-09-25-retired-fr-coverage-counted-as-active.md`. |
| Current generator checks | **PASS** | `npm run docs:llms:check`, `node apps/server/scripts/programme-containers.mjs --check`, and final `npm run govern` graph/doc-check stages passed. Strict preflight remains blocked as listed above. |

Compose provenance was checked from the tracked files. The base is `apps/server/docker-compose.yml`; the build command explicitly supplies `apps/server/docker-compose.conversation-runtime.yml` as its overlay and sets project directory to `apps/server`. No `docker-compose.override.yml` is loaded by that explicit command. With that project directory, the base web context resolves to `apps/server`; overlay context `../..` resolves to the repository root. The previous `..` would resolve to `apps`, which is not the runtime Dockerfile’s repository-root context. CI verifies the actual resolved Compose JSON before image build.

The first local Vitest invocation and the `npm test` wrapper were denied parent-path traversal by the sandbox before tests started; esbuild reported `Cannot read directory "../../../../../..": Access is denied`, so those attempts executed zero tests. During this closeout, the exact full-suite command above first hit the same sandbox denial; an approved worktree-scoped retry of that unchanged command completed with the results above. An approved worktree-scoped retry also ran the focused integration tests. A later test-name-filter invocation passed its selected crash case but began enumerating the server workspace; it was interrupted, so it is not counted as a completed check. During S1(a), the supported focused selector invocation and the other affected tests completed as listed above.

The first mandatory `npm run verify` after the initial runtime tranche exposed five failures in `line-admission-after-ack.test.js`: a runtime identity lookup was running on the unchanged Server execution path, whose fixtures intentionally have no channel identity. The runtime eligibility guard now runs that lookup only for opted-in `CONVERSATION_RUNTIME` direct-message cohorts. The root cause is recorded in `.brain/rca/2026-09-24-runtime-admission-identity-lookup-leaked-to-server-path.md`; the focused admission tests passed 20/20 and the subsequent full regression passed at that earlier, pre-S1(a) checkpoint. It is historical evidence, not a pass for the current tree.

## Remaining Server-owned or unverified flows

- Memory-sync opt-in, out-of-hours handling, group/room audiences, unverified identities, and invalid/unsupported legacy Work command syntax remain on Server paths.
- Non-message LINE event admission, webhook reconciliation/maintenance and unrelated LINE OA workers remain Core/Server-owned.
- The vertical slice covers one eligible direct-message cohort and controlled test data; it does not prove all account configurations, traffic patterns or production behavior.
- Hosted Compose resolution, Linux image build and disposable image smoke have not run locally and remain pending the GitHub check.
- The current full Server Vitest run passed after the sanctioned digest review: 788/793 files passed, 5 skipped; 6,784/6,825 tests passed, 41 skipped. The Server production build passed. Strict preflight still blocks the composite verify command, and full Playwright was not run. No full extraction, rollout readiness or production cutover is claimed.

## S1(a) Edge Device retirement reconciliation

- Server-owned Edge Device and harness pairing, credential, heartbeat and extraction surfaces were removed from this branch. Historical records and schemas are retained. Signed LINE webhook ingress, the PRP LocalWorker API-key flow, and Knowledge/RAG runtime remain in scope and are preserved.
- The composed Server route inventory is **318 paths / 423 operations**, verified by the actual route-tree integration test (18/18).
- ADR-109 D5 per-ID review is partial: FR-220, FR-221 and FR-222 plus FEAT-035 are retired in the Server surface registry; FR-221 historical report data remains readable, while new usage writes use the deployment-bearer FR-218 path. FR-050 and FR-140 remain active by owner decision.
- FR-141, FR-143, FR-144, SEC-025, SDD-085 and FEAT-017 remain active/deferred pending owner reconciliation. The Server heartbeat, Edge credential and Edge extraction-job routes/modules are removed here, but `apps/edge` is unchanged from current main and still contains `src/zuri-api/client.ts`, `src/zuri-api/heartbeat.ts`, `src/evidence/extraction-client.ts`, `src/evidence/extraction-contract.ts`, plus contract/unit tests that call `/api/agent/heartbeat` and `/api/edge/extraction-jobs/*` using `edgk_` credentials. Those callers now target removed Server routes; this cross-repository behavior is unverified and remains an ADR-109 D5 mismatch. SEC-025 remains active as long as those key-handling callers/contracts remain. This tranche does not claim full retirement of those identifiers and does not modify the Edge Knowledge/RAG runtime.
- The current preflight critical is limited to active FR-050/140/141/144. The retired-FR coverage fix excludes only superseded FRs and records their IDs separately; no anchors or requirement semantics were invented to suppress remaining findings.

## Cutover and rollback gates

- [ ] Complete and review the original extraction acceptance scope, including the remaining Server-owned flows.
- [ ] Confirm hosted `HOSTED_IMAGE_BUILD=PASS`, `IMAGE_START_SMOKE=PASS`, and aggregate CI `verify=PASS`.
- [ ] Confirm all required contracts, ownership/revoke races, crash/restart and provider/consumer conformance evidence.
- [ ] Before any separately authorized cutover, reconcile active leases and SENDING/ACCEPTED/UNKNOWN/admission states; stop exactly one executor before enabling the other for a cohort.
- [ ] Keep draft until the original acceptance scope is complete and explicitly reviewed.
- [ ] Production deployment, production migration, live LINE traffic and real model calls require separate authorization; none are part of this checkpoint.

## Version diff

`0.3.2b → 0.3.3b`: corrects the local integration base to main `68f1d5b2` and records that its merge commit is pending; records the retired-FR coverage correction, current active preflight findings, successful full Server Vitest (6,784 passed / 41 skipped), successful Server build, and `npm run verify` stopping at strict preflight. It records the remaining apps/edge heartbeat/extraction consumers as an explicit ADR-109 D5 mismatch. Hosted image build, disposable image smoke, full Playwright and extraction acceptance remain pending. Extraction status remains candidate/partial.
