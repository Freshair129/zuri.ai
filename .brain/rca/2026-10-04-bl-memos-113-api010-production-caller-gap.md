# RCA — BL-MEMOS-113 API-010 production caller gap

**Date:** 2026-10-04  
**Version:** 1.16
**Risk:** C-3 / HIGH  
**Status:** Receipt-time erasure races are fixed and focused tests/builds pass. Full regression passed before this final ordering correction; production activation remains gated.

## Symptom

The LINE production composition does not call API-010 `msp_vault_resolve` before
API-009 episodic-memory access. The existing API-011 session/thread context path
can be mistaken for that integration even though it uses a separate contract.

## Evidence

- `apps/server/src/modules/agent/runtime.js` composes API-010 and API-009 ports
  in `createAgentPorts()`; a source call-site search found no production caller.
- `apps/server/src/modules/line-oa-studio/application/server-line-runtime.js`
  composes `createMspThreadMemoryPort()` for LINE.
- `apps/server/src/modules/line-oa-studio/application/conversation-runtime-memory.js`
  obtains thread context through API-011 `msp_thread_*` operations.
- FR-057's exit gate requires API-010 on every private-memory turn. ADR-091 and
  FR-231 define the API-011 session/thread path separately and retain policy,
  consent, receipts and erasure gates.
- At the baseline revision, LINE admission used only the deployment-level
  `ZURI_MSP_THREAD_MEMORY_ENABLED` flag and `LineOaAccount` had no `memoryPolicy`.
  The current candidate adds an OFF-by-default account policy snapshot and uses
  the environment flag as a runtime kill switch for API-011 session operations.
- At Zuri `origin/main` `a6e295a5`, the production API-010 caller remains absent.
  The current working-tree candidate now wires it through LINE and tests that
  API-010 authorization precedes API-009 retrieval; no production traffic or
  activation is claimed.
- `memoryServerScope()` in `apps/server/src/modules/agent/server-line-answer.js`
  provides tenant, business, channel and agent but no workspace or project.
  `resolveAgentAuthorization()` leaves those scope fields null unless trusted
  server scope supplies them; its fallback workspace value exists only on the
  compatibility vault object and does not populate `AuthContext.scope`.
- The pinned signed API-010 candidate requires non-empty `workspace_id` and
  `project_id` in `access_context`, and both values are signed grant claims.
  At baseline, there was no trusted LineOaAccount/business
  workspace/project mapping.
- MSP `origin/main` at `4928e71d42687b4eb72de060091d031ea22b5b91` does not
  require the signed API-010 `legacy_access` grant. The contract change is on
  the pushed branch `origin/codex/rsk-memos-12-vault-resolve-fail-closed` at
  `fd6c24b0d6d6f2e51b67cd39c775d962057eba0c`; no PR exists yet.
- The owner selected one Zuri Development `Project` per LINE OA account, with
  Workspace derived from that Project. `LineOaAccount` has no such association
  today. The LINE Studio prototype's “Project” remains `LineOaAccount`; this
  Development Project is only an API-010 memory-scope reference.
- The current candidate adds `LineOaAccount.memoryProjectId`, publisher selection,
  derived Workspace validation, and immutable job scope snapshots. The caller
  validates the same mapping before API-010 and API-009 operations; episodic
  retrieval remains independently OFF unless its environment kill switch is on.
- The candidate production compositions pass API-010 resolved vault authority
  to the API-009 episodic port, and the production-composition test observes
  `msp_vault_resolve` before `msp_memory_list`.
- At baseline, `schema.prisma` had no `MemoryProjectionReceipt` model. The
  delivery worker stored trace checkpoints and a job delivery state, but no
  durable row joining
  the CRM message/direction to MSP thread, session and message identifiers.
- At baseline, `line-memory-erasure.js` queued a tenant/principal API-011 erasure
  trace for memory-sync jobs. `msp-thread-memory-port.js` omitted `erase_vault`,
  so that path did not erase the API-009 principal vault. Its unit was a tenant/principal
  request, not each projection receipt. The scoped search found no
  customer-facing `PENDING_MSP` state backed by those trace events.

## Root Cause

The API-010 resolver and API-009 memory port were composed as a reusable agent
port, but never connected to the LINE production composition. The production
session-memory feature was implemented separately through API-011. Treating that
session path as the API-010 caller would cross the session and episodic-memory
authorization boundaries. Separately, the LINE server scope does not provide
the required workspace/project owner tuple, so wiring the adapter without a
trusted mapping would require inventing authorization scope.

The missing production slice also lacks projection receipts that make successful
MSP writes erasable by provenance, and its current erasure call omits vault
erasure. Adding a caller alone would create API-009 data that the existing
erasure path cannot prove or delete.

## Why the issue escaped detection

Adapter tests call `createAgentPorts()` directly and verify its ports in
isolation. LINE composition tests cover API-011 but do not assert an API-010 call
before API-009 private retrieval. The existing work-plan exit gate was not proven
against the production composition. In addition, the signed API-010 contract is
not yet on MSP main, and FR-231's account policy/erasure prerequisites are not
complete in the current source.

## Proposed prevention

1. Keep API-011 session context and API-010 → API-009 episodic memory as separate
   production ports with separate authorization and erasure gates.
2. Add a production-composition test that proves API-010 authorization precedes
   every API-009 private-memory read/write and that denial produces no API-009 call.
3. Require trusted per-turn owner, policy, consent and audience data; missing or
   untrusted values deny private memory.
4. Do not activate the caller until the signed API-010 contract is on MSP main,
   the FR-231 policy/receipt/erasure gates are met, and rollback/deployment
   acceptance is recorded.
5. Store only the Publisher-selected Development Project on `LineOaAccount`;
   derive its Workspace from the database and validate tenant, Business,
   lifecycle and relation at admission and before each MSP boundary. Snapshot
   both IDs on the job; missing or changed scope stops before transport.
6. Record every acknowledged MSP projection with CRM message, direction and MSP
   thread/session/message IDs; settle its delivery receipt transactionally.
7. Enqueue durable MSP erasure per the approved `(tenant, principal, erasure
   request)` unit, including API-009 vault erasure; keep every local projection
   receipt traceable and expose `PENDING_MSP` until acknowledgement. Keep legacy
   trace erasure records drainable during rollout.

## Implementation verification RCA — 2026-10-04

### Symptom

The first receipt-aware integration run left policy-denied or disabled-account
delivery jobs pending, and a backup restore with a Project-mapped LINE account
failed on a foreign key. A `PENDING_INBOUND` MSP delivery receipt also has no
returned message ID, despite being a durable accepted outcome.

### Evidence

- Prisma 5.22 rejected `lineConversationJobId_direction` inside
  `MemoryProjectionReceipt.updateMany`; compound selectors are only valid for
  unique reads/writes, so delivery closure rolled back with the job update.
- The restore order placed `LineOaAccount` before `Workspace`/`Project`; the new
  optional account→Project relation therefore violated the foreign key while
  restoring a selected scope.
- The API-011 port's accepted `PENDING_INBOUND` shape includes a durable
  `receiptId` but can omit `messageId`. The append receipt already stores the
  MSP message ID before provider delivery.
- After correcting both defects and seeding the append receipt in scanner
  fixtures, 123 focused tests across 10 unit/integration files passed, including disabled and
  denied closure, snapshot restore, project-scoped account configuration,
  consented admission, and API-010-before-API-009 call order.

### Root Cause

The new closure path reused a compound unique selector in a bulk-update API,
and the snapshot dependency list had not been reordered for the new account to
Project foreign key. Separately, the successful DTO validator recognized
`PENDING_INBOUND` but settlement still required a message ID in the response,
ignoring the ID already persisted from the append operation.

### Why the issue escaped detection

The initial implementation had no test for closing a stored projection receipt;
the older scanner fixtures had no append receipt, so the first receipt-aware
  run exposed both fixture gaps and the invalid update selector. Backup fixtures
had no account-to-Project relationship, so restore order was not exercised.
The existing DTO contract explicitly allows `PENDING_INBOUND` without a
message ID, but settlement had not been tested against that shape.

### Proposed prevention

Use scalar predicates for Prisma bulk updates, keep snapshot order aligned with
the schema's actual foreign keys, and add an integration test that persists an
append receipt before testing delivery settlement. For `PENDING_INBOUND`, require
the durable MSP receipt and settle only against the previously persisted append
  ID; reject all unknown or malformed outcomes. Keep the production opt-in closed
until MSP main and release acceptance gates are satisfied.

## Version diff

0.0 → 1.0: records the confirmed missing production caller, the API-011/API-010
boundary, the MSP contract mismatch, and the required prevention gates.
1.0 → 1.1: adds the independently verified missing workspace/project mapping
required by the signed API-010 candidate. No code or production state was changed
by this RCA.
1.1 → 1.2: records the account-policy/runtime-kill-switch hardening and makes
clear that the absent production API-010 caller and trusted mapping remain open.
No production state was changed by this RCA.
1.2 → 1.3: records the owner's selected Project mapping, confirms the missing
projection-receipt and API-009 vault-erasure coverage, and expands the
activation blockers. No production state was changed.
1.3 → 1.4: records the implemented Zuri caller, Project-derived Workspace,
durable projection/erasure receipts, plus the Prisma closure, restore ordering,
and `PENDING_INBOUND` settlement defects found and fixed by integration
verification. Production activation and the remaining FR-232 consent/GKS work
remain blocked/open; no production state was changed.
1.4 → 1.5: refreshes Zuri/MSP remote-head evidence and records the pushed but
unreviewed MSP signed-contract branch. Focused local verification now covers 123
tests across 10 files. Production activation and the remaining FR-232 consent/GKS
work remain blocked/open; no production state was changed.

## Erasure granularity documentation reconciliation — 2026-10-04

### Symptom

The current FR-232 implementation note describes one tenant/principal API-011
request settling several projection receipts, while ADR-091 D6 still prescribes
one MSP call per projection receipt. This makes the implemented worker appear to
violate the current erasure decision.

### Evidence

- CONVERSATION-RUNTIME-HANDOFF.md v0.3.18b records the owner's 2026-09-28 option
  A: exactly one tenant-wide MSP erase per person with memory-sync data, DIRECT
  included, with one durable record per `(tenant, principal, erasure request)`.
- The handoff records that this decision was delivered in merged PR #614 and
  supersedes the earlier per-thread decision.
- `line-memory-erasure.js` calls the tenant-wide principal erase operation and
  settles the affected local projection receipts after MSP acknowledgement.
- FR-232 is source-preserved; its original row/hash must remain unchanged. The
  mismatch is in its explanatory boundary and ADR-091's stale D6 granularity.

### Root Cause

ADR-091 D6 and the FR-232 source row predate the later owner decision. The
implementation note explained current behavior but did not cite the superseding
decision, and ADR-091 had no amendment recording it.

### Why the issue escaped detection

The review compared current implementation text to the original FR-232 row and
ADR-091 D6 without first reconciling the later owner decision recorded in the
Conversation Runtime handoff and merged PR #614.

### Proposed prevention

Record approved changes to erasure scope in ADR-091 and point explanatory FR
notes to that authority. Keep local receipt provenance separate from MSP request
granularity, preserve the source row and hash, and keep consent-decline and GKS
withdrawal/correction as explicit open FR-232 work.

1.5 → 1.6: reconciles the erasure prevention rule and current documentation to
the owner's 2026-09-28 tenant-wide per-principal/per-request decision (PR #614).
The worker required no code change; consent-decline and GKS remain open. No
production state was changed.

## Full-verification RCA — 2026-10-04

### Symptom

The first full Zuri verification of the caller candidate failed before build or
E2E could run: 7,836 tests passed, 43 skipped, and 31 failed in six files. The
failures expose a runtime/API boundary defect as well as stale test fixtures and
a stale frozen Phase B recovery inventory.

### Evidence

- `npm run verify` passed governance and the Conversation Runtime unit/build
  stage, then stopped at `npm test`; its build and E2E stages were not run.
- The Conversation Runtime prepare operation marks every account-policy-opted
  turn `memorySync: true`, while its memory operation rejects requests unless
  `ZURI_MSP_THREAD_MEMORY_ENABLED=true`. Completion also inferred a required
  API-011 append from the account policy even when that runtime kill switch was
  off. The existing contract tests expect a normal turn to proceed without
  `msp_thread_*` calls while API-011 is disabled.
- The runtime API-010 episodic port is constructed and invoked inside the
  API-011 `memory.read` path. Thus API-010 cannot supply episodic context to the
  Conversation Runtime when the separate API-011 kill switch is off, despite
  ADR-091 D4 and FR-057 defining independent authorization and rollout gates.
- The scanner test double returns a fabricated delivery `messageId` instead of
  the ID acknowledged and already stored by its API-011 append fixture. The
  MSP implementation returns the existing outbound message ID for resolved
  delivery, so production validation correctly rejects the double's mismatch.
- Four LINE/GKS fixture cases construct opted-in memory jobs without enabling
  the API-011 test flag. The agent-runtime and memory-lineage fixtures predate
  the explicit `episodicMemoryAllowed` API-010 authorization decision and omit
  its granted Customer consent and trusted scope setup.
- The frozen Phase B recovery inventory still pins 194 application tables,
  while the candidate adds `MemoryProjectionReceipt`, bringing the schema to
  195 models. `loadFrozenSchemaInventory()` refuses the stale hash/count before
  the recovery tests can register.

### Root Cause

The Conversation Runtime implementation treats API-011 as the parent operation
for both session and episodic memory. That accidentally makes API-010 depend on
the API-011 kill switch and incorrectly makes account opt-in alone require an
API-011 append. The remaining failures are test-contract drift: fixture DTOs and
authorization inputs do not match the signed delivery/API-010 policies now
enforced by production code. The Phase B refusal is a deliberate integrity
check against an inventory that was not rebound after the added model.

### Why the issue escaped detection

The earlier targeted verification proved API-010-before-API-009 inside the
legacy Server composition and covered the API-011-enabled Conversation Runtime
path. It did not run the full suite across API-011-disabled turns, the newer
strict API-010 policy fixtures, delivery settlement against the actual MSP
return shape, or the frozen Phase B inventory loader. The narrower 123-test
pass therefore did not prove independent API gating or repository DoD.

### Proposed prevention

1. Compose API-010 episodic slices from the claimed job's trusted scope,
   Customer consent and principal authorization independently of the API-011
   memory operation. Keep both tiers under the existing shared context budget
   and preserve fail-closed API-009 access.
2. Set runtime `memorySync` and require an API-011 append only when the
   API-011 runtime kill switch is enabled for that job. Do not reinterpret the
   account policy as proof that API-011 ran.
3. Keep delivery validators strict; make test doubles return the exact message
   identity acknowledged by their append fixture.
4. Update only fixtures whose intent is to exercise API-011 or authorized
   API-010, explicitly providing the matching kill switch, consent, scope and
   episodic authorization.
5. Rebind the Phase B recovery inventory, hash/count literals and parent
   recovery decision to the 195-model schema using the repository's inventory
   generation and digest functions. Never weaken stale-schema refusal.
6. Require `npm run verify` to reach and pass governance, all tests, build and
   E2E before calling this patch complete or pushing it for review.

### Version diff

1.6 → 1.7: records the full-verification failures and confirms API-010 was
nested under the API-011 runtime operation despite separate contract gates;
records the fixture DTO/policy drift and stale 194-table recovery binding. The
approved repair must separate the runtime callers, preserve fail-closed
authorization, rebind recovery integrity data and pass full repository
verification. No production state was changed.

## Projection-delivery RCA — 2026-10-04

### Symptom

The API-011 delivery scanner calls MSP but receives no accepted outbound message
identity, so it leaves provider-accepted deliveries pending and retries them.

### Evidence

- `lineMemoryHandle()` stores `memoryInbound.message.messageId`, the MSP inbound
  ID. `appendLineMemoryAnswer()` uses that value to set the outbound append's
  `sourceEventId` to `<msp-inbound-id>:assistant`.
- `line-memory-delivery.js` passed `job.inboundMessageId`, the CRM message ID,
  to `recordDelivery()`. The API-011 port derives its delivery `source_event_id`
  from that argument, so it did not identify the previously appended outbound
  message.
- The integration fake then returned a fabricated/absent message identity;
  the scanner requires a `messageId` for `ACCEPTED` and correctly retained the
  delivery as unknown/pending.

### Root Cause

The delivery scanner used the CRM inbound ID where the MSP adapter contract
requires the acknowledged MSP inbound ID. It did not join the durable inbound
`MemoryProjectionReceipt` that already records that identifier.

### Why the issue escaped detection

The delivery scanner tests created only an outbound projection receipt and used
a fake response that did not prove the adapter's `source_event_id` matched the
actual outbound append. The full suite reached the path but its fixture hid the
CRM/MSP identifier mismatch.

### Proposed prevention

1. Re-read and validate the job's acknowledged inbound projection receipt before
   delivery; pass its stored `mspMessageId` to the API-011 delivery port.
2. Keep `ACCEPTED` strict: acknowledge only when MSP returns a message identity
   for the outbound append named by the exact source event.
3. Have scanner fixtures persist both projection directions and return the
   already-stored outbound MSP message ID. Scope each integration scan to the
   intended job when its fake MSP state represents one job.
4. Include the scanner integration test in full `npm run verify` before review.

### Version diff

1.7 → 1.8: records the confirmed CRM/MSP inbound-ID mismatch in API-011 delivery
reconciliation and the repair based on the durable inbound projection receipt.
The API-010 caller separation and production activation gates are unchanged.

## API-010 with corpus grounding RCA — 2026-10-04

### Symptom

An opted-in LINE turn with GKS evidence, an authorized API-010 episodic result,
and API-011 disabled can answer with `NO_EVIDENCE_REPLY` without invoking the
model, even though both the GKS query and API-010 recall are independently
available.

### Evidence

- `createCorePrepareTurn()` returned an empty evidence set for every memory turn
  using a corpus grounding mode, on the assumption that Core's API-011 `memory
  read` would fetch and compose GKS evidence.
- `createConversationRuntimeCore()` only sets `memorySync` when the API-011
  runtime flag is enabled. With that flag disabled, the skipped prepare query
  was never replaced by an API-011 read.
- Core can still attach API-010 episodic slices independently. However,
  `createConversationRuntime()` checks for empty evidence before composing
  slices, so those authorized slices cannot reach the shared composer or model.
- ADR-091 D4 and FR-057 require API-010 and API-011 to retain independent gates;
  FR-235 requires corpus knowledge and memory context to respect one bounded
  context budget.

### Root Cause

The corpus-mode prepare skip was conditioned on `isMemoryTurn(job)` but not on
the API-011 kill switch. That made GKS retrieval depend on API-011 despite the
independent API-010 and GKS paths. The runtime's no-evidence gate then ran before
the API-010 slices were composed, discarding otherwise authorized episodic
context.

### Why the issue escaped detection

The API-010/API-011 independence integration covered `BUSINESS_KNOWLEDGE`,
where `prepare` already queries evidence. Corpus-mode coverage exercised the
API-011-enabled path, where the `memory read` operation supplies the GKS result.
No test combined corpus grounding, API-010 opt-in, and the API-011-off state.

### Proposed prevention

1. Suppress the corpus query in `prepare` only when the API-011 runtime read is
   enabled and will own that query.
2. When API-010 slices are present, pass current GKS evidence through the same
   runtime context composer, then restrict model evidence to the knowledge
   records that survived the shared budget.
3. Add an integration case for GKS plus API-010 with API-011 disabled and assert
   that the model receives both authorized contexts without API-011 calls.
4. Preserve the existing no-evidence reply when the GKS result is actually
   empty; episodic context alone does not bypass the grounding evidence gate.

Correction to the API-011 projection-delivery RCA: the CRM/MSP inbound-ID
mismatch in the production scanner was the root cause. The scanner test fake's
missing matching outbound message identity exposed the failure but was not the
production cause.

### Version diff

1.8 → 1.9: records the corpus-grounding/API-010 failure when API-011 is disabled,
the conditional-prepare/shared-composer repair, and the GKS/API-010 integration
coverage. Clarifies that the scanner fake exposed, but did not cause, the
production CRM/MSP identifier mismatch.

## Backup recovery gate RCA — 2026-10-04

### Symptom

Full repository verification fails backup previews and restores when the
installation snapshot contains an authorized episodic-memory job that does not
opt into API-011 session memory. The same invalid recovery result blocks
unrelated snapshot round trips because the LINE recovery manifest is global.

### Evidence

- The full `npm run verify` run reached all server tests and reported 23 failed
  tests across 13 files; 7,864 passed and 43 skipped. Conversation Runtime unit
  tests/build and governance/preflight had passed; the server build and E2E did
  not run after Vitest failed.
- `lineWorkerMemoryRecovery()` in
  `apps/server/src/modules/project-manager/application/backup-service.js`
  rejects `episodicMemoryOptIn = true` unless `memorySyncOptIn = true`, with the
  error “episodic memory without direct opted-in session memory”.
- The owner-approved API-010/API-011 contract makes episodic retrieval an
  independent caller and feature gate. The episodic job also carries the
  trusted `episodicWorkspaceId` and `episodicProjectId` snapshots; recovery must
  preserve and validate those independently of API-011 delivery state.
- A representative API-011-only delivery-state error appeared in backup tests
  because the invalid LINE manifest caused the preview to stop before its
  intended archive/billing/knowledge checks.

### Root Cause

The LINE snapshot validator still models API-010 episodic opt-in as a child of
API-011 session opt-in. That obsolete invariant invalidates otherwise complete
installation snapshots and prevents unrelated evidence from being restored.
It also does not establish the trusted Project/Workspace pair as the validity
condition for an API-010-enabled restored job.

### Why the issue escaped detection

The earlier runtime tests proved caller behavior, current-scope revalidation,
and API-011-disabled operation, but did not export and restore an
API-010-enabled/API-011-disabled job. Recovery tests exercised API-011
delivery-state fixtures and therefore kept the obsolete implication intact.

### Proposed prevention

1. Validate API-011 delivery state only from `memorySyncOptIn`; validate
   API-010 episodic opt-in independently with DIRECT audience and non-empty
   trusted Workspace/Project snapshots.
2. Preserve the episodic scope IDs when a valid recovery manifest is present.
   For unavailable legacy manifests, restore both memory tiers off and clear
   those scope IDs; count episodic-only jobs as protected evidence.
3. Version the LINE recovery manifest for the independent scope contract while
   continuing to accept compatible prior manifests when their row data passes
   the new fail-closed validation.
4. Add backup round-trip tests for API-010 on/API-011 off, cross-audience and
   missing-scope refusal, and legacy-manifest fail-closed restoration.
5. Re-run the complete `npm run verify`; build and E2E remain unverified until
   they execute after a passing server test suite.

### Version diff

1.9 → 1.10: records the snapshot failure caused by coupling API-010 episodic
opt-in to API-011 session opt-in, updates the required scope-preserving recovery
contract, and lists the integration evidence needed to close the gate.

### Verification outcome — 2026-10-04

The corrected candidate completed `npm run verify` successfully. Conversation
Runtime tests passed 73/73. Server Vitest passed 7,887 tests across 850 files,
with 43 tests skipped across 5 files. The production build passed. Playwright
passed 208 tests with 4 skipped. Registry, graph, views and strict preflight
checks completed with zero critical findings; preflight reported 21 warnings
and the graph reported 10 dangling references already present in the live
documentation state.

This confirms local code, tests, build and browser-suite evidence only. Current
remote refs still show the signed API-010 MSP contract on
`codex/rsk-memos-12-vault-resolve-fail-closed`
(`fd6c24b0d6d6f2e51b67cd39c775d962057eba0c`), while MSP `main` remains
`4928e71d42687b4eb72de060091d031ea22b5b91`. Hosted CI, reviewed MSP-main
contract support, consent-decline/GKS withdrawal work, rollback acceptance,
migration readiness and production deployment acceptance remain separate
release gates.

1.10 → 1.11: records successful full local verification after decoupling
API-010 recovery validation from API-011 session opt-in; clarifies that local
verification does not close the external release gates.

## Security review RCA — API-010 recall after concurrent erasure — 2026-10-04

### Symptom

An episodic-memory read can finish from an admitted job snapshot after a
concurrent principal erasure has fenced that job. When API-011 is disabled,
neither LINE execution path re-reads the erasure state before the retained
episodic slices reach the model. A Conversation Runtime turn that combines
API-010 slices with API-011 context can also send retained API-011 slices to the
model without running the API-011 injection-receipt lifecycle if the composer
drops any thread slice. The delivery scanner also accepted an acknowledged
inbound projection without requiring its erasure status to remain ACTIVE.

### Evidence

- `readAuthorizedLineEpisodicMemory()` checked `job.errorCode` from the caller's
  snapshot, then awaited authorization and API-009 recall without reading the
  current job row.
- In `createServerLineAnswer()`, the pre-model `assertMemoryJobLive()` was
  conditional on the API-011 flag, although the API-010 packet can be injected
  with API-011 disabled.
- Core prepared API-010 slices without a post-recall erasure check before the
  Conversation Runtime's model/credential operation.
- `turn-runtime.js` set `shouldRecordInjection` false when any API-011 thread
  slice was trimmed, but still passed the composed context containing retained
  API-011 slices to the model.
- `line-memory-delivery.js` re-read the acknowledged inbound projection after
  policy evaluation but checked delivery state and message ID without checking
  its independent erasure status.

### Root Cause

The API-010 authorization was treated as sufficient for the full lifetime of an
asynchronous turn. The job snapshot is not a live erasure fence, and the API-011
kill switch was incorrectly reused as the only pre-model job-state check. The
mixed-context path also tied API-011 receipt execution to complete packet
retention, even though partial API-011 content could still be sent. The delivery
scanner's local source fence omitted the projection's independent erasure marker.

### Why the issue escaped detection

Earlier tests checked API-010 scope, consent, audience, and API-011-off
independence, but did not change the persisted job to an erased state between
recall and model generation. Mixed-context tests checked composer budgeting,
but did not force a partial API-011 packet and assert that receipt states still
surround provider invocation. Delivery tests covered the job-level PDPA fence,
not a stale projection whose erasure marker advanced independently.

### Proposed prevention

1. Add an API-010 liveness fence independent of API-011. Re-read the claimed job
   and account state and resolve current identity/consent/scope after recall and
   immediately before the provider call; reject erased, changed, or unavailable
   state before any model side effect.
2. Apply the same API-010 fence when Conversation Runtime requests its model
   credential, after Core prepared episodic slices.
3. Preserve the API-011 injection-receipt lifecycle whenever an API-011 memory
   packet is present, including mixed API-010/API-011 turns with budget-trimmed
   slices.
4. Add focused regression coverage for erasure between API-009 recall and model
   generation in both runtime cohorts, and for receipt states around a mixed,
   partially trimmed context.
5. Permit API-011 delivery only while the persisted inbound projection is still
   erasure-active after policy evaluation and immediately before the MSP call.

## Focused verification finding — 2026-10-04

### Symptom

The first focused rerun reported two failing tests: the Server race test expected
the whole answer to reject after an erasure fence, and the mixed-runtime test
returned `FAILED` after generation.

### Evidence

- `answerBusinessQuestion()` catches ordinary provider-generation errors and
  returns a deterministic answer from already-authorized business evidence.
  The Server fence runs before `model.generate()`, so the race test's rejection
  expectation did not match the established fallback contract.
- The mixed-runtime fixture calls `createHash()` while constructing the durable
  append receipt, but `turn-runtime.test.js` did not import it. The missing test
  import caused a `ReferenceError` after its model and injection-receipt checks.
- The first focused run passed 84 of 85 server integration tests and 73 of 74
  Conversation Runtime tests; these two mismatches account for the failures.

### Root Cause

The new race test asserted turn failure instead of asserting that the provider
was not called and that only the ordinary evidence fallback was returned. The
new mixed-runtime test fixture omitted its `node:crypto` import.

### Why the issue escaped detection

Both tests were added after the earlier full verification. The API-010 fence
introduces a path where generation is intentionally blocked and the existing
evidence fallback runs; the test did not account for that behavior. The new
receipt fixture's append callback was not exercised until the first focused
runtime run.

### Proposed prevention

Assert the security boundary directly: recall happens once, the current job is
re-read, the provider is not called after erasure, and the response contains no
episodic text. Keep the runtime test's SHA-256 fixture using an explicit
`node:crypto` import and rerun both focused suites before the full verification.

### Version diff

1.11 → 1.12: records API-010 concurrent-erasure, partial-injection-receipt and
erasure-pending delivery root causes discovered during final security review,
with independent liveness fences, complete receipt coverage and a projection
erasure-state check as prevention.
1.12 → 1.13: records the focused-test contract mismatch and missing test-fixture
import; changes the race assertion to verify no provider call after erasure.

## Conversation Runtime scope finding — 2026-10-04

### Symptom

The mixed API-010/API-011 regression test showed that API-010 episodic slices
were not present in the Conversation Runtime model context even on a verified
DIRECT turn.

### Evidence

- Core creates an API-010 slice with the explicit scope `CROSS_THREAD` and no
  current-thread ID; its authorization has already validated the Project,
  Workspace, identity, consent and DIRECT audience.
- `composeTurnContext()` treated every MSP slice without the active thread ID
  as `THREAD_SCOPE_MISMATCH`, including this explicitly cross-thread slice.
- The focused runtime fixture's provider context contained GKS and the
  thread-bound API-011 participant, but not the authorized API-010 episodic
  fact. The API-011 receipt lifecycle still ran around the provider call.

### Root Cause

The Runtime composer applied the API-011 thread-isolation predicate to all MSP
slices. API-010 episodic memory is explicitly cross-thread and is scoped by its
independent API-010 authorization plus DIRECT-audience gate, so requiring it to
carry the current thread ID incorrectly discarded it.

### Why the issue escaped detection

The previous Runtime integration test proved that GKS and API-010 shared a
budget but did not assert that an authorized API-010 slice survived composition
when the turn had an active thread ID. The Server composer already handled the
API-010 scope; the Runtime-specific composer test covered only thread mismatch.

### Proposed prevention

Treat only explicit `CROSS_THREAD` MSP slices as independent of the current
thread ID. Continue to deny `CROSS_THREAD` and passport slices to GROUP/ROOM
audiences, and continue to require exact thread matches for API-011 thread-bound
slices. Add direct-audience and non-DIRECT composer tests and assert the
authorized API-010 slice reaches the Runtime provider under the shared budget.

1.13 → 1.14: records that the Conversation Runtime composer incorrectly
classified authorized API-010 `CROSS_THREAD` slices as thread mismatches, and
specifies the DIRECT-only cross-thread composer rule.

## Final erasure-fence ordering gap — 2026-10-04

### Symptom

In either runtime cohort, erasure could commit after the final live-state check
but while required receipt persistence was still pending. The caller could then
enter model generation with API-010 episodic context from the stale job.

### Evidence

- `server-line-answer.js` awaited `assertLineEpisodicMemoryJobLive()` before
  awaiting `trace.recordContextReceipt()` in the model wrapper.
- `turn-runtime.js` awaited `ports.authority.resolve()` before
  `invokeWithInjectionReceipt()`. That wrapper performs asynchronous `RESOLVED`
  and `SUBMITTED` receipt writes before invoking the provider callback.
- Neither cohort revalidated live API-010 authority after the final awaited
  receipt write and immediately before `model.generate()`.

### Root Cause

Both model wrappers placed asynchronous receipt persistence after the API-010
liveness fence. Since those awaits yield control, erasure could commit in the
gap and the already-completed check could not detect it.

### Why the issue escaped detection

The first race regression changed job state after recall and before the live
check. It proved the check blocks stale context, but did not exercise a state
change during later asynchronous receipt writes in either cohort. Receipt
writers were treated as bookkeeping rather than scheduling boundaries.

### Proposed prevention

Persist each cohort's required pre-model receipt state before the final live
authorization check, then re-read and validate the claimed job, erasure,
identity, consent and scope inside the provider callback. Call the provider
directly after that check without another awaited operation. Add regressions
whose receipt writers commit erasure and assert that the provider is never
called and episodic text is absent from the reply.

1.14 → 1.15: records the Server ContextReceipt and Runtime injection-receipt
TOCTOU gap and requires receipt persistence to finish before the final live
authorization fence immediately preceding provider entry. No production state
was changed.

### Verification after correction

- Before the patch, a Server regression reproduced model invocation after the
  receipt writer changed the job to `CANCELLED/PDPA_ERASURE`; the Runtime
  regression reproduced a provider call when erasure landed during the
  `SUBMITTED` receipt write.
- After the patch, the Server grounding suite passed 21/21 tests; the Server
  Conversation Runtime memory and unverified suites passed 58/58; the Server
  thread-memory worker suite passed 34/34; the Conversation Runtime package
  passed 75/75.
- Conversation Runtime build passed for 11 source files; the Server Next.js
  production build compiled, type-checked and generated all 98 static pages.
- The immediately preceding full `npm run verify` passed 7,890 Server tests
  with 43 skipped and 208 E2E tests with 4 skipped. That full run preceded the
  receipt-ordering correction; the focused tests and builds above include it.
- Hosted CI, deployment evidence and production acceptance are not verified by
  these local results. Production remains gated by the signed API-010 contract
  not being on MSP main, consent-decline tombstoning, GKS withdrawal/correction,
  rollback acceptance and release evidence.

1.15 → 1.16: fixes the receipt-time TOCTOU in both runtime cohorts, moves the
final live authorization fence after pre-provider receipts, and records focused
post-fix tests and builds separately from the earlier full regression.
