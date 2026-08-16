# Domain Map

| Field | Value |
|-------|-------|
| **Status** | Auto-generated |
| **Generator** | `scripts/doc-graph.mjs` (via doc-views) |

> One section per domain: the lane, what it owns, and what lives in it — generated from the charters and the graph (ADR-025).
> Never hand-edit — regenerate with `npm run docs:graph`.

## agent

Charter: [docs/domains/agent/CHARTER.md](domains/agent/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/agent` |
| Models owned | — (state lives outside the shared schema by design) |
| Routes owned | 1 (1 api · 0 pages) |
| FRs implemented in lane | FR-025, FR-026, FR-027, FR-029, FR-047, FR-048, FR-049, FR-051, FR-052, FR-053, FR-054, FR-055, FR-057 |

## crm

Charter: [docs/domains/crm/CHARTER.md](domains/crm/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/crm` |
| Models owned | Person, Customer, Conversation, Message |
| Routes owned | 0 (0 api · 0 pages) |
| FRs implemented in lane | FR-023 |

## identity

Charter: [docs/domains/identity/CHARTER.md](domains/identity/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/identity` |
| Models owned | ExternalIdentity, IdentityLinkToken, ExternalRef |
| Routes owned | 3 (1 api · 2 pages) |
| FRs implemented in lane | FR-021, FR-022, FR-031, FR-038, FR-046 |

## knowledge

Charter: [docs/domains/knowledge/CHARTER.md](domains/knowledge/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/knowledge` |
| Models owned | — (state lives outside the shared schema by design) |
| Routes owned | 0 (0 api · 0 pages) |
| FRs implemented in lane | FR-024, FR-047, FR-051, FR-052, FR-054 |

## project-manager

Charter: [docs/domains/project-manager/CHARTER.md](domains/project-manager/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/project-manager`, `src/modules/business`, `src/modules/people` |
| Models owned | Portfolio, Tenant, LegalEntity, LegalEntityIdentifier, Business, Branch, Workspace, Project, BusinessRoadmap, BusinessRoadmapHorizon, BusinessGoal, ProjectGoal, Workstream, WorkContainer, WorkItem, Milestone, Gate, Dependency, Repository, ProjectRepository, ProjectFile, LocalWorkspaceMount, FileAsset, FileLink, Membership, AuditEvent |
| Routes owned | 91 (59 api · 32 pages) |
| FRs implemented in lane | FR-001, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-018, FR-019, FR-020, FR-036, FR-037, FR-040, FR-041, FR-042, FR-043, FR-045, FR-058, FR-059 |
