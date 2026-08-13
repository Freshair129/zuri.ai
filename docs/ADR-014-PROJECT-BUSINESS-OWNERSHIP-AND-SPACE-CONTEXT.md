# ADR-014 - Project Business Ownership and Space Context

**Status:** Accepted
**Date:** 2026-08-13
**Decided by:** Owen (owner)
**Amends:** [ADR-011](ADR-011-CONTEXT-BAR-AND-BUSINESS-SCOPE-CEILING.md) and [ADR-013](ADR-013-BUSINESS-FIRST-OVERVIEW-AND-HR-DOMAIN.md)
**Relates to:** FR-039, FR-041, FR-043, SDD-018, SDD-020, SDD-021, BR-001, SEC-001

## Context

The Project model currently stores only `workspaceId`. This makes the schema
and the Project header infer Business ownership through a lower-level resource.
It also permits a portfolio or tenant-scoped Space to look like the parent of a
normal Business project. The approved shell is Business-first: Roadmap, Goals,
HR / People, reporting, and project visibility all need an unambiguous Business
owner while Space remains a Development grouping.

## Decision

### D1 - Project stores both ownership and grouping

`Project.businessId` is the direct operational owner used for Business-scoped
reporting, authorization, strategy links, and UI context. `Project.workspaceId`
is retained as the Space/grouping context inside Development. No UUIDs or tenant
semantics change.

For ordinary Business projects, the invariant is:

```text
project.businessId == project.workspace.businessId
workspace.scopeType == BUSINESS
```

### D2 - Shared projects are explicit exceptions

`Project.businessId` is nullable only for an explicit cross-business project in a
PORTFOLIO or TENANT-scoped Space. Such a project is visible in reporting and
Development's shared view, but is never silently attributed to a Business
Overview. A BUSINESS-scoped Space cannot contain a null-owner Project.

### D3 - Service boundary owns consistency

Create, update, and import paths derive `businessId` from the target Space when
it is omitted and reject mismatches when it is supplied. Moving a Project to a
different Space recalculates the owner only when the target Space is a valid
Business Space; cross-business moves and explicit owner/Space divergence fail
closed. Existing shared projects remain ownerless and are classified as shared
during backfill.

### D4 - UI hierarchy and labels

The shell remains `Workspace > Organization > Business`, and Project is a
Development resource. Inside a Project page, Business is the primary owner
context and the schema `Workspace` is displayed as **Space** secondary metadata.
The Project header must not render `Space code · Project code` as if Space were
the parent.

## Migration

1. Add nullable `Project.businessId` and its Business relation/index.
2. Backfill from `Workspace.businessId`.
3. Verify every Business-scoped Project has a matching owner; retain null only
   for portfolio/tenant shared work.
4. Keep the additive SQL artifact compatible with the existing `db:push`
   local workflow and generated Postgres schema.

## Rejected alternatives

1. Infer Business through Workspace only: rejected because shared Spaces have no
   Business and because ownership is needed by Business-level read models.
2. Remove `workspaceId`: rejected because Space is still useful for Development
   grouping and existing import/API contracts.
3. Make every Project belong to a Business: rejected for the existing explicit
   cross-business/portfolio project use case.
