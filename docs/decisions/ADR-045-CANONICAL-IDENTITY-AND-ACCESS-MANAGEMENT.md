# ADR-045 — Canonical Identity and Access Management Boundary

**Status:** Approved for Phase 0 implementation
**Date:** 2026-08-22
**Decided by:** Boss, ATHER
**Relates to:** [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md), [ADR-017](ADR-017-PRODUCTION-VIEWER-SESSION-AND-ENTRY-READ-MODEL.md), [ADR-022](ADR-022-MULTI-TENANT-MSP-VAULTS.md), [ADR-027](ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md), [ADR-033](ADR-033-CUSTOMER-SCOPE-AND-PRODUCT-OWNER-AUTHORITY.md), Issue #99

## Context

Issue #99 requires one identity and authorization contract across the web
console, LINE, API/MCP, agent turns and tool calls. The repository already has a
canonical `Person`, tenant-scoped `ExternalIdentity`, signed browser sessions,
Business-scoped `Membership`/`RoleBinding`, and separate agent gates. The gap is
that authentication is currently token-centric, Membership lifecycle is not
represented, and agent/tool authorization is not one shared policy-enforcement
point. Those seams can disagree after revocation or when a client/model supplies
scope-looking fields.

The system remains a modular monolith. Supabase/Auth providers and LINE
transport are authentication or transport adapters; neither becomes the
application's principal, scope or permission authority.

## Decision

### D1 — Identity hierarchy and namespaces

`Person.id` is the only canonical human principal identifier. Provider subjects,
LINE user IDs, OIDC `sub` values, email addresses and API identifiers are
external attributes mapped through a provider/channel namespace. An external
subject is never a primary key and cannot by itself grant access.

`ExternalIdentity` remains the compatibility record for the existing LINE
resolver. `ChannelIdentity` is the forward contract for channel bindings and
adds explicit channel-account namespace and lifecycle state; migration of live
rows is a later production gate, not an implicit side effect of this change.

### D2 — Persisted session authority

The browser cookie is transport only. A successful credential login creates a
persisted `Session` containing a hash of the opaque signed token, the Person,
expiry, assurance, status and revocation metadata. Every protected request
revalidates the live row. Expiry, revocation, deleted Person, or inactive
Membership denies the next request. Logout revokes the current row; a future
logout-all operation revokes all rows for the Person.

The signed token remains a compatibility envelope for the local runtime, but a
production session is not valid merely because its signature is valid.

### D3 — Membership and role semantics

`Membership.status` is one of `ACTIVE`, `PENDING`, `SUSPENDED` or `REVOKED`.
Only `ACTIVE` Membership rows contribute to visibility, staff classification or
authorization. `Membership.role` remains a coarse per-membership label;
Business-scoped capabilities continue to come from active `RoleBinding` rows
and the role registry. Team membership, payload roles and client-selected scope
never grant authority.

### D4 — One policy-enforcement point

The identity domain owns `resolveAuthorizationContext()` and
`authorizeScope()`. A trusted request, agent turn, action gate or tool invocation
must resolve the same server-owned Person, Tenant/Business scope, active
Membership and active RoleBinding set before reading data, retrieving memory or
executing a mutation. Deny happens before the protected operation. The context
is immutable for the turn and cannot be widened by request payload, prompt,
model output or tool arguments.

The agent and MSP boundary receives the resolved authorization context and
authorized vault/resource set; it does not resolve a second identity or accept a
raw vault, tenant, business or principal argument.

### D5 — LINE and future provider boundary

LINE signature verification proves event origin only. A channel binding and a
server-owned onboarding/linking flow resolve the Person. Unknown or unverified
subjects enter a pending state and receive no private data. Raw LINE IDs,
emails, display names or chat payload claims are not proof of membership.
OIDC, MFA, recovery and device management are compatible future adapters, but
remain outside the Phase 0 implementation boundary.

### D6 — Audit and migration boundary

Session creation, revocation, membership lifecycle changes and privileged
allow/deny decisions are auditable with redacted payloads. No token, secret,
password, LINE reply token or customer message is written to the audit payload.
The additive SQLite/Postgres schema is the local implementation artifact; live
Supabase migration, provider configuration, RLS/role verification and rollout
remain explicit production gates.

## Consequences

- Web, API, LINE, agent and tool paths share one policy vocabulary and can be
  tested for equivalent decisions.
- Session revocation is effective across process restarts and instances once
  they share the database.
- Existing `ExternalIdentity` and signed-session callers require compatibility
  adapters during migration; this ADR does not silently rewrite live provider
  data.
- LINE LIFF/Login, OIDC, MFA, account recovery and production Supabase rollout
  remain Phase 1/2 work and are not represented as completed by this ADR.

## Implementation boundary

Phase 0 implements the additive Session/ChannelIdentity schema, Membership
lifecycle fields, the shared identity policy seam, persisted session
revalidation/revocation, and agent/tool adoption with negative tests. The issue's
remaining provider and production gates are tracked in
`docs/roadmap/PLAN-FR-094-PRODUCTION-IAM.md`.
