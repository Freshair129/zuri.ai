# ADR-017 — Production viewer session and viewer-scoped entry read model

**Status:** Accepted — implemented beta

| Field | Value |
|---|---|
| **Version** | 0.2.0b |
| **Date** | 2026-08-14 |
| **Risk** | HIGH — authentication trust boundary and cross-tenant disclosure |
| **Amends** | ADR-015 D3-D5; SDD-011; Appendix A entry contract |
| **Relates to** | FR-031, FR-044, FR-046, SDD-024, SEC-008, ZV2-CR-002 |

## Context

The FR-044 routing proof loads `GET /api/viewer` and the broad `GET /api/scope`
independently, then intersects their results in the browser. That is acceptable for
the explicit local demo, but it is not a production authorization boundary: an
unauthorized Business and its Portfolio/Tenant ancestry can already be disclosed by
the scope response before the client hides it.

`resolveViewer()` is already the canonical RBAC resolver, but the current route calls
it without a trusted request identity. In non-production this intentionally falls
back to the seeded owner. Production must instead resolve a server-authenticated
principal and must fail closed when no trusted session exists.

## Decision

### D1 — One pre-shell read boundary

Add a dedicated viewer-scoped entry read model:

```text
GET /api/entry
  trusted request session
    -> resolveRequestViewer(request)
    -> resolveViewer({ principalId, platformGrant })
    -> query only viewer-visible Business rows and required ancestry
    -> return one atomic response
```

`/businesses` consumes only `GET /api/entry`. It must not combine `/api/viewer` with
the broad `/api/scope` inventory. The response contains only selectable Businesses
and the minimum Portfolio/Tenant labels needed to render their ancestry.

### D2 — Trusted session seam

`resolveRequestViewer(request)` obtains identity exclusively from a server-owned
`SessionPort`. The port returns either:

```js
{ state: 'AUTHENTICATED', principalId, platformGrant, sessionId }
{ state: 'UNAUTHENTICATED' }
```

The API must never accept `principalId`, role, visible Business IDs, domain grants,
or `platformGrant` from query parameters, request bodies, ordinary headers, or client
storage. `platformGrant` is server-held session authority and remains distinct from
Business Membership.

The concrete login provider and session persistence mechanism are separate decisions.
This ADR defines the consumer contract they must satisfy; it does not silently choose
password, LINE Login, OIDC, or a hosted vendor.

### D3 — Explicit local demo capability

The seeded-owner fallback remains available only when all are true:

1. runtime is not production;
2. an explicit local-demo capability is enabled; and
3. the caller uses the local demo entry flow.

Production and capability-disabled environments return `401 AUTH_REQUIRED`; they do
not infer an owner or silently widen access. Tests must prove that `NODE_ENV=production`
cannot activate the fallback even if a client sends forged identity fields.

### D4 — Response minimization

Successful `GET /api/entry` returns:

```json
{
  "viewer": {
    "principal": { "id": "uuid", "displayName": "name" },
    "role": "OWNER",
    "visibleDomains": ["projects"],
    "isPlatform": false
  },
  "businesses": [
    {
      "id": "uuid",
      "code": "BUS-001",
      "name": "Business 01",
      "tenant": { "id": "uuid", "code": "TEN-001", "name": "Tenant 001" },
      "portfolio": { "id": "uuid", "code": "PF-001", "name": "Business Group" }
    }
  ]
}
```

The response omits memberships, hidden Business IDs, unrelated ancestry, Workspaces,
Projects, legal entities, branches, and any client-editable authorization claims.
An authenticated viewer with no visible Business receives `200` with an empty list;
absence of a trusted session receives `401`; session-store failure receives `503` and
must not fall back to demo or broad scope.

### D5 — Existing endpoint compatibility

- `GET /api/viewer` remains during a compatibility window, but uses the same trusted
  request-session seam and never becomes a way to choose another principal.
- `GET /api/scope` remains an internal scope-management interface. It is removed from
  Business Routing and requires its own authorization policy before production use.
- BusinessShell APIs continue to authorize the requested Business/resource on the
  server; possession of an ID or prior `/api/entry` response is not authorization.

### D6 — Audit and privacy

Successful reads do not emit high-volume audit rows. Session creation, revocation,
platform impersonation/support access, and denied privileged attempts are meaningful
security events and must be auditable by the eventual session provider. API errors
must not reveal whether a hidden Business, Person, or session identifier exists.

## Alternatives considered

| Option | Result |
|---|---|
| Filter `/api/scope` in the browser | Rejected: disclosure occurs before filtering |
| Make all `GET /api/scope` viewer-filtered | Rejected for N4: conflates routing read model with scope administration and returns unnecessary entities |
| New `GET /api/entry` atomic read model | Accepted: minimal payload, one authorization decision, explicit compatibility boundary |

## Consequences

- Business Routing has one fetch and cannot infer hidden rows from a broad inventory.
- Production callers without a trusted session fail closed.
- A later provider choice can replace `SessionPort` without changing RBAC or the entry
  DTO.
- `/api/scope` authorization remains a separate hardening task and is not made safe by
  this ADR alone.

## Approval and implementation gate

The owner approved ADR-017, FR-046, SDD-024, SEC-008 and ZV2-CR-002 on 2026-08-14.
The provider-neutral seam and explicit non-production demo cookie are implemented;
selection of a real login provider or persisted session model still requires a new decision.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Proposed trusted request-viewer seam and minimal `/api/entry` read model | pending | ATHER |
| 0.2.0b | 2026-08-14 | beta | Owner approved; contract implemented and verified without choosing a login provider | pending | ATHER |
