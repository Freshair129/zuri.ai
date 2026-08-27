---
version: "1.0.0"
created_at: "2026-08-27T00:00:00+07:00,Claude Opus 5"
last_update: "2026-08-27T00:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "knowledge"
  doc_type: "architecture-decision"
  scope: "17-stage knowledge ingestion vocabulary, per-stage tier ownership, and the Tier 1 declaration/approval boundary"
---

# ADR-050 — Knowledge Ingestion Tier Boundary and Stage Ownership

**Status:** Accepted for the contract/documentation boundary. No runtime slice is authorized by this ADR.  
**Date:** 2026-08-27  
**Decided by:** Boss, Lead Architect  
**Relates to:** [ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md), [ADR-030](ADR-030-SUPABASE-DATA-PIPELINE-OBSERVABILITY-AND-REPLAY.md), [ADR-039](ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md), [ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md), [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md), [ADR-046](ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md), FR-024, FR-047, FR-071, FR-081, FR-099, FR-100, FR-101, SDD-042, BR-009, SEC-001, SEC-009, SEC-013, `docs/domains/knowledge/CHARTER.md`, `docs/Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification.md`.

## Context

The 17-stage specification describes one logical pipeline from raw source to a published knowledge snapshot, and it is explicit that a stage is not a service: "แต่ละ Stage ไม่จำเป็นต้องเป็น microservice แยก" (§2). Because a stage can execute in an edge worker, a background worker, GKS or a Genesis adapter, the specification alone does not say **who may run which stage** — and in a four-tier stack that question is a security boundary, not a deployment preference.

zuri-ai already holds three pieces of this pipeline: an ingestion envelope (FR-081), an execution ledger with stage/run/record identity (FR-071, [ADR-030](ADR-030-SUPABASE-DATA-PIPELINE-OBSERVABILITY-AND-REPLAY.md), SDD-042), and a human approval surface whose decisions leave by pull (FR-100, [ADR-046](ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md)). The risk is that adopting the specification is read as permission to *implement* the remaining fourteen stages here — which would put a substrate writer inside Tier 1 and contradict two approved ADRs.

This ADR therefore adopts the stage vocabulary and, in the same act, fixes the boundary.

## Decision

### D1 — The 17 stages are adopted as the canonical stage vocabulary

The stage names below are the only names used, in code, docs and any future catalog constant, for knowledge ingestion:

```text
 1 Ingestion              7 Chunking                 13 Graph Construction
 2 Parsing / Extraction   8 Entity Extraction        14 Knowledge / Graph Enrichment
 3 Provenance Capture     9 Entity Resolution        15 Embedding
 4 Normalization         10 Relation / Fact Extraction 16 Multi-Lane Indexing
 5 Classification /      11 Schema / Ontology Mapping 17 Graph + Retrieval Quality Gate
   Access Scope          12 Temporal Mapping
 6 Deduplication /
   Versioning
```

The numbered sequence in the specification's §4 is **documentation of the usual order, not the key**. The stable key is the stage id.

This is not a new convention; it is what FR-071 already does. `PIPELINE_STAGE_CATALOG` in `src/platform/integrations/core/pipeline-tracking-contract.js:12-23` carries `{ sequence, pipelineStageId, label }`, and only the id is load-bearing: the validated set is derived as `PIPELINE_STAGE_CATALOG.map((stage) => stage.pipelineStageId)` (`:65`), the envelope validator rejects anything outside that set (`:122`), and lookup is `stageById(pipelineStageId)` (`:264-265`). The catalog proves the point structurally: `DPS-ROLLBACK` carries `sequence: 99` (`:22`) and never executes ninth — it executes instead of the rest.

`sequence` is persisted and used for display ordering: it is written onto every `PipelineStep` at run creation (`src/platform/integrations/core/pipeline-tracking-service.js:337`), sorted on for the stage board (`:254`), read back with `orderBy: { sequence: 'asc' }` (`:596`, `:684`), carried on the event envelope (`:164`, `:409`), copied on replay (`:736`), and indexed (`prisma/schema.prisma:1304`). It is never a lookup key and never a validation input. The operational consequence for FR-109's seventeen stages: they must carry monotonic `sequence` values, or the step board renders out of order.

The knowledge-ingestion catalog (FR-109) follows that shape exactly: seventeen stage ids, sequence as metadata, and a stage renamed in prose keeps its id.

### D2 — Stage ownership by tier

| # | Stage | Owning tier | Already-declared id owning it here |
|---|---|---|---|
| 1 | Ingestion | Zuri-AI Tier 1 | **FR-081** — every acquisition channel converges on one normalized ingestion envelope; a channel is an adapter, never a second path |
| 2 | Parsing / Extraction | Tier 1 (edge/background worker) | **FR-071** — artifact and record identity (`sourceSha256`, `pipelineRecordId`) |
| 3 | Provenance Capture | Tier 1 | **FR-071 / SDD-042** — the append-only stage/record ledger carrying `doc_id`, `pic_id`, `fact_id` |
| 4 | Normalization | Tier 1 | — (catalog entry only, FR-109) |
| 5 | Classification / Access Scope | Tier 1 | **FR-111** — the PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED lattice and per-object processing policy, on top of **SEC-001** and **SEC-009** |
| 6 | Deduplication / Versioning | Tier 1 | **BR-021** ingestion idempotency key (source identity + source version + content hash + pipeline version — to be computed and carried in the `idempotencyKey` column; it is *not* FR-081's existing raw-boundary key `sha256(tenantId, connectionId, entityType, externalId, payloadHash)`, which has neither source version nor pipeline version), **SEC-021** within-tenant-only comparison |
| 7 | Chunking | Tier 1 | — |
| 8 | Entity Extraction | Tier 1 | — |
| 9 | Entity Resolution | **GKS Tier 3** — the spec names the owner outright (§14 "Owner: **GKS**") | — (Tier 1 records the occurrence on the FR-109 job trace, nothing more) |
| 10 | Relation / Fact Extraction | GKS Tier 3 | — |
| 11 | Schema / Ontology Mapping | **GKS Tier 3** — the spec names the owner outright (§16 "Owner: **GKS**") | — |
| 12 | Temporal Mapping | GKS Tier 3 | — |
| 13 | Graph Construction | **GKS Tier 3 decides the graph; GenesisBlockDB Tier 4 writes it. Tier 1 does neither.** | — |
| 14 | Knowledge / Graph Enrichment | GKS Tier 3 | — |
| 15 | Embedding | GenesisBlockDB Tier 4 | — |
| 16 | Multi-Lane Indexing | **GenesisBlockDB Tier 4** — its six lanes are [ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md) D2 (Semantic, Lexical, Graph, Structured, Temporal, Provenance), not a new list | — |
| 17 | Graph + Retrieval Quality Gate | **GKS Tier 3 and GenesisBlockDB Tier 4 execute all five dimensions (§22.1–22.5). Tier 1 executes none of them; it holds the evidence and the decision.** | **FR-071** reconciliation and gate evidence for §22.1 data quality; **FR-110** for the publish-or-quarantine decision |

The spec's §21 lane 1 is named `Vector`; ADR-042 D2 names the same lane `Semantic RAG`. This file uses **Semantic** throughout — one lane, two existing names, no third.

**Stages 13–17 are Tier 3 / Tier 4 execution.** Graph construction, enrichment, embedding, indexing and the quality gate write or verify the substrate. zuri-ai does not run them, does not hold a credential that could, and does not ship a "local fallback" that would.

Ownership is authority, not location: D6 governs where a stage physically executes.

### D3 — Zuri-AI never executes a substrate-writing stage

This is not a new rule. It is the intersection of two approved ADRs.

[ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md) D2.1: "**Zuri-AI (Tier 1)** is the business execution client. It never talks directly to GenesisBlockDB or bypasses MSP governance."

[ADR-046](ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md) clause 2: "zuri-ai holds the decision record and its audit; it never opens a connection to DuckDB, GenesisBlockDB or the `:8888` store. Tier 1 therefore stays a non-writer toward Tier 4 during the interim and after it."

The consequence for this pipeline is exact. For every stage this repository does not own, what zuri-ai declares is **a contract, a catalog, an evidence envelope, an approval surface and a snapshot identity** — the FR-100 pull pattern, unchanged: the executor submits into the queue, a human decides in the browser, the executor pulls decided rows from a cursored export and applies them to its own stores. FR-109 is the catalog and the job trace that make an ingestion occurrence reviewable without reading the substrate; FR-110 is that same decide-then-pull shape applied to `READY_TO_PUBLISH`, where zuri-ai records the publish-or-quarantine decision and the executor performs the publication.

"Consumes snapshots" (FR-110, the PRD row, the knowledge charter) means the snapshot **identity** — `knowledge_snapshot_id` with `ontology_version` and `pipeline_version` — plus the decision record against it. The corpus that identity names is read only through the tiers above: MSP governance into GKS retrieval, and the ADR-046 interim `:8888` surface. A direct substrate read is not a lighter form of consumption; it is the thing D3 forbids.

**Rejected: an FR that makes Tier 1 a substrate writer.** It would contradict [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md) D2.1 and [ADR-046](ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md) clause 2 on its face — not in a subtle interaction, but in the first sentence of each. It would also duplicate GKS's canonical-identity authority ([ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md) D3, spec §37) inside a business-execution app, giving two systems the right to decide what an entity is.

**Rejected: a "thin" adapter that writes only indexes, not the graph.** Writing any of the six lanes is writing the substrate; the lane count is not a permission gradient.

### D4 — The ingestion pipeline reuses the FR-071 execution ledger

No new Prisma models. The knowledge-ingestion pipeline registers as **a new pipeline definition** alongside `DATA_PIPELINE_DEFINITION_ID = 'DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1'` (`src/platform/integrations/core/pipeline-tracking-contract.js:9`), as `DPL-KNOWLEDGE-INGEST-V1` with seventeen `DPS-*` stage ids in its own catalog. Runs, steps, attempts, record events, reconciliations and gates are the existing ones (SDD-042, [ADR-030](ADR-030-SUPABASE-DATA-PIPELINE-OBSERVABILITY-AND-REPLAY.md)). This is SDD-057.

The database permits this; the contract does not yet. `PipelineRun.dataPipelineDefinitionId` (`prisma/schema.prisma:1218`) and `PipelineStep.pipelineStageId` (`:1274`) are plain `String` columns — no enum, no foreign key, no check constraint — so a second definition id and seventeen new stage ids need no migration. The FR-071 **envelope** is welded to one value: `zPipelineEvent` and `zPipelineRunInput` both declare `dataPipelineDefinitionId: z.literal(DATA_PIPELINE_DEFINITION_ID)` and `executionContractId: z.literal(EXECUTION_CONTRACT_ID)` (`src/platform/integrations/core/pipeline-tracking-contract.js:119-120`, `:175-176`), `pipelineStageId` is refined against the ten-entry catalog (`:122`), the only two `PipelineRun` writers in `src/` both go through that validator (`src/platform/integrations/core/pipeline-tracking-service.js:305`, `:699`), and run creation materialises the whole hard-coded catalog as ten `DPS-*` steps (`:330-337`).

So the first implementation slice must parameterise the contract by definition id — a change to implemented, tested FR-071 code, since `tests/unit/platform/pipeline-tracking-contract.test.js:56-57` asserts both constants by value. This ADR's "no code is authorized" clause does not budget for that work; the slice inherits it, and should scope it explicitly rather than discover it.

`PipelineRecordEvent` (`prisma/schema.prisma:1323-1359`) fits the §33 job trace without change. It carries `docId`, `picId`, `factId` (`:1332-1334`) with an index on each (`:1356-1358`), and those columns are live FR-071 machinery, not spare capacity: the service writes all three on every record event (`src/platform/integrations/core/pipeline-tracking-service.js:456-458`), projects them (`:112-114`, `:194-196`) and reads them for the `PROVENANCE_FILTERED` replay predicate (`:654-656`), which the contract refuses without at least one of them (`src/platform/integrations/core/pipeline-tracking-contract.js:198-200`, `:208-210`). What is true is narrower: no producer supplies a non-null value today. Knowledge ingestion fills them with the meaning FR-071 already gives them — record provenance — and does not redefine them. One column carrying two meanings in one table under one replay filter would be the defect, not the reuse. The §33 chain they trace has nine nodes — Source → RawArtifact → ParsedArtifact → Chunks → Entities → Facts → Graph → Indexes → Published Snapshot — not the three columns. `idempotencyKey` is `@unique` (`prisma/schema.prisma:1344`) and `replayOfPipelineRecordId` (`:1346`) already expresses reprocessing (§31), so §29 idempotency and §30 incremental processing need no schema at all.

A second ledger would split the answer to "what happened to this document" across two tables, which is what [ADR-030](ADR-030-SUPABASE-DATA-PIPELINE-OBSERVABILITY-AND-REPLAY.md) exists to prevent.

Two properties ride on this ledger rather than on anything new. NFR-020 requires per-stage counts (`records_in`, `records_out`, `records_failed`, `records_quarantined`, `processing_time`, `retry_count`) plus pipeline-level latency and rate metrics, because a stage that reports nothing cannot be distinguished from a stage that did nothing — and for stages zuri-ai does not execute (D2, D3), those counts are the *only* thing it will hold. BR-022 requires that a failed object be quarantined with its full failure envelope and classified retryable / non-retryable / review-required; silent omission is forbidden, since a corpus that quietly drops what it could not parse reports a completeness it does not have.

### D5 — Publication is atomic and snapshot-identified

From §24 and §25: the transition `READY_TO_PUBLISH → PUBLISHED` is atomic, and a half-built index is never exposed to retrieval. There is no partial publish without an explicit policy that says so.

Retrieval never names "the index". It names a `knowledge_snapshot_id` together with `ontology_version` and `pipeline_version` (plus `index_generation` where the substrate exposes one). Two queries citing the same snapshot id must be answerable from the same knowledge, and an evidence citation stays resolvable after the next publication. FR-110 is that contract, and it carries the gate precondition with it: only a Stage 17 result of `PASS` or `PASS_WITH_WARNINGS` may publish (§23).

Tier 1's part is the decision and the receipt — who approved which snapshot id on what gate evidence. It does not perform the swap.

### D6 — Execution location is policy-driven

§35 sketches a plausible split — stages 1–8 on local edge, 9–14 in cloud GKS, 15–17 local or selected — and then overrides its own sketch: execution location must be policy-driven. `RESTRICTED` data may set `cloud_processing_allowed = false`, and all seventeen stages then execute locally. This is SDD-058, resolved per object from FR-111's policy fields at each stage boundary.

**Deployment topology never decides this; the data's classification does.** The classification is fixed at Stage 5 (§10), before any stage that could move the data, and it travels with the object. A stage that cannot run under the object's policy fails the run — it does not degrade to a permitted location, and it does not process a redacted copy in the cloud instead.

Two consequences worth stating: the same stage id runs in different processes for different objects, which is why D1 keeps ids stable and D2 assigns *authority* rather than a host; and a Thai-market tenant with RESTRICTED classification is a supported configuration of the same pipeline, not a fork of it. SEC-013's rule that policy precedes retrieval has its ingestion-side twin here: policy precedes processing.

### D7 — Scope before index, never filter-after-retrieval

§3.3 rejects one pattern outright:

```text
Index everything → Retrieve everything → Filter afterward
```

and requires:

```text
Classify → Scope → Index → Scoped Retrieval
```

This is FR-111's classification-before-indexing clause, and it is a security rule, not a performance preference. Filter-after-retrieval means the substrate holds cross-tenant material in one addressable set and the boundary is enforced by whichever caller remembers to enforce it — the failure mode SEC-001 exists to make impossible at Tier 1 and SEC-013 at Tier 2. An unscoped object is not indexed late; it is not indexed at all.

SEC-021 closes the one place where scope is most easily lost by accident: deduplication compares within a single tenant only. Two tenants holding a byte-identical document hold two facts, and collapsing them into one indexed object is a cross-tenant disclosure that looks like an optimisation — it would defeat D7 at Stage 6, before any retrieval boundary is ever consulted.

FR-024's live-fact guard and FR-047's allow-listed public projection are the same rule seen from the other end: what must never be servable is excluded *before* it reaches an index, and SEC-009 already names the classes (secrets, PII, cost, margin, invoice). Nothing in the 17-stage adoption relaxes any of them.

## Consequences

- The stage vocabulary is now fixed, so a run in the FR-071 ledger, a row in the FR-099 phase board, a node in the FR-101 graph and a paragraph in the specification can refer to the same stage without a translation table.
- FR-109, FR-110, FR-111, SDD-057, SDD-058, NFR-020, BR-021, BR-022, SEC-021 and FEAT-013 are declared by this change and are **unimplemented**. Their PRD/FEATURES rows are registry declarations; no code, route, service or test is authorized by this ADR. That authorization is withheld deliberately, but it is not free: D4 names work the first implementation slice inherits — parameterising the FR-071 contract envelope by definition id, against a test that asserts the constants by value. Whoever scopes that slice budgets for it; this ADR does not pretend it is absent.
- **No schema change.** D4 commits to the existing models, so a future implementation slice that proposes a new Prisma model for ingestion is proposing to reopen this decision, not to implement it.
- Every id declared here must be pinned before the branch is green: preflight Check 12 is CRITICAL on a declared-but-unpinned id, so `npm run docs:ids -- --write` is a required step of the same change ([ADR-039](ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md)). ADR-050 itself is such an id.
- zuri-ai's ingestion role is now falsifiable: if a future PR adds a Tier 4 write credential, an embedding call or an index mutation to this repository, it violates D3 — reviewable without a design discussion.
- The knowledge domain gains a documented lane for this work under [ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md); the [charter's](../domains/knowledge/CHARTER.md) existing rule that knowledge enters by governed import/approval is what D3's approval surface implements for the 17-stage case.
- Any future intake surface for ingestion (route, agent, MCP adapter) is a transport onto the same validate → dry-run → commit path (BR-009). D3 forbids the substrate write; BR-009 forbids the second writer even for the parts Tier 1 does own.
- What this ADR does **not** authorize, stated so it cannot be inferred: no `src/modules/` addition, no API route, no Prisma migration, no contract JSON file, no GKS or GenesisBlockDB client, and no change to FR-100's existing decision export. A runtime slice declares its own scope against these ids.
- Cost of being wrong about a stage's tier is now one table row plus an ADR revision, not a migration — which is the reason the boundary is being recorded before any of it is built.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-08-27 | accepted | Adopted the 17-stage vocabulary with stage id as the key, assigned per-stage tier ownership, bounded Tier 1 to declaration/catalog/provenance/approval, reused the FR-071 ledger with no new models, and fixed atomic snapshot publication, policy-driven execution location and scope-before-index | working-tree | Claude Opus 5 |
