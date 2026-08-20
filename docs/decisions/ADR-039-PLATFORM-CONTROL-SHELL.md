---
version: "1.0.0"
created_at: "2026-08-20T12:00:00+07:00,ATHER"
last_update: "2026-08-20T12:00:00+07:00,ATHER"
status: "accepted"
superseded_by: null
attributes:
  domain: "platform-control"
  doc_type: "architecture-decision"
  scope: "installation-operator platform programme tracking surface"
---

# ADR-039 — Platform Control is outside the Business Shell

**Status:** Accepted and authorized for the FR-094 read-only implementation slice.

**Relates to:** FR-075, FR-094, NFR-008, ADR-015, ADR-024, ADR-028, `docs/ROUTES-SITEMAP.md`.

## Context

The 24-week delivery programme is a platform-management concern. It is not a
Business, Project, Workstream or a user-facing execution roadmap. Mounting it
under the Business Shell would make the programme appear to be a user's Business
record and would bind it to an ambient `activeBusinessId` it does not have.

`/projects/[projectId]/roadmap` remains the Human-facing, Project-local execution
roadmap defined by ADR-028. It is not a substitute for this surface.

## Decision

### D1 — A separate PlatformControlShell owns `/control/**`

The route group `(control)` mounts a small PlatformControlShell, not `AppShell`.
It has no DomainBar, Business selector, Business sidebar, command palette or
`activeBusinessId` requirement. `DOMAINS` remains the complete Business navigation
registry; `/control/roadmap` is deliberately absent from it.

```text
Root layout
├── Entry / Business routing / BusinessShell … Business users
└── PlatformControlShell
    └── /control/roadmap … installation operator only
```

This is a removable operations surface: its route, shell and static projection are
contained in the `platform-control` technical domain so deleting the programme
does not alter a Business-domain model or navigation contract.

### D2 — `isOperator` is the sole authorization predicate

The control guard admits only a trusted viewer for which
`isInstallationOperator(viewer)` is true. `isPlatform` is visibility-only and
must never grant this route. Owning a Business, owning a Tenant, a global role
label, or domain visibility is also insufficient.

Missing viewer redirects to `/login`. A trusted but non-operator viewer receives
a non-enumerating 404 state. The server route guard runs before the board is
rendered, so unauthorised HTML never contains programme data.

### D3 — The first board is a read-only plan projection

The board renders the approved 24-week programme submitted on 2026-08-20:
six phases, twelve sprints, thirty tasks, eight acceptance gates and ten proposal
deliverables. It stores no progress, Business data, user data or mutable status.

The page identifies itself as a **plan snapshot**, including its supplied baseline
commit (`6ad6ae9`) and document status (`draft`). It does not derive programme
completion from Git commit counts and it must not present live repository activity
as roadmap progress. A future authoritative programme source may replace the
static projection only through a separately approved contract.

### D4 — One Vercel application, distinct protected route

The control route deploys with the standalone `zuri-ai` application, but has its
own URL and authorization boundary. It does not use the legacy `zuri1.0` Vercel
project and does not need a separate Business subdomain. A custom subdomain, if
later required, is routing/hosting configuration only; it must preserve D1-D3.

## Consequences

- Business users cannot mistake platform programme tracking for their operational
  work, and programme removal is a contained deletion.
- Operators get a Zuri-branded board without duplicated Business navigation.
- There is no write path or new persistence model in this slice.
- The plan may be viewed as an operator snapshot but remains non-authoritative;
  gates and status retain the submitted-plan vocabulary until a source-of-truth
  contract is approved.

## Alternatives rejected

**Development → Programme Roadmap.** Rejected: Development is a Business-bound
domain and the programme has no Business owner.

**Reuse the Project execution roadmap.** Rejected: ADR-028 owns a Project-local
execution view; overloading it would merge two distinct scopes.

**Authorize by `isPlatform` or Business ownership.** Rejected: both are broader
visibility/Business concepts and FR-075 explicitly reserves `isOperator` for
installation-wide authority.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-08-20 | accepted | Separated the installation-operator programme board from the Business Shell and fixed its authorization/data boundaries | working-tree | ATHER |
