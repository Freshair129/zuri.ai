# Zuri — Route and Shell Sitemap

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | draft |
| **Date** | 2026-08-17 |
| **Authority** 

## Current verified FR-044 entry and shell journey

```text
/                 EntryShell: minimal Landing → /login
/login            EntryShell: demo Login button only → /businesses
/businesses       BusinessRoutingShell: viewer-visible Business selection
/overview         BusinessShell: selected Business Overview
/{domain}/...     BusinessShell: Business-bound domain/sub-domain
/projects/{id}/…  ProjectResourceShell nested inside BusinessShell
```

Business selection happens before the final BusinessShell. No entry route renders the
final DomainBar, Development sidebar, or Project tabs.

## Approved next pre-shell target (ADR-027)

This is the approved documentation target for Profile-first onboarding. It is not
implemented by the current route tree yet.

```text
/                         EntryShell: Landing
/login                    EntryShell: local/demo identity transition
/onboarding/profile       Profile setup over the resolved Person
/waiting-room             Profile-only member or pending invitation state
/workspaces               top-level collaboration Workspace list/home (Portfolio)
/workspaces/:id           Workspace Home and membership/invitation state
/businesses               Business Routing, only when Business access exists
/overview                 BusinessShell: selected Business Overview
```

The current PM `/workspaces` compatibility page exposes schema `Workspace` and
must be displayed as **Space** when this target is implemented. It must not be
silently treated as the top-level collaboration Workspace. A future route move to
`/spaces` or a Business/Project-nested route may be implemented separately without
changing schema identities.

## Logical layout boundaries

```text
Root Provider Layout
├── EntryShell
│   ├── /
│   └── /login
├── BusinessRoutingShell
│   └── /businesses
├── PlatformControlShell (requires isOperator; no Business scope)
│   └── /control/roadmap
└── BusinessShell (requires activeBusinessId)
    ├── /overview
    ├── /people
    ├── /people/directory
    ├── /projects
    ├── /work
    ├── /execution/[mode]
    ├── /timeline
    ├── /dependencies
    ├── /milestones
    ├── /repositories
    ├── /platform/users
    ├── /platform/integrations *(FR-080 metadata-only local implementation)*
    ├── /profile
    ├── /settings
    ├── /audit
    ├── /backup
    └── ProjectResourceShell
        └── /projects/[projectId]/…
```

## Current PM resource routes

```text
/projects
├── /new
└── /[projectId]
    ├── /all-work
    ├── /board
    ├── /dependencies
    ├── /execution/[mode]
    ├── /files
    ├── /import
    ├── /inventory
    ├── /milestones
    ├── /repositories
    ├── /structure
    ├── /team
    └── /timeline
```

Project routes remain resource routes. `Project.businessId` is the direct owner;
`Project.workspaceId` is displayed as Space context and is never promoted to shell
scope.

## Domain and sub-domain map

The BusinessShell domain bar has seven runtime domain keys:

```text
Commerce · CRM · Marketing · Operations · HR / People · Development · Platform
```

`/platform/integrations` is the FR-080 Platform sub-domain. Its local
implementation exposes trusted owner-scoped metadata create/list and redacted
Supabase Vault status; live Supabase apply and production provisioning remain
external gates.

Business Overview is the shell root, not a Development sub-domain. Development's
sidebar is:

```text
Projects · All Work · Execution · Timeline · Dependencies · Milestones & Gates · Repositories
```

The Development item in the DomainBar and its sidebar header use `/overview` as the
BusinessShell root. The sidebar list itself contains only the seven Development
capabilities above.

HR / People has:

```text
People Directory
```

Reserved domains and future lifted sub-domains remain in
[`SITEMAP-DOMAIN-NAV.md`](SITEMAP-DOMAIN-NAV.md); they do not become active routes
until their parity and BusinessModule gates are met.

## Scope and guard rules

- URLs do not carry Portfolio/Tenant/Business ids; selection is ambient.
- `/businesses` is the only Business selector in this slice.
- `/overview` and Business domain routes require an authorized Business selection.
- `/control/roadmap` requires a trusted installation operator but no Business
  selection. It is outside `DOMAINS`; `isPlatform`, role and Business ownership
  are insufficient. See ADR-039.
- Missing viewer → `/login`.
- Missing Business → `/businesses`.
- Missing Profile → `/onboarding/profile` in the ADR-027 target flow.
- Profile-only or Workspace-only access → `/waiting-room` or `/workspaces`; it does
  not imply Business access.
- Unauthorized Business/domain → explicit forbidden state or Business Overview.
- Project deep links require the selected Business unless the Project is an explicit
  shared Portfolio Space resource.

## API reference

The current API route inventory is maintained in
[`appendices/A-api-spec.md`](appendices/A-api-spec.md). It contains 67 current route handlers;
FR-044 adds no login endpoint. The entry routing contract reuses `/api/viewer` and
`/api/scope` until production authentication introduces a viewer-scoped session
interface. ADR-027's future contract will add viewer-scoped Profile/Workspace
entry data and invitation mutations; those endpoints are not present yet.

## Evidence and drift rule

This file is a human-readable route map. The generated document graph and preflight
remain the machine checks:

```text
npm run docs:graph
npm run docs:preflight
npm run docs:check
```
