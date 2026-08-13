# ADR-013 - Business-first Overview, Strategy, and HR domain boundary

**Status:** Accepted
**Date:** 2026-08-13
**Decided by:** Owen (owner)
**Amends:** [ADR-011](ADR-011-CONTEXT-BAR-AND-BUSINESS-SCOPE-CEILING.md) D3-D4 and [SITEMAP-V2](SITEMAP-V2-DOMAIN-NAV.md) sections 2b, 3, 4, and 5
**Relates to:** FR-035, FR-039, FR-041, FR-042, SDD-014, SDD-020, BR-001

## Context

The current `/overview` can render a portfolio/group roll-up with one card per
business. That is useful for consolidation, but it violates the approved shell
boundary: the operational shell is Business, not Organization or Business Group.
It also leaves no first-class place for a Business to set direction above its
projects (roadmap and short/medium/long goals), and it mixes people operations
with Development project execution.

## Decision

### D1 - Overview is always Business-scoped

`/overview` is a Business Overview. It renders only the selected Business's
projects, domain health, roadmap, and goals. When no Business is selected, the
page renders a Business-required state with a link back to Home; it never renders
a four-business/group card grid.

Portfolio/Organization remains an ancestry and isolation context. The existing
portfolio progress API remains available for consolidation/reporting consumers,
but it is not the operational shell landing page.

### D2 - Strategy is a Business-level read model

Each Business may own one or more `BusinessRoadmap` records. A roadmap has two or
three ordered `BusinessRoadmapHorizon` records (for example short, medium, and
long term). `BusinessGoal` records belong to a Business and may be assigned to a
roadmap horizon. A goal may link to many Projects through `ProjectGoal`; a Project
remains a Development resource and does not become a shell parent.

The first delivery is a read model and seeded contract. Horizon cardinality is
validated at the service boundary (minimum two, maximum three); editing and
project-goal assignment are a follow-up mutation slice, not a reason to widen the
shell.

### D3 - HR / People is a peer ERP domain

`HR / People` is a first-class peer of `Development`, not a Development
sub-domain. Its internal route key is `people` and its first surface is a
Business-scoped People Directory over the existing `Person` and `Membership`
models. Development Team remains project assignment/capacity for one Project.
Platform remains identity, access, and audit. Attendance, leave, payroll, and
performance workflows are future HR slices and are not invented in this change.

The Business domain map is therefore:

```text
Overview | Commerce | CRM | Marketing | Operations | HR / People | Development | Platform
```

### D4 - Identity and isolation remain unchanged

No Organization model or new tenant identifier is introduced. `Tenant` remains
the isolation boundary, `Business` remains the operating boundary, and all new
read paths must filter by the viewer's visible Business IDs. UUIDs and existing
relationships remain stable.

## Consequences

- Group/Organization is no longer an operational overview route.
- Business Overview gains a strategy section without making Project a parent of
  the shell.
- HR can evolve independently from project execution while reusing existing
  identity records.
- Existing portfolio progress remains a reporting API and can be reintroduced in
  an explicitly named consolidation/reporting surface later.

## Rejected alternatives

1. Keep the group roll-up at `/overview`: rejected because it makes Organization
   the apparent shell owner and leaks the multi-business hierarchy into daily work.
2. Put HR under Development: rejected because people master data and project
   execution have different ownership, privacy, and lifecycle boundaries.
3. Add a second Organization/tenant model: rejected because it would duplicate
   identity and isolation semantics already fixed by ADR-011 and BR-001.
