---
version: "1.1.0"
created_at: "2026-09-12T18:00:00+07:00,Claude Opus 5"
last_update: "2026-09-13T06:00:00+07:00,RWANG"
status: "accepted"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "architecture-decision"
  scope: "Employment as an HR record separate from the access grant; LegalEntity moved under Tenant; TaxRegistrationBranch split out of Branch"
---

# ADR-078 — Employment is not Membership, and a legal entity lives inside a Tenant

**Status:** Accepted.
**Date:** 2026-09-12
**Decided by:** Boss instruction of 2026-09-12 *"ทำ 5-6-7 แบบขนาน"* — run Lanes
5, 6 and 7 of the organisational-structure and access-lifecycle review in
parallel, following the two-lane ERP review that also produced ADR-077.
**Relates to:** [ADR-077](ADR-077-MEMBERSHIP-IS-A-GRANT-WITH-A-LIFECYCLE.md)
(this ADR's base branch and house style — D1 below extends ADR-077's own
one-writer, grant-vs-fact discipline to a second table),
[ADR-018](ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md) D4 (composite
ancestry FKs are how this schema enforces BR-001),
[ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md) D3 (one table, one
owning charter), [ADR-037](ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md)
D1 (the exact discipline `Employment` follows: an HR/grouping fact never
answers an authorization question), BR-001, BR-002,
[.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md](../../.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md)
(the sibling defect this ADR's Employment half mirrors: a model built to
answer one question was quietly asked a second one).

## Context

Two unrelated defects were assigned to this lane, and they turn out to share
one root cause: **a table modelled for one purpose was read as though it
answered a different, harder question.**

### FR-193 — Employment: "who works here" was never asked separately from "who may log in here"

`apps/server/src/modules/people/application/people-service.js` built the HR
roster (`GET /api/people`) by reading `Membership` directly — its `role`,
its `businessId`, and (until ADR-077) its `branchId` and `employeeRef`
columns. `Membership` answers "who may authenticate and what may they see"
(ADR-077's own subject); it has never recorded "who is staff." Reading one
table for both questions makes them the same question by construction, and
the four consequences below are not four bugs — they are the same missing
model, observed from four directions:

- A shareholder holding a tenant-wide OWNER `Membership` (FR-074(c) mints one
  for every Business founder) appears in the HR People Directory as an
  employee, because the directory has no way to say "has access" without
  saying "works here."
- Suspending a `Membership` (ADR-077's new lifecycle) makes the person
  **disappear from the roster entirely**, rather than showing them as staff
  whose access is currently suspended — because the roster's only source of
  "is this person staff" was a column ADR-077 just taught to have a
  `SUSPENDED` state.
- A consultant or contractor holding access but no employment relationship
  cannot be told apart from staff, because nothing distinguishes "holds a
  grant" from "holds a job."
- The five Persons FR-023's LINE ingest has created directly from a
  `lineUserId` in production hold **no `Membership` at all** — they were
  never given a login — so they can never appear in the roster under any
  status, even if one of them is, in fact, an employee who orders stock over
  LINE.

Standard HR/IAM practice keeps these apart for exactly this reason: SAP
separates the user master (`SU01`) from the personnel number (`PA`), linked
by infotype 0105; Oracle separates `FND_USER` from
`PER_ALL_ASSIGNMENTS_F`. An assignment has effective dates and a type; a
grant has a scope and a lifecycle. ADR-077 built the grant's lifecycle. This
ADR builds the assignment record ADR-077 deliberately left out of scope.

### FR-194 — LegalEntity had no Tenant, and Branch carried a fact that belongs one level up

`LegalEntity.portfolioId` is `NOT NULL` and there is **no `tenantId` column
at all**. Concretely, this means:

- **Defect A — a LegalEntity sits above the isolation boundary.** BR-001
  makes Tenant the isolation boundary; every tenant-owned row is supposed to
  carry a non-null `tenantId` a database policy can filter on (ADR-018 D4).
  `LegalEntity` carries none. Two Businesses in **different Tenants** can
  reference the same `LegalEntity` row today, and a Postgres RLS policy has
  no column here to scope on even if one were written.
  `billing-invoice-service.js` compensated in application code, in two
  places, for a schema that could not compensate for itself: a portfolio
  comparison (`legalEntity.portfolioId !== business.tenant.portfolioId`) at
  read time, and a `409 BILLING_SHARED_LEGAL_ENTITY` refusal when a second
  Business tries to edit a shared entity's address.
- **Defect B — `Branch.taxBranchCode` names the wrong thing.** Under Thai
  law (ประมวลรัษฎากร มาตรา 86, แบบ ภ.พ.20) a 5-digit branch code is issued to
  a **legal entity's VAT registration**, not to an operating site. A
  warehouse legitimately has no branch code; one branch code can legitimately
  cover several operating sites (a shop and a stockroom sharing one VAT
  registration are not two branches). `Branch.taxBranchCode` conflated the
  two, and nothing stopped two Businesses that share one `LegalEntity` from
  each stamping their own Branch with `'00000'` (head office) — so ภ.พ.30
  reconciliation by `(tax id, branch code)` cannot be trusted against this
  system's data, because the system could hold two "head offices" for one
  legal head office.

Both `LegalEntity` and `Branch` carry zero rows in production as far as this
review could determine — no Business in the one production Tenant
(`TNT-SMARTGIFT`, ADR-018 D2) has a `legalEntityId` set, and no prior FR
created one. **This could not be independently re-confirmed from this
session**: the review environment had no reachable credential for the
production Supabase project. The migration therefore does not trust that
reading — it re-asserts it as a precondition at apply time (the same
discipline ADR-077's own migration uses) and aborts with the exact offending
rows if the assumption has stopped being true, rather than guessing a
backfill.

## Decision

**D1 — `Employment` is a new, additive HR record. It grants nothing, and
`Membership` remains the one and only access grant.** Same discipline
ADR-037 D1 established for `TeamMembership`, applied to a second table:
`resolveViewer` and the rest of `src/modules/identity/` never read
`Employment` (enforced by
`tests/unit/fr193-employment-not-authorization.test.js`, which scans the
identity module's source the same way ADR-037's own test does for `Team`).
`people-service.js` now builds the roster **from** `Employment`, and derives
one additional column — `hasSystemAccess` — **from** `Membership`, never the
reverse. A `SUSPENDED` or absent `Membership` makes `hasSystemAccess: false`;
it changes nothing about whether the Employment row is listed.

`employmentType` is `EMPLOYEE | CONTRACTOR | INTERN | OWNER_OPERATOR` — the
fourth value exists because FR-074(c)'s tenant-wide founder OWNER grant has
no HR shape at all today, and a founder who also works day-to-day in the
business is a real, common case this vocabulary should be able to name once
someone chooses to record it; nothing in this change requires anyone to.
`status` is `ACTIVE | ON_LEAVE | ENDED`. A person is re-hired as a **new**
Employment row, never by reopening an ended one — the same shape ADR-077 D2
chose for a revoked `Membership` — enforced by a partial unique index on
`(personId, businessId) WHERE endAt IS NULL`.

Ending an `Employment` never touches `Membership`, and revoking a
`Membership` never touches `Employment`. They are two different authorities,
acted on by two different services (`employment-service.js` and identity's
existing lifecycle services), on purpose: an owner who wants both effects
performs both acts, each with its own author and its own audit row — the
same "two acts, two authors" reasoning ADR-077 D6 uses for offboarding versus
erasure.

**D2 — `LegalEntity` moves under `Tenant`; `Branch.taxBranchCode` is
replaced by a `TaxRegistrationBranch` the Branch may optionally reference.**
`LegalEntity.portfolioId` becomes `LegalEntity.tenantId`, with the same
`UNIQUE(id, tenantId)` + composite-FK pattern ADR-077 D4 used for
`Business(id, tenantId)`: `Business.legalEntityId` now has a composite FK to
`LegalEntity(id, tenantId)`, so a Business can only reference a LegalEntity
in its **own** Tenant — enforced by the database in production, and by an
application-level check in `createBusiness` (the row's one writer) for the
SQLite dev/test path, which has no compound-FK equivalent for `prisma db
push` to create.

`TaxRegistrationBranch` (`legalEntityId`, `branchCode`, `name`, `address`,
`status`) holds the legal entity's own VAT branch registrations;
`Branch` gains `taxRegistrationBranchId` (nullable, `Restrict`) and drops
`taxBranchCode`. `Branch` also gains `kind` (`SITE | WAREHOUSE | KITCHEN |
OFFICE`, default `SITE`) so a Branch can say what it *is* independently of
whether it has a tax registration — a warehouse is a valid, complete Branch
with no `taxRegistrationBranchId` at all.

`billing-invoice-service.js` reads `branch.taxRegistrationBranch.branchCode`
for the seller snapshot's `taxBranchCode` field (the DTO keeps that name —
it is what every existing consumer, including the durable
`CommerceDocument.snapshotJson` shape, already expects). It refuses `422
BILLING_TAX_BRANCH_NOT_CONFIGURED` when a `TAX_INVOICE`/`ABB_TAX_INVOICE` is
requested against a Branch with no linked tax registration, and `422
BILLING_TAX_BRANCH_MISMATCH` when the linked one belongs to a different
`LegalEntity` than the Business's own. `INVOICE`/`RECEIPT` never require
one. The old application-code portfolio comparison is retired — the composite
FK now makes "this LegalEntity really belongs to this Business's Tenant" a
database invariant instead of a read-time guess — but the `409
BILLING_SHARED_LEGAL_ENTITY` refusal for two Businesses editing one shared
LegalEntity's address stays: that is still correct, and unrelated to the
isolation defect this ADR repairs.

**D3 — Creating a `LegalEntity` stays an installation-operator act.**
ADR-078 repairs where a `LegalEntity` lives; it does not decide that Tenant
ownership is now sufficient authority to mint one. Widening that without a
decision that says so would be exactly the kind of authority creep this
repository's ADRs exist to name rather than let slip in through a schema
fix. `createTaxRegistrationBranch` — registering an *additional* branch of a
legal entity a Tenant's owner already administers — is authorized by Tenant
ownership, the same shape `createBranch` already grants for an operating
site; this is a narrower, additive capability, not a relaxation of D3's
first sentence.

## Consequences

**The HR roster can finally answer "who works here" honestly.** A suspended
staff member stays listed as staff whose access is suspended. A shareholder
with no employment relationship stops appearing as one. A LINE-originated
Person can be given an Employment record without ever being given a login.

**A warehouse is a first-class, valid Branch with no tax identity of its
own.** Before this change every Branch implicitly claimed to be able to
carry a VAT branch code; after it, only a Branch someone has deliberately
linked to a `TaxRegistrationBranch` can issue a tax document, and the two
concepts — operating site and legal tax registration — can finally be
audited separately.

**Two new one-way relationships that must stay one-way.** `Employment` must
never gain a role, a domain grant, or any field `resolveViewer` reads —
D1's test is the ratchet, not a courtesy. `LegalEntity` must never regain a
Portfolio-level reference — the composite FK is not decorative.

**Costs accepted.** `Branch.taxBranchCode` and `Membership.branchId`/
`employeeRef` are dropped in the same migration that adds their
replacements; any external report or export keyed to the old columns needs
its own follow-up (none is known to exist against a table with zero
production rows, but the migration cannot prove a negative about integrations
this review did not have visibility into). `Employment`'s write surface
(`createEmployment`, `setEmploymentOnLeave`, `reinstateEmployment`,
`endEmployment`) ships with unit and integration coverage but no HTTP route
or screen in this change — the People Directory reads it; nothing yet writes
it from the browser. This is deliberate, in the same shape ADR-077's own
`expiresAt` column shipped read-but-unwritten: the model and its invariants
are correct and tested today, and the admin surface is a smaller, separable
follow-up rather than a reason to hold back the schema repair.

**This session could not independently re-verify the "zero rows in
production" reading** for `LegalEntity`/`Branch` against the live Supabase
project — no reachable credential existed in the environment this ADR was
authored in. The migration's precondition block re-asserts the claim at
apply time and aborts with the exact offending rows and a diagnostic query
if it no longer holds, rather than trusting a stale reading the way ADR-077's
own migration explicitly warns against ("rows can be written between the
check and the apply").

## Alternatives considered

**Add `employeeRef`/`title`/`employmentType` directly onto `Membership`
instead of a new table.** Rejected for the same reason ADR-037 D3 rejected
adding `teamId` to `Membership`: it puts an HR fact and an authorization fact
in one row, and the first query that joins on "membership" gets whichever
meaning it happens to need that day. It also cannot represent the case this
ADR exists to fix — a Person with employment and no access at all — because
a `Membership` row would have to exist for the HR fact to have somewhere to
live.

**Let `Branch.taxBranchCode` stay, and only add a uniqueness constraint
scoped by `legalEntityId`.** Rejected: `Branch` has no `legalEntityId` of its
own (it points at a `Business`, which points at a `LegalEntity`), so the
constraint would need a computed/derived key across two joins, which Postgres
cannot express as a simple unique index. It also leaves the conceptual error
in place — a warehouse would still have a column inviting a tax branch code
it structurally cannot have one of.

**Keep `LegalEntity.portfolioId` and add `tenantId` alongside it, letting
both stand.** Rejected: two ancestry columns answering "which Tenant" — one
directly, one by way of Portfolio → Tenant → Business → back to LegalEntity —
is exactly the "convention, not an invariant" shape ADR-077 named as the
debt behind its own defect. One column, one meaning, one FK.

## Implementation

Declared by **FR-193** (Employment) and **FR-194** (LegalEntity under Tenant;
TaxRegistrationBranch), **BR-034**, **SDD-093**, bundled as **FEAT-028**. See
[FR-193](../domains/project-manager/features/FR-193-employment-record.md) and
[FR-194](../domains/project-manager/features/FR-194-legal-entity-and-tax-branch.md)
for the state diagrams, refusal tables and acceptance criteria.

| # | Step | Why here |
|---|---|---|
| 1 | `enums.js` vocabularies (`EMPLOYMENT_STATUSES`, `EMPLOYMENT_TYPES`, `BRANCH_KINDS`, `LEGAL_ENTITY_STATUSES`, `TAX_REGISTRATION_BRANCH_STATUSES`) | Additive and inert; every later step depends on the vocabulary existing |
| 2 | Migration: `LegalEntity.tenantId` backfill + composite FK; `TaxRegistrationBranch` table; `Branch.kind` + `taxRegistrationBranchId`; drop `Branch.taxBranchCode`; `Employment` table + backfill from `Membership.employeeRef`/`branchId`; drop those two Membership columns | Schema and data move together so no intermediate commit has a column two different pieces of code disagree about |
| 3 | `people-service.js` reads `Employment`, derives `hasSystemAccess` from `Membership`; `rbac-service.js`'s `assertEmployee` renamed to `assertTenantMember` (it checked Membership, never employment — the old name was already wrong about what it did) | The repair FR-193 exists for |
| 4 | `billing-invoice-service.js` reads the linked `TaxRegistrationBranch`; `scope-service.js`'s `createLegalEntity` takes `tenantId`; `createBusiness` gains the ancestry guard; `createTaxRegistrationBranch` added | The repair FR-194 exists for |
| 5 | `fr193-employment-not-authorization.test.js` (ADR-037 D1 discipline, applied to Employment) | Last, so the guard is checked against the real end state rather than the starting one |

## Amendment — HR Remove, approved 2026-09-13

The owner subsequently authorized a live Platform OPERATOR, as well as the
Business owner, to end an open Employment with a reason from the HR Remove
control. ENDED records remain accessible as history. Create, leave and reinstate
keep their existing ownership checks; Employment still grants no access. See
[FR-193](../domains/project-manager/features/FR-193-employment-record.md).

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.1.0 | 2026-09-13 | accepted | Owner-approved limited Operator Remove authority; existing lifecycle retained | pending | RWANG |
