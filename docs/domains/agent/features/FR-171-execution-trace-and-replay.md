---
id: ZAI:FR-171-NOTE
version: "1.1.1"
status: accepted
created_at: "2026-09-07T23:10:12+07:00,RWANG"
last_update: "2026-09-11T04:31:00+07:00,RWANG"
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
  - type: relates_to
    target: ZAI:FR-171-P2
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
local journal contract. An approved immutable per-job opt-in may compose the
MSP thread adapter through the server worker; MSP, GKS and the optional Edge
executor remain authority and external-evidence gates described below.

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
`LineConversationJob.executionId` is filled only when a server execution
attempt is claimed; each claimed attempt receives a fresh `executionId`. The
journal does not replace the job, CRM, AuditEvent or FR-093 receipt owners.

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
| `executionId` | UUID for one claimed execution attempt; nullable before a job is claimed and never invented for a job that has not run |
| `instanceId` | Runtime process/worker instance persisted by `EXECUTION_STARTED`; stable across multiple attempts handled by that process |
| `modelCallId` | Fresh UUID for one actual provider/model call attempt, including a retry |
| `toolInvocationId` | Fresh UUID for one actual tool invocation attempt, including a retry; native P1 carries it only when an approved adapter emits it |
| `sessionId` | Opaque MSP Soul session reference; nullable outside the MSP adapter |
| `ctxId` | UUID/reference for the concrete context assembled by the Zuri runtime; MSP remains the Soul/session/memory authority |
| `eventKind` | Concrete `AgentTraceEvent.kind` such as `TURN_RECEIVED`, `EXECUTION_STARTED`, `MODEL_COMPLETED`, `MODEL_FAILED`, `SEND_STARTED`, `SEND_RESULT` and other approved lifecycle kinds |
| `toolId` / `actionId` | Stable registered tool identity and stable action intent identity; neither identifies an attempt |
| `documentVersionRefs` / `artifactVersionRefs` | Arrays of stable owning-service references with version and hash/reference; no source body copy |
| `retrievalRefs` | Opaque GKS retrieval/evidence references with retrieval, corpus, snapshot or index version where supplied |
| `memory` | Opaque MSP memory/session references, including version data where supplied; native SERVER uses an empty array unless an approved per-job opt-in composes the MSP adapter |
| `privateContextDisposition` | MSP context/memory policy disposition; jobs without the approved opt-in use `EXCLUDED_BY_POLICY` with `memory: []` |
| `sendAttemptId` / `receiptRefs` | Fresh transport attempt identity and evidence references; receipt callbacks reference the attempt they evidence, while acceptance, delivery and read remain separate states |
| `requestBody` / semantic snapshot | Canonical semantic JSON input, maximum 1 MiB, immutable and never silently truncated; absent only with an explicit snapshot state |
| `requestHash` / `inputHash` | SHA-256 of the canonical semantic JSON bytes; this is not an exact HTTP wire-body hash |
| retention disposition | Native P1 uses retained request bodies, explicit private-context exclusion, fail-closed oversized event rejection and erasure tombstones; unified `snapshotState`/scheduled expiry is a follow-on adapter |
| `provider` / `providerModel` / `providerRequestRef` | Nullable provider evidence; no provider credential, access token or LINE reply token |
| `usage` / `usageSource` / `totalTokensSource` | Nullable subsets: `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens`, `reasoningTokens`; sources are `PROVIDER_REPORTED`, `DERIVED_FROM_PROVIDER_COUNTS` for a computed total, or `UNAVAILABLE`; no invented counts |
| `startedAt`, `finishedAt`, `occurredAt`, `createdAt` | Provider-call start/end are runtime observations; event occurrence and append times are UTC. Unavailable external timestamps stay null; `durationMs` uses a monotonic clock |
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

The event kind determines the evidence carried by each typed payload. Native
P1 validates journal scope, concrete kind, safe JSON bounds and the canonical
semantic request hash where it records an input. Tool, document, artifact,
memory and GKS typed adapters and their validators are follow-on phase work;
native P1 does not claim those validators are built and does not fabricate
their references.

## Identity and lineage rules

The contract distinguishes transient occurrence identity from stable lineage:

| Identity family | Rule |
|---|---|
| Turn/execution/instance/session/context | `turnId` follows the existing job; `executionId` is fresh per claimed execution attempt; runtime `instanceId` is stable for the process; `ctxId` identifies the context assembled by Zuri runtime; `sessionId` belongs to MSP and is nullable here |
| Model/tool/send attempts | `modelCallId`, `toolInvocationId` and `sendAttemptId` are fresh per actual attempt; `toolId` is a stable registry identity and `actionId` is a stable action intent, neither a stable attempt id |
| Document/artifact versions | References include the owner id, version and hash or immutable URI. A changed source is a different version even when its filename is unchanged |
| Retrieval versions | GKS owns the retrieval and corpus/index identity. Zuri stores an opaque reference and does not copy a knowledge graph or query result into an authority table |
| Memory versions | MSP owns the session and memory policy. Zuri stores the opaque version refs it returns or an explicit exclusion state |
| Delivery attempts and receipts | Each transport attempt receives a fresh `sendAttemptId`; receipt callbacks append evidence tied to it |

`turnId`, `executionId`, `instanceId`, `sessionId` and `ctxId` are never
interchanged with a business `WorkItem`, CRM external thread id, provider
request id, document id, artifact id or GKS/MSP authority id.

## Typed adapter handoff (approved design; phased runtime integration)

The native P1 payloads above remain their actual wire shape. The following
adapter requirements complete the v0.3 lineage design without claiming their
emitters or validators are all implemented in Zuri today.
[P2](PHASE-FR-171-P2-memory-provenance.md) preserves API-009 memory revisions
and observed write responses through the authorized context seam; private
per-call injection and the remaining adapters are still gated.

| Reference | Required identity and provenance |
|---|---|
| Soul/persona | MSP `soulId`, immutable version/hash and policy receipt; separate from the runtime system-prompt template id/version |
| Memory read | MSP `memoryId`, immutable memory version/snapshot and session reference; link every selected item to `ctxId` |
| Memory write | Stable memory id with a new version, producing `executionId`, action/attempt reference, commit time and owning MSP receipt; a later write never changes an earlier context snapshot |
| Chat history | Source message ids/versions and ordered selected message content; summaries need their own version plus source-message range/hash; no silent replacement with current history |
| Tool | Stable registry `toolId`, schema version/hash and implementation version; fresh `toolInvocationId`; model call id, provider call reference, parent invocation and input/result hashes |
| Action | Stable `actionId` for business intent, fresh `actionAttemptId` for each attempt, linked tool invocation, authorization/approval receipt, idempotency key and effect outcome; a timeout is an unknown outcome until reconciled |
| Attached document | Owning-service `docId`, immutable version, content hash, MIME type and authorized blob reference; extracted text/chunks retain parser version and source lineage |
| Generated artifact | Owning-service `artifactId`, immutable version/hash, MIME type and storage reference; producing execution/model/tool/action attempt and source doc/knowledge references |
| Retrieval | Actual GKS retrieval run id, retriever/config version, query hash, corpus/index snapshot and ordered selected chunk/entity ids with source versions; local BUSINESS_QUERY observations are labelled separately |
| Context | Fresh `ctxId` for each actual model input; ordered entries with role, source type/id/version/hash, disposition (included/excluded/truncated), exact included content or authorized immutable snapshot, and assembler version |

Context commits link the exact authorized inputs before each provider call.
Tool results entering a later call require a new context id. Document content,
retrieved text and tool results remain untrusted data rather than system-level
instructions; provenance does not grant permission. Runtime resolves scope and
policy, while MSP/GKS supply their own authoritative references through ports.

Historical inspection is subject to current reader authorization and erasure.
An old authorization receipt explains what was allowed then; it never grants a
new action today. Read-only playback cannot dispatch actions. Any future
re-execution creates new execution/call/attempt ids, references its origin, and
rechecks current policy and side-effect authorization. Exact stored input is
replay evidence, not a guarantee that a nondeterministic provider reproduces the
same text.

## Exact input and retention contract

The writer takes the canonical semantic JSON input at each input, model and
tool boundary. It stores that canonical representation up to 1 MiB and
computes `requestHash`/`inputHash` as SHA-256 over its canonical semantic JSON
bytes. Canonicalization happens before hashing; this contract does not promise
an exact HTTP wire snapshot. The semantic boundary excludes transient LINE
credentials and reply tokens, which must never appear in a trace or audit
payload.

When a snapshot is too large, excluded by policy, expired or redacted, the
event keeps the hash and reason when policy allows and exposes the corresponding
retention disposition. Native P1 rejects oversized events and records the
execution failure; it does not create a truncated snapshot or expiry scheduler. It does not pretend to have a replayable body. A retained
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
- returns only events within that job's scope, ordered by stored `occurredAt`,
  `createdAt` and `id`;
- includes hashes, references, snapshot states, nullable usage, truthful UTC
  times, recipient evidence and the computed playback status;
- performs no model, tool, retrieval, memory, Edge or LINE call;
- creates no event, attempt, receipt or outbound CRM message; and
- does not mutate the job, conversation, memory or knowledge stores.

Historical model output or usage may append evidence under its old
`executionId`, but it cannot settle the current job or trigger a current send.
Actionable settle and send paths remain lease- and transport-epoch fenced. A
stale actionable callback is refused or marked `FENCED`; a callback after
PDPA erasure is denied for payload writes and cannot restore erased content.

## Authority and adapter boundary

The first implementation is deliberately narrow:

| Authority | v0.3 contract | Implementation status |
|---|---|---|
| Zuri native SERVER | Writes the local journal and serves scoped playback for the LINE job path | Implemented native P1; see phase report for executed evidence and external limits |
| MSP | Owns Soul/session/memory authority and policy | External adapter and cross-repository evidence pending |
| Zuri runtime | Assembles the actual native SERVER context and records `ctxId` | Native context assembly is part of the local runtime; no MSP authority is duplicated |
| GKS | Owns canonical retrieval, corpus and index versions | External adapter and cross-repository evidence pending |
| Edge | Owns optional local execution under ADR-061 and returns bounded callbacks | External adapter, installed-device proof and canary pending |
| LINE transport | Owns provider calls and factual delivery receipts under FR-093 | Native send-attempt integration implemented; live delivery/canary evidence pending |

Native SERVER v0.3 defaults to no private memory adapter. Jobs without the
approved immutable opt-in therefore record `sessionId: null`, `memory: []`
and `privateContextDisposition: EXCLUDED_BY_POLICY`. An opted-in worker job may
compose one trusted MSP thread adapter and records only its bounded context
packet and returned references; it never mints a fake MSP id. Zuri never writes
an MSP, GKS or GenesisBlockDB database directly; each adapter returns typed
references through a port.

## Delivery and usage truth

Provider usage is nullable per field and is carried in `usage` with
`usageSource` and `totalTokensSource`. If a provider reports only output
tokens, the other fields remain null. A total may be
`DERIVED_FROM_PROVIDER_COUNTS` when it is computed from provider-reported
counts; cached and reasoning subsets remain null unless explicitly reported.
Zuri never invents counts or infers them from billing estimates or the model
name.

`createdAt` is the journal append time; `occurredAt` is the event observation time. Provider and executor start/finish times are
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

Rows below preserve the approved acceptance contract. The phase report maps
executed native P1 evidence to these criteria and explicitly leaves external
adapter and live Postgres criteria open.

| ID | Given / when / then | Evidence status |
|---|---|---|
| AC-171.1 | Given a native SERVER LINE job, when the first event is written, then `turnId` equals the existing `LineConversationJob.id` and no Turn model is created | Native P1 verified locally; see phase report |
| AC-171.2 | Given one input, model call, tool invocation and retry, when the journal is read, then each actual occurrence has one event, each execution/model/tool/send retry has a fresh attempt id, and the runtime process `instanceId` remains stable across attempts it handles | Native P1 coverage recorded; adapter/retention limits in phase report |
| AC-171.3 | Given the v0.3 schema, when the model inventory is inspected, then `AgentTraceEvent` is the only new trace model and no separate turn, context, tool, retrieval, memory or delivery authority exists | Native P1 verified locally; see phase report |
| AC-171.4 | Given canonical semantic input at or below 1 MiB, when it is recorded, then the retained semantic snapshot is exact and `requestHash`/`inputHash` hashes its canonical JSON bytes | Native P1 coverage recorded; adapter/retention limits in phase report |
| AC-171.5 | Given an oversized or policy-excluded input, when it is recorded, then it is never silently truncated and playback is `REPLAY_INCOMPLETE` with the reason | Native P1 coverage recorded; adapter/retention limits in phase report |
| AC-171.6 | Given retries and lifecycle events, when stable `toolId`/`actionId` values are compared, then those registry/intent ids remain stable while `toolInvocationId` and other attempt ids are fresh and the runtime `instanceId` remains process-stable | Follow-on typed adapter evidence pending |
| AC-171.7 | Given document, artifact, retrieval and memory references, when a source version changes, then the journal preserves the old version reference and never copies foreign authority data | Follow-on typed adapter evidence pending |
| AC-171.8 | Given a native SERVER job without the approved memory opt-in, when the trace is read, then `sessionId` is null, `memory` is empty and `privateContextDisposition` is `EXCLUDED_BY_POLICY`, never a fabricated MSP id | Native P1 and worker off-path verified locally; see phase report |
| AC-171.9 | Given a provider that omits usage or timestamps, when the event is recorded, then the corresponding `usage` fields remain null, source fields state unavailable (or a total is explicitly `DERIVED_FROM_PROVIDER_COUNTS`), and no estimate or local-time substitute is written | Native P1 verified locally; see phase report |
| AC-171.10 | Given a delivery without a trustworthy recipient or receipt, when playback is read, then recipient remains `UNKNOWN` and acceptance is not reported as delivery/read | Native P1 verified locally; see phase report |
| AC-171.11 | Given an owner with `line-oa` visibility, when `GET /api/line-oa/jobs/{id}/trace` is called, then only the job's Business-scoped events are returned | Native P1 verified locally; see phase report |
| AC-171.12 | Given a non-owner, a viewer without `line-oa` visibility or a cross-scope job id, when the route is called, then no trace is disclosed and the existing scoped refusal contract is used | Native P1 verified locally; see phase report |
| AC-171.13 | Given any visible job, when playback is requested, then no provider, tool, MSP, GKS, Edge or LINE call occurs and no row, attempt, receipt, job or CRM message changes | Native P1 verified locally; see phase report |
| AC-171.14 | Given an expired, excluded, redacted or unavailable required reference, when playback is requested, then status is `REPLAY_INCOMPLETE` and the missing reason is explicit | Native P1 coverage recorded; adapter/retention limits in phase report |
| AC-171.15 | Given a PDPA erasure, when `redactTraceTurn` runs, then snapshots and sensitive payload are redacted once, lineage remains, and playback becomes `REPLAY_INCOMPLETE` without replacement content | Native P1 verified locally; see phase report |
| AC-171.16 | Given a late callback after a lease, epoch or erasure fence changes, when it arrives, then historical model output/usage may append under its old execution for evidence, but it cannot settle the current job, trigger a current send or restore erased data; actionable paths remain fenced | Native P1 verified locally; see phase report |
| AC-171.17 | Given an MSP/GKS/Edge adapter, when it is implemented, then it returns references through a port and performs no direct foreign-database write from zuri-ai; typed tool/document/artifact/memory/GKS validators remain follow-on adapter gates | Follow-on typed adapter evidence pending |
| AC-171.18 | Given SQLite and Postgres schemas, when migrations and contract tests run, then the journal shape and append/redaction semantics agree in both providers | SQLite and schema parity verified; live Postgres pending |

## Scope exclusions and evidence boundary

This requirement does not add private-memory storage, a local knowledge graph,
an Edge executable, a provider credential vault, a new LINE delivery path or a
re-execution command. It does not claim that MSP, GKS, GenesisBlockDB, the
installed Edge device, a real LINE provider or production migrations have been
verified. Those are named phase and rollout gates.

## Source and handoff anchors

- [ADR-070 — Execution Trace & Replay v0.3](../../../decisions/ADR-070-EXECUTION-TRACE-AND-REPLAY-V03.md)
- [FR-171-P1 — native SERVER journal and playback checklist](PHASE-FR-171-P1-native-server-line-journal.md)
- [FR-171-P2 — authorized MSP memory provenance](PHASE-FR-171-P2-memory-provenance.md)
- [ADR-061 — server-owned LINE and optional Edge](../../../decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md)
- [FR-093 — LINE reply delivery receipt](../../crm/features/FR-093-reply-delivery-receipt.md)
- [FR-057 — authorized agent context and vault resolution](FR-057-authorized-agent-context-and-vault-resolution.md)

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.1.1 | 2026-09-11 | accepted | Clarify conditional server-worker MSP composition: default-off jobs remain EXCLUDED_BY_POLICY while opted-in jobs use the trusted adapter and durable local checkpoint | pending implementation commit | RWANG |
| 1.1.0 | 2026-09-08 | accepted | Link approved P2 memory provenance implementation and remaining authority gates | pending | RWANG |
| 1.0.0 | 2026-09-07 | accepted | Approved Execution Trace & Replay v0.3 feature contract and unverified acceptance tests | uncommitted | RWANG |
