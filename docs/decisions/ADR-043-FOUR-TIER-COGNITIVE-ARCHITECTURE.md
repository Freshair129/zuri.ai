# ADR-043 — Four-Tier Cognitive Architecture: Zuri-AI, MSP, GKS, and GenesisBlockDB

**Status:** Approved  
**Date:** 2026-08-22  
**Decided by:** Boss, Lead Architect  
**Relates to:** [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md), [ADR-041](ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md), [ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md), [FR-080](../domains/integration/features/FR-080-integration-secret-management-ui.md)

## Context

Previous discussions established GenesisBlockDB as the 6-lane hybrid retrieval engine. However, enterprise AI execution requires clear architectural separation between **Agent Execution**, **Session Memory Policy**, **Canonical Knowledge Authority**, and **Physical Retrieval Substrate**.

Without this four-tier boundary, agents risk conflating transient conversation history with permanent corporate facts, violating tenant access boundaries, or directly binding execution code to database locks.

## Decision

### D1 — Formal Four-Tier Cognitive Stack

We formalize the end-to-end cognitive architecture into four distinct, strictly governed layers:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🏢 Tier 1: APPLICATION & EXECUTION LAYER (Zuri-AI & Zuri Edge Device)       │
│    - Business Operations: Software Sprint, B2B Sales, LINE Customer Ingress │
│    - Role Execution: Quote Calculations, Order Processing, Flex UI Cards   │
│    - Isolation Context: Portfolio → Tenant → Business → Workspace → Project │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼ (Task & Session Context)
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🛡️ Tier 2: AGENT CONTROL & MEMORY POLICY: MSP (D:\msp)                       │
│    - Session Lifecycle: Ephemeral Context Windows & Token Budget Control    │
│    - Episodic Memory: Agent private scratchpads & chat turn history         │
│    - Vault Access Gate: Shared Project Vaults vs Private Agent Vaults       │
│    - Access Ceiling: Tool invocation permissions (H0–H4)                    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼ (Governed Scope Promotion & Search)
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🧠 Tier 3: KNOWLEDGE IDENTITY & RAG ORCHESTRATION: GKS (D:\gks)             │
│    - Canonical Entities: Master Catalog, Products, Customers, Ontologies    │
│    - Scoped Retrieval: Portfolio/Tenant-aware Search & Deduplication        │
│    - Knowledge Promotion: Promoting verified memories into permanent SSOT   │
│    - Retrieval Radius: Declared graph traversal reach (R0–R6)               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼ (Typed Query IR: query-ir.v1)
┌─────────────────────────────────────────────────────────────────────────────┐
│ 💾 Tier 4: RETRIEVAL SUBSTRATE: GenesisBlockDB (G:\GenesisBlock_Dev\...)    │
│    - 6-Lane Substrate: Vector (HNSW) + Lexical + Graph + SQLite +           │
│      Bitemporal Timeline + Event Sourced Provenance                         │
│    - Performance: In-Engine Multi-Lane Fusion (< 5ms latency)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### D2 — Layer Responsibilities and Invariants

1. **Zuri-AI (Tier 1)** is the business execution client. It never talks directly to GenesisBlockDB or bypasses MSP governance.
2. **MSP (Tier 2)** is the sole gateway for agent session control, episodic conversation state, and vault permission validation.
3. **GKS (Tier 3)** is the canonical knowledge and relation authority. It resolves entity identity, orchestrates RAG pipelines, and generates `query-ir.v1` requests.
4. **GenesisBlockDB (Tier 4)** is the generic storage and retrieval substrate. It executes multi-lane search queries and returns fused evidence packets without embedding business workflows or prompt templates.

### D3 — Knowledge Promotion Workflow

Information discovered during execution transitions through a strict promotion gate:
```text
Customer Input ➔ Zuri Edge ➔ MSP (Episodic Session Turn)
                                   │
                                   ▼ (Promotion Review / Verification)
                             GKS (`gks_knowledge_promote`)
                                   │
                                   ▼ (Typed Write / Indexing)
                             GenesisBlockDB (Permanent Node / Edge)
```

## Consequences

- **Cognitive Hygiene:** Transient chat context cannot pollute permanent business knowledge graphs.
- **Tenant Isolation:** Multi-tenant boundaries defined at Tier 1 are strictly enforced across Memory (Tier 2) and Knowledge (Tier 3).
- **Extensibility:** The same MSP + GKS + GenesisBlockDB infrastructure can power other products (e.g. GoVibe, NotiKeeper) with zero modifications to the storage core.
