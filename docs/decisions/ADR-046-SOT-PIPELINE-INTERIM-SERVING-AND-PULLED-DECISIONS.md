# ADR-046 — SoT pipeline: interim serving on :8888, and decisions leave by pull

**Status:** Approved
**Date:** 2026-08-24
**Decided by:** Boss ("โอเค ทำแบบ interim เริ่มเลย", 2026-08-24)
**Relates to:** [ADR-041](ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md), [ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md), [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md), FR-099, FR-100, FR-101

> ADR-044 is deliberately skipped here: it is claimed by in-flight work on the
> Unified Thread ID / omni-channel console in another working tree, and an id is
> a key (AGENTS.md §18) — the later declaration renumbers, which is this one.

## Context

The business-wide Source-of-Truth pipeline (4 businesses: smartgift, chakra_emc,
etoh_muku, mujeen — design "Zuri SoT Pipeline", 2026-08-24) needs a serving
layer today. ADR-043's target path is Tier 1 → MSP → GKS → GenesisBlockDB, but
GKS (`D:\gks`) is beta (NDJSON JSON-RPC over stdio, no HTTP surface) and MSP's
gateway role is not yet load-bearing — while the LINE OA agent already serves
production traffic against the standalone knowledge service on `:8888`
(zuri-rag-service, the ADR-042 shape) with measured quality gates (Recall@5
0.80, p95 129 ms).

Separately, the pipeline's human approvals must flow through zuri-ai (Boss:
"ให้ user กดอนุมัติงานจาก zuri"). A push model — zuri-ai writing approved facts
into DuckDB or the graph — would make Tier 1 a writer into the substrate, which
ADR-043 D2.1 forbids.

## Decision

1. **Interim serving stays on `:8888`.** The SoT knowledge graph is served by
   the standalone service (ADR-042 shape) until GKS offers an equivalent
   governed surface; consumers (team via Tailscale serve, LINE agent, FUNG)
   bind to `:8888` and will migrate behind GKS without contract change when
   ADR-043's Tier 3 is ready. This is a declared transition, not drift.
2. **Decisions leave zuri-ai by pull only.** The data plane submits pending
   facts into FR-100's queue and later pulls decided rows from
   `GET /api/platform/sot/decisions/export` (stable cursor), applying them to
   its own DuckDB/graph stores. zuri-ai holds the decision record and its
   audit; it never opens a connection to DuckDB, GenesisBlockDB or the
   `:8888` store. Tier 1 therefore stays a non-writer toward Tier 4 during the
   interim and after it.
3. **Phase status is derived.** The FR-099 board and FR-101 graph compute
   status from FR-071 run evidence plus FR-100 pending counts; no surface in
   this repository stores a hand-typed pipeline status.

## Consequences

- The GKS migration keeps one seam: swap the `:8888` binding, keep the FR-100
  pull contract as-is (GKS becomes another consumer of the same export).
- The data plane owns its cursor and its idempotent apply; a replayed export
  page must be harmless there.
- When GKS takes over serving, this ADR's clause 1 is superseded by a follow-up
  ADR; clauses 2–3 are expected to outlive the interim.
