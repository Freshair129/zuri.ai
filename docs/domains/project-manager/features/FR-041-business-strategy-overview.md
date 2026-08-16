---
domain: project-manager
feature: FR-041
module: shell
source: v2-native
---

# FR-041 - Business Strategy Overview

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-13 |
| **Relates to** | ADR-013, SDD-020, FR-035, FR-039 |

`/overview` is the operational home of the selected Business. It shows only
Business-owned Projects and a Business Strategy section containing the current
Roadmap and two or three ordered goal horizons. A missing Business selection is
an actionable empty state, not a group roll-up.

The first slice exposes a read-only, viewer-filtered strategy contract. Horizon
cardinality and ordering are enforced by the application service; roadmap/goal
editing and Project links are explicitly deferred to a follow-up mutation slice.
