# Domain Map

| Field | Value |
|-------|-------|
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
| Routes owned | 4 (4 api · 0 pages) |
| FRs implemented in lane | — |

## asset-management

Charter: [docs/domains/asset-management/CHARTER.md](domains/asset-management/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/asset-management` |
| Models owned | RegisteredAsset, AssetIntake, AssetEvidence, AssetProcurementRef, AssetLot, AssetResponsibility, AssetLocationHistory, AssetProjectAllocation, AssetDepreciationCandidate, AssetExtractionJob |
| Routes owned | 4 (4 api · 0 pages) |
| FRs implemented in lane | — |

## crm

Charter: [docs/domains/crm/CHARTER.md](domains/crm/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/crm` |
| Models owned | Person, Customer, CustomerImportBatch, CustomerImportProvenance, CustomerImportReviewCase, CustomerImportReviewDecision, Conversation, Message, ConversationAnalysis |
| Routes owned | 0 (0 api · 0 pages) |
| FRs implemented in lane | — |

## identity

Charter: [docs/domains/identity/CHARTER.md](domains/identity/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/identity` |
| Models owned | ExternalIdentity, IdentityLinkToken, ExternalRef, RoleBinding, PersonCredential, PasswordResetToken, Session, ChannelIdentity, SotDataPlaneKey, WorkspaceMembership, WorkspaceInvite, ApiAccessKey, PlatformGrant, PluginInstallation, PluginAuthorizationCode, PluginSession, EdgeDeviceCredential |
| Routes owned | 26 (18 api · 8 pages) |
| FRs implemented in lane | — |

## integration

Charter: [docs/domains/integration/CHARTER.md](domains/integration/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/integration` |
| Models owned | IntegrationProvider, IntegrationConnection, IntegrationCredential, IngestionRun, RawExternalRecord, SyncCursor, ExternalEntityRef, DeadLetterRecord, SotDecision, PipelineRun, PipelineStep, PipelineEventReceipt, PipelineRecordEvent, PipelineReconciliation, PipelineGateDecision |
| Routes owned | 11 (7 api · 4 pages) |
| FRs implemented in lane | — |

## knowledge

Charter: [docs/domains/knowledge/CHARTER.md](domains/knowledge/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/knowledge` |
| Models owned | — (state lives outside the shared schema by design) |
| Routes owned | 0 (0 api · 0 pages) |
| FRs implemented in lane | — |

## line-oa-studio

Charter: [docs/domains/line-oa-studio/CHARTER.md](domains/line-oa-studio/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/line-oa-studio` |
| Models owned | LineOaAccount, LineOaRichMenu, LineOaRichMenuVersion, LineOaRichMenuJob, LineOaLiffApp, LineConversationJob |
| Routes owned | 17 (15 api · 2 pages) |
| FRs implemented in lane | — |

## market-intelligence

Charter: [docs/domains/market-intelligence/CHARTER.md](domains/market-intelligence/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/market-intelligence` |
| Models owned | MarketObservation |
| Routes owned | 3 (2 api · 1 pages) |
| FRs implemented in lane | — |

## platform-control

Charter: [docs/domains/platform-control/CHARTER.md](domains/platform-control/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/platform-control` |
| Models owned | — (state lives outside the shared schema by design) |
| Routes owned | 2 (1 api · 1 pages) |
| FRs implemented in lane | — |

## project-manager

Charter: [docs/domains/project-manager/CHARTER.md](domains/project-manager/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/project-manager`, `src/modules/business`, `src/modules/people` |
| Models owned | Portfolio, Tenant, LegalEntity, LegalEntityIdentifier, Business, Branch, Workspace, Project, BusinessRoadmap, BusinessRoadmapHorizon, BusinessGoal, ProjectGoal, Workstream, WorkContainer, WorkItem, Milestone, Gate, Dependency, Repository, ProjectRepository, ProjectFile, Team, TeamMembership, ProjectTeam, LocalWorkspaceMount, FileAsset, FileLink, Membership, AuditEvent, PlanImportReceipt |
| Routes owned | 148 (105 api · 43 pages) |
| FRs implemented in lane | — |
