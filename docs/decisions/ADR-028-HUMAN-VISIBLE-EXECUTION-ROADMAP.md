# ADR-028 — Human-visible execution roadmap and shared plan intake

**Status:** Accepted — design approved; implementation pending  
**Date:** 2026-08-17  
**Decided by:** Boss (owner approval, 2026-08-17)  
**Relates to:** [ADR-012](ADR-012-PROJECT-WORK-VIEWS-AND-DEPENDENCY-BOUNDARY.md), [ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md), [ADR-027](ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md), [FR-040](../domains/project-manager/features/FR-040-project-work-views.md), [FR-063](../domains/project-manager/features/FR-063-project-board.md), [FR-064](../domains/project-manager/features/FR-064-schedule-timeline.md), [FR-068](../domains/project-manager/features/FR-068-human-visible-execution-roadmap.md), [FR-069](../domains/project-manager/features/FR-069-plan-blueprint-and-intake.md), SDD-039

## Context

The Project Manager already has the neutral work model and several project views,
but the human execution contract is not stated in one place. The GoVibe A2
wireframe is useful prior art, not a source of truth: it shows a roadmap header,
phase/sprint sections, backlog counts, tags, assignment, source tabs and task
detail, but it does not define the Zuri data boundary, dependency ownership,
phase closure, or the seven execution modes.

A Human user must be able to answer, from the opened Project:

- Which phase, stage, sprint, batch or wave is active?
- What is in the backlog, who owns each item, and which tags describe it?
- What is blocked, what is it waiting for, and who owns the blocker?
- Has the current phase or sprint actually closed, or is work carried over?
- Why does the progress number have its current value?

Agents must see and produce the same execution structure. A plan that is only
understandable through agent metadata cannot be handed to a Human team.

## Decision

### D1 — Execution Roadmap is a Human-facing Project Work view

`Execution Roadmap` is a project-local view under `Project > Work`. It is a
composed read model over the existing Project Manager entities; it is not an
agent-only console, a new shell domain, or a second project-management
aggregate.

The user-facing path is:

```text
Workspace > Organization > Business > Project > Work > Execution Roadmap
```

The existing `Structure Plan`, `Board`, `Schedule` and `Dependency Map` remain
valid views. Roadmap composes their shared facts into one Human-readable
execution surface; it does not replace their ownership or create duplicate
write paths.

### D2 — One hierarchy, mode-specific labels

The canonical data hierarchy is:

```text
Project
  └─ Workstream          UI may call this an Execution Plan
       └─ WorkContainer  mode-specific phase/stage/sprint/batch/wave
            └─ WorkItem   task, deal, dataset, deliverable, issue, etc.
```

`Execution Plan` is a presentation label for a `Workstream`, not a new
persisted entity. `executionMode`, `progressStrategy` and `progressWeight`
remain Workstream properties. The mode vocabulary is taken from
[`EXECUTION-MODES.md`](../EXECUTION-MODES.md) and must not be extended by a
wireframe or a free-form template.

The UI uses the label that is truthful for the selected mode:

| Canonical mode | Visible planning vocabulary | Primary progress evidence |
|---|---|---|
| `SOFTWARE_SPRINT` | Release → Sprint → Epic → Task/Bug | weighted work completion and defects |
| `DATA_MIGRATION` | Stage → Batch/Run → Dataset → Validation/Reconciliation | records processed, validated and reconciled |
| `B2B_SALES` | Pipeline → Stage → Account/Deal → Activity | target, weighted value and won revenue |
| `B2C_CAMPAIGN` | Campaign → Wave → Channel → Audience/Creative/Experiment | KPI attainment, spend, conversion and revenue |
| `PRODUCT_LAUNCH` | Phase → Milestone → Deliverable → Gate | milestone readiness and blocked gates |
| `OPERATIONS` | Period → Process → Run → Checklist/Issue/SLA | SLA score, throughput, backlog and incidents |
| `BUSINESS_EXPANSION` | Initiative → Site/Market → Milestone → Approval/Setup/Go-live | expansion readiness and go-live evidence |

The word `Sprint` is therefore not forced onto migration, sales, campaign,
operations or expansion work.

### D3 — The Human-visible roadmap contract is shared

The Roadmap Board contract contains, when the underlying data is available:

| Area | Human must be able to see |
|---|---|
| Project header | Project name, goal/outcome, accountable owner, timeline/deadline, strategy-based progress, active source, and total/backlog counts |
| Plan/phase | Execution Plan name, execution mode, current phase/stage/period, date window, progress, status and closure state |
| Work item | Title, status, visible tags, Human/Agent assignee, dates, parent context, completion evidence, DoD/acceptance links and changelog/trace links when present |
| Dependency | predecessor/successor, dependency status, blocked reason, blocking owner, and the affected work item; also available as an accessible list |
| Team | authorized Human and Agent subjects, assignment state, capability/status badges and current load where the source provides it |
| Gates and closure | required gates, open/completed state, acceptance/success/exit criteria, carry-over and closure decision |
| Sources and export | only approved live-selectable sources and only data the viewer may export |

Tags are user-visible work metadata, not hidden agent annotations. Source-line,
token and internal trace metadata may be shown in an advanced detail section but
must never replace the Human fields above.

### D4 — Human and Agent share the assignment contract

Human members and registered Agent subjects are assignable through the same
scope-checked, audited assignment boundary. An agent is not a free-text label;
it must resolve to an authorized subject in the viewer's project scope. If no
approved Agent registry or capability data exists, the UI shows `Unavailable`
and does not invent a roster, quota, progress or owner.

Assignment is a mutation owned by the relevant Project Manager service. Roadmap
rendering may expose the action, but it must not create a second assignment
store.

### D5 — Progress and closure are evidence-based

Project and Workstream progress use the declared `progressStrategy`,
`progressWeight` and mode evidence. `tasks_done / tasks_total` is not a universal
progress formula. A missing evidence field renders as unavailable; it is never
converted into a guessed percentage.

Closing a phase, sprint, stage, batch or wave produces a summary of:

1. completed, open, blocked and carried-over work;
2. required gates and criteria that passed or remain open;
3. dependency blockers and their owners; and
4. the authorized Human decision that closed it, or the reason it remains open.

`Completed with carry-over` is allowed only as an explicit, audited owner
decision. A required gate still caps progress according to BR-006 and prevents
an unqualified completion state.

### D6 — Blueprint is optional after the objective, never a first-step template picker

Project creation starts with the user's objective and context. After that, the
system may recommend a mode-specific Blueprint that asks the minimum questions,
creates an editable visible skeleton, and activates the appropriate views.

Blueprints are starting patterns, not hidden templates and not execution truth.
They may not add a canonical mode, create fake completed work, bypass validation,
or commit without preview and Human confirmation. The user can edit the
generated structure before it becomes a plan.

### D7 — Human UI and Agent plan import converge on one intake

The UI wizard and an external planning Agent normalize into the existing
`PlanEnvelope` contract:

```text
UI form or Agent output
  → schema + semantic validation
  → dry-run and conflict check
  → Human-visible preview
  → authorized transactional commit
  → AuditEvent
```

The transport boundary (HTTP API, MCP adapter or another approved adapter) is
not chosen by this ADR. The normalized envelope and the validation/preview/
commit boundary are the contract regardless of transport. Imported data is
never executable code.

### D8 — Existing feature ownership remains intact

Requirements/Targets, Risks/Measures, Resources, Team and Files keep their
existing owners and routes. The Roadmap may link their records to a Project or
WorkItem, but it does not duplicate their persistence or silently broaden
FR-040, FR-063 or FR-064. A new behavior gets a new requirement id.

### D9 — Scope and accessibility are part of the contract

Roadmap data is project-scoped and viewer-authorized. Cross-project dependencies
remain in the global dependency surface unless an approved requirement defines a
read-only reference. Every visual summary has an accessible list/table or detail
alternative; loading, empty, error, narrow viewport and reduced-motion states
are explicit states, not blank canvases.

## Rejected alternatives

| Alternative | Rejection reason |
|---|---|
| Agent-only roadmap | Fails Human handoff, accountability and execution review |
| New `Subproject` or `ExecutionPlan` aggregate | Duplicates the existing Workstream/WorkContainer model and creates a second source of truth |
| Universal percentage from task counts | Violates the seven mode progress strategies and hides missing evidence |
| Template picker before the objective | Makes the user choose internal taxonomy before stating the outcome; violates BR-003 |
| Separate Board/Schedule/Roadmap database | Creates divergent status, dates, assignment and dependency facts |
| Free-text or fake Agent identities | Bypasses authorization and makes assignment/audit unverifiable |
| Always-visible source tabs with mocked data | Presents unavailable or unapproved sources as live truth |

## Consequences

- Human users get one place to inspect phase, backlog, tags, assignment,
  blockers and closure without losing the specialized views.
- The seven execution modes remain one neutral model with truthful vocabulary.
- UI-created and Agent-created plans can be compared, previewed and audited by
  the same pipeline.
- Implementers must add a composed read contract and tests, not a new aggregate.
- Existing FR-040/063/064 implementations are not automatically complete for
  the Roadmap requirement; FR-068 owns the additional behavior.

## Open decisions for implementation

1. The GoVibe wireframe describes three compact header stats but its structural
   sketch lists additional metrics. FR-068 treats progress, backlog/total and
   deadline/source as the minimum; the final compact set needs UI review.
2. The exact active-source list is not fixed until approved live sources exist;
   the UI must render only sources returned by the server contract.
3. The implementation must confirm whether a current phase is derived from
   WorkContainer dates/status or is explicitly selected; it must not create a
   second persisted phase pointer without an ADR.
4. The current schema has `WorkItem.assigneeRef` and metadata/audit primitives,
   but does not yet expose first-class Project accountability, tags, criteria or
   an explicit closure-decision record. Implementation must map these through
   owning services or propose the required schema/migration decision before
   coding; the UI must not fake them or hide them in unvalidated strings.

## References

- [GoVibe A2 Roadmap Board wireframe](../../reference/GoVibe/WIREFRAME-A2-ROADMAP-BOARD.md) — draft reference only; `source_of_truth: false`
- [Seven Execution Modes](../EXECUTION-MODES.md)
- [FR-040 — Project Work views](../domains/project-manager/features/FR-040-project-work-views.md)
- [FR-063 — Project Board](../domains/project-manager/features/FR-063-project-board.md)
- [FR-064 — Schedule](../domains/project-manager/features/FR-064-schedule-timeline.md)
- [FR-069 — Plan Blueprint and intake](../domains/project-manager/features/FR-069-plan-blueprint-and-intake.md)
