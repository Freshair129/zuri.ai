---
domain: project-manager
feature: FR-268
module: business
source: v2-native
---

# FR-268 — Business Key Results

| Field | Value |
|---|---|
| **Version** | 0.2.0b |
| **Status** | Implementation present; Phase 1 commit 02f54a52 is an ancestor of B1 source 2c13f616. Fresh adapter/browser qualification and release remain open; FR-271 shared server checks are partial. |
| **Date** | 2026-10-23 (B1 source inspection; original design 2026-09-22) |
| **Relates to** | FR-041, FR-059, FR-060, FEAT-002, ADR-101, SDD-107, BR-044 |

## B1 source disposition

Source `2c13f6166bc865dd14aadcab3904b0f3eea42197` contains the Phase 1 schema,
[OWNER-scoped writer/check-ins](../../../../apps/server/src/modules/project-manager/application/business-strategy-mutation-service.js),
[read model](../../../../apps/server/src/modules/business/application/business-strategy-service.js),
[Key Result modal](../../../../apps/server/src/modules/project-manager/components/StrategyEditModals.jsx)
and [integration suite](../../../../apps/server/tests/integration/fr268-business-key-result-mutation.test.js).
Commit `02f54a5210d32b1a63dff565beac2a590fa3dda0` is an ancestor, not a pending
local merge. The canonical delivery cell's old PR wording is held for a reviewed
migration; B1 changes no canonical row. The [B1 findings and B3 amendment](../../../plans/PM-EXISTING-DELIVERY-QUALIFICATION-20261023.md#b1-source-reconciliation--2026-10-23)
record FR-271's missing shared server evaluation and the optional-due-date versus
write-time SMART interpretation to resolve before coding that correction.
This does not remove the existing FR-268 optional due date or expand OWNER-only
check-in authority. The checks listed below exist as source; B1 ran no runtime
or browser acceptance.

## Statement

A `BusinessGoal` may declare one or more `BusinessKeyResult` children — a
measurable target with `metric`, `unit`, `baseline`, `target`, `direction`
(up/down), an optional `dueAt`, an owner Person, and a 1–5 `confidence`. Each
Key Result accumulates weekly `BusinessKeyResultCheckIn` rows (`value`,
`confidence`, an optional `note`, an optional `source` naming what wrote it —
a Person, or a later automated caller). The goal's `progress` is recomputed
from its Key Results' progress on every check-in (SDD-107); once a goal holds
a non-archived Key Result, a manual `progress` patch is refused (BR-044).

## In scope (Phase 1)

- `BusinessKeyResult`, `BusinessKeyResultCheckIn` Prisma models, both migration
  trees, `SNAPSHOT_MODELS`.
- `rollupGoal(keyResults)` and `keyResultProgress/expectedProgress/keyResultStatus`
  as pure calculators in `project-manager/progress/`, mirroring the existing
  `rollupProject`/`strategies.js` shape.
- Writer functions on `business-strategy-mutation-service.js` (or a sibling
  file in the same `project-manager/application/` lane): create/update/archive
  a Key Result, record a check-in — each authorized OWNER-only over the goal's
  Business (ADR-101 D4), each auditing through `recordAudit`.
- `business-strategy-service.js`'s `getBusinessStrategy` extended additively to
  include each goal's Key Results and recent check-ins.
- A Key Result attention row (off-track vs. time elapsed) in
  `business-home-read-model.js`'s `attentionQueue`, fed by the same `strategy`
  payload — no new I/O in that file.
- Strategy card / modal UI on `/overview` to list, create and check in Key
  Results, with the SMART checklist from FR-271.

## Out of scope (this FR)

A non-owner Key-Result-owner check-in grant (ADR-101 D4 — separate FR when
built); any external/integration-fed check-in source (Phase 4, `integration`
domain); LINE as a check-in surface (Phase 4).

## Verification inputs and remaining qualification

- A Key Result's progress and status match `keyResultProgress`/`keyResultStatus`
  for known inputs (unit test).
- A check-in updates `BusinessGoal.progress` in the same transaction, and a
  second check-in in the same `weekStartAt` upserts rather than duplicates.
- `updateGoal` refuses a manual `progress` patch once a non-archived Key Result
  exists (integration test, cites BR-044).
- The strategy GET, the per-project roadmap GET and the marketing Strategy
  Workspace all read the same `progress` after a check-in (no drift).

0.2.0b (2026-10-23): replace stale design-only status with source-bound B1 disposition; no fresh runtime/deployment acceptance or canonical migration.
