---
domain: project-manager
feature: FR-269
module: business
source: v2-native
---

# FR-269 — Business Scorecard KPIs

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Declared — design only, not implemented, not deployed |
| **Date** | 2026-09-22 |
| **Relates to** | FR-060, FEAT-002, ADR-101 |

## Statement

A Business may track ongoing health metrics independent of any Objective or
cycle as `BusinessKpi` — `name`, exactly one Balanced Scorecard `perspective`
(Financial, Customer, Internal Process, Learning & Growth), `unit`, `target`,
`direction`, `cadence` — with a `BusinessKpiObservation` time series. The
Business Home Dashboard groups these by perspective as a scorecard, presented
separately from, and never folded into, the composite health score FR-060
already computes: a KPI's status is a statement about that one metric, not an
input to the cross-domain composite.

## In scope (Phase 2)

- `BusinessKpi`, `BusinessKpiObservation` Prisma models, both migration trees,
  `SNAPSHOT_MODELS`.
- `kpiStatus(kpi, latestObservation)` as a pure calculator.
- Writer functions (create/update a KPI, record an observation), OWNER-only,
  audited.
- `business-strategy-service.js`'s read model extended additively with a
  `kpis` array grouped by perspective.
- A KPI-breached attention row in `attentionQueue`.
- A scorecard card on `/overview`, grouped into the four perspectives, reusing
  the existing `Kpi` UI component for individual tiles.

## Out of scope (this FR)

Domain-owned KPIs "publishing into" this Business-level scorecard through a
read contract (a later cross-domain FR, not assumed here); automated
observation ingestion from an external system (Phase 4, `integration` domain).

## Verification (when Phase 2 ships)

- `kpiStatus` matches expected OK/WARN/BAD for known target/direction/value
  combinations (unit test).
- A KPI with no observation yet renders as "no signal", never as a fabricated
  0 or as breached (mirrors FR-060's `NO_SIGNAL`/`RESERVED` distinction).
- The scorecard groups strictly by the four declared perspectives; an
  unassigned `perspective` renders in its own labelled group, never silently
  dropped.
