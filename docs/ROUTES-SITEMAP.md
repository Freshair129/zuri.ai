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
/login            EntryShell: credential login → /businesses
/businesses       BusinessRoutingShell: viewer-visible Business selection
/overview         BusinessShell: selected Business Overview
/{domain}/...     BusinessShell: Business-bound domain/sub-domain
/projects/{id}/…  ProjectResourceShell nested inside BusinessShell
```

Business selection happens before the final BusinessShell. No entry route renders the
final DomainBar, Development sidebar, or Project tabs.

## Profile-first pre-shell flow (ADR-027, FR-066/FR-067 — implemented)

FR-066 (Profile-first onboarding) and FR-067 (Workspace collaboration boundary)
are both ✅ implemented (docs/PRD-SDD-v1.0.md) and shipped under
`src/app/(entry)/`:

```text
/                         EntryShell: Landing
/login                    EntryShell: authenticated account login
/onboarding/profile       Profile setup over the resolved Person
/waiting-room             Profile-only member or pending invitation state
/workspace-home           top-level collaboration Workspace home (Portfolio)
/businesses               Business Routing, only when Business access exists
/overview                 BusinessShell: selected Business Overview
```

The ADR-027 D8 target path was `/workspaces`, but that name was already taken
by the PM Space compatibility page (`Project.workspaceId`, schema `Workspace`,
displayed as **Space** — see "Current PM resource routes" below). The shipped
top-level collaboration Workspace route is `/workspace-home` instead, so the
two identities never collide at one path. `WorkspaceInvite`/`WorkspaceMembership`
mutations are served at `/api/workspace-invites`; there is no separate
`/workspaces/:id` route — Workspace Home and membership/invitation state both
render at `/workspace-home`.

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
    ├── /customer
    ├── /customer/conversations
    ├── /market
    ├── /people
    ├── /people/directory
    ├── /projects
    ├── /workspaces *(PM Space compatibility page — schema `Workspace`, displayed as Space)*
    ├── /workspaces/[workspaceId]
    ├── /work
    ├── /execution/[mode]
    ├── /timeline
    ├── /dependencies
    ├── /milestones
    ├── /files
    ├── /repositories
    ├── /assets
    ├── /assets/receiving
    ├── /platform/users
    ├── /platform/integrations *(FR-080 metadata-only local implementation)*
    ├── /platform/product-readiness
    ├── /platform/customer-import-reviews
    ├── /platform/sot-pipeline
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

The BusinessShell domain bar has nine operational domain keys (`src/config/domains.js`;
`business-home` is a separate always-visible shell slot, not counted here — see
`docs/INTERFACE-INVENTORY.md` §4):

```text
Commerce · CRM · Market Intelligence · Marketing · Operations · HR / People ·
Development · Asset Management · Platform
```

`/platform/integrations` is the FR-080 Platform sub-domain. Its local
implementation exposes trusted owner-scoped metadata create/list and redacted
Supabase Vault status; live Supabase apply and production provisioning remain
external gates.

Business Overview is the shell root, not a Development sub-domain. Development's
sidebar is:

```text
Projects · All Work · Execution · Timeline · Dependencies · Milestones & Gates ·
Files · Repositories
```

The Development item in the DomainBar and its sidebar header use `/overview` as the
BusinessShell root. The sidebar list itself contains only the eight Development
capabilities above (`docs/INTERFACE-INVENTORY.md` §3.2).

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
  are insufficient. See ADR-048. Since 2026-09-02 it is reachable from `/settings`
  through an operator-only link (FR-105 / FR-075), and PlatformControlShell links
  back to `/businesses`.
- Missing viewer → `/login`.
- Missing Business → `/businesses`.
- Missing Profile → `/onboarding/profile` (ADR-027, FR-066 — implemented).
- Profile-only or Workspace-only access → `/waiting-room` or `/workspace-home`;
  it does not imply Business access.
- Unauthorized Business/domain → silent redirect to Business Overview
  (`BusinessShellGuard.jsx`); no explicit forbidden message is shown today.
- Project deep links require the selected Business unless the Project is an explicit
  shared Portfolio Space resource.

## API reference

The current API route inventory is maintained in
[`appendices/A-api-spec.md`](appendices/A-api-spec.md). Credential login and logout
are `/api/auth/login` and `/api/auth/logout`; protected entry routes consume the
signed session through the provider-neutral `SessionPort`. The entry routing
contract still uses `/api/entry` and does not accept client-supplied identity.
ADR-027's Profile/Workspace entry data and invitation mutations are implemented
at `/api/workspace-invites` (FR-067); the owner roster behind Workspace Home reads
`GET /api/workspace-memberships` (FR-067). The Market Intelligence dashboard reads
translated observations from `GET /api/market/observations` (FR-092, GET only).
The CRM Inbox thread header reaches PDPA erasure through
`POST /api/crm/customers/[customerId]/erasure` (FR-022, owner-only, typed confirmation).
`/platform/users` owns `POST /api/platform/users/memberships` (FR-038, attach an
existing Person) and the `GET`/`POST`/`DELETE` family of `/api/platform/api-access-keys`
(FR-106). Since 2026-09-02 the crm, market and people API families also enforce the
per-Business domain grant server-side (FR-061): a Membership without the domain
receives `404 Business not found`, the same answer as an unknown Business.

## Evidence and drift rule

This file is a human-readable route map. The generated document graph and preflight
remain the machine checks:

```text
npm run docs:graph
npm run docs:preflight
npm run docs:check
```
