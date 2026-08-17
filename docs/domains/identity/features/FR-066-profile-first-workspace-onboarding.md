---
domain: identity
feature: FR-066
module: identity
source: v2-native
---

# FR-066 — Profile-first Workspace onboarding

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Design approved — implementation pending |
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

## Non-goals

- choosing a real authentication provider;
- creating a Personal Space automatically for every Profile;
- changing Project ownership or the seven execution modes;
- implementing the route or database changes in this documentation slice.

