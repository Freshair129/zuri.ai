# Phase 02 — Project Core

**Status: PASS**

## Implemented
- CRUD + domain validation for Project, Workstream (mixed execution modes per project), WorkContainer (hierarchy, same-workstream parent rule), WorkItem (weight/numericValue/probability/metrics/metadata), Milestone, Gate (evidence JSON, required flag), Dependency, Repository + ProjectRepository (many-to-many with role/pathScope/branch), AuditEvent on every mutation.
- Dependency service: self-dependency rejection, DFS cycle detection before insert, blocked/ready evaluation (BLOCKS sources & REQUIRES targets not DONE/PASSED/WAIVED), endpoint resolution to codes/titles.
- Human-code generation with collision retry; `/api/resolve` maps codes → internal ids.
- API routes for all entities (`/api/projects`, `/api/workstreams`, `/api/work`, `/api/containers`, `/api/milestones`, `/api/gates`, `/api/dependencies`, `/api/repositories(+/link)`, `/api/audit`).

## Changed files
`src/modules/project-manager/application/{project-service,work-service,milestone-gate-service,dependency-service,repository-service,audit}.js`, `src/lib/validation/entities.js`, `src/app/api/**`.

## Database changes
None beyond Phase 00 schema (persisted enums are strings; validated by Zod).

## Tests run / results
`tests/integration/project-core.test.js` — 11 tests, all pass: CRUD + audit + version increments, mixed modes, unknown-mode rejection, container/item integrity, milestone/gate linkage, repo many-to-many, self-dep/cycle/blocked evaluation, deterministic progress + rollup, gate evidence merge, soft-delete archive, workstream update.

## Screens/routes verified
`/projects`, `/projects/[id]` (workstream cards, edit modals, archive).

## Known issues
None.

## Decisions made
- Soft delete (`deletedAt` + ARCHIVED) for projects/workstreams/items; hard delete only for dependencies and repo links (audited).
- Metrics/metadata PATCH merges rather than replaces.

## Next phase
Phase 03 — Universal views.
