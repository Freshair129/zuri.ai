---
doc_type: change-request
id: CR-002
status: proposed
version: "1.2.0"
created_at: "2026-08-30T07:30:00+07:00"
updated_at: "2026-08-30T07:35:00+07:00"
owner: "SmartGift Data Architecture Team"
impacted_domains:
  - agent
  - tenant
  - workspace
  - knowledge
  - memory
  - edge-device
proposed_domains:
  - catalog-vault
---

# CR-002 — Multi-Tier Scope Chain to Zuri Edge Device, GKS (Genesis-Knowledge-System) & MSP (Memory-and-Soul-Passport) Catalog Vault Resolution

## 1. Change Summary

Establish the formal resolution bridge from **Zuri Application Scope Chain (`Workspace` / `Project`)** to **Memory-and-Soul-Passport (`MSP` / `D:\Memory-and-Soul-Passport`)**, **Genesis-Knowledge-System (`GKS` / `D:\Genesis-Knowledge-System`)**, and **Zuri Edge Device (`zuri-edge-device`)** Catalog Knowledge Vaults, enabling AI Agents to query domain-specific product catalogs with sub-millisecond latency on local edge hardware while enforcing a strict **Zero-PII Vector Vault Invariant**.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Tier 1: Application & Scope Authority (zuri-ai & zuri-edge-device)                      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  • zuri-ai (D:\zuri-ai): Cloud PostgreSQL / Supabase, CRM, Orders, Invoices (PII)       │
│  • zuri-edge-device (D:\workspace\zuri-edge-device): Local Host Runtime, Edge Gateway,   │
│    Local Thai LLMs (Ollama / Pathumma / Typhoon-S) & zuri-rag-service (:8888)            │
└─────────────────────────────────────────────┬────────────────────────────────────────────┘
                                              │ (AuthContext / Server-Resolved Scope)
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Tier 2: Session, Memory & Vault Gatekeeper                                              │
│          (MSP / Memory-and-Soul-Passport: D:\Memory-and-Soul-Passport [alias: D:\msp])    │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  • Governs: Unified Thread ID, Episodic Memory, Token Budget, H0-H4 Access Ceilings      │
│  • API-010 (msp_vault_resolve): Maps workspace/project scope to Authorized Vault IDs     │
└─────────────────────────────────────────────┬────────────────────────────────────────────┘
                                              │ (Authorized Vault Set: [vlt-catalog-product])
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Tier 3: Canonical Knowledge & GraphRAG Orchestrator                                     │
│          (GKS / Genesis-Knowledge-System: D:\Genesis-Knowledge-System [alias: D:\gks])   │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  • Governs: Entity Ontology, Schema Contracts (smartgift://b2b/portfolio/v1)             │
│  • GraphRAG Engine: Hybrid Dense Vector (bge-m3 1024-dim) + Graph Traversal (query-ir.v1)│
└─────────────────────────────────────────────┬────────────────────────────────────────────┘
                                              │ (In-Process Native Rust C-ABI NAPI)
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  Tier 4: Local Storage Substrate (GenesisBlockDB Native / SmartGift Vault)                │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  • 6-Lane Substrate: Vector, Lexical, Graph, SQLite, Bitemporal, Provenance             │
│  • Invariant: Stores ONLY Product Masters, Gift Offers & Sensory Vectors (Zero-PII)      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Naming Standardization & Aliases

To maximize codebase clarity across human operators and AI agents, the following full canonical directory names and backwards-compatible symlinks/junctions are proposed:

| Short Code | Canonical Full Name | Canonical Path | Backwards-Compatible Alias |
| :--- | :--- | :--- | :--- |
| **`MSP`** | **`Memory-and-Soul-Passport`** | `D:\Memory-and-Soul-Passport` | `D:\msp` (Directory Junction) |
| **`GKS`** | **`Genesis-Knowledge-System`** | `D:\Genesis-Knowledge-System` | `D:\gks` (Directory Junction) |

---

## 3. Target Repositories & Action Items

### A. `D:\zuri-ai` (Tier 1: Prisma Schema & AuthContext)
1. **Extend `Workspace` model in `prisma/schema.prisma`:**
   ```prisma
   model Workspace {
     // ... existing fields ...
     catalogVaultId   String?   // UUIDv7 / vlt-catalog-product
     vaultNamespace   String?   // e.g. "smartgift://b2b/portfolio/v1"
   }
   ```
2. **Update AuthContext Resolver (`src/modules/agent/auth-context.js`):**
   * Pass `catalogVaultId` into request envelopes for B2B Catalog agent conversations.

---

### B. `D:\workspace\zuri-edge-device` (Tier 1 Edge Runtime & Local LLM Hub)
1. **Edge Local Inference Routing:**
   * Provide local high-speed inference endpoints via Ollama (`bge-m3:latest` 1024-dim embeddings and Local Thai LLMs: `pathumma` / `typhoon-s` / `qwen3.5`).
2. **Edge RAG Gateway (`zuri-rag-service:8888`):**
   * Route edge knowledge retrieval requests to local GenesisBlockDB substrates and SQLite projections.
3. **Atomic Cutover Store Isolation:**
   * Central store (`data/genesis_smartgift_store_v4/`) maintains atomic cutover via `CURRENT` pointer. Domain business vaults (such as `O:\Org-EtohGroup\SmartGift\vaults\vlt-catalog-product\genesis-db`) operate as dedicated, isolated substrates.

---

### C. `D:\Memory-and-Soul-Passport` (Tier 2: Memory Gatekeeper [alias: `D:\msp`])
1. **Update API-010 `msp_vault_resolve`:**
   * Resolve `catalogVaultId` into the `Authorized Vault Set` for the active conversation turn.
   * Apply Security Ceilings (H0-H4) and Token Budget constraints.

---

### D. `D:\Genesis-Knowledge-System` (Tier 3: Knowledge Authority [alias: `D:\gks`])
1. **Register Schema Contract:**
   * Register `smartgift://b2b/portfolio/v1` (v1.3.0) with Vector Spaces: `unboxing_sensory` (1024-dim `bge-m3`) and `product_features`.
2. **Query IR Routing:**
   * Dispatch compiled `query-ir.v1` requests directly to Edge Substrate.

---

## 4. Non-Negotiable Invariants

1. **Zero-PII in Vector Vaults:** `vlt-catalog-product` must store ONLY canonical product masters, gift offers, BOMs, and sensory vectors. NEVER store customer contacts or order histories in Vector Vaults.
2. **Edge Device Store Isolation:** Outside agents must never directly write to `D:\workspace\zuri-edge-device\data\genesis_smartgift_store_v4\`. Domain workspaces maintain their own local database instances.
3. **Canonical Identity Authority:** Never mint `gks:` prefixed references outside GKS.
