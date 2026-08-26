---
domain: identity
feature: FR-094
module: identity
source: v2-native
---

# FR-094..FR-098 — Production Identity and Access Management

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | P0 implemented locally; provider and production migration gates open |
| **Date** | 2026-08-22 |
| **Relates to** | Issue #99, ADR-044, ADR-045, ADR-017, ADR-022, ADR-027, ADR-033 |

## Contract

The IAM feature is one identity boundary over the existing modular monolith.
Supabase/Auth providers, LINE signature verification and MSP are adapters around
that boundary; they do not own Zuri principals or scope.

### FR-094 — canonical principal and membership authority

When a trusted provider or local credential resolves an identity, the server
shall resolve one internal `Person` principal through a namespaced external or
channel binding. A provider subject that is unknown, revoked, ambiguous or
mapped to more than one Person shall not resolve to private authority. Only an
`ACTIVE` Membership and an active, scope-valid RoleBinding can contribute to an
authorization decision.

### FR-095 — session and account lifecycle

When login succeeds, the server shall persist a revocable Session bound to the
Person and store only a hash of the opaque token. On every protected request the
server shall verify the signed envelope and live Session status/expiry. Logout,
membership suspension, Person erasure or Session revocation shall deny the next
protected request without waiting for cookie expiry.

### FR-096 — shared policy enforcement

For every protected web/API request, agent turn, action and tool invocation, the
server shall resolve trusted principal, Tenant/Business scope, active
Membership, role and permission before the protected read or write. If the
context is missing, stale, cross-tenant or not authorized, the operation shall
be denied before data retrieval, model execution or tool side effects. Payload,
prompt, model output and tool arguments may attenuate a server-owned scope but
may not widen it.

### FR-097 — verified channel onboarding

When a LINE transport presents a valid signature, the server shall treat that as
transport authenticity only. A new channel subject shall enter a pending
onboarding/linking state; only a server-owned verified link and active
Membership can expose private data or invoke staff capabilities. A raw LINE ID,
email, display name or message claim shall never be accepted as identity proof.

### FR-098 — agent, tooling and MSP authorization

Before an agent action, retrieval or tool call reaches its handler, the shared
policy seam shall authorize the action against the immutable turn context. The
handler shall use only server-resolved Person/Tenant/Business/resource/vault
identifiers. A denied decision shall be audited without secrets or customer
content, and an MSP adapter shall receive only the authorized result, never a
client/model-selected vault or scope.

## P0 acceptance criteria

1. A persisted session is required in production mode; a valid signature with a
   missing, expired or revoked Session row is unauthenticated.
2. `resolveViewer`, staff classification and agent context ignore non-active
   Memberships.
3. One shared authorization context is used by web viewer resolution, agent
   action gating and read-only tool handlers.
4. Forged `tenantId`, `businessId`, `principalId`, role or vault arguments do
   not change an authorized tool query.
5. Suspended membership, cross-tenant scope and missing authorization fail
   closed before protected work.
6. Session revocation, policy denial and lifecycle changes have redacted audit
   evidence where the owning path already has an audit boundary.

Provider-specific onboarding, OIDC/LINE Login, MFA, recovery, device/session
management UI, live Supabase migration/RLS proof and production canary are
explicit follow-on gates, not P0 completion claims.

The next local candidate is documented in
[`PLAN-FR-097-VERIFIED-CHANNEL-ONBOARDING.md`](../../../roadmap/PLAN-FR-097-VERIFIED-CHANNEL-ONBOARDING.md).
