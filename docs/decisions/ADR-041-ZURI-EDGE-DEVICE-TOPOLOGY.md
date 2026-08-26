# ADR-041 — Zuri Edge Device Topology and Decoupled Local Governance

**Status:** Approved  
**Date:** 2026-08-21  
**Decided by:** Boss, Lead Architect  
**Relates to:** [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md), [ADR-031](ADR-031-PHASE1-LINE-RUNTIME-CONNECTION-CUTOVER.md), [ADR-032](ADR-032-INTEGRATION-SECRET-MANAGEMENT-UI.md), [ADR-040](ADR-040-CODEX-MEDIATED-SMARTGIFT-PIPELINE-BRIDGE.md), [FR-080](../domains/integration/features/FR-080-integration-secret-management-ui.md)

## Context

The system architecture previously referred to edge capabilities loosely as `zuri-edge-llm` or `zuri-cli`. This caused conceptual ambiguity and LLM hallucinations where agents inferred that the local worker was merely a cloud LLM proxy or API wrapper, leading to attempts to expose secrets on cloud console forms.

In reality, the on-premise execution environment hosts a full-fledged local hardware node comprising the GenesisBlock Graph Database, local Codex/LLM execution daemons, LINE Messaging Ingress Webhooks, chat history partitions, and administrative Web GUIs.

## Decision

### D1 — Three-Tier Edge Taxonomy

To establish unambiguous, agent-agnostic semantics across all documentation, UI, and codebases, we formalize the edge architecture into three distinct tiers:

```text
┌─────────────────────────────────────────────────────────────┐
│ 🏢 1. Zuri Edge Device (The Physical Host / Node Entity)     │
│    - The customer-premise hardware node (Workstation/Server)│
│    - Identity: Device ID, Zero-Trust Token, Heartbeat        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ ⚡ 2. Zuri Edge Runtime (The Execution Daemon / Engine)      │
│    - The local background daemon (GenesisBlock + Webhooks)  │
│    - Storage: Daily JSONL Partitioning & Deduplication      │
│    - GUI: Local Web Control Center (:8787/gui, :8787/graph) │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 🕹️ 3. Zuri Edge Command (The Operator / CLI & MCP Interface) │
│    - CLI commands (`zuri-agent`, `zuri-cli`) & MCP Tools    │
│    - Execution Envelopes & Flex Card builders               │
└─────────────────────────────────────────────────────────────┘
```

### D2 — Standalone Repository & Folder Identity

The local workspace directory and repository are renamed to `zuri-edge-device` (`https://github.com/Freshair129/zuri-edge-device.git` at `D:\workspace\zuri-edge-device`). All edge secrets (LINE Channel Secret, Access Tokens, DB paths) reside exclusively within the local `.env` and disk partitions of the Edge Device.

### D3 — Cloud UI Boundary: Zero Secret Exposure

The central Zuri Cloud Console (`zuri-ai`) does not capture, store, or display sensitive edge credentials. The Cloud UI displays strictly:
1. **Device Pairing Status & Token Reference**
2. **Live Heartbeat Telemetry & Online Pulse**
3. **Deep Links to Local Edge Web GUI (`/gui`) and Knowledge Graph (`/graph`)**

All credential updates and persona configurations must be executed locally on the `Zuri Edge Device` via `http://localhost:8787/gui` or `Zuri Edge Command` CLI.

## Consequences

- **Clarity:** Agents and operators immediately recognize `Zuri Edge Device` as an on-premise node rather than a cloud endpoint.
- **Security:** Zero-trust architecture is preserved with zero edge secrets uploaded to cloud databases.
- **Governance:** Traceability and document graph cleanly separate Cloud Control Plane from Edge Device Runtime.
