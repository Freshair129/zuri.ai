---
domain: identity
feature: FR-046
module: identity
source: v2-native
---

# FR-046 — Production viewer session and entry contract

| Field | Value |
|---|---|
| **Version** | 0.2.0b |
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
8. IF explicit local-demo capability is enabled outside production THEN the demo flow
   MAY create a local-only trusted session; production SHALL never activate that path.

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
- [x] AC-046-11 Non-production demo capability is explicit and is impossible to enable in production.
- [x] AC-046-12 Unit, contract, integration, browser, build, docs graph/preflight/check, and diff gates pass.

## Out of scope

- choosing or implementing password, LINE Login, OIDC, or a hosted auth vendor;
- account recovery, MFA, device management, and session-management UI;
- redesigning Landing/Login visuals or design tokens;
- changing Membership, Person, Tenant, Business, or Project ownership semantics;
- making the broad `/api/scope` mutation surface production-ready.

## Exit gate

All AC-046 checks are green; `/businesses` cannot observe broad scope inventory;
production has no implicit seeded-owner fallback; security review finds no client-
controlled identity input; rollback restores the FR-044 demo routing without schema
loss; generated traceability links FR-046, SDD-024, and SEC-008 to code and tests.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Initial EARS requirements, AC and scope boundary | pending | ATHER |
| 0.2.0b | 2026-08-14 | beta | Approved implementation with request-session, entry read model, compatibility and security proof | pending | ATHER |
