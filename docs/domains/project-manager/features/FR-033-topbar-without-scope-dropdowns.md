---
domain: project-manager
feature: FR-033
module: shell
source: v2-native
---

# FR-033 — Topbar without scope dropdowns

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-13 |
| **Relates to** | ADR-011, SITEMAP-V2 §1–§2, HANDOFF-SHELL-V2-CODEX §5 step 3 |

The topbar never selects scope. It presents the read-only Base Context Bar:
`Workspace > Organization > Business`, mapped to `Portfolio > Tenant > Business`.
It keeps Zuri identity, ERP/PM lens toggle, command palette, new-project action,
and profile cluster. Space and Project never enter the shell chrome.

## Evidence

- Implementation: `src/components/layouts/Topbar.jsx`
- Contract tests: `tests/unit/topbar-no-dropdown.test.js`, `tests/unit/scope-view-context.test.js`
- The route-group composes this shell through `src/app/(pm)/layout.jsx`; no alternate
  Project creation or scope-picker path is introduced.
