---
version: "0.2.0b"
created_at: "2026-08-23T04:00:00+07:00,ATHER"
last_update: "2026-08-30T00:00:00+07:00,Claude Opus 5"
status: "candidate"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "architecture-decision"
  scope: "how a first-party plugin obtains, uses and loses authority to act for a person, without ever holding the browser session"
---

# ADR-052 — Canonical Plugin Authorization-Code and Token Boundary

**Status:** Candidate implementation — live provider/device evidence pending

**Decided by:** Boss + ATHER (2026-08-23); re-applied to main and reviewed 2026-08-30

**Relates to:** [ADR-017](ADR-017-PRODUCTION-VIEWER-SESSION-AND-ENTRY-READ-MODEL.md), [ADR-041](ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md), [ADR-047](ADR-047-SOT-DATA-PLANE-SERVICE-ACCOUNT-KEY.md), [FR-046](../domains/identity/features/FR-046-production-viewer-entry-contract.md), [FR-123](../domains/identity/features/FR-123-plugin-authentication-and-capability-discovery.md), `.brain/rca/2026-08-24-plugin-auth-loopback-verifier.md`

> **Id note.** This decision was drafted as `ADR-045` against `FR-094` /
> `SDD-052` / `SEC-018`. Every one of those numbers was claimed on main by
> other work before this branch was re-applied, so it carries **ADR-052 /
> FR-123 / SDD-074 / SEC-022**. Ids are keys: the earlier declarations keep
> their meaning and this one took the next free number in each family, the same
> rule PR #117 followed for the sibling control-roadmap rescue.

## Context

Codex, Claude Code and other harnesses need a first-party plugin boundary. Reusing
`/api/auth/login` would send a human password through a public client, while copying
the `zuri_session` browser cookie would turn a browser session into a plugin credential.
Using `Mcp-Session-Id` as a bearer token would also confuse protocol continuation with
authorization. The plugin needs a separate public-client OAuth-style exchange while
Zuri remains the authority for Person, Membership, Business scope and policy.

This is **adjacent to, and not the same as, FR-106's `ApiAccessKey`** (ADR-047). That
credential is a long-lived, Tenant-bound service key for the Enterprise API, issued to
an organization and carried by a server. This one is a short-lived delegation from one
signed-in human to one installed plugin on their own machine. They share the discipline
of storing only a hash and never a raw secret; they share nothing else, and neither
should grow into the other.

## Decision

Implement one canonical route family under `/api/plugin/auth`:

| Route | Purpose | Authority |
|---|---|---|
| `GET /api/plugin/auth/authorize` | Browser-authenticated user starts a one-time authorization-code flow | Existing trusted `SessionPort` and `resolveViewer` |
| `POST /api/plugin/auth/token` | Exchange code + PKCE S256 verifier for a short-lived opaque bearer token | Atomic code consumption and session creation in Zuri DB |
| `GET /api/plugin/auth/capabilities` | Discover server-derived plugin capabilities | Active plugin session, then `resolveViewer` |
| `POST /api/plugin/auth/revoke` | Revoke one opaque plugin session | Hash-bound, idempotent session revocation |

The plugin is a public client: no client secret is issued. The authorization code is
single-use, stored only as a hash, bound to exact `client_id`, redirect URI,
`installation_id` and PKCE S256 challenge, and expires in 60 seconds. The access token
is opaque, stored only as a hash, lives 15 minutes and is never refreshable in this
slice.

Zuri derives authorization from the authenticated Person and persisted Membership/
RoleBinding state. Request bodies and query strings may contain client identifiers and
requested redirect metadata, but never authority fields such as `tenantId`, `businessId`,
`membershipId`, `role` or `policySnapshotId`.

### D1 — Redirect matching is exact, and stays exact

A Preview smoke run on 2026-08-24 failed because Vercel's verification transport
rewrites `127.0.0.1` to `localhost` before the request arrives
(`.brain/rca/2026-08-24-plugin-auth-loopback-verifier.md`). The available fix was to
normalize loopback spellings in the validator. That was refused: an allowlist that
silently accepts a host the operator did not register is no longer an allowlist. The
operator registers both spellings, or verifies through a transport that does not
rewrite the host. A unit test now asserts the two spellings are not interchangeable,
so the decision cannot be quietly reversed by someone trying to make a verifier pass.

### D2 — A replayed code revokes what it already minted

A code presented a second time is not merely refused. Presentation after redemption is
evidence that the code leaked after use, so every session minted from it is revoked
(RFC 9700 §4.1.1). `PluginSession.authorizationCodeId` exists for exactly this and
nothing else. The original 2026-08-23 draft refused the replay and left the session
alive; that was the gap this review closed.

### D3 — A plugin never inherits a platform grant

`getPluginCapabilities` resolves the viewer without `platformGrant`. A platform DEV
grant is cross-tenant visibility held by a human at a browser; letting a plugin
delegation carry it would mean installing a plugin widened what the person could reach.
Plugin scope is Membership-derived only.

## Consequences

- A browser login session and a plugin access session are distinct credentials.
- Token exchange and revoke are durable and restart-safe; no in-memory authority is used.
- Capability discovery is advisory for harness UX. Every command still re-authorizes on
  the canonical command/API path before mutation.
- Client registration and redirect URI allowlists are environment configuration in this
  slice. Missing or ambiguous configuration fails closed.
- Device public-key proof/DPoP, refresh-token rotation, consent UI and production canary
  evidence remain separate gates; `installation_id` is an audit/binding identifier, not
  a substitute for proof-of-possession.
- Expired codes and sessions are not pruned by anything yet. They are inert — every read
  path checks `expiresAt` — but the tables grow, so a reaper is owed before high volume.

## Security invariants

1. No password, browser cookie, raw code, raw token or secret is logged, persisted or returned in errors.
2. Unknown client, redirect URI, installation, code, verifier or bearer token fails closed.
3. Cross-tenant scope is never selected by plugin input; `resolveViewer` is the only scope resolver.
4. Replaying a code returns an auth failure, cannot create another session, and revokes the session that code already produced.
5. Revocation is idempotent and does not disclose whether a token existed.
6. An expired/revoked installation or session cannot discover capabilities or call future commands.
7. The PKCE verifier is compared with `timingSafeEqual`, never with `===`.

## Open gates

- **No consent step exists.** `GET /authorize` mints a code from the browser session
  alone, so any page the signed-in user visits can trigger issuance to the registered
  redirect URI. The registered URIs are loopback addresses on the user's own machine,
  which bounds the exposure to something already listening on that port locally — but
  this is a real gap and the reason unattended production use is gated. A consent
  screen, or at minimum a same-site/user-gesture requirement, is owed before the client
  id is registered in production.
- register the production client id and exact redirect URI(s);
- choose and implement device-bound proof-of-possession if required for production;
- perform live cross-tenant, revocation, rotation and kill-switch tests;
- add a reaper for expired codes and sessions;
- security review approves production activation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Canonical plugin authorization-code, token, capability and revoke boundary | working-tree | ATHER |
| 0.2.0b | 2026-08-30 | candidate | Re-applied to main as ADR-052/FR-123/SDD-074/SEC-022; adds D1–D3, replay revocation, and the missing-consent open gate | pending | Claude Opus 5 |
