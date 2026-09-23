---
domain: project-manager
feature: FR-270
module: business
source: v2-native
---

# FR-270 — 4DX weekly execution

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Declared — design only, not implemented, not deployed |
| **Date** | 2026-09-22 |
| **Relates to** | FR-268, FEAT-002, ADR-101, BR-043 |

## Statement

A Business may mark at most two active `BusinessGoal` rows Wildly Important
(`isWig=true`, non-archived — BR-043, counted per Business because more than
one `BusinessRoadmap` may be ACTIVE at once). Each WIG names one existing
`BusinessKeyResult` as its lag measure and may hold zero or more
`BusinessLeadMeasure` rows — a weekly-target metric the team directly
controls — with weekly `BusinessLeadMeasureValue` entries. A
`BusinessWeeklyCommitment` records what a named Person commits to for the
week, optionally tied to one lead measure. A `BusinessWigSession` records the
weekly report / scoreboard / plan ritual for one Business and
`weekStartAt` (Monday 00:00, `Asia/Bangkok`).

## In scope (Phase 3)

- `BusinessLeadMeasure` (+ append-only `BusinessLeadMeasureValue`),
  `BusinessWeeklyCommitment`, `BusinessWigSession` Prisma models, both
  migration trees, `SNAPSHOT_MODELS`.
- A `setGoalWig` mutation enforcing the two-per-Business limit inside its own
  transaction.
- Writers for lead-measure values, commitments (create, toggle done) and
  session-step marking, OWNER-only, audited.
- A weekly WIG card on `/overview`: this week's commitments per Person, the
  WIG toggle, the lead-measure weekly bars, the three-step session tracker.
- A session-incomplete attention row once the week is more than a stated
  grace period old.

## Out of scope (this FR)

A `Cycle` or `Business.timezone` model (ADR-101 D1 — `weekStartAt` is computed
from a fixed `Asia/Bangkok` constant, cited rather than modeled); Slack/LINE
delivery of the weekly reminder (Phase 4).

## Verification (when Phase 3 ships)

- `setGoalWig` refuses a third simultaneous WIG for the same Business
  (integration test, cites BR-043) and permits it for a different Business.
- `weekStartFor(now, tz)` returns the same Monday for any timestamp within
  that week, regardless of time-of-day.
- A `BusinessWigSession` row is idempotent per `(businessId, weekStartAt)` —
  marking a step twice does not create a second row.
