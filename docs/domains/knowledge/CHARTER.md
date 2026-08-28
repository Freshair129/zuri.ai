---
domain: knowledge
module: src/modules/knowledge
owns_models: []
---

# Domain charter — knowledge

Canonical business knowledge (GKS): what the system knows as governed fact —
product identity, business rules, approved answers. Distinct by authority, not
by storage: it answers "what does the system know", never "what happened"
(that is MSP, in the agent domain) and never "what is the state now" (that is
operational data in its owning domain). Architecture spec §16–19.

## Boundaries

- **Owns no Prisma models.** Its store is the production runtime's
  `zuri_core.business_knowledge` behind the knowledge port
  (`postgres-business-knowledge`), plus the governed import built by
  `scripts/build_business_knowledge_import.py`.
- Knowledge enters through governed import/approval — never automatically from
  conversation (spec §19: MSP → candidate → validation → GKS, in that order).
- Serves grounded answers to the agent domain through the knowledge contract;
  it does not talk to LINE and it does not resolve identity.

## Ingestion lane (FR-109, FR-110, FR-111 — ADR-050)

- Holds the **declaration** of the seventeen-stage knowledge ingestion
  pipeline: the stage catalog (`DPL-KNOWLEDGE-INGEST-V1`, seventeen stable
  `DPS-KI-*` stage ids), the end-to-end job trace, the published-snapshot
  contract and the sensitivity/processing-policy classification lattice.
- **Declares and monitors ingestion; never executes it.** The stages ADR-050
  assigns to GKS (Tier 3) and GenesisBlockDB (Tier 4) run there. This domain
  registers the definition, records the run, holds the Stage 17 gate decision
  and consumes the resulting snapshot — Tier 1 is not a substrate writer
  (ADR-043 D2.1), and serving stays behind the interim contract (ADR-046).
- **Declares no new Prisma models for this.** The FR-071 execution ledger is
  reused unchanged (SDD-057), so `owns_models` stays empty — and it stayed
  empty when the catalog was registered on 2026-08-28. A knowledge ingestion
  run is created by calling the integrations lane's `createPipelineRun`; this
  domain's contribution is `knowledgeIngestionRunInput`, a pure function that
  returns the input and writes nothing. One write path, owned where the models
  are owned.

### Built here — the eight Tier 1 stages, their composition, and the run identity

ADR-050 D2 assigns eight of the seventeen stages to Tier 1, and all eight have
code: ingestion (FR-081), parsing (FR-115), provenance capture (FR-116),
normalization (FR-114), classification (FR-111), deduplication (FR-117),
chunking (FR-112) and entity extraction (FR-113). Every one is a pure
calculator; none opens a database.

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

FR-109 itself is delivered at five of its thirteen acceptance criteria: the
catalog, the run identity, a structured and an unstructured source both
provably ingested through the one catalog (SDD-069) — and, since FR-119
(SDD-072), a failed document quarantined with BR-022's complete envelope
rather than reported as nothing having happened. Not the job trace and not
the monitor in full: three more criteria gained real Tier-1 evidence without
closing, because each also needs something this slice does not build
(FR-110's Published Snapshot, persisted derived objects, or a reader that
acts on a `REVISION_OF` result).

Of the remaining eight, four wait on a declared id — NFR-020, FR-110 (named
by two different criteria) and SDD-059's charter change — one waits on
GKS and GenesisBlockDB reporting onto the ledger (ADR-050 D3, outside this
repository), one on a column-sized binding rather than a subsystem, and one on
a reader that has not been written. **None wait on "a stage runner" any more**
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

### Declared, not implemented — FR-110 (🔜)

Not a contract this domain exposes today. It is a documentary declaration
under ADR-050; no route, model or code is authorized by it.

- The published knowledge snapshot contract (FR-110): `knowledge_snapshot_id`
  with its ontology and pipeline versions, published atomically and only on a
  `PASS` / `PASS_WITH_WARNINGS` gate result.

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
