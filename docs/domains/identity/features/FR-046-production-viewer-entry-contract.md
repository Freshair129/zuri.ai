---
domain: identity
feature: FR-046
module: identity
source: v2-native
---

# FR-046 — Production viewer session and entry contract

| Field | Value |
|---|---|
| **Version** | 0.3.0b |
| **Status** | Implemented — beta |
| **Date** | 2026-08-14 |
| **Relates to** | ADR-017, SDD-024, SEC-008, FR-031, FR-044, ZV2-CR-002 |

## User story

As a signed-in Zuri user, I want Business Routing to return only Businesses that my
server-authenticated identity may access, so that hidden tenant/business information
cannot be inferred from browser traffic.

## Requirements

1. WHEN `/businesses` loads THEN the system SHALL obtain its complete routing payload
   from one viewer-scoped `GET /api/entry` response.
2. WHEN a trusted session resolves a principal THEN the system SHALL apply
   `resolveViewer()` and query only Businesses in `visibleBusinessIds` plus their
   minimum Portfolio/Tenant ancestry.
3. WHEN no trusted session exists THEN the system SHALL return `401 AUTH_REQUIRED`
   without querying or returning Business inventory.
4. WHEN an authenticated viewer has no Business grant THEN the system SHALL return
   `200` with an empty Business list and no unrelated ancestry.
5. IF a client supplies a principal, role, platform flag, visible ID, or domain grant
   THEN the system SHALL ignore or reject it; authorization SHALL come only from the
   server session and persisted Membership/platform authority.
6. WHEN the session adapter fails THEN the system SHALL return a non-disclosing `503`
   and SHALL NOT fall back to a demo owner or broad scope.
7. WHILE the compatibility window is active THEN `/api/viewer` SHALL use the same
   request-session seam and `/api/scope` SHALL NOT be used by Business Routing.
8. WHEN a user submits an identifier (email or account code) and password to
   `/api/auth/login` THEN the system SHALL verify the persisted `PersonCredential`
   and return a signed, expiring HttpOnly `zuri_session` cookie; missing or invalid
   credentials SHALL return a generic `401` without issuing a cookie.
9. WHEN a user posts `/api/auth/logout` THEN the system SHALL clear the signed
   session cookie; no local-demo capability, seeded-owner fallback or client identity
   input SHALL authenticate a request.

## Acceptance criteria

- [x] AC-046-01 OWNER receives only Businesses granted by persisted Membership scope.
- [x] AC-046-02 MEMBER receives only explicitly granted or tenant-wide allowed Businesses and only granted domains.
- [x] AC-046-03 DEV access requires a server-held platform grant; Membership cannot promote a user to DEV.
- [x] AC-046-04 Empty grants return `200` with `businesses: []` and no hidden ancestry.
- [x] AC-046-05 Missing/expired/revoked session returns `401` before any scope query.
- [x] AC-046-06 Forged client principal/role/platform/business fields do not affect the result.
- [x] AC-046-07 Cross-tenant IDs and unrelated Portfolio/Tenant labels never appear in the payload.
- [x] AC-046-08 Session adapter failure returns `503` and no local fallback.
- [x] AC-046-09 `/businesses` performs one entry fetch and does not call `/api/scope` or `/api/viewer`.
- [x] AC-046-10 BusinessShell and protected APIs still re-authorize the active Business/resource server-side.
- [x] AC-046-11 Credential login verifies `PersonCredential`, rejects empty/invalid credentials generically, and issues no cookie on failure.
- [x] AC-046-12 Successful login issues a signed expiring HttpOnly session; logout clears it; tampered and expired tokens are unauthenticated.
- [x] AC-046-13 No local-demo capability, seeded-owner fallback or client-controlled identity path remains in runtime authentication.
- [~] AC-046-14 Authentication unit/contract/integration/browser paths, build, docs graph/preflight/check, and diff gates pass; four unrelated global-view smoke assertions still require explicit project/workspace scope.
- [x] AC-046-15 Login issues a browser-session cookie by default and the existing signed seven-day cookie only when the caller opts in ("remember me"). The signed ceiling at `SESSION_MAX_AGE_SECONDS` is unchanged, and the opt-in never enters the token payload or the credential check — it selects the cookie's `Max-Age` and nothing else.

## Out of scope

- choosing a hosted auth vendor, LINE Login or OIDC;
- account recovery, MFA, device management, and session-management UI;
- redesigning Landing/Login visuals or design tokens;
- changing Membership, Person, Tenant, Business, or Project ownership semantics;
- making the broad `/api/scope` mutation surface production-ready.

## Exit gate

Authentication ACs are green; `/businesses` cannot observe broad scope inventory;
credential login and logout use the signed server session; no seeded-owner or
local-demo fallback exists; security review finds no client-controlled identity
input; generated traceability links FR-046, SDD-024, and SEC-008 to code and tests.
The remaining global-view smoke assertions are an authorization-scope follow-up,
not a login bypass.

## Decision — logout had no surface until now (2026-09-04)

`POST /api/auth/logout` (this file's AC-046-09/-12) revoked the live `Session`
and cleared its cookie since 0.3.0b, but nothing in the UI ever called it —
`grep -rn "logout" src/components src/app --include=*.jsx` found no caller. A
signed-in person had no way to sign out: only session expiry or clearing
cookies by hand ended a session. This closes that gap without opening a new
requirement, because the behaviour it needed was already specified here and in
FR-095 (Session/IAM boundary) — adding a caller to an existing, tested contract
is not a new capability.

The request-and-redirect decision lives in one pure module,
`src/modules/identity/sign-out.js` (`buildSignOutRequest`,
`resolveSignOutRedirect`, `performSignOut`), so the four shells that can hold a
signed-in person call the same logic instead of four hand-written
fetch-then-redirect copies:

- `src/components/layouts/Topbar.jsx` — the BusinessShell chrome (`/overview`
  and Business domains).
- `src/components/layouts/PlatformControlShell.jsx` — the operator surface
  (`/control/**`).
- `src/components/layouts/BusinessRoutingShell.jsx` — the shared pre-shell for
  `/businesses`, `/onboarding/profile`, `/waiting-room` and `/workspace-home`.
  The Waiting Room in particular holds the person most likely to need
  sign-out: Profile-only, no Business grant yet.

`/login`, `/signup` and `/reset-password` (EntryShell) get no control — nobody
is signed in there. The redirect to `/login` is unconditional (`router.replace`,
never `push`, so the back button cannot return to a page the now-cleared
session no longer authorizes) because the route's own 503 path still clears
the cookie; what varies is whether the person is told the server-side revoke
did not confirm, which is surfaced via `window.alert` (this codebase's
existing convention for a client mutation that must report its own failure)
rather than dropped silently.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.5.0b | 2026-09-04 | beta | Added the sign-out UI surface (`src/modules/identity/sign-out.js`) that was missing across every signed-in shell; no change to the route or its ACs | working-tree | Claude Opus 5 |
| 0.4.0b | 2026-08-29 | beta | AC-046-15: "remember me" makes the seven-day cookie opt-in; the default is now a browser-session cookie. The token's `exp` and the verified ceiling are untouched, so opting out is strictly shorter-lived and opting in restores exactly the previous behaviour | working-tree | ATHER |
| 0.3.0b | 2026-08-22 | beta | Added PersonCredential verification, signed session login/logout, and removed the local-demo authentication path | working-tree | ATHER |
| 0.1.0b | 2026-08-14 | candidate | Initial EARS requirements, AC and scope boundary | pending | ATHER |
| 0.2.0b | 2026-08-14 | beta | Approved implementation with request-session, entry read model, compatibility and security proof | pending | ATHER |
