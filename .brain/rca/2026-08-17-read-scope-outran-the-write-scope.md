---
version: "0.1.0b"
created_at: "2026-08-17T05:10:00+07:00,CLAUDE"
last_update: "2026-08-17T05:10:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "identity-security"
  doc_type: "root-cause-analysis"
  scope: "an admin list scoped more widely than the write it fronts, plus a bare OR on a nullable column"
---

# Incident — a read scope wider than the write it fronts

## Summary

`GET /api/platform/users` returned Memberships from **unrelated tenants**, and
returned rows the caller could never edit while the page rendered a working Save
on all of them. A third defect — the save handler swallowing every error — is
what kept both invisible from the surface itself.

## Root cause

```js
// src/modules/identity/profile-permission-service.js
where: { OR: [{ businessId: { in: viewer.visibleBusinessIds } }, { businessId: null }] }
```

Two independent mistakes on one line.

**`{ businessId: null }` is unconditional.** It was written to mean "and also
tenant-wide Memberships", but `businessId: null` is not scoped by anything.
Tenant is the isolation level of the scope chain (BR-001, SEC-001), and a bare
`OR` on a nullable foreign key crosses it silently — the query reads perfectly
naturally and the leak is in what it *fails* to say.

**The read filters on `visibleBusinessIds`; the write authorizes on
`ownedBusinessIds`.** Those came from different work: the list predates FR-059,
which introduced `ownedBusinessIds` and moved `updateUserPermissions` onto it.
Narrowing the write without narrowing the read left the page listing rows whose
save could only 404.

## Proof

Real service, real database, one principal: OWNER of `BUS-MINE`, MEMBER of
`BUS-SIDE`, no relationship whatsoever to tenant `OTHER`.

```
ownedBusinessIds   : 1
visibleBusinessIds : 2
rows returned      : 4
  PER-MINE   email=per-mine@secret.example    business=BUS-MINE     tenant=MINE  editable=true
  PER-OTHER  email=per-other@secret.example   business=TENANT-WIDE  tenant=OTHER editable=false
  PER-SIDE   email=side@secret.example        business=BUS-SIDE     tenant=MINE  editable=false
  PER-MINE   email=per-mine@secret.example    business=BUS-SIDE     tenant=MINE  editable=false
```

One row of four is administrable. One is from a tenant the caller cannot see by
any other route, and it carries an email address the page never displays.

## Why nobody noticed

```js
const save = async () => {
  setBusy(true)
  try { await api(...); onSaved() } finally { setBusy(false) }
}
```

No `catch`. A rejected save became an unhandled promise rejection: the button
un-greyed, no message appeared, the list did not refresh, and nothing was
written. **The surface was structurally incapable of reporting the failure it
was generating** — three quarters of its rows failed on save, every time, and
the page looked fine.

This is the more useful half of the incident. The scope bug was one line; the
reason it survived was that the only observer of it had its eyes closed.

## Fix ([FR-062](../../docs/domains/identity/features/FR-062-permissions-read-scope.md))

- The list filters on `ownedBusinessIds` — the *same field* the write authorizes
  on, not a second check that happens to agree.
- Tenant-wide rows are scoped to tenants where the caller owns a Business, and
  carry a server-decided `manageable: false`. They are shown rather than dropped
  because a hidden grant is worse than an unmanageable one on the very page an
  OWNER visits to find out who has access.
- `Person.email` is no longer selected; the surface never displayed it.
- `PermissionRow.save` reports errors on the row.

## Prevention

1. **A `null` branch in an `OR` is a scope hole until proven otherwise.** A
   nullable foreign key means "belongs to a wider scope", so including it
   requires naming that wider scope explicitly. `{ businessId: null }` on its own
   never means "mine".
2. **An administration list derives its scope from the write's authority field**,
   not from a second field that currently agrees. Narrowing a write is not
   finished until the reads that front it are narrowed with it.
3. **A handler with `finally` and no `catch` is a silent failure.** It restores
   the UI to a state that looks like success. Where a `catch` is genuinely
   unnecessary, say so in a comment; absence is not a decision.
4. **Ask what the payload contains that the screen never shows.** Unused PII in a
   response is a leak waiting for a second bug to matter.
