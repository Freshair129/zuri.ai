---
version: "1.0.0"
created_at: "2026-09-12T17:00:00+07:00,Claude Opus 5"
last_update: "2026-09-12T17:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "architecture-decision"
  scope: "A scoped invitation that becomes a grant on acceptance; segregation of duties as a write-time and transaction-time rule, not a role list; operator access that expires, that a standing operator can issue, and whose use is recorded"
---

# ADR-079 — Access invite, segregation of duties, and the operator lifecycle

**Status:** Accepted.
**Date:** 2026-09-12
**Decided by:** Boss instruction of 2026-09-12: *"ทำ 5-6-7 แบบขนาน"* — three lanes
built in parallel against the same base, this one covering the invite,
segregation-of-duties and operator-lifecycle gaps ADR-077's review surfaced but
left for a follow-on change.
**Relates to:** [ADR-077](ADR-077-MEMBERSHIP-IS-A-GRANT-WITH-A-LIFECYCLE.md),
[ADR-027](ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md),
[ADR-033](ADR-033-CUSTOMER-SCOPE-AND-PRODUCT-OWNER-AUTHORITY.md),
[ADR-065](ADR-065-COMMERCE-LANE-ORDERS-AND-PAYMENTS-BOUNDARY.md),
[ADR-066](ADR-066-PROCUREMENT-LANE-SUPPLIERS-ORDERS-AND-RECEIPTS-BOUNDARY.md),
[ADR-017](ADR-017-PRODUCTION-VIEWER-SESSION-AND-ENTRY-READ-MODEL.md),
BR-016, BR-002, FR-067, FR-072, FR-074, FR-075, FR-076, FR-107, FR-163, FR-164,
FR-165, FEAT-023, FEAT-024,
[RCA 2026-09-12](../../.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).

## Context

Three gaps sat beside ADR-077's repair, each real and each independent of the
other two, which is why this decision treats them as three FRs under one ADR
rather than one.

**There is no Business-level invitation.** `WorkspaceInvite` (FR-067) is
complete and correct — mint, accept, revoke, expiry, hashed token, single use —
but is keyed to `portfolioId`, an authority layer `resolveViewer` deliberately
never reads (BR-016). The only way anyone gains Business access today is
`addBusinessMembership`, where an owner types an exact code or email and the
grant is ACTIVE immediately: no pending state, no token, no expiry, and no way
to invite someone who has no account yet. Both `WorkspaceInvite` and
`WorkspaceMembership` carried zero rows in production on 2026-09-12, verified
directly against the SQLite dev mirror of the schema and against the absence of
any writer of either table outside `workspace-membership-service.js` and the
FR-067 test suite — which is what makes generalising the table a pure DDL
change rather than a data migration.

**Segregation of duties is a comment, not a control.** `ROLE_PERMISSIONS` in
`rbac.js` is a frozen map with no conflict declarations, and `assignRoleBinding`
never looks at a person's other bindings. `PROCUREMENT_BUYER` held both
`procurement.po.write` and `procurement.receipt.post`, so three-way match — a
different person orders, receives and pays — was impossible by definition: nothing
stopped, or even recorded, one person doing all three. Independently and more
directly, `payment-service.js` set `verifiedByPersonId` to the acting viewer and
never compared it against `createdByPersonId`, though both columns already
existed. ADR-065's rule that revenue is counted only from VERIFIED payments
rested on an assumption the code did not enforce: whoever recorded a payment
slip could verify their own.

**This installation can have one operator, forever.** `platformGrant.create`
exists in exactly two places, both inside `bootstrapOperator`, which refuses
outright when an ACTIVE OPERATOR grant already exists. The file's own comment
says "every later grant must be issued by a standing operator," and that
function did not exist. There is no `expiresAt`; `grantedByPersonId` is never
set on the bootstrap grant; and the *use* of operator power — reading
`/api/audit`, previewing or restoring a backup — was not recorded at all,
though ADR-017 D6 says support-class access must be auditable.

## Decision

### D1 — FR-195: `AccessInvite` generalises `WorkspaceInvite`

`WorkspaceInvite` is renamed to `AccessInvite` and gains `scopeType`
(`PORTFOLIO | TENANT | BUSINESS`), `tenantId`, `businessId`,
`invitedLineUserId` (LINE-first intake — invite the person who messaged the
OA, named by channel identity rather than an email they may not have),
`domainKeysJson`, `reason` and `acceptedMembershipId`. A CHECK binds
`scopeType` to exactly one of `portfolioId`/`tenantId`/`businessId`, mirroring
`Membership.scopeType`'s CHECK (ADR-077 D3); a second CHECK requires at least
one addressee (`targetPersonId`, `invitedEmail` or `invitedLineUserId`).

Acceptance branches on scope. PORTFOLIO scope delegates to the existing
`acceptWorkspaceInvite`, which already owns the WorkspaceMembership discipline
BR-016 requires and is not re-implemented. TENANT and BUSINESS scope create a
`Membership` the one way a `Membership` may be created —
`grantBusinessMembership` (ADR-077 D8) — with `grantSource: 'INVITE'`, inside
the same transaction that claims the token.

Authority to mint is scope-specific: PORTFOLIO reuses
`assertWorkspaceAdminAuthority` unchanged; TENANT needs `ownsTenant`; BUSINESS
needs `ownsBusiness`, deriving its Tenant from the Business row rather than
trusting a client-supplied one. Every refusal is the same 404 an absent scope
produces (FR-072), so a probe cannot learn a hidden scope exists.
`role: 'OWNER'` is refused at every scope — promotion stays the separately
audited act the identity charter already claims it is — and TENANT/BUSINESS
scope additionally refuses any role but `MEMBER`, because a real `Membership`'s
role vocabulary has nothing else to offer once OWNER is off the table.

**The Membership binds to the accepting SESSION's `personId`, never resolved
from `invitedEmail`.** `Person.email` gained a unique index on the base this
change builds on, but that does not make email a safe join key at acceptance
time: resolving by email would bind the grant to whichever account currently
holds that address, not to the person who actually presents the token. The
invited address only routes the link; the trusted session is the only source
of who receives the grant, the same SEC-014 discipline FR-067 already applies.

`WorkspaceMembership` is unchanged and is NOT merged into `Membership`. It
remains the only table that can express "a person who has no Tenant yet"
(`Membership.tenantId` is `NOT NULL` and stays so), and BR-016's separation of
authority is correct as it stands.

### D2 — FR-196: segregation of duties gets a writer

`ROLE_CONFLICTS` in `rbac.js` declares two pairs: `SALES_REP` /
`PAYMENT_VERIFIER` (records money vs. confirms money, ADR-065 D4) and
`PROCUREMENT_BUYER` / `GOODS_RECEIVER` (orders vs. receives).

**This amends ADR-066 D4.** That decision gave `PROCUREMENT_BUYER` both
`procurement.po.write` and `procurement.receipt.post`, reasoning that the
ledger-write half needed Inventory's own authority on top and said nothing
further. What it did not say, and should have, is that the *procurement* half
of ordering and receiving is itself a two-person control — the whole point of
three-way match is that the person who wrote the order is not the person who
signs for what arrived. `GOODS_RECEIVER` is a new role holding
`procurement.receipt.post` alone; `PROCUREMENT_BUYER` keeps only
`procurement.po.write`. This is a correction stated plainly rather than a
silent edit: ADR-066 D4's Inventory-authority reasoning is unchanged and still
applies on top of whichever of the two roles a person holds.

`assignRoleBinding` refuses 409 `ROLE_CONFLICT`, listing what the requested
role conflicts with, when the assignee already holds the other half of a pair
in the same Tenant — evaluated across every Business in the Tenant, because a
buyer at Business A and a receiver at Business B is still one person
completing their own cycle if both sit in the same Tenant. The refusal lifts
only for a TENANT owner passing `sodOverride: { reason }`; a Business owner may
not lift it, on the same reasoning `assertNotLastOwner` already uses in
`membership-lifecycle-service.js` — the person who would be stranded by the
mistake, or here, the person accountable for the Tenant-wide control, is the
only one who may waive it. The reason lands on `RoleBinding.sodOverrideReason`
and in the audit payload, so a review sees it on the row and not only in the
append-only stream.

**A transaction rule, not a role rule, for payment verification.**
`applyPaymentAction` refuses 409 `PAYMENT_SELF_VERIFY_FORBIDDEN` when the
verifier is the person who recorded the same payment — **including a Business
OWNER**, who bypasses every other capability check in that file. This is
deliberate and is the one place an OWNER does not bypass: the rule is about
needing two people to complete one instance of the cycle, not about holding a
permission, and an OWNER holds every permission by construction. A genuinely
one-person Business gets an explicit, auditable way through:
`selfVerifyAttested: true`, which lands in the audit payload as
`selfVerified: true` — never a silent exemption, and never inferred from role.
`postGoodsReceipt` applies the identical shape against the purchase order's
`createdByPersonId`, with its own `GOODS_RECEIPT_SELF_POST_FORBIDDEN` refusal.

### D3 — FR-197: operator access is time-boxed, issuable, and its use is recorded

`issueOperatorGrant` requires an existing, standing `isInstallationOperator`
caller and mints a fresh `PlatformGrant` with a mandatory `expiresAt`, capped
at 90 days, and a mandatory reason. `hasOperatorGrant` honours `expiresAt` even
while the row remains nominally `ACTIVE` — nothing flips status on a timer, the
same NFR-019 "recompute per request" discipline ADR-077 applies to Membership.

**Renewal is a fresh row, not an update to the existing one** — the same
"grant, not a fact" reasoning ADR-077 D1 applies to Membership. Any prior
ACTIVE grant the same Person holds for the same capability is superseded
(revoked, with its own `OPERATOR_GRANT_REVOKED` audit event, reason
`SUPERSEDED_BY_RENEWAL`) inside the same transaction that issues the new one.
`PlatformGrant`'s unconditional `@@unique(personId, capability)` is replaced by
a partial unique index scoped to `status = 'ACTIVE'`, mirroring the pattern
ADR-077 D4 already uses on `Membership` — the history of who held operator
access, and when, survives rather than being overwritten in place.

The bootstrap grant `bootstrapOperator` mints is flagged `standing: true`: it
was never issued *by* a standing operator, because none existed yet to issue
it. Every grant `issueOperatorGrant` issues afterward is `standing: false` —
issued by, not born as, the installation's first authority.

**Operator use is recorded, not only operator grant.** `assertOperatorAndRecordUse`
checks `isInstallationOperator` and, only on success, writes one
`OPERATOR_ACTION` audit event naming the action taken — `AUDIT_READ`,
`BACKUP_EXPORT`, `BACKUP_PREVIEW`, `BACKUP_RESTORE`. A denied attempt writes
nothing, so the audit stream never grows from a refusal. `GET /api/audit` and
both entry points of backup preview/restore now route through it.

**Reading ADR-017 D6 as covering these two operator reads is a deliberate
extension of it, not an obvious consequence.** D6's exact words: "Successful
reads do not emit high-volume audit rows. Session creation, revocation,
**platform impersonation/support access**, and denied privileged attempts are
meaningful security events and must be auditable." Two things are true of D6
at once, and this decision leans on the second over the first. It exempts
*ordinary* successful reads from audit noise — correctly, or every
`GET /api/projects` would need a row. But it also names "platform
impersonation/support access" as the opposite case, without enumerating what
qualifies. Reading `/api/audit` and exporting or restoring a whole-installation
backup are not ordinary reads: both are reachable only by the narrowest,
most powerful capability in the system (`isInstallationOperator`, FR-075),
both disclose or replace information across every Tenant at once, and both are
exactly the shape of access D6's named exception describes even though D6
itself never lists them. The argument is that these two reads sit on D6's
"support access" side of its own line, not that D6 said so explicitly — hence
a deliberate extension, recorded here rather than silently assumed, so the
owner can see the reasoning and disagree with it if the line should sit
elsewhere. It does not reopen D6's "no noise from ordinary reads" half, which
stays correct and unchanged.

### D4 — FR-192 (continued): the resolver learns the TENANT `RoleBinding` scope

ADR-077 D3 added `scopeType` to `RoleBinding` and left it inert on purpose
("nothing resolves a TENANT binding until the resolver is taught to expand
it"). `resolveRoleBindings` in `resolve-viewer.js` now also queries
TENANT-scoped bindings and expands each to every ACTIVE Business the named
Tenant holds at each request — including Businesses created after the grant, which a TENANT binding reaches without a new assignment — the same tenant-wide expansion
`buildDomainsByBusiness` already performs for a tenant-wide `Membership`,
applied here to `RoleBinding` instead. This is deliberately **independent** of
`visibleBusinessIds`: a TENANT `RoleBinding` is authority granted *at* the
Tenant, not a widening of whatever `Membership` already made visible, so a
person could in principle hold a TENANT role binding without an accompanying
Membership at all (nothing in this change creates that shape; the resolver
simply does not assume it cannot exist).

This is the smallest edit that does it. `hasPermission` is untouched — it only
ever reads `permissionsByBusinessId`, so the only surface this widens is what
populates that map. `RoleBinding.businessId` becomes nullable (a TENANT-scoped
row has none), which retires the unconditional
`@@unique(personId, businessId, roleKey)` index — under a nullable column
Postgres treats NULLs as distinct, so it had already stopped deduplicating a
TENANT row — replaced by two partial unique indexes, one per scope, the same
ADR-077 D4 pattern used throughout this change. `assignRoleBinding` continues
to support BUSINESS scope only (`requireBusinessScope`); nothing in this
change adds a write path for TENANT-scoped `RoleBinding` rows, which stay
reachable only by direct grant today, the same way `Membership.scopeType =
'TENANT'` was reachable before `grantBusinessMembership` existed. Writing that
path is left to a later change, deliberately: this ADR's job was to make the
already-declared scope legible to the one function whose job is reading it,
not to build a new issuance surface for it.

This is stated as the single most dangerous edit in this ADR. Three
authorization escalations in this repository came from editing
`resolveViewer` or its helpers. The change is proved by a test asserting a
TENANT binding grants its permission on every Business in the named Tenant and
on none outside it — see FR-192's feature note for the fixture shape.

## Consequences

**An owner can invite someone into a Business who has no account yet**, with an
expiring, single-use, revocable token — the gap ADR-077's review named and did
not close. **Three-way match is now possible in procurement** — the roles a
control depends on cannot be held by one person without a Tenant owner saying
so, on the record. **Revenue integrity holds at the transaction, not only at
role assignment** — the ADR-065 promise that VERIFIED money is trustworthy is
now something the write refuses to perform SILENTLY, not only something a role
assignment discourages. Stated precisely, because the difference matters to an
auditor: this is a **detective** control, not a preventive one. Anyone holding
the verify capability may still verify what they recorded — by passing
`selfVerifyAttested`, which BR-035 requires so a genuinely one-person business
is not locked out of its own money. What the change removes is the ability to do
it without leaving `selfVerified: true` in the audit row. **This installation can recover from a lost operator
credential** without a hand-written SQL statement, and the operator's own use
of that power is now itself part of the auditable record ADR-017 D6 asks for
of everyone else with comparable reach.

**What is service-level only, and therefore not yet reachable from the product.**
`mintAccessInvite` and `acceptAccessInvite` have no HTTP route at TENANT or
BUSINESS scope, and `issueOperatorGrant` has neither a route nor a CLI. An owner
cannot yet invite someone into a Business by clicking, and a standing operator
cannot yet issue a second grant without a script. The services, their refusals
and their audit events are built and tested; the surfaces are separable
follow-on work, and are named here rather than left to be discovered.

**Costs accepted.** `PROCUREMENT_BUYER` alone can no longer receive against its
own orders — a single-person procurement operation must now either add a
second person or have its Tenant owner explicitly override the conflict, on
the record, every time the same person is asked to hold both roles. A Business
OWNER can no longer verify their own recorded payment or receive their own
purchase order silently — a genuinely one-person Business must explicitly
attest to it each time, which is friction by design: the alternative is an
integrity control with a permanent hole shaped exactly like its most senior
user. `AccessInvite`'s indexes and RLS policy still carry the `WorkspaceInvite`
name after the rename — cosmetic only, since Postgres tracks both by OID, but
worth naming so a future reader is not confused by it.

## Alternatives considered

**Let `ownsBusiness` satisfy the self-verify and self-post refusals, as it
does every other capability check in these two files.** Rejected as the entire
point of D2: an OWNER holding every permission is exactly the scenario the
refusal exists to catch, and exempting OWNER would leave the control silent for
the one class of user most likely to be the sole person in the loop.

**Resolve an `AccessInvite` at acceptance by matching `invitedEmail` against
`Person.email` and granting to whichever Person that resolves to.** Rejected:
this would make the grant's recipient a function of a mutable column looked up
at a different moment than the token was presented, rather than of the
session that actually completed the flow — the same class of bug SEC-014
already forbids for `personId` at the route boundary, applied one layer
further in.

**Merge `RoleBinding`'s TENANT-scope write path into `assignRoleBinding` in
this same change.** Rejected for scope discipline: this ADR's task was
teaching the *reader* the scope ADR-077 D3 already declared, not building a new
*writer* for it. Adding a TENANT-scope issuance surface is a decision with its
own authority question (who may grant Tenant-wide role authority, and under
what review) that deserves its own decision rather than riding in in this one.

**Make `PlatformGrant.expiresAt` NOT NULL for every row, backfilling existing
grants with a far-future date.** Rejected: the existing bootstrap grant is
`standing` by definition — the installation's foundational authority, not a
time-boxed delegation — and inventing an arbitrary expiry for it would be a
migration asserting a fact ("this access ends on date X") that nobody decided.
`standing: true` says the honest thing: this grant predates the very concept
of an expiry.

## Implementation

Declared by **FR-195** (AccessInvite), **FR-196** (segregation of duties),
**FR-197** (operator lifecycle), **BR-035**, **SEC-027**, **SDD-094**, bundled
as **FEAT-029**. Feature notes:
[FR-195](../domains/identity/features/FR-195-access-invite.md),
[FR-196](../domains/identity/features/FR-196-segregation-of-duties.md),
[FR-197](../domains/identity/features/FR-197-operator-access-lifecycle.md).

Migration: `apps/server/supabase/migrations/20260912140000_access_invite_sod_operator.sql`.
Preconditions (zero `WorkspaceInvite` rows, no existing NULL `RoleBinding.businessId`,
no duplicate `(personId, capability)` `PlatformGrant` pair) are re-asserted at
apply time rather than trusted, the same discipline
`20260912120000_access_grant_lifecycle.sql` uses.

Sequencing:

| # | Step | Why here |
|---|---|---|
| 1 | Schema: `AccessInvite` rename + columns; `RoleBinding.businessId` nullable + partial uniques; `PlatformGrant` columns + partial unique | Additive and inert; every later step depends on the grammar existing |
| 2 | `resolveRoleBindings` reads TENANT scope | Must precede nothing new writing it — this is a reader-only change (D4) |
| 3 | `rbac.js` role split + `ROLE_CONFLICTS`; `assignRoleBinding` conflict check | Must precede the transaction-level refusals, so a role assigned today is already evaluated against tomorrow's conflict declaration |
| 4 | `payment-service.js` / `goods-receipt-service.js` self-verify refusals | The repair ADR-065/ADR-066 D4 assumed was already there |
| 5 | `access-invite-service.js`; `operator-bootstrap.js` issuance + `operator-use.js` | The two remaining repairs, independent of 1-4 and of each other |
