# W1-G3 — anchored 15 API routes with FR requirements

## Routes annotated

| Route | FR ID | Description used |
|---|---|---|
| `src/app/api/audit/route.js` | FR-014 | list immutable audit events filtered by entity type or id |
| `src/app/api/containers/route.js` | FR-005 | create a work container in the neutral WorkContainer/WorkItem model |
| `src/app/api/containers/[id]/route.js` | FR-005 | update a work container in the neutral WorkContainer/WorkItem model |
| `src/app/api/dependencies/route.js` | FR-007 | list or create dependencies with self/cycle rejection and blocked evaluation |
| `src/app/api/dependencies/[id]/route.js` | FR-007 | delete a dependency |
| `src/app/api/gates/route.js` | FR-006 | create a weighted gate with required flag and evidence |
| `src/app/api/gates/[id]/route.js` | FR-006 | update a weighted gate with required flag and evidence |
| `src/app/api/milestones/route.js` | FR-006 | list or create weighted milestones with gates |
| `src/app/api/milestones/[id]/route.js` | FR-006 | update a weighted milestone with gates |
| `src/app/api/progress/project/[id]/route.js` | FR-011 | compute weighted project roll-up of workstream progress |
| `src/app/api/progress/workstream/[id]/route.js` | FR-010 | compute strategy-based progress with evidence and warnings |
| `src/app/api/work/route.js` | FR-005 | list or create work items in the neutral WorkContainer/WorkItem model |
| `src/app/api/work/[id]/route.js` | FR-005 | update or delete work items in the neutral WorkContainer/WorkItem model |
| `src/app/api/workstreams/route.js` | FR-004 | list or create workstreams with execution mode, progress strategy, and weight |
| `src/app/api/workstreams/[id]/route.js` | FR-004 | update or archive workstreams with mode, strategy, and weight |

## Notes

**Progress routes — service layer unannotated:** `src/app/api/progress/project/[id]/route.js` and `src/app/api/progress/workstream/[id]/route.js` route to service functions (`computeProjectProgress` and `computeWorkstreamProgress` in `src/modules/project-manager/application/progress-service.js`) that carry no `@req` annotation themselves. The evidence for FR-011 and FR-010 respectively comes from the pure calculators one level deeper (in `src/modules/project-manager/progress/rollup.js` and `src/modules/project-manager/progress/strategies.js`), which are annotated. The service functions remain unannotated — this is a documentation gap in the service layer, but the routes are now correctly anchored to their requirements via the pure calculator trail below.

All annotations follow the format specified in the survey report with no deviations. No `@spec` or `@tested` annotations were added, as the report specified none.
