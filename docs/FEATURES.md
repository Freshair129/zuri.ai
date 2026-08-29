# Features (FEAT registry)

| Field | Value |
|-------|-------|
| **Version** | 1.8.0b |
| **Status** | Active — hand-maintained source of truth |

A **Feature (`FEAT-xxx`) is a product capability**; a **Functional Requirement
(`FR-xxx`) is a precise system behavior**. They are different id families
(ADR-025 rev 2): a feature bundles one or more FRs, and an FR belongs to at most
one feature. `FEAT` ids follow the same contract as every other id (AGENTS.md
§18): never renumbered, never reused, gaps stay burnt. The duplicate-id guard in
preflight covers this table, and Check 12 (ADR-039) additionally pins each row's
SUBJECT in `.id-ledger.json`, so a FEAT number cannot quietly come to mean a
different capability the way SDD-049 did on 2026-08-20.

An FR with no FEAT row is implicitly a feature of one — add a row only when a
capability genuinely spans FRs or needs product-level framing. The graph reads
this table (`feat:` nodes, `bundles` edges) and TRACE shows the bundle per FR.

| ID | Feature | FRs | Status |
|---|---|---|---|
| FEAT-001 | File Manager — Business/Project files with managed local workspace | FR-037, FR-045, FR-058 | live |
| FEAT-002 | Business Home — shell-level cross-domain aggregation (Dashboard now; Goals & KPIs, Risks & Alerts, Reports later) | FR-041, FR-060 | building |
| FEAT-003 | Execution Planning — Human-visible Roadmap, Blueprint intake and stable identity bindings | FR-068, FR-069, FR-070 | live |
| FEAT-004 | Phase 1 LINE Runtime Connections — Business-scoped provider selection, production secret resolution, local evaluation providers and secret-safe Platform management | FR-048, FR-079, FR-080 | building |
| FEAT-005 | Project Inventory — authorized, read-only Project-wide operational snapshot | FR-077 | live |
| FEAT-006 | Customer Data Backfill — scoped, provenance-preserving Customer Profile contract with entity resolution, PDPA gates and explicit duplicate review | FR-078 | building |
| FEAT-007 | Pipeline Builder — direct-manipulation structure and edge creation on one canvas, with a mandatory Handoff Contract on every edge and contract-gated release on the Board | FR-082, FR-083, FR-084, FR-085 | proposed |
| FEAT-008 | Projects Dashboard — a KPI band and enriched Project list for the Development domain, with the priority, accountable-owner and Team entities it needs to be honest | FR-086, FR-087, FR-088, FR-089 | live |
| FEAT-009 | CRM Conversation Inbox — the first reader surface over the LINE ingress, and the delivery receipt that makes it show both sides of a conversation rather than only what the customer said | FR-091, FR-093 | live |
| FEAT-010 | Production Identity & Access Management — canonical Person/channel identity, persisted sessions, active Membership lifecycle, shared policy enforcement and agent/tool scope isolation | FR-094, FR-095, FR-096, FR-097, FR-098 | building |
| FEAT-011 | SoT Pipeline Console — plan board, human approval inbox with pull-based decision export, and a node/edge status graph for the business-wide Source-of-Truth pipeline | FR-099, FR-100, FR-101 | building |
| FEAT-012 | ExecutionPlanBundle — one portable, self-contained programme artifact (strategy + N Projects + cross-Project dependencies) imported through one combined dry-run and one confirmation, above the canonical PlanEnvelope | FR-108 | live |
| FEAT-013 | Knowledge Ingestion Governance — the documentary governance layer over the seventeen-stage knowledge ingestion pipeline: the stage catalog and end-to-end job trace carried on the FR-071 execution ledger, the published-snapshot contract that lets an answer name the corpus it read, and the sensitivity/processing-policy lattice that decides what may be indexed and where each stage may run | FR-109, FR-110, FR-111 | proposed |
| FEAT-014 | CRM Conversation Intelligence — the derived-intelligence layer over the FR-023 LINE ingress: an AI-inferred per-Customer profile, per-conversation analysis records, and a per-Business Daily Sales Brief pushed over LINE; table shapes borrowed from the legacy ERD as prior art and rebound to this product's scope chain (ADR-054) | FR-126, FR-127, FR-128 | proposed |
