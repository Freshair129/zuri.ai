---
version: "0.1.0b"
created_at: "2026-09-12T16:00:00+07:00,CLAUDE"
last_update: "2026-09-12T16:00:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "identity-security"
  doc_type: "root-cause-analysis"
  scope: "Membership was modelled as a fact, not as a grant — three consequences, one cause"
---

# Incident — a grant that can be created but never withdrawn

## Summary

`Membership` is the single row `resolveViewer` reads to decide what a person may
see and own. It can be **created** by three writers in two domain lanes. It can
be **withdrawn** by nothing at all.

Every state the governing ADR declares for it — `SUSPENDED`, `REVOKED` — exists
only in prose. No code path writes `Membership.status` to any value other than
its default. The consequences below are not three bugs; they are three places
where the same missing idea surfaced.

No exploitation is known. Two of the three are reachable only by an operator
with database access, which is a role that already holds broader powers. The
third — erasure leaving authority intact — is reachable from the product today.
This was found by review on 2026-09-12, not by an incident.

## Root cause

A grant answers four questions: *who has it*, *who gave it*, *why*, and *until
when*. `Membership` answers only the first.

```prisma
// apps/server/prisma/schema.prisma
model Membership {
  personId       String
  tenantId       String
  businessId     String?   // null silently means "every Business in the Tenant"
  role           String    @default("OWNER")
  status         String    @default("ACTIVE")   // no writer, no enum, no CHECK
  domainKeysJson String    @default("[]")
  // no grantedBy, no reason, no expiresAt, no revokedAt
}
```

The row records **that someone is a member**. It does not record **that someone
was given access**. That is a modelling distinction, not a cosmetic one: a fact
is true or absent, and a row that expresses a fact is naturally *deleted* when
the fact stops being true. A grant, by contrast, is an event with a beginning
and an end, and withdrawing it is itself an act that has an author and a reason.

Every consequence below follows from having built the first and needed the
second:

- withdrawal has no representation, so no service could implement it even if
  one wanted to (Instance 1);
- because nothing withdraws, the row's only route out of existence is deletion,
  so the schema was written to let a parent's deletion reshape it — and the
  reshape **widens** (Instance 2);
- and a subsystem whose whole job is to remove a person's footprint could count
  grants but not end them (Instance 3).

The second-order problem — the reason this survived three ADRs that each
gestured at it — is that **the documents are correct**. ADR-045 D3 declares the
status vocabulary. FR-095 states that "Membership suspension … denies the next
request." `resolveViewer` genuinely filters on `status: 'ACTIVE'`. Every layer
that *reads* the lifecycle was built. Only the layer that *writes* it was never
built, and a read filter over a column nobody writes is indistinguishable, in
review and in tests, from a working feature.

```
ADR-045 D3      declares ACTIVE | PENDING | SUSPENDED | REVOKED   ✓ written
resolve-viewer  filters status === 'ACTIVE'                       ✓ written
authorization-context  filters status === 'ACTIVE'                ✓ written
FR-095          "suspension denies the next request"              ✓ written
──────────────────────────────────────────────────────────────────
something that sets status to anything but ACTIVE                 ✗ absent
```

## Instance 1 — nothing can revoke access (reachable from the product: no)

`membership.update` appears exactly twice in the repository. Neither writes
`status`.

| Call site | Writes |
|---|---|
| `apps/server/src/modules/identity/profile-permission-service.js:157` | `role`, `domainKeysJson` |
| `apps/server/src/modules/project-manager/application/project-team-service.js:133` | `role` |

`MEMBERSHIP_STATUSES` is never declared in
`apps/server/src/lib/validation/enums.js`; the file declares `MEMBERSHIP_ROLES`
and stops. `Membership.status` is therefore an unconstrained free string whose
only value in production is `ACTIVE` — twelve rows, twelve `ACTIVE`.

The one path that removes a person's access at all is a hard delete in a lane
that does not own the table:

```js
// project-team-service.js:144 — removeProjectTeamMember
await db.membership.delete({ where: { id: membershipId } })
```

That destroys the evidence that the grant ever existed, and leaves the audit
event's `entityId` pointing at a row that is gone.

**Consequence.** An owner cannot offboard anyone. The operational answer today
is a hand-written `UPDATE`/`DELETE` against production, which is
unaudited by construction: `recordAudit` is a service-layer call, and SQL does
not make one.

## Instance 2 — deleting a Business widens the privilege of its members (reachable from the product: no)

```sql
-- apps/server/supabase/migrations/20260818084011_application_schema.sql:1217
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

`SET NULL` is the Prisma default for an optional relation, and on most tables it
is the harmless choice. Here the null it writes is not an absence. It is a
value with a meaning, and the meaning is *broader than what it replaced*:

```js
// apps/server/src/modules/identity/viewer-domains.js — buildDomainsByBusiness
if (membership.businessId) { grant(membership.businessId, keys); continue }
for (const business of tenantBusinesses) {
  if (business.tenantId === membership.tenantId) grant(business.id, keys)
}
```

So deleting one Business turns every Membership scoped to it into a tenant-wide
Membership:

```
before   MEMBER of Business A                     sees A
after    businessId = NULL                        sees A, B, C, D

before   OWNER  of Business A                     owns A
after    businessId = NULL                        owns A, B, C, D
                                                  and ownsTenant() is now true,
                                                  which FR-074(b) makes the
                                                  authority to create more
                                                  Businesses
```

The same `SET NULL` is on `Workspace.businessId` (line 1238) and
`Project.businessId` (line 1241), where the effect is different but also wrong:
ADR-027 §D8.2 says a Space that loses its Business goes silently read-only.

No code path calls `business.delete` today, which is the only reason this is
inert. ADR-057 hands migrations to an operator running SQL as `postgres`, so
"no code path does it" is a statement about the application, not about the
system.

## Instance 3 — erasure removes the person's data and leaves their authority (reachable from the product: **yes**)

`erasePrincipal` exists to remove a person's footprint under PDPA. It revokes
`ExternalIdentity`, identity link tokens, `Session` and `ChannelIdentity`;
soft-deletes `Customer`; redacts message content. It touches `Membership`
exactly once:

```js
// apps/server/src/modules/identity/erase-principal.js:126-134
// no membership anywhere and no other live customer in another tenant.
tx.membership.count({ where: { personId } }),
```

It **counts** grants in order to decide whether to redact the `Person` row. It
never ends one. And the test runs backwards from what an operator would expect:
a person who *holds* grants is the person who does **not** get redacted.

**Consequence.** Erasing a staff member removes their contact details and their
conversation history while leaving every `Membership`, every `RoleBinding`,
their `PersonCredential`, and any `PlatformGrant` untouched. They keep owning
what they owned, and `authenticateUser` still matches them — on `Person.code`,
since the email is now null.

This inverts the guarantee. Erasure is the one operation a person can demand,
and it currently strips the record of who they are while preserving their power
over the system.

## Why the three were not caught together

Each instance lives in a different lane and each looks local:

- Instance 1 reads as a missing feature ("we have not built offboarding yet").
- Instance 2 reads as an ORM default ("Prisma wrote that FK").
- Instance 3 reads as a PDPA scoping decision ("erasure is about customer data").

They are the same sentence in three grammars: **the system can give access and
cannot take it back.** Fixing any one of them alone leaves the other two,
because none of them is the cause.

The repository's own guard against this class did not apply. Preflight enforces
that a route declares an FR, that a module has a charter, that an id keeps its
subject, and that a declared column has a migration. It has no check for the
inverse shape found here — a column, a status vocabulary or an ADR decision
that **nothing writes**. That gap is the reason a correct ADR and a correct read
filter coexisted with an absent writer for four months.

## Contributing factor — `Membership` has three writers across two lanes

ADR-025 D3 requires one owner per table, and the charter that claims
`Membership` is `docs/domains/project-manager/CHARTER.md`, while the service
that administers role and domain grants lives in `identity`. The identity
charter records the split as a known fact rather than a defect.

Three writers exist:

| Writer | Lane | Audit entityType |
|---|---|---|
| `profile-permission-service.js:236` (`addBusinessMembership`) | identity | `MEMBERSHIP` |
| `project-team-service.js:119` (`addProjectTeamMember`) | project-manager | `PROJECT` |
| `scope-service.js:231` (FR-074(c)) | project-manager | `BUSINESS` |

Production carries twelve `Membership` rows and six `MEMBERSHIP_ADDED` events.
Half of the live grants have no event in the `MEMBERSHIP` family naming who
created them. That is not a reporting inconvenience — it is the direct reason
Instance 1 cannot be repaired by a service in one lane alone.

`project-team-service` additionally parses its role from the request body with
`zMembershipRole`, which is `z.enum(['OWNER','MEMBER'])`. The project team
screen can therefore mint an OWNER `Membership` over a Business, recorded as
`PROJECT/TEAM_MEMBER_ADDED`. `assertTeamWritable` gates it on `ownsBusiness`, so
this is not an escalation — but it is the identity charter's stated invariant
("`addBusinessMembership` never grants OWNER, which stays a separate,
separately audited act") being false through a second door.

## Fix

Recorded as [ADR-077](../../docs/decisions/ADR-077-MEMBERSHIP-IS-A-GRANT-WITH-A-LIFECYCLE.md).
In short:

1. **Model the grant, not the fact** — `grantedByPersonId`, `grantReason`,
   `grantSource`, `expiresAt`, `revokedAt`, `revokedByPersonId`, `revokeReason`
   on the row itself, so provenance survives independently of the audit stream.
2. **Give the lifecycle a writer** — `suspend` / `reinstate` / `revoke` /
   `offboard`, each with a reason, each cascading to dependent `RoleBinding`
   rows, each refusing to remove the last OWNER of a Business.
3. **Make the scope explicit** — `scopeType` (`TENANT` | `BUSINESS`) with a
   CHECK, so "every Business in the Tenant" is a declared value rather than the
   meaning of a null.
4. **Stop the widening** — `ON DELETE RESTRICT` on `Membership`, `Workspace`
   and `Project`, plus a composite foreign key that makes Tenant ancestry a
   database invariant instead of a convention re-checked at every read.
5. **Make erasure refuse** — `erasePrincipal` returns 409 while the principal
   holds any live grant. Offboarding is a prerequisite of erasure, not a
   side effect of it.
6. **One writer** — `project-team-service` and `scope-service` call identity;
   a preflight ratchet keeps `membership.create|update|delete` inside
   `src/modules/identity/`.

Not in scope, deliberately: merging `Membership` with `RoleBinding`. It is the
right end state and the wrong next step — three authorization escalations in
this repository came from editing the resolver, and the scope grammar above
lets the two tables converge later as a rename rather than a rewrite.

## Lesson

**A read filter over a column that nothing writes is not a feature; it is a
decoration that reads like one.** Every review artefact this repository produces
— the ADR, the FR row, the resolver, the test that a suspended membership is
denied — can be green while the state it describes is unreachable.

The generalisable guard is cheap: for any column whose values a decision
depends on, ask *which service writes each value*, and treat "none" as a failure
rather than as future work. A preflight check for declared-but-unwritten status
vocabularies is proposed in ADR-077 D7 for exactly this reason.

The second lesson is narrower and worth stating separately: **an ORM's default
referential action is a policy decision in disguise.** `SET NULL` on a nullable
scope column does not clear the scope — it replaces it with whatever the
application decides null means. Here null meant *more*.
