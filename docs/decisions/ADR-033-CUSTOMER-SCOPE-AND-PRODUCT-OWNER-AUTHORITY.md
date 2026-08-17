---
version: "0.1.0b"
created_at: "2026-08-18T05:05:12+07:00,ATHER"
last_update: "2026-08-18T05:05:12+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "architecture-decision"
  scope: "Wannapa Workspace, TNT-EtohGroup and Product Owner business authority"
---

# ADR-033 — Customer scope and Product Owner authority

**Status:** Candidate — documentation approval required; no schema, code or live
database mutation is claimed

## Context

The existing graph already has an authoritative generic scope model:

- [ADR-011](ADR-011-CONTEXT-BAR-AND-BUSINESS-SCOPE-CEILING.md) defines the
  `Workspace > Organization > Business` context bar.
- [ADR-027](ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md) defines the
  distinction between Profile, WorkspaceMembership and Tenant/Business
  Membership.
- [`zuri_workspace_system.md`](../zuri_workspace_system.md) defines
  `Portfolio → Tenant → Business` as the product hierarchy and keeps schema
  `Workspace` as the lower Project Manager **Space**.
- [FR-061](../domains/identity/features/FR-061-per-business-domain-visibility.md)
  defines per-Business domain visibility.
- [FR-062](../domains/identity/features/FR-062-permissions-read-scope.md)
  defines the read boundary for permission administration.

Those documents do not define the customer's actual four-Business structure or
the Product Owner responsibility described by the owner. Reusing `OWNER` for
that responsibility would grant Business ownership, which is broader than the
intended product-only role.

The current [ADR-018](ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md) reserves
`PF-ZURI-OWNER → TNT-SMARTGIFT → BUS-SMARTGIFT` for the Phase 1 pilot. That
reservation is retained as historical/bootstrap evidence until a separately
approved identity reconciliation supersedes it; it is not treated here as the
customer's canonical Workspace.

## Decisions

### D1 — Customer hierarchy

The customer-facing hierarchy is:

```text
Wannapa Workspace                 = UI Workspace / schema Portfolio
  └── TNT-EtohGroup               = UI Organization / schema Tenant
        ├── SmartGift             = Business
        ├── Etoh-Muku             = Business
        ├── Mujeen                = Business
        └── EMC                   = Business
```

The display name **Wannapa Workspace** is customer-owned. The canonical
Portfolio code and internal UUID remain pending identity reconciliation and
must not be invented from `PF-ZURI-OWNER`.

`TNT-EtohGroup` is one Tenant containing four Businesses. A Business may not be
attached directly to the Portfolio; `Business.tenantId` remains required and
continues to be the isolation ancestry.

The following are customer labels, not yet approved replacement UUIDs:

| Business display name | Candidate human code | Role in this contract |
|---|---|---|
| SmartGift | `BUS-SMARTGIFT` | First Business in the customer Tenant |
| Etoh-Muku | `BUS-ETOH-MUKU` | Second Business |
| Mujeen | `BUS-MUJEEN` | Third Business |
| EMC | `BUS-EMC` | Fourth Business |

### D2 — Authority layers remain separate

| Actor or relation | Scope | Grants | Does not grant |
|---|---|---|---|
| Platform Owner | Zuri platform | platform administration when explicitly granted | ownership of the customer's Workspace, Tenant or Business |
| WorkspaceMembership | customer Portfolio / Workspace | collaboration visibility at the top-level Workspace | Tenant, Business, Product, Resource, Marketing or Project authority |
| Tenant employee Membership | `TNT-EtohGroup` | employment/tenant membership as explicitly assigned | Business ownership or Product Owner capability by itself |
| Business Owner Membership | one `Business` | Business ownership and the existing owner-governed operations | ownership of other Businesses |
| ProductOwnerAssignment | one or more assigned Businesses | Product capability only for those Businesses | Tenant ownership, Business ownership, resource/operations or marketing authority |

Platform identity and customer employment may coexist on one `Person`, but the
platform relation must never be used as a shortcut for customer ownership.

### D3 — Product Owner is a Business-scoped assignment

Product Owner is a responsibility assignment, not a replacement for
`Membership.role` and not a global principal role. The logical contract is:

```text
ProductOwnerAssignment
  personId
  tenantId
  businessId
  capability = PRODUCT
  status = ACTIVE | SUSPENDED | REVOKED
  assignedBy
  createdAt
  updatedAt
```

Cardinality is many-to-many:

- one Person may be assigned to multiple Businesses;
- one Business may have multiple Product Owners;
- every assignment is explicitly Business-scoped;
- revoking one assignment does not revoke the person's other Business
  assignments.

The persisted schema shape, API and UI are downstream implementation work under
[FR-076](../domains/identity/features/FR-076-product-owner-business-assignment.md).

### D4 — Product-only capability boundary

Product Owner may work on the Product responsibility lane for assigned
Businesses and collaborate with the other operating lanes. The assignment does
not automatically include:

- people, membership or resource administration;
- Operations or other resource-management authority;
- Marketing or Campaign authority;
- Platform administration;
- Tenant/Business ownership;
- customer-data import, Supabase migration, LINE binding or secret management.

If one person needs another responsibility, it requires a separate explicit
assignment and audit trail. Collaboration with another lane is not inheritance
of that lane's permissions.

### D5 — Trusted authorization contract

The server resolves Product Owner assignments from the trusted Person/session
and persisted assignment authority. Client-supplied `tenantId`, `businessId`,
role labels or platform claims are never authorization inputs.

The future viewer/read contract must expose the answer per Business, for example:

```text
productOwnerBusinessIds: string[]
productCapabilitiesByBusinessId: { [businessId]: ["PRODUCT"] }
```

Consumers must ask for the capability for the selected Business. They may not
infer Product Owner authority from:

- the global `OWNER` label;
- `isPlatform` / `DEV`;
- WorkspaceMembership;
- Portfolio or Tenant ancestry;
- the union `visibleDomains` field;
- visibility without an explicit Product Owner assignment.

Existing FR-061 per-Business domain visibility remains valid. This ADR adds a
responsibility relation; it does not broaden `domainsByBusinessId` or change the
meaning of Business ownership.

### D6 — Customer identity reconciliation precedes import

No customer data import or production re-parenting is authorized by this ADR.
Before the SmartGift backfill uses the customer hierarchy, an approved
identity map must bind:

```text
customer Portfolio / Workspace
  → TNT-EtohGroup Tenant / Organization
    → four Business UUIDs
```

The SmartGift knowledge target uses the resolved `tenant_id` and
`business_id`. Portfolio ancestry is context and lineage; it is not a substitute
for Business-scoped data authorization.

The existing `PF-ZURI-OWNER` and `TNT-SMARTGIFT` pilot identities must not be
renamed or re-parented in place without a migration map, foreign-key inventory,
artifact/hash reconciliation, rollback point and fresh post-apply evidence.

## Acceptance gates

This decision is not ready for implementation until all of the following are
approved:

1. Canonical Portfolio code/UUID and display name for **Wannapa Workspace**.
2. Canonical Tenant code/UUID for **TNT-EtohGroup**.
3. Canonical UUID/code mapping for all four Businesses.
4. Product capability catalog and the boundary between Product, Resource/
   Operations and Marketing lanes.
5. Product Owner assignment lifecycle, revocation and audit actor rules.
6. Viewer/API contract for per-Business Product capability.
7. Migration and rollback mapping from the Phase 1 pilot identities.

## Non-goals

- Changing existing UUIDs or applied migrations in this documentation slice.
- Treating Product Owner as `OWNER`, `DEV`, Tenant Owner or Workspace Owner.
- Implementing a new role-management UI or database model in this ADR.
- Authorizing customer import from Portfolio or Workspace membership.
- Defining the three operating lanes beyond the Product-only boundary; their
  individual permissions require their own contracts.

## Related documents

- [ADR-011 — Context bar and Business scope ceiling](ADR-011-CONTEXT-BAR-AND-BUSINESS-SCOPE-CEILING.md)
- [ADR-018 — Supabase production tenant isolation](ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md)
- [ADR-027 — Profile-first and Workspace-first onboarding](ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md)
- [FR-061 — Per-Business domain visibility](../domains/identity/features/FR-061-per-business-domain-visibility.md)
- [FR-062 — Users & Permissions read scope](../domains/identity/features/FR-062-permissions-read-scope.md)
- [FR-067 — Workspace invitation and scoped membership](../domains/identity/features/FR-067-workspace-invitation-and-scoped-membership.md)
- [FR-076 — Product Owner Business assignment](../domains/identity/features/FR-076-product-owner-business-assignment.md)
- [`zuri_workspace_system.md`](../zuri_workspace_system.md)

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | candidate | Define customer-owned Workspace/Tenant hierarchy and Product Owner's Business-scoped product-only authority | working-tree | ATHER |
