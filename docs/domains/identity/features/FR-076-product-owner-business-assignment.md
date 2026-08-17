---
domain: identity
feature: FR-076
module: identity
source: v2-native
version: "0.4.0b"
created_at: "2026-08-18T05:05:12+07:00,ATHER"
last_update: "2026-08-18T06:19:39+07:00,ATHER"
status: "candidate"
---

# FR-076 — Product Owner Business role binding

## Intent

Represent Product Owner as a generic RBAC role that a Person may hold for one
or more Businesses inside a customer Tenant. Product Owner is a
Business-scoped responsibility, not Business Owner, Tenant Owner, Workspace
Owner or Zuri Platform Owner.

## Customer scope example

```text
Wannapa Workspace
  └── TNT-EtohGroup
        ├── SmartGift
        ├── Etoh-Muku
        ├── Mujeen
        └── EMC
```

The bootstrap and verified remote identity map are recorded by the migration
mission manifest. The local candidate Tenant UUID remains bootstrap evidence;
the remote migration preserved the existing Tenant/SmartGift UUIDs and added
the three missing Business rows.

## Contract

### RoleBinding

The generic Business-scoped role relation has these fields:

| Field | Rule |
|---|---|
| `personId` | Trusted Person/Profile receiving the role |
| `tenantId` | Tenant containing the Business; must match ancestry |
| `businessId` | One explicitly scoped Business; required in this v1 binding |
| `roleKey` | Registered RBAC role; `PRODUCT_OWNER` for this feature |
| `scopeType` | `BUSINESS` |
| `status` | `ACTIVE`, `SUSPENDED` or `REVOKED` |
| `assignedBy` | Server-resolved assigning principal |
| `version` | Optimistic/lifecycle version counter |
| timestamps | Created, updated and revoked/changed timestamps as applicable |

The relation is many-to-many: one Product Owner may cover multiple Businesses,
and one Business may have multiple Product Owners. Each Business requires its
own binding row. Revoking one row does not revoke another Business binding.

### Role and permission registry

`PRODUCT_OWNER` is a role key, not a database table. The server registry maps it
to the current Product permissions:

```text
PRODUCT_OWNER
  → product.read
  → product.plan.write
  → product.decision.write
  → product.work.write
```

The registry is the only source for permission expansion. Adding another role
or operating lane requires a separate permission decision; a Product Owner
binding cannot grant it implicitly.

## Implemented local contract slice

The approved local slice provides:

- the generic `RoleBinding` Prisma model and additive local migration artifact;
- role registry and permission evaluation by selected Business;
- role-binding assignment/reactivation, suspension and revocation with
  Business Owner authorization, ancestry validation and redacted audit events;
- additive `resolveViewer` fields `rolesByBusinessId` and
  `permissionsByBusinessId`;
- a compatibility seam for existing Product Owner service callers that writes
  the generic `RoleBinding` model.

This is local RBAC contract evidence. It does not authorize a production write,
customer data import, LINE/API replay or Supabase cutover. The separate
approved migration mission owns the bounded SmartGift product projection write.

## Relationship to existing Membership

`Membership` remains the employment and Tenant/Business visibility relation.
A tenant employee may have a tenant-wide Membership (`businessId = null`) or an
explicit Business Membership. That row alone does not make the person a
Product Owner.

`RoleBinding.roleKey = PRODUCT_OWNER` is the explicit Product responsibility
grant. It must not be encoded by changing `Membership.role = OWNER`, because
that would grant existing Business-owner semantics. It must also not be
encoded by a platform `DEV` grant.

## Permission boundary

| Capability | Product Owner binding for selected Business | Requires separate grant |
|---|---:|---:|
| Product planning, decisions and Product work views | allow | — |
| View permitted Product evidence for that Business | allow | — |
| Work across two assigned Businesses | allow, per binding | — |
| Add/remove people or edit Memberships | deny | Business/Tenant owner authority |
| Manage resources, Operations or HR | deny | corresponding domain assignment |
| Manage Marketing or Campaigns | deny | Marketing assignment |
| Manage Integrations, secrets or LINE activation | deny | Platform/Integration contract |
| Import customer data or migrate Supabase rows | deny | approved import/operator authority |
| Access an unassigned Business | deny | separate active RoleBinding |

Product Owner collaborates with the other operating lanes; collaboration does
not grant their permissions.

## Trusted viewer contract

The server resolves active `RoleBinding` rows from trusted session identity and
the persisted Business ancestry before returning scoped data:

```js
{
  rolesByBusinessId: {
    '<business-id>': ['PRODUCT_OWNER'],
  },
  permissionsByBusinessId: {
    '<business-id>': [
      'product.read',
      'product.plan.write',
      'product.decision.write',
      'product.work.write',
    ],
  },
}
```

Consumers must evaluate the selected `businessId`. They must not infer Product
authority from a global role, `isPlatform`, Portfolio ancestry, Tenant
membership, `visibleBusinessIds`, `visibleDomains` or a client-supplied role.

## Acceptance criteria

### AC-076.1 — Customer hierarchy

The scope resolver can represent one customer Portfolio/Workspace, one
`TNT-EtohGroup` Tenant/Organization and four child Businesses without using a
Zuri-owned Portfolio as the customer Workspace.

### AC-076.2 — Generic role binding

Product capability is granted only by an active `RoleBinding` with
`roleKey=PRODUCT_OWNER`, `scopeType=BUSINESS`, and matching Tenant/Business
ancestry.

### AC-076.3 — Multi-Business coverage

One Person can hold active Product Owner bindings for two or more Businesses;
listing, suspending or revoking one binding does not change another.

### AC-076.4 — Business isolation

A Product Owner assigned to SmartGift cannot read or mutate Product-scoped data
for Etoh-Muku, Mujeen or EMC without another active binding.

### AC-076.5 — Product-only permissions

The role does not grant Membership administration, resources/Operations, HR,
Marketing, Platform, Integration, secret, LINE or import authority.

### AC-076.6 — No owner escalation

Product Owner is never interpreted as `Membership.role = OWNER`, Tenant Owner,
Workspace Owner or platform `DEV`.

### AC-076.7 — Revocation

Suspending or revoking a binding prevents the next protected Product read or
mutation; stale client state cannot preserve access.

### AC-076.8 — Audit

Create, reactivate, suspend and revoke operations record the resolved actor,
Tenant, Business, role key and resulting status without secrets or unnecessary
customer content.

### AC-076.9 — Import boundary

Product Owner authority alone cannot import customer data or change Supabase
Tenant/Business scope. Import remains governed by its own approved operator and
Business authorization contract.

### AC-076.10 — Fail closed

Missing Person, invalid Tenant/Business ancestry, unknown role, inactive
Business, revoked binding or unresolved permission returns no Product authority.

## Dependencies

- [ADR-033 — Customer scope and Product Owner authority](../../../decisions/ADR-033-CUSTOMER-SCOPE-AND-PRODUCT-OWNER-AUTHORITY.md)
- [FR-031 — Viewer gate](FR-031-viewer-gate.md)
- [FR-061 — Per-Business domain visibility](FR-061-per-business-domain-visibility.md)
- [FR-062 — Users & Permissions read scope](FR-062-permissions-read-scope.md)
- [FR-067 — Workspace invitation and scoped membership](FR-067-workspace-invitation-and-scoped-membership.md)
- [FR-071 — Supabase data pipeline monitor and replay](../../knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md)
- [FR-078 — Customer data backfill contract](../../crm/features/FR-078-customer-data-backfill-contract.md)
- [BR-001 — Tenant is the isolation boundary](../../../PRD-SDD-v1.0.md)

## Out of scope

- Implementing a role-management API or UI.
- Choosing or changing remote Supabase UUIDs outside the migration mission.
- Owning or authorizing the customer identity migration to Supabase.
- Defining Resource/Operations, Marketing or other non-Product role permissions.
- Treating Product Owner as a generic manager role with cross-Business authority.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.4.0b | 2026-08-18 | candidate | Record verified remote identity mapping while keeping Product Owner RBAC separate from migration authority | working-tree | ATHER |
| 0.3.0b | 2026-08-18 | candidate | Replace ProductOwnerAssignment with generic Business-scoped RoleBinding and registry-derived permissions | working-tree | ATHER |
| 0.2.0b | 2026-08-18 | candidate | Add local Product Owner assignment contract and lifecycle evidence | working-tree | ATHER |
