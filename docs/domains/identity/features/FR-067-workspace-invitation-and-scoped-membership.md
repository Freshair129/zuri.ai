---
domain: identity
feature: FR-067
module: identity
source: v2-native
---

# FR-067 — Workspace invitation and scoped membership

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Design approved — implementation pending |
| **Date** | 2026-08-17 |
| **Relates to** | [ADR-027](../../../decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md), FR-031, FR-036, FR-038, FR-046, FR-065, SDD-015, SDD-037, SDD-038, BR-016, SEC-003, SEC-014 |

## Intent

A Tenant Owner or Workspace Owner must be able to invite a Profile into a
Workspace without granting Tenant, Business, Space or Project authority. The
existing Tenant/Business `Membership` contract remains the source of business
scope; Workspace collaboration is represented separately.

## Target contract

```text
WorkspaceInvite
  → one-use acceptance
  → WorkspaceMembership(ACTIVE)
  → explicit Tenant/Business/Space/Project assignment
```

The server decides the target Workspace, inviter authority, role, expiry and
resulting access. The client cannot submit a role or principal claim that widens
the grant.

## Which "Workspace" — the key, not the label

**`WorkspaceMembership` binds to `portfolioId`.** The word *Workspace* denotes two
different levels of the scope chain in this repository, and only one of them is
meant here:

| Reading | Key | Is it this one? |
|---|---|---|
| Top-level collaboration container, displayed as **Workspace** | `portfolioId` (schema `Portfolio`) | **Yes** — ADR-027 §D2 |
| Project Manager working context, displayed as **Space** | `workspaceId` (schema `Workspace`) | No |

ADR-027 §D2 settles this and keeps `portfolioId` as the internal identity; it is
restated here because this file is what an implementer reads, and the schema
really does contain a `Workspace` model that is **not** the thing this
requirement is about. Binding `WorkspaceMembership` to `workspaceId` would grant
membership one level below the intended one — a different authorization boundary
wearing the same word.

That failure mode is not hypothetical here: a value meaning one thing at one
level and another at the level below is this repository's most repeated defect,
and `role` — global label versus per-Business authority — produced three
privilege escalations before it was closed
(`.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md`). The
label may move freely; the key never does (AGENTS.md §18).

## Relationship to FR-065 — this creates the authority FR-065 refuses for

FR-065 refuses an import whose target Workspace sits above Business, and SDD-037
justifies that refusal on a **verified** premise: *no principal can hold portfolio
or tenant authority today* — `Membership` is created in exactly two code paths and
both bind `businessId`, and the viewer contract exposes only Business-keyed
grants. FR-065's own text names the exit: "a prior FR that makes portfolio/tenant
authority *holdable*: a viewer-contract change in the manner of FR-061".

**FR-067 is that FR.** The ordering is correct, not contradictory — but the two
must be read together, because implementing this one falsifies the premise the
other one's refusal rests on. Two consequences to settle *before* code:

1. **The question FR-067 currently leaves open.** A principal holding a
   WorkspaceMembership on Portfolio *P*: may they import into a Space
   (schema `Workspace`) whose `scopeType` is `PORTFOLIO` and whose `portfolioId`
   is *P*? Non-goal 1 rules out using Workspace membership as Business
   authorization, and AC-067.4 denies hidden Business/Project data — neither
   speaks to a Space scoped at portfolio level, which is exactly FR-065's case.
   Until that is answered, FR-065's refusal stands unchanged.
2. **Revisit FR-065 clause (b) when this lands, deliberately.** Either the
   refusal keeps its reason and SDD-037's premise is amended to say the authority
   exists but does not extend to import, or import above Business becomes
   governed — through the viewer contract, never by relaxing the guard.

The collision above is what makes this easy to miss: FR-065 says "a Workspace
above Business" (schema `Workspace` = Space) and FR-067 says "Workspace"
(`Portfolio`). Same word, different levels, opposite directions of the scope
chain.

## Acceptance criteria

- **AC-067.1** An authorized owner can issue an invite bound to exactly one
  Workspace with an expiry and server-stored token hash.
- **AC-067.2** An invite can be accepted only once, by the intended or
  server-resolved Profile, and replay/expired/revoked tokens fail closed.
- **AC-067.3** Acceptance creates an audited WorkspaceMembership with a
  server-decided role and status.
- **AC-067.4** Workspace membership alone returns no hidden Business, Project,
  file, domain or Tenant data.
- **AC-067.5** Tenant/Business/Space/Project assignment is a separate audited
  mutation and requires the relevant owner authority.
- **AC-067.6** A Workspace Member cannot self-promote, invite outside the
  authorized Workspace, or edit another person's Tenant/Business Membership.
- **AC-067.7** Workspace membership removal or Profile/session revocation
  prevents the next protected read and does not rely on stale client state.
- **AC-067.8** All invitation and membership mutations preserve tenant
  isolation and append immutable AuditEvents.

## Non-goals

- using Workspace membership as a replacement for Business authorization;
- automatically assigning every invited person to every Business;
- external OAuth/OIDC/password provider selection;
- implementing a second ProjectMember persistence model in this slice.

