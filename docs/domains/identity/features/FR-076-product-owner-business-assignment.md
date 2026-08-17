---
domain: identity
feature: FR-076
module: identity
source: v2-native
version: "0.1.0b"
created_at: "2026-08-18T05:05:12+07:00,ATHER"
last_update: "2026-08-18T05:05:12+07:00,ATHER"
status: "candidate"
---

# FR-076 — Product Owner Business assignment

## Intent

Represent a Product Owner as a person who is responsible for the Product lane
of one or more Businesses inside a customer Tenant. Product Owner is a
Business-scoped responsibility and is not the same as Business Owner, Tenant
Owner, Workspace Owner or Zuri Platform Owner.

## Customer scope example

```text
Wannapa Workspace
  └── TNT-EtohGroup
        ├── SmartGift
        ├── Etoh-Muku
        ├── Mujeen
        └── EMC
```

The example is a target customer identity map. Internal UUIDs and the canonical
Portfolio code remain pending the identity reconciliation in ADR-033. It must
not be implemented by reusing `PF-ZURI-OWNER` as the customer Workspace.

## Contract

### ProductOwnerAssignment

The logical assignment has the following fields:

| Field | Rule |
|---|---|
| `personId` | Trusted Person/Profile being assigned |
| `tenantId` | Customer Tenant containing the Business |
| `businessId` | One explicitly assigned Business; must match `tenantId` ancestry |
| `capability` | Fixed `PRODUCT` in this feature |
| `status` | `ACTIVE`, `SUSPENDED` or `REVOKED` |
| `assignedBy` | Server-resolved assigning principal |
| timestamps | Created, updated and revoked/changed timestamps as applicable |

The relation is many-to-many: one Product Owner may cover multiple Businesses,
and one Business may have multiple Product Owners. A Business assignment does
not spill to another Business in the same Tenant.

### Relationship to existing Membership

`Membership` remains the employment and Tenant/Business scope relation. A
tenant employee may have a tenant-wide Membership (`businessId = null`) or an
explicit Business Membership, depending on the approved employment model. That
row alone does not make the person a Product Owner.

`ProductOwnerAssignment` is the explicit responsibility grant. It must not be
encoded by changing a person to `Membership.role = OWNER`, because that would
grant the existing Business-owner semantics. It must also not be encoded by a
platform `DEV` grant.

## Permission boundary

| Capability | Product Owner of assigned Business | Requires separate grant |
|---|---:|---:|
| Product planning, product decisions and Product work views | allow | — |
| View the assigned Business's permitted Product evidence | allow | — |
| Work across two assigned Businesses | allow, per assignment | — |
| Add/remove people or edit Memberships | deny | Business/Tenant owner authority |
| Manage resources, Operations or HR | deny | corresponding domain assignment |
| Manage Marketing or Campaigns | deny | Marketing assignment |
| Manage Integrations, secrets or LINE activation | deny | Platform/Integration contract |
| Import customer data or migrate Supabase rows | deny | approved import/operator authority |
| Access an unassigned Business | deny | separate assignment |

Product Owner collaborates with the other operating lanes; collaboration does
not grant their permissions.

## Trusted viewer contract

The server must resolve the assignment from trusted session identity and
persisted authority before returning Business-scoped data. A future additive
viewer contract may expose:

```js
{
  productOwnerBusinessIds: ['<business-id>'],
  productCapabilitiesByBusinessId: {
    '<business-id>': ['PRODUCT'],
  },
}
```

The exact field names are part of the implementation design and require review.
Consumers must evaluate the selected `businessId`; they must not infer Product
authority from a global role, `isPlatform`, Portfolio ancestry, Tenant
membership, `visibleBusinessIds` or the union `visibleDomains` field.

## Acceptance criteria

### AC-076.1 — Customer hierarchy

The scope resolver can represent one customer Workspace/Portfolio, one
`TNT-EtohGroup` Tenant and four child Businesses without using a Zuri-owned
Portfolio as the customer Workspace.

### AC-076.2 — Explicit assignment

Product capability is granted only by an active ProductOwnerAssignment for the
target Business and Tenant ancestry is checked server-side.

### AC-076.3 — Multi-Business coverage

One Person can hold active Product Owner assignments for two or more Businesses;
listing or revoking one assignment does not change another assignment.

### AC-076.4 — Business isolation

A Product Owner assigned to SmartGift cannot read or mutate Product-scoped data
for Etoh-Muku, Mujeen or EMC without a separate assignment.

### AC-076.5 — Product-only permissions

The assignment does not grant Membership administration, resources/Operations,
HR, Marketing, Platform, Integration, secret, LINE or import authority.

### AC-076.6 — No owner escalation

Product Owner is never interpreted as `Membership.role = OWNER`, Tenant Owner,
Workspace Owner or platform `DEV`.

### AC-076.7 — Revocation

Suspending or revoking an assignment prevents the next protected Product read
or mutation; stale client state cannot preserve access.

### AC-076.8 — Audit

Create, change, suspend and revoke operations record the resolved actor,
Tenant, Business, assignment and resulting capability without recording secrets
or unnecessary customer content.

### AC-076.9 — Import boundary

Product Owner authority alone cannot import customer data or change Supabase
Tenant/Business scope. Import remains governed by its own approved operator and
Business authorization contract.

### AC-076.10 — Fail closed

Missing Person, invalid Tenant/Business ancestry, unknown assignment, inactive
Business or unresolved capability returns no Product authority.

## Dependencies

- [ADR-033 — Customer scope and Product Owner authority](../../../decisions/ADR-033-CUSTOMER-SCOPE-AND-PRODUCT-OWNER-AUTHORITY.md)
- [FR-031 — Viewer gate](FR-031-viewer-gate.md)
- [FR-061 — Per-Business domain visibility](FR-061-per-business-domain-visibility.md)
- [FR-062 — Users & Permissions read scope](FR-062-permissions-read-scope.md)
- [FR-067 — Workspace invitation and scoped membership](FR-067-workspace-invitation-and-scoped-membership.md)
- [FR-071 — Supabase data pipeline monitor and replay](../../knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md)
- [BR-001 — Tenant is the isolation boundary](../../../PRD-SDD-v1.0.md)

## Out of scope

- Implementing the assignment table, API, UI or viewer fields.
- Choosing the canonical Portfolio UUID/code for Wannapa Workspace.
- Applying the customer identity migration to Supabase.
- Defining Resource/Operations, Marketing or other non-Product roles.
- Treating Product Owner as a generic manager role.
