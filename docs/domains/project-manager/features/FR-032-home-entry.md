---
domain: project-manager
feature: FR-032
module: shell
source: v2-native
---

# FR-032 — Home entry journey

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-13 |
| **Relates to** | FR-031, ADR-008 §D, HANDOFF-SHELL-V2-CODEX §5 step 2 |

## Decision

`/` is the first scope decision for the ADR-008 shell. It obtains the viewer
from `resolveViewer()` through `/api/viewer`, then intersects that grant with the
read-only scope inventory already loaded by `ScopeProvider`.

The intersection is deliberate: the inventory describes labels and hierarchy;
the viewer grant is the only source of which businesses are visible. Home does
not infer access from a Portfolio, Tenant, URL, or localStorage selection.

## Behaviour

- More than one visible group: choose a group, then a business.
- One visible group: skip directly to its business choices.
- “All businesses” enters the selected Group scope and opens `/overview`.
- A business card persists that group and business scope before opening
  `/overview`.
- Adding a business stays in the existing Settings flow; Home does not duplicate
  the mutation form.

## Boundaries

This is an entry-route visibility seam, not an authorization retrofit for every
existing API. `resolveViewer()` is the future enforcement source as subsequent
routes are migrated. Platform DEV remains an explicit grant defined by FR-031.
