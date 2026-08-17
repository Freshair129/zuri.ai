# ADR-011 — Context bar and Business scope ceiling

**Status:** Accepted
**Date:** 2026-08-13
**Decided by:** Owen (owner)
**Amends:** [ADR-008](ADR-008-BUSINESS-CENTRIC-SHELL-AND-SCOPE-LENS.md) §D3–D6 and [SITEMAP-V2](../SITEMAP-DOMAIN-NAV.md) §1–§2
**Relates to:** FR-001, FR-020, FR-033, FR-034, FR-039, FR-041, FR-042; BR-001; ADR-003, ADR-013, [ADR-027](ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md)

## Context

The shell mixed two meanings of “Workspace”: `Portfolio` is the PM-style top
container, while schema `Workspace` is a lower operating container. It also let
Workspace and Project behave like shell navigation levels. That made a Project
look like the parent of its own module sidebar.

## Decision

### D1 — Three context names only

The Base Context Bar has exactly three visual levels, in this order:

```text
Workspace name  >  Organization name  >  Business name
```

| UI label | Schema entity | Identity rule |
|---|---|---|
| Workspace | `Portfolio` | `portfolioId` remains the internal UUID |
| Organization | `Tenant` | `tenantId` remains the isolation boundary; `Tenant.code` is the human Organization ID |
| Business | `Business` | `businessId` remains the operating scope |

`Organization` is a presentation name for `Tenant`, not a second entity and not
a new `organizationId`. Legal Entity and Branch retain their financial and
operational meanings and do not appear in this navigation bar.

### D1a — Profile is identity, not context

`Profile` is the user-facing completion step over `Person`. It describes who the
person is and is not a fourth context-bar level, a Tenant, a Business, or an
authorization grant. A Profile-only member is a valid pre-shell state and does
not need to create a Business or Project before being invited to work.

### D1b — Workspace-first is a pre-shell entry rule

The top-level Workspace may exist without an Organization/Tenant, Business, Space,
or Project. The Profile-first and invitation states are defined by
[ADR-027](ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md). They extend the
pre-shell journey only; once a Business is selected, the context bar remains
exactly:

```text
Workspace > Organization > Business
```

### D2 — Business is the shell-scope ceiling

The shell may select Workspace, Organization and Business. It stops at Business.
Schema `Workspace` and `Project` can be selected or filtered inside a module page,
but are not ambient shell scope, topbar controls, breadcrumb switchers, or sidebar
parents.

> **Draft amendment (ADR-015 / FR-044):** Workspace, Organization, and Business are
> selected before the final BusinessShell is mounted. The pre-shell sequence is Landing
> → Login stub → Business Routing; the Business context bar is rendered only after a
> Business has been selected. This narrows the word “shell” here without changing the
> three context identities.

### D3 — ERP domains are Business-bound

The top navigation is the Business's ERP domain map. The existing `projects` route
key is rendered as **Development** so its resource list can be called **Projects**
without `Projects > Projects` duplication. HR / People is a peer domain with route
key `people`; it is not nested under Development.

```text
Overview | Commerce | CRM | Marketing | Operations | HR / People | Development | Platform
```

Current V2 keys remain `commerce`, `customer`, `growth`, `operations`, `projects`,
and `platform`. CRM, Marketing, and Development are display labels only; no route,
RBAC key, UUID, or database relationship changes.

### D4 — Development owns project management, not the shell

Development's sidebar contains its own capabilities:

```text
Overview | Projects | All Work | Execution | Timeline | Dependencies | Milestones | Repositories
```

HR / People's sidebar begins with a Business-scoped People Directory. Project Team
remains inside an opened Project and is not an HR substitute.

The schema `Workspace` is labelled **Space** in PM-oriented project screens and
**Operating Unit** in ERP-oriented screens. It is intentionally absent from the
sidebar. Opening a Project preserves the Development sidebar and opens only the
Project's content and tabs.

## Consequences

- No Prisma migration, relationship move, UUID rewrite, or authorization change.
- `tenantId` continues to govern cross-tenant isolation exactly as BR-001 requires.
- The PM lens changes vocabulary on selection and project screens, not the shell
  boundary.
- Breadcrumbs show the three context names and an opened resource when useful; they
  never make Space or Project a global scope switcher.
- Profile setup and Workspace waiting/invitation are pre-shell surfaces; they do
  not widen the BusinessShell ceiling or turn Workspace membership into Business
  authorization.
