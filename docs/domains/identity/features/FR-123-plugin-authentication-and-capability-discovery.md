---
domain: identity
feature: FR-123
module: plugin-auth
source: v2-native
version: "0.3.0b"
created_at: "2026-08-23T04:00:00+07:00, ATHER"
last_update: "2026-08-30T12:00:00+07:00, Claude Opus 5"
status: "beta"
---

# FR-123 — Plugin authentication and capability discovery

| Field | Value |
|---|---|
| Status | Implemented locally, consent gate closed — live client/device/security evidence pending |
| Design | ADR-052, SDD-074 |
| Security | SEC-022 |

> Drafted as FR-094 on 2026-08-23; that number was claimed on main by Canonical
> IAM before this work was re-applied, so it carries FR-123. Ids are keys — the
> later declaration renumbers (the rule PR #117 followed for the sibling rescue).

## Requirement

Zuri must expose one server-owned authentication boundary for first-party Codex,
Claude Code and other harness plugins. The flow must use an existing trusted browser
session **and an explicit act of consent by the person** to authorize a one-time code,
PKCE S256 to exchange it, an opaque short-lived access token for the plugin,
server-derived capability discovery, and idempotent revoke.

A signed-in browser session alone is not authorization. `zuri_session` is
`sameSite: 'lax'`, and Lax sends the cookie on a top-level GET navigation, so a flow
that minted on GET issued codes for people who were never asked. Authorization is
therefore two steps: a GET that renders a consent screen and mints nothing, and a POST
from that screen that mints (ADR-052 D4).

The plugin must never submit a human password, copy the `zuri_session` cookie, use
`Mcp-Session-Id` as authorization, connect to Zuri PostgreSQL, or choose its own
Tenant/Business/Membership/role authority.

This is not FR-106's `ApiAccessKey`. That is a long-lived Tenant-bound service
credential for the Enterprise API; this is a minutes-long delegation from one signed-in
person to one plugin installation. Neither may be used in place of the other.

## API contract

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/api/plugin/auth/authorize` | `response_type=code`, configured `client_id`, exact `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`, `installation_id` | `302` to `/plugin/authorize`, carrying the query string unchanged. Mints nothing, reads no session, touches no database |
| GET | `/plugin/authorize` | the same parameters, validated server-side through `assertPluginAuthorizeParameters` | the consent screen, or `/login` when there is no session. Shows the registered plugin name, the capabilities the plugin's viewer resolves to, the exact redirect target and the granting account — all server-derived |
| POST | `/api/plugin/auth/authorize` | form fields `decision=approve\|deny`, `csrf_token`, `request_token` — and nothing else; the authorization parameters are read only from the signed `request_token` | `303` to the exact redirect URI with one-time `code` and original `state`, or with `error=access_denied` and original `state` on refusal |
| POST | `/api/plugin/auth/token` | `{grant_type: authorization_code, code, client_id, redirect_uri, code_verifier, installation_id}` | `{access_token, token_type: Bearer, expires_in, expires_at, session_id, principal_id, installation_id}` |
| GET | `/api/plugin/auth/capabilities` | `Authorization: Bearer <opaque token>` | `{policy_snapshot_id, expires_at, capabilities[]}` |
| POST | `/api/plugin/auth/revoke` | `{token, token_type_hint?: access_token}` | `{revoked: true}` without token-existence disclosure |

The approval POST requires the current trusted browser session and returns
`401 AUTH_REQUIRED` without one. The consent screen sends a signed-out person to
`/login` and carries nothing from the request into that URL — a `next` parameter on
`/login` would be a new redirect surface, and this gate is not the place to open one.
Neither route ever redirects to a client-supplied URI it has not validated: the GET
target is a fixed path on the request's own origin, and the consent screen refuses an
invalid request in place rather than bouncing to the `redirect_uri` that failed
validation. Configuration is fail-closed when `ZURI_PLUGIN_CLIENT_ID` or
`ZURI_PLUGIN_REDIRECT_URIS` is absent; `ZURI_PLUGIN_CLIENT_NAME` is optional and
defaults to the client id, because the consent screen must never display a name the
caller supplied.

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
| Consent request token | 5 minutes, session- and principal-bound | not stored — an HMAC over `ZURI_SESSION_SECRET` |
| Consent anti-CSRF token | lives as long as the browser session it is bound to | not stored — an HMAC over `ZURI_SESSION_SECRET` |

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
| AC-123.12 | A fully valid, fully authenticated `GET /api/plugin/auth/authorize` creates **no** `PluginAuthorizationCode` row. |
| AC-123.13 | The approval POST is refused without the session cookie, without the anti-CSRF token, and with an anti-CSRF token bound to another session. |
| AC-123.14 | The approval POST is refused when any signed field — `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `state`, `installation_id`, `principal_id`, `session_binding`, `exp` — differs from what was signed, and when a genuinely signed token no longer matches live configuration. |
| AC-123.15 | An expired consent request token is refused. |
| AC-123.16 | Denying returns `error=access_denied` with the original `state` and mints nothing. |
| AC-123.17 | The consent screen shows the registered plugin name, the capabilities derived from a viewer resolved without `platformGrant`, the exact redirect target and the granting account — none of them read from the query string. |
| AC-123.18 | A person can complete the flow by clicking the screen, and the resulting code is accepted once by `/token`. |

## Exit gate

- [x] unit and route contract tests pass;
- [x] local schema/migration and Postgres schema generation pass;
- [x] `npm run govern` passes with regenerated graph/preflight;
- [ ] production Supabase migration applied and recorded in `supabase_migrations.schema_migrations`;
- [ ] live production client registration and device-binding evidence are complete;
- [x] a consent step exists: `GET /authorize` renders and never mints, and only a POST
      from the consent screen — session cookie + session-bound anti-CSRF token +
      HMAC-signed request token — mints a code (ADR-052 D4);
- [ ] a reaper for expired authorization codes and plugin sessions (ADR-052 open gate,
      unchanged by this work);
- [ ] security review approves production activation.
