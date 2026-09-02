---
domain: identity
feature: FR-038
module: identity
source: v2-native
---

# FR-038 — My Profile and Users & Permissions

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-13 |
| **Relates to** | HANDOFF-SHELL-V2-CODEX §5 step 8, FR-031, SEC-003 |

`/profile` reads the current resolved principal, preserves a local TH/EN display
preference, reports linked LINE identities, and identifies the authenticated
session represented by the signed HttpOnly cookie issued at login.

`/platform/users` is guarded by `resolveViewer()` and returns 403 to non-OWNER
viewers. An owner may set `OWNER`/`MEMBER` and domain checkbox grants on existing
Memberships. `domainKeysJson` is a Membership allow-list: an empty list denies
domain visibility to a MEMBER; an OWNER or platform DEV always receives all
current domains by role. The resolver, rather than UI checkbox state, computes
the effective grant. Every edit writes an AuditEvent.

## Attaching a Person to a Business (2026-09-02)

`POST /api/platform/users/memberships` closes the one hole the roster left open.
Every other Membership-creating path binds only the person performing it —
FR-074(c) makes a Business's creator its OWNER — so a colleague who already had
an account had no route to a first Business-level grant from any surface
(D3-identity-onboarding-forms-12). The owner of a Business now attaches an
**existing** Person to it, matched exactly on `Person.code` or `Person.email`,
as an ACTIVE `MEMBER` with a chosen subset of domain keys.

Three deliberate limits, each of which could have been relaxed and should not be:

1. **It never creates a Person.** Signup (FR-120) and onboarding (FR-066) own
   identity creation; an owner-facing form that quietly minted accounts would be
   a second, unaudited way into the installation. An identifier matching nothing
   is refused.
2. **Role is fixed at `MEMBER`.** Promotion is the existing PATCH, so "was given
   access" and "was made an owner" stay two distinguishable rows in the audit
   stream.
3. **Exact match only, and authority before existence.** A Business the caller
   does not own answers identically to one that does not exist (404-shaped,
   SEC-001); a duplicate answers 409. The lookup is not a prefix or contains
   search, because a fuzzy people-search on an administrative surface is a
   directory-enumeration tool in an invite form's clothing.

The new column is an additive schema change. Like FR-037, the project has no
Prisma migration baseline, so an additive SQL artifact accompanies the existing
`db:push` local workflow and the generated Postgres schema is kept equivalent.
