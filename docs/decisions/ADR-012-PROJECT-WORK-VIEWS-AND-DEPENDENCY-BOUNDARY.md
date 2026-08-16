# ADR-012 — Project Work views and dependency boundary

**Status:** Proposed
**Date:** 2026-08-13
**Decided by:** Owen (owner, pending approval)
**Relates to:** ADR-008, ADR-011, FR-005, FR-007, FR-039, FR-040, SDD-019, NFR-008

## Context

The Product workspace needs to show two complementary planning views: a Work Breakdown
Structure (WBS) and a dependency graph. The shell already has a Business-bound
**Development > Dependencies** view, while an opened Project already has a local `Work`
tab. Making either visualisation another Development sidebar entry would mix Business-level
analysis with one Project's delivery model and would reintroduce Project as a shell parent.

The canonical model already has `Project > Workstream > WorkContainer > WorkItem` (FR-005)
and typed, cycle-checked `Dependency` edges (FR-007). This decision is therefore a read-view
and routing boundary, not a data-model expansion.

## Decision

### D1 — Both visualisations live under Project > Work

```text
Development > Projects > {Project}
  > Work
    > Structure Plan
    > Board
    > Schedule
    > Dependency Map
```

`Structure Plan` and `Dependency Map` are sub-views of the Project-local `Work` tab. They
are not Development sub-domains, shell context levels, or top-level project tabs.

### D2 — Structure Plan is the canonical WBS read view

The Structure Plan renders the hierarchy already owned by the opened Project:

```text
Project
  > Workstream
    > WorkContainer
      > WorkItem
```

It uses stable UUID-backed records and their human codes/titles for display. It does not
invent a second “subproject” persistence model or alter progress calculation.

### D3 — Dependency Map is project-contained

The Dependency Map renders a directed graph only when **both** endpoints belong to the
opened Project. It may include Project, Workstream, Milestone, Gate, WorkContainer, and
WorkItem nodes, using the existing endpoint vocabulary of FR-007.

Edges that cross a Project boundary are intentionally excluded from this map. They stay in
**Development > Dependencies**, the Business-wide register. This prevents a local canvas from
silently exposing or traversing another Project's work.

### D4 — Reuse existing persistence and guards

FR-040 adds no Prisma model, migration, UUID rewrite, or new Dependency type. The existing
cycle/self-dependency guard remains the mutation authority. The map is a display read model;
editing dependencies continues through the existing dependency workflow until separately
specified.

### D5 — Visualisation has an accessible non-canvas path

The graph must expose a keyboard-reachable node/edge summary and preserve useful loading,
empty, error, narrow-viewport, and reduced-motion states. A diagram alone is not the sole
means of understanding a blocker.

## Consequences

- The Development sidebar remains exactly the Business-level map set by ADR-011.
- ProjectTabs gains one Work sub-view, not a new Project tab.
- Existing `/api/projects/{id}/tree` supplies WBS data. A project-contained dependency read
  contract is added or made explicit from the existing dependency service.
- Requirements, Risks, Resources, and binary file storage remain out of FR-040.

## Verification

- AC-040-01 through AC-040-08 in `../domains/project-manager/features/FR-040-project-work-views.md` pass.
- Unit tests prove deterministic graph projection and exclusion of cross-project edges.
- Integration tests prove the API is Project-contained and retains FR-007 cycle protections.
- Playwright covers both visual routes at desktop and narrow viewport sizes.
- `npm run docs:graph`, `npm run docs:preflight`, `npm test`, and `npm run build` pass.
