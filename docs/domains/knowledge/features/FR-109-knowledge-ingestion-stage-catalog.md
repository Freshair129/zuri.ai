---
domain: knowledge
feature: FR-109
module: knowledge
source: v2-native
version: "0.2.0b"
status: "partial"
---

# FR-109 — Seventeen-stage knowledge ingestion stage catalog and job trace

## Intent

FR-109 registers the path from a source artifact to published, retrieval-ready
knowledge as **one** governed pipeline definition — `DPL-KNOWLEDGE-INGEST-V1` —
carrying the seventeen stable stage ids of the 17-Stage Knowledge Ingestion &
GraphRAG Preparation Pipeline Specification, and one `pipeline_job_id` that
traces a single ingestion end to end.

It declares three things and nothing more: the **catalog** (which stages exist
and what each must report), the **trace** (how one occurrence is followed from
source to published snapshot), and the **monitor** (where the evidence is read).
Per SDD-057 that evidence lives on the FR-071 execution ledger —
`PipelineRun` / `PipelineStep` / `PipelineRecordEvent` / `PipelineEventReceipt` /
`PipelineReconciliation` / `PipelineGateDecision` — because those models are
already pipeline-agnostic: `dataPipelineDefinitionId` and `pipelineStageId` are
free strings and only the stage *catalog constant* is FR-071-specific. A second
execution ledger would give one question two answers.

zuri-ai **records** the ingestion and **holds** its gate decision. It does not
execute the stages ADR-050 assigns to GKS or GenesisBlockDB (ADR-043 D2.1,
ADR-046). A stage that runs elsewhere still reports here; that is the whole
point of a catalog whose rows are evidence obligations rather than function
calls.

## Identity contract

FR-109 adds no new identity family. It binds the specification's trace
vocabulary onto the identities FR-071 already defines:

| Identity | Canonical field | Purpose |
|---|---|---|
| Pipeline definition | `dataPipelineDefinitionId` | `DPL-KNOWLEDGE-INGEST-V1`; the stable definition of the seventeen-stage knowledge ingestion pipeline, distinct from `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1` |
| Ingestion job | `pipeline_job_id` | The specification's §33 job identity; projected onto FR-071's `executionRunId` — one canonical run identity, not a second one |
| Stage definition | `pipelineStageId` | One of the seventeen `DPS-KI-*` ids below |
| Stage occurrence | `executionStepId` | One concrete stage execution within a job |
| Attempt | `attemptId` | One try of a stage or record; retries receive new ids |
| Source document | `docId` / `doc_id` | Stable source-document identity; the `PipelineRecordEvent` column that nothing writes today |
| Source picture | `picId` / `pic_id` | Stable source picture/image identity; nullable independently |
| Governed fact | `factId` / `fact_id` | The governed fact produced by the pipeline, not one attempt to produce it |
| Raw artifact | `artifact_id` | Spec §6 immutable internal artifact id; carried in FR-071's `artifactIds[]` envelope |
| Pipeline version | `pipeline_version` | Spec §8 provenance field; part of the BR-021 idempotency key |

`artifact_id` is generated internally and an external id is never its primary
key (spec §6; BR-002). `pipeline_job_id` is a projection name for the run
identity, not a competing UUID — FR-071's run-id-across-boundaries rule applies
unchanged.

## Canonical pipeline stages

Every stage has a stable `pipelineStageId`; every occurrence also has a unique
`executionStepId`. The owning tier follows **ADR-050 D2**, which governs. §41's
summary picture groups Stages 1–8, 9–14 and 15–16 and puts Stage 17 in a box of
its own; it is a picture of the flow, not the ownership contract, and §37/§38
name owners for only some stages.

| Sequence | `pipelineStageId` | Stage | Owning tier | Required evidence |
|---:|---|---|---|---|
| 10 | `DPS-KI-INGEST` | Stage 1 — Ingestion | Tier 1 — Execution (zuri-ai / edge) | `artifact_id`, `source_type`, `source_ref`, `content_type`, `received_at`, `checksum`, `pipeline_version` |
| 20 | `DPS-KI-PARSE` | Stage 2 — Parsing / Extraction | Tier 1 — Execution (zuri-ai / edge) | `document_id`, `parsed_from` link to the raw artifact, structure/text-block/table counts, extractor version |
| 30 | `DPS-KI-PROVENANCE` | Stage 3 — Provenance Capture | Tier 1 — Execution (zuri-ai / edge) | `source_id`, `source_type`, `source_uri`, `source_version`, `artifact_id`, `ingested_at`, `parsed_at`, `pipeline_version`, `extractor_version`, `checksum`; and for a derived object also `evidence_span`, `source_chunk_id`, `confidence`, `derivation_method`, `model_id` (spec §8) |
| 40 | `DPS-KI-NORMALIZE` | Stage 4 — Normalization | Tier 1 — Execution (zuri-ai / edge) | normalized-field count, canonical form written, proof the raw value survives |
| 50 | `DPS-KI-CLASSIFY` | Stage 5 — Classification / Access Scope | Tier 1 — Execution (zuri-ai / edge) | scope dimensions (`portfolio_id`, `tenant_id`, `business_id`, `workspace_id`, `project_id`), classification level and the FR-111 policy fields |
| 60 | `DPS-KI-DEDUPE` | Stage 6 — Deduplication / Versioning | Tier 1 — Execution (zuri-ai / edge) | dedup strategy applied, version relationship (`SUPERSEDES` / `SUPERSEDED_BY` / `REVISION_OF` / `DERIVED_FROM` / `DUPLICATE_OF`), tenant scope of the comparison |
| 70 | `DPS-KI-CHUNK` | Stage 7 — Chunking | Tier 1 — Execution (zuri-ai / edge) | `chunk_id`, `parent_id`, `document_id`, `sequence`, `heading_path`, `token_count`, `scope`, `provenance` |
| 80 | `DPS-KI-ENTITY-EXTRACT` | Stage 8 — Entity Extraction | Tier 1 — Execution (zuri-ai / edge) | `candidate_id`, type, mention, `normalized_name`, `source_chunk_id`, `confidence` — candidates only, never canonical identity |
| 90 | `DPS-KI-ENTITY-RESOLVE` | Stage 9 — Entity Resolution | Tier 3 — Knowledge (GKS) | resolution outcome (`MATCHED` / `CREATED` / `AMBIGUOUS` / `REVIEW_REQUIRED` / `REJECTED`), strategy used, canonical entity id, confidence against the auto-merge policy floor |
| 100 | `DPS-KI-FACT-EXTRACT` | Stage 10 — Relation / Fact Extraction | Tier 3 — Knowledge (GKS) | fact `subject` / `predicate` / `object` or value, `confidence`, `evidence`, `valid_time`, `provenance` |
| 110 | `DPS-KI-ONTOLOGY-MAP` | Stage 11 — Schema / Ontology Mapping | Tier 3 — Knowledge (GKS) | canonical predicate, `ontology_version`, validation result, ontology-violation rejections |
| 120 | `DPS-KI-TEMPORAL-MAP` | Stage 12 — Temporal Mapping | Tier 3 — Knowledge (GKS) | `valid_from` / `valid_to` and `tx_from` / `tx_to` where applicable, or an explicit not-applicable |
| 130 | `DPS-KI-GRAPH-BUILD` | Stage 13 — Graph Construction | GKS Tier 3 decides the graph; GenesisBlockDB Tier 4 writes it; Tier 1 does neither | node/edge counts by class, and for every business-assertion edge: provenance, confidence, temporal semantics, scope |
| 140 | `DPS-KI-ENRICH` | Stage 14 — Knowledge / Graph Enrichment | Tier 3 — Knowledge (GKS) | `derivation_method`, `source_objects`, `confidence`, `generated_at`, `pipeline_version` — derived knowledge kept separate from verified source fact |
| 150 | `DPS-KI-EMBED` | Stage 15 — Embedding | Tier 4 — Substrate (GenesisBlockDB) | `object_id`, `embedding_model`, `embedding_version`, `dimension`, `created_at`, `scope`, `content_hash` |
| 160 | `DPS-KI-INDEX` | Stage 16 — Multi-Lane Indexing | Tier 4 — Substrate (GenesisBlockDB) | per-lane routing decision across Vector / Lexical / Graph / Structured / Temporal / Provenance, and `index_generation` where the substrate exposes one (ADR-050 D5) |
| 170 | `DPS-KI-QUALITY-GATE` | Stage 17 — Graph + Retrieval Quality Gate | GKS Tier 3 and GenesisBlockDB Tier 4 execute all five dimensions; Tier 1 executes none of them and holds the evidence and the decision | gate result across the five dimensions of spec §22.1–§22.5, and the `PipelineGateDecision` row that holds it (FR-110) |

**The stage sequence is ordering metadata only.** A stage is identified by
`pipelineStageId + executionStepId`, never by its label or its sequence number.
The numbering runs in tens so that a stage inserted later never renumbers the
evidence of a job that predates it — the same rule FR-071's catalog already
follows.

Two boundaries the table does not settle, deliberately:

- **Owning tier is not execution location.** SDD-058 makes location
  policy-driven: RESTRICTED knowledge carrying `cloud_processing_allowed = false`
  runs all seventeen stages locally, and no topology change may override that.
  The specification's §35 split (1–8 local edge, 9–14 cloud GKS, 15–17 selected
  execution) is an illustrative default, not the contract.
- **Stage 15 is grouped with Stage 16 under GenesisBlockDB by §41**, but §38
  gives Genesis the *vector index* rather than embedding generation, and §35
  leaves 15–17 as "selected execution". The tier column follows ADR-050 D2;
  where the embedding is computed is resolved per object by SDD-058, not by
  this row.

Five specification enumerations are narrowed here to a one-line evidence
obligation, and the narrowing is a choice, not an oversight: §9's twelve
normalization categories, §11's five dedup strategies, §14's nine-strategy
resolution confidence ladder, §16's eight ontology responsibilities, and §21's
six-lane routing examples. The catalog states what a stage must *report*; which
strategy or category it used is the executing tier's, and reproducing the lists
here would create a second copy that drifts from the specification. One §21
item is a rule rather than a list and is therefore kept: **ห้ามบังคับทุก object
ลงทุก lane** — no object may be forced into every lane, so a Stage 16 routing
decision that admits everything everywhere is a failed routing decision, not a
thorough one.

## Job lifecycle

Each ingestion job carries the specification's §5 lifecycle:

```text
RECEIVED
  ↓
PROCESSING
  ↓
VALIDATING
  ↓
READY_TO_PUBLISH
  ↓
PUBLISHED
```

Failure states:

```text
RETRYABLE_FAILED
QUARANTINED
REJECTED
SUPERSEDED
```

A partial graph is never published without an explicit policy admitting it
(spec §5; FR-110's atomic publication rule). These job states are the knowledge
pipeline's own lifecycle and are a **projection over**, not a replacement for,
FR-071's `QUEUED → RUNNING → SUCCEEDED / FAILED / PARTIAL / ROLLED_BACK /
CANCELLED` run statuses and its `NOT_STARTED → RUNNING → SUCCEEDED / FAILED /
SKIPPED / REPLAYING` stage statuses. Where the two are recorded together, the
run status is the ledger fact and the job state is the knowledge meaning.

## End-to-end job trace

One `pipeline_job_id` must resolve the whole chain of spec §33:

```text
Source
  ↓
RawArtifact
  ↓
ParsedArtifact
  ↓
Chunks
  ↓
Entities
  ↓
Facts
  ↓
Graph
  ↓
Indexes
  ↓
Published Snapshot
```

Per-record disposition binds to `PipelineRecordEvent`, whose already-present
`docId` / `picId` / `factId` columns are what the chain attaches to — those
columns exist and nothing writes them today; they were shaped for exactly this
consumer (SDD-057). The provenance chain the trace must be able to walk
backwards is spec §8's:

```text
Fact → DERIVED_FROM → Chunk → PART_OF → ParsedArtifact → PARSED_FROM → RawArtifact → INGESTED_FROM → Source
```

A Fact or Relation whose source cannot be reached is not publishable unless it
is explicitly declared `DERIVED`, `INFERRED` or `COMPUTED` (spec §8).

## Stage evidence obligations

Beyond the per-stage evidence in the catalog, every stage carries the NFR-020
metric set — `records_in`, `records_out`, `records_failed`,
`records_quarantined`, `processing_time`, `retry_count` — and the job carries
`ingestion_lag`, `pipeline_latency`, `publication_latency`, `error_rate`,
`quarantine_rate`, `entity_resolution_rate` and `retrieval_quality_score`
(spec §32). The counts are per stage rather than per job because a stage that
reports nothing is otherwise indistinguishable from a stage that did nothing.

A failing object is classified `Retryable`, `Non-Retryable` or `Review Required`
(spec §27) and quarantined with the full BR-022 envelope — `job_id`,
`artifact_id`, `stage`, `error_code`, `error_message`, `retry_count`,
`first_failed_at`, `last_failed_at`, `pipeline_version` (spec §28). Silent loss
is the one forbidden outcome: a corpus that quietly omits what it could not
parse reports a completeness it does not have.

Reprocessing the same event never creates a second copy of the same knowledge;
idempotency is keyed on source identity + source version + content hash +
pipeline version together (BR-021, spec §29), which is what makes re-parsing
after a parser or embedding-model upgrade safe to run over a whole corpus.

## Acceptance criteria

Drawn from the specification's §40 Minimum Acceptance Criteria, restricted to
what FR-109 owns — the catalog, the trace and the evidence. **Five of the
thirteen are built** — AC-109.1, AC-109.2, AC-109.8, AC-109.9 and AC-109.10.

The persistence half this note used to call unnamed now has one:
`ingestKnowledgeDocument` (SDD-069) calls FR-118's seven-stage composition and
writes a `RECORD_STARTED`/`RECORD_SUCCEEDED` pair — `docId` bound — around a
`STEP_STARTED`/`STEP_SUCCEEDED` pair per Tier 1 stage, onto the
`PipelineStep`/`PipelineRecordEvent` rows `createPipelineRun` already
materializes. That closed AC-109.2 outright and gave AC-109.4, .7 and .13 real
evidence for the Tier 1 portion of what each asks — without closing any of the
three, because each also needs something this slice does not build.

FR-119 (SDD-072) closed a second criterion the same way, by extending FR-118
itself: `runKnowledgeIngestionStagesWithTrace` reports exactly which stages
succeeded before a document failed, so `ingestKnowledgeDocument` writes real
`STEP_SUCCEEDED` evidence for those stages and then BR-022's complete
quarantine envelope — `STEP_FAILED`, `RECORD_FAILED`, `docId` bound — for the
one that did not. AC-109.10 is fully closed, not merely evidenced: every Tier
1 failure classifies `NON_RETRYABLE` by a real finding (the seven stage
functions are pure and deterministic; an ambiguous value already declines via
`canonical: null` rather than throwing, per FR-114/SDD-061), and no object is
silently dropped.

Of the remaining eight: four name a **declared id** — NFR-020, FR-110 (twice,
for AC-109.7 and AC-109.11) and SDD-059's charter change. One names a
boundary — Stages 9-17 report from GKS and GenesisBlockDB, which is ADR-050 D3
and not a gap in this repository. AC-109.3 names a column, not a subsystem.
AC-109.13 names a decision nothing has made yet: acting differently on a
`REVISION_OF` result than on a fresh one.

- [x] **AC-109.1** `DPL-KNOWLEDGE-INGEST-V1` is registered as one pipeline
      definition carrying exactly the seventeen `DPS-KI-*` stage ids above, and
      is distinct from `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1`. Both definitions
      live in `PIPELINE_DEFINITIONS`; a test asserts the seventeen ids in order
      and asserts the two catalogs share no id.
- [x] **AC-109.2** At least one structured and at least one unstructured source
      type can be ingested through the same catalog, with no second stage list
      for either. `ingestKnowledgeDocument` registers a real
      `DPL-KNOWLEDGE-INGEST-V1` run and writes real per-stage evidence for both
      an unstructured document (prose text) and a structured record, through
      the same seven-stage call sequence — proven by two integration tests
      against the real database, not asserted from FR-118's pass-through alone
      (SDD-069).
- [ ] **AC-109.3** The raw artifact is stored before transformation and is
      recoverable from `artifact_id` after normalization has run (spec §3.1).
      Waits on **binding `artifact_id` to storage that already exists**. FR-081's
      `RawExternalRecord` holds `payloadJson`, `payloadHash` and `sourceUri`,
      so the raw artifact IS stored before transformation and IS recoverable —
      by FR-081's own idempotency key. What is missing is narrower than a
      subsystem: nothing resolves a run's `artifact_id` to that row, because
      `RawExternalRecord` carries no artifact id and the run carries it only as
      `artifactRef` and in `identityRefs.artifactIds`. A column or a documented
      convention, not a build.
- [ ] **AC-109.4** Every derived object carries provenance, and the §8 chain
      `Fact → Chunk → ParsedArtifact → RawArtifact → Source` can be walked from
      any published object.
      SDD-069 gives the Tier 1 portion a real `docId`-bound record on the
      ledger; the §8 chain it names is domain objects (Chunk, ParsedArtifact),
      not ledger evidence, and none of those are persisted anywhere a resolver
      could walk. Waits on **persisted derived objects and FR-110**. FR-116
      already walks the chain and terminates on cycles; it has nothing to walk
      over, and "published object" is FR-110's contract, which is declared and
      unbuilt.
- [ ] **AC-109.5** A chunk resolves back to its document through `document_id`,
      `parent_id`, `sequence` and `heading_path`.
      Waits on **chunk persistence, which SDD-059 already scoped**: FR-112
      computes all four fields, and SDD-059 states that storing chunks is a
      later slice needing a knowledge-charter change. A declared decision, not
      an open question.
- [ ] **AC-109.6** Every one of the seventeen stages reports its catalog
      evidence and the six NFR-020 per-stage metrics; a stage that produced
      nothing reports zero rather than being absent.
      The seven Tier 1 stages report catalog evidence (SDD-069) and now four
      of the six metrics too (SDD-070) — `records_in`/`records_out` read from
      what each stage actually produced (the real chunk count for Stage 7,
      the real candidate count for Stage 8, not a placeholder), `records_failed`
      always 0 on this success-only path, `processing_time` already computed
      from timestamps SDD-069 sets. Still not "every one of seventeen": the
      other nine stages report nothing (waits on a Tier 3/4 reporter), and
      `records_quarantined`/`retry_count` are declined for all seven —
      BR-022 and replay-within-run don't exist, so there is nothing real to
      attach.
- [ ] **AC-109.7** One `pipeline_job_id` resolves the full §33 chain from Source
      to Published Snapshot, with per-record disposition on
      `PipelineRecordEvent` bound through `docId` / `picId` / `factId`.
      `docId`-bound disposition is real for the Tier 1 portion (SDD-069) —
      `ingestKnowledgeDocument` is the first producer to supply it, resolvable
      from one `executionRunId` (the `pipeline_job_id` projection). Waits on
      **FR-110** for the chain's other end: "to Published Snapshot" needs a
      snapshot to resolve to, and none exists yet.
- [x] **AC-109.8** A stage occurrence is identified by
      `pipelineStageId + executionStepId`; inserting a new stage does not
      renumber or invalidate the evidence of an earlier job. A stage id is now
      validated against its own definition's catalog rather than the union of
      both (SDD-066), so `DPS-KI-EMBED` on a Supabase run is rejected by the
      envelope instead of being merely wrong.
- [x] **AC-109.9** Duplicate ingestion of the same event creates no duplicate
      knowledge, keyed on source identity + source version + content hash +
      pipeline version (BR-021). FR-117's `ingestionIdentity` is the run's
      `idempotencyKey`, and `PipelineRun.idempotencyKey` is `@unique`, so the
      guarantee is a database constraint rather than a comparison a caller
      performs. Proven against the real database, not only against the
      in-memory fake, because a fake that does not implement `@unique` cannot
      fail the test that matters.
- [x] **AC-109.10** A failed object is classified retryable / non-retryable /
      review-required and quarantined with the complete BR-022 envelope; no
      object is dropped. `ingestKnowledgeDocument` (FR-119) writes the full
      nine-field envelope — `job_id`, `artifact_id`, `stage`, `error_code`,
      `error_message`, `retry_count`, `first_failed_at`, `last_failed_at`,
      `pipeline_version` — plus `classification`, and `docId`-binds a
      `RECORD_FAILED` event so the document is never silently dropped. Every
      Tier 1 stage's failure classifies `NON_RETRYABLE` — a finding, not a
      placeholder: the seven stage functions are pure and deterministic, so a
      thrown validation error repeats identically on retry, and an ambiguous
      value already declines via `canonical: null` (FR-114, SDD-061) rather
      than throwing, so it never reaches quarantine to need `REVIEW_REQUIRED`.
- [ ] **AC-109.11** The job lifecycle exposes `RECEIVED`, `PROCESSING`,
      `VALIDATING`, `READY_TO_PUBLISH`, `PUBLISHED` and the failure states
      `RETRYABLE_FAILED`, `QUARANTINED`, `REJECTED`, `SUPERSEDED`, and never
      infers `PUBLISHED` from elapsed time or a stale heartbeat.
      Waits on **FR-110** (declared 2026-08-27, unimplemented) — the nine job
      states are its lifecycle, not a second one.
- [ ] **AC-109.12** Stages executed outside Tier 1 still report their evidence
      onto the ledger, and zuri-ai executes no stage the tier boundary assigns
      to GKS or GenesisBlockDB.
      Waits on **GKS and GenesisBlockDB reporting onto this ledger**. Not a gap
      in this repository: ADR-050 D3 assigns those nine stages elsewhere, and
      the half zuri-ai owns — executing none of them — holds today.
- [ ] **AC-109.13** A new source artifact updates only the affected entities,
      facts, graph regions and indexes; rebuilding the whole knowledge graph is
      not the normal path (spec §30).
      FR-118's `dedup` result already distinguishes `REVISION_OF` from
      `DUPLICATE_OF` on every call, and SDD-069's wiring runs the full
      seven-stage pass regardless of which the artifact turns out to be — the
      input an incremental path needs is now computed AND recorded on every
      ingestion. Waits on **something acting on it**: nothing reads a
      `REVISION_OF` result and updates only the affected entities rather than
      running the same full pass a fresh artifact would.

## Non-goals

- **No Prisma model and no schema change**, then or now. ADR-050 D4 committed
  to the existing FR-071 models, so a slice proposing a new one is reopening
  that decision rather than implementing it. The 2026-08-28 slice added a
  catalog constant, a definition registry and a pure input builder — no model,
  no migration, no route.
- **Not the whole trace and not the monitor.** Five of the thirteen acceptance
  criteria are built now; eight are not, and none of the eight wait on
  ledger-writing wiring or on failure attribution any more — both exist
  (SDD-069, SDD-072) and gave three of the eight real evidence without
  closing them. Reading this note as "FR-109 is done" would still overstate
  it, now by eight criteria rather than nine, each waiting on something
  specific and named above.
- zuri-ai does not execute the stages ADR-050 assigns to GKS or
  GenesisBlockDB. Entity resolution, ontology authority, fact and relation
  governance stay with GKS (spec §37); vector, lexical, graph, structured,
  bitemporal and provenance indexes stay with GenesisBlockDB (spec §38).
- No second execution ledger. FR-109 reuses FR-071's models unchanged
  (SDD-057); it does not fork `PipelineRun` or redefine run identity.
- No stage id is invented here that the specification does not describe, and no
  stage is renamed to fit a module boundary.
- Not a deployment topology. Where a stage runs is FR-111 policy resolved by
  SDD-058, and this catalog does not decide it.
- Not the published-snapshot contract (FR-110) and not the classification
  lattice (FR-111); this note stops at the catalog, the trace and the evidence.

## Implementation boundary

The catalog landed where this note said it should: as a second frozen catalog
in `src/platform/integrations/core/pipeline-tracking-contract.js`, keyed to
`DPL-KNOWLEDGE-INGEST-V1`, **not** as an extension of `PIPELINE_STAGE_CATALOG`
— whose ten `DPS-*` ids belong to a different pipeline definition and keep
their meaning.

Making that catalog reachable cost the parameterization SDD-057 predicted, and
the prediction was exact: `zPipelineEvent` and `zPipelineRunInput` pinned
`dataPipelineDefinitionId` and `executionContractId` with `z.literal`, so a
knowledge run was rejected by the envelope before any stage id was even read.
SDD-066 replaces both pins with `PIPELINE_DEFINITIONS`, a registry keyed by
definition id holding that definition's execution contract id and its own
catalog. Two consequences the diff does not show:

- **The envelope now validates the pair.** A run claiming
  `DPL-KNOWLEDGE-INGEST-V1` under `EXC-DATA-MIGRATION-V1` is rejected, where
  two independent `z.literal` pins could only have checked each half alone.
- **A stage validates against its own definition, never the union.** The
  cheaper change — widen the refinement to every known stage id — would have
  let a Supabase migration run report a `DPS-KI-EMBED` step and pass every
  check. That is ADR-050 D3's tier boundary being crossed inside a validator
  that reported no problem, which is worse than no validator.

Every existing caller keeps validating unchanged, because
`DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1` + `EXC-DATA-MIGRATION-V1` remains a
registry pair: the three `/api/pipelines/*` routes, the MCP transport's three
pipeline tools, and `createPipelineRunFromWorker`, which delegates.

The knowledge lane's contribution stays pure. `knowledgeIngestionRunInput`
takes an artifact and returns a run input; the write is `createPipelineRun`,
owned by the integrations lane, so the knowledge charter's `owns_models: []`
stays true and there is no second persistence path (SDD-057). The knowledge domain owns no Prisma
model (see the domain charter); the ledger it would write to is owned by the
integrations lane, so the write path is a service call, never a second
persistence path. Spec §36's package outline — one directory per stage group —
is a logical structure only: it explicitly does not require a directory to
become a network service, and it does not override the tier boundary above,
which says who may run a stage rather than where its code sits.

**The ledger-writing wiring (2026-08-28, SDD-069) landed the same way, and
one level further in.** `ingestKnowledgeDocument` lives in
`src/platform/integrations/core/knowledge-ingestion-executor.js` — not in
`src/modules/knowledge/` — for the reason the paragraph above already states:
the write path belongs where the models are owned. It is the first file in
the knowledge lane's dependency graph that performs I/O, and it performs none
of its own: every write is `createPipelineRun` or `recordPipelineEvent`,
called with input `runKnowledgeIngestionStages` (FR-118) and
`knowledgeIngestionRunInput` (this note) computed. This is the first slice to
make the six `Pipeline*` models a second-writer arrangement, and it gained an
explicit owner in the same change: the integration domain, whose charter now
states the models are pipeline-agnostic by SDD-057 and were never available
for knowledge to claim in the first place — knowledge's own first boundary is
owning none.

The run this function creates is never marked finished. Nine of the
seventeen catalog steps are Tier 3/4 work this repository does not execute
(ADR-050 D3); claiming `RUN_FINISHED` would assert a run seven-seventeenths
done is complete. A stage failure inside FR-118 is not caught or classified —
FR-118's composition is one synchronous call with no partial result, so
nothing at the wiring layer can name which of the seven stages threw without
changing FR-118's contract, which this slice does not do.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-071 — Supabase data pipeline monitor and replay](./FR-071-supabase-data-pipeline-monitor-and-replay.md)
- [FR-047 — LINE business-knowledge pilot](./FR-047-line-business-knowledge-pilot.md)
- [FR-110 — Published knowledge snapshot contract](./FR-110-published-knowledge-snapshot-contract.md)
- [FR-111 — Knowledge sensitivity lattice](./FR-111-knowledge-sensitivity-lattice.md)
- [PRD-SDD v1.0 — FR-109, SDD-057, SDD-058, NFR-020, BR-021, BR-022, SEC-021](../../../PRD-SDD-v1.0.md)
- [ADR-043 — Four-tier cognitive architecture](../../../decisions/ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md)
- [ADR-046 — SoT pipeline interim serving and pulled decisions](../../../decisions/ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md)
- [ADR-050 — Knowledge Ingestion Tier Boundary and Stage Ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §4, §5, §33, §36 are the sections this note
  elaborates
