---
id: ZAI:FR-200-NOTE
title: Explicit Superadmin access
feature: FR-200
domain: identity
module: identity
source: v2-native
version: "1.0.0"
status: accepted
created_at: "2026-09-13T04:25:00+07:00,RWANG"
last_update: "2026-09-13T04:25:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-200
  - type: relates_to
    target: ZAI:ADR-082
  - type: relates_to
    target: ZAI:FEAT-029
---

# FR-200 — Explicit Superadmin access

## Behavior and ownership

Identity owns a separate, audited SUPERADMIN PlatformGrant. The browser session
resolves it live; an ordinary OPERATOR stays DEV and receives no ownership.
Superadmin receives effective administration of every real scope without
creating Membership or Employment rows. See ADR-082 for the approved boundary.

## Input, output and failures

The administrative CLI accepts grant/revoke, exact target and actor email, and a
reason. Grant additionally requires an ISO expiry no more than 90 days ahead.
No password, session token or other credential is an input or output. Missing or
ambiguous accounts, disabled accounts, unauthorized actors, duplicate live grants
and invalid expiry fail without creating a grant or audit event.

## Acceptance criteria

- All existing pages' domain, owner and installation guards admit the resolved
  Superadmin in every actual Tenant/Business; new scopes are included on refresh.
- Workspace administration works even for a Portfolio with no Tenant yet.
- Operator-only, ordinary owner/member and scoped plugin behavior stay unchanged.
- Request headers and token payload claims cannot mint Superadmin authority.
- Expiry/revocation removes Superadmin on the next resolution, preserving any
  independent ordinary Membership or OPERATOR grant.
- Grant/revoke and their audit records commit atomically; failure rolls back both.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-13 | accepted | Approved Superadmin access contract | pending | RWANG |
