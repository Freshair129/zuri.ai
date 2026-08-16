---
domain: project-manager
feature: FR-043
module: project-manager
source: v2-native
---

# FR-043 - Project Business Ownership and Space Context

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-13 |
| **Relates to** | ADR-014, FR-039, FR-041, SDD-021, BR-001, SEC-001 |

`Project.businessId` is the direct Business owner. `Project.workspaceId` remains
the Development Space used to group work. A normal Business project must have a
matching Business-owned Space; a null owner is reserved for explicitly shared
portfolio/tenant projects.

## Acceptance criteria

- **AC-043.1:** Creating a project in a Business Space persists that Space's
  `businessId` on `Project.businessId` when no owner is supplied.
- **AC-043.2:** Create, update, and import reject a project whose direct owner
  differs from its Space owner, and reject a null owner in a Business Space.
- **AC-043.3:** Business project listing and Business Strategy links filter by
  `Project.businessId`; shared projects are not attributed to a Business.
- **AC-043.4:** The Project header displays Business as the owner and labels the
  schema Workspace as secondary `Space` metadata.
- **AC-043.5:** Existing shared portfolio/tenant projects remain readable with a
  null owner and existing Workspace/Project routes continue to work.

## Exit gate

The feature is complete only when focused binding/import/UI tests, the full test
suite, build, `docs:graph`, `docs:preflight`, `docs:check`, and `git diff --check`
are green.
