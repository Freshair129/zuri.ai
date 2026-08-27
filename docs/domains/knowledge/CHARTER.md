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
  `DPS-*` stage ids), the end-to-end job trace, the published-snapshot
  contract and the sensitivity/processing-policy classification lattice.
- **Declares and monitors ingestion; never executes it.** The stages ADR-050
  assigns to GKS (Tier 3) and GenesisBlockDB (Tier 4) run there. This domain
  registers the definition, records the run, holds the Stage 17 gate decision
  and consumes the resulting snapshot — Tier 1 is not a substrate writer
  (ADR-043 D2.1), and serving stays behind the interim contract (ADR-046).
- **Declares no new Prisma models for this.** The FR-071 execution ledger is
  reused unchanged (SDD-057), so `owns_models` stays empty.

### Declared, not implemented — FR-110 / FR-111 (🔜)

Neither is a contract this domain exposes today. Both are documentary
declarations under ADR-050; no route, model or code is authorized by them.

- The published knowledge snapshot contract (FR-110): `knowledge_snapshot_id`
  with its ontology and pipeline versions, published atomically and only on a
  `PASS` / `PASS_WITH_WARNINGS` gate result.
- The classification lattice and per-object processing policy (FR-111) that
  the import contract is to carry — PUBLIC / INTERNAL / CONFIDENTIAL /
  RESTRICTED plus retention, export, `cloud_processing_allowed` and
  `embedding_allowed`, applied before indexing, never as a post-retrieval
  filter.

## Public contract

Only what exists in code today. Anything declared and unbuilt belongs in the
ingestion lane above, never here.

- The business-knowledge query port consumed by `grounded-business-answer`.
- The import contract (`business-contract`) with its public-field deny rules —
  prices and internal fields never cross into servable knowledge unapproved.
  Its `sensitivity` field admits `PUBLIC` and nothing else (FR-047); the wider
  lattice is declared, not built.
