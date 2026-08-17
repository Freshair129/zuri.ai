# W1-G2 — route anchors: project-scoped resource pages

7 of 7 files annotated. `node scripts/doc-preflight.mjs` run once at the end: `critical 0 · warning 0 · info 15 → PASS` (the 15 infos are pre-existing doc-control/staleness/route-anchor-baseline/enum-copy notes, unrelated to this batch).

| Route | `@req` anchored | Description used |
|---|---|---|
| all-work/page.jsx | FR-005 | Project-scoped instance of the neutral WorkContainer/WorkItem "All Work" browser — every tracked WorkItem in this Project across all execution modes, status-editable; same view/service as the global instance, filtered here. |
| board/page.jsx | FR-063 | Project Board — this Project's WorkItems as a status board, one column per `WORK_STATUSES` value derived from enums.js; cards open the existing Workpackage editor; nothing persisted (column/order/position). `@spec SDD-036, SDD-019` (page renders `WorkViewTabs`, so it belongs to the Work tab shell). |
| execution/[mode]/page.jsx | FR-009 | Project-scoped instance of one of the seven execution mode views over the neutral core model — mirrors the global `/execution/[mode]` route. |
| import/page.jsx | FR-012 | The UI intake surface for PlanEnvelope import: paste/upload → validate → seven-mode semantic check → dry run → single transactional commit → audit; also carries FR-018's xlsx→envelope path via the embedded upload flow. `@spec BR-009`. `@tested tests/e2e/smoke.spec.js` (this is the only project-scoped route in the batch that an e2e spec actually navigates to and interacts with — `page.goto('/projects/${id}/import')`, fills the panel, clicks Confirm import). |
| milestones/page.jsx | FR-006 | Project-scoped instance of the Milestones & Gates browser — weighted milestones and required-flag gates, status-editable, filtered to this Project; same view/service as the global instance. |
| repositories/page.jsx | FR-008 | The many-to-many side of Repository records — link/unlink an existing repository to this Project with role, path scope, branch; repositories stay local metadata, never a Project identifier. |
| timeline/page.jsx | FR-064 | Schedule — the project-scoped half: this Project's own `startAt`/`targetAt` window plus its Milestones' `targetAt` dates on one derived month-grid, read-only, nothing persisted, no bar for undated records. `@spec SDD-036` only (per FR-064's own doc note: this page doesn't render `WorkViewTabs`, so the tab-shell argument for `SDD-019` is weaker here than for Board — omitted deliberately). |

## `@tested` omissions (deliberate, not oversights)

For all 6 files other than `import/page.jsx`, I checked `tests/unit`, `tests/integration`, and `tests/e2e` for anything that actually opens or exercises the *page* (not just the underlying view component or service):

- `tests/unit/project-work-route.test.js` (FR-040's test) only reads `WorkViewTabs.jsx` and the dependencies route as text — it never opens `board/page.jsx` or `timeline/page.jsx`. Confirmed by re-reading the file: its three `it` blocks assert on `workTabs`, `dependencyMapRoute`, and `projectLayout` only.
- `tests/unit/human-intake-surface.test.js` reads `ExecutionModeView.jsx` directly, not `execution/[mode]/page.jsx`.
- `tests/integration/project-core.test.js` calls `repository-service.js` functions directly, not the `repositories/page.jsx` route.
- `grep`'d all of `tests/` for `projects/${...}/execution`, `/board`, `/all-work`, `/repositories`, `/milestones`, `/timeline` — the only hit anywhere is `import` (`tests/e2e/smoke.spec.js` lines 124 and 183).

Per the task's instruction ("omit rather than guess"), I left `@tested` off `all-work`, `board`, `execution/[mode]`, `milestones`, `repositories`, and `timeline`.

## Disagreement

None. I annotated exactly what the survey (`.brain/waves/w0-s2-report.md`) and the two newly-declared feature docs (`FR-063-project-board.md`, `FR-064-schedule-timeline.md`) specify. For `board/page.jsx` I deliberately wrote the `@req` comment to describe the *requirement* (one column per `WORK_STATUSES` value, derived from enums.js) rather than the current `KanbanBoard.jsx` six-column implementation, per the task's explicit instruction — the shortfall is tracked separately (FR-063 doc's "Follow-up" section, owned by another lane).

## Files touched

- `src/app/(pm)/projects/[projectId]/all-work/page.jsx`
- `src/app/(pm)/projects/[projectId]/board/page.jsx`
- `src/app/(pm)/projects/[projectId]/execution/[mode]/page.jsx`
- `src/app/(pm)/projects/[projectId]/import/page.jsx`
- `src/app/(pm)/projects/[projectId]/milestones/page.jsx`
- `src/app/(pm)/projects/[projectId]/repositories/page.jsx`
- `src/app/(pm)/projects/[projectId]/timeline/page.jsx`

No other files touched. Did not run `npm test`, `npm run build`, `npm run govern`, or Playwright. Did not edit `docs/.route-anchor-baseline.json`. Did not touch git.
