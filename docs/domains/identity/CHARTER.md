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
- `eraseCustomerPrincipal` (FR-022) is erasure's one production trigger, behind
  `POST /api/crm/customers/[customerId]/erasure`. It adds no authority of its own:
  it reuses the FR-103 consent writer's shape — per-Business OWNER over a Business
  in the Customer's tenant (BR-001), or the installation operator — refuses with
  404 in every case so an irreversible action cannot double as an existence
  oracle (FR-072), and requires a typed `confirmation: 'ERASE'` checked before any
  lookup. Inside `erasePrincipal`'s transaction it reaches `Message.body` and the
  matching `RawExternalRecord` payloads only through the crm and integration
  contract exports, never by writing those models directly.
- `assertDomainVisible(viewer, businessId, domainKey)` (FR-061/062) is the one
  server-side answer to "may this principal use this domain in this Business";
  the crm, market and people read models apply it and refuse 404-shaped.
- `resolveAuthorizationContext` and `authorizeScope` — the server-owned policy
  decision used before protected Web/API, agent and tool work. Client, prompt,
  model and tool scope values cannot widen this context.
- `Session` is live request authority; a signed cookie without an active,
  unexpired Session row is not authenticated in the persisted runtime.
- `resolveSotDataPlaneViewer` (FR-102) is a second, narrower request identity: a `SotDataPlaneKey` bearer token scoped to one Tenant, used only by the two FR-100 SoT decision submit/export routes for the external data plane. It never produces an `isOperator` or Person-shaped viewer and is checked ahead of, not instead of, the session seam.
- `listUserPermissions`, `updateUserPermissions` and `addBusinessMembership`
  (FR-038) are the one seam that administers `Membership` role and per-domain
  grants. `addBusinessMembership` attaches an **existing** Person to a Business
  the caller owns, as an ACTIVE MEMBER: it is not an identity creator — signup
  (FR-120) and onboarding (FR-066) own that — and it never grants OWNER, which
  stays a separate, separately audited act through `updateUserPermissions`.
  Listed here because it is a write to `Membership`, a model the project-manager
  charter owns; it sits beside the role/domain writes that were already this
  domain's, rather than opening a second write path for one row.
- `resolveApiAccessViewer` (FR-106) generalizes the same pattern for the FR-019
  Enterprise API: an `ApiAccessKey` bearer token scoped to one Tenant, accepted
  only by the Enterprise API routes (dry-run/commit/resolve/docs), with
  `isApiAccessFor` as its authority predicate. Minted by the installation
  operator or a Tenant owner (`mintApiAccessKey`), listed back as metadata only
  by that same authority (`listApiAccessKeys` — id, label, display prefix,
  status, timestamps; never key material, because the raw secret exists exactly
  once and a listing that could return it would undo that), revoked with effect
  on the next request (`revokeApiAccessKey`), stored digest-only, audited
  without token material, never readable back. It, too, never produces an
  `isOperator` or Person-shaped viewer.
- `plugin-auth-service` (FR-123) is a **third** request identity, and the one
  that is easiest to confuse with the second: `createPluginAuthorizationCode`,
  `exchangePluginAuthorizationCode`, `getPluginCapabilities`,
  `revokePluginToken`. Where `ApiAccessKey` is a long-lived Tenant-bound service
  credential held by a server, a `PluginSession` is a 15-minute delegation from
  one signed-in Person to one plugin installation on their own machine. It is
  minted only from a live browser session **plus an act of consent by the
  person** (ADR-052 D4: `GET /authorize` renders `/plugin/authorize` and mints
  nothing; a POST from that form, bound by a session-bound anti-CSRF token and
  an HMAC-signed request token, is the only path that mints), carries no Tenant
  of its own, and resolves scope by calling `resolveViewer` for that Person —
  **without** `platformGrant`, so a plugin can never inherit cross-tenant DEV
  visibility. The consent screen derives its capability list from that same
  grant-free viewer, because a screen that showed a platform DEV their browser
  scope would over-state what the plugin receives. Codes and tokens are stored
  as SHA-256 hashes only; the two consent tokens are stored nowhere at all. Neither credential may be
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
