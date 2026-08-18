---
domain: project-manager
feature: FR-034
module: shell
source: v2-native
---

# FR-034 — Breadcrumb scope switcher

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-13 |
| **Relates to** | ADR-011, SITEMAP-V2 §2b, HANDOFF-SHELL-V2-CODEX §5 step 4 |

Breadcrumbs mirror the Base Context Bar without reintroducing a selector dropdown.
Workspace, Organization, and Business return to Home when changed. A Project may
appear only as the opened resource and never becomes a global scope switcher. Space
does not appear in the breadcrumb.

## Evidence

- Implementation: `src/components/layouts/Breadcrumb.jsx`
- Contract tests: `tests/unit/breadcrumb-switcher.test.js`, `tests/unit/scope-view-context.test.js`
- The breadcrumb remains inside the BusinessShell route group and does not create a
  parallel scope-selection or Project-creation surface.
