---
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
