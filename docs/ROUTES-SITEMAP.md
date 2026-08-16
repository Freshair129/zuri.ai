# Zuri — Route and Shell Sitemap

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | draft |
| **Date** | 2026-08-17 |
| **Authority** 

## Entry and shell journey

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

## Logical layout boundaries

```text
Root Provider Layout
├── EntryShell
│   ├── /
│   └── /login
├── BusinessRoutingShell
│   └── /businesses
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
- Missing viewer → `/login`.
- Missing Business → `/businesses`.
- Unauthorized Business/domain → explicit forbidden state or Business Overview.
- Project deep links require the selected Business unless the Project is an explicit
  shared Portfolio Space resource.

## API reference

The current API route inventory is maintained in
[`appendices/A-api-spec.md`](appendices/A-api-spec.md). It contains 43 route handlers;
FR-044 adds no login endpoint. The entry routing contract reuses `/api/viewer` and
`/api/scope` until production authentication introduces a viewer-scoped session
interface.

## Evidence and drift rule

This file is a human-readable route map. The generated document graph and preflight
remain the machine checks:

```text
npm run docs:graph
npm run docs:preflight
npm run docs:check
```
