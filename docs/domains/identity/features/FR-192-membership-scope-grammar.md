---
domain: identity
feature: FR-192
module: identity
source: v2-native
---

# FR-192 — Membership scope grammar and referential invariants

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Declared (2026-09-12) — implemented by [ADR-077](../../../decisions/ADR-077-MEMBERSHIP-IS-A-GRANT-WITH-A-LIFECYCLE.md) D3/D4/D5 |
| **Date** | 2026-09-12 |
| **Relates to** | ADR-077, ADR-018, ADR-027 (§D8.2), ADR-033 (D3), FR-061, FR-074, FR-191, BR-001, BR-020, BR-033, SEC-001, SEC-008, SDD-034, SDD-092 |

## Intent

The scope of a grant is a **declared value**. It is never the meaning of a null,
and no database side effect may change it.

## What null meant

`Membership.businessId IS NULL` meant *every Business in this Tenant* to
`buildDomainsByBusiness`, and meant *refuse* to `assertMembershipBusinessOwned`,
which fails closed on it. One layer honoured a wildcard the other could not see,
so the broadest grant in the system was also the only one no screen could
administer. Production holds three such rows, one of them the OWNER grant over
the customer's entire group.

`scopeType` makes the intent legible:

```prisma
scopeType  String   // TENANT | BUSINESS
businessId String?
```

```sql
CHECK (("scopeType" = 'TENANT'   AND "businessId" IS NULL)
    OR ("scopeType" = 'BUSINESS' AND "businessId" IS NOT NULL))
```

The resolver's behaviour does not change — it reads `scopeType === 'TENANT'`
where it read `!businessId`. What changes is that the permission surface can now
see which kind of grant it is holding, and gate a tenant-wide one on
`ownsTenant` instead of failing closed. `ownsTenant` already existed in
`viewer-authority.js` and was already used by `scope-service` and
`api-access-auth`; only this surface never called it.

`RoleBinding` takes the same grammar (`TENANT | BUSINESS | BRANCH`), extending
ADR-033 D3 rather than superseding it. No `TENANT` binding resolves until the
resolver is taught to expand one, so the column is additive on its own.

## What deletion did

```sql
-- before
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL
```

The null this writes is not an absence. It is the wildcard above. So deleting a
single Business promoted every member of it to the whole Tenant, and every owner
of it to `ownsTenant` — which FR-074(b) makes the authority to create more
Businesses.

```
before   MEMBER of Business A     sees A
after    businessId = NULL        sees A, B, C, D

before   OWNER  of Business A     owns A
after    businessId = NULL        owns the Tenant
```

`ON DELETE RESTRICT` replaces it, and replaces it on `Workspace.businessId` and
`Project.businessId` for the reason ADR-027 §D8.2 already gives about a Space
that loses its Business. Deleting a Business now requires withdrawing its grants
first — possible for the first time, because [FR-191](FR-191-access-grant-lifecycle.md)
built the withdrawal.

## Invariants the database now holds

Three of these were conventions re-checked in application code at every read,
which ADR-018's context recorded as debt in August 2026.

| Invariant | Mechanism | Replaced |
|---|---|---|
| a grant's Business belongs to its Tenant | `Business UNIQUE (id, tenantId)` + composite FK from `Membership`, `RoleBinding`, `Branch` | `business.tenantId === binding.tenantId` checked per read |
| one live grant per person per scope | two partial unique indexes, `WHERE status <> 'REVOKED'` | `findFirst` before `create` — a check, not a constraint, under READ COMMITTED |
| scope shape is coherent | `CHECK` above | nothing |
| status is from the declared vocabulary | `CHECK (status IN (…))` | nothing — the column was a free string |
| a parent cannot reshape a grant | `ON DELETE RESTRICT` | nothing |

```sql
CREATE UNIQUE INDEX "Membership_person_tenant_scope_key"
  ON "Membership" ("personId","tenantId")
  WHERE "scopeType" = 'TENANT' AND status <> 'REVOKED';

CREATE UNIQUE INDEX "Membership_person_business_scope_key"
  ON "Membership" ("personId","businessId")
  WHERE "scopeType" = 'BUSINESS' AND status <> 'REVOKED';
```

Excluding `REVOKED` is what lets a revoked grant stay as evidence while the same
person is granted the same scope again later, as a new row with its own
provenance.

## `role` defaults to `MEMBER`

The column defaulted to `OWNER` at the database level under no decision any ADR
records. Every current writer passes a role explicitly, so the change is inert
for them. What it removes is the outcome where an INSERT that omits the
column — a migration, a seed, a `psql` session — mints an owner. Default deny is
the only defensible default for an authority column.

## Migration preconditions

Verified against production on 2026-09-12 and **re-run at apply time**, because
rows can be written between the check and the apply:

| Check | Value on 2026-09-12 |
|---|---|
| duplicate live grants per (person, scope) | 0 |
| `Membership` rows whose Business is in another Tenant | 0 |
| `Membership.status` values outside the vocabulary | 0 — all twelve `ACTIVE` |
| `Membership.role` values outside `OWNER`/`MEMBER` | 0 |
| `Person` rows sharing a lowercased email | 0 |
| `domainKeysJson` entries not in the domain registry | 1 row — `["crm"]` |

`scopeType` is derivable for every existing row (`businessId IS NULL` →
`TENANT`), so the backfill needs no judgement. The `["crm"]` row does: `crm` is
a `DOMAIN_GROUPS` key, not a grantable domain, and resolves to zero domains
today without reporting anything. The migration repairs it to the
owner-confirmed value, or to `[]` if unconfirmed, and records a
`MEMBERSHIP/DOMAIN_KEYS_REPAIRED` event either way.

## Acceptance

| id | Statement |
|---|---|
| AC-192.1 | A `Membership` with `scopeType = 'TENANT'` and a non-null `businessId` is rejected by the database |
| AC-192.2 | A `Membership` with `scopeType = 'BUSINESS'` and a null `businessId` is rejected by the database |
| AC-192.3 | `resolveViewer` grants the same scopes before and after the migration for every production row |
| AC-192.4 | Deleting a `Business` that has any `Membership` fails; deleting it after every grant is revoked succeeds |
| AC-192.5 | A second live grant for the same (person, Business) is rejected by the index, not only by application code |
| AC-192.6 | A `Membership` whose `businessId` belongs to another Tenant cannot be inserted |
| AC-192.7 | A tenant-wide grant is administrable by a tenant owner through the permissions surface and refused to a business owner |
| AC-192.8 | An INSERT that omits `role` yields `MEMBER` |
