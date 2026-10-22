---
doc_type: intake-note
title: TASK017 FlowAccount FR-290 exact-base reassessment
status: approved
superseded_by: null
version: "1.0.0"
date: "2026-10-22"
complexity: C-4
risk: HIGH
---

# TASK-ZAI-017 — FlowAccount additive FR-290 reassessment

## Decision and authority

This dated reassessment resolves the identity collision found after selecting the exact current-main base. Root authorized the bounded current-main FR-290 reissue candidate in the task delegation on 2026-10-22. Approval covers one additive, planned FlowAccount connector requirement under FR-290 and the independent migration replay-idempotence correction/test from PR #712. It does not authorize FlowAccount access, OAuth, credentials, live tool calls, provider activation, production or Supabase changes, or implementation completion.

The prior TASK-ZAI-017 source on PR #712 head version 0.1.2 described FR-289 as provisional and explicitly required stopping to reassess when an exact-base scan finds a collision. This document records that stop and reassessment. It supersedes only the candidate's provisional number assignment; it does not amend FR-289 meaning or grant implementation/provider authority.

## Exact-base identity decision

Selected base: `8dc8ce578e5f35dfdbc0bd5d5f23ca6e9a8cd588` (`origin/main`). At this base, `docs/requirements/FR-289.md` is the published Knowledge Studio read-only installation-operator requirement; its SHA-256 is `45d44d60222b11e883e832eca8bf4ed7f67b9df566752a678b3d776ac014c532`, its Git blob is `c860996ccb6d5f40027709ea7b4bc594171c4691`, and its ledger subject anchor is `zuri knowledge studio is an installation operator only read`. Preserve that document, statement, subject, approval, migration and receipt unchanged. Do not abandon, reword or assign FR-289 to FlowAccount.

The bounded FR-290 audit ran on 2026-10-22 before this source was created. It searched the exact string `FR-290` in the document, registry and server runtime projection scopes across all 287 Git refs, including PR refs and tags, and found zero hits. It searched the same scopes in all 5 registered worktrees and found zero hits. It enumerated 8,725 files in the shared `.git/zuri-delivery-control` evidence tree after excluding this task's new readiness record; exact-text search of non-database evidence files found zero hits. Tracked/on-disk `docs/` inventory also matched at 1,572/1,572. The search is bounded to these enumerated refs, worktrees and evidence roots; it is not a claim about external archives.

FR-290 is therefore the available additive identity on this exact base. The FlowAccount statement below is retained byte-for-byte as a statement; only the canonical ID and dated migration identity are reissued. Its exported status remains `planned`, consistent with the Task017 roadmap row.

## Additive FR-290 record

The exact statement approved for the fresh current-base migration is:

> Official FlowAccount MCP connector: Support only the fixed official HTTPS endpoint through provider-verified OAuth and a documented MCP protocol/version; unverified transport, metadata, scopes, tool schemas, or company identity returns a typed unavailable result without guessed requests or REST fallback. Resolve the authenticated viewer and Business server-side, bind exactly one provider-selected company to one Business, and use the existing credential-write guard. OAuth state is short-lived, hashed, single-use, and bound to actor, tenant, and Business; the callback validates current ownership and scope and atomically consumes unexpired state before code exchange or credential storage; mismatch, replay, expiry, or a concurrent loser causes no provider request or credential write. Store access and refresh material only as a distinct FLOWACCOUNT_MCP_OAUTH_TOKEN through SecretStorePort; do not reuse OAUTH_CLIENT or NOTION_OAUTH_TOKEN, and fail closed if the typed store is unavailable. Capability discovery persists a bounded redacted manifest and exact schema digest but grants no authority; the read allow-list starts empty, and execution requires a reviewed exact tool identifier and schema digest. Deny unknown or mutating tools, including create, edit, delete, status, payment, and attachment, regardless of provider annotations. Ingest mapped reads only through FR-081 into RawExternalRecord, paired with an immutable Integration-owned FK sidecar carrying the reviewed capability identifier, manifest and tool-schema digests, trusted scope, and correlation. Commit raw and provenance rows atomically; idempotent replay validates and returns the matching pair, while orphaned or mismatched provenance fails closed and is quarantined. Do not overload sourceUri, entityType, schemaVersion, or payload for capability provenance. Safe audit events link the correlation without secrets or raw provider payload. Disable all live tool calls and live payload persistence until separate reviewed provider access, verified exact provider contract, and privacy/data-lifecycle acceptance define purpose, data categories, isolation, retention/deletion, erasure through raw and derived records, legal holds, and backup/export/restore. Local fixture tests cover state, binding, transport bounds, host/redirect rejection, allow-list and mutation denial, secret redaction, atomic provenance, idempotent replay, audit, and disconnect without contacting FlowAccount. Results remain external evidence, not accounting-domain truth or completeness; no production or Supabase change is included.

This requirement remains a bounded candidate contract. The official provider transport/version, OAuth metadata and scopes, tool identifiers/schemas, result identity and pagination semantics remain unverified. Live reads and payload persistence stay disabled pending separately reviewed provider access and privacy/data-lifecycle acceptance. No outgoing MCP client, provider acceptance, OAuth or live-read evidence is claimed, and the roadmap Task017 state remains planned / UNKNOWN / NOT_STARTED.

## PR #712 reconciliation

PR #712 head is `06153cf795c9f22eeb27ed1dd8afdff662bd0087`; its FlowAccount 2026-10-18 source, approval copy, manifest and APPLIED receipt are historical artifacts on `refs/remotes/pr/712/head`. Their SHA-256 values are respectively:

- source and historical approval copy: `82987a303dabbcb267c6f21c15e3193bb72980175868fc8037c5f9c344c2749b` (identical bytes);
- historical manifest: `87140b1fdab2afc75e4b56879747661f2fd93c91eb1c1c56fa18025a5f1da25f`;
- historical APPLIED receipt: `76ae2343755a56041b184016d2c8be48ce6f34d588eb76a47f43656e8b07f004`.

The old 2026-10-18 source, approval copy, manifest and receipt remain on that historical ref unchanged and are not copied into this current-base migration. The Task048 binary parsing changes are already present on current main, so this candidate retains the current-main implementation. It re-applies only PR #712's still-valid `verifyApplied` replay fix and regression expectation in `tools/document-record-migration.mjs` and `tools/tests/document-record-migration.test.mjs`.

## Rule-check record

- `taskId`: `TASK-ZAI-017` / PR #712 current-base reconciliation.
- `action`: select the additive record identity, create the dated approval source and prepare the final migration receipt.
- `trigger`: `SOURCE_CHANGED` — exact current base and published identity differ from the provisional source context.
- `source document ID`: `ZAI:PM-MULTI-AGENT-DELIVERY`.
- `source path/version/raw-byte SHA-256`: `docs/architecture/project-manager-system/20-MULTI-AGENT-DELIVERY-PLAN.md`, `0.9.33b`, `FED035C70C4D88DF8F82F6707158CF5B9E031A00D4D2E894B5EA5C1DD6367D6C`.
- `section locator`: `#pm-task-rule-entry` (lines 47–62), `#pm-rule-check` (lines 183–190), and `#pm-claim-reconciliation` (lines 193–195).
- `relevant clause/applicability`: inspect the selected task and current source; candidate selection is rooted in §§4–6; a rule-check names the source/version/hash, locator, applicability and uncertainty; an absence claim reports its enumerated scope. Reading these clauses does not grant approval. Root's task delegation supplies the bounded authority recorded above.
- `read command/evidence locator`: read current source with `Get-Content docs\architecture\project-manager-system\20-MULTI-AGENT-DELIVERY-PLAN.md`, including the task-entry and rule-check sections; source file at the selected base and digest above.
- `uncertainty`: provider contract, OAuth/tool schemas, provider access and all live acceptance remain UNKNOWN and outside this approval.

## Approval

Sol root approved this dated reassessment and the FR-290 reissue on 2026-10-22 within the root delegation for PR #712 reconciliation. The new migration must use the existing sanctioned document-record migration writer against a fresh current-base manifest. Generated registry/index/ledger/compatibility/domain-state projections must come from their existing generators. Preserve the historical 2026-10-18 APPLIED receipt and proofs by leaving their original ref untouched; do not copy them or represent them as evidence for current main.
