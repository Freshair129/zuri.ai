# Zuri Workspace System — the scope model, stated once

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Design approved — implementation pending |
| **Author** | Boss + Claude |
| **Created** | 2026-08-17 |
| **Last Updated** | 2026-08-17 |
| **Layer** | 0 — product model (above the per-module PRD/SDD) |
| **Governed by** | [ADR-027](decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md) §D2/§D8, [ADR-014](decisions/ADR-014-PROJECT-BUSINESS-OWNERSHIP-AND-SPACE-CONTEXT.md), FR-043, FR-066, FR-067, BR-001, BR-016 |

This file exists because one word was doing two jobs and one box was being
described as a level. Everything below is the corrected model. Where a statement
can be checked against the code, the check is named — a scope model that cannot
be verified is a diagram, not a contract.

---

## 1. Two lists, not one

The single most useful thing to hold onto: **the product hierarchy and the
technical grouping are different lists, and only one of them is a path a user
walks.**

### The product hierarchy — what owns what

```text
Workspace            the shared top-level collaboration container
  └─ Organization    the isolation boundary
       └─ Business   owns the work, and reports on it
            └─ Project        a goal that has to be finished
                 └─ Workstream
                      └─ Work Item
```

### Technical grouping — not a level

```text
Business
  ├─ Space: Internal      →  Project A
  └─ Space: Client Work   →  Project B
```

A **Space** is a box for organising Projects inside one Business. It owns
nothing, it reports nothing, and **it is not a step between Business and
Project.** Describing it as one is what made the model confusing, and it is why
`Workspace` looked like it meant two different things.

---

## 2. Every name, and the key underneath it

The UI name may change; the key never does. This table is the whole translation
layer — there is no other mapping to learn.

| UI name | Schema model | Key | What it is |
|---|---|---|---|
| **Workspace** | `Portfolio` | `portfolioId` | Top-level collaboration container |
| **Organization** | `Tenant` | `tenantId` | **The isolation boundary** (BR-001) |
| **Business** | `Business` | `businessId` | The operating business — owns the work |
| **Space** | `Workspace` | `workspaceId` | Optional grouping of Projects inside one Business |
| **Project** | `Project` | `projectId` | A goal that has to be finished |
| **Workstream** | `Workstream` | `workstreamId` | A part of a Project |
| **Work Item** | `WorkItem` | `workItemId` | A unit of work |

### The one trap in that table

**Schema `Workspace` is Space. It is not the top-level Workspace.**

Read the table in that direction before writing any code that says "workspace".
A membership, guard or query bound to `workspaceId` is bound to a **Space, one
level below Business** — a completely different scope from `portfolioId`. This is
why `WorkspaceMembership` binds `portfolioId` and not `workspaceId`
(ADR-027 §D5), and why FR-067 restates it where an implementer will actually be
standing.

Documents written before 2026-08-17 use "Workspace" to mean the schema model —
that is, **Space**. Read them that way.

---

## 3. Who owns a Project

Settled by ADR-014 and FR-043, and worth repeating because it is what makes Space
a grouping rather than a level:

- **`Project.businessId` is the real owner.** Reporting, roll-up and Business
  Overview all key off it.
- **`Project.workspaceId` is grouping context.** It says which box the Project
  sits in, not who owns it.

The two must agree. `resolveProjectBusinessId` in
`src/modules/project-manager/application/project-service.js` enforces it and
throws rather than guessing:

| Situation | Result |
|---|---|
| `scopeType: 'BUSINESS'` with no `businessId` | throws — "Business Space must have a Business owner" |
| `businessId` set but Space is not BUSINESS-scoped | throws — "Business-owned Project requires a BUSINESS Space" |
| Portfolio/tenant shared Space | null owner, never attributed to a Business Overview |

---

## 4. Space is hidden, never absent

This is the part that fails silently if it is treated as a UX decision alone.
Three facts, each checkable:

### 4.1 A Project cannot exist without a Space

`prisma/schema.prisma` declares `workspaceId String` — **not** `String?` — and
`zProjectInput` requires `workspaceId: z.string().min(1)`.

So the automatically created **Default Space is infrastructure, not a
convenience.** It ships in the same change that removes Space from onboarding, or
Project creation throws for every user who was told they did not need one.

### 4.2 The Default Space must be BUSINESS-scoped

Authorization for Project work is read off the **Space**, not off the Project:

| Site | Reads |
|---|---|
| `project-team-service.js` | `assertTeamReadable(workspace.businessId, viewer)` — a Space with no `businessId` makes team management read-only by design |
| `import-authorization.js` (FR-065) | `ownsBusiness(viewer, workspace.businessId)` |
| `project-service.js` | `resolveProjectBusinessId`, per the table above |

| Default Space created… | Result |
|---|---|
| per Business, `scopeType: 'BUSINESS'` + `businessId` | everything works |
| per Workspace/Portfolio, `businessId` null | **product silently read-only** — team edits refused, imports refused, Business-owned Projects rejected |

**Hiding Space is safe. Giving it no Business is not.**

### 4.3 The interface may skip Organization; the data may not

`Business.tenantId` is `String`, required. A Business always lives inside a
Tenant, and Tenant is the BR-001 isolation boundary.

Onboarding may create the Organization implicitly so the user never sees the
step. It may **never** attach a Business directly to a Workspace — that is the
boundary tenant isolation is made of.

> **The rule these three share:** a level may disappear from the interface only
> after something else guarantees it in the data. An interface that omits a
> required structure without creating it has not simplified the product; it has
> moved the failure to first use.

---

## 5. The two paths through it

### Owner

```text
Profile
  → create Workspace
  → Organization created (implicitly or explicitly)
  → create Business
  → Default Space created automatically, BUSINESS-scoped
  → create Project from an objective
```

The owner is never asked to name a Space. One exists because a Project needs one.

### Member

```text
Profile
  → join a Workspace by invitation, or wait
  → be assigned a Business
  → be assigned a Project
```

A member creates no Organization, no Business, no Space and no Project
(FR-066 AC-066.2). **Space never appears on this path at all.**

---

## 6. What a membership does and does not grant

`WorkspaceMembership` (FR-067) is **collaboration scope on the top-level
container**, keyed by `portfolioId`. It is not a business grant.

| Holding | Grants | Does not grant |
|---|---|---|
| Profile | identity | any scope at all |
| WorkspaceMembership | the Workspace collaboration surface | Organization, Business, Space, Project, domain or file access |
| Tenant/Business `Membership` | what it has always granted | Workspace collaboration |

Tenant, Business, Space and Project access is a **separate audited assignment**
requiring the relevant owner authority (FR-067 AC-067.5). Authority is assigned,
never inherited downward from the container.

Product Owner is another separate Business-scoped responsibility assignment,
not a Workspace/Tenant/Business owner and not a replacement for
`Membership.role`. One Person may hold Product Owner assignments for multiple
Businesses, but each assignment grants only the Product capability explicitly
defined by [FR-076](domains/identity/features/FR-076-product-owner-business-assignment.md)
and never inherits Resource/Operations, Marketing, Platform, Integration or
import authority. The decision and customer identity boundary are defined by
[ADR-033](decisions/ADR-033-CUSTOMER-SCOPE-AND-PRODUCT-OWNER-AUTHORITY.md).

One decided consequence, recorded so it is not re-litigated: a
`WorkspaceMembership` on a Portfolio does **not** authorize import into a Space
scoped to that Portfolio. See FR-067's "Decision" section and FR-065.

---

## 7. When you are about to write code

Four questions, in order:

1. **Which "workspace"?** `portfolioId` (top level) or `workspaceId` (Space)? If
   the sentence you are implementing came from a requirement document, resolve
   this before typing.
2. **Is this ownership or grouping?** Ownership is `businessId`. Grouping is
   `workspaceId`. Reporting keys off the first.
3. **Does this create a Project?** Then a BUSINESS-scoped Space must already
   exist, with `businessId` set.
4. **Does this authorize a write?** Then it reads `ownsBusiness(viewer,
   workspace.businessId)` — never `role`, never `visibleBusinessIds`
   (`.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md`).

---

## Related

- [ADR-027](decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md) — §D2 the two lists, §D5 the membership key, §D8 hidden-not-absent
- [ADR-014](decisions/ADR-014-PROJECT-BUSINESS-OWNERSHIP-AND-SPACE-CONTEXT.md) — Project ownership vs Space context
- FR-043 — Project owner/Space invariant
- FR-066 — profile-first onboarding, AC-066.8…11
- FR-067 — Workspace invitation and scoped membership
- FR-065 — import target authorization, and why portfolio-scoped Spaces are refused
- BR-001 — `tenant_id` is the isolation scope
