---
domain: project-manager
feature: FR-039
module: project-manager
source: v2-native
version: 1.0.0
status: implemented
---

# FR-039 — Business scope ceiling

The application shell has one Business-bound ERP domain map. Its Base Context Bar
shows `Workspace > Organization > Business`, mapped respectively to `Portfolio >
Tenant > Business`. A lower schema Workspace and a Project remain resources within
Development, never shell scope or sidebar parents.

See [ADR-011](../../../decisions/ADR-011-CONTEXT-BAR-AND-BUSINESS-SCOPE-CEILING.md) for the
rationale and identity-preservation boundary.

## Evidence

- Implementation: `src/components/layouts/Topbar.jsx`, `src/components/layouts/Breadcrumb.jsx`,
  `src/components/layouts/DomainBar.jsx`, `src/app/(pm)/layout.jsx`
- Contract tests: `tests/unit/scope-view-context.test.js`,
  `tests/unit/topbar-no-dropdown.test.js`, `tests/unit/breadcrumb-switcher.test.js`,
  `tests/unit/domain-navigation.test.js`
- The shell stops at Business; schema Workspace and Project remain resources inside
  the Development domain.
