---
id: ZAI:FR-171-NOTE
version: "1.0.0"
status: accepted
created_at: "2026-09-07T23:10:12+07:00,RWANG"
last_update: "2026-09-07T23:18:03+07:00,RWANG"
domain: agent
feature: FR-171
module: agent
source: v2-native
contract_version: "execution-trace-replay.v0.3"
relations:
  - type: relates_to
    target: ZAI:ADR-070
  - type: relates_to
    target: ZAI:ADR-043
  - type: relates_to
    target: ZAI:ADR-044
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:FR-057
  - type: relates_to
    target: ZAI:FR-091
  - type: relates_to
    target: ZAI:FR-093
  - type: relates_to
    target: ZAI:FR-149
  - type: relates_to
    target: ZAI:FR-150
  - type: relates_to
    target: ZAI:FR-171-P1
---

# FR-171 — Execution Trace & Replay v0.3

This feature contract is approved for implementation under the phase gates. It
records the design and acceptance tests; it does not claim that the model,
route, tests or external adapters are implemented.

## Intent

For every observable step of a server-owned LINE agent turn, Zuri needs a
scoped evidence chain that can identify the exact input, the execution and
instance that handled it, the context and external version references it used,
and the delivery evidence that followed. A trace must preserve what is known
and label what is missing. It must not create a second business conversation,
memory, knowledge, delivery or provider authority.

The first implementation lane is the native SERVER LINE path and one reusable
local journal contract. MSP, GKS and the optional Edge executor remain adapter
and external-evidence gates described below.

## Surface and ownership

The agent domain owns one `AgentTraceEvent` journal model. The first reader is:

```text
GET /api/line-oa/jobs/{id}/trace
```

The route resolves the job, account and Business from server-owned state. It
requires a viewer who owns that Business and has `line-oa` domain visibility.
The route accepts no trace payload and has no mutation mode. It returns ordered
events and a read-only playback projection for that job.

The native SERVER path reuses the existing `LineConversationJob.id` as
`turnId`; it does not create a Turn table. The job's existing inbound message
and derived CRM conversation remain the conversation references. A nullable
`LineConversationJob.executionId` is filled only when a logical server
execution starts. The journal does not replace the job, CRM, AuditEvent or
FR-093 receipt owners.

## Journal shape

`AgentTraceEvent` is append-only and scoped. A single model carries all event
kinds; event-specific data uses typed JSON contracts with a stable version and
hash. The implementation must maintain SQLite and Postgres schema parity.

| Field | Contract |
|---|---|
| `id` / `eventId` | Internal UUID for this immutable journal row; never a provider id or a business key |
| `tenantId`, `businessId`, `accountId` | Derived server-side scope; the event writer never accepts these as authority from model, tool or client input |
| `conversationId`, `messageId` | Existing CRM references; a Message inherits Tenant/Business scope through its Conversation |
| `turnId` | Required turn lineage; native SERVER is the existing `LineConversationJob.id` |
| `executionId` | UUID for one logical execution; nullable before execution starts and never invented for a job that has not run |
| `instanceId` | Fresh UUID for one actual input, model call or tool invocation; every retry gets a new value |
| `sessionId` | Opaque MSP Soul session reference; nullable outside the MSP adapter |
| `ctxId` | UUID or opaque reference for the concrete runtime context assembled for an occurrence; never a local replacement for MSP context authority |
| `eventKind` | `TURN_INPUT`, `MODEL_CALL`, `TOOL_INVOCATION`, `RETRIEVAL`, `MEMORY`, `DELIVERY` or `EXECUTION_STATE` |
| `eventStatus` | `STARTED`, `SUCCEEDED`, `FAILED`, `UNKNOWN`, `EXCLUDED_BY_POLICY` or `FENCED`; status is evidence, never inferred success |
| `turnSequence` | Immutable monotonic order within a `turnId`; playback uses it before timestamps when concurrent events share a clock value |
| `toolAttemptId` / `actionAttemptId` | Stable logical tool/action attempt references; reused by lifecycle rows and retries, while `instanceId` changes per occurrence |
| `documentVersionRefs` / `artifactVersionRefs` | Arrays of stable owning-service references with version and hash/reference; no source body copy |
| `retrievalRefs` | Opaque GKS retrieval/evidence references with retrieval, corpus, snapshot or index version where supplied |
| `memoryVersionRefs` | Opaque MSP memory references with memory id/version and policy result where supplied |
| `memoryStatus` | `USED`, `NOT_USED`, `EXCLUDED_BY_POLICY` or `UNAVAILABLE`; native SERVER uses empty refs plus `EXCLUDED_BY_POLICY` when no private memory adapter is configured |
| `deliveryAttemptId` / `receiptRefs` | Stable transport attempt lineage and evidence references; acceptance, delivery and read remain separate states |
| `inputSnapshotJson` | Exact canonical semantic input bytes, maximum 1 MiB, immutable and never truncated; absent only with an explicit snapshot state |
| `inputSha256` | SHA-256 of the exact UTF-8 snapshot bytes, or of the exact input bytes when retention prevents keeping the body |
| `snapshotState` | `RETAINED`, `EXPIRED`, `REDACTED`, `EXCLUDED_BY_POLICY` or `TOO_LARGE` |
| `provider` / `providerModel` / `providerRequestRef` | Nullable provider evidence; no provider credential, access token or LINE reply token |
| `providerUsage` | Nullable reported subsets: `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens`, `reasoningTokens`; no estimates |
| `startedAtUtc`, `finishedAtUtc`, `occurredAtUtc`, `recordedAtUtc` | Source timestamps are nullable unless truthful; `recordedAtUtc` is the server append time, persisted as UTC |
| `recipientStatus` / `recipientRef` | `UNKNOWN` by default; a reference is populated only from trustworthy transport/provider evidence |
| `redactionState` / `redactedAtUtc` | One-way PDPA retention state and UTC redaction time; no replacement content after erasure |

The semantic `eventKind` values are projected into the native SERVER journal's
concrete `kind` vocabulary: `TURN_RECEIVED`, `EXECUTION_STARTED`,
`CONTEXT_COMMITTED`, `EVIDENCE_SELECTED`, `MODEL_COMPLETED`, `MODEL_FAILED`,
`ANSWER_READY`, `EXECUTION_FAILED`, `SEND_STARTED`, `SEND_RESULT`,
`OUTBOUND_RECORDED`, `TOOL_INVOKED`, `TOOL_RESULT`, `ACTION_STARTED`,
`ACTION_RESULT`, `MEMORY_WRITTEN`, `ARTIFACT_CREATED` and
`RETENTION_TOMBSTONE`. The implementation stores these event-specific fields
in typed `payloadJson` on the one journal model; this vocabulary does not add
separate trace tables.

The event kind determines which fields are required. A model call and tool
invocation require `executionId`, `instanceId`, input hash and snapshot state;
retrieval and memory events require their reference arrays and policy result;
delivery events require delivery lineage and receipt state. An execution-state
event may carry a null `instanceId` when it describes the execution as a whole.
The validator rejects a missing required field instead of filling it with a
placeholder.

## Identity and lineage rules

The contract distinguishes transient occurrence identity from stable lineage:

| Identity family | Rule |
|---|---|
| Turn/execution/instance/session/context | `turnId` follows the existing job; `executionId`, `instanceId` and `ctxId` are UUID/reference values for the actual occurrence; `sessionId` belongs to MSP and is nullable here |
| Tool/action attempts | `toolAttemptId` and `actionAttemptId` identify the logical attempt across start/result/failure and retries; a retry never overwrites an event and receives a new `instanceId` |
| Document/artifact versions | References include the owner id, version and hash or immutable URI. A changed source is a different version even when its filename is unchanged |
| Retrieval versions | GKS owns the retrieval and corpus/index identity. Zuri stores an opaque reference and does not copy a knowledge graph or query result into an authority table |
| Memory versions | MSP owns the session and memory policy. Zuri stores the opaque version refs it returns or an explicit exclusion state |
| Delivery attempts and receipts | One transport attempt keeps one `deliveryAttemptId`; receipt callbacks append evidence tied to it. A new provider attempt receives a new delivery id |

`turnId`, `executionId`, `instanceId`, `sessionId` and `ctxId` are never
interchanged with a business `WorkItem`, CRM external thread id, provider
request id, document id, artifact id or GKS/MSP authority id.

## Exact input and retention contract

The writer takes the exact canonical semantic input at each input, model and
tool boundary. It stores the exact JSON bytes up to 1 MiB and hashes those same
bytes with SHA-256. The writer never truncates a body, reserializes it after
hashing or reconstructs it from a later state. The semantic boundary already
excludes transient LINE credentials and reply tokens, which must never appear
in a trace or audit payload.

When a snapshot is too large, excluded by policy, expired or redacted, the
event keeps the hash and reason when policy allows and sets the corresponding
`snapshotState`. It does not pretend to have a replayable body. A retained
snapshot is immutable until PDPA erasure performs the documented one-way
redaction.

Playback computes:

```text
REPLAY_COMPLETE   every required snapshot, version reference and receipt evidence is present
REPLAY_INCOMPLETE one or more required pieces are expired, excluded, redacted or unavailable
UNAVAILABLE the requested job or trace is not visible to the caller
```

`REPLAY_COMPLETE` means the recorded evidence can be displayed as one coherent
timeline. It does not mean that the provider, tool, MSP, GKS, Edge runtime or
LINE side effect may be called again. A missing piece is named in the response
and never inferred from a sibling event.

## Read-only playback and scope

`GET /api/line-oa/jobs/{id}/trace`:

- derives the account, Business and Tenant from `LineConversationJob`;
- requires Business ownership and `line-oa` domain visibility;
- returns only events within that job's scope, ordered by `turnSequence`;
- includes hashes, references, snapshot states, nullable usage, truthful UTC
  times, recipient evidence and the computed playback status;
- performs no model, tool, retrieval, memory, Edge or LINE call;
- creates no event, attempt, receipt or outbound CRM message; and
- does not mutate the job, conversation, memory or knowledge stores.

Late external callbacks are accepted only while the job's execution/lease/
transport epoch fence still matches. A stale callback is refused or marked
`FENCED` and cannot replace the earlier event or receipt.

## Authority and adapter boundary

The first implementation is deliberately narrow:

| Authority | v0.3 contract | Implementation status |
|---|---|---|
| Zuri native SERVER | Writes the local journal and serves scoped playback for the LINE job path | Initial implementation lane; no completion claim in this document |
| MSP | Owns Soul memory session, memory policy and runtime context assembly | External adapter and cross-repository evidence pending |
| GKS | Owns canonical retrieval, corpus and index versions | External adapter and cross-repository evidence pending |
| Edge | Owns optional local execution under ADR-061 and returns bounded callbacks | External adapter, installed-device proof and canary pending |
| LINE transport | Owns provider calls and factual delivery receipts under FR-093 | Existing transport contract is referenced; trace integration is a phase gate |

Native SERVER v0.3 has no private memory adapter. Its trace therefore records
`sessionId: null`, `memoryVersionRefs: []` and `memoryStatus:
EXCLUDED_BY_POLICY`. It never mints a fake MSP id. Zuri never writes an MSP,
GKS or GenesisBlockDB database directly; each future adapter returns typed
references through a port.

## Delivery and usage truth

Provider usage is nullable per field. If a provider reports only output tokens,
the other fields remain null. Cached and reasoning subsets are recorded only
when explicitly reported, and Zuri never derives them from billing estimates or
the model name.

`recordedAtUtc` is server truth. Provider and executor start/finish times are
stored only with a trustworthy UTC source. Missing times remain null. A reader
may display Bangkok time, but the journal never stores a local display time as
the event's truth.

The recipient state starts as `UNKNOWN`. A recipient reference appears only in
a trusted transport/provider receipt. Conversation, source-user and account
identities are not enough to claim a delivered recipient.

## PDPA erasure and lifecycle

The existing PDPA erasure flow calls `redactTraceTurn` for the affected turn.
That operation removes retained snapshots and sensitive payload fields,
records the redaction state and leaves lineage metadata sufficient to explain
why playback is now `REPLAY_INCOMPLETE`. It does not delete a different tenant's
events, replace an event id or write a synthetic snapshot. A callback arriving
after erasure fails the execution fence and cannot restore redacted content.

## Acceptance criteria

All rows below are approved tests for implementation. None is reported as
passed by this documentation change.

| ID | Given / when / then | Evidence status |
|---|---|---|
| AC-171.1 | Given a native SERVER LINE job, when the first event is written, then `turnId` equals the existing `LineConversationJob.id` and no Turn model is created | 🔜 approved; not verified |
| AC-171.2 | Given one input, model call, tool invocation and retry, when the journal is read, then each actual occurrence has one event and each retry has a new `instanceId` without overwriting history | 🔜 approved; not verified |
| AC-171.3 | Given the v0.3 schema, when the model inventory is inspected, then `AgentTraceEvent` is the only new trace model and no separate turn, context, tool, retrieval, memory or delivery authority exists | 🔜 approved; not verified |
| AC-171.4 | Given an input at or below 1 MiB, when it is recorded, then the stored snapshot is exact and `inputSha256` hashes those exact bytes | 🔜 approved; not verified |
| AC-171.5 | Given an oversized or policy-excluded input, when it is recorded, then it is never silently truncated and playback is `REPLAY_INCOMPLETE` with the reason | 🔜 approved; not verified |
| AC-171.6 | Given retries and lifecycle events, when stable tool/action ids are compared, then the logical attempt id is stable while the occurrence `instanceId` changes | 🔜 approved; not verified |
| AC-171.7 | Given document, artifact, retrieval and memory references, when a source version changes, then the journal preserves the old version reference and never copies foreign authority data | 🔜 approved; not verified |
| AC-171.8 | Given native SERVER with no private memory adapter, when the trace is read, then session and memory refs are empty/null with `EXCLUDED_BY_POLICY`, never a fabricated MSP id | 🔜 approved; not verified |
| AC-171.9 | Given a provider that omits usage or timestamps, when the event is recorded, then the corresponding fields remain null and no estimate or local-time substitute is written | 🔜 approved; not verified |
| AC-171.10 | Given a delivery without a trustworthy recipient or receipt, when playback is read, then recipient remains `UNKNOWN` and acceptance is not reported as delivery/read | 🔜 approved; not verified |
| AC-171.11 | Given an owner with `line-oa` visibility, when `GET /api/line-oa/jobs/{id}/trace` is called, then only the job's Business-scoped events are returned | 🔜 approved; not verified |
| AC-171.12 | Given a non-owner, a viewer without `line-oa` visibility or a cross-scope job id, when the route is called, then no trace is disclosed and the existing scoped refusal contract is used | 🔜 approved; not verified |
| AC-171.13 | Given any visible job, when playback is requested, then no provider, tool, MSP, GKS, Edge or LINE call occurs and no row, attempt, receipt, job or CRM message changes | 🔜 approved; not verified |
| AC-171.14 | Given an expired, excluded, redacted or unavailable required reference, when playback is requested, then status is `REPLAY_INCOMPLETE` and the missing reason is explicit | 🔜 approved; not verified |
| AC-171.15 | Given a PDPA erasure, when `redactTraceTurn` runs, then snapshots and sensitive payload are redacted once, lineage remains, and playback becomes `REPLAY_INCOMPLETE` without replacement content | 🔜 approved; not verified |
| AC-171.16 | Given a late callback after a lease, epoch or erasure fence changes, when it arrives, then it is denied or marked `FENCED` and cannot replace an earlier result or restore erased data | 🔜 approved; not verified |
| AC-171.17 | Given an MSP/GKS/Edge adapter, when it is implemented, then it returns references through a port and performs no direct foreign-database write from zuri-ai | 🔜 external phase gate; not verified |
| AC-171.18 | Given SQLite and Postgres schemas, when migrations and contract tests run, then the journal shape and append/redaction semantics agree in both providers | 🔜 approved; not verified |

## Scope exclusions and evidence boundary

This requirement does not add private-memory storage, a local knowledge graph,
an Edge executable, a provider credential vault, a new LINE delivery path or a
re-execution command. It does not claim that MSP, GKS, GenesisBlockDB, the
installed Edge device, a real LINE provider or production migrations have been
verified. Those are named phase and rollout gates.

## Source and handoff anchors

- [ADR-070 — Execution Trace & Replay v0.3](../../../decisions/ADR-070-EXECUTION-TRACE-AND-REPLAY-V03.md)
- [FR-171-P1 — native SERVER journal and playback checklist](PHASE-FR-171-P1-native-server-line-journal.md)
- [ADR-061 — server-owned LINE and optional Edge](../../../decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md)
- [FR-093 — LINE reply delivery receipt](../../crm/features/FR-093-reply-delivery-receipt.md)
- [FR-057 — authorized agent context and vault resolution](FR-057-authorized-agent-context-and-vault-resolution.md)

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-07 | accepted | Approved Execution Trace & Replay v0.3 feature contract and unverified acceptance tests | uncommitted | RWANG |
