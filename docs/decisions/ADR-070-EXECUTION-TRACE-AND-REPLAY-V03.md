---
id: ZAI:ADR-070
version: "1.0.0"
status: accepted
created_at: "2026-09-07T23:10:12+07:00,RWANG"
last_update: "2026-09-07T23:50:41+07:00,RWANG"
attributes:
  domain: agent
  doc_type: architecture-decision
  contract_version: "execution-trace-replay.v0.3"
  scope: "one scoped append-only AgentTraceEvent journal for native SERVER LINE execution, with read-only playback and explicit external MSP, GKS and Edge adapter gates"
relations:
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
    target: ZAI:FR-171
---

# ADR-070 — Execution Trace & Replay v0.3

**Status:** Accepted by owner approval, 2026-09-07. This decision authorizes
implementation of the contract under its phase gates; it does not claim that the journal,
route, adapters or external rollout already exist.

**Decided by:** Boss (approved Execution Trace & Replay v0.3), with the
implementation boundary recorded by RWANG.

Related design sources: [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md),
[ADR-044](ADR-044-UNIFIED-THREAD-ID-AND-OMNI-CHANNEL-CONSOLE.md),
[ADR-061](ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md),
[FR-057](../domains/agent/features/FR-057-authorized-agent-context-and-vault-resolution.md),
[FR-091](../domains/crm/features/FR-091-conversation-inbox.md),
[FR-093](../domains/crm/features/FR-093-reply-delivery-receipt.md),
[FR-149](../domains/line-oa-studio/features/FR-149-server-line-transport.md),
[FR-150](../domains/line-oa-studio/features/FR-150-optional-edge-execution.md),
and [FR-171](../domains/agent/features/FR-171-execution-trace-and-replay.md).

## Context

The server-owned LINE flow already has useful identities in separate owners:
`LineConversationJob` admits durable work, CRM `Conversation` and `Message`
hold the business conversation, and FR-093 records what the transport actually
accepted as an outbound reply. A single turn can still cross the server answer
adapter, a model provider, tools, retrieval, memory and delivery. Those steps
need a common evidence chain without making a provider request id, a LINE
thread id or a business work id pretend to be every other identity.

The trace must answer which exact input was presented to each model or tool,
which execution and attempt it belonged to, which document or retrieval
version was referenced, and what the transport proved. It must also say when
that answer cannot be replayed because a snapshot expired, was excluded by
policy or was erased. A row that is merely missing evidence cannot be reported
as a successful deterministic replay.

The four-tier boundary is already binding. MSP owns Soul, session and memory
authority and policy; Zuri runtime assembles the actual context used by the
native SERVER path; GKS owns canonical retrieval and its versioned knowledge
references; and the optional Edge runtime owns its local execution adapter.
Zuri must not write a foreign MSP or GKS database directly, and a trace design
must not create a second memory, knowledge or delivery authority.

## Decision

### D1 — One local journal model, one event per observable execution occurrence

The agent domain owns one `AgentTraceEvent` model in the Zuri application
database. It is a scoped, append-only journal for these concrete event kinds:

| Event kind | Meaning | Required evidence |
|---|---|---|
| `TURN_RECEIVED` | The server-owned input admitted for one turn | `turnId`, canonical semantic input snapshot or an explicit retention state, and `requestHash`/`inputHash` |
| `MODEL_COMPLETED` / `MODEL_FAILED` | One provider/model response observation | `executionId`, `modelCallId`, runtime `instanceId`, provider/model identity, input snapshot/hash and nullable `usage` with source fields |
| `TOOL_INVOKED` / `TOOL_RESULT` / `ACTION_STARTED` / `ACTION_RESULT` | One tool or action request, result or failure | `executionId`, `toolInvocationId`, stable `toolId`/`actionId`, runtime `instanceId`, input snapshot/hash and outcome |
| `EVIDENCE_SELECTED` | A retrieval request or returned evidence reference | retrieval run/version reference and query/evidence snapshot/hash; subsequent context links to this retrieval run |
| `MEMORY_WRITTEN` | A memory reference supplied by MSP | opaque MSP session and `memory` references, or `privateContextDisposition` exclusion state |
| `SEND_STARTED` / `SEND_RESULT` / `OUTBOUND_RECORDED` | A delivery attempt or transport receipt observation | fresh `sendAttemptId`, recipient evidence state and receipt evidence |
| `EXECUTION_STARTED` / `CONTEXT_COMMITTED` / `ANSWER_READY` / `EXECUTION_FAILED` / `RETENTION_TOMBSTONE` | A server-owned start, context, finish, failure, cancellation or retention observation | execution identity, typed payload, truthful UTC timestamp and failure/evidence reference |

The evidence column includes references joined through the execution and context events; fields such as runtime `instanceId` and request snapshots are not duplicated on each result. Tool/action/memory/artifact kinds are reserved for follow-on typed adapters.

The model is the journal. The design does not add separate Turn, Execution,
ExecutionInstance, Context, ToolAttempt, ActionAttempt, Retrieval,
MemoryVersion, DeliveryAttempt or Receipt tables. Existing
`LineConversationJob`, CRM `Conversation`/`Message`, `AuditEvent` and the
FR-093 delivery writer remain their owning records. The journal stores typed
references and immutable evidence around those records instead of copying
their authority.

The kinds above are the native SERVER implementation's concrete
`AgentTraceEvent.kind` vocabulary: `TURN_RECEIVED`,
`EXECUTION_STARTED`, `CONTEXT_COMMITTED`, `EVIDENCE_SELECTED`,
`MODEL_COMPLETED`, `MODEL_FAILED`, `ANSWER_READY`, `EXECUTION_FAILED`,
`SEND_STARTED`, `SEND_RESULT`, `OUTBOUND_RECORDED`, `TOOL_INVOKED`,
`TOOL_RESULT`, `ACTION_STARTED`, `ACTION_RESULT`, `MEMORY_WRITTEN`,
`ARTIFACT_CREATED` and `RETENTION_TOMBSTONE`. The event-specific contract is
encoded in typed `payloadJson`; retrieval, document, artifact and context
references therefore remain evidence on one journal row rather than new
authority models.

The native SERVER LINE path reuses `LineConversationJob.id` as `turnId` and
uses its CRM `inboundMessageId` and derived `conversationId` as conversation
references. No second turn row is created. `LineConversationJob.executionId`
may remain null until a server execution starts; each claimed execution
attempt receives a new `executionId`, which is carried on that attempt's trace
events. `EXECUTION_STARTED` persists the runtime process `instanceId`; that
value is stable across the model, tool and send attempts handled by that
process. Each actual model call, tool invocation and send attempt receives a
fresh `modelCallId`, `toolInvocationId` or `sendAttemptId`, and retries never
overwrite prior events.

### D2 — Separate transient execution identity from stable lineage references

The contract keeps these identities distinct:

| Identity | Lifetime and owner | Rule |
|---|---|---|
| `eventId` | One journal row; Zuri | UUID primary identity; never reused or updated into another event |
| `turnId` | One admitted turn; existing Line job | Native SERVER value is `LineConversationJob.id`; no new turn table |
| `executionId` | One claimed execution attempt; Zuri | Fresh UUID for each actual execution attempt; nullable before a job is claimed |
| `instanceId` | One runtime process/worker instance; Zuri | Persisted on `EXECUTION_STARTED` and stable across multiple attempts handled by that process |
| `modelCallId` | One provider/model call attempt; Zuri | Fresh UUID for every actual model call or retry |
| `toolInvocationId` | One tool invocation attempt; Zuri or the approved tool adapter | Fresh UUID for every actual invocation or retry; native P1 carries this only when an adapter emits it |
| `sessionId` | One MSP Soul session; MSP | Opaque external reference; nullable when MSP is not in the path; never locally minted as an MSP id |
| `ctxId` | One context assembled by the Zuri runtime; Zuri | UUID/reference for the concrete context supplied to an occurrence; MSP remains the Soul/session/memory authority |
| `toolId` | Stable registered tool identity; tool registry | Does not identify an attempt or replace `toolInvocationId` |
| `actionId` | Stable action intent identity; action contract | Does not identify an attempt or replace `toolInvocationId` |
| `actionAttemptId` | One execution attempt of the stable action intent; action adapter | Fresh per actual attempt; native tool/action adapter remains a follow-on gate |
| document/artifact version refs | Versioned source evidence; owning document/artifact service | Carry stable id, version and hash/reference; do not copy source bytes into the journal |
| retrieval refs | One GKS retrieval/evidence version; GKS | Carry opaque retrieval id and corpus/snapshot/index version; Zuri does not become the knowledge authority |
| memory refs | One MSP memory/session version; MSP | Carry opaque memory id/version and policy result; Zuri does not write MSP storage |
| `sendAttemptId` | One outbound transport attempt; transport owner | Fresh UUID for each send attempt; receipt callbacks reference the attempt they evidence |
| receipt refs | Evidence from the transport/provider; transport owner | Record provider request/acceptance/receipt references without turning acceptance into delivery or read confirmation |

Business, CRM, provider, document, artifact, retrieval and memory references
are never substituted for the execution identities above. External ids remain
attributes or opaque references under BR-002 and the owning contract.

### D3 — Snapshot exact inputs, hash them, and report retention truthfully

Every `TURN_RECEIVED`, `CONTEXT_COMMITTED`, model result
(`MODEL_COMPLETED`/`MODEL_FAILED`), tool/action observation
(`TOOL_INVOKED`/`TOOL_RESULT`/`ACTION_STARTED`/`ACTION_RESULT`) and retained
`EVIDENCE_SELECTED` event carries the canonical semantic JSON input used at
that boundary when it is retained, or an explicit retention state when it is
not, and a `requestHash`/`inputHash` computed as SHA-256 over the canonical
semantic JSON bytes. Canonicalization happens before hashing; the stored
`requestBody` or semantic snapshot is that canonical representation. It is
immutable and bounded to 1 MiB. This is not a promise to retain an exact HTTP
wire body. Transient credentials such as a LINE reply token or a channel access
token are outside the approved semantic input and never enter a snapshot,
journal row or audit payload under ADR-061 and FR-093.

The contract distinguishes retained, expired, redacted, excluded and oversized
snapshots. Native P1 retains the canonical request, rejects oversized events
without a truncated replacement, records policy disposition, and uses a
retention tombstone for erasure. A unified `snapshotState` adapter vocabulary
and scheduled expiry remain follow-on work. An excluded, expired, redacted or oversized
snapshot keeps its hash and reason when policy permits, but it does not support
deterministic playback. A writer must not claim that a hash alone is a replay.
Retention policy is therefore part of the trace response, and a playback with
any required missing snapshot, version reference or external receipt is
`REPLAY_INCOMPLETE`.

PDPA erasure is a one-way, audited redaction of retained snapshot and sensitive
payload fields through the existing erasure path. It does not replace a row,
reuse an id or write replacement content. The event's lineage, hash where
allowed, redaction state and scope remain available so the journal can explain
why playback became incomplete. This controlled redaction is the only privacy
exception to the event payload's immutability.

### D4 — Playback is scoped and read-only

`GET /api/line-oa/jobs/{id}/trace` is the first read surface. It resolves the
requested job and its Business from server-owned state, requires the viewer to
own that Business and hold the `line-oa` domain visibility, and returns the
ordered event chain, identity references, snapshot states, hashes, usage,
receipt evidence and a computed `playbackStatus` of `REPLAY_COMPLETE`,
`REPLAY_INCOMPLETE` or `UNAVAILABLE`.

The response orders stored rows by `occurredAt`, then `createdAt`, then `id`;
there is no `turnSequence` field or causal-order guarantee. The explicit
`ctxId`, model-call, execution and attempt links reconstruct lineage
independently of event ordering.

The endpoint is a playback/read operation. It never calls a model, tool, MSP,
GKS, Edge device or LINE provider; it never creates a new attempt, delivery,
receipt or trace row; and it never mutates the job, CRM conversation, memory or
knowledge store. A response marked `REPLAY_COMPLETE` means that all evidence required
to display the recorded execution is present, not that the original external
side effects can be safely repeated. A response marked `REPLAY_INCOMPLETE` explains
the missing retention or external evidence and does not invent a result.

Historical model output or usage may append evidence under its original
`executionId` after the current execution has advanced, but it cannot settle
the current job or trigger a current send. Actionable settle and send paths
remain lease- and epoch-fenced. A stale actionable callback is denied and
recorded as a policy outcome without replacing the earlier event. PDPA erasure
denies payload writes and cannot be restored by a late callback.

### D5 — MSP, GKS and Edge remain external authorities

The reusable journal and contract live in Zuri, while adapter work is staged
behind explicit ports:

- MSP owns the Soul/session/memory authority and policy. Zuri runtime assembles
  the actual native SERVER context. Native SERVER v0.3 intentionally has no
  private memory adapter, so
  `sessionId` is null, `memory` is `[]`, and the event carries
  `privateContextDisposition: EXCLUDED_BY_POLICY`. Zuri never fabricates an MSP
  session or memory version to make a trace look complete.
- GKS owns retrieval, canonical knowledge identity and corpus/index versions.
  The Zuri journal records opaque retrieval references returned by an approved
  GKS adapter; it does not write a GKS or GenesisBlockDB store directly.
- The optional Edge runtime is a separate executor and delivery-less adapter
  under ADR-061. Edge trace callbacks and receipts are a pending phase gate;
  the cloud journal never receives Edge secrets, recipient authority or an
  arbitrary executable.

The initial implementation lane is the native SERVER LINE path and the
reusable local journal/read contract. MSP, GKS and Edge adapter implementation,
cross-repository contract tests and live canaries remain pending evidence gates
and are not implied by this ADR.

### D6 — Usage, time and recipient fields are nullable and truthful

Provider usage is represented by nullable `usage`, `usageSource` and
`totalTokensSource` fields. Input, output, total, cached-input and
reasoning-token subsets are each nullable. `usageSource` records
`PROVIDER_REPORTED` or `UNAVAILABLE`; `totalTokensSource` may be
`PROVIDER_REPORTED`, `DERIVED_FROM_PROVIDER_COUNTS` or `UNAVAILABLE`. Zuri
does not invent counts or infer reasoning/caching from a model name.

The journal stores server-recorded UTC timestamps and provider/executor UTC
timestamps only when their source is trustworthy. Missing start, finish or
provider timestamps remain null. Local Thai display conversion belongs to a
reader and is never persisted as event truth.

Recipient evidence defaults to `UNKNOWN`. A recipient becomes known only when
the transport/provider receipt supplies a trustworthy recipient reference.
The journal never infers a customer or recipient from a conversation, source
user id, channel account or model output.

### D7 — Delivery evidence follows the existing receipt authority

The delivery event references the existing `LineConversationJob` attempt and
FR-093 receipt. The transport remains the sole writer of the outbound CRM
message and its provider evidence. Provider acceptance, provider message id,
delivery confirmation and read confirmation remain separate nullable facts;
one cannot be derived from another. Reply tokens and access tokens are never
stored in the journal or returned by playback.

## Alternatives and consequences

| Alternative | Decision |
|---|---|
| Add separate tables for turns, model calls, tools, retrieval, memory and delivery | Rejected. It duplicates lineage and creates more authority boundaries; one scoped event model is sufficient for v0.3. |
| Reuse `LineConversationJob` as the whole trace | Rejected. The job owns admission and delivery work, not model/tool/context evidence or playback lineage. |
| Store only a hash and reconstruct inputs later | Rejected. Hashes prove identity but cannot provide exact playback after the source changes or expires. |
| Re-run providers and tools during a “replay” GET | Rejected. Playback must have no effects, no new attempts and no hidden external calls. |
| Mint local MSP/GKS/Edge ids when an adapter is absent | Rejected. Empty references with an explicit exclusion state are more truthful than fabricated authority. |
| Let Zuri write foreign MSP/GKS databases directly | Rejected by ADR-043 and ADR-050. Adapters own their stores and return references through ports. |
| Treat provider acceptance as delivery or read | Rejected by FR-093 and ADR-061. The receipt preserves the actual evidence state. |

The cost is one JSON-bearing journal model and a careful retention/redaction
contract. In return, native SERVER can provide a useful scoped trace now while
external authority remains replaceable and replay limitations stay visible.

## Verification and acceptance boundary

Implementation must prove the acceptance tests in
[FR-171](../domains/agent/features/FR-171-execution-trace-and-replay.md) and
the phase checklist before any status changes to implemented. This ADR records
the approved shape only; it contains no claim that those tests or external
adapters have run.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-07 | accepted | Approved Execution Trace & Replay v0.3: one scoped AgentTraceEvent journal, exact snapshots and hashes, read-only playback, truthful refs/times/usage/receipts, and explicit MSP/GKS/Edge boundaries | uncommitted | RWANG |
