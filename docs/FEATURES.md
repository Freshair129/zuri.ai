# Features (FEAT registry)

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Active — hand-maintained source of truth |

A **Feature (`FEAT-xxx`) is a product capability**; a **Functional Requirement
(`FR-xxx`) is a precise system behavior**. They are different id families
(ADR-025 rev 2): a feature bundles one or more FRs, and an FR belongs to at most
one feature. `FEAT` ids follow the same contract as every other id (AGENTS.md
§18): never renumbered, never reused, gaps stay burnt. The duplicate-id guard in
preflight covers this table.

An FR with no FEAT row is implicitly a feature of one — add a row only when a
capability genuinely spans FRs or needs product-level framing. The graph reads
this table (`feat:` nodes, `bundles` edges) and TRACE shows the bundle per FR.

| ID | Feature | FRs | Status |
|---|---|---|---|
| FEAT-001 | File Manager — Business/Project files with managed local workspace | FR-037, FR-045, FR-058 | live |
| FEAT-002 | Business Home — shell-level cross-domain aggregation (Dashboard now; Goals & KPIs, Risks & Alerts, Reports later) | FR-041, FR-060 | building |
| FEAT-003 | Execution Planning — Human-visible Roadmap, Blueprint intake and stable identity bindings | FR-068, FR-069, FR-070 | proposed |
| FEAT-004 | Phase 1 LINE Runtime Connections — Business-scoped provider selection, production secret resolution, local evaluation providers and secret-safe Platform management | FR-048, FR-074, FR-075 | building |
| FEAT-005 | Project Inventory — authorized, read-only Project-wide operational snapshot | FR-077 | live |
