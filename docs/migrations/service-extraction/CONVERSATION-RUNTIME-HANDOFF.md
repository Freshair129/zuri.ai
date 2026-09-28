---
id: ZAI:CONVERSATION-RUNTIME-HANDOFF
version: "0.3.18b"
status: candidate
last_update: "2026-09-28T12:00:00+07:00,Claude Opus 5.5 (MC0)"
attributes:
  domain: agent
  scope: conversation-runtime-extraction-checkpoint
relations:
  - type: relates_to
    target: ZAI:ADR-106
  - type: relates_to
    target: ZAI:SDD-110
  - type: relates_to
    target: ZAI:FR-149
  - type: relates_to
    target: ZAI:FR-171
---

# Conversation Runtime extraction handoff

**Checkpoint state:** accepted scope complete; **deployed to production, not cut over.** The independent Conversation Runtime process answers LINE turns for accounts opted into `runtimeOwner=CONVERSATION_RUNTIME`, through the authenticated Core façade and the Core-owned queue and receipts. `executionMode` remains `SERVER`; `LineOaAccount.runtimeOwner` defaults to `SERVER` and is snapshotted onto each job to pin the opted-in runtime cohort. The runtime service runs in production (image `zuri-conversation-runtime:release-e428d91c`, deployed 2026-09-28, readiness READY, smoke PASS), but **no LINE account is opted in**, so it serves no customer turn yet. The operator pre-deploy steps are done. What stays `SERVER` is a short list of fail-safe cases (see *Runtime cohort*). The owner ruled on MSP erasure on 2026-09-28 (option A: one tenant-wide MSP erase per erased person with memory-sync data, DIRECT included); branch `mc0/direct-msp-erasure` implements it (*Update 0.3.18b* below). Opting an account in (the cutover) and a full `npm run verify` with its E2E leg remain open. The state at `main` `e428d91c` plus the residual-gap PR (branch `mc0/cr-residual-gaps`) is in *Current state* below.

## Update 0.3.18b — owner decision on MSP erasure, branch `mc0/direct-msp-erasure`

Written by MC0 on branch `mc0/direct-msp-erasure`, cut from `main` at `f8f6dcd9` (the merge of PR #614). It amends *Current state — 0.3.17b* below only where it says so. Code statements were checked against this branch; nothing here was run against a production database.

**Owner decision (2026-09-28): option A.** Every person with memory-sync data gets exactly one tenant-wide MSP erase on erasure, including a person who only ever used DIRECT memory. This closes *What remains* item 2 of 0.3.17b and the residual gap "DIRECT MSP thread never erased".

What changed in Core (`line-memory-erasure.js`, `line-job-erasure.js`, `msp-thread-memory-port.js`):

- **One record per (tenant, erased principal, erasure request).** In the erasure transaction, `recordMemoryPrincipalErasure` writes one `MEMORY_THREAD_ERASURE_PENDING` when the person has **any** memory-sync job among the jobs being erased: DIRECT (theirs by selection), GROUP or ROOM (theirs by speaker). Its turn id is derived from the tenant, the principal and the ids of those jobs, so a replayed transaction writes the same record, and a later erasure of the same person covering newer turns gets its own record instead of meeting a closed one. Its trace scope is the lowest `businessId` among those jobs; the erase itself is tenant-wide. The payload is `{ scope: 'TENANT_PRINCIPAL', principalId, audiences, idempotencyKey: 'msp-principal-erasure:<turnId>' }` and names no group, room or channel account (so the residual gap *Pending record holds identifiers* now covers the principal id only). The five `MEMORY_THREAD_ERASURE_*` kind names are kept (existing records, restore gating).
- **No thread is resolved.** `msp_thread_principal_erase` takes a principal and a key; its grant needs the tenant, the acting principal, `policyRevision` and the data-subject claims, and no room (MSP `thread-guard.mjs` lists it as not thread-bound). The port gains `erasePrincipalInTenant({ tenantId, principalId, idempotencyKey, authorization })`, which signs `{ tenantId, businessId: null, principalId: 'zuri-core-pdpa-erasure', readPrivate: false, writePrivate: false, dataSubjectAccess: true, dataSubjectAdmin: true }` and refuses an authority without those claims or for another tenant. `resolveThread` is no longer called, so an erasure can never mint a thread. The scanner requires `erasePrincipalInTenant` on the port.
- **Unchanged:** the 5.5-minute grace, the 60 s claim, the backoff (1 min to 24 h), `FAILED` after 8 attempts with one alert naming no principal, redaction of the record on acknowledgement, restore gating by kind, and the Core data-subject grant (`read: false`, `writePrivate: false`).
- **Records written before this branch** (one per shared GROUP/ROOM thread, payload with a `route`) drain through the same tenant-wide call under their own stored key (`msp-thread-erasure:<turnId>`). The first acknowledged erases the person tenant-wide; later ones find nothing left and are acknowledged too. Nothing migrates them; there are probably none in production.
- **Scanner paging (#614 review, LOW).** Keyset instead of `OFFSET`: each page is `(occurredAt, id) > ` the cursor row's own values, read in SQL (no timestamp is bound from JavaScript). The scan resumes after where the previous tick stopped and wraps to the oldest record once, so a due record is reached within a bounded delay (about one tick per 1,000 open records ahead of it, plus one per full batch of due ones) however many records are held before it. The page loop ends early only at a record still inside the grace window, never on a candidate/page length mismatch.
- **Index (#614 review, LOW).** `AgentTraceEvent (kind, occurredAt, id)` serves the page.

**Migrations (operator only, not applied anywhere):** `apps/server/supabase/migrations/20260928090000_agent_trace_event_erasure_scan_index.sql`, on its own: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "AgentTraceEvent_kind_occurredAt_id_idx"`, no transaction block; an interrupted build leaves an INVALID index to drop and re-run. Its SQLite twin is `apps/server/prisma/migrations/20260928090000_agent_trace_event_erasure_scan_index/migration.sql`. Apply before deploying this branch's Core; the scanner is correct without the index, only slower.

Tests: `conversation-runtime-memory-group-gks.test.js` (the MSP stand-in now follows the tenant-wide contract and its guard: data-subject claims, principal defaulting, replay, key conflict; a DIRECT-only person gets exactly one erase, which tombstones their DIRECT lines and keeps the replies; a person in DIRECT and two groups gets exactly one, and a lost acknowledgement replays under the same key; old-shape records drain with no thread resolved), `line-memory-erasure-due-query.test.js` on SQLite and PostgreSQL (a full page of held records does not end the scan and a record in grace does; a due record behind 1,050 held records is reached on the next tick with every read bounded), `agent-msp-thread-memory.test.js` (the port's tenant grant).

Still open, not changed here:

- **MSP keeps `AGENT` replies and shared-thread summaries** after the erase, including replies that quote the erased person. That is an MSP contract question, not a Core one.
- A person with memory-sync data but no job row left to find it (data from before #604, a principal from before a merge or relink, MSP writes through `handleAgentTurn` with no job) still gets no MSP call; see *Memory-erasure thread discovery*.

## Current state — 0.3.17b, base `main` `e428d91c` plus branch `mc0/cr-residual-gaps`

Written by MC0 on branch `mc0/cr-residual-gaps`, cut from `main` at `e428d91c` (the merge of PR #613). It supersedes *Checkpoint 0.3.16b* below, which stays accurate for the runtime path except where this section says otherwise. Code statements were checked against this branch; production statements are the operator's report of 2026-09-28, not something this branch or CI observed.

### Merged since `c91db083`

Only one merged change touches the runtime path's code: the answer check in `line-answer-policy.js` (#606, #608), mirrored byte for byte (the mirror is identical at `e428d91c`). The rest is documentation, CRM erasure outside the runtime path, other services, CI or deployment.

| PR | What | Runtime path | Head | On `main` as |
|---|---|---|---|---|
| [#607](https://github.com/Freshair129/zuri.ai/pull/607) | Handoff 0.3.16b | no (docs) | `2b3c3a74` | merge `4752b925` |
| [#606](https://github.com/Freshair129/zuri.ai/pull/606) | Numeral gaps in the grounded-answer check (mirrored) | yes (both cohorts) | `9cec8f6b` | merge `0b75c7df` |
| [#603](https://github.com/Freshair129/zuri.ai/pull/603) | Per-speaker chat-archive keys; postback and raw LINE payloads blanked on group erasure (FR-022) | no (CRM erasure) | `ecaa0e40` | merge `9c6a8ce2` |
| [#608](https://github.com/Freshair129/zuri.ai/pull/608) | Answer-check follow-ups from the #606 re-review (mirrored) | yes (both cohorts) | `70265c0a` | merge `f234db85` |
| [#612](https://github.com/Freshair129/zuri.ai/pull/612) | CRM retention follow-ups (blocked-erasure alert, settle failures, a backup-test flake) | no | `82fd3207` | merge `05f3567d` |
| [#613](https://github.com/Freshair129/zuri.ai/pull/613) | KI17 release overlay pinning the production tuple | no (deployment) | `e43269a4` | merge `e428d91c` |

(#546, #594, #605, #609, #610 and #611 also merged in that range; none touches the runtime path.)

### Production state (operator, 2026-09-28)

The operator pre-deploy list of 0.3.16b is **done**:

1. #596's three migrations are applied: the `Message.authorChannelIdentityId` column is present, the concurrently built index is valid, and the backfill attributed 298 of 298 inbound messages.
2. The `RETENTION_TOMBSTONE` query returned 0 rows, so no erased turn was left with readable trace rows by a runtime-written tombstone.
3. The deployed MSP (pin `68e6169dbb371dac2f0debf0bf731b553f7dc26d`, shipped in the web image) has `msp_thread_principal_erase`, and its identity HMAC key is configured, which that tool requires on every call.

The runtime service was deployed on 2026-09-28 (`zuri-conversation-runtime:release-e428d91c`): readiness READY, the KI17 smoke PASS. **No LINE account has `runtimeOwner=CONVERSATION_RUNTIME`**, so every job is still admitted to `SERVER` and the runtime claims nothing. The runtime image predates this branch; see *Deploy order* below.

### Residual gaps closed by this branch

| Gap (0.3.16b) | Fix | Tests |
|---|---|---|
| Erasure scanner held-set query | `reconcileLineMemoryErasures` picks due records with bounded queries (`dueErasureRecords`): a page of open PENDING records (at most 100) is read with an anti-join that drops records with a `FAILED` row, then grace, the 60 s claim window and `DEFERRED` scheduling are checked only for that page's turns. At most 10 pages per tick. The anti-join compares no timestamps, so it reads the same on SQLite and PostgreSQL. Semantics unchanged. A change to `line-memory-erasure` now also triggers the PostgreSQL CI step. | `line-memory-erasure-due-query.test.js` (grace, claim window, schedule, FAILED; more FAILED records than a page), on SQLite and PostgreSQL; a group/GKS case asserting no `notIn` and every `in` list bounded by the page |
| Erasure kinds not in restore gating | `backup-service` counts the five `MEMORY_THREAD_ERASURE_*` kinds (taken from `MEMORY_ERASURE_KINDS`) with the delivery kinds, so a snapshot without the memory manifest cannot replace an installation holding an erasure record. | `line-server-backup.test.js`: accepted with no record, refused with one |
| No group parity test for unverified memory | New group/GKS cases with an unlinked speaker and a speaker whose LINE identity is PENDING: GROUP and ROOM next to a verified speaker, DIRECT under `GKS_CORPUS` and `GKS_THEN_BUSINESS_KNOWLEDGE`, GROUP under `GKS_CORPUS`. Each compares MSP calls and claims, provider requests and deliveries with the legacy tick, and checks PENDING appends, no recall, the admission record and a PENDING read receipt. | `conversation-runtime-memory-group-gks.test.js` (5 cases) |
| `REPLY_DEADLINE_MISSED` pre-check | Core's WorkTool refuses `read`, `propose` and `confirm-execute` with `REPLY_DEADLINE_MISSED` (409, final) once the answer deadline has passed, before any Work reader or writer, as the legacy worker's `executeClaimed` does. `status` stays open for recovery. The deadline comes from `executionAnswerDeadline`, which settle now uses too. The runtime then fails the turn with that code, which is the job's `errorCode`, as on the Server path. | WorkToolPort suite: a spent-budget propose writes no proposal; a full turn whose budget runs out before the Work call ends `FAILED` / `REPLY_DEADLINE_MISSED` and sends nothing |
| Core `validateResult` receipt strictness | The v1 Work receipt rules live in one pure module, `apps/server/src/modules/line-oa-studio/domain/work-tool-receipt.js`, mirrored byte for byte to `services/conversation-runtime/src/work-tool-receipt.js` (the `line-answer-policy.js` convention). Core checks its own response with it against the request sent; the runtime client checks the same response with it. `WORK_REJECTION_CODES` and the 5,000-character bound are defined once. | WorkToolPort suite: drift test; a Work reader whose 2-key receipt names another source (inside the old 12-key bound) is refused by Core with `CONTRACT_RESPONSE_INVALID`; per-operation shape checks |
| Silent evidence trimming | Core appends one `EVIDENCE_TRIMMED` trace when `fitPreparedTurn` or `memory read` drops records: `{ phase, recordsBefore, recordsKept, recordsDropped }`, counts only. The kind is Core-only (not in `RUNTIME_TRACE_KINDS`); the write is best effort and never fails the turn. | legacy-parity (prepare) and group/GKS (memory read) suites assert the one trace and no content |
| MSP erase scope unverified | Checked against the MSP code at the deployed pin (below). The test stand-in now follows that contract. | group/GKS erasure cases |
| ADR-106 amendment wording | ADR-106 1.2.1: the eligibility sentence names the one remaining exception (malformed `/work` in GROUP/ROOM stays `SERVER`). Wording only. | n/a |

### What `msp_thread_principal_erase` does (MSP pin `68e6169d`)

Read from `packages/msp-core/src/domain/thread-memory.mjs` (`erasePrincipal`), the tool handler and guard in `apps/msp-server`, and `docs/API-011-THREAD-MEMORY-CONTRACT.md` at the pin:

- **Not thread-bound.** The call names a principal and an idempotency key; no thread. It covers every thread of the grant's tenant the principal ever spoke in. Core's per-(person, room) record is the trigger, not the scope: the first acknowledged call erases the person tenant-wide, and later calls for the same person find nothing left.
- **Messages:** the principal's own `HUMAN` messages are tombstoned (text blanked, row kept) in every thread. **Replies are not erased:** `AGENT` messages stay, including replies to the erased person's questions.
- **Summaries and delivery receipts:** tombstoned only in threads where the principal is the sole human participant (a DIRECT-like thread). Shared group or room summaries are kept.
- **Participants:** every open participant row of the principal is closed (`left_at` set), in every thread.
- **Protected memory records** asserted by or about the principal are tombstoned. Vaults are untouched unless `erase_vault` is set; Core does not set it.
- **Idempotent** by (tenant, idempotency key); a replay changes no content and returns the stored counts. Every call needs the identity HMAC key (configured in production).

Consequences for Core, all recorded, none changed in Core's behaviour:

- **A person who spoke in a group with memory sync loses their DIRECT human lines too**, through the same tenant-wide call, even though Core sends no call for a DIRECT thread. A person who only ever used DIRECT memory gets no MSP call at all. This sharpens the pending owner decision below. *(Superseded by 0.3.18b: every person with memory-sync data now gets one tenant-wide call.)*
- **Replies that quote the erased person stay in MSP**, in groups and in DIRECT threads, and a group's summaries keep whatever they already summarised.
- Core's port already sends the right input (principal and key, the thread only in the signed claims). The test stand-in used to remove whole exchanges from one thread; it now tombstones the principal's human messages tenant-wide and keeps replies, and the erasure tests assert that.

### What remains

1. **Cutover: opt an account in.** Gate PRODUCTION. Setting `runtimeOwner=CONVERSATION_RUNTIME` on a LINE account (through `CONFIGURE_EXECUTION`, which needs the account's jobs quiescent) is the first moment the runtime serves customers. **Deploy order:** this branch changes the Core ↔ runtime contract in two compatible ways (a new final `REPLY_DEADLINE_MISSED` refusal on `work-tool`, which the deployed runtime already handles as a non-retryable error; and Core refusing an inexact Work receipt, which the deployed runtime already refuses). The runtime at `release-e428d91c` does not carry the shared receipt module, but its own validator applies the same rules, so no redeploy of the runtime is needed for this branch; Core (web image) does need it. Opt-in of a first account is an owner decision.
2. **Owner decision: DIRECT MSP thread erasure.** *(Decided 2026-09-28, option (b) below; implemented in 0.3.18b.)* Unchanged in Core at 0.3.17b: a DIRECT memory thread gets no MSP erase call. Given the tenant-wide MSP contract above, the practical choices are (a) keep it (a DIRECT-only person's MSP lines stay; a group speaker's DIRECT lines are erased as a side effect), (b) also record an erasure for DIRECT memory threads, so every memory-sync person gets exactly one tenant-wide MSP erase, or (c) ask MSP for a thread-bound erase. Separately: whether replies (`AGENT` messages) that quote an erased person should be erased is an MSP contract question.
3. **Full `npm run verify` with its E2E leg.** Not run for this branch (only the related suites listed in the PR).

Residual gaps still open (from 0.3.16b, unchanged by this branch):

| Gap | Current behaviour | Source |
|---|---|---|
| Memory-erasure thread discovery | Shared threads to erase are found only from job rows not already erased and the person's current `personId`. With the tenant-wide MSP erase, one surviving record for the person is enough to erase all their human lines; a person with no discoverable shared-thread job gets no MSP call. | #604 review, follow-up 4 |
| Pending record holds identifiers | A pending record keeps the principal id and room id until MSP acknowledges; a `FAILED` one keeps them for manual erasure. Accepted in review. | #604 follow-up 8 |
| Replies and shared summaries survive erasure in MSP | See the MSP contract above. | this version |
| Out-of-hours delivery availability | A runtime-cohort out-of-hours reply is sent only if the runtime is up; otherwise the job expires after the 30-minute TTL with no reply. | #583 |
| Group threads split between executors | In one group, malformed-`/work` turns go to `SERVER` and everything else to the runtime; replies can arrive out of order across the two consumers. | #585, #604 |
| Deploy order: runtime before Core | Core has no contract-version gate; see 0.3.16b for the W9/W10/W12 cases. Moot for the deployed runtime (`release-e428d91c` postdates W12). | #591 (F2) |
| `P2034` surfaced as a Prisma code | A lost serialization race on `confirm-execute` answers 503 `retryable: true` with the code `P2034`. | #586 |
| MSP scanners in the Server tick | Runtime jobs' MSP delivery receipts and all group-memory erasures go through the Server worker tick, which must keep running with MSP configured. | #588, #604 |
| ADR-106 D2 Knowledge half | There is no v1 Knowledge (GKS) operation; GKS stays inside Core `prepare` and Core `memory read`. | #584, #588, #604 |

Closed since 0.3.16b by merged PRs (taken from their titles and the files they change; not re-reviewed here): raw LINE payloads and the chat evidence archive on group erasure (#603), and the answer-check numeral gaps (#606, #608).

Upkeep notes (additions): `work-tool-receipt.js` is edited in `apps/server` and copied unchanged over `services/conversation-runtime/src/work-tool-receipt.js`; the WorkToolPort suite fails on any drift. `EVIDENCE_TRIMMED` is a Core trace kind; do not add it to `RUNTIME_TRACE_KINDS`.

## Checkpoint 0.3.16b — base `main` `c91db083` (superseded by *Current state*)

Written by MC0 on branch `mc0/cr-handoff-final`, cut from `main` at `c91db083cdcf5f70e119d78138b408583d31ea9a` (the merge of PR #604). Every statement in this section was checked against the code at that SHA, not copied from a PR body. Where a PR body and the code disagree, this section follows the code (see the note under *Base and PRs*). It supersedes the *Checkpoint 0.3.15b* section below.

### Base and PRs

Merged before `cc44ab86` (0.3.15b; unchanged):

| PR | Workstream | Head | On `main` as |
|---|---|---|---|
| [#542](https://github.com/Freshair129/zuri.ai/pull/542) | Runtime service, durable vertical slice | `b21a3552` | merge `4b6d8eb7` |
| [#581](https://github.com/Freshair129/zuri.ai/pull/581) | WorkToolPort against the real Core provider (SQLite), handoff 0.3.14b | `552c512f` | merge `9e5b104e` |
| [#586](https://github.com/Freshair129/zuri.ai/pull/586) | W6: WorkToolPort on PostgreSQL 17 | `7116cf6a` | merge `b96aec1d` |
| [#592](https://github.com/Freshair129/zuri.ai/pull/592) | Integration of W1–W5 and W7–W9 (#583–#585, #587–#591) | `c0aa58fa` | merge `cc44ab86` |

Merged between `cc44ab86` and `c91db083` (first-parent order on `main`):

| PR | What | Touches the runtime path | Head | On `main` as |
|---|---|---|---|---|
| [#598](https://github.com/Freshair129/zuri.ai/pull/598) | Handoff 0.3.15b | no (docs) | `1b7db14d` | merge `ca5ad77a` |
| [#597](https://github.com/Freshair129/zuri.ai/pull/597) | W10: unverified LINE senders in the runtime cohort; ADR-106 amendment 1.1.0, SDD-110, FR-265 | yes | `5ab32406` | merge `39e7de2b` |
| [#593](https://github.com/Freshair129/zuri.ai/pull/593) | Answer check over every Unicode digit script (`line-answer-policy.js`, mirrored) | yes (both cohorts) | `f3d3fe98` | merge `0c1dbc37` |
| [#596](https://github.com/Freshair129/zuri.ai/pull/596) | PDPA erasure follows every speaker of a LINE group or room thread; `Message.authorChannelIdentityId` with 3 migrations | yes (erasure of both cohorts' jobs) | `61c76e5d` | merge `e7afa528` |
| [#599](https://github.com/Freshair129/zuri.ai/pull/599) | Work-list Business scope, file content headers, asset manage capability | no | `3e93b1dc` | merge `e2d3d753` |
| [#601](https://github.com/Freshair129/zuri.ai/pull/601) | FR-277 LINE grounding shadow-compare harness | Server path only (see *Deliberate differences*) | `256f8e4e` | merge `92078bc9` |
| [#602](https://github.com/Freshair129/zuri.ai/pull/602) | Thousands separators in the answer check (mirrored); lenient embedded-Postgres cleanup (`EBUSY`) | yes (both cohorts) | `6dbfa2c2` | merge `d8d4058c` |
| [#600](https://github.com/Freshair129/zuri.ai/pull/600) | W11: unverified senders' memory-sync turns in the runtime (PENDING mode); ADR-106 1.2.0, SDD-110 | yes | `b8e5b399` | merge `fdb28c1b` |
| [#604](https://github.com/Freshair129/zuri.ai/pull/604) | W12: GROUP/ROOM memory turns, memory with GKS composition (FR-235), per-speaker MSP group-memory erasure | yes | `223af975` | merge `c91db083` |

#595 (a TASK-ZAI-095 grounding-switch preflight script and runbook, merge `9616221d`) also landed after `cc44ab86`; it does not touch the runtime. #604's head `223af975` already contained `main` with #600, and its tree is identical to `c91db083`, so #604's PR-head CI ran the exact tree on `main`. #604's body says that an unverified sender's memory turn "stays SERVER (W11)"; that was written before #600 merged. At `c91db083` those turns are admitted to the runtime in every audience and grounding mode (see *Runtime cohort*).

Open, not on `main` (not counted anywhere in this section as done):

| PR | What | Head |
|---|---|---|
| [#603](https://github.com/Freshair129/zuri.ai/pull/603) | Per-speaker keys in the chat evidence archive; postback and raw LINE message payloads blanked on group erasure (FR-022) | `7a0f1b4a` |
| [#606](https://github.com/Freshair129/zuri.ai/pull/606) | Numeral gaps in the grounded-answer check | `fe7d319a` |

### What gate `CR_TO_WM` requires, at `c91db083`

The gate is Gate CR in `REFACTOR-STATUS.md` §4: "CR acceptance ครบ, WorkToolPort ทดสอบจริง, review+required checks ผ่าน, merge เข้า base และ handoff ตรง SHA".

| Gate item | State at `c91db083` |
|---|---|
| `merged_into_base` | **Done.** #542 → `4b6d8eb7`, #581 → `9e5b104e`, #586 → `b96aec1d`, #592 → `cc44ab86`, #597 → `39e7de2b`, #593 → `0c1dbc37`, #596 → `e7afa528`, #602 → `d8d4058c`, #600 → `fdb28c1b`, #604 → `c91db083`. |
| `required_checks` | **Done at the PR head; `main`'s push run pending.** #604 at PR head `223af975` (tree identical to `c91db083`): governance run `36324329014`, with `changes`, `conversation-runtime`, `market-intelligence`, `build`, `govern`, `tests (1/4)`–`(4/4)` and `verify` green and `e2e` skipped by its path filter; Edge CI run `36324329049` (`edge-verify` green, `desktop` skipped). In run `36324329014` the four Server shards passed 833 files (5 skipped) and 7,465 tests (43 skipped); the step "WorkToolPort on PostgreSQL" in `tests (1/4)` (job `108634370608`) passed 19/19; the `conversation-runtime` job (`108634052267`) passed 73/73 runtime tests and recorded `HOSTED_IMAGE_BUILD=PASS`. `main` at `c91db083` (push): governance run `36324888801`, Edge CI `36324888794` and docker-image `36324888798` were in progress at the one lookup made for this version; their results are not recorded here. The earlier evidence (#542 run `36277269502`; #592 runs `36317164514` and `36317831755`) is in *Checkpoint 0.3.15b*. |
| `reviewed_contracts` | **Done**, as recorded in 0.3.15b (#581, #586, #592). W10–W12 changed the `resolve` and `memory` result shapes on both sides of the wire (`identityState`; `memory.result.evidence`, 60 KiB bound); Core's `validateResult` and the runtime's `validateOperationResult` accept the same shapes at `c91db083`. The PostgreSQL WorkToolPort step ran green at #604's head (job `108634370608`, 19/19); on `main` at `c91db083` it is part of the pending push run `36324888801`. The reviews of #597, #600 and #604 were independent agent reviews recorded in their PR bodies (#604: PASS_WITH_FINDINGS, findings answered in the PR); there are no GitHub review objects on them. |
| `accepted_scope_complete` | **Done, per the code at `c91db083`.** In `admitLineTextMessage` (`line-conversation-jobs.js`): `memoryRuntimeEligible = true` (no DIRECT or grounding-mode condition on memory turns any more, W12); `runtimeOwner = runtimeEligible ? 'CONVERSATION_RUNTIME' : 'SERVER'`, with no sender-verification condition (W10), and an unverified sender's job gets a `CHANNEL_IDENTITY_ADMITTED` record in the same transaction; eligibility is an opted-in account, a DIRECT/GROUP/ROOM audience whose thread id is present and matches the event, malformed `/work` only in DIRECT, and `conversationRuntimeServesGroundingMode`. Core serves those turns: `runtimeSenderAuthority` in every fence, the PENDING memory mode in `conversation-runtime-memory.js` (W11), `memoryRoute` for GROUP/ROOM threads, and the GKS read composed with the thread in Core `memory read` (W12). Every accepted-scope row below is done. What stays `SERVER` is listed under *Kept on `SERVER`*; none of it is an accepted-scope flow. |
| `matching_handoff` | **This version (0.3.16b) matches `c91db083`.** The PR that carries it changes documentation and generated files only, so it has to be re-read against its merge SHA only for code that lands after `c91db083` (for example #603 or #606). |

### Runtime cohort and trust model at `c91db083`

**Admitted to the runtime** (admission in `line-conversation-jobs.js`; the cohort is chosen per message and never changes after admission). A text turn goes to `CONVERSATION_RUNTIME` when the account is opted in and:

- the audience is DIRECT, GROUP or ROOM (`RUNTIME_AUDIENCES`), and for a group or room the thread id is present and differs from the speaker (#585);
- the speaker is verified **or unverified** (#597). An unverified speaker's job carries Core's `CHANNEL_IDENTITY_ADMITTED` record (`identityAssurance: 'UNVERIFIED'`, the sender id's SHA-256 and the CRM `principalId` admission resolved), written in the job's admission transaction;
- out-of-hours turns are included; Core decides at admission and snapshots the reply as `answerText` (#583);
- malformed legacy `/work` syntax is included in DIRECT; Core `prepare` answers it with the legacy usage text as `workReply` (#587);
- memory-sync opt-in turns are included in every audience and every served grounding mode, from verified and unverified speakers (#588, #600, #604);
- all three grounding modes are served (`BUSINESS_KNOWLEDGE`, `GKS_CORPUS`, `GKS_THEN_BUSINESS_KNOWLEDGE`) (#584);
- `#sku` from an Inventory-authorised verified sender in DIRECT is answered by Core's catalogue command with no model (#591); for anyone else, including every unverified sender, it is an ordinary question, as on the Server path (#597).

**Kept on `SERVER`:** malformed `/work` syntax in GROUP/ROOM (the legacy consumer answers it), group or room events without their thread id, an unrecognised stored grounding mode, and every account not opted in.

**What Core pins or fences.** The runtime never names a recipient, an audience, a model reference, a speaker, a thread or an identity state, and Core does not take its word for any turn decision. The 0.3.15b list still holds (`runtimeAudienceBound`, the Core-only memory receipt namespace, `RUNTIME_TRACE_KINDS`, the catalogue reply pin, the out-of-hours snapshot, `WORK_COMMAND_MISMATCH`, receipt replay scoped to the executing job, group and room Work refusals). Added at `c91db083`:

- **Sender authority from Core's records only (W10).** `runtimeSenderAuthority(db, job)` replaces the direct `channelIdentityIsVerified` checks at claim, renew, settle, the send compare-and-set, `sendRuntimeConversationJob` and `ownedClaim`. With no admission record, the live ChannelIdentity must be verified (the old fence). With a record, the job is authorized only if the record is well formed, has kind `CHANNEL_IDENTITY_ADMITTED` and turn id = job id, and `sha256(job.sourceUserId)` equals the recorded hash; the identity is never re-read, so a sender verified, revoked or erased mid-turn cannot change what the job may do, and an erased job fails through `PDPA_ERASURE` and the overwritten sender id. The record lives at `${jobId}:identity-admission`, outside the runtime's `<job>:runtime:…` keys, and `CHANNEL_IDENTITY_ADMITTED` is not in `RUNTIME_TRACE_KINDS`.
- **An unverified job has no person (W10).** `resolve` returns `identityId: null, identityVersion: null, identityState: 'UNVERIFIED'`; the runtime's `assertAuthority` accepts that shape only as a whole and ends the turn (`CONVERSATION_IDENTITY_CHANGED`) if the state changes between two resolves. Every Work call gets the legacy `WORK_IDENTITY_REQUIRED` refusal as a final `REJECTED` outcome before any Work reader or writer (`status` answers `NOT_FOUND`; a request that differs from the signed inbound text is still `WORK_COMMAND_MISMATCH`). The catalogue decision is `ORDINARY` without calling the catalogue command.
- **PENDING memory mode bound to the admitted principal (W11).** Only Core's `memoryClaim` marks a job `senderIdentityState: 'UNVERIFIED'` (from the admission record); `memoryServerScope` turns it into `identityState: 'UNVERIFIED'`, and the v1 `memory` request has no field that can set it. In that mode the context assembler's and the authorization resolver's principal must equal the record's `principalId`, with `verified: false` and no private memory, or the operation fails `LINE_MEMORY_SCOPE_MISMATCH` before any MSP append; the read also fails closed if MSP or the authorization returns private memory, an injected packet or a verified identity. The read receipt records `identityAssurance: 'PENDING'`, and a replay or append under the other mode is refused.
- **Out-of-hours turns never touch memory (W11 review).** `memoryTurn` refuses every memory operation (`read`, `append`, `receipt`) for a job with an out-of-hours snapshot (`MEMORY_NOT_APPLICABLE`), verified or not. Settle skips the memory-append check for an out-of-hours turn only while it has no memory read receipt; once a read receipt exists, READY commits only with its append.
- **Group and room memory scope (W12).** `memoryRoute(job)` takes the thread from the persisted job and its inbound Conversation only: one MSP thread per group or room (`externalRoomRef` = the group or room id), speaker-labelled from the job; the shared-audience scope carries `writePrivate: false` and no private recall. `runtimeAudienceBound` still applies on every memory operation through `ownedClaim`.
- **Memory with GKS composition in Core (W12, FR-235).** For a memory turn under `GKS_CORPUS` or `GKS_THEN_BUSINESS_KNOWLEDGE`, `prepare` reads no knowledge; Core `memory read` runs the MSP phases, then the same grounding read as `prepare` (`createCoreGroundingQuery`, with W2's budget clamp now also counting the time the operation has spent), and composes it with the thread in one `composeLineMemoryPacket` call. Core returns the composer-included records as `result.evidence` (at most 64 records and 32 KiB; evidence plus packet at most 56 KiB), stores them on the read receipt for replay, and records a ContextReceipt only when composed knowledge survived. The runtime answers from that evidence.
- **Per-speaker MSP group-memory erasure (W12, after #596).** In the erasure transaction, `redactLineConversationJobs` records one `MEMORY_THREAD_ERASURE_PENDING` per (erased person, shared GROUP/ROOM thread with a memory-sync job of theirs), before the jobs are overwritten; nothing is sent to MSP inside the transaction. `reconcileLineMemoryErasures` runs in the Server worker tick (only when the MSP port is configured and exposes `erasePrincipal`/`resolveThread`; a failed sweep never fails the tick). It selects only due records: a 5.5-minute grace (`MEMORY_ERASURE_GRACE_MS`, the 5-minute lease plus 30 s) before the first attempt, none with an attempt claimed in the last 60 s, none with a `DEFERRED` row scheduled later, none `FAILED`. Each attempt is claimed with a nonce'd `ATTEMPT` row, then `msp_thread_principal_erase` is called under the stable key `msp-thread-erasure:${turnId}` with a Core data-subject grant (`read: false`, `writePrivate: false`). On acknowledgement: `ACKNOWLEDGED`, then the record's trace is redacted. On failure: a `DEFERRED` row whose `occurredAt` is the next attempt time (backoff 1 min, 5 min, 15 min, 1 h, 6 h, 24 h, 24 h), and after 8 attempts `FAILED` plus one `line-memory-erasure.failed` alert naming no principal or room. A DIRECT thread gets no MSP call (unchanged).
- **Answer check (#593, #602).** Both cohorts' post-model check (`line-answer-policy.js`, byte-identical in `services/conversation-runtime/src/` at `c91db083`) normalises every Unicode decimal digit script and reads valid thousands grouping without its separators before the number and code checks.

**Deliberate differences from the Server path** (fail-closed or typed; each recorded in its PR). The 0.3.15b ones still hold (a speaker revoked or erased after admission is fenced; typed memory failure codes; the GKS hop clamp; Work `UNKNOWN` after a persisting failure). Added:

- An unverified sender verified between admission and claim keeps the unverified decision in the runtime (Work refused, no `#sku`, PENDING memory); the legacy worker reads the identity when its execution starts and would serve the now-verified sender (#597; ADR-106 amendment).
- In PENDING mode, a sender whose CRM principal changes mid-turn (a link to another Person) is refused `LINE_MEMORY_SCOPE_MISMATCH` before any append names that Person (#600 review).
- A corpus-mode memory turn inherits W2's budget clamp, which the legacy path does not apply; a read whose budget is spent on MSP calls fails 408 `CONTRACT_DEADLINE_EXPIRED`, as `prepare` does (#604, decision 4).
- `memory read` drops the lowest-ranked composed records until the result fits (#604 review, L6), as `fitPreparedTurn` does for `prepare`; nothing is traced when it does.
- The FR-277 shadow compare (#601) is started only inside the Server path's `createServerLineAnswer`, for accounts with `knowledgeGroundingShadow: true`. Runtime-cohort turns produce no shadow comparison.

**New stable identities and trace kinds** (in addition to 0.3.15b's): `${jobId}:identity-admission` (kind `CHANNEL_IDENTITY_ADMITTED`, Core-only, #597). Core's memory read receipt may carry `identityAssurance: 'PENDING'` (#600) and `evidenceJson` (#604). Group-memory erasure records use a deterministic synthetic turn id `memoryErasureTurnId(tenant, principal, channel account, room)` with keys `${turnId}:pending`, `:attempt:<n>`, `:deferred:<n>`, `:acknowledged` and `:failed`, and kinds `MEMORY_THREAD_ERASURE_PENDING`, `…_ATTEMPT`, `…_DEFERRED`, `…_ACKNOWLEDGED`, `…_FAILED` (#604). The runtime's own trace allowlist is unchanged.

### What remains

Accepted-scope rows:

| Item | State at `c91db083` | Closed by |
|---|---|---|
| Memory-sync opt-in turns | **Done** in DIRECT, GROUP and ROOM, under every served grounding mode, for verified and unverified speakers: v1 `memory` operation (`read`/`append`/`receipt`); Core is the only MSP caller. | #588, #600, #604 |
| Memory with GKS grounding (FR-235) | **Done.** Core `memory read` composes GKS evidence with the thread under one budget, as the legacy worker does. | #604 |
| Out-of-hours reply (FR-244) | **Done.** Core decides at admission and snapshots; the runtime sends the snapshot with no model and no memory operation. | #583, #600 |
| Group and room audiences | **Done**, for verified and unverified speakers, including memory turns. | #585, #597, #604 |
| Malformed legacy `/work…` syntax | **Done** in DIRECT (`workReply`). GROUP/ROOM stays `SERVER` by design. | #587 |
| WorkTool answer parity | **Done.** | #587 (exact runtime-side receipts: #586) |
| Knowledge grounding modes | **Done.** | #584, #604 |
| `#sku` catalogue command (FR-210) | **Done.** | #591, #597 |
| Post-model answer parity | **Done**, now including Unicode digit scripts and thousands separators, mirrored byte for byte. | #590, #593, #602 |
| Send contract | **Done.** | #589 |
| Length gap | **Done.** | #589 |
| Unverified identities | **Done.** Admitted with Core's `CHANNEL_IDENTITY_ADMITTED` record; no person, legacy Work refusal, no `#sku` command, PENDING memory. ADR-106 amendment (1.1.0, 1.2.0), SDD-110 and FR-265 carry the wording. | #597, #600 |
| Group erasure for later speakers (FR-022) | **Done** for messages, jobs, trace inputs and (W12) shared MSP thread memory: erasure follows `Message.authorChannelIdentityId` and each job's speaker, not the thread owner. The raw-payload and archive parts are in open #603 (below). | #596, #604 |

Operator pre-deploy list (**run by an operator only, never from CI or an agent**; none of it has been run against any database):

1. Apply #596's three migrations in order, each on its own: `20260927090000_message_author_channel_identity.sql` (column), `20260927090100_message_author_channel_identity_index.sql` (`CREATE INDEX CONCURRENTLY`, no transaction block; an interrupted build leaves an INVALID index to drop and re-run), then `20260927090200_message_author_channel_identity_backfill.sql`. Re-run the backfill until all three of its UPDATEs report 0 rows (each touches at most 5,000 rows). Erasure does not depend on the backfill finishing: it attributes a still-NULL row through its `MESSAGE_INGESTED` audit row at erase time.
2. Run the `RETENTION_TOMBSTONE` query below and act on its result.
3. Before relying on group-memory erasure, confirm that the deployed MSP ships `msp_thread_principal_erase` (TASK-MEMOS-004). Until it does, records stay PENDING and retry with backoff until they end `FAILED` with an alert (8 attempts over about 2.3 days).

Residual gaps recorded by the PRs and their reviews, still true at `c91db083`:

| Gap | Current behaviour | Source |
|---|---|---|
| Memory-erasure thread discovery | The shared threads to erase are found only from job rows not already erased and the person's current `personId`. Not covered: data from before #604 (no backfill), principals from before a merge or relink, and MSP writes made through `handleAgentTurn` with no job row. | #604 review, follow-up 4 |
| DIRECT MSP thread never erased | An erased person's DIRECT MSP thread gets no MSP erase call (unchanged behaviour; only the pending delivery receipt is closed). The same mechanism would cover it by dropping the shared-audience filter; that changes DIRECT behaviour and is an owner decision. | #604 follow-up 5, decision 2 |
| MSP erase scope unverified | Whether `msp_thread_principal_erase` removes replies, summaries and participants and stays within one thread has not been checked against the MSP contract. The test stand-in removes whole exchanges started by the principal. | #604 follow-up 7 |
| Pending record holds identifiers | A pending erasure record keeps the principal id and group or room id until MSP acknowledges; it is redacted on acknowledgement. A `FAILED` record keeps them for manual erasure. Accepted in review. | #604 follow-up 8 |
| Erasure scanner held-set query | Each tick reads, across all tenants and with no limit, every `FAILED` row plus every future-scheduled `DEFERRED` and recently claimed `ATTEMPT` row, and passes their turn ids to a `notIn` filter. `FAILED` rows are never removed, so this grows without bound. | code at `c91db083` (`line-memory-erasure.js`) |
| Erasure kinds not in restore gating | `backup-service` does not count the five `MEMORY_THREAD_ERASURE_*` kinds for restore gating. | #604 decision 5 |
| No group parity test for unverified memory | W11's PENDING wrappers apply to GROUP/ROOM and GKS memory turns, but `conversation-runtime-unverified-memory.test.js` has DIRECT cases only and #604's group/GKS suite has no PENDING case. | #604 note after #600 |
| Raw LINE payloads on erasure | LINE raw records are keyed by `webhookEventId`, which no message id or subject matches, so erasure does not blank the erased speaker's raw message or postback payloads for real LINE traffic, and the chat evidence archive seals a shared thread under the owner's key. Fix open in #603, not on `main`. | #596 review (HIGH), #603 |
| Answer-check numeral gaps | Numeral forms the grounded-answer check still misses (after #593 and #602). Fix open in #606, not on `main`. | #606 |
| ADR-106 amendment wording | The amendment's eligibility sentence still names "the existing memory-sync and malformed-Work exceptions"; after W12 only the malformed-Work (GROUP/ROOM) exception exists. Not edited here. | ADR-106 1.2.0 at `c91db083` |
| `REPLY_DEADLINE_MISSED` pre-check | Core's `work-tool` has no spent-budget check before a Work call; the runtime path checks the deadline only at settle. | code at `c91db083` |
| Out-of-hours delivery availability | A runtime-cohort out-of-hours reply is sent only if the runtime is up; otherwise the job expires after the 30-minute TTL with no reply. | #583 |
| Group threads split between executors | In one group, malformed-`/work` turns go to `SERVER` and everything else to the runtime; replies can arrive out of order across the two consumers. Each job still has one executor. (Unverified and memory turns no longer split a group.) | #585, #604 |
| Deploy order: runtime before Core | Core has no contract-version gate. A runtime older than W9 rejects a `CATALOG_COMMAND` turn after Core has applied a `#sku` confirm or cancel. A runtime older than W10 rejects an unverified job's `resolve` (extra `identityState` key), and one older than W12 rejects a corpus-mode `memory read` result (extra `evidence` key); both end those turns with no reply. Deploy the runtime first. | #591 (F2), code at `c91db083` |
| Core `validateResult` receipt strictness | Core still accepts any Work receipt of at most 12 keys and 32 KiB; only the runtime client checks the exact v1 receipt shape. | #586 |
| `P2034` surfaced as a Prisma code | A lost serialization race on `confirm-execute` answers 503 `retryable: true` with the code `P2034`. | #586 |
| MSP scanners in the Server tick | Runtime jobs' MSP delivery receipts and all group-memory erasures go through the Server worker tick (`scanMemory`: `reconcileLineMemoryErasures`, then `reconcileLineMemoryDeliveries`), which must keep running with MSP configured. | #588, #604 |
| ADR-106 D2 Knowledge half | There is no v1 Knowledge (GKS) operation; GKS stays inside Core `prepare` and Core `memory read`. | #584, #588, #604 |
| Silent evidence trimming | When `fitPreparedTurn` or `memory read` drops low-ranked evidence to fit, nothing is traced. | #589, #604 |
| `RETENTION_TOMBSTONE` operator check | Before #588 the runtime could write a `RETENTION_TOMBSTONE` through `trace`, and erasure then skipped that turn. Existing data needs the operator check below. Not run against any database. | #588 (b) |

`RETENTION_TOMBSTONE` operator query (Postgres; **run by an operator only, never from CI or an agent**):

```sql
SELECT "id", "tenantId", "businessId", "turnId", "idempotencyKey", "occurredAt"
FROM "AgentTraceEvent"
WHERE "kind" = 'RETENTION_TOMBSTONE'
  AND "idempotencyKey" <> 'retention:' || "turnId";
```

For each turn it returns, check whether the turn was erased (the job's `errorCode = 'PDPA_ERASURE'`) while its other trace rows still hold readable payloads. If so, run `redactTraceTurn` on the turn again; since #588 it no longer stops at the foreign row.

Upkeep notes: `line-answer-policy.js` is edited in `apps/server` and copied unchanged over `services/conversation-runtime/src/line-answer-policy.js`; `conversation-runtime-answer-parity.test.js` fails on any drift (#590). The PostgreSQL suite pins the prerelease `embedded-postgres@17.10.0-beta.17`; since #602 its teardown tolerates a Windows `EBUSY` on the temp directory.

Still open from *Cutover and rollback gates*, and not claimed by this version:

- a full `npm run verify` with its E2E leg (the hosted `e2e` job was skipped by its path filter on #604, as on #592);
- live LINE, MSP (including `msp_thread_principal_erase`), GKS and model runs, the operator steps above, production deployment and migration, which belong to Gate PRODUCTION.

## Checkpoint 0.3.15b — base `main` `cc44ab86` (superseded by *Current state*)

Kept as history. Its gate table and *What remains* tables describe the tree before #593–#604; the current ones are in *Current state* above.

Written by MC0 on branch `mc0/cr-handoff-0315`, cut from `main` at `cc44ab86452e8ff540f0b1d1472e07ae63829243` (the merge of PR #592). Every statement in this section was checked against the code at that SHA, not copied from a PR body. At the time, it superseded the *Checkpoint 0.3.14b* section below.

### Base and PRs at 0.3.15b

| PR | Workstream | Head | On `main` as |
|---|---|---|---|
| [#542](https://github.com/Freshair129/zuri.ai/pull/542) | Runtime service, durable vertical slice | `b21a3552` | merge `4b6d8eb7` |
| [#581](https://github.com/Freshair129/zuri.ai/pull/581) | WorkToolPort against the real Core provider (SQLite), handoff 0.3.14b | `552c512f` | merge `9e5b104e` |
| [#586](https://github.com/Freshair129/zuri.ai/pull/586) | W6: WorkToolPort on PostgreSQL 17, fencing/race cases, exact v1 receipts in the runtime client | `7116cf6a` | merge `b96aec1d` |
| [#592](https://github.com/Freshair129/zuri.ai/pull/592) | Integration of the eight PRs below, conflicts resolved once | `c0aa58fa` | merge `cc44ab86` |
| [#584](https://github.com/Freshair129/zuri.ai/pull/584) | W2: grounding-mode guard, GKS grounding in Core `prepare` | `7a6e8c23` | via #592 (integration merge `087153e7`) |
| [#587](https://github.com/Freshair129/zuri.ai/pull/587) | W1: Work command parity | `fd52a3ec` | via #592 (`6d53df14`) |
| [#583](https://github.com/Freshair129/zuri.ai/pull/583) | W3: out-of-hours replies | `aaa4036e` | via #592 (`a8814664`) |
| [#585](https://github.com/Freshair129/zuri.ai/pull/585) | W4: group and room audiences | `3cf3ff44` | via #592 (`e3ebeb63`) |
| [#590](https://github.com/Freshair129/zuri.ai/pull/590) | W8: post-model answer parity | `dc0fe3a2` | via #592 (`c9d89f83`) |
| [#589](https://github.com/Freshair129/zuri.ai/pull/589) | W7: send contract and message length | `941a874a` | via #592 (`7b445d98`) |
| [#591](https://github.com/Freshair129/zuri.ai/pull/591) | W9: `#sku` catalogue command | `4645d2b9` | via #592 (`fe0bec6b`) |
| [#588](https://github.com/Freshair129/zuri.ai/pull/588) | W5: memory-sync opt-in turns | `d0041a64` | via #592 (`c0aa58fa`) |

GitHub shows #583–#585 and #587–#591 as merged because each head is an ancestor of `cc44ab86`; their "merge commit" is the integration merge listed. The integration decisions are in #592's body and in each integration merge's commit message. #587's PR body repeats #588's W5 description by mistake; W1's content is in commits `f0ce195b` and `fd52a3ec`, and this document follows those.

### What gate `CR_TO_WM` required at 0.3.15b (superseded)

The gate is Gate CR in `REFACTOR-STATUS.md` §4: "CR acceptance ครบ, WorkToolPort ทดสอบจริง, review+required checks ผ่าน, merge เข้า base และ handoff ตรง SHA".

| Gate item | State at `cc44ab86` |
|---|---|
| `merged_into_base` | **Done.** #542 → `4b6d8eb7`, #581 → `9e5b104e`, #586 → `b96aec1d`, #592 → `cc44ab86` (bringing #583–#585 and #587–#591). |
| `required_checks` | **Done.** #542: governance run `36277269502` (see *Merged state*). #592 at PR head `c0aa58fa`: governance run `36317164514` (`changes`, `conversation-runtime`, `market-intelligence`, `build`, `govern`, `tests (1/4)`–`(4/4)`, `verify` green; `e2e` skipped by its path filter) and Edge CI run `36317164516` (`edge-verify` green, `desktop` skipped). `main` at `cc44ab86` (push): governance run `36317831755`, all jobs green (`e2e` skipped), Edge CI `36317831904` and docker-image `36317831901` green. In run `36317831755` the four Server shards passed 820 files (5 skipped) and 7,222 tests (43 skipped); the step "WorkToolPort on PostgreSQL" (job `108615854263`) passed 19/19; the `conversation-runtime` job (`108615788969`) passed 67/67 runtime tests, the build and boundary scan, the hosted image build and the disposable drain/stop smoke. |
| `reviewed_contracts` | **Done.** (1) #581 runs the Runtime's real WorkToolPort against the real Core provider on SQLite, with a request-contract parity check against the published schema and a drift check; its review listed the missing fencing and race cases. (2) #586 runs the same suite on an embedded PostgreSQL 17, adds those cases (claim fencing on `confirm-execute`, the post-write re-check, four concurrent confirms), and makes the runtime client accept only the exact v1 receipt for the request sent; its review follow-up is `7116cf6a`. The PostgreSQL step ran green on a hosted Windows runner at #586's final head, run `36303972909` (job `108576897228`). (3) After the W1 changes to receipts, #592 re-ran the combined suite: `npm run test:postgres` 19/19 locally, hosted in run `36317164514` (job `108614455875`), and again on `main` in run `36317831755` (job `108615854263`, 19/19). The reviews were independent agent reviews recorded in the PR bodies and commits; there are no GitHub review objects on #581, #586 or #592. The open Core-side receipt check is a row in *What remains*. |
| `accepted_scope_complete` | **Open, only because of W10.** The owner ruled on 2026-09-27 that unverified identities move to the runtime. That work is W10, PR [#597](https://github.com/Freshair129/zuri.ai/pull/597), open and not on `main`. Every other accepted-scope row below is done. |
| `matching_handoff` | **This version (0.3.15b) matches `cc44ab86`.** The PR that carries it changes documentation only, so it has to be re-read against that PR's merge SHA only for code that lands after `cc44ab86`. |

### Runtime cohort and trust model at `cc44ab86`

**Admitted to the runtime** (admission in `line-conversation-jobs.js`; the cohort is chosen per message and never changes after admission). A text turn goes to `CONVERSATION_RUNTIME` when the account is opted in and the **speaker's** channel identity is verified, and:

- the audience is DIRECT, GROUP or ROOM (`RUNTIME_AUDIENCES`), and for a group or room the thread id is present and differs from the speaker (#585);
- out-of-hours turns are included; Core decides at admission and snapshots the reply as `answerText` (#583);
- malformed legacy `/work` syntax is included in DIRECT; Core `prepare` answers it with the legacy usage text as `workReply` (#587);
- memory-sync opt-in turns are included only in DIRECT on `BUSINESS_KNOWLEDGE` grounding, through the v1 `memory` operation (#588);
- all three grounding modes are served (`BUSINESS_KNOWLEDGE`, `GKS_CORPUS`, `GKS_THEN_BUSINESS_KNOWLEDGE`); an unrecognised stored mode stays `SERVER` (#584);
- `#sku` from an Inventory-authorised verified sender in DIRECT is answered by Core's catalogue command with no model (#591); for anyone else it is an ordinary question, as on the Server path.

**Kept on `SERVER`:** unverified speakers (until W10), memory turns in GROUP/ROOM or under a GKS mode, malformed `/work` in GROUP/ROOM, group or room events without their thread id, and every account not opted in.

**What Core pins or fences.** The runtime never names a recipient, an audience or a model reference, and Core does not take its word for any turn decision:

- **`runtimeAudienceBound(job)`**: the reply target must be the inbound Conversation's `externalThreadId` on the same channel account; a DIRECT reply goes to the speaker, a GROUP/ROOM reply to the thread and never to the speaker. It is checked at claim, in `ownedClaim` (every operation), at settle, in the send compare-and-set and in `sendRuntimeConversationJob`. It replaced the DIRECT-only checks (#585, #592).
- **Core-only memory receipt namespace**: memory read/append/injection receipts live under `${jobId}:core-memory:…` (`runtime-memory-receipts.js`), which the runtime's `trace` cannot write. A memory answer commits only if Core appended exactly that text (`MEMORY_APPEND_REQUIRED` / `MEMORY_APPEND_CONFLICT`), and the injection grant is signed `writePrivate: false` with the principal from Core's own authorization (#588).
- **Trace kind allowlist** (`RUNTIME_TRACE_KINDS`): the runtime may write only `MODEL_STARTED`, `MODEL_COMPLETED`, `MODEL_FAILED`, `EXECUTION_FAILED` and `CONTEXT_COMMITTED`, each under its one operation id and with one strict payload shape. Anything else is `TRACE_KIND_NOT_PERMITTED`, `TRACE_OPERATION_ID_INVALID` or `TRACE_PAYLOAD_INVALID`. `ANSWER_READY` is written only by Core's settle. Only a tombstone under Core's own key `retention:${turnId}` counts as "already redacted" (#588).
- **Catalogue reply pin**: the first `prepare` of a `#sku` message stores Core's decision under `${jobId}:catalog-command`; `complete` commits only that reply (`CATALOG_COMMAND_REPLY_MISMATCH`), reclaims replay it, and `credential`, `work-tool` and `complete` are refused before a decision exists (`CATALOG_COMMAND_NOT_PREPARED`) (#591).
- **Out-of-hours snapshot**: READY is committed only for the admission-time `answerText` (`OUT_OF_HOURS_REPLY_MISMATCH`), with no execution budget; a runtime `fail` is refused (`OUT_OF_HOURS_FAILURE_DEFERRED`) so the reply cannot be lost, and `credential` and `work-tool` are refused for the turn (#583). `complete` checks out-of-hours before the catalogue decision (#592).
- **`WORK_COMMAND_MISMATCH`**: for `read`, `propose` and `confirm-execute`, Core parses the job's own signed inbound text and refuses (409, not retryable) any request whose operation or input differs; only the derived command runs (#587).
- **Receipt replay scoped to the executing job**: `status` replays a `confirm-execute` result only when the receipt's `requestId` is this job and it is in the job's Tenant and Business; any other job gets `NOT_FOUND` and re-runs confirm-execute, which answers as the Server path does (#587, #592).
- **Group and room Work**: Core answers `status` with `NOT_FOUND` and every other Work call with `REJECTED WORK_ACTION_UNAVAILABLE` and the legacy refusal text, reaching no Work reader or writer (#585, #592).

**Deliberate differences from the Server path** (fail-closed or typed; each recorded in its PR): a speaker revoked or erased after admission is fenced rather than answered, including out-of-hours and group turns (#583, #585); failed memory turns store typed codes instead of `EXECUTION_FAILED` (#588); the GKS hop's budget is clamped to at most 7.5 s (#584); a Work failure that is not a request refusal and persists through the runtime's one retry ends `UNKNOWN` / `WORK_TOOL_OUTCOME_UNKNOWN` with no reply, where the Server path sends the `WORK_ACTION_UNAVAILABLE` text (#587).

**New stable identities** (in addition to *Failure and retry semantics*): `${jobId}:memory-read`, `${jobId}:memory-append`, `${jobId}:memory-injection` (#588); `${jobId}:catalog-command` (#591). `EXECUTION_FAILED` and `MODEL_FAILED` are keyed per execution (`runtime:${jobId}:turn-answer:${executionId}:<kind>`), and so are operation-less events such as `CONTEXT_COMMITTED` (#588).

### What remained at 0.3.15b (superseded)

Accepted-scope rows:

| Item | State at `cc44ab86` | Closed by |
|---|---|---|
| Memory-sync opt-in turns | **Done** for DIRECT on `BUSINESS_KNOWLEDGE`: v1 `memory` operation (`read`/`append`/`receipt`); Core is the only MSP caller and runs the same shared phases as the Server worker. | #588 |
| Out-of-hours reply (FR-244) | **Done.** Core decides at admission and snapshots; the runtime sends the snapshot with no model. | #583 |
| Group and room audiences | **Done** for verified speakers. | #585 |
| Malformed legacy `/work…` syntax | **Done** in DIRECT (`workReply`). GROUP/ROOM stays `SERVER`. | #587 |
| WorkTool answer parity | **Done.** Legacy text functions for `read`/`propose`/confirm/duplicate; request refusals are a typed `REJECTED` outcome with the legacy reply; the 5,000-character bound is kept. | #587 (exact runtime-side receipts: #586) |
| Knowledge grounding modes | **Done.** Guard at admission, `CONFIGURE_EXECUTION` and `CONFIGURE_KNOWLEDGE_GROUNDING`; GKS grounding in Core `prepare` with the legacy readers and `EVIDENCE_SELECTED` traces. | #584 |
| `#sku` catalogue command (FR-210) | **Done.** | #591 |
| Post-model answer parity | **Done.** Same no-evidence text, candidate check and deterministic fallback, from one module (`line-answer-policy.js`) mirrored byte for byte into the runtime. | #590 |
| Send contract | **Done.** `acceptance` is `{ provider: 'LINE', outcome }`; `CONTENDED` carries the job id; `MISSING` is accepted. | #589 |
| Length gap | **Done.** One `LINE_TEXT_MAX_CHARS = 10_000` for admission and `prepare`, mirrored as `MAX_TURN_QUESTION_CHARS`; evidence and slices are capped at 32 KiB each, and `fitPreparedTurn` keeps `prepare` under 64 KiB. | #589 |
| Unverified identities | **IN PROGRESS.** Still `SERVER` on `main`. The owner ruled on 2026-09-27 to move them to the runtime: W10, PR #597 (open), which also owns the ADR-106 D3, SDD-110 and FR-265 wording ("verified direct conversations" is no longer the whole cohort). | W10 (#597) |

Residual gaps recorded by the PRs and still true at `cc44ab86`:

| Gap | Current behaviour | Source |
|---|---|---|
| GROUP/ROOM memory turns | Stay `SERVER` (`memoryRuntimeEligible` requires DIRECT). They have not been re-tested against the legacy worker's non-DIRECT private-memory denial. | #588 (c), #592 |
| Memory with GKS grounding | Stays `SERVER`: only the legacy worker composes GKS evidence and MSP memory under one budget (FR-235). Core `memory read` also refuses it (`RUNTIME_GROUNDING_MODE_NOT_SUPPORTED`). | #588 |
| `REPLY_DEADLINE_MISSED` pre-check | The Server worker refuses a Work command whose execution budget is spent before any Work call (`executeClaimed`). Core's `work-tool` has no such check; the runtime path checks the deadline only at settle, after the Work call. | code at `cc44ab86` |
| Out-of-hours delivery availability | A runtime-cohort out-of-hours reply is sent only if the runtime is up; otherwise the job expires after the 30-minute TTL with no reply. A slow runtime can miss the 45-second reply window (push if `allowDelayedPush`, else `REPLY_DEADLINE_MISSED`). | #583 |
| Group threads split between executors | The cohort is chosen per message, so in one group, verified speakers are answered by the runtime and unverified speakers by `SERVER` until W10; memory and malformed-Work group turns stay `SERVER` after that too. Replies can arrive out of order across the two consumers. Each job still has one executor. | #585 |
| Deploy order: runtime before Core | Core has no contract-version gate for the `prepare` fields (`turnKind`, `replyText`, `workReply`, `memorySync`). A runtime older than W9 rejects a `CATALOG_COMMAND` turn after Core `prepare` has already applied a `#sku` confirm or cancel, so the user gets no reply until the runtime is upgraded (a reclaim then replays the stored reply). | #591 (F2) |
| Core `validateResult` receipt strictness | Core still accepts any Work receipt of at most 12 keys and 32 KiB; only the runtime client checks the exact v1 receipt shape. | #586 |
| `P2034` surfaced as a Prisma code | A lost serialization race on `confirm-execute` answers 503 `retryable: true` with the code `P2034`, not a domain code; the runtime probes `status` and replays. | #586 |
| MSP delivery-receipt scanner | Runtime jobs' MSP delivery receipts go through `reconcileLineMemoryDeliveries` in the Server worker tick, which must keep running with MSP configured. | #588 |
| ADR-106 D2 Knowledge half | D2's Memory/Knowledge port is implemented for Memory only. There is no v1 Knowledge (GKS) operation; GKS stays inside Core `prepare`. | #584, #588 |
| Group erasure for later speakers | Erasure redacts by the Conversation's owning Customer, which in a group is the first speaker. Erasing another speaker leaves that speaker's group messages and `SERVER` jobs unredacted. A fix is open in PR #596, not on `main`. | #585 |
| Silent evidence trimming | When `fitPreparedTurn` drops low-ranked evidence to stay under 64 KiB, nothing is traced. Only escape-heavy messages trigger it. | #589 |
| `RETENTION_TOMBSTONE` operator check | Before #588 the runtime could write a `RETENTION_TOMBSTONE` through `trace`, and erasure then skipped that turn. Existing data needs an operator check; see the query below. Not run against any database. | #588 (b) |

`RETENTION_TOMBSTONE` operator query (Postgres; **run by an operator only, never from CI or an agent**):

```sql
SELECT "id", "tenantId", "businessId", "turnId", "idempotencyKey", "occurredAt"
FROM "AgentTraceEvent"
WHERE "kind" = 'RETENTION_TOMBSTONE'
  AND "idempotencyKey" <> 'retention:' || "turnId";
```

For each turn it returns, check whether the turn was erased (the job's `errorCode = 'PDPA_ERASURE'`) while its other trace rows still hold readable payloads. If so, run `redactTraceTurn` on the turn again; since #588 it no longer stops at the foreign row.

Upkeep notes: `line-answer-policy.js` is edited in `apps/server` and copied unchanged over `services/conversation-runtime/src/line-answer-policy.js`; `conversation-runtime-answer-parity.test.js` fails on any drift (#590). The PostgreSQL suite pins the prerelease `embedded-postgres@17.10.0-beta.17`, whose platform packages need their `postinstall` on Linux/macOS (#586).

Also still open from *Cutover and rollback gates*:

- a full `npm run verify` with its E2E leg (the hosted `e2e` job was skipped by its path filter on #592 and on `main`);
- live LINE, MSP, GKS and model runs, production deployment and migration, which belong to Gate PRODUCTION.

The hosted image build and disposable drain/stop smoke, open at 0.3.14b, passed on `main` at `cc44ab86` (run `36317831755`, job `108615788969`).

## Checkpoint 0.3.14b — base `main` `3452429f` (superseded by *Current state*)

Kept as history. Its gate table and *What remained* table describe the tree before #586 and #592; the current ones are in *Current state* above.

Written by MC0 on branch `mc0/cr-to-wm-gate`, cut from `main` at `3452429f6db1c15431a0846ad55be267235a4d7f` (PR #542's merge `4b6d8eb7` plus later merges that do not touch Conversation Runtime code). This section describes the tree at that branch's head. It supersedes what *Merged state* says about conformance and the WorkToolPort. MC0 records gate evidence after review; this document does not record it.

### What gate `CR_TO_WM` required at 0.3.14b (superseded)

The gate is Gate CR in `REFACTOR-STATUS.md` §4: "CR acceptance ครบ, WorkToolPort ทดสอบจริง, review+required checks ผ่าน, merge เข้า base และ handoff ตรง SHA". §3 lists "WorkToolPort provider conformance — UNPROVEN — มี port contract แต่ยังไม่ใช่ end-to-end evidence". ADR-106 D2 defines the WorkTool port as `read`, `propose`, `confirm-execute` and `status`, and ADR-106 *Verification* lists the acceptance evidence levels.

| Gate item | What "done" means | State at this head |
|---|---|---|
| `merged_into_base` | CR merged into `main` | Done: #542 → `4b6d8eb7` (see *Merged state*). |
| `required_checks` | Required CI green | Done for #542: governance run `36277269502` at `b21a3552`, with `verify`, `tests`, `build`, `conversation-runtime`, `govern` and `market-intelligence` all green. |
| `reviewed_contracts` | The WorkToolPort tested for real against the real provider, plus review | **Test added, review pending.** See *WorkToolPort tested against the real Core provider*. It passes locally. It has not had a hosted run or an independent review yet. |
| `accepted_scope_complete` | ADR-106 accepted scope implemented and verified; the *Cutover and rollback gates* item "Complete and review the original extraction acceptance scope, including the remaining Server-owned flows" | **Open.** See *What remains*. Whether the scope is ADR-106 option B (the eligible, verified, direct cohort) or every conversation flow is a user decision. |
| `matching_handoff` | This handoff describes the merged SHA | This version matches the branch head of the PR that carries it. It has to be re-read against that PR's merge SHA. |

### Conformance

- **Model provider/consumer conformance** is `apps/server/tests/integration/conversation-runtime-model-conformance.test.js`. It needs no docker and no credentials; providers are controlled `fetch` fakes, and the same inputs go to the legacy Server port and the Runtime port. It covers six providers (request and response bodies, four error classes, caller deadline, the PRP reasoning filter and the custom-endpoint discrepancy).
  - **Local, base `3452429f`:** 45/45 passed.
  - **Hosted, #542 merged head `b21a3552`:** it ran inside the required `tests` job (run `36277269502`, job `108502329867`), where the log shows `conversation-runtime-model-conformance.test.js (45 tests)` passing. The whole job passed 789 files (5 skipped) and 6,830 tests (42 skipped).
  - The "NOT_RUN" recorded in *Merged state* was therefore stale. The suite did run in the required checks; nobody had read the job log for it.
- **Durable vertical slice** (`conversation-runtime-vertical-slice.test.js`): 11/11 passed locally at base `3452429f`, and 11/11 in the same hosted job.
- **WorkTool conformance** did not exist before this version. It is the new suite below.

### WorkToolPort tested against the real Core provider

`apps/server/tests/integration/conversation-runtime-work-tool-port.test.js` passes 6/6 locally. The chain it exercises has no mock of the port on either side:

1. the Runtime's own port object, `createCorePorts` in `services/conversation-runtime/src/core-ports.js` (extracted verbatim from `main.js`);
2. the Runtime Core client, whose consumer-side response validation runs on every reply;
3. the Core route handler and `createConversationRuntimeCore`;
4. `line-project-work-tools.js`, then the canonical Project Manager writers;
5. the disposable per-run SQLite database.

Two things are replaced. The LINE transport is a local fake, used in the full-turn case only. The socket hop is an in-process `fetch` that still serialises every request and response; the vertical slice covers the socket path with a separate process.

| Case | What it proves |
|---|---|
| `read` | Admission produces the runtime-cohort job. Claim, `resolve` and `prepare` go through the ports, and `prepare` derives `{operation:'read'}` from the signed inbound text. `status` is `NOT_FOUND` before and after the read, because a read has no receipt. The exact response shape and keys are asserted. |
| `propose` → `confirm-execute` | The proposal writes no WorkItem, and `status` then replays the same receipt. A repeated `propose` returns the same proposal. A second signed inbound confirms using the proposal id as the operation id. Exactly one canonical WorkItem is created, and the receipt equals the durable `line-work-result` row. `status` and a repeated `confirm-execute` replay the receipt with `duplicate: true`, with no second write. |
| Fencing | Core refuses the call before any Work side effect when the claim is stale after renewal, when tenant, execution or claimant is forged, when the lease has expired, or when the channel identity is revoked. No proposal row and no WorkItem are written. |
| Runtime-side refusal | An arbitrary tool operation fails `WORK_TOOL_OPERATION_INVALID` in the Runtime, and nothing reaches Core. |
| Request-contract parity | For 21 inputs, the Runtime validator, the Core validator and the published `contracts/v1/operation.schema.json` (Ajv 2020) must reach the same accept or reject verdict. |
| Full turn | `createConversationRuntime().runOne()` drives a `/projects` read over the same ports to `RECORDED`, with one fake LINE delivery, no model call and no credential request. |

The suite fails when the contract drifts. As a check, Core was changed temporarily in two ways: an extra key was added to the `read` receipt, and the Core `read.query` bound was widened to 200. The `read` case and the parity case both failed, and the change was reverted. `services/conversation-runtime/test/core-ports.test.js` (3 tests) pins the Runtime side of the wire: operation names, the claim reference, idempotency keys, and the Core-readiness gate on `claim`.

**Remaining gap:** the provider store is SQLite (the suite's disposable database), not the production Postgres. No live LINE, model or production database is involved.

### What remained at 0.3.14b (superseded)

The first four items are Server-owned **by ADR-106 D3's eligibility rule**. They are in scope only if the accepted scope is "every conversation flow", which needs a user decision. The last three are gaps inside the option-B cohort itself. The sizes are estimates.

| Item | Current behaviour | Size |
|---|---|---|
| Memory-sync opt-in turns (`ZURI_MSP_THREAD_MEMORY_ENABLED`) | Admitted to `SERVER`. ADR-106 D2's Memory/Knowledge `read`/`append`/`receipt` ops are not in the v1 operation set. | L, about 3–5 days: new port ops on both sides, consent/erasure fencing, tests |
| Out-of-hours reply (FR-244, ADR-094 D6) | Admitted straight to `READY` and delivered by the Server send path. No model runs. | S–M, about 0.5–1 day, plus a cohort-semantics decision |
| Group and room audiences | `SERVER`. The runtime and `ownedClaim` require `DIRECT`. | M–L |
| Unverified identities | `SERVER`. Core authority requires a verified channel identity. | Probably stays by design; needs a decision |
| Malformed legacy `/work…` syntax | `SERVER`, which replies with the usage text | S, about 0.5 day |
| WorkTool answer parity with the Server handler (code reading, not executed) | Three differences from the legacy `handleLineProjectWorkCommand`. (1) The Runtime `read` text drops the item ids, the workstream ids (which `/work-create` needs) and the truncation note. (2) The `propose` header text differs. (3) Work errors (expired confirmation, version conflict, scope denied, invalid args) come back as a retryable 503. The Runtime then records `WORK_TOOL_OUTCOME_UNKNOWN` and sends nothing, where the legacy path replies with a fixed message. | S–M, about 1 day, including a decision on the 5,000-character bound |
| Knowledge grounding modes (code reading, not executed) | Runtime `prepare` supports only `BUSINESS_KNOWLEDGE` and fails `GKS_CORPUS` and `GKS_THEN_BUSINESS_KNOWLEDGE` with `RUNTIME_GROUNDING_MODE_NOT_SUPPORTED` (409). Neither admission eligibility nor `CONFIGURE_EXECUTION` checks the grounding mode. An opted-in account with a non-default mode would therefore admit runtime jobs that fail at `prepare`. | S for an eligibility guard; M to port GKS grounding |

Also still open from *Cutover and rollback gates*:

- a full `npm run verify` with its E2E leg, which was blocked by port 3100 last time;
- a hosted image and smoke run on the current `main`.

Production deployment, production migration, live LINE and real model calls belong to Gate PRODUCTION, not this scope.

### Evidence at this head (local, Windows, Node 24.19)

| Check | Result |
|---|---|
| `services/conversation-runtime` `npm test` | 36/36 passed (33 existing and 3 new `core-ports`) |
| `services/conversation-runtime` `npm run build` | passed, 9 source files (`core-ports.js` is new) |
| Focused Server suites (model conformance, vertical slice, WorkToolPort, line-project-work-tools, fr146 account, line-admission-after-ack) | 6 files, 106/106 passed |
| Full Server `npm test` | 808 files passed, 5 skipped (813); 7,004 tests passed, 42 skipped (7,046); exit 0, 612 s |
| `docs:graph` / `docs:check` / `docs:preflight` | graph 3,822 nodes, 16,023 edges, 10 known dangling (none from this change); `docs:check` up to date; preflight 0 critical, 21 warnings, 34 info (20 warnings are broken links to the generated, uncommitted `llms-full.txt`; 1 is the 10 known dangling edges) |

## Merged state — 2026-09-27 (historical, superseded by *Current state*)

PR [#542](https://github.com/Freshair129/zuri.ai/pull/542) merged into `main` on 2026-09-27T01:30:29Z as `4b6d8eb790c718dca67b9da13638fc63b64a8ce3`; the merged PR head is `b21a35529b76f8aa44096c98089e7bbf0c369c3f`. S1 stopped responding on 2026-09-26; on the user's instruction MC0 took over S1's work, carried S1's unpushed commits (`2557bb32`, `26a77dea`) and uncommitted `apps/edge` work into its own worktree, and finished the PR there. The S1 worktree named under Provenance is no longer the writer.

What landed after the published head `2e2154de` described below:

- **Merge with `main` including Notion (#575).** Branch IDs were renumbered because `main` had assigned them to Notion: the Edge retirement ADR is now **ADR-110** (was ADR-109) and the Conversation Runtime SDD is **SDD-110** (was SDD-108). This document's references use the new IDs.
- **Phase B rebind for the merged schema.** The frozen inventory binds 191 tables (Notion) plus the `runtimeOwner` fields: `schemaSha256` `f17edcf1917e80825f6b1ec8e0e958fc9dae74b570195d5b3e0c6069eb7dd078`, `targetSchemaSha256` `a3b354485036ccb70f84980f0af2676ddeee554fff0089b33eb0afe29f43d4d1`. The Notion-only and runtimeOwner-only bindings are refused. This supersedes the 188-table rebind recorded below; see `26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md` 0.3.10b. That binding is itself superseded by 0.3.11b (`Message.authorChannelIdentityId`, FR-022 group-speaker erasure).
- **API inventory:** 322 route handlers, 323 OpenAPI paths, 428 operations.
- **`apps/edge` Edge Device retirement (ADR-110 D5):** S1's writer output (pairing panel, device configuration, `zuri-api` client, desktop worker, Edge CLI commands, test-only Tauri harnesses) was committed after re-verification; Knowledge/RAG, pricing and catalog are unchanged. Follow-up docs landed in #576.

Evidence at the merged head `b21a3552`: governance run `36277269502` and Edge CI run `36277269622` succeeded, covering governance, Server tests, build, Conversation Runtime, market-intelligence, Edge verify and desktop (E2E skipped by its path filter). Locally, `apps/edge` `npm test` passed 764 of 767 (3 skipped) and `cargo test --lib` passed 25 (3 ignored). Two independent read-only reviews passed the merge resolution and the `apps/edge` diff.

**Extraction status: still partial.** Merging is not completion. Against ADR-106 *Verification*, provider/consumer conformance is **NOT_RUN**, the flows under *Remaining Server-owned or unverified flows* still run in the Server, and production cutover, production migration, live LINE send and real model calls are **NOT_RUN**. The Mission Control gate `CR_TO_WM` (S2's hard start) therefore records `merged_into_base` and `required_checks` only; `accepted_scope_complete`, `reviewed_contracts` (a real WorkToolPort test) and a handoff matching a completed scope remain open. (0.3.14b: the conformance "NOT_RUN" and the WorkToolPort statement here are superseded by *Current state*. The model conformance suite ran and passed in the required `tests` job at `b21a3552`, and a WorkToolPort suite against the real Core provider now exists.)

Everything below this section is the checkpoint as S1 left it at the published head `2e2154de`, kept as history.

## Provenance and boundaries

- Repository: `Freshair129/zuri.ai`
- Branch: `codex/conversation-runtime-service`
- Worktree: `C:\Users\pc\workspace\zuri-ai\.worktrees\conversation-runtime-session1`
- Current published source snapshot: OPERATOR confirmed PR #542 branch fast-forwarded from `70f8cee8` to `2e2154def4ede0a382f672bbf807eb4221f4fa92`; PR base is `d302eb0849b00b3c85934eeda6763d7dd4941443`. The Phase-B binding/test/RCA patch is committed locally at `2557bb32346ef300329f828a0c5dc3f207cf52ba`; this status refresh and the branch tip are not pushed. The PR body now records the local commit and separates its evidence from the published head. No reset or force-push was performed.
- Reviewed PR baseline: head `189c60766323655149b84928e5db4c16c5e6afb8`, base `fad8ec6252941ca3de01afdb3116484f86b366c3`.
- PR #573's merge is included in the current base; its older review result is historical, not a pending S1 gate.
- PR: [#542](https://github.com/Freshair129/zuri.ai/pull/542), merged 2026-09-27 as `4b6d8eb7` (at the time of the history below it was an open draft). No production deployment was performed.
- Governing documents: ADR-106 and SDD-110; contract: `conversation-runtime.v1`.
- Risk: **HIGH** — queue ownership and a private Core API boundary change with additive account/job schema fields. SQLite and Postgres migration artifacts are listed below; neither was applied to production.
- Session 2 remains read-only preparation. Session 3 may continue in Files-owned scope. This tranche did not change Files storage, shared Files contracts, MSP/GKS, MinIO, or the Knowledge 17-stage pipeline.
- Production deployment, production migration, live LINE send and real model call: **NOT_RUN**. All credentials, provider endpoints, webhook signatures and delivery adapters used for tests are synthetic or local controlled fixtures.

## Latest checkpoint after the PR head check (historical, superseded by *Merged state*)

The published PR #542 head is `2e2154def4ede0a382f672bbf807eb4221f4fa92`. The Compose-profile, retirement-test, Edge workflow and ID-ledger corrections below are included in that published head. The later Phase-B exact-schema rebind and its test/RCA updates are committed locally at `2557bb32346ef300329f828a0c5dc3f207cf52ba`; this handoff refresh is local and neither is on the PR head yet.

- `services/conversation-runtime/scripts/verify-compose-paths.mjs` now enables the `conversation-runtime` Compose profile before checking resolved service paths. The hosted failure was caused by omitting the profile, which made Compose omit the runtime service from `config`; the base web context resolving to `apps/server` was expected.
- The retired-rule coverage test now expects FR-050/FR-140 in `fr_planned` and FR-141/FR-144 in `fr_superseded`, matching the approved registry statuses. `docs/.id-ledger.json` was updated only through the sanctioned `--review` writer for same-subject FR-265 and SDD-110 digest changes; their pinned subjects and IDs remain unchanged.
- `.github/workflows/edge-ci.yml` no longer runs the packaged Edge Device worker lifecycle step, and the Edge Device-only `.github/workflows/release-edge.yml` workflow is removed. The regular Edge verify job remains for the retained Knowledge/RAG runtime.

Latest local evidence: `npm run govern` passed with 0 critical, 1 warning and 32 info; `docs:check` is current. The Phase-B exact-schema rebind passed its focused tests (2 files, 13/13) and is committed locally at `2557bb32346ef300329f828a0c5dc3f207cf52ba`, but remains absent from the published PR head. The local candidate also passed full Server Vitest (787 files passed, 5 skipped; 6,819 tests passed, 42 skipped). The latest `npm run verify` passed governance, Server Vitest, Server build, and Conversation Runtime unit/build (33/33 tests; 8 source files). Its E2E leg did not start because port 3100 was already occupied; that process was left untouched. Separately, the full `npm run test:e2e` at `E2E_PORT=31920` completed with 207 passed and 4 skipped (211 executed). This standalone E2E pass does not change the prior `npm run verify` outcome into an aggregate pass. At published PR head `2e2154def4ede0a382f672bbf807eb4221f4fa92`, hosted conversation-runtime, governance, edge-ci, image build, and disposable startup/drain/shutdown smoke passed; the Server tests job failed only while loading the stale Phase-B inventory/schema binding. Hosted CI for the local re-pin candidate remains **NOT_RUN**. Provider/consumer conformance remains **NOT_RUN**. Docker is unavailable locally. No production activity is claimed.

Latest published-head CI evidence: workflow run `36182888167` at PR head `2e2154def4ede0a382f672bbf807eb4221f4fa92` passed Conversation Runtime, including Compose path verification, hosted standalone image build, image-build recording, and disposable drain/stop smoke; its governance job passed. Edge CI run `36182888222` passed. The Server tests job failed only while loading the published Phase-B inventory because its pinned schema hash did not match. The local re-pin candidate passes Server Vitest (787 files passed, 5 skipped; 6,819 tests passed, 42 skipped), but no corrected-head hosted run has occurred. Earlier failed workflow runs listed below are historical.

The pre-existing dirty Playwright PNGs and `apps/server/debug.log` were restored from the exact-path preservation backup after verification; restored artifacts remain unstaged. Newly generated screenshots remain in place. No generated files were deleted.

## Old path and current vertical slice (as of #542; the cohort at `cc44ab86` is in *Current state*)

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

## Checkpoint status (historical, superseded by *Current state*)

The table below records prior focused and full-suite evidence at the source snapshots identified in each row. The “Latest checkpoint” section above supersedes any row that calls `4d06bff` or an earlier SHA current. No full mandatory regression has passed on the final corrected tree yet.

| Dimension | Status | Evidence boundary |
|---|---|---|
| Code | **PARTIAL** | Real independent runtime and real Core-owned queue are connected for eligible direct verified messages; other admitted flows remain Server-owned. |
| Contract | **PASS — focused** | Both sides validate the versioned operation/request/response envelopes, deadlines, fields and payload bounds. Core derives authority; forged scope is rejected. |
| Integration | **PASS — focused** | Eleven disposable-database vertical-slice tests cover signed admission, duplicate ingress, separate process, fake provider/delivery, receipts, default and opted-in cohorts, owner quiescence, legacy/runtime exclusivity, lease/revocation/consent/erasure fences, process restart, and the acknowledged-admission owner-switch race. The owner-only switch preserves the epoch and admits under the new owner; a real policy epoch change still skips stale admission. The account suite's 8/8 and combined 18/18 are prior focused results, not a current combined run. Current-head provider/consumer conformance remains pending. |
| Data ownership | **PASS — checkpoint** | Queue, runtime-owner routing, authoritative claims/leases/receipts, identity/consent/transport authority, canonical Work writes, LINE transport and durable CRM/trace receipts remain in Core. Runtime has no Prisma access. Additive artifacts: `apps/server/prisma/migrations/20260925120000_line_conversation_runtime_owner/migration.sql` (SQLite) and the canonical Supabase migration. The generated Postgres snapshot `apps/server/prisma/postgres/0001_init.sql` was refreshed; the invalid append-only `0003_line_conversation_runtime_owner.sql` was removed. No migration was applied to production. Production ownership/cutover is not verified. |
| Hosted image build | **PASS at published head; NOT_RUN for local candidate** | Workflow run `36182888167` passed hosted standalone image build and recorded `HOSTED_IMAGE_BUILD=PASS` for published head `2e2154def4ede0a382f672bbf807eb4221f4fa92`. The local re-pin candidate has not had a hosted build. |
| Image startup/readiness/drain/shutdown | **PASS at published head; NOT_RUN for local candidate** | The same published-head workflow passed disposable drain/stop smoke. The local re-pin candidate has not had image startup/smoke. No production stack, .env, secret or volume was mounted. |
| CI | **PARTIAL — published head; local candidate unhosted** | At PR head `2e2154def4ede0a382f672bbf807eb4221f4fa92`, run `36182888167` passed Conversation Runtime and governance; Edge CI run `36182888222` passed. The Server tests job failed only at module load because the published Phase-B inventory digest did not match the schema. The local re-pin passes full Server Vitest, but has no corrected-head hosted run. |
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
| Actual Compose-resolved paths | **PASS at published head; NOT_RUN for local candidate** | Workflow run `36182888167` passed Compose path verification for published PR head `2e2154def4ede0a382f672bbf807eb4221f4fa92`. The local re-pin candidate has no hosted Compose-resolved check; its local static result has `composeResolvedPaths=null` because Docker is unavailable locally. |
| Local diff whitespace | **PASS — current closeout diff** | `git diff --check` exited 0 after the current source, snapshot and handoff corrections. |
| Prior mandatory repository regression | **PASS — historical baseline only** | Before S1(a) retirement edits and the local-main sync, `npm run verify` exited 0: Runtime 18 passed; Server Vitest 801 files and 6,728 tests passed, 32 skipped; production build passed; Playwright 223 passed and 4 skipped out of 227, with no failures/flakes. This result does not verify the current composed tree. |
| Hosted image and smoke | **PASS at published head; NOT_RUN for local candidate** | Workflow run `36182888167` passed the hosted image build and disposable drain/stop smoke for published PR head `2e2154def4ede0a382f672bbf807eb4221f4fa92`. No hosted image or smoke run has occurred for the local re-pin candidate. |
| Prior S1(a) governance before local-main synchronization | **PASS — local** | `npm run govern` exited 0 with 0 critical, 22 warnings and 33 info. The Edge doc-graph was explicitly **SKIPPED** per approved scope; this result does not claim Edge doc-graph freshness. |
| Last recorded composed-tree governance | **PASS — current local closeout** | `npm run govern` exited 0. Server doc graph: 3,741 nodes, 15,822 edges, 10 known dangling edges, 1 changed node; `docs:check` was up to date. Server preflight: 0 critical, 1 warning and 32 info. Data-pipeline map: 82 nodes, 114 edges, 22 chains. Domain state: 14 domains, overall partial, 47 gaps. The Edge doc-graph was explicitly **SKIPPED** and is not covered by this result. |
| Previously recorded S1(a) focused checks | **PASS — focused** | OpenAPI integration: 18/18; focused affected unit batch: 79/79; Edge config reload: 13/13. The E2E selector's separate one-shot 14/14 result at source `HEAD` `4d06bff` is recorded below. Exact commands and the Edge dependency-resolution boundary are recorded below. |
| Earlier `npm run verify` attempt | **BLOCKED — prior preflight state** | At the earlier source snapshot, `npm run verify` ran Runtime tests (18/18) and Runtime build (8 source files, Node 24.19.0), then exited 1 at Server strict preflight. It did not start the Server test, Server build or Playwright stages. This predates the current zero-critical governance result and is not current composite verification evidence. |
| Prior Server `npm test` attempt | **BLOCKED — 0 tests** | Server Vitest did not discover or execute tests because esbuild could not access `../../../../../..` while resolving the isolated Vitest config. The same path denial was reproduced in a TEMP/workspace snapshot. This prior attempt is not current-head verification and is not a pass. |
| Latest `npm run verify` | **PARTIAL — E2E port conflict** | Governance passed; Server Vitest passed (787 files passed, 5 skipped; 6,819 tests passed, 42 skipped); Server build passed; Conversation Runtime unit/build passed (33/33 tests, 8 source files). The E2E leg could not start because port 3100 was occupied. This invocation did not pass as an aggregate. |
| Standalone full E2E | **PASS — local** | `E2E_PORT=31920 npm run test:e2e`: 211 tests executed, 207 passed, 4 skipped. This is a separate run and does not change the `npm run verify` result above. |
| Current Phase-B focused tests | **PASS — local only** | The exact-schema rebind passed 2 files / 13 tests and is committed locally at `2557bb32346ef300329f828a0c5dc3f207cf52ba`; it is not on the published PR head. |
| Commit, push and PR update | **COMMITTED LOCALLY — PUSH PENDING** | Phase-B schema/test/RCA patch is committed at `2557bb32346ef300329f828a0c5dc3f207cf52ba`. PR #542 body is updated, but its published head remains `2e2154def4ede0a382f672bbf807eb4221f4fa92`; the branch tip and handoff status refresh still need pushing. Corrected-head CI has not run. |
| Prior full Server Vitest suite | **PASS — historical local run** | `npx vitest run --root . --config ./vitest.config.js` from `apps/server`: 793 files total, 788 passed and 5 skipped; 6,825 tests total, 6,784 passed and 41 skipped; exit code 0, duration 574.21s. Skipped tests include opt-in PostgreSQL suites. `id-anchor-stability` passed 70/70 after sanctioned ID-ledger digest review. The latest Server Vitest result is recorded in the current `npm run verify` row above. |
| Server production build | **PASS — latest `npm run verify` stage** | `npm run build` from `apps/server` passed in the latest verify invocation; the invocation later stopped at E2E startup because port 3100 was occupied. |
| Current model-key card unit | **PASS — focused follow-up** | `npx vitest run --root . --config ./vitest.config.js tests/unit/line-oa-model-key-card-render.test.js` from `apps/server`: 14/14; checks current child-owned copy in rendered markup and that the parent console does not advertise dispatching to a paired device. |
| Runtime checks | **PASS — latest `npm run verify` stages** | Runtime unit tests passed 33/33; build passed for 8 source files. The verify invocation later stopped at E2E startup because port 3100 was occupied. |
| Current Edge config reload | **PASS — focused** | `apps/edge/tests/unit/config-reload.test.ts`: 13/13. Worktree dependencies were unavailable, so the run used a temporary resolver with the primary checkout's installed `tsx` and `dotenv`; the test source and Edge runtime source came from this worktree. |
| Current OpenAPI inventory | **PASS — focused** | `npx vitest run --root . --config ./vitest.config.js tests/integration/openapi-docs.test.js` from `apps/server`: 18/18; the route walk confirms 318 paths and 423 operations. |
| One-shot E2E selector | **PASS — focused at source HEAD 4d06bff** | `npx vitest run --root . --config ./vitest.config.js tests/unit/ci-select-e2e.test.js` from `apps/server`: 14/14. This checks the selector only; the separate full Playwright result is recorded below. |
| Current affected unit batch | **PASS — focused** | From `apps/server`, `npx vitest run --root . --config ./vitest.config.js tests/unit/edge-surface-retirement.test.js tests/unit/line-studio-account-console-render.test.js tests/unit/doc-views.test.js tests/unit/programme-member-view.test.js tests/unit/programme-usage-reports.test.js tests/unit/api-path-reachability.test.js tests/unit/asset-intake-adapters-contract.test.js tests/unit/public-base-url.test.js`: 8 files, 79/79. |
| Earlier closeout focused units | **PASS — prior local result** | From `apps/server`, `npx vitest run --root . --config ./vitest.config.js tests/unit/line-admission-after-ack.test.js tests/unit/profile-identity-fields-migration.test.js`: 2 files, 25/25. This predates the current Phase-B patch. |
| Current Phase-B focused tests | **PASS — local only** | 2 files, 13/13 for the exact-schema rebind committed locally at `2557bb32346ef300329f828a0c5dc3f207cf52ba`; it is not on the published PR head. |
| FR-149 E2E and Edge desktop E2E | **PASS — standalone full suite** | The standalone full `npm run test:e2e` at `E2E_PORT=31920` completed with 207 passed and 4 skipped (211 executed). This later full-suite result supersedes the earlier post-fix locator and filtered Edge E2E runs that were not verified. |
| Phase-B schema contract | **PASS — focused local rebind** | The inventory now binds the exact current schema, retaining the 188 table mappings and fail-closed restore checks. The focused proof passed 2 files / 13 tests. The patch is committed locally at `2557bb32346ef300329f828a0c5dc3f207cf52ba`, not on the published PR head; corrected-head hosted CI remains **NOT_RUN**. |
| Retired-FR coverage regression | **PASS — focused, prior scope** | `npx vitest run --root . --config ./vitest.config.js tests/unit/doc-graph-retired-rules.test.js` from `apps/server`: 1 file, 6/6 tests, exit 0. Retired FR-220/221/222 remain visible in the graph but no longer inflate active gaps. Its earlier FR-050/140/141/144 gap snapshot predates the approved status decisions recorded below. RCA: `.brain/rca/2026-09-25-retired-fr-coverage-counted-as-active.md`. |
| Prior generator checks | **PASS — local** | `npm run docs:llms:check`, `node apps/server/scripts/programme-containers.mjs --check`, and the prior S1(a) governance run exited 0 with 0 critical, 22 warnings and 33 info. Edge doc-graph was explicitly skipped per approved scope. |

Compose provenance was checked from the tracked files. The base is `apps/server/docker-compose.yml`; the build command explicitly supplies `apps/server/docker-compose.conversation-runtime.yml` as its overlay and sets project directory to `apps/server`. No `docker-compose.override.yml` is loaded by that explicit command. With that project directory, the base web context resolves to `apps/server`; overlay context `../..` resolves to the repository root. The previous `..` would resolve to `apps`, which is not the runtime Dockerfile’s repository-root context. CI verifies the actual resolved Compose JSON before image build.

The first local Vitest invocation and the `npm test` wrapper were denied parent-path traversal by the sandbox before tests started; esbuild reported `Cannot read directory "../../../../../..": Access is denied`, so those attempts executed zero tests. During this closeout, the exact full-suite command above first hit the same sandbox denial; an approved worktree-scoped retry of that unchanged command completed with the results above. An approved worktree-scoped retry also ran the focused integration tests. A later test-name-filter invocation passed its selected crash case but began enumerating the server workspace; it was interrupted, so it is not counted as a completed check. During S1(a), the supported focused selector invocation and the other affected tests completed as listed above. A separate prior Server `npm test` attempt again executed zero tests when esbuild could not access `../../../../../..` while resolving the isolated Vitest config; this was reproduced in a TEMP/workspace snapshot. The latest `npm run verify` passed its governance, Vitest and build stages but did not complete the E2E stage because port 3100 was occupied. A separate full E2E run at `E2E_PORT=31920` passed 207 tests, skipped 4, and executed 211.

The first mandatory `npm run verify` after the initial runtime tranche exposed five failures in `line-admission-after-ack.test.js`: a runtime identity lookup was running on the unchanged Server execution path, whose fixtures intentionally have no channel identity. The runtime eligibility guard now runs that lookup only for opted-in `CONVERSATION_RUNTIME` direct-message cohorts. The root cause is recorded in `.brain/rca/2026-09-24-runtime-admission-identity-lookup-leaked-to-server-path.md`; the focused admission tests passed 20/20 and the subsequent full regression passed at that earlier, pre-S1(a) checkpoint. It is historical evidence, not a pass for the current tree.

## Remaining Server-owned or unverified flows (historical, superseded by *Current state → What remains*)

- Memory-sync opt-in, out-of-hours handling, group/room audiences, unverified identities, and invalid/unsupported legacy Work command syntax remain on Server paths.
- Non-message LINE event admission, webhook reconciliation/maintenance and unrelated LINE OA workers remain Core/Server-owned.
- The vertical slice covers one eligible direct-message cohort and controlled test data; it does not prove all account configurations, traffic patterns or production behavior.
- Hosted Compose resolution, Linux image build and disposable image smoke have not run locally. They passed for published head `2e2154de`; the local Phase-B re-pin candidate still needs corrected-head hosted CI.
- At pushed head `2e2154de`, workflow run `36182888167` passed Conversation Runtime, governance, hosted image build and disposable drain/stop smoke; Edge CI run `36182888222` passed. The Server tests job failed only at module load because the published Phase-B inventory digest did not match the schema. The local re-pin retains all 188 table mappings and fail-closed checks, adds restore-preservation coverage, and passed focused tests (2 files / 13) plus full Server Vitest (787 files passed, 5 skipped; 6,819 tests passed, 42 skipped). The latest `npm run verify` passed governance, Server Vitest, Server build and Conversation Runtime unit/build but its E2E leg could not start because port 3100 was occupied. Separate full E2E at port 31920 passed 207 and skipped 4. The local candidate has no corrected-head hosted CI/image result. Provider/consumer conformance remains unverified. No full extraction, rollout readiness or production cutover is claimed.

## S1(a) Edge Device retirement reconciliation

- S1(a) removes the Server-owned Edge Device and harness pairing, credential, heartbeat and extraction surfaces, plus the Edge callers and Edge extraction contract. Historical records are retained. Signed LINE webhook ingress, the PRP LocalWorker API-key flow, and Knowledge/RAG runtime remain in scope and are preserved. The public `baseUrl` remains as a legacy follow-up.
- The composed Server route inventory is **318 paths / 423 operations**, verified by the actual route-tree integration test (18/18).
- ADR-110 D5 per-ID review is partial: FR-220, FR-221 and FR-222 plus FEAT-035 are retired in the Server surface registry; FR-221 historical report data remains readable, while new usage writes use the deployment-bearer FR-218 path. Per the approved scope, FR-141 and FR-144 are superseded; FR-050 and FR-140 remain planned. Their rationale remains in `docs/PRD-SDD-v1.0.md`; the ID ledger is current but has no per-ID reason-note field.
- FR-143, SEC-025, SDD-085 and FEAT-017 retain their existing active/deferred status pending owner reconciliation. The prior mismatch from Edge callers targeting removed Server routes is addressed by removing those callers and the Edge extraction contract in S1(a); this does not establish production behavior or resolve unrelated requirements. The Edge doc-graph was explicitly **SKIPPED** per approved scope; no Edge graph freshness is claimed.
- The current closeout Server governance run exited 0 with 0 critical, 1 warning and 32 info; the graph reports 10 known dangling edges. The Edge doc-graph remains skipped. FR-050/140 remain planned, FR-141/144 are superseded, and the prior retired-FR coverage correction remains in effect; no requirement anchors or meanings were invented to suppress findings.

## Cutover and rollback gates (checklist as of 0.3.13b; current gate state is in *Current state*)

- [x] Sync the S1 branch with the current PR base `d302eb0849b00b3c85934eeda6763d7dd4941443`; PR #573's merge is part of this base.
- [x] Commit the Phase-B rebind, tests, and RCA at `2557bb32346ef300329f828a0c5dc3f207cf52ba`; update the PR body with local-vs-hosted evidence.
- [ ] Send the exact current branch tip to OPERATOR for push; do not push directly from this environment. Re-run hosted CI on that exact head, including Compose resolution, hosted image build and disposable startup smoke.
- [ ] Run full `npm run verify`, current-head provider/consumer conformance, and full Playwright regression without overwriting retained unrelated artifacts.
- [ ] Complete and review the original extraction acceptance scope, including the remaining Server-owned flows.
- [ ] Confirm hosted `HOSTED_IMAGE_BUILD=PASS`, `IMAGE_START_SMOKE=PASS`, and aggregate CI `verify=PASS`; the local Server `npm test` zero-test attempt must be rerun outside the sandbox first.
- [ ] Confirm all required contracts, ownership/revoke races, crash/restart and provider/consumer conformance evidence.
- [ ] Before any separately authorized cutover, reconcile active leases and SENDING/ACCEPTED/UNKNOWN/admission states; stop exactly one executor before enabling the other for a cohort.
- [ ] Keep draft until the original acceptance scope is complete and explicitly reviewed.
- [ ] Production deployment, production migration, live LINE traffic and real model calls require separate authorization; none are part of this checkpoint.

## Version diff

`0.3.17b → 0.3.18b`: adds *Update 0.3.18b* for branch `mc0/direct-msp-erasure` (base `main` `f8f6dcd9`, PR #614 merged). Records the owner decision of 2026-09-28 (option A: one tenant-wide MSP erase per erased person with memory-sync data, DIRECT included) and its implementation: one pending record per (tenant, principal, erasure request) naming no room, the port's `erasePrincipalInTenant` with no thread resolved, old per-thread records drained under their own keys, keyset paging with a resumable cursor, the grace-only early break and the `AgentTraceEvent (kind, occurredAt, id)` index with its operator migration (`CREATE INDEX CONCURRENTLY`, not applied). Marks 0.3.17b's owner-decision item and the DIRECT consequence as superseded. Still open: MSP keeps `AGENT` replies and shared summaries (an MSP contract question), the cutover and a full `npm run verify`.

`0.3.16b → 0.3.17b`: adds *Current state* for `main` `e428d91c` plus branch `mc0/cr-residual-gaps`. Records the operator's production state of 2026-09-28 (#596's migrations applied with 298/298 attributed, `RETENTION_TOMBSTONE` query 0 rows, MSP pin `68e6169d` with `msp_thread_principal_erase` and the identity HMAC key, runtime `release-e428d91c` deployed READY with smoke PASS, no account opted in). Lists the PRs merged since `c91db083` (only #606 and #608 touch the runtime path, through the mirrored answer check). Records eight residual gaps closed by the branch (bounded erasure due-selection, erasure kinds in restore gating, PENDING parity tests for GROUP/ROOM/GKS, the Work `REPLY_DEADLINE_MISSED` pre-check, Core's exact Work receipt check from one mirrored module, the `EVIDENCE_TRIMMED` trace, the MSP erase contract, ADR-106 1.2.1) with their tests, and what `msp_thread_principal_erase` does at the pin: tenant-wide, human messages tombstoned, replies kept, summaries only in sole-human threads, participants closed. What remains: the cutover (Gate PRODUCTION), the owner decision on DIRECT MSP erasure (sharpened by the tenant-wide contract) and a full `npm run verify` with E2E. The 0.3.16b section is kept, retitled as superseded.

`0.3.15b → 0.3.16b`: rewrites *Current state* for base `main` `c91db083` (PR #604). Adds the PRs merged since `cc44ab86` with their heads and merge SHAs (#597 W10, #593, #596, #602, #600 W11, #604 W12; #598, #599 and #601 noted as not on the runtime path, #601 as Server-only) and lists the open #603 and #606 as pending. `required_checks` records #604's PR-head governance run `36324329014` (all required jobs green, 19/19 on PostgreSQL, 73/73 runtime tests; tree identical to `c91db083`) and Edge CI `36324329049`; `main`'s push run `36324888801` was still in progress and is recorded as pending. `accepted_scope_complete` is now done, from the admission code (`memoryRuntimeEligible = true`, no sender-verification condition on `runtimeOwner`) and Core's W10–W12 serving paths. Updates the cohort (unverified senders, group/room and GKS memory admitted; only malformed group `/work`, thread-less group events, unknown grounding modes and non-opted-in accounts stay `SERVER`), adds the Core fences (`runtimeSenderAuthority` and the `CHANNEL_IDENTITY_ADMITTED` record, the PENDING principal binding, the out-of-hours memory refusal, group memory scope, GKS composition in `memory read`, the per-speaker MSP erasure scanner) and the new deliberate differences, identities and trace kinds. *What remains*: unverified identities, group/room memory, memory with GKS and group erasure for later speakers are done; adds the operator pre-deploy list (#596's three migrations in order, the backfill re-run until 0 rows, the `RETENTION_TOMBSTONE` query, MSP TASK-MEMOS-004) and the review follow-ups of #600, #602 and #604 as residual gaps. Every claim was checked against the code at `c91db083`. The 0.3.15b section is kept, retitled as superseded; ADR-106, SDD-110, FR-265 and the PRD are unchanged.

`0.3.14b → 0.3.15b`: rewrites *Current state* for base `main` `cc44ab86` (PR #592, which merged W1–W5 and W7–W9 from #583–#585 and #587–#591; W6 #586 was merged as `b96aec1d`). Lists the PRs with their heads and merge SHAs. Records `reviewed_contracts` as done (#581, #586 with its PostgreSQL run and review, and the combined re-run on #592) and adds #592's and `main`'s hosted CI (runs `36317164514` and `36317831755`) to `required_checks`. `accepted_scope_complete` stays open only for W10 (unverified identities, #597). Adds the runtime cohort and the Core pins and fences at that SHA. Replaces *What remains*: memory-sync, out-of-hours, group/room, malformed `/work`, WorkTool parity, grounding modes, `#sku`, post-model parity, the send contract and the length gap are done; the residual gaps the PRs recorded are kept as rows, with the `RETENTION_TOMBSTONE` operator query from #588. Every claim was checked against the code at `cc44ab86`. The 0.3.14b section and older sections are kept and labelled as superseded; ADR-106, SDD-110, FR-265 and the PRD are unchanged (W10 owns those edits).

`0.3.13b → 0.3.14b`: adds *Current state* at base `main` `3452429f`. It maps each `CR_TO_WM` gate item to its source and current state. It records that model provider/consumer conformance (45/45) ran and passed in the required hosted `tests` job at `b21a3552`, so the earlier NOT_RUN was stale. It adds the WorkToolPort suite against the real Core provider (6/6 locally, with a drift check) and extracts the Runtime's `createCorePorts` from `main.js` without changing behaviour (3 new unit tests). It lists the remaining scope with size estimates, including two gaps found by code reading: WorkTool answer and error parity, and unsupported grounding modes on opted-in accounts. Accepted-scope completeness stays open pending a user decision on scope.

`0.3.12b → 0.3.13b`: adds *Merged state* for PR #542 (merged 2026-09-27 as `4b6d8eb7`, head `b21a3552`): MC0 takeover, the ADR-110/SDD-110 renumbering, the 191-table Phase B rebind, the `apps/edge` retirement and hosted evidence at the merged head. The extraction stays partial against ADR-106; earlier sections are kept as history.

`0.3.11b → 0.3.12b`: corrects the handoff to record commit `2557bb32346ef300329f828a0c5dc3f207cf52ba` and the completed PR-body update; branch push and corrected-head CI remain pending. The Phase-B rebind, test counts, and acceptance limitations are unchanged.

`0.3.10b → 0.3.11b`: records focused Phase-B evidence (2 files / 13 passed), current governance (0 critical / 1 warning / 32 info; `docs:check` current), the incomplete `npm run verify` caused by port 3100 being occupied at E2E startup, and the separate passing full E2E run at port 31920 (207 passed, 4 skipped). It distinguishes published-head hosted Compose/image/smoke PASS from the still-unhosted local re-pin candidate. Provider/consumer conformance remains unverified; no production activity is claimed.

`0.3.9b → 0.3.10b`: records OPERATOR's push of `2e2154de` and fresh CI result, then documents the user-directed exact Phase-B schema rebind for the two runtime-owner fields. The 188-table mapping, recovery algorithm and fail-closed behavior stay unchanged; previous schema-bound snapshots remain refused. Adds assertions that the prior binding is rejected and runtime ownership survives safe restore. The rebind commit is local pending push; new CI, hosted image build/smoke and full regression are not yet verified. No production migration, deployment, live LINE send or real model call is claimed.
