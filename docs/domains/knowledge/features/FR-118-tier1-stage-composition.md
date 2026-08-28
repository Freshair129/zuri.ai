---
domain: knowledge
feature: FR-118
module: knowledge
source: v2-native
version: "0.1.0b"
status: "implemented"
---

# FR-118 — Tier 1 stage composition

## Intent

FR-118 is `runKnowledgeIngestionStages` in
`src/modules/knowledge/stage-runner.js`: one function that calls the seven
Tier 1 knowledge-ingestion stages in
[ADR-050](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) D2's
own order, over one artifact, in one pass.

```text
Parse(2) → Provenance(3) → Normalize(4) → Classify(5) → Dedupe(6) → Chunk(7) → Entity Extraction(8)
```

## The gap this closes, named the same day it was found

Every earlier slice in this lane shipped one pure calculator and a seam test
to its one neighbour: parsing into chunking (SDD-063), chunking into entity
extraction, classification into chunking, deduplication into the FR-109 run
input. Four pairs. On 2026-08-28 the [knowledge domain
charter](../CHARTER.md) was corrected to say plainly what that adds up to:
**a chain of pairs is not a chain.** Nothing called the eight Tier 1 stages
in sequence, and a sentence claiming otherwise had already been said to a
reader before the composition existed to check it.

This is the composition. `runKnowledgeIngestionStages` proves — with a test
that runs all seven stages on one real artifact carrying a Thai organisation
mention, a structured field and a structured record — that the seven Tier 1
calculators fit together, not merely that each one works.

## What it proves, stated so it cannot be overread

- **Composition, not operation.** The seven stages run in-process, in order,
  over one real input. This is a stronger claim than four pairs and a weaker
  one than "the pipeline runs": nothing here registers a run, writes a
  `PipelineStep`, or persists a `PipelineRecordEvent`.
- **Determinism.** The same artifact and text produce the same chunk ids and
  the same entity-candidate ids on a second call — the property BR-021 needs
  to treat a reprocessed document as the same knowledge rather than new.
- **Dedup classification survives composition.** A second pass over an
  already-seen artifact reports `DUPLICATE_OF`; a new `source_version`
  reports `REVISION_OF` with its `SUPERSEDES` edge. Chunking and extraction
  still run on a duplicate — Stage 6 classifies the relationship; acting on
  it (skip vs. proceed) is a caller's decision with a ledger to record it on,
  not this function's.

## What it does not close, and why that is stated rather than implied

**No FR-109 acceptance criterion moves with this slice.** AC-109.2 (a
structured and an unstructured source through the same catalog), AC-109.4
(the provenance chain walkable from a published object), AC-109.7 (one
`pipeline_job_id` resolving the full chain via `PipelineRecordEvent`) and
AC-109.13 (incremental reprocessing) all require evidence written to the
FR-071 ledger — a registered run, `PipelineStep` transitions,
`PipelineRecordEvent` rows bound through `docId`/`picId`/`factId`. A pure
function returning an in-memory envelope produces none of that. A caller
wanting ledger evidence wraps each stage's result with `recordPipelineEvent`;
that wiring is the next slice in this lane, named here and not built, the
same way FR-109's `knowledgeIngestionRunInput` computes a run's identity
without itself calling `createPipelineRun`.

**Failure is not caught or classified.** BR-022's quarantine vocabulary
(retryable / non-retryable / review-required) is declared and unbuilt.
Catching a stage's error here with nowhere to classify it would read as
handling something nothing downstream acts on — worse than letting it
propagate. A caller building the ledger-writing slice adds quarantine there,
where the classification has somewhere to go.

## Field mapping between stages, made explicit (SDD-068)

Two seams needed a decision rather than a guess, and both are named so a
later reader does not have to re-derive them:

- **`content_hash` and `checksum` are one fact under two module-local
  names.** FR-116 calls an artifact's hash `checksum` (spec §8); FR-117 calls
  the identical value `content_hash` (spec §29, BR-021). The caller states it
  once, as `content_hash`, and this function renames it to `checksum` in the
  one call that needs the other name — rather than asking every caller to
  keep two copies in sync, which is the exact shape of defect BR-021's own
  field-separator bug took earlier in this lane.
- **A chunk's `scope` is the identity pair alone.** FR-111 classifies against
  `{ scope: { tenantId, businessId }, sensitivity, retention_policy, ... }`,
  but `chunkDocument`'s `scope` parameter carries only the identity pair — the
  shape the FR-111-into-FR-112 seam test already fixed
  (`tests/unit/knowledge-classification.test.js`). Passing the whole
  classification object would nest a field named `scope` inside a field
  named `scope`.

## Non-goals

- **No new stage logic.** Every stage's behaviour is exactly what FR-112
  through FR-117 already specify; this function calls them and wires their
  outputs to each other's inputs.
- **No persistence, no ledger write, no route.** `owns_models: []` on the
  knowledge charter is unaffected.
- **No quarantine, no metrics, no job lifecycle.** BR-022, NFR-020 and
  FR-110 stay separately declared and unbuilt.
- **No decision about what a caller does with `dedup.relationship`.**
  Skipping further work on a `DUPLICATE_OF` artifact is a caller's policy,
  not this function's.

## Related documents

- [FR-109 — Seventeen-stage knowledge ingestion stage catalog and job
  trace](./FR-109-knowledge-ingestion-stage-catalog.md) — names the ten
  acceptance criteria this slice does not close, and why
- [Knowledge domain charter](../CHARTER.md) — the "eight implementations are
  not a running pipeline" correction this slice answers
- [PRD-SDD v1.0 — FR-118, SDD-068](../../../PRD-SDD-v1.0.md)
- [ADR-050 — Knowledge Ingestion Tier Boundary and Stage
  Ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
