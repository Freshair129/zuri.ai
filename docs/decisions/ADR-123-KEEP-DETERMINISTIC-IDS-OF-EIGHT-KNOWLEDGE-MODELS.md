---
id: ZAI:ADR-123
title: Keep the deterministic primary keys of eight Knowledge and GenesisRAG17 models
version: "1.0.0"
status: accepted
created_at: "2026-11-25"
last_update: "2026-11-25"
author: Claude Sonnet 5.5
superseded_by: null
approval_scope: documentation-and-tests-only-no-id-generation-change-no-migration-no-backfill
approved_on: "2026-11-25"
approved_by: "Delegated product-owner decision D-D7 (Astra, gpt-6-astra) under owner instruction 2026-11-08, relayed by the lead Claude session; this is not human approval and no other approval is claimed"
attributes:
  doc_type: architecture-decision
  domain: knowledge
  scope: "Eight Knowledge/GenesisRAG17 models keep their derived primary keys; derivation and scope are recorded per model; the exception covers no provider id and no new model"
relations:
  - type: relates_to
    target: ZAI:ADR-050
  - type: relates_to
    target: ZAI:BR-002
  - type: relates_to
    target: ZAI:FR-109
---

# ADR-123 — Keep the deterministic primary keys of eight Knowledge models

**Status:** Accepted on 2026-11-25. It records delegated product-owner decision
D-D7 (Astra, gpt-6-astra) under owner instruction 2026-11-08, relayed by the
lead Claude session. It is not human approval. It changes no id generation, adds
no column or migration, and rewrites no row.

## Context

BR-002 says external ids are never primary keys and every model gets an internal
id. Most models use `@default(uuid())`. Eight Knowledge/GenesisRAG17 models
instead take a caller-supplied id that is a pure function of their input. The
identifier document recorded this as "internal, but not random. Not recorded as
an approved exception" (gap 2 in `IDENTIFIER-AND-CODE-SYSTEM.md` §8).
Replay depends on it: a replayed ingestion must land on the same raw, parsed,
intent, mention, batch, evidence, cursor and receipt rows, and stored citations
and Stage 9 handoffs reference those ids.

## Decision

### D1 — The eight models keep their derived ids

`KnowledgeRawArtifact`, `KnowledgeParsedArtifact`, `GenesisRag17IngestionIntent`,
`GenesisRag17SourceMention`, `GenesisRag17Batch`, `GenesisRag17StageEvidence`,
`GenesisRag17EvidenceCursor` and `GenesisRag17PublicationReceipt` keep the ids
below. Every id is `<prefix>_<first 48 hex characters of a SHA-256 over the
canonical JSON of its input tuple>`; `hashGenesisRag17Json` sorts keys, so key
order never changes an id. `KnowledgeChunk` (`documentId#ordinal`) is a
separate, already-recorded derived key and is not part of this decision.

| Model | Prefix | Input tuple | Scope carried by the tuple |
|---|---|---|---|
| `KnowledgeRawArtifact` | `kra_` | schemaVersion, pipelineVersion, **scope** (portfolio, tenant, business, workspace, agent, visibility), sourceId, documentId, version, contentHash (+ binary profile fields) | direct |
| `KnowledgeParsedArtifact` | `kpa_` | the raw tuple above + parserVersion | direct |
| `GenesisRag17IngestionIntent` | `gii_` | hash of the parsed identity + executionRunId | direct, through the identity |
| `GenesisRag17SourceMention` | `gsm_` | executionRunId, Stage 8 attemptId, sourceMentionId, derivationHash | through the run |
| `GenesisRag17Batch` | `grb_` | executionRunId, Stage 9 attemptId | through the run |
| `GenesisRag17StageEvidence` | `gre_` | the whole evidence row hash: runId, pipelineStageId, executionStepId, attemptId, stageNumber, outcome, timestamps, metrics, details, cursor | through the run |
| `GenesisRag17EvidenceCursor` | `gcur_` | runId, **scope** | direct |
| `GenesisRag17PublicationReceipt` | `gpr_` | the whole parsed receipt: scope, runId, decisionId, decisionHash, snapshotId, generation, receiptHash, publishedAt, pointerHash, transactionFrontier | direct |

Where the scope is carried "through the run", `executionRunId` is a random
internal UUID created once per `(scope, source identity)` by the pipeline-run
idempotency key `ki17:<parsed identity>`, and the parsed identity contains the
scope. Two scopes therefore never share a run, and so never share a `gsm_`,
`grb_` or `gre_` id.

Several evidence ids include the run or attempt, so a replay with new attempts
makes new rows by design; re-presenting the same attempt with the same content
returns the existing row, and different content under the same identity is a
409 conflict.

### D2 — Not extended

The exception covers exactly these eight models. It does not cover provider ids
(a provider's own id is still never a key, so BR-002 and the
`NotionWebhookReceipt.eventId` gap are unchanged) and no new model. A new model
that needs replay keys must be added by its own recorded decision.

### D3 — Evidence

`apps/server/tests/integration/genesisrag17-deterministic-ids.test.js` proves,
for these models, that the same input yields the same id, that a different
scope or version yields a different id, and that one scope cannot resolve or
collide with another scope's rows.

## Consequences

The derivation is now an approved contract. Changing a tuple, the prefix, the
48-character truncation or the canonicalisation orphans stored citations and
breaks replay, so it needs a new decision and a migration plan, not a refactor.
Rows outside these eight models are unaffected.
