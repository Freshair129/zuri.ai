# W0-S3 — survey: work / structure / progress API

| Route | Verdict | Requirement | Evidence | Source (registry \| service annotation) | Confidence |
|---|---|---|---|---|---|
| `src/app/api/audit/route.js` (GET) | EXISTING | FR-014 | "Audit log (immutable) + UI browser"; `listAudit` lives in `audit.js`, which is annotated `// @req FR-014 — immutable audit event stream` | service annotation (matches registry + TRACE.md) | High |
| `src/app/api/containers/route.js` (POST) | EXISTING | FR-005 | "Neutral work model: WorkContainer (ลำดับชั้น) + WorkItem (weight/value/probability/metrics)"; `createContainer` is in `work-service.js`, file-annotated `// @req FR-005 — neutral WorkContainer/WorkItem model behind all execution modes` | service annotation | High |
| `src/app/api/containers/[id]/route.js` (PATCH) | EXISTING | FR-005 | same file/annotation as above; `updateContainer` is defined immediately under the same `@req FR-005` header | service annotation | High |
| `src/app/api/dependencies/route.js` (GET, POST) | EXISTING | FR-007 | "Dependencies 5 ชนิด, กัน self/cycle, ประเมิน blocked/ready"; `listDependencies`/`createDependency` live in `dependency-service.js`, file-annotated `// @req FR-007 — dependencies with self/cycle rejection + blocked evaluation` (a second id, FR-040, is also declared in the same file but belongs to `getProjectDependencyGraph`, a different exported function used by `/api/projects/[id]/dependencies`, not this route — see note below) | service annotation | High |
| `src/app/api/dependencies/[id]/route.js` (DELETE) | EXISTING | FR-007 | `deleteDependency` is in the same `dependency-service.js` file, under the same FR-007 header | service annotation | High |
| `src/app/api/gates/route.js` (POST) | EXISTING | FR-006 | "Milestones + Gates (weighted, required flag, evidence JSON)"; `createGate` is in `milestone-gate-service.js`, file-annotated `// @req FR-006 — weighted milestones + required gates with evidence` | service annotation | High |
| `src/app/api/gates/[id]/route.js` (PATCH) | EXISTING | FR-006 | `updateGate` is in the same file/header as above | service annotation | High |
| `src/app/api/milestones/route.js` (GET, POST) | EXISTING | FR-006 | `listMilestonesAndGates`/`createMilestone` are in the same `milestone-gate-service.js`, same FR-006 header | service annotation | High |
| `src/app/api/milestones/[id]/route.js` (PATCH) | EXISTING | FR-006 | `updateMilestone`, same file/header | service annotation | High |
| `src/app/api/progress/project/[id]/route.js` (GET) | EXISTING | FR-011 | "Project roll-up ถ่วงน้ำหนัก Σ(ws%×w)/Σw"; `computeProjectProgress` (in `progress-service.js`, itself unannotated for this function) delegates its actual math to `rollupProject()` in `src/modules/project-manager/progress/rollup.js`, annotated `// @req FR-011, FR-020 — weighted project roll-up Σ(ws% × weight) / Σ(weight), and the same formula one level up for business/group cards.` FR-020 in that same comment covers the *business*-level sibling function `rollupBusiness()` (used by `/api/progress/portfolio`, not this route), so FR-011 is the applicable id here. Confirmed by TRACE.md, which cites exactly `progress/rollup.js` as FR-011's code. | service annotation (one level below the route, on the pure calculator) + registry/TRACE cross-check | High |
| `src/app/api/progress/workstream/[id]/route.js` (GET) | EXISTING | FR-010 | "Progress ต่อ workstream ตาม strategy + evidence + warnings"; `computeWorkstreamProgress` (in `progress-service.js`, unannotated at that function) delegates to `calculateWorkstreamProgress()` in `src/modules/project-manager/progress/strategies.js`, annotated `// @req FR-010 — strategy-based progress with evidence + warnings`. Confirmed by TRACE.md citing `progress/strategies.js` as FR-010's code. | service annotation (on the pure calculator one level below the route) + registry/TRACE cross-check | High |
| `src/app/api/work/route.js` (GET, POST) | EXISTING | FR-005 | `listWork`/`createItem` are in `work-service.js`, under the same file-level `// @req FR-005` header as the containers functions | service annotation | High |
| `src/app/api/work/[id]/route.js` (PATCH, DELETE) | EXISTING | FR-005 | `updateItem`/`deleteItem`, same file/header | service annotation | High |
| `src/app/api/workstreams/route.js` (GET, POST) | EXISTING | FR-004 | "Workstream CRUD: executionMode + progressStrategy + progressWeight"; `listWorkstreams`/`createWorkstream` are in `project-service.js`, whose header carries two ids together (`// @req FR-003, FR-004 — project CRUD/archive + workstream mode/strategy/weight`). FR-003 covers the file's *Project* functions (`createProject`, `updateProject`, `archiveProject`, `getProject`) — none of which this route touches. This route touches only the workstream functions, so FR-004 is the applicable id, confirmed by TRACE.md which cites this same file as FR-004's code. | service annotation, disambiguated against registry text + TRACE.md | High |
| `src/app/api/workstreams/[id]/route.js` (PATCH, DELETE) | EXISTING | FR-004 | `updateWorkstream`/`archiveWorkstream`, same file, same disambiguation as above | service annotation, disambiguated | High |

## Routes needing a new requirement

None. All 15 assigned routes implement an already-declared requirement (FR-004,
FR-005, FR-006, FR-007, FR-010, FR-011, or FR-014).

## Routes implementing more than one requirement

None of the 15 routes span two different requirements. Two routes are worth
flagging only because their *file* carries more than one id, but the specific
verbs on the route resolve to a single id each:

- `src/app/api/dependencies/route.js` and `src/app/api/dependencies/[id]/route.js`
  — `dependency-service.js` declares both FR-007 and FR-040, but FR-040 belongs
  to `getProjectDependencyGraph` (exposed instead through
  `/api/projects/[id]/dependencies`, outside this batch). These two routes use
  only `listDependencies`/`createDependency`/`deleteDependency`, all FR-007.
- `src/app/api/workstreams/route.js` and `src/app/api/workstreams/[id]/route.js`
  — `project-service.js` declares both FR-003 and FR-004, but FR-003 belongs to
  the Project CRUD functions the workstream routes never call. Both workstream
  routes resolve cleanly to FR-004 alone.

## Notes and doubts

- **`progress-service.js` itself carries no `@req` on `computeWorkstreamProgress`
  or `computeProjectProgress`.** The only annotation in that file (`@req FR-020`)
  sits above the unrelated `computePortfolioProgress` function (used by
  `/api/progress/portfolio`, not in this batch). The FR-010/FR-011 evidence for
  the two routes in scope comes one layer deeper, from the pure calculators in
  `src/modules/project-manager/progress/` that `progress-service.js` calls
  (`calculateWorkstreamProgress` in `strategies.js`, `rollupProject` in
  `rollup.js`) — consistent with CLAUDE.md's note that `progress/` holds "pure
  calculators, no I/O." When these routes are annotated, consider also adding
  `@req` directly to `computeWorkstreamProgress`/`computeProjectProgress` in
  `progress-service.js`, since today the service layer itself is a documentation
  gap even though the calculators underneath it are annotated.
- **`dependency-service.js` and `project-service.js` each mix two requirement
  ids in one file-level comment block.** This is fine for the file as a whole
  but is not precise enough to copy onto a route mechanically — verified above
  by checking which exported functions each route actually calls before
  assigning the id. Anyone annotating these routes should do the same function-
  level check rather than pasting the full file header id list onto the route.
- No route in this batch looks dead, unreachable, or contradicts the registry
  text. All behavior read in the route/service source matches the corresponding
  Appendix A (`docs/appendices/A-api-spec.md`) row and the corresponding
  TRACE.md entry.
