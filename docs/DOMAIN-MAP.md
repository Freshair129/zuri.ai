# Domain Map

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Auto-generated |
| **Generator** | `scripts/doc-graph.mjs` (via doc-views) |

> One section per domain: the lane, what it owns, and what lives in it — generated from the charters and the graph (ADR-025).
> Never hand-edit — regenerate with `npm run docs:graph`.

> Machine-readable implementation readiness: [docs/.domain-state.json](.domain-state.json). It is generated with the graph and is not a runtime domain state.

## agent

Charter: [docs/domains/agent/CHARTER.md](domains/agent/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/agent` |
| Models owned | — (state lives outside the shared schema by design) |
| Routes owned | 3 (3 api · 0 pages) |
| FRs implemented in lane | FR-025, FR-026, FR-027, FR-029, FR-047, FR-048, FR-049, FR-052, FR-053, FR-054, FR-055, FR-057, FR-079, FR-080, FR-093 |

## crm

Charter: [docs/domains/crm/CHARTER.md](domains/crm/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/crm` |
| Models owned | Person, Customer, CustomerImportBatch, CustomerImportProvenance, CustomerImportReviewCase, CustomerImportReviewDecision, Conversation, Message |
| Routes owned | 0 (0 api · 0 pages) |
| FRs implemented in lane | FR-023, FR-078, FR-091, FR-093 |

## identity

Charter: [docs/domains/identity/CHARTER.md](domains/identity/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/identity` |
| Models owned | ExternalIdentity, IdentityLinkToken, ExternalRef, RoleBinding, PersonCredential, PasswordResetToken |
| Routes owned | 3 (1 api · 2 pages) |
| FRs implemented in lane | FR-021, FR-022, FR-031, FR-036, FR-038, FR-046, FR-059, FR-061, FR-062, FR-074, FR-075, FR-076, FR-078, SDD-034 |

## integration

Charter: [docs/domains/integration/CHARTER.md](domains/integration/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/integration` |
| Models owned | IntegrationProvider, IntegrationConnection, IntegrationCredential, IngestionRun, PipelineRun, PipelineStep, PipelineEventReceipt, PipelineRecordEvent, PipelineReconciliation, PipelineGateDecision, RawExternalRecord, SyncCursor, ExternalEntityRef, DeadLetterRecord |
| Routes owned | 3 (2 api · 1 pages) |
| FRs implemented in lane | FR-080 |

## knowledge

Charter: [docs/domains/knowledge/CHARTER.md](domains/knowledge/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/knowledge` |
| Models owned | — (state lives outside the shared schema by design) |
| Routes owned | 0 (0 api · 0 pages) |
| FRs implemented in lane | FR-024, FR-047, FR-051, FR-052, FR-054 |

## market-intelligence

Charter: [docs/domains/market-intelligence/CHARTER.md](domains/market-intelligence/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/market-intelligence` |
| Models owned | MarketObservation |
| Routes owned | 0 (0 api · 0 pages) |
| FRs implemented in lane | FR-092, NFR-018 |

## project-manager

Charter: [docs/domains/project-manager/CHARTER.md](domains/project-manager/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/project-manager`, `src/modules/business`, `src/modules/people` |
| Models owned | Portfolio, Tenant, LegalEntity, LegalEntityIdentifier, Business, Branch, Workspace, Project, BusinessRoadmap, BusinessRoadmapHorizon, BusinessGoal, ProjectGoal, Workstream, WorkContainer, WorkItem, Milestone, Gate, Dependency, Repository, ProjectRepository, ProjectFile, Team, TeamMembership, ProjectTeam, LocalWorkspaceMount, FileAsset, FileLink, Membership, AuditEvent, PlanImportReceipt |
| Routes owned | 114 (77 api · 37 pages) |
| FRs implemented in lane | BR-001, FR-001, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-017, FR-018, FR-019, FR-020, FR-036, FR-037, FR-040, FR-041, FR-042, FR-043, FR-045, FR-058, FR-059, FR-060, FR-063, FR-064, FR-065, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-077, FR-078, FR-081, FR-086, FR-087, FR-088, FR-089, FR-090, FR-092, SDD-037 |
