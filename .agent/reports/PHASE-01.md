# Phase 01 — Scope Model

**Status: PASS**

## Implemented
- Models: Portfolio, Tenant, LegalEntity + LegalEntityIdentifier, Business, Branch, Workspace, Person, Membership (all with human codes, UUID PKs, timestamps, version where specified).
- `scope-service.js`: creation with generated human codes, workspace scope validation (explicit PORTFOLIO/TENANT/BUSINESS scope + ancestor denormalization), `assertWorkspaceInScope` isolation guard, `listWorkspacesForScope`.
- Branch creation enforces `branch.tenantId === business.tenantId` (tenant ≠ branch).
- `ScopeContext` (client) with persisted selection; topbar selectors for Portfolio / Business / Workspace / Project; selecting an ancestor clears descendants.
- Seed: PF-001, TNT-001..004 with BUS-001..004 (4 isolated tenants), WS-PLATFORM + 4 business workspaces, LE-001 with TH_TAX_ID identifier, BR-001, local owner Person + Membership.

## Changed files
`src/modules/project-manager/application/scope-service.js`, `src/context/ScopeContext.jsx`, `src/components/layouts/{Topbar,Sidebar,AppShell,CommandPalette}.jsx`, `src/app/api/scope/route.js`, `src/app/api/workspaces/[id]/route.js`, `prisma/seed.js`, `src/app/(pm)/workspaces/*`.

## Database changes
Seed data as above; idempotent (verified by double-run).

## Tests run / results
`tests/integration/scope-and-isolation.test.js` — 7 tests, all pass:
- full chain creation, tenant ownership on business, tenant≠branch rejection,
- BUS-ISO-1 workspace absent from BUS-ISO-2 scoped query,
- project isolation per business, cross-tenant/business assertion rejection,
- workspace explicit-scope requirement.

## Screens/routes verified
`/workspaces`, `/workspaces/[id]`, topbar selectors live on all routes.

## Known issues
None.

## Decisions made
Tenant selection is implied by Business selection in the topbar (tenants are isolation, not a navigation concept for the demo user).

## Next phase
Phase 02 — Project core.
