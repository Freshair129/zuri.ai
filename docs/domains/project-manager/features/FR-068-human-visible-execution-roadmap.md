---
domain: project-manager
feature: FR-068
module: project-manager
source: v2-native
version: 0.1.0
status: proposed
---

# FR-068 — Human-visible Project Execution Roadmap

## Intent

An authorized Human opening a Project can see the same execution structure that
an Agent plans against: the current phase/stage/period, sprint/batch/wave,
backlog, tags, assignees, dependencies, blockers and closure state. The view is
not a decorative dashboard and does not introduce a second work model.

## User flow

1. The user opens a Project from the authorized Business context.
2. The user opens `Work > Execution Roadmap`.
3. The header shows the Project goal, timeline/deadline, strategy-based
   progress, total/backlog counts and the active approved source.
4. The user expands the current Execution Plan/Workstream and sees the
   mode-specific phase, stage, period, sprint, batch or wave.
5. The user opens a work item to see its status, tags, Human/Agent assignee,
   dates, completion evidence, criteria and change history.
6. The user opens the dependency summary to see what the item is waiting for,
   whether the predecessor is blocked, and who owns the blocker.
7. At phase/sprint close, the user sees completed/open/blocked/carry-over work,
   required gates and the explicit close decision.
8. The user can switch to Structure Plan, Board, Schedule or Dependency Map and
   the same records retain the same identity, status, dates and assignments.

## Contract

`RoadmapBoardContract` is a read contract, not a persisted aggregate.

| Contract area | Required behavior |
|---|---|
| `project` | name, goal/outcome, accountable owner, start/target dates when present, status and strategy-based progress state |
| `summary` | total work, backlog/open work, completed work, blocked work and deadline state; counts are derived from authorized records |
| `sources` | only approved sources that are actually available; active source and unavailable reason are explicit |
| `plans` | Workstream identity, execution mode, display vocabulary, progress strategy, weight, status, dates and current container |
| `containers` | WorkContainer identity, mode-valid subtype, label, parent, dates, status, progress evidence and closure state |
| `items` | WorkItem identity, title, status, human-visible tags, assignees, dates, parent, evidence, criteria and trace/changelog links when present |
| `dependencies` | source/target identity, type, status, blocked reason, blocking owner and affected item; accessible list equivalent required |
| `roster` | authorized Human/Agent subjects only; display name, role/capability and availability when sourced; no fabricated agents |
| `closure` | phase/container summary, gate state, criteria, carry-over and owner decision/audit reference |

The API/read model may omit a field only when it returns an explicit unavailable
state. It must not replace absent dates, evidence, owners or progress with a
default that looks real.

## Mode-specific display contract

The view uses the canonical contract in [`EXECUTION-MODES.md`](../../../EXECUTION-MODES.md):

| Mode | Container labels | Item examples | Progress strategy |
|---|---|---|---|
| `SOFTWARE_SPRINT` | Release, Sprint, Epic | Task, Bug | `TASK_WEIGHT` |
| `DATA_MIGRATION` | Stage, Batch/Run | Dataset, Validation, Reconciliation | `RECORD_VALIDATION` |
| `B2B_SALES` | Pipeline, Stage | Account, Deal, Activity | `WEIGHTED_PIPELINE` |
| `B2C_CAMPAIGN` | Campaign, Wave, Channel | Creative, Audience, Experiment | `KPI_ATTAINMENT` |
| `PRODUCT_LAUNCH` | Launch Phase | Deliverable | `MILESTONE_READINESS` |
| `OPERATIONS` | Period, Process | Checklist Item, Issue, SLA | `SLA_SCORE` |
| `BUSINESS_EXPANSION` | Initiative, Site | Setup Action, Approval | `EXPANSION_READINESS` |

## Acceptance criteria

- **AC-068.1** An authorized Project viewer can open Execution Roadmap from the
  Project Work area without entering a separate Agent surface.
- **AC-068.2** The header shows Project goal/outcome, timeline/deadline,
  strategy-based progress, total/backlog summary and active source. Missing
  source data is shown as unavailable rather than inferred.
- **AC-068.3** The view renders the existing hierarchy
  `Project → Workstream/Execution Plan → WorkContainer → WorkItem` and uses the
  selected mode's labels without creating a new hierarchy or mode.
- **AC-068.4** A Human can see the current phase/stage/period and
  sprint/batch/wave with dates, status, progress evidence and closure state.
- **AC-068.5** Work item detail exposes title, status, visible tags, assignees,
  dates, parent context, completion evidence, DoD/acceptance links and
  changelog/trace links when those records exist.
- **AC-068.6** The dependency view shows predecessor/successor, dependency
  status, blocked reason, blocking owner and affected work item, with a
  non-canvas accessible list.
- **AC-068.7** Authorized Human and registered Agent subjects can be shown and
  assigned through the owning audited assignment service. A free-text or
  fabricated Agent cannot be assigned.
- **AC-068.8** Phase/container closure shows completed, open, blocked and
  carried-over work, required gates, acceptance/success/exit criteria and the
  authorized close decision. Required gates preserve the BR-006 progress cap.
- **AC-068.9** Structure Plan, Board, Schedule, Dependency Map and Roadmap agree
  on record identity and current status/date/assignment; Roadmap does not write
  a parallel copy.
- **AC-068.10** Source tabs and export controls are displayed only for approved,
  viewer-authorized sources and data.
- **AC-068.11** Loading, empty, error, narrow viewport, keyboard and
  reduced-motion states are usable and do not rely on a canvas alone.
- **AC-068.12** The implementation adds no new Project/Work aggregate, no
  cross-project traversal, no new execution mode and no duplicate owner for
  Requirements, Risks, Resources or Files.

## Non-goals

- A global all-project roadmap or cross-project dependency editor.
- Drag-to-edit hierarchy, dates, dependencies or persisted layout from the
  composed Roadmap view.
- A template marketplace, first-step template picker or hidden generated tasks.
- Replacing the existing Requirements, Risks, Resources, Team or Files
  surfaces.
- Universal progress from task counts or invented Agent roster/metadata.

## Security, audit and provenance

Roadmap reads are project-scoped and use the same viewer/tenant/business guards
as the existing Project views. Assignment and closure are audited mutations in
their owning services. Agent-produced content carries the PlanEnvelope
provenance and follows validate → dry-run → preview → commit; imported content is
data only and never executable code.

## Implementation boundary

The current model already has Workstream/WorkContainer/WorkItem hierarchy,
`WorkItem.assigneeRef`, status, dates, metadata and AuditEvent primitives. It
does not yet provide first-class Project accountability, tags, criteria or an
explicit closure-decision record. FR-068 therefore defines the user contract,
not a permission to hide those gaps in arbitrary JSON or free text. Any schema,
migration or ownership change needed to make those fields durable must be
specified and approved before implementation; until then the UI renders the
field as unavailable rather than inventing it.

## Related documents

- [ADR-028 — Human-visible execution roadmap](../../../decisions/ADR-028-HUMAN-VISIBLE-EXECUTION-ROADMAP.md)
- [FR-040 — Project Work views](FR-040-project-work-views.md)
- [FR-063 — Project Board](FR-063-project-board.md)
- [FR-064 — Schedule](FR-064-schedule-timeline.md)
- [FR-069 — Plan Blueprint and intake](FR-069-plan-blueprint-and-intake.md)
- SDD-039 — Roadmap contract (registered in [PRD-SDD-v1.0.md](../../../PRD-SDD-v1.0.md))
