---
domain: identity
module: src/modules/identity
owns_routes:
  - src/app/(entry)/**
  - src/app/login/**
  - src/app/api/entry/**
owns_models:
  - ExternalIdentity
  - IdentityLinkToken
  - ExternalRef
  - RoleBinding
  - PersonCredential
  - PasswordResetToken
  - Session
  - ChannelIdentity
  - SotDataPlaneKey
---

# Domain charter — identity

Who a principal is and what they may see: external identity resolution
(lineUserId → Person), link tokens, principal classification
(CUSTOMER / MEMBER / OWNER), persisted session lifecycle, channel onboarding,
the shared policy-enforcement point, the viewer gate, and PDPA erasure.

## Boundaries

- External ids are never primary keys — internal UUID + human `code` +
  ExternalRef mapping (BR-002). This domain owns that mapping discipline for
  everyone.
- Erasure (FR-022) revokes identities and redacts the global Person; it is the
  only flow allowed to do so.
- Does not run agent turns and does not ingest messages — it answers "who is
  this and what are they allowed to see", nothing else.

## Public contract

- `resolveLineIdentity` — the one resolver; no other site may resolve a
  lineUserId on its own (see the identity impact scan, archived).
- `classifyPrincipal`, the viewer gate, `erasePrincipal`.
- `resolveAuthorizationContext` and `authorizeScope` — the server-owned policy
  decision used before protected Web/API, agent and tool work. Client, prompt,
  model and tool scope values cannot widen this context.
- `Session` is live request authority; a signed cookie without an active,
  unexpired Session row is not authenticated in the persisted runtime.
- `resolveSotDataPlaneViewer` (FR-102) is a second, narrower request identity: a `SotDataPlaneKey` bearer token scoped to one Tenant, used only by the two FR-100 SoT decision submit/export routes for the external data plane. It never produces an `isOperator` or Person-shaped viewer and is checked ahead of, not instead of, the session seam.
- The viewer's authority questions have one answer each, and none of them is
  the global `role` label: **may I write here** → `ownedBusinessIds` (FR-059),
  **which domains may I see here** → `domainsForBusiness(viewer, businessId)`
  (FR-061). `visibleDomains` answers "anywhere", never "here". The pure rule
  lives in `viewer-domains.js` with no I/O, because both consumers are client
  components.

- Product Owner is the `PRODUCT_OWNER` key in the generic Business-scoped
  `RoleBinding` registry resolved by `resolveViewer`; `Membership.role`,
  platform `DEV`, Workspace/Portfolio ancestry and visibility do not infer it
  (FR-076 / ADR-033).

## Approved next boundary (ADR-027)

Profile completion is an identity step over `Person`, not an authorization grant.
The Profile-first entry may resolve a Profile-only person into a Waiting Room
without creating a Tenant, Business or Project. Workspace invitation and
WorkspaceMembership are a separate collaboration contract from the existing
Tenant/Business `Membership`; they must not widen `visibleBusinessIds`,
`ownedBusinessIds`, or per-Business domain grants. This boundary is documented in
FR-066/067 and remains implementation-pending.

## Known shared-write exceptions (debt, visible on purpose)

- Writes `Person` (owned by crm) during linking and erasure — recorded in both
  charters; target state is a crm contract call.
