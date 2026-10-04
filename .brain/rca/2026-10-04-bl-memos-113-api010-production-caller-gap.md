# RCA — BL-MEMOS-113 API-010 production caller gap

**Date:** 2026-10-04  
**Version:** 1.6
**Risk:** C-3 / HIGH  
**Status:** Root cause confirmed; Zuri working-tree candidate implements the caller and receipt path; production activation remains gated.

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
