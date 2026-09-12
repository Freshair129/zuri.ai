---
version: "1.0.0"
created_at: "2026-09-12T18:00:00+07:00,Claude Opus 5"
last_update: "2026-09-12T18:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "architecture-decision"
  scope: "Audit events carry their own queryable scope and the change they made, and identity gains the read models an access review needs — a Business owner's own history and the current grant roster — closing the gap ADR-077 opened but did not answer"
---

# ADR-080 — Audit events carry their own scope, and an owner can read their own access history

**Status:** Accepted.
**Date:** 2026-09-12
**Decided by:** Boss instruction of 2026-09-12: *"ทำ 5-6-7 แบบขนาน"* (do 5, 6 and 7
in parallel) — Lane 7 of a three-lane effort against `feat/access-grant-lifecycle`.
**Relates to:** [ADR-077](ADR-077-MEMBERSHIP-IS-A-GRANT-WITH-A-LIFECYCLE.md),
[ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md) D3,
[ADR-017](ADR-017-PRODUCTION-VIEWER-SESSION-AND-ENTRY-READ-MODEL.md) D6,
[ADR-027](ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md) D9,
[ADR-045](ADR-045-CANONICAL-IDENTITY-AND-ACCESS-MANAGEMENT.md) D6, FR-014, FR-191,
FR-192, SEC-001, SEC-003, BR-033,
[RCA 2026-09-12](../../.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).

## Context

ADR-077 gave `Membership` a lifecycle: provenance on the row, a withdrawal path
with a named author and a reason, and cascading revocation of dependent
`RoleBinding` rows. What it did not give the product is a way to *read* any of
that as history. Two gaps, one shared cause.

**`AuditEvent` cannot be queried by scope.** The model carries `entityType`,
`entityId`, `action`, `payloadJson`, `actorType`, `actorId`, `occurredAt` — no
`tenantId`, no `businessId`, no `reason` as a column. Scope lives inside
`payloadJson` for the writers that happened to put it there, and not for the
ones that did not. Measured against this database on 2026-09-12: 12
`Membership` rows against 6 `MEMBERSHIP_ADDED` events, and `ROLE_BINDING_ASSIGNED`
2 / `ROLE_BINDING_REVOKED` 1 against exactly 1 surviving `RoleBinding` row — one
binding disappeared with no event explaining it. "What happened in this
Business last quarter" cannot be answered by a query. It needs a full-table
scan and a JSON parse that only works for the rows whose writer thought to
include scope, which is not a contract, because nothing enforced it.

**`GET /api/audit` is operator-only, and `listAudit` filters on
`entityType`/`entityId` alone.** A Business OWNER — the person ADR-077 built an
entire withdrawal lifecycle for — cannot see who was granted access to their
own Business, when, or by whom. They cannot perform the access review that
ADR-077's whole design assumes is possible: a reason on every transition is
only worth writing if someone can read it back. Meanwhile the operator, who
can read the stream, sees every tenant at once, which is the wrong shape for
"is this Business's roster still what it should be".

The same root cause underlies both: scope was written as a comment convention
inside a JSON blob, and a comment convention is invisible to a query planner
and unenforceable by a schema. FR-198 fixes the write side; FR-199 fixes the
missing read side ADR-077 needed but did not build.

## Decision

**D1 — Seven nullable columns, and every `recordAudit` parameter that fills
them is optional.** `tenantId`, `businessId`, `reason`, `beforeJson`,
`afterJson`, `requestId`, `sessionId` go on `AuditEvent`, indexed by
`(tenantId, occurredAt)`, `(businessId, occurredAt)` and `(actorId, occurredAt)`.

This is deliberately **not** a required column with a migration-time backfill.
Three reasons, and together they are the whole argument for nullable-and-optional
over required:

1. **SEC-003 is append-only.** A backfill that infers `businessId` for an
   existing row from, say, joining `entityId` back through `Membership` would
   be *writing history*, not recording it — the row would say something no
   writer actually said at the time. A null on an old row is honest: it states
   "this row predates the column" instead of manufacturing a value nobody
   asserted. ADR-077's own migration made exactly this call for
   `domainKeysJson` — repair by dropping the ambiguous value, never by
   expanding it to a guess — and the same principle applies here: an audit
   column with an invented value is worse than one that is absent, because the
   invented one *looks* like evidence.
2. **The retrofit is out of scope, on purpose.** Dozens of files call
   `recordAudit` across every domain in this repository. Making the new fields
   required would mean touching every one of them in this change, which is
   exactly the kind of blast radius CLAUDE.md's file-boundary discipline exists
   to prevent when three lanes are editing in parallel. A required column is a
   compile-time (or at least a runtime-throw) demand on code this change does
   not own and has not reviewed. A nullable, optional one is a pure addition:
   every caller that does not know these fields exist keeps compiling, keeps
   running, and keeps writing the same row it always wrote. That is what makes
   the migration safe to ship without an audit of the whole call graph — the
   safety comes from the columns being optional, not from the migration being
   small.
3. **Population is deliberately narrow.** Only `membership-grant-service.js`
   and `membership-lifecycle-service.js` — the two files ADR-077 built and this
   lane owns — are updated to fill the new columns. This is stated as the
   scope, not hidden as a limitation: retrofitting every other caller
   (`profile-permission-service.js`'s `PERMISSIONS_UPDATED`, `project-team-service.js`,
   the auth/onboarding/signup `PERSON` events, and the rest) is recorded below
   as follow-up work for whoever owns those files, because this lane's file
   boundary does not include them.

**D2 — `actorId` stays a UUID.** The obvious alternative — join in a human
label at write time, or store `Person.code` instead of the id — was rejected.
An id is a key (AGENTS.md §18): `Person.code` can be reassigned in a rename and
a `Person.displayName` is exactly the field PDPA redaction may blank out. A
UUID is stable across both. `listAccessHistory` (D3) joins `actorId` to
`{ id, code, displayName }` at *read* time instead, which is the same choice
ADR-077 already made for `grantedByPersonId`/`revokedByPersonId` on `Membership`
— store the durable key, resolve the display value on the way out. Denormalizing
a name onto the audit row would freeze it at write time, so a later rename or a
later redaction would leave stale evidence sitting next to a `Person` row that
no longer says that — a specific instance of the same drift a comment
convention already caused for scope.

**D3 — `listAccessHistory` reads three ways, and each way has its own
authority.** A Business (`ownsBusiness`), a Tenant (`ownsTenant`), or one's own
history (`personId` equal to the caller) — or the installation operator, in
every case. Exactly one scope key is accepted; a query naming more than one has
no single answer for "whose history is this", and this is not `listAudit`'s
unscoped operator view repeated under a new name.

The three scopes are answered three different ways, which is worth stating
because it looks inconsistent and is not:

- **Business/Tenant scope** filters `AuditEvent.businessId`/`tenantId` — the new
  columns, populated going forward by this lane's two writers.
- **Person scope** cannot use those columns at all. A `Membership`'s
  `entityId` is the *grant's* id, not the person's; there is no `personId`
  column on `AuditEvent` (D1 deliberately does not add one — a person's own
  audit trail is answerable by joining through `Membership`/`RoleBinding`,
  which already exist and already carry `personId`, so a redundant column
  would be one more thing to keep in sync with them). `listAccessHistory`
  therefore reads the person's live and historical `Membership`/`RoleBinding`
  row ids first, then matches `AuditEvent.entityId` against that set. This is
  a relational join standing in for a column that would only ever duplicate
  what the join already answers correctly.
- Both scopes additionally match `PERSON`-family events: business/tenant scope
  matches only `OFFBOARDED` (the one `PERSON` action this lane's own writer
  stamps with a `tenantId` column); person scope matches
  `OFFBOARDED`/`OPERATOR_BOOTSTRAPPED`/`OPERATOR_GRANT_REVOKED`/`ACCOUNT_SELF_CREATED`
  by `entityId = personId` directly, which needs no column at all.

Refusal is 404-shaped and byte-identical for a scope the caller does not own
and a scope that does not exist (SEC-001) — the same refusal
`membership-lifecycle-service.js` already uses for a grant, applied to the
scope itself.

**D4 — `listBusinessAccess` is current state, not the event stream.** "Who has
access right now, and who gave it to them" is a different question from "what
happened", and answering it from the audit stream would mean replaying every
event to reconstruct a row `Membership` already holds — grant/revoke
provenance is exactly what ADR-077 D1 put on the row for this reason.
`listBusinessAccess` is therefore a straight read of every `Membership` in a
Business, in every status, with the person and the granting/revoking person
joined in. Authority is `ownsBusiness` alone (which already covers a
tenant-wide owner — `resolveViewer` expands a TENANT-scoped grant into every
Business's `ownedBusinessIds`, per ADR-077) or the installation operator.

**D5 — The read models live in identity; the table they read stays owned by
project-manager.** `docs/domains/project-manager/CHARTER.md` claims
`AuditEvent` and already documents "appended by other domains' services
through the shared `recordAudit` helper" as an accepted shared-write exception.
This lane's read models call across that same boundary to *read* it, which the
architecture spec's own read-slice allowance (cited by the `people` module in
the same charter) already permits. Two other lanes are editing domain charters
in this same parallel effort; moving `AuditEvent`'s ownership here would be a
third mover on the same file and is explicitly out of scope (see Consequences).

## Consequences

**An owner can finally answer "who has access to my Business, and who put them
there".** This is the point. `GET /api/platform/access-history?businessId=...`
and `GET /api/platform/businesses/{businessId}/grants` are the two reads that
make ADR-077's reason-on-every-transition worth having written.

**Old rows stay silent on scope, and that is stated rather than hidden.** Every
`AuditEvent` written before this migration has `tenantId`/`businessId`/`reason`
null. `listAccessHistory` for a Business therefore only surfaces events from
this lane's two writers going forward (plus, for a person's own history, every
`MEMBERSHIP`/`ROLE_BINDING` event ever written against their rows, found by the
relational join in D3 rather than by the column). A full retrofit is
follow-up work, tracked below.

**The `AuditEvent` charter split (D5) is recorded as a known shape, not
resolved.** Identity now depends on a table it does not own for two of its own
domain's read models. This is the same shape `people` and `business` already
have with other domains' models (documented as a sanctioned read-slice
pattern), extended here to a write-adjacent case: identity is the domain that
knows what "access" means, and the audit table is where the evidence of it
already lives. Revisiting who owns `AuditEvent` — or splitting it by concern —
is follow-up work for a lane that is not also mid-migration on two other
models in parallel.

**Follow-up work, explicitly out of this lane's scope:**

1. Retrofit `tenantId`/`businessId`/`reason` onto the other ~50 `recordAudit`
   call sites across every domain, so `listAccessHistory` eventually covers the
   whole stream by column instead of by relational join for the cases D3 needs
   one.
2. Reconsider whether `AuditEvent` should split by concern (an
   access/authorization stream separate from a general operational stream) now
   that two different read models (`listAudit`, operator-wide; `listAccessHistory`,
   scoped) exist over the same table for genuinely different audiences.
3. A `personId` filter, if a future need proves the relational join in D3 too
   slow at production scale — deferred because it would duplicate `Membership.personId`
   and `RoleBinding.personId` for no benefit today (NFR case, not made yet).

## Alternatives considered

**Add `personId` directly to `AuditEvent`.** Rejected: every `MEMBERSHIP`/`ROLE_BINDING`
event's `entityId` is already the grant/binding id, and both of those rows already
carry `personId`. A redundant column duplicates data that two tables already
hold correctly and can drift from either of them; the relational join in D3
answers the same question without a copy to keep in sync.

**Make the new columns required, backfilling old rows by inference.** Rejected
per D1 — this is a rewrite of history under SEC-003's append-only rule, and
ADR-077 already rejected exactly this shape of repair (inferring `crm` should
expand to `customer`/`market`) for the same reason: an inferred value looks
like evidence and is a guess wearing its costume.

**Retrofit every `recordAudit` caller in this change.** Rejected — CLAUDE.md's
"do not go through the whole repository" instruction for this lane exists
because two other lanes are editing the same repository in parallel; touching
every domain's audit call site is the definition of the blast radius file
boundaries exist to contain. Recorded as follow-up work (Consequences #1)
instead.

**Move `AuditEvent` into `identity`'s charter.** Rejected for this change — two
other lanes are editing domain charters in this same parallel effort (per the
task brief), and a third mover on the same files invites exactly the collision
file boundaries are meant to prevent. Recorded as an open question (Consequences)
rather than acted on.

## Implementation

Declared by **FR-198** (queryable scope and the change on the row) and
**FR-199** (the two read models and their routes), **BR-036**, **SEC-028**,
**SDD-095**, bundled as **FEAT-030**. See
[FR-198](../domains/identity/features/FR-198-audit-scope-and-evidence.md) and
[FR-199](../domains/identity/features/FR-199-access-history-read-models.md)
for the field reference, the query shapes and the refusal tables.

| # | Step | Why here |
|---|---|---|
| 1 | Schema: seven nullable `AuditEvent` columns + three indexes; migration `20260912150000_audit_scope_and_evidence.sql` | Additive and inert — every existing reader and writer is unaffected until step 2 |
| 2 | `recordAudit` accepts the new fields as optional | Must precede step 3, or the two writers below have nothing to call |
| 3 | `membership-grant-service.js` and `membership-lifecycle-service.js` fill the columns on every event they already write | The only population this lane performs — the "small, contained set" the task brief calls for |
| 4 | `access-history-service.js` (`listAccessHistory`, `listBusinessAccess`) in identity, calling across to `project-manager`'s `AuditEvent`/`Membership` | The read models FR-199 declares |
| 5 | Two routes under `src/app/api/platform/`, the OpenAPI inventory entries, and the read-only platform-users panel | The surface an owner actually uses |

Migration `20260912150000_audit_scope_and_evidence.sql` is additive-only: seven
`ADD COLUMN` statements, all nullable, and three `CREATE INDEX` statements. It
carries no precondition block, unlike ADR-077's migration, because there is no
existing-data shape it could violate — every new column defaults to null and
every existing row already satisfies "this column is null".
