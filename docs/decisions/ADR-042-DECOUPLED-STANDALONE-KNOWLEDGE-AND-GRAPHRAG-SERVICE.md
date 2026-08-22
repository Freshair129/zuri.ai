# ADR-042 — Decoupled Standalone Knowledge and GraphRAG Service: Genesis Retrieval Fabric Architecture

**Status:** Approved  
**Date:** 2026-08-22  
**Decided by:** Boss, Lead Architect  
**Relates to:** [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md), [ADR-041](ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md), [FR-080](../domains/integration/features/FR-080-integration-secret-management-ui.md)

## Context

Previous architectures conflated storage retrieval with higher-level reasoning, attempting either to embed graph databases into application processes or to build disparate, stitched-together databases (e.g. Postgres + Qdrant + Neo4j + Elasticsearch + EventStore).

In modern agentic enterprise systems, a strict boundary must exist between **Retrieval Substrate (Storage & Fusion)** and **RAG Intelligence (Reasoning & Orchestration)**. GenesisBlockDB is already architected with hybrid vector, property graph, relational projection, lexical indexing, bitemporal history, and causal provenance under a single in-process durability boundary.

## Decision

### D1 — Three-Tier Retrieval & Agent Topology

We formalize a clean separation into three distinct layers:

```text
                    Application / Agent (Zuri-AI, GoVibe, NotiKeeper)
                                          │
                                          ▼
                    RAG Intelligence & Orchestration Layer (GKS)
                 ┌──────────────────────────────────────────────┐
                 │ • Query Planner & Adaptive Router            │
                 │ • Multi-hop & Agentic Planning               │
                 │ • Cross-Encoder Reranker                     │
                 │ • Evidence Package Builder & Verifier        │
                 └──────────────────────┬───────────────────────┘
                                        │
                                        ▼ (Typed Query IR: query-ir.v1)
              ┌─────────────────── GenesisBlockDB ───────────────────┐
              │                                                      │
              │  1. Vector / HNSW (Semantic Similarity)             │
              │  2. Lexical (Keyword & Exact Match)                 │
              │  3. Property Graph (Relationships & Multi-hop)       │
              │  4. Relational / SQLite (Property Filtering)         │
              │  5. Bitemporal (Historical & Time-travel Facts)      │
              │  6. Provenance (Causality & Event Journal)          │
              │                                                      │
              │  ⚡ In-Engine Fusion & Single Durability Boundary    │
              └──────────────────────────────────────────────────────┘
```

### D2 — GenesisBlockDB as the 6-Lane Retrieval Substrate

GenesisBlockDB acts strictly as the **Retrieval Substrate** responsible for executing fused multi-lane queries via Typed Query IR (`query-ir.v1`):

| Lane | Substrate Capability | Purpose in RAG |
|---|---|---|
| **1. Semantic RAG** | HNSW Vector Index | Semantic & Intent Similarity |
| **2. Lexical RAG** | Tokenized Text Index | Exact keywords, SKUs, and codes |
| **3. Graph RAG** | Property Graph Nodes/Edges | Entity relations and multi-hop traversal |
| **4. Structured RAG** | SQLite Projection | Exact property filters and ranges |
| **5. Temporal RAG** | Bitemporal Timeline (`valid_at`, `tx_as_of`) | Point-in-time facts before/after events |
| **6. Provenance RAG** | Journal & Causality Log | Source verification and lineage audit |

### D3 — What Does NOT Belong in GenesisBlockDB (RAG Intelligence Layer)

Higher-order cognitive tasks are strictly isolated into the **RAG Orchestrator Layer** above the database:
- Adaptive RAG / Agentic RAG / Self-RAG / Corrective RAG
- Query Decomposition & Query Rewriting
- Cross-Encoder Reranking & Context Compression
- Citation Composition & Arithmetic / Hallucination Verification

### D4 — Multi-Client Sharing via Genesis Knowledge System (GKS)

GenesisBlockDB serves as a client-neutral retrieval backend shared across multiple consumers (Zuri-AI, GoVibe, NotiKeeper, external LLM agents) over standard REST/IPC/MCP endpoints on port `:8888` without dual-writing across multiple database stacks.

## Consequences

- **Substrate Purity:** GenesisBlockDB remains a pure, high-performance generic database engine without embedding business workflows or agent prompts.
- **Architectural Simplicity:** Eliminates the operational complexity and failure modes of maintaining 4–5 separate specialized database systems.
- **Agent Empowerment:** Upstream LLMs and agents leverage a single unified query contract (`query-ir.v1`) to retrieve evidence across semantic, relational, and temporal dimensions simultaneously.
