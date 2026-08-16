---
domain: identity
feature: FR-062
module: identity
source: v2-native
---

# FR-062: Users & Permissions read scope

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-17 |
| **Relates to** | FR-038 (the surface), FR-059 (`ownedBusinessIds`), SDD-035, BR-001, SEC-001, SEC-003 |
| **Incident** | [.brain/rca/2026-08-17-read-scope-outran-the-write-scope.md](../../../../.brain/rca/2026-08-17-read-scope-outran-the-write-scope.md) |

## What was wrong

```js
where: { OR: [{ businessId: { in: viewer.visibleBusinessIds } }, { businessId: null }] }
```

Two defects in one line, both proven against a real database with the real
service before any of this was written. An OWNER of one Business, MEMBER of a
second, with no relationship at all to a third tenant:

```
ownedBusinessIds   : 1
visibleBusinessIds : 2
rows returned      : 4
  PER-MINE   email=per-mine@secret.example    business=BUS-MINE     tenant=MINE  editable=true
  PER-OTHER  email=per-other@secret.example   business=TENANT-WIDE  tenant=OTHER editable=false
  PER-SIDE   email=side@secret.example        business=BUS-SIDE     tenant=MINE  editable=false
  PER-MINE   email=per-mine@secret.example    business=BUS-SIDE     tenant=MINE  editable=false
```

1. **`{ businessId: null }` is unconditional.** Every tenant-wide Membership in
   every tenant is returned, with the person's name, code and **email**. Tenant
   is the isolation level of the scope chain (BR-001, SEC-001), and this crosses
   it. `PER-OTHER` above belongs to a tenant the caller has never touched.
2. **The read scope is wider than the write scope.** The list filters on
   `visibleBusinessIds`; `updateUserPermissions` authorizes on
   `ownedBusinessIds` (FR-059). Three of the four rows render a working-looking
   Save that can only ever 404.

## Decision 1 — read scope is derived from the write scope, not merely compatible with it

`listUserPermissions` filters on `ownedBusinessIds`, the same field
`assertMembershipBusinessOwned` checks. Not "also check ownership" — *the same
input*, so the two cannot drift.

This is the third time in this repository that two guards which each looked like
a scope check turned out not to compose
([incident](../../../../.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md)).
The pattern that keeps working is a single source of the answer, named for what
it decides.

## Decision 2 — tenant-wide rows are shown, read-only, and the server says so

A tenant-wide Membership can never be edited here: `businessId` is `null`, which
is never in `ownedBusinessIds`, and that fail-closed behaviour was judged correct
when instance 2 of the earlier incident was fixed. So it could simply be
excluded.

It is kept instead, scoped to tenants where the caller owns a Business, because
**a hidden grant is worse than an unmanageable one**: this is the surface where
an OWNER goes to find out who has access, and silently dropping a Membership
that confers tenant-wide access would make the page misleading in a way the
previous over-listing was not.

The row carries a server-decided `manageable: false`. The client renders it
read-only rather than deciding for itself — the same reason `ownedBusinessIds`
exists at all. Today `manageable` is false exactly for tenant-wide rows, so it
looks derivable from `businessId`; it is a statement of authority, not a shape
observation, and the client must not be in the business of inferring authority.

## Decision 3 — the response drops `Person.email`

The surface renders `displayName` and `code`. `email` was selected, serialized
and shipped to the browser without ever being displayed. Narrowing the select
costs nothing and removes personal data from a payload that had no use for it
(SEC-004/SEC-005 direction of travel).

## Also fixed here, not a behaviour change

`PermissionRow.save` had `try { … } finally { setBusy(false) }` with no `catch`.
A rejected save became an unhandled promise rejection: the button un-greyed, no
message appeared, and nothing was saved. That is why the always-404 rows above
were never noticed from the UI — the surface was incapable of reporting the
failure it was generating. A save error is now shown on the row.

## Out of scope

- Editing tenant-wide Memberships. No code path in this repository creates one;
  making them administrable needs its own FR and a decision about which principal
  may do it.
- The `ownerViewer` coarse pre-filter stays as-is: it screens out a principal who
  owns nothing anywhere, and is documented as insufficient alone.
