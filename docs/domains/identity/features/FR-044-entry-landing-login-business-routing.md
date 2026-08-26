---
domain: identity
feature: FR-044
module: shell-entry
source: v2-native
---

# FR-044 — Minimal entry and Business Routing before BusinessShell

**Version**: 0.6.0

| Field | Value |
|---|---|
| **Status** | Implemented — owner-approved; exit gates verified |
| **Design** | ADR-015, SDD-022 |
| **Token policy** | Reuse ADR-010 / `docs/UI-DESIGN-SYSTEM.md`; no token changes |

> **Approved follow-up:** [ADR-027](../../../decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md)
> and FR-066/067 add Profile-only, Waiting Room and Workspace-membership states
> before Business Routing. The route proof below remains the verified FR-044
> compatibility slice until that follow-up is implemented.

> **Authentication amendment:** the routing boundary in this feature remains
> authoritative, but the historical demo Login behavior is superseded by
> [FR-046](FR-046-production-viewer-entry-contract.md) and ADR-017. The current
> `/login` surface performs credential authentication before Business Routing;
> the demo CTA and credential-free transition are retained below only as the
> historical acceptance record for this routing slice.

## Requirement

The application must make Business selection a precondition of the final Business
shell. The first slice contains only routing proof surfaces:

```text
/          Landing CTA
/login     Credential Login (FR-046 amendment)
/businesses Business Routing and Business selection
/overview  BusinessShell after selection
```

## Acceptance criteria

| ID | Acceptance criterion |
|---|---|
| AC-044.1 | `/` renders a minimal landing surface with one CTA to `/login`; it has no DomainBar, Development sidebar, Project tabs, or Business picker. |
| AC-044.2 | `/login` renders a compact mock-login surface with email and password-shaped controls plus one demo CTA; controls are presentation-only without form names, and the CTA performs no credential/authentication work before routing to `/businesses`. |
| AC-044.3 | `/businesses` resolves the viewer and displays only Businesses allowed by `visibleBusinessIds`; Portfolio/Organization are ancestry labels, not selectable operational shells. |
| AC-044.4 | Selecting a Business persists the existing scope selection and routes to `/overview`; the final BusinessShell mounts only after the selection is authorized. |
| AC-044.5 | `/overview` and Business-bound domain routes redirect to `/businesses` when no Business is selected; unauthorized Business/domain access cannot render Business content. |
| AC-044.6 | `/businesses` remains visible for a single-Business viewer in this slice; auto-skip is not used because the routing boundary is the feature under proof. |
| AC-044.7 | Landing, Login, and Business Routing reuse existing design tokens and primitives. No new token, font, palette, spacing, or visual-system document is introduced. |
| AC-044.8 | The implementation preserves `Project.businessId` as the owner and `Project.workspaceId` as Space context; this feature changes entry routing only. |
| AC-044.9 | A selected Business can return to `/businesses` by clicking the Organization value in the top context bar (`Workspace › Organization › Business`); Business is read-only, no separate action or dropdown is introduced, and the breadcrumb remains read-only. |
| AC-044.10 | The BusinessShell breadcrumb is local navigation only: Home and Workspace return to `/overview`, while it never exits to Landing or Business Routing; changing Business remains exclusive to the Topbar Organization value. |

## Exit gate

- [x] ADR-015 and SDD-022 approved.
- [x] Route-shell guard tests cover `AUTH_REQUIRED`, `BUSINESS_REQUIRED`, `READY`,
      `FORBIDDEN`, and `NOT_FOUND` decisions.
- [x] Browser proof visits `/` → `/login` → `/businesses` → `/overview` and verifies
      that BusinessShell chrome is absent before selection and present after selection.
- [x] Demo login is clearly labeled as local/non-auth; credential-shaped controls are
      presentation-only and no entered value is submitted, persisted, validated, or logged.
- [x] Existing tokens are reused; no design-system diff beyond route composition.
- [x] `npm test`, `npm run build`, `npm run docs:graph`, `npm run docs:preflight`, and
      `npm run docs:check` pass.
- [x] The selected Business has exactly one visible return path to Business Routing:
      the Organization value in the top context bar; the Business value and breadcrumb
      are read-only.
- [x] BusinessShell breadcrumb navigation stays inside `/overview`; it does not link to
      `/` or `/businesses`.

## Out of scope

Production auth, real sessions, landing-page visual design, BusinessModule storage,
new ERP domains, and design-token redesign.
