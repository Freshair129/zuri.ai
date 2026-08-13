# RCA — Project context displayed above the Business shell

**Date:** 2026-08-13
**Scope:** Business overview, project context selectors, and project detail navigation

## Symptom

The overview rendered the portfolio/organization as the primary shell and showed
multiple businesses as peer cards. A deep-linked project could also display only
its workspace code, making the owning Business unclear.

## Evidence

- The project record already had `workspaceId`, while the workspace carried the
  Business relationship; project reads did not expose a direct `businessId`.
- The topbar and breadcrumb used the shell selection only, so a direct project URL
  could fall back to “Select organization” and “Select business”.
- The prior UI presented `Workspace · Project` without a Business-first label.
- The approved hierarchy and ADR-014 require `Business → Space → Project`, with
  portfolio-level projects remaining explicitly shared.

## Root Cause

The operating owner and execution context were conflated. The UI treated the
portfolio/organization as the operating shell and inferred project ownership only
through the Space relation. That made the correct Business boundary implicit and
allowed deep links to lose the Business context.

## Why the issue escaped detection

Existing tests covered project/workspace persistence and generic shell navigation,
but did not assert direct Business ownership, Business/Space consistency, or
deep-link rendering when no shell selection was present.

## Implemented prevention

Projects now persist a nullable direct `businessId` alongside `workspaceId`;
Business Spaces require a matching owner and shared portfolio Spaces retain a null
owner. Migration/backfill derives the owner from the existing Space relation.
Project reads, topbar, breadcrumbs, and detail headers resolve Business first and
show Space as secondary context. FR-043 tests cover derivation, mismatch/null
rejection, shared projects, filtering, and cross-Business moves.
