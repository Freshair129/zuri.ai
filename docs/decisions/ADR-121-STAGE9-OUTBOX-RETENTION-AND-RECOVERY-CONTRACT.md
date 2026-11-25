---
id: ZAI:ADR-121
title: Stage 9 outbox retention and recovery contract
version: "1.0.0"
status: accepted
created_at: "2026-11-25"
last_update: "2026-11-25"
author: Claude Sonnet 5.5
superseded_by: null
approval_scope: decision-record-and-charter-amendment-only-no-code-no-schema-no-migration-no-data-change-no-deletion
approved_on: "2026-11-25"
approved_by: "Delegated product-owner decision D-D13 (Astra, gpt-6-astra) under owner instruction 2026-11-08, relayed by the lead Claude session; this is not human approval and no other approval is claimed. The numeric bounds in D4 are first values written by this record and are open to owner or Astra confirmation (Open question 1)"
attributes:
  doc_type: architecture-decision
  domain: knowledge
  scope: "What the GenesisRAG17 Stage 9 outbox (GenesisRag17Batch) may store, how it is scoped and kept immutable, how long it may be retained, how a lost or stuck delivery is recovered, and the rule that existing rows are never deleted automatically; it changes no code, schema, migration or data"
relations:
  - type: relates_to
    target: ZAI:ADR-050
  - type: relates_to
    target: ZAI:ADR-073
  - type: relates_to
    target: ZAI:ADR-057
  - type: relates_to
    target: ZAI:FR-109
---

# ADR-121 — Stage 9 outbox retention and recovery contract

**Status:** Accepted on 2026-11-25 as a decision record and charter amendment.
It records delegated product-owner decision D-D13 (Astra, gpt-6-astra) under
owner instruction 2026-11-08, relayed by the lead Claude session. It is not
human approval. It edits no code, schema, migration or data row, deletes
nothing, and has no production effect.

## Context

Tier 1 ends at Stage 8. Stage 9 hands one batch to MSP, and the lost-reply
guarantee in [ADR-050](ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) D3–D4 and
[ADR-073](ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md) requires
that the same bytes can be sent again with the same `batchId` and
`idempotencyKey`. The durable copy of those bytes is the `GenesisRag17Batch`
row (the "Stage 9 outbox"), whose `requestJson` is the whole outgoing batch.

The Knowledge charter says its lineage rows hold "source identity, hashes,
offsets, counts and redacted details" and not "GKS facts, canonical entities,
embeddings, index payloads or GenesisBlockDB data". An outbox that can resend
a batch must hold the batch's source text, which a strict reading of that
sentence does not allow. Decision D-D13 settles the conflict: the outbox
stores input Zuri must resend, so it may hold source text inside an outgoing
request that is immutable and scoped. The exception is narrow and does not
open the rest of the lineage to text.

## What the code does today (read 2026-11-25, base `407de494`)

- **Model.** `GenesisRag17Batch` ([schema.prisma:3794](../../apps/server/prisma/schema.prisma))
  holds `batchId`, `idempotencyKey` (both `@unique`), `executionRunId`,
  `stage9StepId`, `stage9AttemptId` (unique with `executionRunId`),
  `scopeJson`, `requestJson`, `status` (`PENDING` or `ACKNOWLEDGED`),
  `decisionId`, `responseJson`, `createdAt`, `updatedAt`.
- **Write.** `buildBatch` and `persistBatch` in
  `apps/server/src/platform/integrations/core/genesisrag17-executor.js`
  create the row once per Stage 9 attempt and refuse a second row for the same
  key if its `requestJson` differs (409). `requestJson` is the full wire batch:
  `schemaVersion`, ids, `scope`, `stages`, `source` (including the complete
  parsed `source.content`), `policy`, every `chunks[].text` and the Stage 8
  `mentions[]`. Chunk text is a substring of `source.content`, so the text is
  stored twice.
- **Update.** The only writers of a stored row after creation are
  `updateBatchResponse` and `resumeGenesisRag17Worker`
  (`genesisrag17-worker.js`). They set `status`, `decisionId`, `responseJson`
  and `updatedAt`; they do not modify `requestJson`. A null `decisionId` keeps
  the row `PENDING`.
- **Resend.** `resumeGenesisRag17Worker` selects `PENDING` rows of one scope,
  parses `requestJson` and sends it unchanged.
- **Later readers of `requestJson`.** `genesisrag17-publication.js` (finish),
  `genesisrag17-importer.js` (`assertBatchScope`) and
  `knowledge-corpus-service.js` (publication lineage check) read the stored
  request for `scope`, `stages`, and the `source` identity and hashes after the
  batch is acknowledged. None of them needs the text members.
- **Delete.** No code path deletes or redacts a `GenesisRag17Batch` row. The
  table is in the backup/restore table list
  (`backup-service.js`), so backups also carry it.

## Findings (recorded, not fixed here)

| # | Finding | Effect against D-D13 |
|---|---|---|
| F1 | No row is ever deleted or redacted. `requestJson` keeps the full source text and the duplicate chunk text forever, including after `ACKNOWLEDGED` and after the publication receipt is imported. | **Unbounded retention.** Conflicts with the required explicit bound. |
| F2 | `updateBatchResponse` and `resumeGenesisRag17Worker` store the whole MSP reply in `responseJson` (`json(response)`), after validating only `schemaVersion`, `scope`, `batchId`, `status` and `decisionId`. The contract reply is `{batchId, decisionId, status}`. Any other field MSP returns is persisted unfiltered. | **Possible downstream-stage internals.** No current evidence that MSP sends extra fields, and none was observed; nothing in code prevents it. Unverified. |
| F3 | `GenesisRag17IngestionIntent.requestJson` also holds the exact scoped source request before Stage 1, with no deletion path. | Outside the outbox, so outside D-D13. Recorded so the same bound is not forgotten there (Open question 3). |
| F4 | `persistBatch` compares `requestJson` strings exactly. A redacted row presented again under the same `idempotencyKey` would fail with 409. | Constrains how a redaction may be marked (D5, Open question 2). |
| F5 | `responseJson` has no consumer other than `decisionId` (`genesisrag17-publication.js`), which is also stored in its own column. | `responseJson` can be reduced to the contract fields without losing a reader (a future code change, not this record). |

None of F1–F5 is corrected by this record. Each needs a separate code or
operator change under the gates in D6.

## Decision

### D1 — What the outbox may store

A `GenesisRag17Batch` row may store exactly:

1. the outgoing request as sent: the frozen `genesisrag17.v1` batch
   (`schemaVersion`, `batchId`, `idempotencyKey`, `scope`, `runId`, `stages`,
   `source`, `policy`, `chunks`, `mentions`), **including source text** in
   `source.content`, `chunks[].text` and `mentions[].name`, because Zuri must be
   able to send those bytes again;
2. the delivery state: `status`, `decisionId`, `createdAt`, `updatedAt`, the step
   and attempt identities; and
3. the reply, limited to the contract fields `schemaVersion`, `scope`,
   `batchId`, `status`, `decisionId`.

It may **not** store downstream-stage internals: GKS entities, facts, held rows,
derived summaries, embeddings, vectors, graph or index payloads, decision
bodies, quality-gate dimensions, worker
receipts, or any field of a reply beyond item 3. Those stay with GKS and the
GenesisBlock worker (ADR-073); Tier 1 keeps counts and redacted details in its
evidence rows. Source text may not be copied from the outbox into any other
Tier 1 table, log, diagnostic or error message.

### D2 — Scope

Every row is bound to exactly one scope (`portfolioId`, `tenantId`,
`businessId`, `workspaceId`, `agentId`, `visibility`), duplicated in
`scopeJson` and `requestJson.scope`, and the two must stay equal. A row is read
or resent only under that scope (the existing
`assertGenesisRag17ScopeEqual` check), never by `batchId` alone across scopes.
Each row is bound to one Stage 9 step and attempt. A replay or correction
produces a new run, attempt, `batchId` and `idempotencyKey`; it never reuses or
rewrites an earlier row.

### D3 — Immutability

While a row is `PENDING`, `requestJson`, `batchId`, `idempotencyKey`, the
attempt identities and `scopeJson` are never changed, by anyone, for any reason.
Only `status`, `decisionId`, `responseJson` (to the D1 item 3 fields) and
`updatedAt` may change, only by the existing worker path, and only forward
(`PENDING` to `ACKNOWLEDGED`, never back). One redaction is allowed after a
row becomes eligible under D4, and it is the only edit to `requestJson` this
contract permits (D5).

### D4 — Retention bound

The bound is a lifecycle bound with a numeric limit. The numbers are the
initial values of this record (Open question 1).

1. **Text-bearing members** (`source.content`, `chunks[].text`,
   `mentions[].name`) may be retained while the row is `PENDING`, because they
   are needed to resend.
2. After the row is `ACKNOWLEDGED`, its run has reached a terminal state, and
   the publication receipt for that run is imported (or the run is terminal
   `FAILED` with no further resend wanted), the text members may be retained for
   at most **30 days** from `updatedAt` of that terminal transition.
3. A `PENDING` row older than **90 days** from `createdAt` is over the bound.
   It is not deleted. It is reported for an owner decision: resume it, or
   record that the delivery is abandoned and then treat it as terminal for item
   2.
4. After the bound, the text members are eligible for owner-run redaction (D5).
   The **envelope** (`schemaVersion`, ids, `scope`, `stages`, `source` identity
   fields and hashes, `policy`, chunk and mention identities and offsets,
   `status`, `decisionId`) has no text and is retained with its run, because
   publication, importer and corpus checks read it (see "Later readers").
5. `responseJson` is bounded to the D1 item 3 fields. Anything else found there
   is over the bound at once and is reported, not deleted automatically.
6. Backups carry what the table carried when they were taken. Redaction does not
   reach existing backups; backup retention is governed by the backup policy and
   is not changed here.

### D5 — Redaction is the only edit, and it is owner-run

Nothing in this contract deletes a row, and nothing runs on a schedule. An
over-bound row may only be handled by a **dry-run-first, owner-run** operation:

1. a read-only dry run lists the rows that are over the bound (status, ages,
   scope, byte size of the text members) and changes nothing;
2. the owner reviews the list and names the scope and the rows;
3. only then a run replaces the text members with an empty string or removes
   them, leaves the envelope as it is, and records what it did (count, ids,
   operator, time) in a retained record outside the row;
4. a redacted row is never resent: it is terminal by definition.

Because `persistBatch` compares `requestJson` exactly (F4), the redaction
marker, and whether a redacted row can still be presented under its old key,
must be designed with the code change; this record does not choose it (Open
question 2).

### D6 — Existing rows are never auto-deleted

No existing row, in any environment, is deleted, redacted, backfilled or
rewritten by this record or by any job it implies. Deletion and redaction of
existing data stay owner-run, dry-run-first operations (ADR-057): the
production operator step, not a migration or a scheduled task, and not a
side effect of a deploy. A future automatic purge needs its own decision record
and its own approval; this one does not authorize it.

### D7 — Recovery procedure

| Situation | Procedure |
|---|---|
| Reply lost, row `PENDING` | `resumeGenesisRag17Worker` resends the stored `requestJson` unchanged with the same `batchId` and `idempotencyKey`. MSP deduplicates. Nothing is rebuilt. |
| MSP returns a null `decisionId` | The row stays `PENDING` and the next pass resends. A null decision is a valid reply, not an acknowledgement. |
| Row `PENDING` over 90 days | Report to the owner (D4.3). Resume, or abandon by recorded decision. Never delete. |
| Row `ACKNOWLEDGED` and text already redacted | No resend is needed or possible. A correction or replay (FR-071) starts a new run and attempt from the intent and raw artifact, which creates a new batch under a new key. |
| `requestJson` unreadable or scope mismatch | Finish, importer and corpus checks already fail closed (409). Do not repair the row by hand; open an incident and replay from the intent. |
| Row needed after redaction by a reader that wants text | There is none today (see "Later readers"). A new reader must use the raw and parsed artifacts, never the outbox. |
| Restore from backup | The restored row has the content it had at backup time, which may be older than the bound. Re-apply D5 under owner control. |

## Consequences

- The charter sentence about lineage rows is narrowed by one explicit
  exception, so documentation and code agree: the outbox holds source text, the
  rest of the lineage does not.
- Until a code and operator change implements D4 and D5, the current
  unbounded retention (F1) and unfiltered `responseJson` (F2) stand as known
  non-conformance. This record does not make them conform and does not hide
  them.
- No schema column, migration, route or scheduler is added. Nothing is deleted.

## Open questions

1. **Numeric bounds.** D4 uses 30 days after terminal state and 90 days for a
   stuck `PENDING` row. Astra or the owner should confirm or replace them.
   They are not tied to a measured workload or to a legal retention duty.
2. **Redaction marker.** Where is a redaction recorded without a new column
   and without breaking the exact `requestJson` comparison (F4)? Options are
   a new column (needs a Supabase migration and owner-run apply, ADR-057), a
   separate evidence row, or a documented JSON member plus a relaxed
   comparison. Not decided here.
3. **Intent rows.** Does `GenesisRag17IngestionIntent.requestJson` (F3) get the
   same bound? It is also source text with no deletion path, but it is not the
   outbox, so D-D13 does not cover it.
4. **`responseJson` allowlist.** Should the stored reply be cut to the contract
   fields in code (F2, F5)? That is a small code change outside this docs-only
   record.
5. **Erasure.** FR-232 erasure fan-out is not built. Whether an erasure request
   overrides the D4 bound for a scope, and how it is recorded, is not decided.

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-11-25 | Initial acceptance as delegated decision D-D13 |
