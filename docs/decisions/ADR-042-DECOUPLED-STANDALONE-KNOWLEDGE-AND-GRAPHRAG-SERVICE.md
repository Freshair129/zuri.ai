# ADR-042 — Decoupled Standalone Knowledge and GraphRAG Service

**Status:** Approved  
**Date:** 2026-08-22  
**Decided by:** Boss, Lead Architect  
**Relates to:** [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md), [ADR-041](ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md), [FR-080](../domains/integration/features/FR-080-integration-secret-management-ui.md)

## Context

The Knowledge Graph and Hybrid Retrieval (RAG) capabilities were originally embedded directly within the `zuri-edge-device` process. While effective for single-process evaluation, embedding the GenesisBlock C++ Graph Database within a specific application creates several architectural constraints:

1. **Process Coupling & Failure Blast Radius:** If a conversational webhook worker crashes or restarts, embedded database handles can experience lock contention or service interruption.
2. **Lack of Multi-Client Sharing (Self-Hosted Hub):** In an enterprise on-premise deployment, multiple internal consumers (LINE bot workers, web search portals, ERP synchronizers, and team-internal LLM frontends such as Dify/Open-WebUI) require simultaneous access to the same canonical product catalog and customer knowledge graph.
3. **Hardware & Resource Specialization:** Graph traversal and 384-dim vector similarity calculations benefit from independent memory caching and dedicated background ingestion queues without blocking HTTP ingress webhooks.

## Decision

### D1 — Decouple RAG into a Standalone Service (`zuri-rag-service`)

We decouple the Knowledge Base and GraphRAG engine into an independent, lightweight standalone microservice (`zuri-rag-service`) running on dedicated local port `:8888` (configurable):

```text
┌─────────────────────────────────────────────────────────────┐
│ 🌐 ZURI KNOWLEDGE & RAG SERVICE (:8888)                      │
│    - Engine: GenesisBlock Graph & Vector Database Engine    │
│    - Store: 994 Catalog Products, Categories, Specs, Memory  │
│    - Interfaces: REST API, JSON Query Endpoints, Graph Viewer│
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │ (Localhost/LAN)  │                  │
            ▼                  ▼                  ▼
┌──────────────────────┐ ┌──────────────┐ ┌──────────────────┐
│ 🏢 Zuri Edge Device  │ │ 💻 Web App   │ │ 👥 Team Services │
│    (LINE Bot :8787)  │ │    (Catalog) │ │    (Dify / API)  │
└──────────────────────┘ └──────────────┘ └──────────────────┘
```

### D2 — Standard REST Interface Contract

The standalone RAG service exposes standardized JSON endpoints:
- `GET /health` — Service liveness, node counts, edge counts, and memory status.
- `POST /api/rag/search` — Hybrid Graph Traversal & Vector Similarity search query.
- `POST /api/rag/ingest` — Incremental or full ingestion of catalog items.
- `GET /api/rag/graph` — Full graph topology representation for visual inspection (`/graph`).

### D3 — Client Adapters in Edge Runtime

`zuri-edge-device` and other client applications query the Knowledge Base via a resilient HTTP adapter (`GenesisRagClient`) with automatic retries, fallback caching, and zero direct filesystem lock coupling.

## Consequences

- **Reusability & Interoperability:** Any system or team member in the local network can query the company's knowledge base via standard REST.
- **Resilience:** The GenesisBlock store remains online independently of downstream webhook restarts.
- **Zero-Trust Compliance:** Data remains 100% on-premise without external cloud API dependencies.
