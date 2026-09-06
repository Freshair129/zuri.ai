---
id: "GENESIS-RAG-ADR"
version: "0.1.0b"
status: "candidate"
owner: "zuri-edge-device"
scope: "Proposed architecture decisions for governed GenesisBlock retrieval"
created_at: "2026-08-22T00:00:00+07:00, ATHER"
last_update: "2026-08-22T00:00:00+07:00, ATHER"
approval: "pending"
---

# Candidate ADR — Governed GenesisBlock Retrieval

## ADR-RAG-001 — Separate retrieval planes behind one governed facade

**Status:** Proposed; approval pending

### Context

The current runtime has multiple paths: Genesis HQL name matching, JSON-derived graph
projection, in-memory Catalog search, and a Headless answer layer. The Genesis store has
graph artifacts and a configured vector collection, but vector population is not evidenced.
Keeping these paths implicit makes latency, provenance and fallback behavior difficult to
reason about.

### Decision proposed

Use one governed retrieval facade with explicit modes:

```text
exact/property -> vector (when ready) -> graph constraints -> deterministic rerank
```

The facade must return a bounded evidence packet with `queryPath`, Catalog version, source,
`as_of`, product identity and match type. CLI, MCP and LINE answer paths must call this
facade rather than choosing their own Catalog/search implementation.

Graph and vector are separate planes:

- Graph stores approved entities and relations.
- Vector index stores embeddings mapped to stable product identities.
- A graph collection does not imply that embeddings exist.
- A configured vector dimension does not imply that vector payloads are populated.

### Alternatives considered

| Alternative | Reason not preferred |
|---|---|
| Keep each existing search path | Fast to leave unchanged, but preserves source and provenance drift |
| Use only vector search | Weak for exact codes, constraints and auditable pricing facts |
| Use only Graph/HQL substring search | Does not solve semantic Thai/English product intent |
| Let Headless LLM search and answer freely | Latency, provenance and governance become harder to control |

### Consequences

Positive:

- retrieval latency can be measured independently from language generation
- exact facts can bypass LLM
- vector availability can fail closed without pretending graph is vector search
- all callers share one evidence and provenance contract

Cost:

- a retrieval facade and manifest/version checks must be introduced
- existing JSON/in-memory paths need migration or explicit fallback labels
- golden queries and index verification become release gates

## ADR-RAG-002 — Do not authorize arbitrary HQL through MCP by default

**Status:** Proposed; security approval pending

### Context

The current MCP tool named `execute_hql` does not call a true HQL execution method. Exposing
raw HQL from chat or an external MCP caller would also conflict with the workspace rule that
the runtime must not become an arbitrary query execution surface.

### Decision proposed

Prefer registered, bounded retrieval operations with fixed fields, limits and sensitivity.
Keep an `execute_hql`-like tool only if its input can be converted to a registered query
contract and cannot accept arbitrary user-provided query text. Otherwise remove or keep it
internal-only.

### Consequence

Some exploratory Graph queries require a local operator diagnostic rather than a public MCP
tool. This is an intentional safety boundary, not a loss of product-search capability.

## ADR-RAG-003 — Catalog/index refresh is an explicit lifecycle action

**Status:** Proposed; operations approval pending

### Decision proposed

Index refresh uses a versioned manifest, one owner, observable readiness and a recoverable
failure path. A refresh is not triggered by a model or arbitrary chat message. The active
index remains available until the replacement passes count, compatibility and sample-query
checks, then is swapped according to the verified GenesisBlock lifecycle.

### Open decisions

1. Which Catalog snapshot is authoritative: the current 994-record Genesis input or the
   1,017-record pricing web catalog?
2. Which embedding provider/model is approved, and does it support Thai/English product text?
3. Does the graph API expose live Genesis data or a versioned cached projection?
4. What p50/p95 latency and recall targets are required?
5. Who may approve refresh, rollback and model/index changes?

## Relation to existing architecture

This candidate ADR complements, but does not yet supersede, [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
After approval, the accepted decisions should be appended there as the next architecture ADR
and linked from the traceability appendix.

## ADR-RAG-004 — v4 store cutover is versioned-directory + `CURRENT` pointer + service restart

**Status:** Accepted (2026-08-23)

**Context:** The GenesisBlock native binding has no `close()`; a store directory can be held by one
process at a time. Re-ingesting into the directory the service holds is impossible, and swapping a
path in a running process is not supported by the engine.

**Decision:** `scripts/ingest-catalog-v4.ts` always writes `genesis_smartgift_store_v4/<runId>/`
(manifest with input sha256s + `schemaVersion`), verifies counts and the `e5_v4` vector count, and
only then rewrites `CURRENT`. `zuri-rag-service` resolves `CURRENT` once at startup; `/health`
exposes `runId`, `currentRunId`, `staleRun`, `schemaVersion`. Ingest probes `/health` and prints a
restart warning when the service is on an older run. A `schemaVersion` change forces re-ingest.
`GENESIS_SMARTGIFT_STORE_V4_ROOT` / `RAG_STORE_POINTER` are honoured identically by ingest and
service (run dir = dirname(pointer)/runId).

**Consequences:** Zero-downtime swap is out of scope; cutover is ~10 s. Old run directories are kept
for rollback (`echo <runId> > CURRENT` + restart). The eval harness (`npm run catalog:eval-v4`)
records the served `runId`/`schemaVersion` so every metric file is attributable to a store.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0b | 2026-08-22 | candidate | Proposed separation of Graph/Vector retrieval, MCP safety and refresh lifecycle | ATHER |
| 0.2.0 | 2026-08-23 | accepted | ADR-RAG-004: v4 versioned store cutover (catalog graph v4) | Claude Fable 5 |
