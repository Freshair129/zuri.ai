---
id: ZAI:FR-171-P1
version: "1.0.0"
status: accepted
created_at: "2026-09-07T23:10:12+07:00,RWANG"
last_update: "2026-09-07T23:18:03+07:00,RWANG"
title: "Execution Trace & Replay v0.3 — native SERVER LINE journal and playback"
parent_requirement: FR-171
phase_id: FR-171-P1
phase_order: 1
domain: agent
contract_version: "execution-trace-replay.v0.3"
relations:
  - type: relates_to
    target: ZAI:FR-171
  - type: relates_to
    target: ZAI:FR-171-NOTE
  - type: relates_to
    target: ZAI:ADR-070
  - type: relates_to
    target: ZAI:FR-149
  - type: relates_to
    target: ZAI:FR-150
  - type: relates_to
    target: ZAI:FR-093
---

# FR-171-P1 — Native SERVER LINE journal and playback

This is the first implementation checklist for the approved FR-171 contract.
Every item is pending until its code, tests and migration evidence are
reviewed. The note deliberately records no completed implementation.

## Responsibility

The agent lane owns the reusable `AgentTraceEvent` contract and its local,
scoped append-only journal. The native SERVER LINE path uses the existing
`LineConversationJob.id` as `turnId`, the existing CRM Conversation/Message
references and the existing FR-093 transport receipt boundary. The first read
surface is the owner-only, `line-oa`-visible:

```text
GET /api/line-oa/jobs/{id}/trace
```

The phase owns trace evidence and read-only playback. It does not take over
LINE delivery, CRM outbound writing, MSP storage, GKS storage or Edge device
execution.

## Entry condition and predecessor

- [ ] ADR-070 is present as the accepted v0.3 contract.
- [ ] FR-149's server-owned LINE job and FR-093's transport receipt contracts
      remain the predecessor and handoff authorities.
- [ ] The requested `LineConversationJob` resolves its Business, account,
      inbound Message and Conversation through existing owner ports.
- [ ] The implementation lane records `executionId` as nullable before a
      server execution starts; it never creates a synthetic execution for a
      queued or cancelled job.

## Contract and schema checklist

- [ ] Add one `AgentTraceEvent` model to the agent-owned SQLite and Postgres
      schema surfaces, with an additive migration and no separate Turn,
      Execution, Context, ToolAttempt, Retrieval, Memory or Delivery models.
- [ ] Update the agent charter model manifest to own `AgentTraceEvent` while
      keeping MSP, GKS, Edge, CRM and transport models in their existing lanes.
- [ ] Persist the trusted scope envelope (`tenantId`, `businessId`,
      `accountId`, `conversationId`, `messageId`) from the server-owned job;
      reject or ignore client/model/tool scope claims.
- [ ] Persist `turnId`, nullable `executionId`, fresh per-occurrence
      `instanceId`, nullable opaque `sessionId`, nullable `ctxId`, immutable
      `turnSequence`, event kind and event status.
- [ ] Persist stable `toolAttemptId` / `actionAttemptId`, document/artifact
      version references, retrieval references, memory version references,
      delivery attempt and receipt references as typed versioned JSON.
- [ ] Enforce the exact input snapshot contract: canonical semantic JSON,
      maximum 1 MiB, SHA-256 over the exact bytes, no silent truncation, and an
      explicit `snapshotState` when retention is unavailable.
- [ ] Persist nullable provider usage subsets (`inputTokens`, `outputTokens`,
      `totalTokens`, `cachedInputTokens`, `reasoningTokens`) without estimates.
- [ ] Persist truthful UTC timestamps; keep unavailable provider/executor times
      null; default `recipientStatus` to `UNKNOWN`.
- [ ] Keep transient LINE reply tokens, channel access tokens, authorization
      material and other provider secrets out of snapshots, journal rows and
      audit payloads.
- [ ] Add indexes/constraints sufficient for one Business-scoped job playback,
      `(turnId, turnSequence)` ordering and append-only idempotency without
      changing the existing job or CRM identity contract.

## Native SERVER writer checklist

- [ ] Append one `TURN_INPUT` event for the admitted server job input.
- [ ] Append one event for every actual model input/call/result observation and
      every tool/action invocation; retries append new events and new
      `instanceId` values instead of updating an old row.
- [ ] Set `LineConversationJob.executionId` only at logical execution start and
      carry the same value through its permitted lifecycle.
- [ ] Record `sessionId: null`, `memoryVersionRefs: []` and
      `memoryStatus: EXCLUDED_BY_POLICY` when native SERVER has no private MSP
      adapter. Never mint a fake MSP session or memory version.
- [ ] Record retrieval references only through the approved knowledge reader
      port; do not write GKS or GenesisBlockDB directly.
- [ ] Record provider usage and source timestamps only when reported by a
      trustworthy provider; leave missing subsets null.
- [ ] Link delivery events to the transport's stable `deliveryAttemptId` and
      FR-093 receipt evidence; never report acceptance as delivery/read.
- [ ] Reject or mark `FENCED` a late callback whose job lease, execution or
      transport epoch no longer matches; do not replace an earlier event.

## Read-only playback route checklist

- [ ] Implement `GET /api/line-oa/jobs/{id}/trace` with Business-owner and
      `line-oa` domain visibility checks derived from the job, not the query
      body or URL scope claims.
- [ ] Return the ordered event chain, identity references, exact snapshots when
      retained, hashes, snapshot states, nullable usage, truthful UTC times,
      recipient evidence and `playbackStatus`.
- [ ] Return `REPLAY_INCOMPLETE` with explicit reasons for expired, excluded,
      redacted, oversized or unavailable snapshots/references.
- [ ] Return no trace across Tenant, Business, account, conversation or job
      scope boundaries; preserve the existing refusal shape.
- [ ] Prove playback performs no provider, model, tool, MSP, GKS, Edge or LINE
      call and changes no row, lease, attempt, receipt, CRM message or job.

## Erasure and retention checklist

- [ ] Connect existing PDPA erasure to `redactTraceTurn` for the affected
      `turnId` and scope.
- [ ] Make redaction one-way: remove retained snapshots and sensitive payload
      fields, keep lineage and permitted hashes, record UTC redaction state,
      and never write replacement content.
- [ ] Make a callback after erasure fail the execution fence and unable to
      restore the redacted input or append a false success.
- [ ] Test retention expiry and erasure as `REPLAY_INCOMPLETE` playback, not as a
      successful replay.

## Verification checklist

- [ ] Unit-test identity separation, stable attempt refs, snapshot hashing,
      size/retention states, nullable usage/timestamps, UTC serialization and
      `UNKNOWN` recipient semantics.
- [ ] Integration-test SQLite and Postgres schema parity, append ordering,
      server job scope, route authorization, playback no-effects and PDPA
      redaction.
- [ ] Integration-test duplicate callbacks, retries, stale lease/epoch fences
      and receipt evidence without duplicate events or CRM messages.
- [ ] Add tests covering AC-171.1 through AC-171.16 from the FR-171 contract;
      mark each test as evidence only after it executes and passes.
- [ ] Run the applicable server test/build checks and record the phase report;
      do not report this phase as complete from a static document review.

## External adapter handoff gates

These are explicit follow-on gates and are not silently counted as P1 evidence:

- [ ] **MSP adapter:** a port returns the opaque Soul `sessionId`, context
      assembly reference and memory version refs; zuri-ai performs no direct
      MSP database write. Native SERVER remains empty plus
      `EXCLUDED_BY_POLICY` until this gate is proven.
- [ ] **GKS adapter:** a port returns retrieval/corpus/index version refs;
      zuri-ai performs no direct GKS or GenesisBlockDB database write.
- [ ] **Edge adapter:** the optional device returns bounded execution and
      trace callbacks under ADR-061 leases; no Edge secret, recipient authority
      or arbitrary executable enters the cloud journal.
- [ ] **External evidence:** contract tests and live/canary evidence for MSP,
      GKS, Edge and the provider are recorded in their owning repositories or
      release gates before any cross-repository completion claim.

## Output and next handoff

P1 is complete only when the native SERVER journal, scoped playback route,
retention/redaction behavior and their executed acceptance tests are evidenced.
The next handoff is the separately gated MSP/GKS/Edge adapter work. None of
those external authorities becomes implemented merely because the local trace
can carry an opaque reference.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-07 | accepted | Approved native SERVER implementation checklist with explicit external MSP/GKS/Edge handoff gates; no implementation claimed | uncommitted | RWANG |
