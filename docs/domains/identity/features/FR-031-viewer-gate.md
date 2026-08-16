---
domain: identity
feature: FR-031
module: identity
source: v2-native
---

# FR-031: Viewer gate seam

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-13 |
| **Relates to** | ADR-008 §D4, HANDOFF-SHELL-V2-CODEX §3 and §5 step 1 |

## Decision

`resolveViewer()` is the single read-only seam between a future authenticated session
and the business-centric shell. It returns:

```js
{ principal, role, visibleBusinessIds, ownedBusinessIds, domainsByBusinessId, visibleDomains, isPlatform }
```

Two fields were added after this slice, both because `role` and `visibleDomains`
are *per-principal* answers that consumers read as *per-Business* ones:
`ownedBusinessIds` (FR-059) and `domainsByBusinessId` (FR-061). See
[FR-061](FR-061-per-business-domain-visibility.md) and the
[incident](../../../../.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md).

The resolver does not add authentication, new persistence, or UI guards in this slice.
Those consumers are introduced by the later Home and permissions steps.

## Access rules

- `MEMBER` sees only `Membership.businessId` records. A tenant-wide membership
  (`businessId: null`) sees that tenant's businesses.
- `OWNER` follows the same persisted membership scope until a future ownership model
  is introduced; it does not infer cross-tenant access.
- `DEV` is a trusted platform grant supplied by the authentication layer. It sees all
  tenants and businesses, is never represented as a business Membership, and later
  privileged actions must be audited.
- In local development only, absent session identity resolves to the seeded local owner
  with all businesses and domains. Production callers must supply a principal.

## Rationale

Membership is tenant/business-scoped, while platform support is intentionally
cross-tenant. Combining them would let an OWNER become a platform operator by accident.
The resolver makes the distinction explicit before Home, scope selection, or route
guards consume it.
