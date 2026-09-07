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
| FRs implemented in lane | FR-025, FR-026, FR-027, FR-029, FR-047, FR-048, FR-049, FR-052, FR-053, FR-054, FR-055, FR-057, FR-079, FR-080, FR-093, FR-096, FR-097, FR-098, FR-141, FR-144, FR-147, FR-149, FR-150 |

## asset-management

Charter: [docs/domains/asset-management/CHARTER.md](domains/asset-management/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/asset-management` |
| Models owned | RegisteredAsset, AssetIntake, AssetEvidence, AssetProcurementRef, AssetLot, AssetResponsibility, AssetLocationHistory, AssetProjectAllocation, AssetDepreciationCandidate, AssetExtractionJob |
| Routes owned | 4 (4 api · 0 pages) |
| FRs implemented in lane | FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140, FR-143 |

## commerce

Charter: [docs/domains/commerce/CHARTER.md](domains/commerce/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/commerce` |
| Models owned | SalesOrder, SalesOrderLine, Payment |
| Routes owned | 7 (5 api · 2 pages) |
| FRs implemented in lane | FR-163, FR-166 |

## crm

Charter: [docs/domains/crm/CHARTER.md](domains/crm/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/crm`, `src/modules/line-crm` |
| Models owned | Person, Customer, CustomerImportBatch, CustomerImportProvenance, CustomerImportReviewCase, CustomerImportReviewDecision, Conversation, Message, ConversationAnalysis, SalesTask |
| Routes owned | 0 (0 api · 0 pages) |
| FRs implemented in lane | BR-001, FR-022, FR-023, FR-061, FR-078, FR-091, FR-093, FR-097, FR-103, FR-127, FR-146, FR-147, FR-148, FR-151, FR-152, FR-153, FR-161, SEC-005 |

## identity

Charter: [docs/domains/identity/CHARTER.md](domains/identity/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/identity` |
| Models owned | ExternalIdentity, IdentityLinkToken, ExternalRef, RoleBinding, PersonCredential, PasswordResetToken, Session, ChannelIdentity, SotDataPlaneKey, WorkspaceMembership, WorkspaceInvite, ApiAccessKey, PlatformGrant, PluginInstallation, PluginAuthorizationCode, PluginSession, EdgeDeviceCredential |
| Routes owned | 26 (18 api · 8 pages) |
| FRs implemented in lane | FR-021, FR-022, FR-026, FR-031, FR-036, FR-038, FR-046, FR-059, FR-061, FR-062, FR-066, FR-067, FR-074, FR-075, FR-076, FR-078, FR-094, FR-095, FR-096, FR-097, FR-098, FR-102, FR-103, FR-104, FR-106, FR-107, FR-120, FR-122, FR-123, FR-144, FR-146, FR-148, FR-154, FR-161, FR-163, FR-164, FR-165, FR-166, SDD-034 |

## integration

Charter: [docs/domains/integration/CHARTER.md](domains/integration/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/integration` |
| Models owned | IntegrationProvider, IntegrationConnection, IntegrationCredential, IngestionRun, RawExternalRecord, SyncCursor, ExternalEntityRef, DeadLetterRecord, SotDecision, PipelineRun, PipelineStep, PipelineEventReceipt, PipelineRecordEvent, PipelineReconciliation, PipelineGateDecision, KnowledgeEvidenceCursor |
| Routes owned | 11 (7 api · 4 pages) |
| FRs implemented in lane | FR-080, FR-081, FR-092, FR-099, FR-100, FR-101, FR-102, FR-146, FR-149 |

## inventory

Charter: [docs/domains/inventory/CHARTER.md](domains/inventory/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/inventory` |
| Models owned | InventoryCategory, ProductFamily, Factory, ProductMaster, Product, ProductBundle, ProductBundleItem, ProductRecipe, ProductRecipeLine, ProductLot, SerialUnit, StockMovement |
| Routes owned | 15 (14 api · 1 pages) |
| FRs implemented in lane | FR-154, FR-155, FR-156 |

## knowledge

Charter: [docs/domains/knowledge/CHARTER.md](domains/knowledge/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/knowledge` |
| Models owned | — (state lives outside the shared schema by design) |
| Routes owned | 0 (0 api · 0 pages) |
| FRs implemented in lane | BR-022, FR-024, FR-047, FR-051, FR-052, FR-054, FR-071, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119 |

## line-oa-studio

Charter: [docs/domains/line-oa-studio/CHARTER.md](domains/line-oa-studio/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/line-oa-studio` |
| Models owned | LineOaAccount, LineOaRichMenu, LineOaRichMenuVersion, LineOaRichMenuJob, LineOaLiffApp, LineConversationJob |
| Routes owned | 25 (15 api · 10 pages) |
| FRs implemented in lane | FR-021, FR-022, FR-061, FR-080, FR-091, FR-093, FR-146, FR-149, FR-150, FR-151, FR-152, FR-153 |

## market-intelligence

Charter: [docs/domains/market-intelligence/CHARTER.md](domains/market-intelligence/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/market-intelligence` |
| Models owned | MarketObservation |
| Routes owned | 3 (2 api · 1 pages) |
| FRs implemented in lane | FR-061, FR-092, NFR-018 |

## marketing

Charter: [docs/domains/marketing/CHARTER.md](domains/marketing/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/marketing` |
| Models owned | MarketingPlan, MarketingPlanVersion, MarketingReview, MarketingDecision, MarketingHandoff, MarketingInitiative, MarketingContentBrief, MarketingContentVersion, MarketingContentReview, MarketingContentDecision, MarketingOperationsIntake |
| Routes owned | 25 (12 api · 13 pages) |
| FRs implemented in lane | FR-157, FR-158, FR-159, FR-160, FR-162 |

## platform-control

Charter: [docs/domains/platform-control/CHARTER.md](domains/platform-control/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/platform-control` |
| Models owned | — (state lives outside the shared schema by design) |
| Routes owned | 2 (1 api · 1 pages) |
| FRs implemented in lane | FR-105 |

## procurement

Charter: [docs/domains/procurement/CHARTER.md](domains/procurement/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/procurement` |
| Models owned | Supplier, PurchaseOrder, PurchaseOrderLine, GoodsReceipt, GoodsReceiptLine |
| Routes owned | 7 (5 api · 2 pages) |
| FRs implemented in lane | FR-164, FR-165 |

## project-manager

Charter: [docs/domains/project-manager/CHARTER.md](domains/project-manager/CHARTER.md)

| | |
|---|---|
| Modules | `src/modules/project-manager`, `src/modules/business`, `src/modules/people` |
| Models owned | Portfolio, Tenant, LegalEntity, LegalEntityIdentifier, Business, Branch, Workspace, Project, BusinessRoadmap, BusinessRoadmapHorizon, BusinessGoal, ProjectGoal, Workstream, WorkContainer, WorkItem, Milestone, Gate, Dependency, Repository, ProjectRepository, ProjectFile, Team, TeamMembership, ProjectTeam, LocalWorkspaceMount, FileAsset, FileLink, Membership, AuditEvent, PlanImportReceipt |
| Routes owned | 158 (113 api · 45 pages) |
| FRs implemented in lane | BR-001, FR-001, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-017, FR-018, FR-019, FR-020, FR-022, FR-036, FR-037, FR-038, FR-040, FR-041, FR-042, FR-043, FR-045, FR-046, FR-058, FR-059, FR-060, FR-061, FR-063, FR-064, FR-065, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-077, FR-078, FR-081, FR-086, FR-087, FR-088, FR-089, FR-090, FR-092, FR-095, FR-100, FR-102, FR-106, FR-107, FR-108, FR-109, FR-110, FR-123, FR-124, FR-127, FR-133, FR-134, FR-135, FR-136, FR-143, FR-144, FR-146, FR-149, FR-150, FR-151, FR-152, FR-153, FR-154, FR-155, FR-156, FR-157, FR-158, FR-159, FR-160, FR-161, FR-163, FR-164, FR-165, FR-166, FR-169, SDD-037 |
