---
version: "1.0.0"
created_at: "2026-09-12T16:30:00+07:00,Claude Opus 5"
last_update: "2026-09-12T16:30:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "architecture-decision"
  scope: "Membership as a grant with provenance, an explicit scope and a withdrawable lifecycle — the writer side of a status vocabulary three earlier decisions declared and nothing implemented"
---

# ADR-077 — Membership is a grant with a lifecycle, not a membership fact

**Status:** Accepted.
**Date:** 2026-09-12
**Decided by:** Boss (instruction of 2026-09-12: *"review ระบบ workspace และ membership ทั้งระบบ เติมส่วนที่ขาด
และ ปรับ flow ที่ไม่ได้มาตรฐาน ERP ตรงไหนผิดไปจากมาตรฐาน สามารถเสนอแก้หรือรื้อทิ้งได้เลย ต้องวางฐานให้ใช้งานได้ระยะยาว"*),
after a two-lane review — organisational structure and access lifecycle —
against party/party-role, SAP company code–plant, Oracle legal entity–business
unit, NIST/Azure scoped RBAC and joiner–mover–leaver.
**Relates to:** [ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md),
[ADR-027](ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md),
[ADR-033](ADR-033-GENERIC-ROLE-REGISTRY-AND-BINDINGS.md),
[ADR-037](ADR-037-TEAMS-ARE-GROUPING-NOT-AUTHORIZATION.md),
[ADR-045](ADR-045-SESSION-AND-PRINCIPAL-RESOLUTION.md),
ADR-018, ADR-057, BR-001, BR-002, BR-016, BR-018, BR-020, SEC-001, SEC-003,
SEC-008, FR-038, FR-061, FR-074, FR-095, FR-107, FR-120, NFR-019,
[RCA 2026-09-12](../../.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).

## Context

`Membership` is the one row `resolveViewer` reads to build `visibleBusinessIds`,
`ownedBusinessIds` and the per-Business domain map. Every authorization decision
in the product descends from it.

It can be created by three services in two lanes. **It cannot be withdrawn by
anything.** `membership.update` appears twice in the repository and neither call
writes `status`; `MEMBERSHIP_STATUSES` is never declared in `enums.js`; and the
only path that removes access at all is a hard `membership.delete` in the
project-manager lane, which destroys the record that the grant existed.

This is not an oversight in one place. ADR-045 D3 declares the vocabulary
`ACTIVE | PENDING | SUSPENDED | REVOKED`. FR-095 states that suspension "denies
the next request". `resolve-viewer.js` and `authorization-context.js` both
filter on `status: 'ACTIVE'`. Every reader was built. Only the writer was not —
and a read filter over a column nobody writes passes review, passes tests, and
does nothing.

Three consequences follow from the same cause, and the
[RCA](../../.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md) sets them
out in full:

1. **No withdrawal.** Offboarding a person requires hand-written SQL against
   production, which is unaudited by construction.
2. **Deletion widens privilege.** `Membership.businessId` carries
   `ON DELETE SET NULL`. The null it writes is not an absence — `buildDomainsByBusiness`
   reads it as *every Business in the Tenant*, so deleting one Business promotes
   its members to the whole group and its owners to `ownsTenant`, which FR-074(b)
   makes the authority to create more Businesses.
3. **Erasure leaves authority intact.** `erasePrincipal` counts memberships to
   decide whether to redact the `Person`, and never ends one. A person can be
   erased under PDPA and keep owning four Businesses.

A structural cause sits beneath all three. The row records *that someone is a
member* — a fact, which is true or absent. What the system needs is a record
that *someone was given access* — a grant, which has an author, a reason, and an
end. A fact is naturally deleted when it stops being true, which is why the
schema was written to let a parent's deletion reshape the row in the first
place. A grant is withdrawn, and withdrawing is itself an act with an author.

Two further facts constrain the repair.

**The scope grammar is implicit.** `businessId IS NULL` means "every Business in
this Tenant" to the resolver, and is rejected outright by
`assertMembershipBusinessOwned`, which fails closed on it. One layer honours a
wildcard the other layer cannot see, so the broadest grant in the system is also
the one no screen can administer. Production holds three such rows, including
the OWNER grant over the customer's whole group.

**Ancestry is a convention, not an invariant.** There is no composite foreign key
binding `(businessId, tenantId)` to `Business(id, tenantId)`, and no unique
constraint of any kind on `Membership`. Duplicate prevention is a `findFirst`
in application code, which under Postgres READ COMMITTED is a check and not a
constraint. ADR-018's context recorded this debt in 2026-08; it has not been
repaid.

## Decision

**D1 — `Membership` records a grant, and the grant carries its own provenance.**
`grantedByPersonId`, `grantReason`, `grantSource`, `expiresAt`, `revokedAt`,
`revokedByPersonId` and `revokeReason` go on the row, not only into the audit
stream. Two reasons, and the second is the deciding one. First, an access review
asks "who gave this, and why" of the *current* state, and answering it by
replaying an append-only log is a report, not a lookup. Second, the audit stream
already cannot answer it: production holds twelve `Membership` rows and six
`MEMBERSHIP_ADDED` events, because two of the three writers audit under
`PROJECT` and `BUSINESS` instead. Provenance on the row is the only
representation that is true regardless of which writer created it.

`grantSource` is one of `ADMIN | INVITE | SELF_PROVISION | SEED | MIGRATION`.
Existing rows backfill to `MIGRATION` where no `MEMBERSHIP_ADDED` event names an
actor, and to `ADMIN` where one does. A null `grantedByPersonId` therefore means
"created before this decision", not "created by nobody".

**D2 — The lifecycle gets a writer, and withdrawal is an act with an author.**
Four operations in identity: `suspendMembership`, `reinstateMembership`,
`revokeMembership`, `offboardPerson`. Each takes a mandatory `reason`. Each
cascades to the dependent `RoleBinding` rows and records which ones it touched.
Each refuses with 409 `LAST_OWNER` when it would leave a Business with no live
OWNER — the guard `revokeOperatorGrant` already implements for the operator
capability, applied to the authority it was always more needed for.

`MEMBERSHIP_STATUSES` is declared in `enums.js` as ADR-045 D3's vocabulary, and
a database CHECK holds it. Status values become reachable, which is what makes
FR-095's promise true for the first time.

**Rows are never deleted.** `removeProjectTeamMember`'s hard delete is replaced
by a revocation. A revoked grant stays as the evidence that it existed, and a
partial unique index scoped to `status <> 'REVOKED'` lets the same person be
granted access again later as a new row rather than by resurrecting the old one.

**D3 — Scope is a declared value, never the meaning of a null.**
`Membership.scopeType` is `TENANT` or `BUSINESS`, held by

```sql
CHECK (("scopeType" = 'TENANT'   AND "businessId" IS NULL)
    OR ("scopeType" = 'BUSINESS' AND "businessId" IS NOT NULL))
```

The resolver's behaviour is unchanged — it reads `scopeType === 'TENANT'` where
it read `!businessId` — but the intent is now legible to the administration
surface, which is what lets `ownsTenant` gate a tenant-wide grant instead of
`assertMembershipBusinessOwned` failing closed on it. `ownsTenant` already
exists in `viewer-authority.js` and is already used by `scope-service` and
`api-access-auth`; only the permission surface never called it.

`RoleBinding` takes the same grammar — `scopeType` of `TENANT | BUSINESS |
BRANCH` with `businessId` nullable — extending rather than superseding ADR-033
D3, which recorded `BUSINESS` as the *currently supported* scope. Nothing
resolves a `TENANT` binding until the resolver is taught to expand it, so the
column is additive on its own.

**D4 — A parent's deletion may never reshape a grant.** `ON DELETE RESTRICT`
replaces `SET NULL` on `Membership.businessId`, and replaces it on
`Workspace.businessId` and `Project.businessId` for the reason ADR-027 §D8.2
already gives. Deleting a Business becomes an operation that must withdraw its
grants first — which is now possible, because D2 built the withdrawal.

Ancestry becomes a database invariant: `Business` gains
`UNIQUE (id, tenantId)`, and `Membership`, `RoleBinding` and `Branch` reference
it by the composite key. This repays the debt ADR-018 recorded and removes the
per-read ancestry check from being the only thing standing between a
cross-tenant row and a resolver that trusts it.

Two partial unique indexes replace the absent constraint:

```sql
CREATE UNIQUE INDEX ON "Membership" ("personId","tenantId")
  WHERE "scopeType" = 'TENANT'   AND status <> 'REVOKED';
CREATE UNIQUE INDEX ON "Membership" ("personId","businessId")
  WHERE "scopeType" = 'BUSINESS' AND status <> 'REVOKED';
```

**D5 — `Membership.role` defaults to `MEMBER`.** The column defaults to `OWNER`
today, at the database level, under no decision that any ADR records. Every
current writer passes a role explicitly, so the change is inert for them; what it
removes is the outcome where an INSERT that omits the column — a migration, a
seed, a `psql` session — mints an owner. Default deny is the only defensible
default for an authority column.

**D6 — Erasure refuses while grants are live.** `erasePrincipal` returns 409
`PRINCIPAL_HAS_LIVE_GRANTS` when the principal holds any non-revoked
`Membership`, `RoleBinding` or `PlatformGrant` in the tenant being erased.
Offboarding becomes a prerequisite of erasure rather than something erasure
silently skips.

The alternative — having erasure revoke everything itself — was rejected. It
makes a data-subject request into an administrative action with no named author,
and it hides the moment authority ended inside an operation whose audit trail is
deliberately redacted. Two acts, two authors, two records.

Where erasure does proceed, it additionally deletes `PersonCredential` and sets
`Person.accessDisabledAt`, because a redacted person whose password still works
is not erased.

**D7 — A declared state that nothing writes is a preflight failure.** The defect
class this ADR closes was invisible to every existing guard: preflight checks
that routes declare an FR, that modules have charters, that ids keep their
subjects, and that declared columns have migrations. It has no check for a
status vocabulary, enum or ADR-declared state that no service ever writes.

A new preflight check, `unreachable-state`, reads each `*_STATUSES` export in
`enums.js`, finds the values no writer in `src/` assigns, and is CRITICAL on any
value a resolver or guard branches on. `docs/.unreachable-state-baseline.json`
records accepted debt and may only shrink — the same ratchet shape the route
anchors and viewer fixtures already use.

This is the generalisable half of the decision. The specific repairs above are
worth less than the guard that would have surfaced them in August.

**D8 — `Membership` has one writer, and it lives in identity.**
`project-team-service` and `scope-service` call identity's services instead of
writing the table. `project-team-service` loses its ability to set `role` from
the request body — `zAddMember` drops the field, and promotion stays the
separately-audited act the identity charter already claims it is.

`docs/domains/identity/CHARTER.md` takes ownership of the model and
`docs/domains/project-manager/CHARTER.md` releases it, resolving an ADR-025 D3
violation that both charters currently document as a known fact. A preflight
ratchet keeps `membership.create|update|delete` inside
`apps/server/src/modules/identity/`.

## Consequences

**The product can offboard someone.** This is the point. An owner suspends,
reinstates or revokes from the permissions screen, with a reason, and the
dependent role bindings follow. `offboardPerson` does it across a whole Tenant in
one transaction with one `PERSON/OFFBOARDED` event plus the per-row events, so
both "what happened to this person" and "what happened to this grant" are
answerable.

**Deleting a Business becomes harder, on purpose.** It now fails while grants
exist. That is the correct order of operations and it was never available before.

**Erasure becomes a two-step operation.** Offboard, then erase. Anyone who
automated the single-step version gets a 409 that names the reason.

**`expiresAt` is declared and read but never set by a product surface in this
change.** The resolver honours it; nothing writes it yet. This is deliberate —
it is the column that makes access recertification possible later without a
second migration against live authority data, and shipping it inert costs
nothing. It is listed in `docs/.unreachable-state-baseline.json` as accepted debt
under D7's own rule, because a decision that exempts itself from its guard is not
a guard.

**One live row must be repaired before the CHECK can hold.** A production
`Membership` carries `domainKeysJson = ["crm"]`, which is a `DOMAIN_GROUPS` key
and not a grantable domain — it resolves to zero domains today, silently. The
migration repairs it to the owner-confirmed value or to `[]` if unconfirmed, and
records a `DOMAIN_KEYS_REPAIRED` event either way.

**Costs accepted.** Four new columns and two indexes on the hottest
authorization table; a migration against twelve live rows whose `scopeType` is
derivable but whose CHECK must pass on the first attempt; and the loss of
`removeProjectTeamMember`'s ability to make a row disappear, which some
operational habit may depend on.

## Alternatives considered

**Merge `Membership` and `RoleBinding` into one scoped role-assignment table.**
This is the end state NIST and Azure both describe, and both review lanes
independently proposed it. Rejected *as the next step*, not as the destination:
three authorization escalations in this repository came from editing the
resolver, and the resolver would have to be rewritten rather than adjusted. D3
gives the two tables the same scope grammar, which turns the eventual merge into
a rename. Revisit when D1–D8 have been stable for a release.

**Let the audit stream be the provenance record.** Rejected on the evidence:
half the live grants have no `MEMBERSHIP` event, because writers in other lanes
audit under their own entity types. Fixing that (D8) is necessary but not
sufficient — it cannot retroactively give the existing six rows an author.

**Keep `SET NULL` and have the resolver refuse a null `businessId`.** This
narrows instead of widening, and needs no migration. Rejected because it silently
destroys the tenant-wide grant, which is a real and intended shape (FR-074(c)
creates one for every Business founder). A referential action that deletes a
legitimate authority is not better than one that inflates it; both are the
database deciding an authorization question.

**Make `Membership.status` an enum type in Postgres rather than a CHECK.**
Rejected for consistency: every other status column in this schema is TEXT with
the vocabulary in `enums.js` (CLAUDE.md states that file is the single source of
truth), and a Postgres enum makes adding a value a migration with a lock.

## Implementation

Declared by **FR-191** (grant lifecycle), **FR-192** (explicit scope grammar and
referential invariants), **BR-033**, **SEC-026**, **SDD-092**, bundled as
**FEAT-027**. See
[FR-191](../domains/identity/features/FR-191-access-grant-lifecycle.md) for the
state machine, the refusal table and the diagrams.

Sequencing, because the order matters and the reasons are not obvious:

| # | Step | Why here |
|---|---|---|
| 1 | `enums.js` vocabularies; `scopeType` column + backfill + CHECK; partial uniques; `Business(id,tenantId)` unique + composite FKs; `ON DELETE RESTRICT` ×3; `role` default; `lower(email)` unique | Additive and inert. Every later step depends on the grammar existing |
| 2 | Resolver reads `scopeType` and `expiresAt`; `authenticateUser` honours `accessDisabledAt` | Must precede any writer, or a written state has no reader |
| 3 | `project-team-service` and `scope-service` stop writing `Membership`; ratchet | Must precede step 4, or a writer outside identity creates rows the new statuses do not reach |
| 4 | Lifecycle services, routes, screen; erasure refusal | The repair |
| 5 | `unreachable-state` preflight check + baseline | Last, so the baseline records the real end state rather than the starting one |

Step 1's migration must re-run its preconditions at apply time — zero duplicate
live grants and zero ancestry violations, both true on 2026-09-12 — because rows
can be written between the check and the apply.
