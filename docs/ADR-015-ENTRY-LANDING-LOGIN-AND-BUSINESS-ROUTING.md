# ADR-015 — Minimal entry, demo login, and Business Routing before BusinessShell

**Status:** Accepted — implementation complete

| Field | Value |
|---|---|
| **Status** | Accepted — implementation complete |
| **Date** | 2026-08-13 |
| **Decided by** | Owner approval (2026-08-13) |
| **Amends** | ADR-008 §D4, ADR-011 §D2, SITEMAP-V2 §2b (entry boundary only) |
| **Relates to** | FR-044, SDD-022, FR-031, FR-032, FR-035, FR-039 |

## Context

The existing code has a Home Business picker, but `src/app/layout.jsx` mounts the
Business-oriented `AppShell` around every route, including `/`. This makes the user
appear to select a Business inside the final shell. The desired journey is a staged
entry: a minimal landing page, a temporary login action, a Business Routing page, and
only then the Business shell.

This slice is intentionally a routing proof. It does not implement authentication,
landing-page visual design, new design tokens, or the future lifted ERP domains.

## Decision (approved)

### D1 — Four logical interface layers

```text
EntryShell
  /             Landing (one CTA)
  /login        Demo Login (one CTA, no auth provider)

BusinessRoutingShell
  /businesses   viewer-visible Business cards/list; no domain/sidebar chrome

BusinessShell
  /overview     selected Business Overview
  /{domain}/... Business-bound domain and sub-domain pages

ProjectResourceShell
  /projects/{id}/... Project tabs nested inside BusinessShell
```

`EntryShell` and `BusinessRoutingShell` are not BusinessShell. Neither may render
the final DomainBar, Development sidebar, Project tabs, or a Business picker inside
the operating shell.

### D2 — Minimal route behavior

| Route | Behavior | Required result |
|---|---|---|
| `/` | Landing page with a single “เข้าสู่ระบบ”/“Sign in” CTA | click navigates to `/login`; no auth call; no BusinessShell chrome |
| `/login` | Login stub with a single demo login CTA | click establishes a local demo-entry state and navigates to `/businesses`; no credentials are accepted or persisted |
| `/businesses` | Business Routing page | resolves viewer, loads scope inventory, filters to `visibleBusinessIds`, groups by Portfolio/Tenant ancestry if useful, and lets the user select one Business |
| `/overview` | guarded BusinessShell root | mounts only when the selected Business is authorized; otherwise redirects to `/businesses` |
| Business domain route | guarded BusinessShell domain page | requires the same selected Business and visible domain grant |
| Project resource route | guarded ProjectResourceShell | requires BusinessShell plus a Project that belongs to the selected Business or an explicit shared Space |

The Business Routing page is shown even when exactly one Business is visible. Adaptive
auto-skip is deferred so the boundary can be verified. It may be reconsidered in a
later ADR without changing the data model.

### D3 — Demo login is explicitly non-authentication

The Login button is a local demo transition only. It must not be described as a
production session, password check, token issuance, or authorization grant. Existing
`GET /api/viewer` remains the RBAC seam; the local development fallback remains the
only identity behavior in this slice.

### D4 — Business Routing data contract

The routing page consumes the existing interfaces:

```text
GET /api/viewer  → principal, role, visibleBusinessIds, visibleDomains
GET /api/scope   → Portfolio/Tenant/Business labels and ids for routing display
```

The UI may use Portfolio and Tenant only as ancestry/grouping labels. The selectable
operating node is always `Business`; an Organization/Portfolio card must not enter an
operational shell or become an “all businesses” overview in this slice.

Before production auth, the scope inventory must be viewer-filtered server-side or be
replaced by a dedicated viewer-scoped entry response. Client-side filtering is a demo
compatibility measure, not a security boundary.

### D5 — Guard and state contract

The route guard resolves these states before BusinessShell render:

```text
AUTH_REQUIRED      → /login
BUSINESS_REQUIRED  → /businesses
READY              → requested BusinessShell route
FORBIDDEN          → Business Overview or explicit forbidden state
NOT_FOUND          → route/resource error boundary
```

Loading, error, empty, and offline indicators reuse existing UI primitives and tokens.
No new token file or visual system is introduced.

### D6 — Design boundary

Landing, Login, and Business Routing use the existing Zuri Heritage tokens and shared
primitives from ADR-010 / `docs/UI-DESIGN-SYSTEM.md`. Typography, spacing, color, and
component token redesign are explicitly deferred to a future design-token document.

## Non-goals

- production authentication, password/OIDC/LINE login, sessions, or token storage;
- landing-page marketing design or illustration work;
- BusinessModule persistence and per-Business module configuration;
- changing Project ownership (`businessId` + `workspaceId`);
- redesigning the existing Zuri token system.

## Consequences

- The current Home Business picker moves conceptually to `/businesses`.
- The root `/` becomes a deliberately small landing surface.
- BusinessShell can assume an authorized `activeBusinessId`; it no longer owns a
  Business selection empty state.
- Existing `/api/viewer` and `/api/scope` remain usable, but the production filtering
  boundary must be resolved before real authentication is enabled.

## Approval gate

Owner approval was given on 2026-08-13. FR-044, SDD-022, and the implementation plan
are accepted for the routing proof slice; implementation and verification gates are
recorded in the feature note and plan.
