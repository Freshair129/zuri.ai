---
doc_type: migration-design
status: proposed
version: "0.1.0"
---

# Proposed documentation migration architecture

**Version:** 0.1.0

**Status:** Proposed, not implemented. Read with [the migration contract](PROPOSAL.md).

## Authority and reference resolution

```mermaid
flowchart LR
  ZA["Pinned zuri-ai records and subject ledger"] --> R["Reviewed mapping and authority decision"]
  ZN["Pinned zuri-next records and crosswalk"] --> R
  R --> C["Canonical active records in zuri-ai"]
  R --> X["Versioned source-qualified mapping"]
  X --> M{"Mapping kind"}
  M -->|"Equivalent subject"| A["Approved alias to canonical record"]
  M -->|"Split or merge"| S["Explicit source and target set"]
  M -->|"Ambiguous"| F["Refuse automatic resolution"]
  C --> I["Active identity and locator resolver"]
  A --> I
  S --> I
  C --> B["Generated indexes, views and compatibility exports"]
  ZA --> H["Original revision, ID, path, anchor and hash"]
  ZN --> H
  H --> V["Historical resolver by verifier version"]
  I --> U["Runtime readers, tools, agents and navigation"]
  V --> U
  B --> U
  U --> T["CI: identity, semantics, replay and parity tests"]
```

The proposed `ZAI` and `ZNEXT` namespaces preserve source identity; a matching suffix
does not establish equivalent meaning. A split mapping does not let a reader choose
an arbitrary child. Each reader must request an explicit target or the original
aggregate contract. Historical proof uses the original source bytes and verifier,
not the latest generated compatibility export.

Bare CR intake remains proposal material; pinned project change records retain
their governed identity. Neither imported status nor generated navigation grants
approval or proves delivery.

## Migration dependencies and roles

```mermaid
flowchart TD
  EX["Explorer: pinned inventory and evidence"] --> DW["Doc writer: scope, identity and lifecycle contract"]
  EX --> DG["Diagram agent: authority and dependency design"]
  DW --> G0["Owner approves migration contract"]
  DG --> G0
  G0 --> RF["Refactor agent: compatibility readers and failure tests"]
  RF --> G1["Gate: old and new references resolve correctly"]
  G1 --> CL["Doc lanes: reconcile and migrate canonical content"]
  G1 --> RC["Refactor lanes: adapt active references and consumers"]
  CL --> IN["Integrator composes lanes and rebuilds projections"]
  RC --> IN
  IN --> VR["Independent review: accounting, full checks, replay and rollback"]
  VR --> G2["Owner accepts exact-revision evidence"]
  G2 --> CO["Switch canonical writer with compatibility retained"]
  VR -->|"Rejected"| RE["Revise candidate; old writer remains active"]
  CO -->|"Regression"| RB["Stop writes and reconcile before rollback"]
```

The four specialist roles use Luna at max reasoning. Each implementation writing
lane owns its own branch/worktree; the integrator serializes shared ledger and
generated-file changes. Review decisions are per approved scope and recorded
disposition, not an automatic approval prompt for every file operation.

Before cutover the old writer remains active. After new-format writes begin,
rollback must account for those writes before changing the authority selection.
No step rewrites Git history or historical snapshot hashes.

## Provenance and version diff

Derived from the diagram agent's assessment and reviewed against the proposal's
P0–P6 phases, current zuri-ai AGENTS.md section 18 and ADR-039, and the source
zuri-next identity/graph standards at the revisions pinned in the proposal.

0.0 → 0.1.0: proposed authority/resolution flow and migration dependency diagram.
No resolver, schema or runtime implementation is introduced by these diagrams.
