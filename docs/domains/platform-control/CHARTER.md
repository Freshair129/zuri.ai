---
domain: platform-control
modules:
  - platform-control
owns_routes:
  - src/app/(control)/control/**
  - src/app/api/health/**
owns_code:
  - src/modules/platform-control/**
  - src/components/layouts/PlatformControlShell.jsx
  - src/components/layouts/PlatformControlGuard.jsx
---

# Domain charter — platform-control

Platform Control owns installation-operator-only, removable operational
projections. It is deliberately **not** a Business capability domain and owns no
Tenant, Business, Project, Workstream, user-visible Business navigation entry or
persistence model.

## Boundary

- `/control/**` uses PlatformControlShell, never BusinessShell/AppShell.
- Authorization is delegated to Identity's `isInstallationOperator` capability
  (FR-075). `isPlatform`, role, Business ownership and domain visibility grant
  nothing here.
- The first surface, `/control/roadmap` (FR-105), is an immutable static plan
  projection. It accepts no input and makes no API, database or audit write.
- `src/config/domains.js` is the Business-only navigation registry. This domain
  may not add itself to `DOMAINS`.
- Project-local roadmap work remains Project Manager authority under ADR-028.
- `GET /api/health` (FR-142, ADR-058) is the deployment liveness probe Docker
  Compose polls. It is infrastructure, not a Business capability: unauthenticated,
  read-only, one trivial query, states and timings only. It lives in this lane
  because it is an operational projection that can be removed with the
  deployment layer and touches no Business data or navigation.

## Removal contract

Removing the programme consists of deleting this route group, its shell and this
module. No Business data migration, model ownership transfer or navigation change
is required.
