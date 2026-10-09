---
version: "0.4.15b"
created_at: "2026-08-15T00:00:00+07:00,ATHER"
last_update: "2026-10-04T19:41:38+07:00,Codex"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "implementation-plan"
  scope: "FR-057 / Issue #11"
---

# Implementation plan — FR-057 authorized agent context

## Complexity and risk

Architecture/security change, C-3, HIGH risk. Implementation is limited to the
Zuri-side authorization seam and an MSP adapter contract. No production activation,
MSP schema migration, or Supabase privilege change is included.

## Verified integration gap — 2026-10-04

At Zuri `origin/main` `a6e295a5`, `serverLinePorts()` composes the API-011 thread
memory port, while `createAgentPorts()` composes the API-010 resolver with the
API-009 memory port. A source call-site search found no production caller of
`createAgentPorts()`. The API-011 session path therefore does not close FR-057's
API-010 → API-009 caller gap. The current Zuri worktree wires and tests that
caller, but has not yet been pushed or reviewed.

At that baseline, admission opt-in was captured from
`ZURI_MSP_THREAD_MEMORY_ENABLED`; `LineOaAccount.memoryPolicy` was absent from
Prisma. The deployment flag did not prove per-account policy or consent.

MSP `origin/main` remains `4928e71d42687b4eb72de060091d031ea22b5b91`; its
API-010 contract does not require the signed `legacy_access` grant. The required
contract and implementation are on the pushed branch
`origin/codex/rsk-memos-12-vault-resolve-fail-closed` at
`fd6c24b0d6d6f2e51b67cd39c775d962057eba0c`, which has no PR yet. Production
activation requires reviewed support for that contract on MSP main.

## Boundary for the next implementation slice

The API-010 → API-009 caller is for private episodic memory only. It must consume
server-derived scope and policy, deny when owner or consent is missing, require
`consentStatus = GRANTED` and `audienceKind = DIRECT` for episodic/passport or
cross-thread access, and use only the authorized Workspace Private vault returned
by API-010. API-011 remains the distinct session/thread path under ADR-091.

Before any production activation, the signed API-010 contract must be present on
MSP main; Zuri must have a trusted per-turn policy/consent source and verified
API-010/API-009 composition tests; and erasure, receipts, rollback and deployment
acceptance must be recorded. Until then the path remains off. This plan amendment
does not certify deployment readiness.

## Policy hardening slice — 2026-10-04

This patch implements the OFF-by-default account policy and API-011 session
kill switch while keeping episodic access separate. It does not wire the missing
FR-057 API-010 → API-009 caller:

- `LineOaAccount.memoryPolicy` is publisher-set `OFF | ON`, defaults to `OFF`,
  and is changed through the existing versioned publisher action. Existing rows
  remain `OFF` after the additive migration, and the immutable `memorySyncOptIn`
  job snapshot records that account policy at admission.
- `ZURI_MSP_THREAD_MEMORY_ENABLED` is a runtime kill switch, not an admission
  grant. The Server checks it before session-memory operations and the delivery
  scanner does not call MSP while it is off. Turning it off leaves pending
  receipts parked; turning it on can resume only jobs whose account-policy
  snapshot was already `ON`.
- `episodicMemoryOptIn` remains false because LINE has no approved trusted
  workspace/project mapping. Do not mint defaults or accept either value from
  LINE input. `resolveAgentAuthorization()` separately requires the persisted
  episodic snapshot, current `Customer.consentStatus = GRANTED`, DIRECT audience,
  and a resolved workspace/project before it allows the API-009 memory port.
- The API-010 resolver and API-009 port reject a context without episodic
  authorization before transport. They remain unconnected to the production LINE
  composition, which still uses API-011. No API-010 call or episodic retrieval is
  claimed by these changes.
- No production activation, MSP migration, data write, or branch merge is part
  of this slice. MSP main must first accept the signed grant contract and
  trusted scope mapping, caller receipts/erasure, rollback, and deployment gates
  must be independently satisfied.

At baseline, there was no production LINE API-010→API-009 caller and no trusted
workspace/project owner tuple. The earlier policy-only change reduced accidental
access but did not close FR-057. The current working-tree candidate below adds
the owner mapping and production composition, subject to MSP and release gates.

## Owner-selected mapping and remaining FR-231/FR-232 gates — 2026-10-04

The owner selected a Publisher-controlled Development Project association per
LINE OA account. The server derives the Workspace from that Project and checks
both records against the account's Tenant and Business. Only the Project ID is
stored on the account; the job snapshots the Project and derived Workspace at
admission. The caller revalidates that mapping before any API-010/API-009 call.
The LINE payload and model remain untrusted for scope.

The current candidate stores that mapping, derives the Workspace, and wires the
opted-in LINE context through API-010 before API-009. The adapter requires the
signed `legacy_access` contract, verified transport/identity, and a matching
private-vault grant. `ZURI_MSP_EPISODIC_MEMORY_ENABLED` remains an independent
default-off kill switch.

Every acknowledged API-011 message now has a durable `MemoryProjectionReceipt`.
Inbound and outbound append receipts are persisted immediately after MSP
acknowledges them; the outbound CRM message ID and delivery acknowledgement are
attached in the same transaction that settles the local delivery state. The
tenant/principal erasure worker marks receipts `PENDING_MSP`, requests API-009
vault erasure when episodic receipts exist, then records MSP's erasure receipt
and marks the affected rows erased after acknowledgement.

Erasure request granularity follows the owner's 2026-09-28 option A decision in
CONVERSATION-RUNTIME-HANDOFF.md v0.3.18b, delivered in merged PR #614: exactly
one tenant-wide MSP erase per `(tenant, principal, erasure request)`, including
DIRECT-only memory. The worker's one acknowledged request settling the affected
projection receipts matches that contract; it does not need one MSP request per
receipt. This does not close FR-232's separate consent-decline or GKS
withdrawal/correction work.

```mermaid
flowchart TD
  A[Publisher selects Project per LINE OA account] --> B[Account stores Project ID]
  B --> C[Admission derives and validates Project Workspace]
  C --> D[Job snapshots both IDs for verified, consented DIRECT turns]
  D --> E[AuthContext revalidates owner and policy]
  E --> F[API-010 resolves authorized Workspace Private vault]
  F --> G[API-009 reads only the returned vault]
  D --> H[API-011 session/thread path with separate policy and receipts]
  H -. does not supply scope .-> E
```

## Independent runtime caller boundary — 2026-10-04

ADR-091 D4 requires API-010 → API-009 episodic retrieval to remain a separate
authorization and rollout path from API-011 session/thread memory. This applies
to both the legacy Server worker and Conversation Runtime cohort. API-010 reads
must be based on the claimed job's immutable episodic opt-in, verified LINE
principal, current granted Customer consent, DIRECT audience, and revalidated
Publisher-selected Development Project for the LINE OA account. The server
derives its Workspace from the live Project, validates Tenant and Business on
both records, and compares both current IDs with the job's admission snapshot
before each API-010/API-009 call. LINE payload fields cannot provide this scope.
API-010 reads must not depend on
the API-011 `memory.read` operation or on
`ZURI_MSP_THREAD_MEMORY_ENABLED`.

When the API-011 kill switch is off, the Conversation Runtime must still be able
to compose an authorized API-010 episodic slice into the existing prompt context
within the Context Composer's budget, and must make no `msp_thread_*` request or
require an API-011 append. When the API-011 flag is on, its own read/append and
receipt rules remain unchanged. Missing scope, consent, identity, grant or the
API-010 feature flag returns no episodic slice and makes no API-009 request.

The shared Runtime composer treats an authorized API-010 `CROSS_THREAD` slice
as independent of the active API-011 thread ID, but only for a DIRECT turn.
API-011 thread-scoped slices still require the active thread ID; GROUP and ROOM
turns receive no cross-thread or passport slice.

Complete required receipt writes before the final live authorization/erasure
fence in both runtime cohorts. For the Server caller, persist the local
ContextReceipt first. For Conversation Runtime, persist the pre-provider
injection states first. Put the final live fence inside the provider callback
and call the model immediately after it without another awaited step.

```mermaid
sequenceDiagram
  participant C as LINE caller
  participant R as Required receipt store
  participant L as Live authorization/state
  participant M as Model provider
  C->>R: Persist pre-provider receipt state
  R-->>C: Write completed
  C->>L: Revalidate job, erasure, identity, consent and scope
  alt Still authorized
    L-->>C: Allow
    C->>M: Generate immediately
    M-->>C: Result
    C->>R: Persist receipt completion where required
  else State changed or erased
    L-->>C: Deny
    C-->>C: No model call
  end
```

Acceptance evidence for this boundary:

- With API-011 disabled and API-010 enabled, a consented DIRECT runtime turn
  resolves the vault before listing memory, includes only composer-retained
  episodic slices, and performs no `msp_thread_*` calls.
- With an active API-011 thread, the composer retains an authorized API-010
  `CROSS_THREAD` slice on a DIRECT turn without a thread-ID match, while a
  thread-scoped MSP slice still requires the exact thread and GROUP/ROOM turns
  drop cross-thread slices.
- With GKS grounding, API-010 enabled and API-011 disabled, the runtime reads
  GKS during `prepare`, composes GKS and episodic slices under one budget, and
  gives the model only the GKS records retained by that composer. If none fit,
  it returns the existing no-evidence reply without invoking the model.
- Backup recovery validates episodic DIRECT audience and the trusted
  Project/derived Workspace snapshots independently of API-011 session opt-in,
  preserves both IDs under a valid manifest, and clears them when recovery is
  unavailable.
- With API-010 denied or scope/consent missing, no `msp_memory_list` call occurs;
  the normal answer path remains available without personal memory.
- With API-011 disabled and an opted-in account, the turn completes without an
  API-011 append requirement. With API-011 enabled, existing thread read/write
  and delivery-receipt tests continue to pass.
- A moved, deleted, archived or cross-scope selected Project/Workspace denies
  episodic retrieval before API-010 or API-009.
- If erasure or current authorization changes while API-009 is in flight, both
  runtime cohorts re-read the claimed job, account scope and current identity/
  consent before the model side effect; an unavailable or changed state fails
  closed independently of the API-011 feature flag.
- If erasure commits during Server ContextReceipt or Runtime pre-provider
  injection-receipt persistence, the final live fence blocks model generation.
- No asynchronous receipt or lease operation runs between a successful final
  live fence and provider entry.
- A mixed API-010/API-011 prompt keeps API-011 injection receipts around the
  provider call whenever any API-011 packet is included, even if the composer
  trimmed some of that packet.
- The API-011 delivery scanner refuses an inbound projection whose erasure
  status is pending or complete, including after its policy recheck.
- Test doubles return the message IDs their append operation acknowledged, and
  authorized API-010 fixtures explicitly set current consent, trusted scope and
  `episodicMemoryAllowed`.
- The Phase B frozen recovery inventory and parent decision are rebound to the
  `MemoryProjectionReceipt` schema using the repository's count/hash functions;
  stale-schema refusal remains enforced.

The first full verification before the recovery correction passed governance
but stopped at `npm test` with 7,864 passed, 43 skipped and 23 failed across 13
files. RCA v1.10 traced those failures to the obsolete requirement that
episodic opt-in imply API-011 session opt-in. After the independent recovery
fix, the affected backup/recovery files passed 93/93 focused tests and the full
`npm run verify` passed: Conversation Runtime 73/73; Server Vitest 7,887 passed,
43 skipped across 850 passing files and 5 skipped files; production build
passed; Playwright E2E 208 passed, 4 skipped. Governance and generated-document
checks passed with 0 critical findings; the strict preflight retained 21
existing warnings and the document graph reported 10 existing dangling
references. This local verification does not satisfy hosted CI or production
release gates.

Release remains blocked: the signed API-010 contract is still absent from MSP
main. A local Zuri-resolver-to-MSP-handler contract run passed; hosted CI,
rollback acceptance and deployment evidence have not been recorded. FR-232 also remains open for
consent-decline Tier-1 tombstoning and GKS source withdrawal/correction. The
existing principal-erasure receipt worker does not implement those separate
paths.

### Version history

| Version | Change |
|---|---|
| 0.4.13b | Defines the DIRECT-only composition rule for API-010 `CROSS_THREAD` slices while preserving API-011 thread isolation. |
| 0.4.11b | Records passing full local verification after the API-010-only backup-recovery correction; keeps hosted CI and production gates open. |
| 0.4.9b | Revalidates the Publisher-selected LINE account Project and its live derived Workspace against the immutable admission snapshot before independent API-010 retrieval; records full verification repair scope. |
| 0.4.12b | Adds an API-010 liveness/current-authorization fence before model invocation and retains API-011 receipt lifecycle for partially composed mixed context. |
| 0.4.8b | Requires API-010 episodic retrieval to run independently of API-011 in both Server and Conversation Runtime cohorts; adds disabled-gate and fail-closed acceptance evidence plus full-verification gaps. |
| 0.4.3b | Owner-selected Project mapping and derived Workspace are recorded; mapping, caller, receipt and erasure work remained open. |
| 0.4.4b | Records the implemented API-010/API-009 LINE caller, durable API-011 projection receipts, and vault-aware principal erasure; preserves MSP-main, CI, rollback, consent-decline, GKS and deployment gates. |
| 0.4.5b | Adds the architecture boundary diagram for Project-derived API-010 scope and the separate API-011 session path; records verification defects fixed and release blockers. |
| 0.4.7b | Reconciles the FR-232/ADR-091 erasure note to the owner's tenant-wide per-principal erasure decision; preserves consent-decline and GKS gates. |
| 0.4.6b | Refreshes verified Zuri/MSP main and branch refs; records that the signed API-010 contract is pushed but unreviewed and production remains gated. |

## Work order

| Work | Deliverable | Proof |
|---|---|---|
| W0 | Register FR-057, ADR-022, NFR-014, BR-015, SEC-013, SDD-030 | docs graph/preflight |
| W0.5 | Add OFF-by-default account policy and immutable session/episodic admission decisions | migration, account-action and admission tests |
| W1 | AuthContext and deterministic policy resolver | unit tests for deny-by-default and revocation |
| W2 | Server-owned scope plus GoVibe API-010 `msp_vault_resolve` adapter | API-010 contract tests; no raw vault injection |
| W3 | Bind identity, thread, session and policy to the agent turn | integration tests for group participants |
| W4 | Preserve legacy API-009 adapter behind explicit compatibility mode | migration and fail-closed tests |
| W5 | Consume API-010 resolved IDs/permissions in canonical API-009 memory operations | resolver and conformance tests |
| W6 | Review Supabase/RLS boundary and run full gates | `npm test`, build, docs checks |

## Exit gates

- no private memory retrieval occurs before an allow decision;
- no model or client value changes tenant, business, agent, workspace, project, or vault;
- canonical memory calls API-010 on every turn and use only its returned Workspace
  Private ID for private API-009 operations;
- same multi-principal group fixture proves private isolation;
- identity/membership revocation denies on the next turn;
- all existing FR-021..029 and MSP adapter tests remain green;
- documentation graph and preflight are regenerated and clean;
- production LINE binding and MSP rollout remain disabled.

## Rollback

Disable the structured private-memory path and use bounded current-turn context or
the reviewed compatibility adapter. Preserve audit receipts and do not delete legacy
MSP data during rollback.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.4.15b | 2026-10-04 | beta | Closes Server and Runtime receipt-time erasure races; focused final tests and builds pass, with full verify evidence labeled pre-correction | working-tree | Codex |
| 0.4.14b | 2026-10-04 | beta | Completes required receipt writes before both cohorts' final live authorization fence and blocks provider entry after concurrent erasure | working-tree | Codex |
| 0.4.13b | 2026-10-04 | beta | Allows authorized API-010 `CROSS_THREAD` slices in DIRECT runtime composition while keeping API-011 thread matching and GROUP/ROOM denial | working-tree | Codex |
| 0.4.11b | 2026-10-04 | beta | Full local verification before the receipt-ordering correction: 7,890 server tests and 208 E2E tests pass; 43 server and 4 E2E tests skipped; hosted CI and production gates remain open | working-tree | Codex |
| 0.4.10b | 2026-10-04 | beta | Requires GKS evidence and API-010 slices to share the runtime budget with API-011 disabled; validates API-010 scope independently in snapshot recovery | working-tree | Codex |
| 0.4.9b | 2026-10-04 | beta | Requires live Project-derived Workspace revalidation per LINE OA account before API-010/API-009 access; binds it to the job snapshot | working-tree | Codex |
| 0.4.8b | 2026-10-04 | beta | Requires independent API-010 episodic retrieval in both LINE cohorts, separate from API-011 kill-switch and read behavior | working-tree | Codex |
| 0.4.12b | 2026-10-04 | beta | Rechecks current erasure, authorization and scope before model use; requires API-011 receipt lifecycle for included partial thread context | working-tree | Codex |
| 0.4.7b | 2026-10-04 | beta | Reconciles erasure request granularity with the owner decision while retaining consent-decline, GKS and release blockers | working-tree | Codex |
| 0.4.6b | 2026-10-04 | beta | Refreshes remote head evidence; records the pushed MSP contract branch, absent PR, and current production blockers | working-tree | Codex |
| 0.4.5b | 2026-10-04 | beta | Adds the scope and runtime boundary diagram; records the implemented caller, receipts, principal erasure and remaining release gates | working-tree | Codex |
| 0.4.4b | 2026-10-04 | beta | Records the implemented API-010/API-009 LINE caller and keeps MSP-main, CI, rollback, consent-decline, GKS and deployment gates open | working-tree | Codex |
| 0.4.3b | 2026-10-04 | beta | Separates account-policy admission from the runtime kill switch and records that episodic mapping/caller remain blocked | working-tree | Codex |
| 0.4.2b | 2026-10-04 | beta | Requires trusted workspace/project mapping for episodic eligibility | working-tree | Codex |
| 0.4.1b | 2026-10-04 | beta | Clarifies the runtime kill switch and fail-closed workspace/project mapping gate alongside the account policy and consent snapshots | working-tree | Codex |
| 0.4.0b | 2026-10-04 | beta | Specifies the OFF-by-default publisher policy, admission snapshots, current-consent API-010 gate, and read-only episodic caller boundary | working-tree | Codex |
| 0.3.0b | 2026-10-04 | beta | Records the absent production API-010 caller, separates API-011 session context, and lists contract/policy/erasure activation gates | working-tree | Codex |
| 0.2.0b | 2026-08-15 | beta | Approved API-010 canonical resolver implementation plan | working-tree | ATHER |
