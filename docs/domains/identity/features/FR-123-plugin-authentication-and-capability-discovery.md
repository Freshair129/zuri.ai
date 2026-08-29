---
domain: identity
feature: FR-123
module: plugin-auth
source: v2-native
version: "0.2.0b"
created_at: "2026-08-23T04:00:00+07:00, ATHER"
last_update: "2026-08-30T00:00:00+07:00, Claude Opus 5"
status: "beta"
---

# FR-123 — Plugin authentication and capability discovery

| Field | Value |
|---|---|
| Status | Implemented locally — live client/device/security evidence pending |
| Design | ADR-052, SDD-074 |
| Security | SEC-022 |

> Drafted as FR-094 on 2026-08-23; that number was claimed on main by Canonical
> IAM before this work was re-applied, so it carries FR-123. Ids are keys — the
> later declaration renumbers (the rule PR #117 followed for the sibling rescue).

## Requirement

Zuri must expose one server-owned authentication boundary for first-party Codex,
Claude Code and other harness plugins. The flow must use an existing trusted browser
session to authorize a one-time code, PKCE S256 to exchange it, an opaque short-lived
access token for the plugin, server-derived capability discovery, and idempotent revoke.

The plugin must never submit a human password, copy the `zuri_session` cookie, use
`Mcp-Session-Id` as authorization, connect to Zuri PostgreSQL, or choose its own
Tenant/Business/Membership/role authority.

This is not FR-106's `ApiAccessKey`. That is a long-lived Tenant-bound service
credential for the Enterprise API; this is a minutes-long delegation from one signed-in
person to one plugin installation. Neither may be used in place of the other.

## API contract

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/plugin/auth/authorize` | `response_type=code`, configured `client_id`, exact `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`, `installation_id` | `302` to the exact redirect URI with one-time `code` and original `state` |
| POST | `/api/plugin/auth/token` | `{grant_type: authorization_code, code, client_id, redirect_uri, code_verifier, installation_id}` | `{access_token, token_type: Bearer, expires_in, expires_at, session_id, principal_id, installation_id}` |
| GET | `/api/plugin/auth/capabilities` | `Authorization: Bearer <opaque token>` | `{policy_snapshot_id, expires_at, capabilities[]}` |
| POST | `/api/plugin/auth/revoke` | `{token, token_type_hint?: access_token}` | `{revoked: true}` without token-existence disclosure |

The authorization route requires the current trusted browser session. It returns
`401 AUTH_REQUIRED` when the browser is not logged in; it does not redirect to an
arbitrary login or client-supplied URI. Configuration is fail-closed when
`ZURI_PLUGIN_CLIENT_ID` or `ZURI_PLUGIN_REDIRECT_URIS` is absent.

Redirect matching is exact. `http://localhost:43123/callback` and
`http://127.0.0.1:43123/callback` are two registrations, not one — see
`.brain/rca/2026-08-24-plugin-auth-loopback-verifier.md` for the Preview run that
made this worth writing down.

## Lifetimes

| Credential | Lifetime | Storage |
|---|---|---|
| Authorization code | 60 seconds, single use | SHA-256 hash only |
| Access token | 15 minutes, no refresh | SHA-256 hash only |
| Capability snapshot | min(session expiry, 5 minutes) | not stored |

## Capability contract

Capabilities are derived from the resolved viewer, not from request fields:

- read baseline: `plan.preview`, `pipeline.get`, `connector.list`, `connector.health`;
- owner-scoped write candidates: `plan.commit`, `pipeline.start`, `pipeline.cancel`;
- writes are marked `requiresApproval=true` and do not bypass later command authorization.

The capability snapshot is a bounded UX/read contract. It is not a grant to mutate PM,
pipeline or connector state.

## Acceptance criteria

| ID | Expected proof |
|---|---|
| AC-123.1 | Missing/invalid client or redirect configuration fails closed. |
| AC-123.2 | Unauthenticated authorize request cannot mint a code. |
| AC-123.3 | Authorization code is hashed, single-use, exact-client/redirect/install bound and expires. |
| AC-123.4 | Wrong PKCE verifier cannot create a session. |
| AC-123.5 | Token response contains no refresh token or tenant/business authority. |
| AC-123.6 | Expired/revoked token cannot read capabilities. |
| AC-123.7 | Capabilities are derived from `resolveViewer`, not client scope fields. |
| AC-123.8 | Revoke is idempotent and error responses never echo raw token/code data. |
| AC-123.9 | SQLite and generated Postgres schemas carry the durable code/session/install records. |
| AC-123.10 | Concurrent redemption of one code produces exactly one session. |
| AC-123.11 | Replaying a consumed code revokes the session it already produced. |

## Exit gate

- [x] unit and route contract tests pass;
- [x] local schema/migration and Postgres schema generation pass;
- [x] `npm run govern` passes with regenerated graph/preflight;
- [ ] production Supabase migration applied and recorded in `supabase_migrations.schema_migrations`;
- [ ] live production client registration and device-binding evidence are complete;
- [ ] a consent step (or same-site/user-gesture requirement) exists on `GET /authorize`;
- [ ] security review approves production activation.
