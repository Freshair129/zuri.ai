---
domain: knowledge
feature: FR-110
module: knowledge
source: v2-native
version: "0.4.0b"
status: "partial"
---

# FR-110 — Published knowledge snapshot contract

## Intent

FR-110 makes published knowledge readable only as a whole, identified
publication. A consumer must be able to name the corpus an answer came from,
and two answers must be comparable for whether they read the same one. Without
a snapshot identity, "the knowledge base said so" is not a checkable claim —
the corpus moves underneath every answer and no two answers can be shown to
disagree about the same facts rather than about different ones.

Three rules make that possible, all from the 17-Stage Knowledge Ingestion
Specification:

1. A publication has an identity and a version (§25).
2. Publication is **atomic** — a half-built index is never exposed to
   retrieval (§24).
3. Only a Stage 17 gate result of `PASS` or `PASS_WITH_WARNINGS` may publish;
   `QUARANTINE` and `FAIL` may not (§23).

zuri-ai **consumes** snapshots and **records** the publish-or-quarantine
decision on the FR-071 `PipelineGateDecision` ledger. It does not build the
indexes a snapshot names (ADR-050; ADR-042 D2).

## Identity contract

| Identity | Canonical field | Purpose |
|---|---|---|
| Snapshot | `knowledge_snapshot_id` | The published corpus identity; what an answer cites |
| Tenant scope | `tenant_id`, `business_id` | The isolation boundary the snapshot was built inside (SEC-001) |
| Ontology | `ontology_version` | Which canonical predicates and entity types the snapshot's facts were mapped to (spec §16) |
| Pipeline | `pipeline_version` | Which pipeline produced it; also part of the BR-021 idempotency key |
| Publication time | `published_at` | When the snapshot became readable |

Two further fields travel with a snapshot without being part of the §25
contract, and FR-110 declares neither:

| Field | Where it comes from | Standing here |
|---|---|---|
| `pipeline_job_id` | FR-109's end-to-end trace identity for the ingestion that produced the snapshot | Declared by FR-109, not by FR-110's §25 contract |
| `index_generation` | Spec §24's recommended companion to the snapshot id, so retrieval can name the index build it was served from | Spec-side only, carried where the substrate exposes one (ADR-050 D5); declared by nothing |

Neither is among the fields FR-110's PRD statement enumerates from §25, and
this note may not widen the requirement it explains.

## Snapshot shape

The logical structure from spec §25:

```json
{
  "knowledge_snapshot_id": "ks_...",
  "tenant_id": "...",
  "business_id": "...",
  "ontology_version": "...",
  "pipeline_version": "...",
  "published_at": "...",
  "statistics": {
    "documents": 0,
    "chunks": 0,
    "entities": 0,
    "facts": 0,
    "relations": 0
  }
}
```

The statistics are part of the contract, not decoration: they are how a
consumer notices that a snapshot it expected to be larger is not, and how two
snapshots are compared without reading either corpus. A snapshot that reports
no counts cannot be told apart from an empty one.

## Gate result vocabulary

Stage 17 (`DPS-KI-QUALITY-GATE`) returns exactly one of four results (spec §23),
after checking the five dimensions of §22.1–§22.5 — data quality, graph
quality, knowledge quality, security quality and retrieval quality:

| Gate result | May publish | Meaning |
|---|---|---|
| `PASS` | yes | No blocking finding in any of the five dimensions |
| `PASS_WITH_WARNINGS` | yes | Findings recorded, none blocking |
| `QUARANTINE` | **no** | The corpus is held with its findings; it is neither published nor discarded |
| `FAIL` | **no** | The build is rejected |

The specification states this in Thai: only `PASS` and `PASS_WITH_WARNINGS`,
and among those only the ones policy permits, may publish. The two results are
therefore a *necessary* condition for publication, with policy still able to
withhold it. Nothing here makes `PASS_WITH_WARNINGS` automatically sufficient.

A critical **security** failure blocks publication outright (spec §22.4):
missing tenant scope, a cross-tenant relation, an access-policy or
classification violation, restricted-content leakage, or unsafe cloud
processing. That dimension is not tradeable against the other four.

§22.5's retrieval-quality metrics are `Recall@K`, `Precision@K`, `MRR`, `NDCG`,
`Hit Rate`, `Context Precision`, `Context Recall`, `Citation Correctness`,
`Groundedness` and `Answer Faithfulness`. The specification does not require
every metric on every ingestion, but it does require a benchmark/evaluation
suite for release — and **that suite is not declared here**. FR-053 already
owns the Phase-1 golden-question evaluation gate in this repository; a
snapshot-level retrieval benchmark extends that lane rather than this one.
FR-110 carries only the gate's *result*, and NFR-020's
`retrieval_quality_score` is where the measured number lands.

Every result — including the two that publish — is recorded on the FR-071
ledger as a `PipelineGateDecision`, and it is recorded as gate **evidence**,
not as the row's `status`. `GATE_STATUSES` in
`src/platform/integrations/core/pipeline-tracking-contract.js` is `PENDING` /
`APPROVED` / `REJECTED` / `WAIVED`, pinned by `z.enum` on a `.strict()`
envelope, and FR-110 adds no fifth value: `status` stays one of those four —
approving for `PASS` and `PASS_WITH_WARNINGS`, rejecting for `QUARANTINE` and
`FAIL` — while the §23 result itself is carried in the decision's evidence. The
§23 vocabulary is a projection over, not a replacement for, FR-071's gate
statuses, the same relation FR-109's job lifecycle has to FR-071's run
statuses. `QUARANTINE` and `FAIL` are evidence, not absence: a corpus that
failed its gate must be visible as having failed, not merely missing.

## Atomic publication

```text
READY_TO_PUBLISH
        ↓
Atomic Publication
        ↓
PUBLISHED
```

Retrieval never observes a partially built index (spec §24). The transition is
all-or-nothing: either the whole snapshot becomes readable under one
`knowledge_snapshot_id`, or nothing of it does. A partial graph is not
published without an explicit policy admitting it (spec §5).

The practical consequence is that a snapshot id is never reused or mutated.
Correcting a snapshot means publishing a new one and letting the old one be
superseded — the FR-109 job lifecycle's `SUPERSEDED` state — so that an answer
that cited the old id can still be reconstructed and checked.

## GraphRAG Ready

Spec §26 defines when knowledge counts as `GraphRAG Ready`. It is a property of
a published snapshot, checked as a whole:

- [ ] Entity identity resolved
- [ ] Relations normalized
- [ ] Facts provenance-backed
- [ ] Tenant scope valid
- [ ] Temporal fields mapped where required
- [ ] Required embeddings created
- [ ] Graph indexes available
- [ ] Retrieval indexes available
- [ ] No critical quality failure
- [ ] Published snapshot available
- [ ] Retrieval query can return evidence with citations

The last line is the operative one: readiness is not a build status, it is the
ability to answer with evidence a reader can follow back to a source.

## Consumption boundary

The read path belongs to the tiers above and below, not to this requirement
(spec §39):

```text
User Query → MSP scope/session → GKS → query planning → query-ir.v1
  → GenesisBlockDB → Evidence Packet → rerank / context build → LLM / Agent
```

FR-110 governs the object at the top of that path — what a snapshot *is* and
when it may exist. It does not govern query planning (GKS), index execution
(GenesisBlockDB) or session scope (MSP). The pipeline never executes a
user-facing retrieval query, and retrieval never triggers ingestion as a side
effect of a query.

## Acceptance criteria

Drawn from the specification's §40 Minimum Acceptance Criteria, restricted to
what FR-110 owns — the gate, the publication and the snapshot. The KNO-01
contract slice and the zuri-ai half of KNO-02 — the reporter receiver, the
Stage 17 decision writer and the derived run close (ADR-067, 2026-09-07) —
are implemented; publication and retrieval remain open.

- [ ] **AC-110.1** A published snapshot carries `knowledge_snapshot_id`,
      `tenant_id`, `business_id`, `ontology_version`, `pipeline_version`,
      `published_at` and the five object statistics of spec §25.
- [ ] **AC-110.2** The Stage 17 quality gate blocks publication on a critical
      failure, and a critical security finding blocks it regardless of the
      other four dimensions.
- [ ] **AC-110.3** Only a gate result of `PASS` or `PASS_WITH_WARNINGS` reaches
      publication; `QUARANTINE` and `FAIL` cannot publish under any policy.
- [x] **AC-110.4** Every gate result, publishing or not, is recorded as a
      `PipelineGateDecision` linked to the producing `pipeline_job_id`, with
      the §23 result carried as that decision's evidence while its `status`
      remains one of FR-071's `PENDING` / `APPROVED` / `REJECTED` / `WAIVED`.
      Closed by ADR-067: `recordKnowledgeStage17Decision` writes the decision
      as `GATE_UPDATED` on the run's materialised Stage 17 step — evidence is
      `toKnowledgeStage17Evidence`'s verdict/snapshot/dimensions, `status` is
      the FR-071 ledger status, and the shared envelope refuses an `APPROVED`
      row whose verdict or dimensions block publication — then closes the
      step `SUCCEEDED`: the gate ran; the verdict is the decision. Proven
      against the real database for `PASS`, `FAIL` and `QUARANTINE`.
- [ ] **AC-110.5** Publication is atomic: retrieval never observes a snapshot
      whose indexes are partially built, and no partial graph is published
      without an explicit policy admitting it.
- [ ] **AC-110.6** A `knowledge_snapshot_id` is immutable once published; a
      correction is a new snapshot and the previous one becomes `SUPERSEDED`
      rather than being edited or reused.
- [ ] **AC-110.7** GKS can query a published snapshot through the retrieval
      contract, naming the snapshot it read.
- [ ] **AC-110.8** A GraphRAG response returns evidence with a source
      reference that resolves back through the FR-109 provenance chain.
- [ ] **AC-110.9** Two answers can be compared for whether they read the same
      corpus by comparing the `knowledge_snapshot_id` each cites.
- [ ] **AC-110.10** The eleven `GraphRAG Ready` conditions of spec §26 are
      evaluated against a snapshot as a whole, and readiness is reported per
      snapshot rather than per stage.

## Non-goals

- The approved KNO-01 local wave authorizes the contract and shared ledger
  validation below; it adds no route, Prisma model or schema change. External
  reporter authorization and actual publication remain outside this slice.
- zuri-ai does not execute the stages ADR-050 assigns to GKS or
  GenesisBlockDB. It does not build the vector, lexical, graph, structured,
  temporal or provenance indexes a snapshot names (spec §38; ADR-042 D2) — it
  consumes the snapshot and records the decision.
- Not a query contract. Query planning, `query-ir.v1`, lane fusion, reranking
  and citation assembly are GKS and GenesisBlockDB concerns (spec §37–§39).
- Not a retention or deletion policy for superseded snapshots.
- Not a replacement for FR-047's curated public read contract; that contract
  keeps its allow-list and deny rules unchanged.
- No new gate vocabulary. Four results exist and this note adds none.

## Implementation boundary

The KNO-01 contract slice is implemented without adding a model, route or
external reporter. `zKnowledgeStageReport` accepts only the definition,
execution contract, run/stage/step/attempt identity, tenant/business scope and
the six Stage 9–16 aggregate counters. Its strict envelope rejects payload,
entity, fact, embedding, index and receipt data.

`zKnowledgeSnapshot` is the exact FR-110 identity/time/statistics allow-list.
`zKnowledgeStage17Decision` keeps the FR-071 ledger status separate from the
four Stage 17 verdicts and binds the snapshot's snake-case tenant/business
fields to the decision scope. `toKnowledgeStage17Evidence` projects only the
snapshot, verdict and five quality dimensions into the existing closed
`PipelineGateDecision.evidenceJson` vocabulary; the shared pipeline event also
requires and checks its Stage 17 event scope against that snapshot. The pure
`evaluateKnowledgePublication` helper requires explicit caller policy, an
`APPROVED` ledger status, a publishable verdict, a complete snapshot and no
failed or critical quality dimension. It performs no publication or pointer
swap.

**The reporter half of KNO-02 (ADR-067, 2026-09-07).** The envelopes above
gained what a receiver needs and KNO-01 had left out — `outcome`
(`SUCCEEDED` / `FAILED`), BR-022's `failure` envelope refined against it, and
the execution's own `startedAt` / `finishedAt` — and three functions in the
integration lane's `knowledge-ingestion-executor.js` now take them:
`recordKnowledgeStageReport` (Stages 9–16, four of the six NFR-020 metrics
onto the ledger's columns and the two that have none returned under
`declined`), `recordKnowledgeStage17Decision` (AC-110.4) and
`finishKnowledgeIngestionRun` (the run's close, derived from the ledger by
`knowledgeRunOutcome` and never declared by the caller). A fourth,
`readKnowledgeIngestionJob`, serves the run, its seventeen step identities and
FR-109's job state. Four routes under `/api/pipelines/knowledge/{executionRunId}`
front them, authenticating the run's Tenant's FR-102 data-plane key ahead of
the session — the owner's choice among the three options ADR-067 records. A
report names the step the ledger materialised, is keyed by run + stage +
attempt + outcome so a retry replays and a conflicting retry is refused, and
the writer refuses a Tier 1 stage id from a reporter key whatever the
receiver did.

**The pull half of KNO-02 (ADR-068, 2026-09-07, the same day).** Read against
GKS's own accepted `ADR-GKS-LEDGER-REPORTING`, the receiver above was half an
answer: GKS never calls outward, so its evidence leaves as a cursor pull.
`pullKnowledgeStageEvidence` (`knowledge-evidence-importer.js`, integration
lane) calls MSP's relay `msp_knowledge_evidence_export` over the spawned-MSP
transport (`src/modules/agent/msp-stdio-transport.js`), owns the cursor per
`KnowledgeScope` in `KnowledgeEvidenceCursor`, and applies every attributable
row through `recordKnowledgeStageReport` — or names why it cannot
(`unattributed`, `held`, `blocked`). Fronted by
`POST /api/pipelines/knowledge/evidence/pull`, installation operator only.
Proven live across three repositories: a Stage 9 execution in the real GKS,
reached through the real MSP with the run named, lands as
`DPS-KI-ENTITY-RESOLVE` on that run here
(`tests/integration/fr110-knowledge-evidence-chain.test.js`). GKS's export,
its port version 3 and its backfill, and MSP's relay were built the same day in
their own repositories.

The remaining acceptance criteria are still external or later slices: atomic
publication, immutable snapshot storage, retrieval, citation and GraphRAG
readiness. The knowledge domain owns no Prisma model; the snapshot is produced
by GKS/Genesis and this repository carries identity, statistics and bounded
evidence only. `evaluateKnowledgePublication` still has no production caller:
publication is the external tiers' act, and the receiver records their
decision rather than making one.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.4.0b | 2026-09-07 | partial | ADR-068: the pull half — spawned-MSP transport, `KnowledgeEvidenceCursor`, `pullKnowledgeStageEvidence` with four-way row attribution, `POST /api/pipelines/knowledge/evidence/pull`; proven live against the real MSP and GKS (Stage 9 evidence on this ledger) | working-tree | Claude Fable 5.1 |
| 0.3.0b | 2026-09-07 | partial | ADR-067: reporter receiver for Stages 9–16, Stage 17 decision writer (AC-110.4 closed), derived run close, job read, four routes under the FR-102 data-plane key; envelopes gain outcome/failure/times | working-tree | Claude Fable 5.1 |
| 0.2.0b | 2026-08-31 | partial | Implemented the KNO-01 strict Stage 9–16 aggregate report, FR-110 snapshot allow-list, Stage 17 decision/evidence projection, scope binding and publication precondition evaluator; atomic publication remains out of scope | working-tree | ATHER |

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-109 — Knowledge ingestion stage catalog](FR-109-knowledge-ingestion-stage-catalog.md)
- [FR-111 — Knowledge sensitivity lattice](FR-111-knowledge-sensitivity-lattice.md)
- [FR-071 — Supabase data pipeline monitor and replay](FR-071-supabase-data-pipeline-monitor-and-replay.md)
- [FR-047 — LINE business-knowledge pilot](FR-047-line-business-knowledge-pilot.md)
- [PRD-SDD v1.0 — FR-110, SDD-057, NFR-020, BR-022](../../../PRD-SDD-v1.0.md)
- [ADR-042 — Decoupled standalone knowledge and GraphRAG service](../../../decisions/ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md)
- [ADR-043 — Four-tier cognitive architecture](../../../decisions/ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md)
- [ADR-050 — Knowledge Ingestion Tier Boundary and Stage Ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §23, §24, §25, §26 are the sections this note
  elaborates
