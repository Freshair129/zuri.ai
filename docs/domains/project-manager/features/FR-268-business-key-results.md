---
domain: project-manager
feature: FR-268
module: business
source: v2-native
---

# FR-268 — Business Key Results

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Declared — design only, not implemented, not deployed |
| **Date** | 2026-09-22 |
| **Relates to** | FR-041, FR-059, FR-060, FEAT-002, ADR-101, SDD-107, BR-044 |

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

## Verification (when Phase 1 ships)

- A Key Result's progress and status match `keyResultProgress`/`keyResultStatus`
  for known inputs (unit test).
- A check-in updates `BusinessGoal.progress` in the same transaction, and a
  second check-in in the same `weekStartAt` upserts rather than duplicates.
- `updateGoal` refuses a manual `progress` patch once a non-archived Key Result
  exists (integration test, cites BR-044).
- The strategy GET, the per-project roadmap GET and the marketing Strategy
  Workspace all read the same `progress` after a check-in (no drift).
