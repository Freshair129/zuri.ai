---
feature: FR-039
module: project-manager
source: v2-native
version: 1.0.0
status: accepted
---

# FR-039 — Business scope ceiling

The application shell has one Business-bound ERP domain map. Its Base Context Bar
shows `Workspace > Organization > Business`, mapped respectively to `Portfolio >
Tenant > Business`. A lower schema Workspace and a Project remain resources within
Development, never shell scope or sidebar parents.

See [ADR-011](../ADR-011-CONTEXT-BAR-AND-BUSINESS-SCOPE-CEILING.md) for the
rationale and identity-preservation boundary.
