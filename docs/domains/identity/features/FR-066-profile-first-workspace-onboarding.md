---
domain: identity
feature: FR-066
module: identity
source: v2-native
---

# FR-066 — Profile-first Workspace onboarding

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | ✅ Implemented (2026-08-26) — `onboarding-service.js`, `/api/onboarding/*`, `/onboarding/profile`, `/waiting-room`, `/workspace-home` (D8's provisional `/workspaces` path is occupied by the PM Space compatibility page; its move to `/spaces` is a separate slice) |
| **Date** | 2026-08-17 |
| **Relates to** | [ADR-027](../../../decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md), FR-038, FR-044, FR-046, SDD-038 |

## Intent

The first-run experience must identify the person before asking for an operating
scope. A new member can complete a Profile and remain in a Waiting Room without
creating an Organization, Tenant, Business, Space, or Project.

`Profile` is the user-facing completion step over `Person`. It is not an access
grant and is not a replacement name for Workspace.

## Target journey

```text
Landing → local identity/session → Profile setup
  ├─ no Business access → Waiting Room
  ├─ Workspace membership → Workspace Home
  └─ Business membership → Business Routing → BusinessShell
```

Owner onboarding may continue from Profile to create a top-level Workspace. The
owner may add Organization/Tenant, Business, Space and Project only when the
operational context exists; those objects are not mandatory first-run fields.

## Acceptance criteria

- **AC-066.1** A new person is routed to Profile setup before any Business or
  Project creation prompt.
- **AC-066.2** A Profile-only member can enter Waiting Room with zero Tenant,
  Business, Space and Project records created by onboarding.
- **AC-066.3** Waiting Room lists only the current person's pending invitations
  and joined Workspaces; it does not expose broad scope inventory.
- **AC-066.4** A Profile or Workspace membership alone cannot mount
  BusinessShell or reveal Business-bound domains.
- **AC-066.5** An owner can continue from Profile to create a Workspace without
  being forced through Business or Project creation.
- **AC-066.6** A user can later continue from Workspace Home to an authorized
  Business Routing surface without changing the Profile identity.
- **AC-066.7** The no-external-provider mode still uses a server-owned identity
  and trusted session; browser-local labels are never authorization input.

Space is removed from the path the user walks (ADR-027 §D2) but stays required in
the model, so the next three criteria are what stop that from failing at first
use (ADR-027 §D8):

- **AC-066.8** Creating a Business creates a **Default Space** for it in the same
  transaction, with `scopeType: 'BUSINESS'` and that Business's `businessId` set.
  `Project.workspaceId` is a required column, so a Business whose owner was never
  asked to create a Space must still have one to create a Project into.
- **AC-066.9** A Default Space is never created with a null `businessId`.
  Authorization for Project work reads `workspace.businessId` — team management,
  FR-065 import, and `resolveProjectBusinessId` all do — so a Business-less
  Default Space would present a working product that silently refuses every
  write.
- **AC-066.10** Onboarding may create the Organization/Tenant implicitly so the
  user never sees that step, and never attaches a Business to a Workspace without
  one. `Business.tenantId` is required and Tenant is the BR-001 isolation
  boundary; skipping it in the interface is a simplification, skipping it in the
  data is removing tenant isolation.
- **AC-066.11** Project creation from onboarding names a Business and a Project
  only. No screen in the first-run path asks the user to pick, name or create a
  Space.

## Non-goals

- choosing a real authentication provider;
- creating a Personal Space automatically for every Profile;
- changing Project ownership or the seven execution modes;
- ~~implementing the route or database changes in this documentation slice~~
  (that later slice is now this one — implemented 2026-08-26).

