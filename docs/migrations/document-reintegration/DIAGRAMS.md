---
doc_type: migration-design
status: implementation
version: "0.3.0"
---

# Reintegration diagrams

**Version:** 0.3.0
**Status:** Implemented migration candidate; owner acceptance and writer cutover remain pending.

## Identity, historical reads and generated views

```mermaid
flowchart LR
  ZAI["ZAI published IDs and original records"] --> OLD["Pre-P6 active writer and compatibility exports"]
  OLD --> V1["v1 historical verifier<br/>pinned commit, path and original blob hash"]
  V1 --> HIST["Historical evidence<br/>original interpretation retained"]

  ZNEXT["Pinned ZNEXT candidate records"] --> MAP["Reviewed, source-qualified mapping<br/>key = namespace + original ID"]
  ZAI --> MAP
  MAP --> ONE{"Reviewed cardinality and disposition"}
  ONE -->|"equivalent, one-to-one only"| ALIAS["Qualified provenance alias"]
  ONE -->|"split or merge"| SET["Explicit source/target set<br/>no automatic alias"]
  ONE -->|"ambiguous, retired or unreviewed"| DENY["Refuse active resolution"]

  IDX["P3 canonical index and per-ID ZAI records<br/>candidate source"] --> V2["Implemented v2 snapshot reader<br/>version, namespace, expected ID,<br/>canonical path and record hash"]
  ALIAS --> PROV["Provenance lookup only; no runtime alias"]
  SET --> PROV
  V2 --> ACTIVE["Approved ZAI subject lookup"]

  IDX --> GEN["Registry projection generator"]
  GRAPH["Versioned evidence graph<br/>navigation and bindings only"] --> GEN
  GEN --> EXPORT["Compatibility exports"]
  GEN --> VIEWS["Feature design/verification<br/>and category indexes"]
  ACTIVE --> RT["Runtime readers and persisted bindings"]
  CI["CI: identity, freshness,<br/>backlink, replay and parity checks"]
  HIST --> CI
  EXPORT --> CI
  VIEWS --> CI
  GRAPH --> CI
```

The v1 verifier is bound to its historical source snapshot and never follows a
crosswalk. The v2 reader is implemented with versioned manifest dispatch; writer cutover is pending;
provenance alone cannot bind runtime behavior. Generated views display canonical
statements and graph bindings; they do not declare requirements, approve a mapping,
or prove a test passed.

## Migration gates and roles

```mermaid
flowchart TD
  EX["Explorer<br/>inventory and evidence"] --> P0["P0: pinned baseline and contract"]
  DW["Doc writer<br/>content and lifecycle contract"] --> P0
  DG["Diagram agent<br/>authority and dependencies"] --> P0
  P0 --> G0{"Owner approval<br/>complete"}
  G0 --> P1["P1: dual readers,<br/>ambiguity and replay tests"]
  RF["Refactor agent<br/>consumer map and failure tests"] --> P1
  P1 --> G1{"Compatibility gate"}
  G1 -->|"pass"| P2["P2: source reconciliation<br/>and explicit dispositions"]
  G1 -->|"fail"| OLD["Keep pre-P6 writer/readers;<br/>revise candidate"]
  P2 --> P3["P3: canonical content<br/>by reviewed lane"]
  P3 --> P4["P4: active backlinks,<br/>tools and consumers"]
  P1 -. "fixtures may proceed" .-> P4
  P4 --> INT["Integrator serializes lanes,<br/>graph and generated views"]
  INT --> P5["P5: full validation,<br/>replay, parity and rollback review"]
  P5 --> G5{"Owner accepts<br/>exact-revision evidence"}
  G5 -->|"yes"| P6["P6: controlled canonical-writer cutover"]
  G5 -->|"no"| OLD
  P6 --> MERGE["Separate merge / operational gates"]
  P5 -. "regression before cutover" .-> OLD
  P6 -. "post-write rollback" .-> STOP["Stop writes and reconcile new-format writes"]
  STOP --> OLD
```

P0 approval, canonical records, dual readers, projections and query consumers
are implemented in the isolated branch. P2 records the 23 ZAI development-delta
reviews and complete provenance dispositions; it does not assert semantic
equivalence for all ZNEXT records. The [implementation receipt](RECEIPT.md)
records local validation. P5 owner acceptance and P6 remain pending. After any
new-format writes, rollback requires stopping and reconciling them before
restoring the prior selection. Merge and production remain separate decisions.

The four specialist roles are Explorer, Refactor agent, Doc writer and Diagram
agent. The integrator owns serialized shared outputs; the human owner approves
authority decisions and the exact-revision acceptance gate.

## Evidence and version diff

The design follows the owner-approved [proposal](PROPOSAL.md),
[integration contract](INTEGRATION.md), and
[governance profile](GOVERNANCE-PROFILE.md). The current canonical-input evidence
is the 539-record ZAI index at source revision
`a34ceaf79c112e02b1bcfdbf0a84122d835b002e`; the frozen graph is version 2.0.0.
Those inputs do not prove P2 reconciliation, P5 acceptance or P6 cutover.

0.1.0 → 0.3.0: distinguish pre-cutover writer authority, v1 historical verification,
the v2 candidate reader, generated projections, current phase gates and owner review.
No historical blob, ID, or runtime binding is rewritten by this diagram.

0.2.0 to 0.3.0: record implemented readers and provenance-only alias boundary; link local validation receipt.
