---
domain: knowledge
version: "1.3.0b"
status: beta
last_update: "2026-09-08T17:30:00+07:00,RWANG"
module: src/modules/knowledge
owns_models:
  - KnowledgeCorpus
  - KnowledgeSource
  - KnowledgeIngestion
  - KnowledgeCorpusGeneration
  - KnowledgeRawArtifact
  - KnowledgeParsedArtifact
  - KnowledgeChunk
  - GenesisRag17IngestionIntent
  - GenesisRag17SourceMention
  - GenesisRag17Batch
  - GenesisRag17StageEvidence
  - GenesisRag17EvidenceCursor
  - GenesisRag17PublicationReceipt
---

# Domain charter — knowledge

Current GenesisRAG17 execution and extension authority:
[17-stage spec](../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md),
[flow / stage-to-feature map](../../KNOWLEDGE-INGESTION-17-STAGE-FLOW.md),
[ADR-073](../../decisions/ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md).
The isolated profile runs all 17 stages across four repositories; this domain owns
only Tier 1 preparation, durable lineage and receipt-bound evidence. Existing pure
FR-111–118 modules retain their own contracts; the GenesisRAG17 adapter uses the
specific text/private-policy profile described in the flow, not every target capability.

Canonical business knowledge (GKS): what the system knows as governed fact —
product identity, business rules, approved answers. Distinct by authority, not
by storage: it answers "what does the system know", never "what happened"
(that is MSP, in the agent domain) and never "what is the state now" (that is
operational data in its owning domain). Architecture spec §16–19.

"(GKS)" names the authority this domain **consumes**, not a claim that this
domain is GKS. The Genesis Knowledge System, MSP and GenesisBlockDB are
external systems with their own repositories and are never zuri-ai domains
(ADR-063 D3–D4); this lane holds only the Tier 1 contracts that face them.

[ADR-072](../../decisions/ADR-072-KNOWLEDGE-ADMISSION-AND-CORPUS-PUBLICATION.md) adds the authorized Text/Markdown admission queue and Tier 1 corpus read set. Each source still traverses its own 17-stage run; a corpus manifest joins independently verified snapshots without asserting cross-document native graph traversal.

## Boundaries

- **Owns no canonical production knowledge store.** Its store is the production
  runtime's `zuri_core.business_knowledge` behind the knowledge port
  (`postgres-business-knowledge`), plus the governed import built by
  `scripts/build_business_knowledge_import.py`. The approved GenesisRAG17 TEST
  slice adds the local lineage and bounded evidence models named in this
  charter; they are execution records, not canonical GKS knowledge.
- Knowledge enters through governed import/approval — never automatically from
  conversation (spec §19: MSP → candidate → validation → GKS, in that order).
- Serves grounded answers to the agent domain through the knowledge contract;
  it does not talk to LINE and it does not resolve identity.
- **Holds no client of GenesisBlockDB** — no `GenesisDatabase` binding, no
  `hybridSearch`, no embedding call, no `addNode`/`addEdge` (ADR-043 D2.1,
  ADR-050 D3). The two files that once did (`gbdb-rag-service.js`,
  `genesisblockdb-sink.js`) were retired by ADR-063 on 2026-09-06. The
  `GraphSink` seam in `sink.js` stays; in the approved ADR-073 profile the physical
  substrate writer belongs to the separate GenesisBlock worker behind MSP.
  `createGraphKnowledgeReader`'s injected `traverse` may only ever
  be bound through MSP → GKS or the ADR-046 interim surface, never to the
  substrate directly. `smartgift-rag-pipeline.js`, the third such client,
  went the same day (ADR-063 D2a); `smartgift-knowledge-catalog.js` stays as
  data and feeds the PUBLIC business-knowledge fixture the SmartGift webhook
  e2e test reads through the in-memory reader. Zero exceptions remain.

## Ingestion lane (FR-109, FR-110, FR-111 — ADR-050)

### Approved GenesisRAG17 TEST implementation boundary (2026-09-07)

The approved `genesisrag17.v1` TEST slice changes the Tier 1 boundary for the
raw-to-batch handoff. This is an additive implementation boundary: the
knowledge lane owns the immutable local lineage needed to prove the raw
entrypoint — `KnowledgeRawArtifact → KnowledgeParsedArtifact →
KnowledgeChunk` — and the bounded delivery records needed to resume one
Stage 9 attempt without inventing a second run. It also owns the local
Stage 9–17 evidence cursor, publication-receipt reference and durable Stage 9
batch state. These records hold source identity, hashes, offsets, counts and
redacted details; they do not hold GKS facts, canonical entities, embeddings,
index payloads or GenesisBlockDB data.

Before Stage 1, `GenesisRag17IngestionIntent` retains the exact scoped source
request and immutable derivation configuration. The source loop resumes its
interrupted attempt automatically. `GenesisRag17SourceMention` stores each
Stage 8 occurrence before terminal evidence; correction/replay preserves the
earlier version and attempt. Both models participate in backup/restore.

One raw entry creates one document and one execution run. Stage 1 records real
raw persistence evidence before the local parser runs. Stages 2–8 preserve
exact source offsets and source-mention occurrences, and the Stage 9 batch is
created once for the materialized Stage 9 `executionStepId` + `attemptId`.
Stages 9–17 remain external execution: Tier 1 sends and receives only the
frozen MSP pipeline contract, maps evidence by all four stage identities and
never selects a latest step as a fallback. A successful close requires the
matching publication receipt. Start, stop and resume are durable MSP calls;
Tier 1 never writes an MSP, GKS or GenesisBlockDB store directly.

The wire contract is recorded in
[`docs/plans/GENESISRAG17-CONTRACT.md`](../../plans/GENESISRAG17-CONTRACT.md)
for this implementation wave. Root-owned governance reconciles its final
canonical document location and generated views.

- Holds the **declaration** of the seventeen-stage knowledge ingestion
  pipeline: the stage catalog (`DPL-KNOWLEDGE-INGEST-V1`, seventeen stable
  `DPS-KI-*` stage ids), the end-to-end job trace, the published-snapshot
  contract and the sensitivity/processing-policy classification lattice.
- **Declares and monitors ingestion; the TEST entrypoint executes and persists
  Tier 1 stages 1–8.** The stages ADR-050 assigns to GKS (Tier 3) and
  GenesisBlockDB (Tier 4) remain external. This domain registers the
  definition, records the run, holds the Stage 17 gate decision and consumes
  the resulting snapshot — Tier 1 is not a substrate writer (ADR-043 D2.1),
  and serving stays behind the interim contract (ADR-046).
- The FR-071 execution ledger is reused unchanged (SDD-057), while the
approved TEST slice adds the additive raw/parsed/chunk lineage, bounded
evidence, receipt reference and durable Stage 9 batch/cursor records listed in
`owns_models`. A knowledge ingestion run is still created through the
  integrations lane's `createPipelineRun`; these extra rows never become a
  second canonical knowledge store.

### Built here — the eight Tier 1 stages, their composition, and the run identity

ADR-050 D2 assigns eight of the seventeen stages to Tier 1, and all eight have
code: ingestion (FR-081), parsing (FR-115), provenance capture (FR-116),
normalization (FR-114), classification (FR-111), deduplication (FR-117),
chunking (FR-112) and entity extraction (FR-113). Every one is a pure
calculator; the executor composes those calculators with the canonical raw
ingestion repository and persists the TEST lineage/evidence rows.

**Eight implementations were not a running pipeline, and on 2026-08-28 that
stopped being true of seven of them.** `runKnowledgeIngestionStages` (FR-118)
calls Parse → Provenance → Normalize → Classify → Dedupe → Chunk → Entity
Extraction in one pass over one artifact — proven by a test that runs all
seven on one real input, not by the four pairs that stood in for it before
(parsing into chunking (SDD-063), chunking into entity extraction,
classification into chunking, deduplication into the run input). Stage 1
(ingestion, FR-081) stays outside this composition: it is a different module
answering a different question — the raw-boundary re-delivery identity, not
the knowledge-ingestion identity — and its output is what FR-118 takes as its
`artifact` input, already arrived.

**Composition is not operation, and that distinction is now the one most
likely to be lost.** FR-118 opens nothing and writes nothing; calling seven
functions in memory is not the tier executing. "Tier 1 composes end to end
in-process" is the accurate sentence; "the pipeline runs" still overstates it
by exactly the gap FR-109's remaining acceptance criteria name below.

The single thing in this lane that reaches persistence is the ingestion
identity (FR-109, AC-109.9). BR-021's four-part key is the `idempotencyKey` of
the `DPL-KNOWLEDGE-INGEST-V1` run, and `PipelineRun.idempotencyKey` is
`@unique`, so re-ingesting an artifact returns the run that already exists
instead of creating a second one. The uniqueness belongs to the database, not
to this domain — which is the point: a rule held by a constraint outlives a
rule held by whichever caller remembers to check.

FR-109 itself is delivered at six of its thirteen acceptance criteria: the
catalog, the run identity, a structured and an unstructured source both
provably ingested through the one catalog (SDD-069), the raw artifact
recoverable from a run's `artifact_id` (AC-109.3, closed by one nullable
column on FR-081's own `RawExternalRecord` — not a knowledge-domain write) —
and, since FR-119 (SDD-072), a failed document quarantined with BR-022's
complete envelope rather than reported as nothing having happened. Not the
job trace and not the monitor in full: three more criteria gained real Tier-1
evidence without closing, because each also needs something this slice does
not build (FR-110's Published Snapshot, persisted derived objects, or a
reader that acts on a `REVISION_OF` result).

Of the remaining seven, four wait on a declared id — NFR-020 (AC-109.6),
FR-110 (AC-109.7 and AC-109.11) and SDD-059's charter change (AC-109.5) —
one waits on GKS and GenesisBlockDB reporting onto the ledger (AC-109.12,
ADR-050 D3, outside this repository), and two on a reader or a decision
nothing has written yet (AC-109.4, AC-109.13). **None wait on "a stage
runner" any more**
— that phrase named two different unbuilt things at once, and both now have
ids: FR-118 is the compute half (seven stages composed in one pass) and
SDD-069 is the persistence half (writing that composition onto the FR-071
ledger). The phrase is retired because it stopped being able to name anything
precisely the moment a second thing needed the same word.

**NFR-020 moved from zero to partial the same way (SDD-070, SDD-071):** four
of its six per-stage metrics now write real values, computed per Tier 1 stage
from what actually happened rather than a uniform placeholder. Wiring it
surfaced a defect outside this domain entirely — the execution monitor
(`src/modules/project-manager/views/execution/mode-bodies.jsx`) reads
`PipelineRun.actualCount`/`.failedCount` directly, and nothing had ever
written either; `@default(0)` rendered as a measured zero on a live screen,
`Failed` in normal ink because it was zero. Fixed in the integration domain's
own file (`recordPipelineEvent` now aggregates real counts onto the run),
found from this side because knowledge ingestion was the first caller to
report a count at all.

**BR-022 closed the same day (FR-119, SDD-072).** FR-118 kept its
throw-on-first-failure contract unchanged — all fifteen of its tests still
pass — and gained a sibling, `runKnowledgeIngestionStagesWithTrace`, sharing
every field mapping so neither duplicates the other. A document that fails
partway now gets real `STEP_SUCCEEDED` evidence for what completed and
BR-022's full quarantine envelope for what did not, `docId` bound, nothing
silently dropped. The finding underneath: every Tier 1 stage failure
classifies `NON_RETRYABLE`, because the seven stage functions are pure and
deterministic and an ambiguous value already declines via `canonical: null`
(FR-114, SDD-061) rather than throwing — `RETRYABLE` and `REVIEW_REQUIRED`
stay real vocabulary for failure modes this repository does not yet have,
not deleted for lack of a current trigger. `errorRef` stays a redacted
reference on the FR-071 ledger; the raw failure message lives only in the
envelope this executor returns to its own caller.

### Partially implemented — FR-110 (🟠)

`src/modules/knowledge/published-snapshot-contract.js` (154 lines) carries a
real, tested contract, not only a documentary declaration: the strict
`knowledge_snapshot_id` snapshot shape, the Stage 9–16 aggregate stage-report
envelope, the Stage 17 quality-gate decision (`ledgerStatus` kept distinct
from the quality `verdict`, per SDD-057) with its snapshot-scope assertion,
and `evaluateKnowledgePublication`, which checks publication preconditions —
policy allow-flag, an `APPROVED` FR-071 ledger status, a `PASS` /
`PASS_WITH_WARNINGS` verdict, a non-null snapshot, no failed or critical
dimension — without itself publishing or mutating anything.

**The receiver exists since ADR-067 (2026-09-07), and it is not in this
lane.** `recordKnowledgeStageReport`, `recordKnowledgeStage17Decision`,
`finishKnowledgeIngestionRun` and `readKnowledgeIngestionJob` live in the
integration lane's `knowledge-ingestion-executor.js` — the write path belongs
where the models are owned, the same rule SDD-069 followed — fronted by four
routes under `/api/pipelines/knowledge/{executionRunId}` that authenticate the
run's Tenant's FR-102 data-plane key (the owner's D2 decision). What this lane
added for it stays pure: `knowledgeJobState` derives FR-109's §5 job state
from ledger facts with no clock (AC-109.11 closed), and `knowledgeRunOutcome`
derives what closing a run may write; neither opens a database. The envelopes
in `published-snapshot-contract.js` gained `outcome`, `failure`, `startedAt`
and `finishedAt`.

Current isolated execution and remaining production boundary (ADR-073):

- No route or caller invokes `evaluateKnowledgePublication` in production; it
  has unit-test callers only. Publication is the external tiers' act; the
  receiver records their decision rather than making one.
- ADR-068's legacy `gks_stage_evidence_export` path remains distinct. The new
  `genesisrag17.v1` source worker submits one batch per Stage 9 attempt and pulls
  exact-attempt evidence through MSP. GKS 9–14 and the quality gate, plus the
  separate GenesisBlock worker's physical 13/15/16/publication, are implemented
  and exercised in the isolated [acceptance report](../../../.brain/reports/GENESISRAG17-ACCEPTANCE.md).
  Legacy evidence without attempt identity cannot close a new attempt.
- Atomic publication lives in the GenesisBlock worker. Tier 1 imports its
  matching receipt and refuses successful finish without it; Tier 1 never
  owns or mutates the published pointer or candidate indexes.
- ADR-073 authorizes seven local lineage/batch/evidence/cursor/receipt models
  listed in this charter and the source worker. This supersedes the historical
  no-new-model slice limit, not the prohibition on a Tier 1 canonical fact store.

## Public contract

Only what exists in code today. Anything declared and unbuilt belongs in the
ingestion lane above, never here.

- The business-knowledge query port consumed by `grounded-business-answer`.
- The import contract (`business-contract`) with its public-field deny rules —
  prices and internal fields never cross into servable knowledge unapproved.
  Its `sensitivity` field now admits the whole FR-111 lattice — PUBLIC /
  INTERNAL / CONFIDENTIAL / RESTRICTED — while the query filter that decides
  what is SERVED to a public surface stays at `PUBLIC`. The two are separate on
  purpose and SDD-062 pins why: widening what knowledge may CARRY must not
  widen what knowledge is SERVED, and the filter is not stale code awaiting a
  matching update.


## Documentation version diff — 2026-09-08

| Version | Change | Runtime impact |
|---|---|---|
| 1.2.0b → 1.3.0b | Own four admission/corpus models and the ADR-072 snapshot read-set boundary | Additive phases 0–4; no production migration |
| 1.1.0b → 1.2.0b | Declare source intent and occurrence ownership for approved audit remediation | Additive isolated persistence and recovery; no production migration |
| unversioned → 1.1.0b | Current isolated profile and extension navigation; stable stage/requirement IDs and original section numbers preserved | None; historical acceptance evidence unchanged |
