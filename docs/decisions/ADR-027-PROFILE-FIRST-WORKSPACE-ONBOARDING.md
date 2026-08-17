# ADR-027 — Profile-first and Workspace-first onboarding

**Status:** Accepted — design approved; implementation pending
**Date:** 2026-08-17
**Decided by:** Boss (owner approval, 2026-08-17)
**Amends:** [ADR-011](ADR-011-CONTEXT-BAR-AND-BUSINESS-SCOPE-CEILING.md) pre-shell terminology and [ADR-015](ADR-015-ENTRY-LANDING-LOGIN-AND-BUSINESS-ROUTING.md) entry sequence
**Relates to:** [ADR-014](ADR-014-PROJECT-BUSINESS-OWNERSHIP-AND-SPACE-CONTEXT.md), [ADR-017](ADR-017-PRODUCTION-VIEWER-SESSION-AND-ENTRY-READ-MODEL.md), FR-038, FR-044, FR-046, FR-066, FR-067, SDD-038, BR-016, SEC-014

## Context

The implemented FR-044 journey sends a newly resolved viewer directly to
Business Routing. That works for an owner who already has a visible Business,
but it forces a new member to create or select operational data before a Tenant
Owner can invite them to work.

The product has four different concepts that must not be collapsed into one
word:

```text
Profile       = who the person is
Workspace     = the shared top-level collaboration container
Organization  = Tenant, the isolation boundary
Business      = the operating business
Space         = schema Workspace, the Project Manager working context
Project       = an execution resource owned by a Business
```

The current schema already has `Person`, `Portfolio`, `Tenant`, `Business` and
schema `Workspace`. It does not yet have a Workspace-level membership or invite
contract. Existing `Membership` is Tenant/Business-oriented and must not be
quietly widened to represent a waiting member or a top-level Workspace grant.

## Decision

### D1 — Profile is the first user-facing setup step

Every new person begins by completing a Profile after the local identity/session
has been established. Profile is a presentation and identity record over the
existing `Person`; it is not a Tenant, Business, Workspace, or authorization
grant.

The UI label is **ตั้งค่าโปรไฟล์** / **Set up profile**, not “สร้าง Workspace”.
The existing authenticated `/profile` page remains the edit surface; the new
onboarding step is the completion state before a user has an operating scope.

### D2 — Workspace and Space keep separate meanings

The user-facing top-level **Workspace** continues to map to schema `Portfolio`
and keeps `portfolioId` as its internal identity. The schema `Workspace` used by
Project Manager is displayed as **Space** and remains a lower-level grouping
context for Projects.

`Organization` remains the UI label for schema `Tenant`; no second
`organizationId` is introduced. Profile is not added to the context bar:

```text
Workspace > Organization > Business
```

is still the maximum ambient operating context after the user has access to a
Business.

### D3 — Profile-only members are a valid state

A person who is not a Tenant Owner may stop after Profile setup. They do not have
to create an Organization, Tenant, Business, Space, or Project.

The supported state machine is:

```text
NO_PROFILE
  → PROFILE_SETUP
  → PROFILE_ONLY / WAITING_ROOM
  → WORKSPACE_INVITED
  → WORKSPACE_MEMBER
  → BUSINESS_MEMBER
  → PROJECT_MEMBER
```

`PROFILE_ONLY` and `WORKSPACE_MEMBER` render a pre-Business Workspace surface;
they never enter `BusinessShell` solely because a Profile or Workspace
membership exists.

### D4 — Owner and member paths diverge after Profile

```text
Profile
├─ Member path
│  ├─ accept Workspace invite, or remain in Waiting Room
│  └─ receive Tenant/Business/Space/Project assignment later
└─ Owner path
   ├─ create Workspace
   ├─ optionally create Organization/Tenant
   ├─ create Business when needed
   ├─ create Space when Project work needs one
   └─ create Project from an objective-driven intake
```

Creating a Workspace is an owner action, not a prerequisite imposed on every
member. A private Personal Space may be introduced later as an optional scratch
area, but it is not required for onboarding and does not substitute for a
Workspace membership.

### D5 — Workspace membership is separate from Tenant/Business membership

The implementation must introduce a distinct Workspace-level collaboration
contract rather than overloading `Membership`:

```text
WorkspaceMembership
- workspaceId       // internal Portfolio/Workspace id
- personId
- role              // OWNER | ADMIN | MEMBER
- status            // ACTIVE | PENDING | REMOVED
- invitedBy
- createdAt
- updatedAt
```

Invitations are separate, single-use records with a server-stored token hash,
expiry, inviter, target Workspace, requested role, accepted time and revocation
state.

Workspace membership grants access to the Workspace collaboration surface only.
It does not grant visibility into any Tenant, Business, Space, Project, domain,
or file until a separate server-authorized assignment exists.

### D6 — Tenant Owner pulls a Profile into work through scoped invitation

The target flow is:

```text
Tenant Owner / Workspace Owner
  → issue scoped, expiring invite
Member
  → accept invite
System
  → create ACTIVE WorkspaceMembership
Owner
  → assign Tenant / Business / Space / Project access separately
```

The client cannot choose its own Workspace role, Tenant role, Business role, or
visible domains. A Workspace Owner is not automatically a Tenant Owner, and a
Tenant Owner is not automatically a Project Owner.

### D7 — Provider-neutral identity still needs a server-owned session

“ไม่ใช้ auth จริง” means no external provider is required for this slice. It does
not mean that multi-user invitations can rely on browser-local state. The
implementation must retain the provider-neutral trust boundary from ADR-017:

- a server-owned `Person` identity;
- a signed, HttpOnly local session;
- a single-use, expiring invitation token; and
- fail-closed production behavior when trusted identity/session data is absent.

Seeded-owner demo fallback remains development-only and must never authorize a
production Profile, invitation, or Workspace membership.

### D8 — Pre-shell route and shell contract

The approved next entry sequence is:

```text
Landing
  → local identity/session
  → /onboarding/profile
  → /waiting-room                 (Profile only / no invitation)
  → /workspaces                    (joined Workspace list/home)
  → /businesses                    (only when Business access exists)
  → /overview                     (guarded BusinessShell)
```

The top-level `/workspaces` surface is the collaboration Workspace backed by
`Portfolio`. The current Project Manager compatibility page that exposes schema
`Workspace` must be displayed as Space and may later move to a `/spaces` or
Business/Project-nested route; this ADR does not rename database identities.

### D9 — Audit and scope boundaries

Workspace creation, invitation issue/revoke, invitation acceptance, membership
add/remove, and Tenant/Business/Space/Project assignment are meaningful mutations
and must append immutable AuditEvents. A waiting member must not learn whether a
hidden Business or Person exists from an authorization error.

This ADR does not implement authentication, add Prisma models, change Project
ownership, or move the current FR-044 routes. Those are downstream implementation
tasks governed by FR-066/067 and SDD-038.

## Consequences

- Profile is a safe first-run completion step for both owners and members.
- A member can wait indefinitely without manufacturing Business data.
- Workspace collaboration can be granted without widening Tenant or Business
  authority.
- The current BusinessShell remains a strict operational boundary.
- The implementation will require a new Workspace membership/invite model and a
  pre-Business shell/entry read model.
- Existing FR-044 Business Routing remains a verified compatibility slice until
  the ADR-027 implementation is built and verified.

## Alternatives considered

| Option | Result |
|---|---|
| Force every user to create Workspace → Tenant → Business → Project | Rejected: blocks members and creates empty operational data |
| Call a shared team container “Profile” | Rejected: Profile is a person identity, not a collaboration boundary |
| Reuse Tenant/Business `Membership` for Workspace access | Rejected: it would widen existing viewer semantics and make waiting members appear to hold business authority |
| Require an external auth provider before documenting the flow | Rejected: provider choice is separate; a provider-neutral server-owned session is the minimum safe contract |

## Approval gate

Owner approved this documentation boundary on 2026-08-17. Implementation remains
blocked until the schema, trusted session, invitation, route guard, audit and
regression gates in FR-066/067 are delivered and verified.

