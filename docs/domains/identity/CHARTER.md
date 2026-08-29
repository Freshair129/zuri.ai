---
domain: identity
module: src/modules/identity
owns_routes:
  - src/app/(entry)/**
  - src/app/login/**
  - src/app/signup/**
  - src/app/reset-password/**
  - src/app/api/auth/**
  - src/app/api/entry/**
  - src/app/api/onboarding/**
  - src/app/api/workspace-invites/**
  - src/app/api/workspace-memberships/**
  - src/app/api/plugin/auth/**
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
  - WorkspaceMembership
  - WorkspaceInvite
  - ApiAccessKey
  - PlatformGrant
  - PluginInstallation
  - PluginAuthorizationCode
  - PluginSession
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
- `resolveApiAccessViewer` (FR-106) generalizes the same pattern for the FR-019
  Enterprise API: an `ApiAccessKey` bearer token scoped to one Tenant, accepted
  only by the Enterprise API routes (dry-run/commit/resolve/docs), with
  `isApiAccessFor` as its authority predicate. Minted by the installation
  operator or a Tenant owner (`mintApiAccessKey`), revoked with effect on the
  next request (`revokeApiAccessKey`), stored digest-only, audited without
  token material, never readable back. It, too, never produces an `isOperator`
  or Person-shaped viewer.
- `plugin-auth-service` (FR-123) is a **third** request identity, and the one
  that is easiest to confuse with the second: `createPluginAuthorizationCode`,
  `exchangePluginAuthorizationCode`, `getPluginCapabilities`,
  `revokePluginToken`. Where `ApiAccessKey` is a long-lived Tenant-bound service
  credential held by a server, a `PluginSession` is a 15-minute delegation from
  one signed-in Person to one plugin installation on their own machine. It is
  minted only from a live browser session, carries no Tenant of its own, and
  resolves scope by calling `resolveViewer` for that Person — **without**
  `platformGrant`, so a plugin can never inherit cross-tenant DEV visibility.
  Codes and tokens are stored as SHA-256 hashes only. Neither credential may be
  accepted where the other is expected (ADR-052, ADR-047).
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

## Profile-first onboarding and the Workspace collaboration boundary (ADR-027, implemented)

Profile completion is an identity step over `Person`
(`Person.profileCompletedAt`, written by `onboarding-service`), not an
authorization grant. The Profile-first entry resolves a Profile-only person into
the Waiting Room without creating a Tenant, Business or Project. Workspace
invitation (`WorkspaceInvite`, hash-bound single-use tokens per SEC-014) and
`WorkspaceMembership` (keyed by `portfolioId`, ADR-027 §D2) are a separate
collaboration contract from the existing Tenant/Business `Membership`; they
widen nothing — `resolveViewer` never reads `WorkspaceMembership` (BR-016), so
holding one grants no `visibleBusinessIds`, `ownedBusinessIds`, or per-Business
domain. Implemented by FR-066/067 (`onboarding-service.js`,
`workspace-membership-service.js`).

## Known shared-write exceptions (debt, visible on purpose)

- Writes `Person` (owned by crm) during linking, erasure, FR-066 profile
  completion (`displayName`/`email`/`profileCompletedAt` in
  `onboarding-service.js`) and FR-120 self-serve signup (`signup-service.js`
  creates the row alongside the `PersonCredential` this domain does own) —
  recorded in both charters; target state is a crm contract call. FR-120 is the
  same allowance rather than a new claim: it writes the same three columns, in
  the same lane, for the step that comes immediately before FR-066's.
