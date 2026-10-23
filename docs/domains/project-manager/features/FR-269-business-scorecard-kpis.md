---
domain: project-manager
feature: FR-269
module: business
source: v2-native
---

# FR-269 — Business Scorecard KPIs

| Field | Value |
|---|---|
| **Version** | 0.3.3b |
| **Status** | Implemented and merged in PR #645 as `54e7e357`; full local Vitest (7,976 passed, 56 skipped), Playwright (210 passed, 4 skipped), and production build were recorded as pre-merge evidence; all completed hosted checks passed, including SCM; Governance E2E and Edge Desktop were skipped; not production migrated, deployed, provider-activated, or verified with live data |
| **Date** | 2026-10-12 |
| **Source base** | zuri.ai 2912d70bf649314ec3631c49a784031ab16415c6 |
| **Relates to** | [ZAI:FR-269](../../../features/FEAT-002/requirements/FR-269.md), [FEAT-002](../../../features/FEAT-002/feature.md), [ADR-101 D1/D6](../../../decisions/ADR-101-BUSINESS-GOALS-BECOME-OKR-SMART-BSC-4DX.md), [FR-060](../../../features/FEAT-002/requirements/FR-060.md) |

## Statement

A Business may maintain ongoing health metrics independently of any Objective or
cycle. A Business KPI belongs to exactly one Business and one Balanced Scorecard
perspective. Its current result is derived from its current target configuration
and latest append-only observation. Observation rows are immutable during
normal application operations while their parent records exist; parent erasure
is the explicit retention exception below. The Business Home presents active KPIs in the
four fixed perspective groups, separately from the FR-060 composite health
score. A KPI result never contributes to that composite.

This is the scoped implementation contract for the existing FR-269 identity.
Its source-preserved canonical FR wrapper and row remain unchanged. This
implementation has code and migration files from PR #645 (`54e7e357`) in B1
source `2c13f616` ancestry. Dated pre-merge and hosted evidence below belongs to
its stated source; it is not a new B1 run. Current adapter/browser qualification
remains in B3; production migration, deployment, provider activation and live-data
behavior remain unverified by B1.

## In scope — FR-269 Phase 2

- BusinessKpi and append-only BusinessKpiObservation models, with aligned local
  and Supabase migrations and snapshot restore coverage.
- Pure current-status calculation from KPI configuration and the deterministic
  latest observation.
- Business OWNER-only KPI create/update/archive and observation-recording
  writes, scoped to the server-resolved Business and audited.
- An additive kpis read-model collection for Business Home, grouped into the
  four fixed perspectives.
- WARN and BAD KPI attention rows in the existing Business Home attention
  queue.
- A scorecard card on /overview, grouped into the four perspectives and using
  the existing KPI tile component.

## Data contract

| Record | Required fields and meaning |
|---|---|
| BusinessKpi | id; businessId; name; perspective; unit; target; warningThreshold; direction; cadence; status; createdAt; updatedAt; version. It is Business-scoped, not Goal- or Project-scoped. |
| BusinessKpiObservation | id; kpiId; value; observedAt; createdAt; optional actorPersonId; optional note. Business scope is resolved through the owning KPI; clients cannot assign a different Business on an observation. |

### KPI field rules

- name and unit are required, non-empty labels. Unit is descriptive: v1 does
  not convert units or compare different KPIs.
- perspective is exactly one of FINANCIAL, CUSTOMER, INTERNAL_PROCESS, or
  LEARNING_GROWTH. Null, unknown values, and an “unassigned” bucket are invalid.
- direction is exactly UP or DOWN. UP means a larger value is better; DOWN
  means a smaller value is better.
- target, warningThreshold, and observation value are finite numeric Float
  values stored using the SQLite-compatible Prisma Float representation
  (IEEE-754 binary64). Reject NaN, positive or negative infinity, non-numeric
  inputs, and values that cannot be stored as finite Float values. Status
  comparisons use the persisted Float values directly, with no epsilon,
  decimal reconstruction, or hidden rounding. This representation does not
  preserve every base-10 fraction exactly; that precision limit is accepted
  for this implementation.
- The warning band must have positive width. For UP, warningThreshold is
  strictly less than target. For DOWN, warningThreshold is strictly greater
  than target. Equality is invalid and must be rejected by application
  validation and by the database constraint where supported.
- cadence is one of WEEKLY, MONTHLY, QUARTERLY, or YEARLY. It labels the
  expected reporting frequency and is descriptive only. V1 does not compute
  cadence intervals, due times, freshness, or staleness from it.
- status is ACTIVE or ARCHIVED. Only ACTIVE KPIs appear in the default
  scorecard and attention queue, and new observations for an ARCHIVED KPI are
  rejected. Archiving retains its KPI and observation history.
- Metadata updates use the KPI’s current configuration for subsequent status
  calculations. They never rewrite, delete, or re-date observations.

## Observation and latest-value rules

- Only a Business OWNER may enter an observation. The server resolves the KPI
  and its Business, then checks the caller against that Business’s owner
  authority; it never trusts a client-supplied owner claim.
- observedAt is the measurement time supplied by the OWNER. If omitted, it
  defaults to the server time when the observation is accepted. Reject a
  future-dated observedAt. createdAt is always server-recorded and is not
  caller-editable.
- There is no observation edit or delete route. A correction is a new append.
  The audit event records the actor and write; an observation’s original value
  and timestamps remain unchanged during normal application operations.
- KPI configuration remains editable through the OWNER-only update route, but
  there is no KPI hard-delete route. Archiving is the supported removal from
  the active scorecard.
- The standard foreign-key cascades are the explicit parent-erasure exception:
  hard-deleting a Business cascades to its KPIs and their observations; deleting
  a KPI at the storage boundary cascades to its observations. FR-269 makes no
  retention promise after this parent erasure. A Person deletion may clear the
  optional actorPersonId without changing the observation itself.
- Select the latest observation with this stable ordering:
  observedAt descending, then createdAt descending, then id descending.
  Timestamps are compared as UTC instants; id is a stable final tie-breaker.
- When no observation exists, the result is NO_SIGNAL. Do not substitute zero,
  infer a breach, or create an attention item.
- The current result is recomputed from the selected observation and the
  current KPI target/threshold/direction. A target edit may therefore change
  the current result without changing historical observation rows.

## Status calculation

Status is derived and is not persisted. Evaluate only the latest observation:

| Direction | OK | WARN | BAD |
|---|---|---|---|
| UP | value >= target | warningThreshold <= value < target | value < warningThreshold |
| DOWN | value <= target | target < value <= warningThreshold | value > warningThreshold |

The strict threshold-ordering rule ensures every valid KPI has a non-empty
WARN interval. Values exactly on the target boundary are OK; values exactly
on the warningThreshold boundary are WARN.

## Cadence semantics

Cadence is the OWNER’s descriptive expected frequency for entering
observations, selected from WEEKLY, MONTHLY, QUARTERLY, or YEARLY. V1 does not
calculate intervals, due times, observation age, freshness, or staleness and
does not persist freshness metadata. Status is derived from the selected
observation’s value and current KPI configuration regardless of observation
age. No observation remains NO_SIGNAL.

## Ownership, read model, and attention queue

- All writes run in the project-manager application layer. Create, update,
  archive, and observation recording require Business OWNER authority and emit
  audit events. An observation’s scope is inherited from its KPI.
- The FR-041 strategy read model adds active KPIs with the selected latest
  observation and derived result. Business Home consumes this read model; its
  pure FR-060 projection does not query KPI tables.
- Render exactly four perspective groups, including empty groups. Reject a
  null or invalid perspective rather than rendering a fifth “unassigned”
  group or silently dropping the KPI.
- Each active KPI whose result is WARN creates one medium-severity attention
  row; BAD creates one high-severity row. OK and NO_SIGNAL create no row.
  Observation age does not create attention because v1 does not calculate it.
  Use the existing Key Result severity and queue-ordering behavior, link to
  /overview, and give rows stable KPI-based IDs.
- KPI results and attention rows do not change FR-060 domain health inputs,
  coverage, score, or any cross-domain roll-up.

## Acceptance checklist

- [ ] Both models expose the fields and Business ownership described above;
      local and Supabase schemas agree, and snapshot restore includes both.
- [ ] Validation accepts only the four perspectives, UP/DOWN directions, and
      four cadence values; null/unassigned perspectives are rejected.
- [ ] Finite Float validation rejects NaN, infinities, non-numeric values, and
      storage overflow. Tests cover the documented binary64 comparison
      behavior without adding an epsilon or rounding step.
- [ ] UP requires warningThreshold < target and DOWN requires
      warningThreshold > target. Equal thresholds and reversed thresholds are
      rejected at the write boundary and by supported database constraints.
- [ ] Unit cases cover values below, equal to, between, and above each UP and
      DOWN boundary, including OK at target and WARN at warningThreshold.
- [ ] No observation returns NO_SIGNAL and never a fabricated zero or breach.
- [ ] Latest-observation selection follows observedAt DESC, createdAt DESC,
      id DESC under ties and replay. OWNER-supplied observedAt defaults to
      server time when absent; future timestamps are rejected; createdAt
      remains server-controlled.
- [ ] Non-OWNER and foreign-Business writes are refused. KPI create/update/
      archive and observation writes are audited. There is no KPI hard-delete
      route or observation edit/delete route; a correction appends a row.
- [ ] A Business hard-delete exercises the documented FK cascade to KPI and
      observation rows as the explicit parent-erasure exception.
- [ ] Cadence accepts only the four labels and remains descriptive: no
      interval, due-time, age, freshness, or staleness calculation or metadata
      is added. Observation age never changes status or creates attention.
- [ ] The scorecard always has exactly four perspective groups; archived KPIs
      are excluded; no “unassigned” group exists; the Business Home composite
      is unchanged.
- [ ] WARN maps to medium and BAD to high attention severity; OK, NO_SIGNAL,
      and archived KPIs produce no row. No age-derived attention state exists.
- [ ] No provider request, credential access, automated ingestion, or
      cross-domain write is introduced.

## Verification

- Full Vitest suite: 7,976 passed, 56 skipped, 0 failed; the execution guard
  confirmed tests ran.
- Full Playwright suite: 210 passed, 4 skipped, 0 failed (214 total, including
  2 FR-269 scorecard and OWNER mutation tests); the execution guard confirmed
  tests ran. The 4 skips are existing superseded scenarios.
- Production build passed, including lint/type checks and generation of all
  99 static pages.
- The full test and build results above were recorded as local pre-merge
  evidence. PR #645 merged as `54e7e35780002237cc418e5525e683b1362908d1`; all
  completed hosted check runs, including SCM, passed, while Governance E2E and
  Edge Desktop were skipped. No production migration, deployment, provider
  activation, or live-data proof is claimed.

## Exclusions

- FR-270 and all 4DX behavior: WIG limits, lead measures, weekly commitments,
  and WIG sessions.
- Provider or integration-fed observations, scheduled pulls, webhooks,
  credentials, forecasts, and agent-entered observations.
- Unit conversion, cross-KPI aggregation, and contribution to FR-060’s
  composite score.
- Automatic BAD status or attention escalation from missing data or observation
  age.
- Production database migration application, deployment, or activation.
- Editing the canonical FR-269 source row, generated FEAT views, or PRD/FEATURES
  exports as part of this implementation.

## Parent and peer impact

ADR-101 D1 provides the Business-scoped KPI model family and D6 leaves KPI
implementation in Phase 2. This contract records details for the admitted
scoped implementation package; its admission is recorded by the package G0,
not by this feature note. The warningThreshold and strict directional ordering
are a scoped implementation refinement; the source-preserved FR-269 row and
wrapper remain unchanged. This note does not amend ADR-101 or authorize
production database migration or deployment. FR-060 remains a non-owning read
projection, and FEAT-002 remains governed by its existing lifecycle.
FR-270/4DX is not pulled into this package.

## Retention and source-preservation rules

Observation immutability applies to normal application operations while the
Business and KPI parents exist. An authorized Business hard-delete is the
explicit erasure exception: the existing foreign-key cascades remove its KPI
and observation rows. No FR-269 route hard-deletes KPIs or observations, and
the feature does not promise to retain child history after Business erasure.
If retention after Business erasure is required, it needs a separate product
and data-retention decision.

- The canonical FR-269 source row does not name warningThreshold or its
  ordering rule. This admitted package records them as a scoped implementation
  refinement here; no canonical-row migration is required before this package
  proceeds. Any future change to the canonical FR-269 behavior or wording must
  follow record-migration governance.

## Version diff

0.1.0b → 0.2.0b: resolves the four-perspective versus unassigned-group
contradiction; defines finite Float fields and strict directional warning
bands; specifies OWNER scope, append-only timestamped observations with a
Business-erasure exception, latest-value
ordering, status and descriptive cadence rules, attention semantics, acceptance,
and exclusions. Canonical FR wrappers, generated views, implementation, tests,
migrations, and deployment are unchanged by this proposal.

0.2.0b → 0.2.1b: rechecks the current uncommitted SQLite and Supabase migration
drafts, confirms strict warningThreshold inequalities, and clarifies that
observation rows are append-only through normal application routes while
Business hard-delete cascades are the explicit retention/erasure exception.

0.2.1b → 0.2.2b: makes cadence descriptive only and removes interval, age,
freshness, and staleness calculations and metadata; states that observation age
does not affect status or attention; records warningThreshold and strict
ordering as a scoped refinement while the source-preserved FR-269 row and
wrapper stay unchanged.

0.2.2b → 0.3.0b: implements the admitted FR-269 contract on
`codex/feat002/fr269-contract`: adds BusinessKpi and append-only observation
models and migrations; OWNER-scoped audited writes; deterministic status and
latest-observation projection; four perspective scorecard and attention rows;
backup/restore ordering and Business-erasure behavior; API and database
appendix entries; static Phase B inventory binding; and focused acceptance
tests. This version is a branch candidate, not a merge, production migration,
deployment, provider activation, or live-data proof.

0.3.0b → 0.3.1b: records passing full Vitest, Playwright, and build gates and
the exact local coverage counts; keeps PR, hosted CI, production migration,
deployment, provider activation, and live-data claims gated.

0.3.1b → 0.3.2b: records PR #645 merged as `54e7e357` and the completed hosted
checks, including SCM; Governance E2E and Edge Desktop were skipped. No product
behavior or production readiness is newly claimed.

## B1 source inspection — 2026-10-23

At `2c13f6166bc865dd14aadcab3904b0f3eea42197`, the existing
[KPI writer](../../../../apps/server/src/modules/project-manager/application/business-strategy-mutation-service.js),
[scorecard UI](../../../../apps/server/src/modules/project-manager/components/BusinessKpiScorecard.jsx),
[read model](../../../../apps/server/src/modules/business/application/business-strategy-service.js)
and [integration tests](../../../../apps/server/tests/integration/fr269-business-kpi-mutation.test.js)
are present. Full ancestor: `54e7e35780002237cc418e5525e683b1362908d1`.
The canonical design-only delivery cell remains unchanged pending the exact
[B1 migration proposal](../../../plans/PM-EXISTING-DELIVERY-QUALIFICATION-20261023.md#held-canonical-delivery-cell-proposal).
No application, browser, hosted or live check was rerun by B1.

0.3.3b (2026-10-23): qualify the old unmerged-branch paragraph and add current
source/held-migration pointers while retaining historical check counts.
