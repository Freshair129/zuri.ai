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
preference, reports linked LINE identities, and identifies the local demo session.
It is not a production authentication/session system.

`/platform/users` is guarded by `resolveViewer()` and returns 403 to non-OWNER
viewers. An owner may set `OWNER`/`MEMBER` and domain checkbox grants on existing
Memberships. `domainKeysJson` is a Membership allow-list: an empty list denies
domain visibility to a MEMBER; an OWNER or platform DEV always receives all
current domains by role. The resolver, rather than UI checkbox state, computes
the effective grant. Every edit writes an AuditEvent.

The new column is an additive schema change. Like FR-037, the project has no
Prisma migration baseline, so an additive SQL artifact accompanies the existing
`db:push` local workflow and the generated Postgres schema is kept equivalent.
