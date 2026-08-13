---
feature: FR-036
module: project-manager
source: v2-native
---

# FR-036 — Project Team manager

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-13 |
| **Relates to** | HANDOFF-SHELL-V2-CODEX §5 step 6, BR-001, SEC-003 |

Team is a project-context view over the existing `Membership` model. It exposes
memberships for the project workspace’s business plus tenant-wide memberships,
and counts active project WorkItems by `assigneeRef = personId`.

There is no `ProjectMember` schema in this slice. Consequently, a business Team
may mutate only memberships attached to that exact business. Tenant-wide
memberships, including every Group-workspace team, are read-only here so a
project action cannot silently revoke an entitlement with wider scope. Every
permitted mutation records an immutable audit event.
