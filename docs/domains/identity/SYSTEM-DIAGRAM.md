---
version: "1.1.1b"
status: declared
domain: identity
---

# Identity Domain — System Diagram & Architecture Specification

| Field | Value |
|---|---|
| **Domain** | `identity` (`DOM-IDENTITY`) |
| **Module** | `src/modules/identity` |
| **Authority** | Principal Resolution, Authentication Seams, Multi-Tenant PDP/PEP, Credential Isolation, PDPA Erasure |
| **Key Directives** | BR-001, BR-002, BR-016, SEC-001, SEC-005, SEC-014, SEC-023, SEC-025, ADR-017, ADR-018, ADR-027, ADR-045, ADR-047, ADR-052, ADR-079, ADR-088, ADR-110 (ADR-041 and ADR-059 are history) |

**Current state (2026-11-12).** The Edge Device and harness surfaces are retired
by ADR-110. Their flow and resolver are gone from the diagram below; the matrix
keeps one struck-through row, and the `EdgeDeviceCredential` and
`HarnessCredential` models remain in the schema. Sections 5 to 9 describe the
login, session, write-protection and isolation mechanics as the code stands at
`49b10eb3`; where a control is partial, the section says so. Function names,
viewer fields and token formats in sections 1 to 4 were corrected against the
same revision.

---

## 1. High-Level System Architecture

```mermaid
flowchart TB
    %% Ingress Clients & Entry Surfaces
    subgraph INGRESS["1. Entry Surfaces & Principal Ingress"]
        direction TB
        C_WEB["🌐 Browser Web Client<br/><i>(Next.js App / Console)</i><br/><code>Cookie: zuri_session</code>"]
        C_LINE["💬 LINE Messaging API / OA<br/><i>(End Users / Customers)</i><br/><code>X-Line-Signature / Webhook</code>"]
        C_API["🏢 Enterprise System<br/><i>(ERP / Third-party)</i><br/><code>Bearer: apik_... (Tenant)</code>"]
        C_SOT["🔄 SoT Data Plane<br/><i>(External Workers)</i><br/><code>Bearer: sdpk_... (Tenant)</code>"]
        C_PLUGIN["🔌 Codex / Claude Plugin<br/><i>(Local Developer Tools)</i><br/><code>Bearer: opaque token (Person)</code>"]
    end

    %% Identity & Authentication Seam
    subgraph AUTH_LAYER["2. Identity Resolution & Authentication Seam"]
        direction TB
        R_SESSION["<b>Session Seam</b><br/><code>resolveRequestViewer()</code><br/><i>Cookie → live Session row → Person</i>"]
        R_LINE["<b>Line Identity Resolver</b><br/><code>resolveLineIdentity()</code><br/><i>lineUserId → ChannelIdentity / ExternalIdentity</i>"]
        R_APIKEY["<b>API Key Resolver</b><br/><code>resolveApiAccessViewer()</code><br/><i>SHA-256 Check → Tenant Scope</i>"]
        R_SOTKEY["<b>SoT Key Resolver</b><br/><code>resolveSotDataPlaneViewer()</code><br/><i>SHA-256 Check → SoT Scope</i>"]
        R_PLUGIN["<b>Plugin Auth Service</b><br/><code>plugin-auth-service.js</code><br/><i>OAuth PKCE + Consent → Viewer</i>"]
    end

    %% PDP & Authorization Engine
    subgraph PDP_LAYER["3. Policy Decision & Context Engine (PDP/PEP)"]
        direction TB
        VIEWER_GEN["<b>Canonical Viewer Generator</b><br/><code>resolveViewer({ principalId })</code><br/>• principal, global role<br/>• ownedBusinessIds (Write authority)<br/>• visibleBusinessIds (Read visibility)<br/>• domainsByBusinessId, permissionsByBusinessId<br/>• isPlatform / isOperator / isSuperadmin"]
        
        DOMAIN_PEP["<b>Domain Visibility Gate</b><br/><code>assertDomainVisible(viewer, bizId, domain)</code><br/><i>(CRM, Market, Assets, PM)</i>"]
        
        SCOPE_PEP["<b>Scope Isolation Guard</b><br/><code>authorizeScope(context, options)</code><br/><i>Returns a decision; the calling gate maps a refusal to 404 (FR-072)</i>"]
    end

    %% Domain Subsystems & Protected Workloads
    subgraph DOMAINS["4. Protected Domain Workloads & Execution"]
        direction TB
        D_PM["📊 Project Manager<br/><code>(Workspaces, Sprints)</code>"]
        D_CRM["👥 CRM & Customers<br/><code>(Conversations, Consent, Erasure)</code>"]
        D_ASSETS["📦 Asset Management<br/><code>(Intake, OCR, Lifecycle, QR)</code>"]
    end

    %% Persistence & Security Store
    subgraph PERSISTENCE["5. Identity Persistence Models (SQLite / PostgreSQL)"]
        direction TB
        DB_PERSON[("👤 Person & PersonCredential<br/>PasswordResetToken, PlatformGrant")]
        DB_MEMBERSHIP[("🏢 Membership (businessId, role, domainKeysJson)<br/>& RoleBinding (businessId, roleKey)")]
        DB_WORKSPACE[("📁 WorkspaceMembership & AccessInvite<br/>(Collaboration boundary)")]
        DB_KEYS[("🔑 Session, ApiAccessKey,<br/>SotDataPlaneKey, PluginSession<br/><i>(SHA-256 Digests only)</i>")]
        DB_EXT[("🔗 ExternalIdentity & ChannelIdentity<br/><i>(External IDs != Primary Keys)</i>")]
        DB_AUDIT[("📜 Immutable AuditEvent Log")]
    end

    %% Connections
    C_WEB --> R_SESSION
    C_LINE -. "webhook, admission, CRM ingest (Flow C)" .-> R_LINE
    C_API --> R_APIKEY
    C_SOT --> R_SOTKEY
    C_PLUGIN --> R_PLUGIN

    R_SESSION --> VIEWER_GEN
    R_LINE --> DB_EXT
    R_PLUGIN --> VIEWER_GEN
    
    VIEWER_GEN --> DB_PERSON
    VIEWER_GEN --> DB_MEMBERSHIP
    VIEWER_GEN --> DOMAIN_PEP
    VIEWER_GEN --> SCOPE_PEP

    R_APIKEY --> SCOPE_PEP
    R_SOTKEY --> SCOPE_PEP

    R_APIKEY -.-> DB_KEYS
    R_SOTKEY -.-> DB_KEYS
    R_SESSION -.-> DB_KEYS

    DOMAIN_PEP --> D_PM
    DOMAIN_PEP --> D_CRM
    DOMAIN_PEP --> D_ASSETS

    PDP_LAYER -.-> DB_AUDIT
```

---

## 2. Multi-Credential Separation Matrix

Per **ADR-047 D2**, credentials cannot be reused across mismatched security boundaries. Leaking one credential never satisfies a check for another:

| Credential Type | Token Format / Seam | Bound Scope | Context Produced | Target Routes / Usage |
|---|---|---|---|---|
| **Human Browser Session** | `zuri_session` (Signed HttpOnly Cookie) | **Person** (across visible Businesses) | Full `Viewer` object (`ownedBusinessIds`, `visibleBusinessIds`, `domainsByBusinessId`, `permissionsByBusinessId`) | Web App Console, Back-office navigation, settings |
| **Enterprise API Key** | `Bearer apik_...` | **Tenant-bound** | `{ isApiAccess: true, tenantId, serviceAccountId }` — no Person; routes test it with `isApiAccessFor(tenantId)` | `POST /api/import/*`, `GET /api/resolve`, `GET /api/docs` |
| **SoT Data Plane Key** | `Bearer sdpk_...` | **Tenant-bound** | `{ isSotDataPlane: true, tenantId, serviceAccountId }` — no Person; routes test it with `isSotDataPlaneFor(tenantId)` | SoT decision submit and export; the knowledge pipeline reporter routes under `/api/pipelines/knowledge/[executionRunId]` (ADR-067) |
| **Plugin Session** | An opaque Bearer token (32 random bytes, base64url; 15-min TTL), stored as a hash | **Person-Delegated** via PKCE + Consent | `Viewer` without platform authority | IDE Tools, Codex MCP calls |
| **API write CSRF token** | Header token from `GET /api/auth/csrf`, bound to the live session; lives at most 15 minutes and never past the session's expiry | **One session** | None. The write guard checks `Origin` separately; the token proves the caller holds that session | The session-cookie writes listed in §7 |
| **Password reset token** | Single-use (claimed atomically, so concurrent requests cannot both spend it; §5.3), 1-hour TTL, stored as a SHA-256 digest | **One Person** | None — it authorizes one credential change | `POST /api/auth/reset-password` |
| **Internal service bearer** | Deployment bearer token, one per contract | **One service contract** | Service identity only; Core re-resolves scope per call | `/api/internal/conversation-runtime/*`, `/api/internal/market-intelligence/*`, `/api/internal/scm/*`, `/api/line-oa/worker` and `/api/line-oa/rich-menu-worker` (the two LINE workers share one token) |
| **Provider webhook signature** | HMAC-SHA256 over the raw body (`X-Line-Signature`, `X-Notion-Signature`). Notion's first-time setup challenge is checked against a pinned verification token instead | **One provider account** | Verified origin of one event | LINE and Notion webhook routes |
| ~~Edge Device Credential~~ | `Bearer edgk_...` | Retired by ADR-110 | — | No route. Schema rows are historical |

---

## 3. Core Interaction & Authentication Flows

### Flow A: Human Login & Viewer Resolution (`resolveViewer` + `assertDomainVisible`)

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User / Manager
    participant Web as 🌐 Next.js App
    participant AuthRoute as 🚪 /api/auth/login
    participant IdentitySvc as 🛡️ Identity / Session Seam
    participant DB as 🗄️ Database (Prisma)
    participant DomainRoute as 📦 /api/assets/register

    User->>Web: Enter Email & Password
    Web->>AuthRoute: POST /api/auth/login
    AuthRoute->>IdentitySvc: authenticateUser({ username, password })
    IdentitySvc->>DB: Verify PersonCredential (salted scrypt)
    DB-->>IdentitySvc: Password match
    IdentitySvc->>DB: Create active Session record (7d ceiling)
    IdentitySvc-->>AuthRoute: Issue Signed HttpOnly Cookie (zuri_session)
    AuthRoute-->>Web: 200 OK (Set-Cookie)

    Note over Web,DomainRoute: User accesses Asset Register in Business 01
    Web->>DomainRoute: GET /api/assets/register?businessId=biz_01
    DomainRoute->>IdentitySvc: resolveRequestViewer(request)
    IdentitySvc->>DB: Query Person, Memberships, RoleBindings
    DB-->>IdentitySvc: Grants & Roles
    IdentitySvc-->>DomainRoute: Canonical Viewer (ownedBiz, visibleBiz, domains)
    
    DomainRoute->>IdentitySvc: resolveAssetRequestScope(viewer, "biz_01")
    alt Business not visible to the viewer
        IdentitySvc-->>DomainRoute: Refuses
        DomainRoute-->>Web: 404 Not Found (Generic Security Shape - FR-072)
    else "assets" domain not granted in biz_01
        IdentitySvc-->>DomainRoute: Refuses
        DomainRoute-->>Web: 403 Forbidden
    else User is Authorized
        DomainRoute->>DB: Query Registered Assets for biz_01
        DB-->>DomainRoute: Return Asset records
        DomainRoute-->>Web: 200 OK { items: [...] }
    end
```

---

### Flow B: Zuri Edge Device Authentication (`edgk_...`) — retired

Retired by [ADR-110](../../decisions/ADR-110-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md).
No `/api/edge/**` or harness route exists in the current route tree (enumerated
at `49b10eb3`), and `tests/unit/edge-surface-retirement.test.js` asserts that a
fixed list of those paths stays absent. The `EdgeDeviceCredential` and
`HarnessCredential` models remain in the schema; no resolver reads either on a
request path. Whether a deployed database still holds such rows is not
something the repository shows. The sequence diagram that stood here described the ADR-059 pull
model and is kept in version control history.

---

### Flow C: External Channel Identity Resolution (LINE Webhook)

```mermaid
sequenceDiagram
    autonumber
    participant Line as LINE Platform
    participant Hook as /api/line-oa/accounts/[id]/webhook
    participant Admit as LINE admission (line-oa-studio)
    participant Ingest as CRM ingest (line-ingest-service)
    participant Resolver as resolveLineIdentity()
    participant DB as ChannelIdentity / ExternalIdentity / Person

    Line->>Hook: POST events, header X-Line-Signature
    Hook->>Hook: Verify HMAC-SHA256 over the raw body
    Hook->>Hook: Store raw evidence and an admission marker
    Hook-)Admit: Start admission (not awaited)
    Hook-->>Line: 2xx
    Admit->>Ingest: Ingest the message in the admission transaction
    Ingest->>Resolver: resolveLineIdentity({ tenantId, lineUserId, channelAccountId, displayName })
    Resolver->>DB: Look up ChannelIdentity, then ExternalIdentity
    alt Known subject
        DB-->>Resolver: Person and its identity mappings
    else First contact
        Resolver->>DB: Create Person + ExternalIdentity + ChannelIdentity
    end
    Resolver-->>Ingest: personId, identity ids and status, channelIdentity
    Ingest->>Ingest: Find or create the Tenant's Customer for that Person
```

The webhook route never calls the resolver. It verifies, captures and
acknowledges; identity is resolved later, inside CRM ingest. The resolver
returns no principal type — `classify-principal.js` classifies a subject as
`STAFF`, `CUSTOMER` or `UNKNOWN` separately — and it creates no `ExternalRef`:
a LINE subject is mapped through `ExternalIdentity` and `ChannelIdentity`. The
`Customer` row is CRM's, created downstream of the resolver.

---

## 4. Non-Negotiable Invariants

1. **External IDs are Never Primary Keys (BR-002):**
   - External identifiers (`lineUserId`, `taxId`, `dbdNumber`, `deviceId`) are never to be used as internal primary keys. Records use internal UUID primary keys, and many business records also carry a human-readable code (identity records such as `Session` and `MfaFactor` have no code). The rule has known exceptions in the current schema, `NotionWebhookReceipt.eventId` being keyed by Notion's event id among them; the identifier page lists them. A LINE subject maps to a `Person` through `ExternalIdentity` and `ChannelIdentity`; `ExternalRef` maps a customer system's id to a Project-system entity and is not used for people. The [identifier and code system](../../architecture/IDENTIFIER-AND-CODE-SYSTEM.md) page lists the mapping tables found in a static review (not proven complete) and the known exceptions to this rule.
2. **Generic 404-Shaped Refusal (FR-072 / SEC-001):**
   - At the visibility and ownership gates — an invisible Business, a missing domain grant, a target the caller may not see — the system returns `404 Not Found` rather than `403 Forbidden` to prevent resource enumeration. This is a rule of those gates, not of every API: other refusals keep their own status, for example a `422` for an out-of-scope reference inside a sales-task write, or a `403` when minting a password reset without authority.
3. **Digest-Only Token Storage (SEC-025):**
   - Bearer credentials (`apik_…` API keys, `sdpk_…` SoT keys, and plugin access tokens, which are opaque random strings with no fixed prefix) and password reset tokens exist in plaintext only in the mint response and are persisted as hashes.
4. **PDPA One-Way Erasure Boundary (FR-022):**
   - `eraseCustomerPrincipal` (`POST /api/crm/customers/[customerId]/erasure`) requires explicit `confirmation: 'ERASE'`, executes in a single transaction, tombstoning `Message.body` and `RawExternalRecord` payloads permanently.

---

## 5. Human sign-in flows

Flow A covers password sign-in. These are the other ways a session comes into
being, changes strength, or ends.

### 5.1 Signup

`POST /api/auth/signup` creates a `Person` and a `PersonCredential`, then issues
a session through the same path as a password sign-in. It grants no Business,
Workspace, capability or platform authority — a new account can see nothing
until someone gives it a Membership or it creates its own Workspace (ADR-027).
The cookie is a browser-session cookie (no `maxAge`).

### 5.2 Passkey sign-in and step-up

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant Web as Next.js App
    participant Opt as /api/auth/webauthn/login/options
    participant Ver as /api/auth/webauthn/login/verify
    participant Up as /api/auth/step-up
    participant DB as Session / MfaFactor / PasskeyCredential

    User->>Web: Sign in with passkey
    Web->>Opt: POST
    Opt-->>Web: Challenge (held in this process, 5 min)
    Web->>Ver: POST signed assertion
    Ver->>DB: Verify credential, create Session (assurance WEBAUTHN)
    Ver-->>Web: Set-Cookie zuri_session (7 days)

    Note over Web,DB: A password session is AAL1 until it steps up
    User->>Web: Sensitive action
    Web->>Up: POST TOTP code
    Up->>DB: Verify sealed TOTP secret, set elevatedUntil = now + 15 min
    Up-->>Web: 200 (same session, now AAL2)
```

- A passkey session is AAL2 for its whole life. A password session is AAL2 only
  while `elevatedUntil` is in the future (`STEP_UP_WINDOW_SECONDS = 900`). The
  stored `assuranceLevel` column is descriptive and grants nothing.
- Step-up raises the current session; it does not issue a new one.
- TOTP secrets are AES-256-GCM envelopes bound to the Person and factor
  (ADR-088). Enrolling a factor and verifying a secret need the sealing key; in
  production a missing key makes those operations fail closed. Listing and
  revoking factors do not need it.
- The passkey challenge lives in a `Map` inside one Node process
  (`webauthn-challenge.js`) for five minutes and is single-use. The store holds
  at most 10 000 challenges; at the cap the oldest is evicted, never the new
  one refused. Production runs one `web` container (root `CLAUDE.md`, ADR-058,
  ADR-114; `docker-compose.yml` sets no replicas), so the process that issued a
  challenge is the one that verifies it, and a restart only costs the user one
  retry of the ceremony. **Limit:** a second web process would not see the
  first one's challenges, so scaling `web` out needs a shared challenge store
  first. This is a deliberate single-instance choice, not a durable store.
- Passkey sign-in options and verify are rate limited per client address and
  per identifier (§8). The limit is what bounds how fast an anonymous caller can
  fill the challenge map.

### 5.3 Password reset

There is no public "forgot password" request. An installation operator, or an
owner of a Business in which the target person holds a Membership, mints a
token for that person (`POST /api/platform/users/password-resets`); being an
owner somewhere else is not enough. The token is
shown once, stored as a SHA-256 digest and expires after one hour. The person
spends it at `POST /api/auth/reset-password`, which changes the credential and
revokes **every** active session of that person. Spending is atomic: inside one
transaction a conditional update claims the token (`usedAt` still null and not
expired) before the credential is touched, so of any number of concurrent
requests with the same token exactly one succeeds; the others roll back and get
the same generic `INVALID_OR_EXPIRED_TOKEN`.

### 5.4 Sign-out

`POST /api/auth/logout` revokes the current `Session` row and clears the
cookie. Because a request with a persisted session checks the cookie against
its row (§6), a revoked session stops working at once even if the cookie is
replayed. Outside production, a legacy token that carries no session id is
accepted without a row, and sign-out has no row to revoke for it.

### 5.5 Invitation

Workspace invitations (`/api/workspace-invites`, `/accept`) require a live
session and bind the new `WorkspaceMembership` to that session's Person — the
invite link alone creates nothing. Tenant- and Business-scoped `AccessInvite`
minting and acceptance exist in `access-invite-service.js` but have no HTTP
route; ADR-079 records that as follow-on work.

## 6. Session contract

| Property | As built |
|---|---|
| Cookie | `zuri_session`; `HttpOnly`; `SameSite=Lax`; `Secure` in production; path `/` |
| Token | `zuri_sess.<payload>.<HMAC-SHA256>`; payload carries `sub`, `iat`, `exp` and, on every token the current sign-in paths issue, `sid`; signed with a session secret of at least 32 characters |
| Server record | A `Session` row holding the token's SHA-256 hash, status, assurance, `lastSeenAt` and expiry |
| Lifetime | Seven days from issue (`SESSION_MAX_AGE_SECONDS`). No refresh, no rotation, no idle timeout |
| Cookie persistence | Password sign-in: browser-session, or seven days with "remember me". Signup: browser-session. Passkey: seven days |
| Validation | A request verifies the signature and then, for a token with `sid`, the live `Session` row. Production rejects a token without `sid` and fails closed when the session store is unreachable; outside production a legacy token without `sid` is accepted on its signature alone |
| Revocation | Sign-out revokes one session; password reset revokes all |
| Viewer | `resolveRequestViewer` returns 401 without a session and 503 on a store failure. `resolveViewer({ principalId })` recomputes active, unexpired Memberships on every request; operator and superadmin grants are re-read from the database, never taken from the cookie |

There is no `middleware` file under `apps/server/src`. An authenticated
resource route resolves its own viewer, and the owning service decides whether
that viewer may touch the resource. Public sign-in, signup, reset consumption
and logout use their own seams (logout accepts a missing cookie and revokes only
when one is present); a machine-facing route checks its own bearer, signature or
token instead. Nothing global stands in front of a route that checks none of
these: the control is each route's own code and tests.

## 7. Protection of cookie-authenticated writes

Two controls exist, and they do not cover the same routes.

| Control | What it checks | Where it applies |
|---|---|---|
| `SameSite=Lax` | The browser withholds the cookie on cross-site `POST` | Every cookie-authenticated route |
| API write CSRF token (FR-252-P2, `api-write-csrf.js`) | `Origin` equals the origin parsed from `PUBLIC_BASE_URL`, and a token bound to the live session that lives at most 15 minutes and never past the session's expiry | Project feature writes, project governance snapshots, agent approval decisions and notifications, agent mission submissions, Office Design registration, managed-blob transfer and recovery |

A static scan at `49b10eb3` found 268 route files that export a write method.
Twenty-four of them do not name `resolveRequestViewer` or `resolveViewer` in the
route file. Seven delegate to a helper that resolves the viewer: the project
feature subroutes (`contributions`, `requirement-bindings`, `restore`,
`work-links`), `projects/[id]/feature-work-links` and the two file
recovery-operation routes. The other seventeen have another seam, and the scan
does not judge whether that seam is sufficient:

- public credential flows: `auth/login`, `auth/signup`, `auth/reset-password`;
- session read directly: `auth/logout`;
- provider signatures: `integrations/notion/webhook`, `line-oa/accounts/[id]/webhook`;
- service and deployment bearers: `internal/conversation-runtime/v1` and `v2`,
  `line-oa/worker`, `line-oa/rich-menu-worker`, `agent/memory-retention`,
  `crm/retention-sweep`, `platform/programme-usage-reports`,
  `platform/usage-events/rollup`, `growth/external-marketing-reports`;
- plugin tokens: `plugin/auth/token`, `plugin/auth/revoke`.

Twenty-four session-authenticated write routes in the Identity-owned route
groups do not call the API write CSRF verifier and so rely on `SameSite=Lax`
for cross-site protection:

- under `auth/`: `logout`, `mfa/factors`, `mfa/totp/enroll`, `mfa/totp/verify`,
  `step-up`, `webauthn/credentials`, `webauthn/register/options`,
  `webauthn/register/verify`, `webauthn/step-up`;
- `identity/link-tokens`, `identity/meeting-bindings`;
- `onboarding/profile`, `onboarding/workspaces`;
- `platform/api-access-keys`, `platform/api-access-keys/[id]`;
- `platform/users`, `platform/users/memberships`,
  `platform/users/memberships/[id]/lifecycle`, `platform/users/offboard`,
  `platform/users/password-resets`;
- `workspace-invites`, `workspace-invites/accept`, `workspace-invites/[id]`,
  `workspace-memberships`.

Other route-specific checks apply to most of them (a viewer, step-up, an owner
or operator gate); sign-out is the exception, since it needs no session and
revokes one only if a cookie is present. This is a coverage statement about one verifier, not a
finding that any of them is exploitable.

Sign-in and signup accept a form-encoded `POST` and set a cookie without
checking `Origin`. Nothing in either route stops a page on another site from
submitting credentials it already knows, which would sign the browser into
that account (login CSRF). This is read from the code and was not tested in a
browser. Whether it matters is an owner decision; it is written here so the
decision is made on purpose.

## 8. Rate limiting

| Surface | Limit | Storage | Note |
|---|---|---|---|
| Password sign-in | 10 per identifier + address, 50 per identifier, 200 per address, each per 15 min | `RateLimitBucket`, compare-and-set | The address comes from `x-forwarded-for`, counted from the right by `ZURI_TRUSTED_PROXY_HOPS`. When the chain is missing, too short or not an IP, only the identifier bucket is consumed |
| TOTP verify and step-up | 5 per Person per 15 min, one shared bucket | `RateLimitBucket` | |
| Credential writes | 5 per Person + Business per 15 min; actions that call LINE also consume an installation-wide 60 per 60 s | `RateLimitBucket` | ADR-089 D4 |
| Signup | 20 per source key per 15 min | **Memory of one process** | Multiplies by replica count and resets on restart; `signup-rate-limit.js` says so itself |
| Passkey sign-in options and verify | 60 per client address (one bucket shared by both calls) and 20 per identifier (options: the requested email; verify: the credential id; hashed into one key space, so a value used as both counts in one bucket), each per 15 min | `RateLimitBucket`, compare-and-set | Same address rules as password sign-in. With no usable address only the identifier bucket is consumed; with neither, nothing is. Keys are hashed. The refusal is `429 PASSKEY_LOGIN_RATE_LIMITED` with `Retry-After` |
| Reset-password consume | **No request limit** | — | The token is 256 random bits, expires in an hour and is spent atomically (§5.3), so a guess cannot succeed and a replay cannot double-spend. There is still no cap on how many guesses a caller may send |

## 9. Application authorization and database isolation

Tenant isolation is enforced in two places that must not be confused.

- **Application layer — always.** An ordinary viewer's visible and owned
  Business ids come from persisted Memberships; platform and superadmin grants
  widen visibility from their own persisted grant state. The owning services
  filter by that scope. There is no global gate (§6), so this holds route by
  route, and it is the control on every database profile, including local
  SQLite.
- **Database layer — cloud target.** ADR-018 requires row-level security for
  the Supabase production target. The migrations enable RLS across the
  application schema (`20260818084011_application_schema.sql`) and force it on
  `Person` (`20260922100000_force_person_rls.sql`).

The intended runtime roles (`zuri_app_runtime`, `zuri_web_login`) and their
grants are described in [SYSTEM-DIAGRAM.md](../../SYSTEM-DIAGRAM.md) and the
[Phase B persistence security policy](../../architecture/project-manager-system/25-PHASE-B-PERSISTENCE-SECURITY-POLICY.md).
What the repository does not establish: whether the self-hosted PostgreSQL
production target (ADR-114) carries the same RLS contract, and which role a
deployed application actually connects as. A migration file proves neither
that the migration was applied nor which role the running application uses.

## Version diff

1.1.0b → 1.1.1b (2026-11-13): records two identity code changes and their
remaining limits. Password-reset consumption claims the token with one
conditional update (§5.3, §8), closing the concurrent double-spend. Passkey
sign-in options and verify are rate limited (§8), and the in-process passkey
challenge store is bounded with the single-instance limit stated (§5.2).
Documents code changed in the same pull request; no route, model, migration or
requirement id is introduced.

1.0.0b → 1.1.0b (2026-11-12): removes the retired Edge Device nodes and
sequence diagram and strikes through its matrix row (ADR-110); corrects Flow A
to salted scrypt, a seven-day session and the real function names; redraws
Flow C to the admission and CRM-ingest path the code follows; corrects viewer
fields, key contexts, the plugin token format and invariants 1 and 2 against
source; adds the remaining credential kinds to the matrix; adds
sections 5–9 for signup, passkey and step-up, password reset, sign-out,
invitation, the session contract, write-protection coverage, rate limiting and
the application/database isolation boundary. Describes existing code only; no
route, model, permission or requirement is introduced.
