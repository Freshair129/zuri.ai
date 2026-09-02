---
domain: project-manager
feature: FR-017
module: project-manager
source: v2-native
version: "0.1.0"
status: live
---

# FR-017 — UI wizard intake ("เริ่มจากเป้าหมาย")

## Intent

`FR-017` covers the outcome-first UI wizard (`เริ่มจากเป้าหมาย`) that builds a
`PlanEnvelope` and hands it to the one intake pipeline (BR-009, SDD-009):
validate → semantic check → read-only dry run → preview → single transaction →
audit. The PRD-SDD registry row for this id also carries a second clause —
"direct modal creation is edit-only" — recording that a UI surface which
creates a single record directly (not a plan) is deliberately outside that
pipeline's scope, not an exception to it.

## Decision 2026-09-02: StandaloneTaskModal is FR-005 CRUD, not plan intake

Gap analysis finding **D3-pm-plan-intake-02** flagged that
`src/modules/project-manager/components/StandaloneTaskModal.jsx` creates a
`WorkItem` by calling `POST /api/work` directly, bypassing the `PlanEnvelope`
pipeline, while the component's own annotation cited `FR-017` — whose
statement says the opposite ("direct modal creation is edit-only").

Verified against `src/app/api/work/route.js` and
`src/modules/project-manager/application/work-service.js`:

- `POST /api/work` resolves a trusted viewer first (`resolveRequestViewer`,
  FR-046) and calls the application service `createItem`, which never writes
  directly from the route handler.
- `createItem` calls `assertWorkstreamWritable(viewer, data.workstreamId)`
  before any write — the same FR-072 ownership check the plan-intake pipeline
  itself relies on — and refuses the write (404-shaped, per
  `tests/integration/fr072-refusal-disclosure.md`'s pattern) when the viewer
  does not own the governing Business.
- `createItem` records `recordAudit(prisma, { entityType: 'WORK_ITEM',
  entityId: item.id, action: 'CREATED', ... })` on every successful create —
  the write is audited exactly like every other application-service write
  (see CLAUDE.md, "Every write goes through a service").

**Decision:** a single `WorkItem` quick-add through `StandaloneTaskModal` is
ordinary **FR-005** CRUD (list/create a `WorkItem` in the neutral
`WorkContainer`/`WorkItem` model) exercised through its own audited,
FR-072-authorized application service — it is not a `PlanEnvelope`. BR-009's
"one pipeline" rule governs *plan* intake (an envelope describing a set of
Project structure, goals and Workstreams to create together, per FR-069); it
does not extend to every mutating write in the Project Manager domain. A
quick-add modal that creates one `WorkItem` under an existing `Workstream` has
no envelope to validate, no semantic cross-checks to run, and no dry run to
preview — there is nothing for the pipeline to add here beyond the
authorization and audit guarantees the service already provides directly.

The registry clause "direct modal creation is edit-only" is read accordingly:
`StandaloneTaskModal`'s direct write is in scope for FR-017 only in the sense
that FR-017 disclaims plan-pipeline responsibility for it, not because the
modal itself implements FR-017's wizard flow. The component's `@req`
annotation should cite **FR-005** (the CRUD requirement it actually
implements) rather than FR-017; that is a follow-up annotation fix, not a
scope or authorization change, and is out of this docs-only lane.

No `docs/domains/project-manager/features/FR-005-*.md` note exists yet to
cross-reference; when one is written, it should cite this decision as the
worked example of FR-005 CRUD versus BR-009 plan intake.

## Evidence

- Route: `src/app/api/work/route.js`
- Service: `src/modules/project-manager/application/work-service.js`
  (`createItem`, calling `assertWorkstreamWritable` from
  `./project-authorization`)
- Component: `src/modules/project-manager/components/StandaloneTaskModal.jsx`
- Finding: `reports/gap-analysis-2026-09-02/03-data-pipeline-gap.md`
  (D3-pm-plan-intake-02)
- Registry: `docs/PRD-SDD-v1.0.md` (FR-017 row)
