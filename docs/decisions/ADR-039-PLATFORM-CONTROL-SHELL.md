---
version: "1.2.0"
created_at: "2026-08-20T12:00:00+07:00,ATHER"
last_update: "2026-08-20T15:15:00+07:00,ATHER"
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

### D3 — The board separates the submitted plan from verified evidence

The board renders the approved 24-week programme: six phases, twelve sprints,
thirty tasks, eight acceptance gates and ten proposal deliverables. Its programme
calendar starts on the GitHub repository-creation date, 2026-08-11 (Day 1), not
the former draft-calendar date.

The page identifies the plan as a **plan snapshot**, including its supplied
baseline commit (`6ad6ae9`) and document status (`draft`). A second, separately
labelled **evidence snapshot** presents aggregate GitHub-default-branch activity
and the verified SmartGift migration facts as of 2026-08-20. It contains no raw
source rows, PII, local filesystem paths, prices, cost, credentials or mutation
control.

Commit activity and migration counts are evidence only. They do not calculate
programme completion, satisfy acceptance gates, authorize a migration or claim
deployment/UAT readiness. The initial evidence snapshot is build-time data with
no GitHub API, source-DuckDB, Supabase or browser write path. Refreshing it or
introducing a live monitor requires a separately approved source-of-truth contract.

### D4 — One Vercel application, distinct protected route

The control route deploys with the standalone `zuri-ai` application, but has its
own URL and authorization boundary. It does not use the legacy `zuri1.0` Vercel
project and does not need a separate Business subdomain. A custom subdomain, if
later required, is routing/hosting configuration only; it must preserve D1-D3.

### D5 — `/programme` is a public, removable status share

`/programme` renders exactly the build-time aggregate plan and evidence snapshot
from D3 without a viewer, login, Business context, API, database access or write
path; the root scope provider excludes this path from its `/api/scope` preload.
It is intentionally public, not merely obscured: a URL is not access
control. It must never add raw source rows, PII, prices, cost, credentials, local
paths, live GitHub/Supabase/DuckDB data or a migration action.

The operator-only `/control/roadmap` remains unchanged. Removing public sharing
means deleting only `/programme`; it does not alter the platform control guard or
Business navigation.

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
| 1.2.0 | 2026-08-20 | accepted | Added the public, aggregate-only and removable `/programme` status share without weakening the operator route | working-tree | ATHER |
| 1.1.0 | 2026-08-20 | accepted | Anchored Day 1 at repository creation and added a no-PII, read-only evidence snapshot boundary | working-tree | ATHER |
| 1.0.0 | 2026-08-20 | accepted | Separated the installation-operator programme board from the Business Shell and fixed its authorization/data boundaries | working-tree | ATHER |
