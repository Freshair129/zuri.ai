---
domain: identity
module: src/modules/identity
owns_routes:
  - src/app/(entry)/**
  - src/app/login/**
  - src/app/access-denied/**
  - src/app/signup/**
  - src/app/reset-password/**
  - src/app/api/auth/**
  - src/app/api/entry/**
  - src/app/api/onboarding/**
  - src/app/api/workspace-invites/**
  - src/app/api/workspace-memberships/**
  - src/app/api/plugin/auth/**
  - src/app/api/platform/edge-devices/**
  - src/app/harness/**
  - src/app/api/platform/harness-pairing/**
  - src/app/api/platform/harness-devices/**
owns_models:
  - ExternalIdentity
  - IdentityLinkToken
  - ExternalRef
  - Membership
  - RoleBinding
  - PersonCredential
  - PasswordResetToken
  - Session
  - ChannelIdentity
  - SotDataPlaneKey
  - WorkspaceMembership
  - AccessInvite
  - ApiAccessKey
  - PlatformGrant
  - PluginInstallation
  - PluginAuthorizationCode
  - PluginSession
  - EdgeDeviceCredential
  - HarnessCredential
  - MfaFactor
  - RateLimitBucket
  - PasskeyCredential
---

# Domain charter — identity

> For LLM readers: [llms.txt](../../../llms.txt) is the repository index, and
> The optional one-file corpus can be built locally with `npm run docs:llms`;
> its `llms-full.txt` output is generated and not committed.

Who a principal is and what they may see: external identity resolution
(lineUserId → Person), link tokens, principal classification
(CUSTOMER / MEMBER / OWNER), persisted session lifecycle, channel onboarding,
the shared policy-enforcement point, the viewer gate, and PDPA erasure.

## Boundaries

- The generic `/access-denied` handler owns the final HTTP403/noindex/no-store
  response and links to Login/change account and home. It reveals no account or
  protected data and grants no authority. Platform Control selects this outcome
  only after its existing trusted viewer predicate refuses an authenticated
  account; absence of a session still follows the Login boundary.
- External ids are never primary keys — internal UUID + human `code` +
  ExternalRef mapping (BR-002). This domain owns that mapping discipline for
  everyone.
- Erasure (FR-022) revokes identities and redacts the global Person; it is the
  only flow allowed to do so.
- Does not run agent turns and does not ingest messages — it answers "who is
  this and what are they allowed to see", nothing else.

## Public contract

For the session contract, write-protection coverage, rate limits and the
application/database isolation boundary, see [Identity System Diagram, sections
5–9](SYSTEM-DIAGRAM.md#5-human-sign-in-flows).

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
- **Retired Edge device credential contract (FR-144, ADR-041 D3; ADR-110).** The
  former `resolveEdgeDeviceContext` resolver and `/api/platform/edge-devices/**`
  routes are retired; the former FR-143 Edge extraction and FR-141 heartbeat
  consumers are absent from the active route tree. `EdgeDeviceCredential` remains
  in the schema as historical data.
- `listUserPermissions`, `updateUserPermissions` and `addBusinessMembership`
  (FR-038) are the one seam that administers `Membership` role and per-domain
  grants. `addBusinessMembership` attaches an **existing** Person to a Business
  the caller owns, as an ACTIVE MEMBER: it is not an identity creator — signup
  (FR-120) and onboarding (FR-066) own that — and it never grants OWNER, which
  stays a separate, separately audited act through `updateUserPermissions`.
  `Membership` is **this domain's model** since ADR-077 D8; it moved here from
  the project-manager charter together with the rule that only this lane may
  write it. `membership.create`, `.update` and `.delete` appear nowhere outside
  `src/modules/identity/`, enforced by a preflight ratchet, because a table that
  three services in two lanes could write is a table whose lifecycle no service
  could own.
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

- `mfa-service` (TOTP enrollment, confirmation, step-up challenge, list, revoke)
  is the one seam over `MfaFactor`, and `mfa-secret-seal.js` is the one place a
  factor secret is encrypted or decrypted (SEC-029, SDD-096, ADR-088).
  `MfaFactor.secret` holds only an AES-256-GCM envelope bound to its Person and
  factor row under the deployment's `ZURI_MFA_SECRET_KEY`; no other file may
  create a cipher over it, and a production deployment without the key refuses
  MFA with 503 rather than falling back. The only other writer of the column is
  the operator sweep `resealMfaFactorSecrets` (`scripts/seal-mfa-factor-secrets.mjs`),
  which moves plaintext rows written before ADR-088 and rows under a retired key
  version; the reader never accepts plaintext. The seal module imports nothing but
  `node:crypto`, so the proposed shared credential vault can replace its body
  without touching a caller.

- Product Owner is the `PRODUCT_OWNER` key in the generic Business-scoped
  `RoleBinding` registry resolved by `resolveViewer`; `Membership.role`,
  platform `DEV`, Workspace/Portfolio ancestry and visibility do not infer it
  (FR-076 / ADR-033).

## Profile-first onboarding and the Workspace collaboration boundary (ADR-027, implemented)

Profile completion is an identity step over `Person`
(`Person.profileCompletedAt`, written by `onboarding-service`), not an
authorization grant. The Profile-first entry resolves a Profile-only person into
the Waiting Room without creating a Tenant, Business or Project. Workspace
invitation (`AccessInvite`, renamed from `WorkspaceInvite` by FR-195/ADR-079 to
also cover TENANT/BUSINESS scope; hash-bound single-use tokens per SEC-014) and
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

## Agent harness devices (FR-220, ADR-087 — retired by ADR-110)

Historically, an approved harness carried a person-bound, hashed
`HarnessCredential` for programme usage attribution. ADR-110 retired pairing,
device-management and reporting routes in the repository; `HarnessCredential`
remains in the schema as historical data.

## Credential-write step-up gate and PDPA erasure fan-out (ADR-089, ADR-091 — gate merged, erasure fan-out declared)

- **Step-up gate (FR-224, [ADR-089](../../decisions/ADR-089-BROWSER-WRITE-ONLY-CREDENTIAL-VAULT-AND-SELF-SERVE-LINE-OA-ONBOARDING.md) D4) —
  merged in #398 (main 2aef8caa; TASK-ZAI-080; migration 20260914140400 applied on production 2026-09-14, not deployed).**
  `credential-write-gate.js` is the gate other lanes call before a credential write,
  rotation, revocation or live validation: `assertCredentialWriteAssurance` refuses a
  Person with no ACTIVE TOTP factor `MFA_FACTOR_REQUIRED` (with the enrolment path),
  then requires a live `elevatedUntil` on the persisted Session. A WebAuthn login
  stamps the same 900-second window and remains AAL2 for general assurance, but
  never substitutes for this recent step-up; stored `assuranceLevel` is descriptive
  only, including old AAL2 values left by previous releases. The exact server-only
  ADR-100 setting `ZURI_CREDENTIAL_STEP_UP=off` remains an explicit exception for
  credential writes.
  `createCredentialWriteGuard` composes the gate with the
  product's first rate limit (`rate-limit.js`, model `RateLimitBucket`, migration
  `20260914140400_rate_limit_bucket.sql`, applied on production 2026-09-14): five writes or validations in
  fifteen minutes per Person and Business, a rejected LINE validation counting twice,
  and sixty LINE validation calls a minute per installation, answering 429
  `CREDENTIAL_RATE_LIMITED` with `retryAfterSeconds`. Factor enrollment follows
  current factor state at both initiation and confirmation: the first active factor
  may be established at AAL1, while adding another ACTIVE TOTP factor or registered
  passkey requires a live `elevatedUntil` (FR-094..096, SEC-018, ADR-045 D2/D4).
  Revoking an MFA factor or passkey also requires a live `elevatedUntil`. The factor
  enrollment check is not atomic with its write; that millisecond race is accepted.
  A Person whose only ACTIVE TOTP secret is unreadable (`MFA_SECRET_UNAVAILABLE`)
  and who has no passkey needs operator recovery because step-up is unreachable.
  Sealing the TOTP secret at rest remains a separate lane.
- **Erasure fan-out (FR-232, [ADR-091](../../decisions/ADR-091-CHAT-RECORD-AND-AGENT-MEMORY-SPLIT-AND-THE-CONTEXT-COMPOSER.md) D6).**
  `erasePrincipal` stays the one erasure transaction. It will additionally compose
  the knowledge lane's candidate tombstone writer and leave durable work items for
  the tiers outside Tier 1 — an MSP erase call per memory projection receipt and a
  knowledge-source withdrawal for an admitted candidate — with the Customer's
  erasure status reading `PENDING_MSP` until MSP acknowledges. Identity still writes
  no other lane's model directly.
