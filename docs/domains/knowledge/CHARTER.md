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

### Built here — the eight Tier 1 stages and the run identity

ADR-050 D2 assigns eight of the seventeen stages to Tier 1, and all eight have
code: ingestion (FR-081), parsing (FR-115), provenance capture (FR-116),
normalization (FR-114), classification (FR-111), deduplication (FR-117),
chunking (FR-112) and entity extraction (FR-113). Every one is a pure
calculator; none opens a database.

The single thing in this lane that reaches persistence is the ingestion
identity (FR-109, AC-109.9). BR-021's four-part key is the `idempotencyKey` of
the `DPL-KNOWLEDGE-INGEST-V1` run, and `PipelineRun.idempotencyKey` is
`@unique`, so re-ingesting an artifact returns the run that already exists
instead of creating a second one. The uniqueness belongs to the database, not
to this domain — which is the point: a rule held by a constraint outlives a
rule held by whichever caller remembers to check.

FR-109 itself is delivered at three of its thirteen acceptance criteria: the
catalog and the run identity, not the job trace and not the monitor. Both of
those wait on a stage runner writing `PipelineRecordEvent` rows, and no stage
runner exists.

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
