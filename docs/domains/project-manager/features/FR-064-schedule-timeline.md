---
domain: project-manager
feature: FR-064
module: project-manager
source: v2-native
---

# FR-064: Schedule

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Declared — describes behaviour already shipped; awaiting its code anchor |
| **Date** | 2026-08-17 |
| **Relates to** | FR-003 (Project dates), FR-006 (Milestone dates), FR-009 (the global + project-scoped precedent), SDD-019, SDD-036 |
| **Found by** | Wave 0 route-anchor survey — independently, by two surveys |

## Two routes, one requirement

`src/app/(pm)/timeline/page.jsx` and
`src/app/(pm)/projects/[projectId]/timeline/page.jsx` render the same
`TimelineView` component; only the filter differs. Two separate surveys reached
NONE on them independently, which is the strongest signal the survey produced —
neither had seen the other's verdict.

They are declared as **one** requirement rather than two, following FR-009,
which already covers "Execution views 7 โหมด ... (global + project-scoped)" in a
single statement. A view that is the same view under a different filter is one
capability; splitting it would create two ids that must always change together,
which is how ids stop being useful as keys.

## Why not widen FR-040

Same reasoning as [FR-063](FR-063-project-board.md). SDD-019 asserts the Work
tab owns a `Schedule` slot, but FR-040 states only Structure Plan and Dependency
Map. A navigation slot name is not a behavioural specification, and no
requirement anywhere describes rendering dates on a month grid. Adding it to
FR-040 would be new requirement content under an existing key.

Note the project-scoped timeline page does not even render `WorkViewTabs`, so
the "it is part of the tab shell" argument is weaker here than for Board.

## What it actually does

`TimelineView` is pure rendering over data other requirements own:

- a bar per Project from `Project.startAt` → `targetAt`
- markers from `Milestone.targetAt`
- positions computed with `date-fns` against the min/max of the visible range

No write path, no PATCH, no persisted layout, no editable date. A Project or
Milestone with no dates renders no bar — which is correct and worth stating,
because the alternative (defaulting a missing date to today) would invent a
schedule that nobody planned. That is the same discipline FR-060 applied when it
refused to render a figure it could not source.

## Scope

**In:** the month-grid render, both scopes, read-only.

**Out:** editing dates by dragging a bar; dependency arrows between bars;
critical path; baseline-versus-actual; export. Each is new behaviour and needs
its own FR — and dragging in particular would make this a write surface, which
SDD-036 refuses for a derived view.
