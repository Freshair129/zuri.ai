---
domain: platform-control
modules:
  - platform-control
owns_routes:
  - src/app/(control)/control/**
  - src/app/programme/**
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
- `/control/roadmap` (FR-094) has an immutable static plan projection plus a
  separately labelled evidence snapshot. The evidence is aggregate-only,
  build-time and read-only: no raw source rows, PII, cost, local paths, API,
  database or audit write may enter this domain.
- `/programme` is the explicitly public, removable share of that same static
  aggregate. It does not use a viewer or weaken `/control/**`; a URL is not a
  confidentiality control, so any newly proposed field must be safe for public
  disclosure before it is added there.
- `src/config/domains.js` is the Business-only navigation registry. This domain
  may not add itself to `DOMAINS`.
- Project-local roadmap work remains Project Manager authority under ADR-028.

## Removal contract

Removing the programme consists of deleting this route group, its shell and this
module. No Business data migration, model ownership transfer or navigation change
is required.
