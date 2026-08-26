# ADR-045 — Canonical Plugin Authorization-Code and Token Boundary

**Status:** Candidate implementation — live provider/device evidence pending  
**Date:** 2026-08-23  
**Decided by:** Boss + ATHER  
**Relates to:** [ADR-017](ADR-017-PRODUCTION-VIEWER-SESSION-AND-ENTRY-READ-MODEL.md), [ADR-041](ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md), [FR-046](../domains/identity/features/FR-046-production-viewer-entry-contract.md), [FR-094](../domains/identity/features/FR-094-plugin-authentication-and-capability-discovery.md)

## Context

Codex, Claude Code and other harnesses need a first-party plugin boundary. Reusing
`/api/auth/login` would send a human password through a public client, while copying
the `zuri_session` browser cookie would turn a browser session into a plugin credential.
Using `Mcp-Session-Id` as a bearer token would also confuse protocol continuation with
authorization. The plugin needs a separate public-client OAuth-style exchange while
Zuri remains the authority for Person, Membership, Business scope and policy.

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
`installation_id` and PKCE S256 challenge, and expires quickly. The access token is
opaque, stored only as a hash, short-lived and never refreshable in this slice.

Zuri derives authorization from the authenticated Person and persisted Membership/
RoleBinding state. Request bodies and query strings may contain client identifiers and
requested redirect metadata, but never authority fields such as `tenantId`, `businessId`,
`membershipId`, `role` or `policySnapshotId`.

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

## Security invariants

1. No password, browser cookie, raw code, raw token or secret is logged, persisted or returned in errors.
2. Unknown client, redirect URI, installation, code, verifier or bearer token fails closed.
3. Cross-tenant scope is never selected by plugin input; `resolveViewer` is the only scope resolver.
4. Replaying a code returns an auth failure and cannot create another session.
5. Revocation is idempotent and does not disclose whether a token existed.
6. An expired/revoked installation or session cannot discover capabilities or call future commands.

## Open gates

- register the production client id and exact redirect URI(s);
- choose and implement device-bound proof-of-possession if required for production;
- perform live cross-tenant, revocation, rotation and kill-switch tests;
- add consent UX and security review before unattended production use.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Canonical plugin authorization-code, token, capability and revoke boundary | working-tree | ATHER |
