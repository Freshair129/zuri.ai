# W1-G1 — route anchor annotations

| Route | Id anchored | Description used |
|---|---|---|
| src/app/(pm)/audit/page.jsx | FR-014 | "the immutable audit event browser: filter by entityType and list occurredAt/action/actorType/payload from /api/audit" |
| src/app/(pm)/dependencies/page.jsx | FR-007 | "the cross-project Dependencies register: create/list/delete over the 5 dependency types, distinct from the project-local Dependency Map (FR-040)" |
| src/app/(pm)/execution/page.jsx | FR-009 | "the global index of the seven execution mode views (no projectId), the unscoped half of 'global + project-scoped'" |
| src/app/(pm)/execution/[mode]/page.jsx | FR-009 | "renders one of the seven execution mode views, unscoped (global instance) over the neutral core model" |
| src/app/(pm)/milestones/page.jsx | FR-006 | "the cross-project Milestones & Gates browser: weighted milestones and their required-flag gates, status-editable, across all projects" |
| src/app/(pm)/projects/page.jsx | FR-003 | "Project CRUD + archive (soft delete): list, create link, edit modal and archive action over /api/projects" |
| src/app/(pm)/repositories/page.jsx | FR-008 | "repository records (create/edit via RepoModal: provider, fullName, url, defaultBranch, externalRepoId) and their many-to-many project links" |
| src/app/(pm)/timeline/page.jsx | FR-064 | "the global Schedule view: a derived month-grid Gantt over all in-scope Projects' startAt→targetAt windows and Milestones' targetAt dates, read-only, mirroring the FR-009 global/project-scoped split" (@spec SDD-036) |
| src/app/(pm)/work/page.jsx | FR-005 | "the cross-project All Work browser over the neutral WorkContainer/WorkItem model: filterable, status-editable, global scope" |
| src/app/(pm)/workspaces/page.jsx | FR-001 | "Workspace scope-hierarchy CRUD: list Spaces with their human codes, create/edit/archive via WorkspaceModal" |
| src/app/(pm)/workspaces/[workspaceId]/page.jsx | FR-001 | "single-Workspace detail: resolves one Space's identity (code/scopeType/name) from the scope hierarchy and lists its Projects" |

11/11 annotated. `node scripts/doc-preflight.mjs` run once at the end: **PASS**, critical 0 · warning 0 (15 pre-existing info-level notes, none new / none `requirement-coverage`).

## Where the sharpened FR-005/006/007 text changed the description

The survey (w0-s1) anchored dependencies/milestones/work on the underlying `application/*.js` service's `@req` clause because, at survey time, none of FR-005/006/007's registry text named a UI surface. Per this task's instructions, I re-read the current rows and all three now explicitly name the surface:

- FR-005: "...browsed and status-edited at Development → All Work, both **global and project-scoped**"
- FR-006: "...browsed and status-edited at Development → Milestones & Gates, both **global and project-scoped**"
- FR-007: "...created, listed and deleted at the cross-project register Development → Dependencies. (The project-local Dependency **Map** is a separate read view, FR-040.)"

My descriptions for those three routes were written to match this sharpened, surface-naming text rather than the survey's data-model framing — no id changed, only the wording.

## `@tested` — added where a genuine test exists, omitted elsewhere

Checked each candidate test claim by reading the actual test file rather than trusting a filename match. `tests/e2e/smoke.spec.js` genuinely exercises (navigates + asserts content on) these routes and was cited:

- audit, dependencies, milestones, timeline, work, workspaces (list), projects, execution/[mode] (looped over all 7 slugs + a dedicated "progress explanation" test)

Omitted `@tested` on three routes because no test asserts on their actual content, only warms the route via a plain unauthenticated `request.get` with no expectations (`tests/e2e/warmup.setup.js`, which exists solely to pre-compile dev routes, not to verify behavior — see its own header comment):

- **src/app/(pm)/execution/page.jsx** (index) — no test asserts on `EXECUTION_NAV` links or the "Seven Execution Modes" heading.
- **src/app/(pm)/repositories/page.jsx** — no test exercises `RepoModal` or the repository list content; only `repository-service.js`'s data model is touched indirectly via `project-core.test.js` fixtures, not the page.
- **src/app/(pm)/workspaces/[workspaceId]/page.jsx** — no test navigates to a specific `/workspaces/{id}` detail route or asserts its content.

## Disagreements / doubts

None. I followed the survey's ids on all 11 routes, including the two MEDIUM-confidence workspaces/[workspaceId] alternative (FR-001 vs. FR-003) the survey itself flagged — I read the page the same way the survey did (workspaceId-keyed identity view, not a filtered Projects list) and kept FR-001.
