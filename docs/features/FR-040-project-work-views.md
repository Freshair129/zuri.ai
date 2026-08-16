---
feature: FR-040
module: project-manager
source: v2-native
version: 0.1.0
status: implemented
---

# FR-040 — Project Work views

## Intent

An opened Project provides two planning visualisations under its `Work` tab:
**Structure Plan** explains the delivery hierarchy; **Dependency Map** explains the
project-contained sequencing and blockers. They are different read views over the existing
neutral work and dependency models, not new navigation domains or persistence entities.

## Scope

| Surface | Route | Data boundary | State |
|---|---|---|---|
| Structure Plan | `/projects/{projectId}/structure` | Project, Workstreams, WorkContainers, WorkItems | existing, brought under FR-040 verification |
| Dependency Map | `/projects/{projectId}/dependencies` | only edges with both endpoints in that Project | implemented |
| Global Dependencies | `/dependencies` | Business-wide, including cross-project relations | existing, unchanged |

## Acceptance criteria

| ID | Acceptance criterion |
|---|---|
| AC-040-01 | The opened Project shows `Work` sub-view links for Structure Plan, Board, Schedule, and Dependency Map without adding a Development sidebar item. |
| AC-040-02 | Structure Plan renders a labelled Project root and its canonical Workstream, WorkContainer, and WorkItem hierarchy from `/api/projects/{projectId}/tree`. |
| AC-040-03 | Dependency Map renders a labelled, directed node-edge graph for every dependency whose two endpoints are owned by the opened Project. |
| AC-040-04 | Dependency Map excludes edges with either endpoint outside the opened Project. Such relations remain available in `/dependencies`, not in the Project canvas. |
| AC-040-05 | The map has a useful empty state, loading state, error state, keyboard-focusable node/edge summary, and reduced-motion fallback. |
| AC-040-06 | The visualisation remains usable at 1280px desktop and 390px narrow viewport through pan/scroll or an equivalent non-clipping layout. |
| AC-040-07 | The feature creates no Prisma model, migration, UUID change, new Dependency type, or Tenant/Business isolation change. |
| AC-040-08 | Unit, integration, and Playwright coverage pass with `npm test`, `npm run build`, `npm run docs:graph`, and `npm run docs:preflight`. |

## Non-goals

- Requirements, Risks, Resources, and binary file storage.
- Drag-to-edit graph layouts or editing dependency edges from the canvas.
- Cross-project traversal from Project > Work.
- Any new scope selector or shell/sidebar route.

## Design constraints

- Use the Zuri Heritage token and component contract (NFR-008, ADR-010).
- The graph complements the accessible dependency list; it cannot be the only representation.
- Node colours supplement text/status; they do not encode meaning alone.

See [ADR-012](../decisions/ADR-012-PROJECT-WORK-VIEWS-AND-DEPENDENCY-BOUNDARY.md) for the
navigation and data-boundary decision, and
[PLAN-FR-040](../roadmap/PLAN-FR-040-PROJECT-WORK-VIEWS.md) for the implementation DAG.

## Implementation status

AC-040-01 through AC-040-08 are implemented and covered by the full repository
suite (48 files / 278 tests), FR-040 Playwright proof, a clean production build,
and passing documentation gates. The test bootstrap now sets a supported Prisma
schema-engine logging mode; the RCA is recorded in
`.brain/rca/2026-08-13-prisma-test-bootstrap.md`.
