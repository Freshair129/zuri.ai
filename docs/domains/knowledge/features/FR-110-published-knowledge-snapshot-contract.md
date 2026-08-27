---
domain: knowledge
feature: FR-110
module: knowledge
source: v2-native
version: "0.1.0b"
status: "declared"
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
what FR-110 owns — the gate, the publication and the snapshot. None is built.

- [ ] **AC-110.1** A published snapshot carries `knowledge_snapshot_id`,
      `tenant_id`, `business_id`, `ontology_version`, `pipeline_version`,
      `published_at` and the five object statistics of spec §25.
- [ ] **AC-110.2** The Stage 17 quality gate blocks publication on a critical
      failure, and a critical security finding blocks it regardless of the
      other four dimensions.
- [ ] **AC-110.3** Only a gate result of `PASS` or `PASS_WITH_WARNINGS` reaches
      publication; `QUARANTINE` and `FAIL` cannot publish under any policy.
- [ ] **AC-110.4** Every gate result, publishing or not, is recorded as a
      `PipelineGateDecision` linked to the producing `pipeline_job_id`, with
      the §23 result carried as that decision's evidence while its `status`
      remains one of FR-071's `PENDING` / `APPROVED` / `REJECTED` / `WAIVED`.
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

- **This note authorizes no code, no route, no Prisma model and no schema
  change.** It elaborates a declared requirement whose PRD status column says
  documentary declaration only.
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

Nothing is implemented. The gate decision, when implemented, is an FR-071
`PipelineGateDecision` row written through the existing application service —
the knowledge domain owns no Prisma model and would not gain one here. A
snapshot itself is produced outside Tier 1 and is read through the knowledge
port; representing it locally means storing the identity and the statistics,
never a copy of the corpus.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-109 — Knowledge ingestion stage catalog](./FR-109-knowledge-ingestion-stage-catalog.md)
- [FR-111 — Knowledge sensitivity lattice](./FR-111-knowledge-sensitivity-lattice.md)
- [FR-071 — Supabase data pipeline monitor and replay](./FR-071-supabase-data-pipeline-monitor-and-replay.md)
- [FR-047 — LINE business-knowledge pilot](./FR-047-line-business-knowledge-pilot.md)
- [PRD-SDD v1.0 — FR-110, SDD-057, NFR-020, BR-022](../../../PRD-SDD-v1.0.md)
- [ADR-042 — Decoupled standalone knowledge and GraphRAG service](../../../decisions/ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md)
- [ADR-043 — Four-tier cognitive architecture](../../../decisions/ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md)
- [ADR-050 — Knowledge Ingestion Tier Boundary and Stage Ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
- `Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline
  Specification` (`docs/`) — §23, §24, §25, §26 are the sections this note
  elaborates
