# Trace

| Field | Value |
|-------|-------|
| **Status** | Auto-generated |
| **Generator** | `scripts/doc-graph.mjs` (via doc-views) |

> The full chain per functional requirement: which surface renders it, which code implements it, which rules it follows, which tests prove it, which feature bundles it.
> Never hand-edit — regenerate with `npm run docs:graph`.

### FR-001 — จัดการ scope hierarchy: Portfolio / Tenant / Business / Branch / LegalEntity / Workspace (CRUD + human codes)

- **Status:** done
- **Surface:** `/projects` (page) · `/workspaces/[workspaceId]` (page) · `/workspaces` (page) · `/api/scope` (api) · `/api/workspaces/[id]` (api)
- **Code:** `src/app/(pm)/projects/page.jsx` · `src/app/(pm)/workspaces/[workspaceId]/page.jsx` · `src/app/(pm)/workspaces/page.jsx` · `src/app/api/scope/route.js` · `src/app/api/workspaces/[id]/route.js` · `src/modules/project-manager/application/project-service.js` · `src/modules/project-manager/application/scope-service.js`
- **Follows:** BR-001, BR-004, NFR-008, SDD-004, SDD-021, SDD-033, SDD-036, SDD-047, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/fr072-workspace-mutation-authorization.test.js` · `tests/integration/fr074-scope-creation-authorization.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/integration/scope-and-isolation.test.js` · `tests/unit/authorization-seam-list-routes.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/project-list-contract.test.js` · `tests/unit/projects-dashboard-ui.test.js` · `tests/unit/route-reachability.test.js` · `tests/unit/self-plan-generator.test.js`

### FR-002 — Scope selectors (Portfolio·Business·Workspace·Project) + จำ selection ล่าสุด

- **Status:** done
- **Code:** `src/context/ScopeContext.jsx`
- **Follows:** SDD-018, SDD-024, SEC-008
- **Tests:** `tests/e2e/fr046-entry-contract.spec.js` · `tests/e2e/smoke.spec.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/scope-view-context.test.js`

### FR-003 — Project CRUD + archive (soft delete) + mixed execution modes

- **Status:** done
- **Surface:** `/projects` (page) · `/api/projects/[id]` (api) · `/api/projects` (api)
- **Code:** `src/app/(pm)/projects/page.jsx` · `src/app/api/projects/[id]/route.js` · `src/app/api/projects/route.js` · `src/modules/project-manager/application/project-list-read-model.js` · `src/modules/project-manager/application/project-service.js`
- **Follows:** BR-001, BR-004, NFR-008, SDD-004, SDD-021, SDD-033, SDD-036, SDD-047, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/integration/project-list-contract.test.js` · `tests/unit/authorization-seam-list-routes.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/domain-state.test.js` · `tests/unit/project-list-contract.test.js` · `tests/unit/projects-dashboard-ui.test.js`

### FR-004 — Workstream CRUD: executionMode + progressStrategy + progressWeight

- **Status:** done
- **Surface:** `/api/workstreams/[id]` (api) · `/api/workstreams` (api)
- **Code:** `src/app/api/workstreams/[id]/route.js` · `src/app/api/workstreams/route.js` · `src/modules/project-manager/application/project-service.js`
- **Follows:** BR-001, BR-004, SDD-004, SDD-021, SDD-033, SDD-036, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/unit/authorization-seam-list-routes.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/project-list-contract.test.js`

### FR-005 — Neutral work model: WorkContainer (ลำดับชั้น) + WorkItem (weight/value/probability/metrics), browsed and status-edited at Development → All Work, both **global and project-scoped** (same view, different filter)

- **Status:** done
- **Surface:** `/projects/[projectId]/all-work` (page) · `/work` (page) · `/api/containers/[id]` (api) · `/api/containers` (api) · `/api/work/[id]` (api) · `/api/work` (api)
- **Code:** `src/app/(pm)/projects/[projectId]/all-work/page.jsx` · `src/app/(pm)/work/page.jsx` · `src/app/api/containers/[id]/route.js` · `src/app/api/containers/route.js` · `src/app/api/work/[id]/route.js` · `src/app/api/work/route.js` · `src/components/ui/index.jsx` · `src/modules/project-manager/application/active-filters.js` · `src/modules/project-manager/application/work-read-service.js` · `src/modules/project-manager/application/work-service.js` · `src/modules/project-manager/components/StandaloneTaskModal.jsx` · `src/modules/project-manager/components/WorkViewTabs.jsx` · `src/modules/project-manager/views/KanbanBoard.jsx` · `src/modules/project-manager/views/universal/AllWorkView.jsx`
- **Follows:** BR-001, BR-004, NFR-008, SDD-002, SDD-010, SDD-019, SDD-039, SEC-001, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/fr072-work-service-authorization.test.js` · `tests/integration/project-core.test.js` · `tests/integration/work-listing-scope.test.js` · `tests/unit/authorization-seam-list-routes.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/design-system.test.js` · `tests/unit/global-view-drilldown.test.js` · `tests/unit/project-manager-mcp.test.js` · `tests/unit/project-roadmap-ui.test.js` · `tests/unit/project-work-route.test.js` · `tests/unit/route-reachability.test.js`

### FR-006 — Milestones + Gates (weighted, required flag, evidence JSON), browsed and status-edited at Development → Milestones & Gates, both **global and project-scoped**

- **Status:** done
- **Surface:** `/milestones` (page) · `/projects/[projectId]/milestones` (page) · `/api/gates/[id]` (api) · `/api/gates` (api) · `/api/milestones/[id]` (api) · `/api/milestones` (api)
- **Code:** `src/app/(pm)/milestones/page.jsx` · `src/app/(pm)/projects/[projectId]/layout.jsx` · `src/app/(pm)/projects/[projectId]/milestones/page.jsx` · `src/app/api/gates/[id]/route.js` · `src/app/api/gates/route.js` · `src/app/api/milestones/[id]/route.js` · `src/app/api/milestones/route.js` · `src/modules/project-manager/application/milestone-gate-service.js` · `src/modules/project-manager/components/WorkViewTabs.jsx` · `src/modules/project-manager/views/universal/MilestonesView.jsx`
- **Follows:** BR-001, NFR-008, SDD-019, SDD-039, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr040-project-work.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/fr072-milestone-gate-authorization.test.js` · `tests/integration/project-core.test.js` · `tests/unit/authorization-seam-list-routes.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/global-view-drilldown.test.js` · `tests/unit/global-view-scope-contract.test.js` · `tests/unit/project-execution-backpath.test.js` · `tests/unit/project-roadmap-ui.test.js` · `tests/unit/project-work-route.test.js` · `tests/unit/route-reachability.test.js`

### FR-007 — Dependencies 5 ชนิด, กัน self/cycle, ประเมิน blocked/ready — created, listed and deleted at the cross-project register Development → Dependencies. (The project-local Dependency **Map** is a separate read view, FR-040.)

- **Status:** done
- **Surface:** `/dependencies` (page) · `/api/dependencies/[id]` (api) · `/api/dependencies` (api)
- **Code:** `src/app/(pm)/dependencies/page.jsx` · `src/app/api/dependencies/[id]/route.js` · `src/app/api/dependencies/route.js` · `src/modules/project-manager/application/active-filters.js` · `src/modules/project-manager/application/dependency-service.js` · `src/modules/project-manager/application/work-service.js`
- **Follows:** BR-001, BR-004, SDD-002, SDD-019, SEC-001, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/fr072-dependency-authorization.test.js` · `tests/integration/fr072-work-service-authorization.test.js` · `tests/integration/project-core.test.js` · `tests/integration/work-listing-scope.test.js` · `tests/unit/authorization-seam-list-routes.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/global-view-scope-contract.test.js` · `tests/unit/project-dependency-service.test.js`

### FR-008 — Repository records (local metadata) + ผูกโปรเจกต์แบบ many-to-many

- **Status:** done
- **Surface:** `/projects/[projectId]/repositories` (page) · `/repositories` (page) · `/api/repositories/[id]` (api) · `/api/repositories/link/[id]` (api) · `/api/repositories/link` (api) · `/api/repositories` (api)
- **Code:** `src/app/(pm)/projects/[projectId]/layout.jsx` · `src/app/(pm)/projects/[projectId]/repositories/page.jsx` · `src/app/(pm)/repositories/page.jsx` · `src/app/api/repositories/[id]/route.js` · `src/app/api/repositories/link/[id]/route.js` · `src/app/api/repositories/link/route.js` · `src/app/api/repositories/route.js` · `src/modules/project-manager/application/repository-service.js`
- **Follows:** BR-001, BR-002, SDD-019, SEC-001, SEC-008
- **Tests:** `tests/integration/fr072-repository-link-authorization.test.js` · `tests/integration/fr073-repository-scope.test.js` · `tests/integration/project-core.test.js` · `tests/unit/project-execution-backpath.test.js` · `tests/unit/project-work-route.test.js`

### FR-009 — Execution views 7 โหมดบนโมเดลกลาง (global + project-scoped)

- **Status:** done
- **Surface:** `/execution/[mode]` (page) · `/execution` (page) · `/projects/[projectId]/execution/[mode]` (page)
- **Code:** `src/app/(pm)/execution/[mode]/page.jsx` · `src/app/(pm)/execution/page.jsx` · `src/app/(pm)/projects/[projectId]/execution/[mode]/page.jsx` · `src/app/(pm)/projects/[projectId]/layout.jsx` · `src/modules/project-manager/components/PlanModeCustomizerModal.jsx` · `src/modules/project-manager/views/execution/ExecutionModeView.jsx` · `src/modules/project-manager/views/execution/mode-bodies.jsx`
- **Follows:** BR-001, BR-003, BR-004, SDD-006, SDD-019, SDD-042, SEC-001, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/unit/card-calculator-agreement.test.js` · `tests/unit/document-intake-ui.test.js` · `tests/unit/fr063-board-columns.test.js` · `tests/unit/pipeline-monitor-ui.test.js` · `tests/unit/project-execution-backpath.test.js` · `tests/unit/project-work-route.test.js`

### FR-010 — Progress ต่อ workstream ตาม strategy + evidence + warnings + "Explain" UI

- **Status:** done
- **Surface:** `/api/progress/workstream/[id]` (api)
- **Code:** `src/app/api/progress/workstream/[id]/route.js` · `src/modules/project-manager/progress/strategies.js`
- **Follows:** BR-005, BR-006, SDD-005, SEC-001, SEC-008
- **Tests:** `tests/unit/authorization-seam-routes.test.js` · `tests/unit/format-progress-percent.test.js` · `tests/unit/gate-cap-rounding.test.js` · `tests/unit/strategies.test.js`

### FR-011 — Project roll-up ถ่วงน้ำหนัก Σ(ws%×w)/Σw

- **Status:** done
- **Surface:** `/api/progress/project/[id]` (api)
- **Code:** `src/app/api/progress/project/[id]/route.js` · `src/modules/project-manager/progress/rollup.js`
- **Follows:** SEC-001, SEC-008
- **Tests:** `tests/unit/authorization-seam-routes.test.js` · `tests/unit/rollup.test.js`

### FR-012 — PlanEnvelope import: validate → seven-mode semantic contract check → dry run → transactional commit → audit

- **Status:** done
- **Surface:** `/projects/[projectId]/import` (page) · `/api/import/commit` (api) · `/api/import/dry-run` (api)
- **Code:** `src/app/(pm)/projects/[projectId]/import/page.jsx` · `src/app/(pm)/projects/[projectId]/layout.jsx` · `src/app/api/import/commit/route.js` · `src/app/api/import/dry-run/route.js` · `src/lib/validation/enums.js` · `src/modules/project-manager/components/PlanModeCustomizerModal.jsx` · `src/modules/project-manager/components/ProjectTabs.jsx` · `src/modules/project-manager/components/UploadPlanModal.jsx` · `src/modules/project-manager/import/plan-import-service.js` · `src/modules/project-manager/import/plan-schema.js`
- **Follows:** BR-001, BR-003, BR-004, BR-007, BR-009, FR-069, NFR-008, SDD-002, SDD-006, SDD-009, SDD-019, SDD-021, SDD-032, SDD-037, SEC-001, SEC-002, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/external-ref-import.test.js` · `tests/integration/import-target-authorization.test.js` · `tests/integration/plan-import-scope.test.js` · `tests/integration/plan-import.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/xlsx-intake.test.js` · `tests/unit/contract-plan-artifacts.test.js` · `tests/unit/plan-schema.test.js` · `tests/unit/plan-status-vocabulary.test.js` · `tests/unit/project-execution-backpath.test.js` · `tests/unit/project-work-route.test.js` · `tests/unit/route-reachability.test.js` · `tests/unit/self-plan-generator.test.js`

### FR-013 — Snapshot backup: export + import แบบ preview-then-confirm

- **Status:** done
- **Surface:** `/backup` (page) · `/api/backup/export` (api) · `/api/backup/import` (api)
- **Code:** `src/app/(pm)/backup/page.jsx` · `src/app/api/backup/export/route.js` · `src/app/api/backup/import/route.js` · `src/modules/project-manager/application/backup-service.js`
- **Follows:** BR-008, SDD-023, SEC-008
- **Tests:** `tests/integration/backup.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/fr045-backup-contract.test.js`

### FR-014 — Audit log (immutable) + UI browser

- **Status:** done
- **Surface:** `/audit` (page) · `/api/audit` (api)
- **Code:** `src/app/(pm)/audit/page.jsx` · `src/app/api/audit/route.js` · `src/components/ui/index.jsx` · `src/modules/project-manager/application/audit.js`
- **Follows:** FR-075, SDD-010, SEC-003, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/plan-import.test.js` · `tests/integration/project-core.test.js` · `tests/integration/work-listing-scope.test.js` · `tests/unit/audit-page.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/design-system.test.js`

### FR-015 — Command palette (Ctrl+K), filters, search

- **Status:** done
- **Code:** `src/components/layouts/CommandPalette.jsx`
- **Follows:** SDD-018, SDD-034
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/unit/command-palette-index.test.js`

### FR-016 — Seed/demo dataset idempotent ครบ 7 โหมด

- **Status:** done
- **Code:** `prisma/seed.js`
- **Follows:** NFR-007
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js`

### FR-017 — UI wizard intake ("เริ่มจากเป้าหมาย") → สร้าง envelope เข้า pipeline เดิม; direct modal creation is edit-only

- **Status:** done
- **Surface:** `/projects/new` (page) · `/api/projects/[id]/tree` (api)
- **Code:** `src/app/(pm)/projects/new/page.jsx` · `src/app/api/projects/[id]/tree/route.js` · `src/modules/project-manager/components/HumanPlanBuilderModal.jsx` · `src/modules/project-manager/components/PlanModeCustomizerModal.jsx` · `src/modules/project-manager/components/StandaloneTaskModal.jsx` · `src/modules/project-manager/import/human-plan-builder.js`
- **Follows:** BR-003, BR-004, BR-009, SDD-006, SEC-001, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/project-core.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/human-plan-builder.test.js` · `tests/unit/mode-default-subtype.test.js`

### FR-018 — Excel template intake: generator จาก Zod schema + xlsx→envelope converter + error รายแถว

- **Status:** done
- **Surface:** `/api/import/template` (api) · `/api/import/xlsx` (api)
- **Code:** `src/app/api/import/template/route.js` · `src/app/api/import/xlsx/route.js` · `src/modules/project-manager/components/ProjectTabs.jsx` · `src/modules/project-manager/components/UploadPlanModal.jsx` · `src/modules/project-manager/import/xlsx-convert.js` · `src/modules/project-manager/import/xlsx-template.js`
- **Follows:** BR-009, NFR-008, SDD-019, SDD-037, SEC-001, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/xlsx-intake.test.js` · `tests/unit/plan-status-vocabulary.test.js` · `tests/unit/project-work-route.test.js` · `tests/unit/public-read-route-auth.test.js` · `tests/unit/route-reachability.test.js`

### FR-019 — Enterprise API: ExternalRef mapping + upsert-by-external-id + OpenAPI docs

- **Status:** done
- **Surface:** `/api/docs` (api) · `/api/resolve` (api)
- **Code:** `src/app/api/docs/route.js` · `src/app/api/resolve/route.js` · `src/modules/project-manager/api-docs/openapi.js` · `src/modules/project-manager/import/external-ref.js` · `src/modules/project-manager/import/plan-import-service.js` · `src/modules/project-manager/import/plan-schema.js`
- **Follows:** BR-001, BR-002, BR-004, BR-007, BR-009, FR-019, FR-069, SDD-002, SDD-003, SDD-006, SDD-009, SDD-021, SDD-037, SEC-001, SEC-002, SEC-006, SEC-008, docs/features/FR-019-enterprise-api.md
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/external-ref-import.test.js` · `tests/integration/import-target-authorization.test.js` · `tests/integration/openapi-docs.test.js` · `tests/integration/plan-import-scope.test.js` · `tests/integration/plan-import.test.js` · `tests/integration/project-business-binding.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/plan-schema.test.js` · `tests/unit/plan-status-vocabulary.test.js`

### FR-020 — Adaptive shell ตามจำนวนธุรกิจ (single → ไม่มี switcher, multi → switcher + portfolio landing)

- **Status:** done
- **Surface:** `/settings` (page) · `/api/progress/portfolio` (api) · `/api/scope` (api)
- **Code:** `src/app/(pm)/settings/page.jsx` · `src/app/api/progress/portfolio/route.js` · `src/app/api/scope/route.js` · `src/context/ScopeContext.jsx` · `src/lib/shell-mode.js` · `src/modules/project-manager/application/progress-service.js` · `src/modules/project-manager/application/scope-service.js` · `src/modules/project-manager/progress/rollup.js`
- **Follows:** BR-001, FR-020, SDD-018, SDD-024, SEC-001, SEC-008, docs/features/FR-020-adaptive-shell.md
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr046-entry-contract.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/adaptive-shell.test.js` · `tests/integration/fr072-workspace-mutation-authorization.test.js` · `tests/integration/fr074-scope-creation-authorization.test.js` · `tests/integration/scope-and-isolation.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/business-shell-guard.test.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/rollup.test.js` · `tests/unit/scope-view-context.test.js` · `tests/unit/shell-mode.test.js`

### FR-021 — Identity resolution: `ExternalIdentity` (LINE→Person, tenant-scoped) + `resolveLineIdentity` — idempotent, tenant-required, audited, revoke-aware (ADR-007 P3 foundation primitive)

- **Status:** done
- **Code:** `src/modules/identity/resolve-line-identity.js`
- **Follows:** BR-001, BR-020, SEC-001, SEC-018
- **Tests:** `tests/integration/identity-gate.test.js` · `tests/integration/identity-resolve.test.js` · `tests/integration/line-ingest.test.js`

### FR-022 — LINE as an identity provider end-to-end: account linking (single-use token → bind to existing Person, idempotent, merge-aware), PDPA erase-revoke, staff/customer split, and `resolveLinePrincipal` (the single P3 seam) — the full P3 gate on top of FR-021

- **Status:** done
- **Code:** `src/modules/identity/classify-principal.js` · `src/modules/identity/erase-principal.js` · `src/modules/identity/gate.js` · `src/modules/identity/link-line-identity.js`
- **Follows:** BR-001, BR-002, BR-020, SEC-001, SEC-003, SEC-018
- **Tests:** `tests/integration/identity-classify.test.js` · `tests/integration/identity-erase.test.js` · `tests/integration/identity-gate.test.js` · `tests/integration/identity-link.test.js`

### FR-023 — Zuri Backend Slice CRM core (ADR-007 P2): Customer (per-tenant, linked to Person) + Conversation + Message + LINE gateway `ingestLineMessage` (resolves through FR-021, idempotent)

- **Status:** done
- **Code:** `src/modules/crm/line-ingest-service.js`
- **Follows:** BR-001, BR-020, NFR-017, SEC-001, SEC-018
- **Tests:** `tests/integration/crm-customer-consent.test.js` · `tests/integration/line-ingest-tenant-isolation.test.js` · `tests/integration/line-ingest.test.js` · `tests/unit/doc-views.test.js` · `tests/unit/scope-external-ids-migration.test.js`

### FR-024 — Knowledge projection (ADR-007 P5): project Zuri **relations** (Customer/Business/Conversation/Membership) into a GKS/KG graph via a pluggable sink; **live facts (price, credit, invoice, payment, stock, schedule) are never projected** — they stay a Zuri query (`assertNoLiveFacts` guard). Tenant-scoped, deterministic, read-only. Exposes `queryKnowledge` (principal neighbourhood) as the contract the agent consumes

- **Status:** done
- **Code:** `src/modules/knowledge/gbdb-rag-service.js` · `src/modules/knowledge/genesisblockdb-sink.js` · `src/modules/knowledge/graph-query.js` · `src/modules/knowledge/index.js` · `src/modules/knowledge/live-facts.js` · `src/modules/knowledge/project-graph.js` · `src/modules/knowledge/query.js` · `src/modules/knowledge/sink.js` · `src/modules/knowledge/smartgift-knowledge-catalog.js` · `src/modules/knowledge/smartgift-rag-pipeline.js`
- **Follows:** BR-001, SDD-027, SEC-001, SEC-011
- **Tests:** `tests/integration/agent-runtime.test.js` · `tests/integration/knowledge-genesis-sink.test.js` · `tests/integration/knowledge-project.test.js` · `tests/integration/knowledge-query.test.js` · `tests/unit/activation-readiness-integration.test.js` · `tests/unit/gbdb-rag-service.test.js` · `tests/unit/runtime-isolation-probe.test.js` · `tests/unit/smartgift-rag-pipeline.test.js`

### FR-025 — Agent read-only context contract (ADR-007 P6, Gate E): `assembleAgentContext` binds a resolved principal (via the P3 gate) to Identity + MSP memory (**principal-keyed, not channel-keyed**) + GKS knowledge (FR-024) + Zuri **read-only** tools; a write-classified tool is refused at registration (Gate E→F boundary)

- **Status:** done
- **Code:** `src/modules/agent/context.js` · `src/modules/agent/index.js` · `src/modules/agent/memory-port.js` · `src/modules/agent/msp-memory-port.js` · `src/modules/agent/tools.js`
- **Follows:** SDD-027, SEC-011
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/integration/agent-msp-port.test.js` · `tests/integration/agent-multi-principal.test.js` · `tests/integration/agent-tools.test.js` · `tests/integration/msp-vault-memory-port.test.js` · `tests/unit/activation-readiness-integration.test.js`

### FR-026 — Agent write/action gate (ADR-007 P7, Gate F): write tools in a **separate** registry (effect WRITE + executor); `authorizeAgentAction` decides by RBAC (Membership role) + resource ownership + sensitivity; **HIGH-sensitivity actions require a single-use step-up token**; `executeAgentAction` resolves the principal → authorizes → enforces step-up → runs the write in one transaction with an append-only audit. Read stays Gate E

- **Status:** done
- **Code:** `src/modules/agent/action-gate.js` · `src/modules/agent/index.js` · `src/modules/agent/step-up.js` · `src/modules/agent/write-tools.js`
- **Follows:** BR-009, SDD-009, SDD-027, SEC-011
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/unit/activation-readiness-integration.test.js`

### FR-027 — End-to-end agent turn (ADR-007 P7): `handleAgentTurn` composes the full path — LINE ingest (FR-023) → read context (FR-025) → optional Gate F action (FR-026) → response — over injectable memory/knowledge/tool ports; unauthorized/step-up-needed actions degrade to a graceful response, never a crash

- **Status:** done
- **Code:** `src/modules/agent/index.js` · `src/modules/agent/turn.js`
- **Follows:** BR-020, SDD-027, SEC-011, SEC-018
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/integration/agent-turn.test.js` · `tests/unit/activation-readiness-integration.test.js`

### FR-028 — LINE webhook API route (ADR-007 P7 wiring): `POST /api/agent/line-webhook` normalizes LINE message events → `handleAgentTurn` (Gate E read/answer), tenant-scoped (refuses an unresolved tenant — no minting under a DEFAULT tenant); the zuri-cli LINE bot forwards webhook events here (two runtimes, HTTP seam, real E2E)

- **Status:** done
- **Surface:** `/api/agent/line-webhook` (api)
- **Code:** `src/app/api/agent/line-webhook/route.js` · `src/platform/integrations/providers/line/line-oa-evidence.js`
- **Follows:** BR-009, BR-011, BR-012, FR-081, NFR-017, SDD-009, SDD-026, SDD-048, SEC-001, SEC-010, docs/domains/integration/features/FR-081-raw-external-ingestion.md
- **Tests:** `tests/integration/agent-webhook-route.test.js` · `tests/integration/line-oa-cross-repo-round-trip.test.js` · `tests/integration/line-oa-evidence-convergence.test.js` · `tests/integration/line-oa-failure-paths.test.js` · `tests/integration/line-oa-golden-path.test.js` · `tests/integration/line-webhook-transport-contract.test.js` · `tests/integration/line-webhook-unbound-production.test.js` · `tests/integration/smartgift-webhook-e2e.test.js` · `tests/unit/doc-views.test.js`

### FR-029 — Agent runtime ports (ADR-007 P6): `createAgentPorts` binds the agent to the REAL backends — MSP memory (`createMspMemoryPort`) + GenesisBlockDB knowledge (`createGraphKnowledgeReader`, the graph read side of P5) — as the injectable ports `assembleAgentContext`/`handleAgentTurn` consume; unconfigured backends degrade gracefully to in-memory/Prisma. MSP and GKS stay independent

- **Status:** done
- **Code:** `src/modules/agent/index.js` · `src/modules/agent/runtime.js`
- **Follows:** SDD-027, SEC-011
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/integration/agent-runtime.test.js` · `tests/unit/activation-readiness-integration.test.js`

### FR-030 — Persistence: Postgres/Supabase readiness (ADR-007 P4): generated `schema.postgres.prisma` + init DDL (provider swap only, models identical); `assertDbBoundary` enforces **Zuri DB ≠ MSP DB**; UUID-preserving cutover via the provider-agnostic backup snapshot (`db:pg:export`/`import`). DuckDB stays a cache/analytics tier, not the transactional store

- **Status:** done
- **Code:** `src/lib/db-boundary.js` · `src/lib/db.js`
- **Follows:** —
- **Tests:** `tests/unit/db-boundary.test.js` · `tests/unit/db-runtime-config.test.js` · `tests/unit/postgres-runtime-client.test.js`

### FR-031 — Viewer gate: `resolveViewer()` resolves the current authenticated principal into one role (`OWNER`, `MEMBER`, or platform `DEV`), `visibleBusinessIds`, and `visibleDomains` before the ADR-008 Home journey. DEV is an explicit platform grant, never a widened Membership; missing or invalid authentication fails closed and never derives OWNER-of-all.

- **Status:** done
- **Surface:** `/api/viewer` (api)
- **Code:** `src/app/api/viewer/route.js` · `src/modules/identity/resolve-viewer.js`
- **Follows:** ADR-008 §D4, docs/features/FR-031-viewer-gate.md, FR-031, SDD-011, SDD-011, docs/features/FR-031-viewer-gate.md, SDD-017, SDD-034
- **Tests:** `tests/unit/fr061-per-business-domain-visibility.test.js` · `tests/unit/fr076-product-owner-business-assignment.test.js` · `tests/unit/viewer-gate.test.js`

### FR-032 — Home (`/`) is the ADR-008 entry journey: it shows only groups and businesses permitted by `resolveViewer()`, lets the user enter the Group (“all businesses”) or one Business scope, and then navigates to Overview. A single visible group skips the group choice. Creating a business remains the existing Settings flow.

- **Status:** done
- **Surface:** `/api/viewer` (api)
- **Code:** `src/app/api/viewer/route.js` · `src/lib/home-scope.js`
- **Follows:** FR-031, FR-032, SDD-011, SDD-011, docs/features/FR-031-viewer-gate.md, SDD-011, docs/features/FR-032-home-entry.md
- **Tests:** `tests/unit/home-scope.test.js` · `tests/unit/viewer-gate.test.js`

### FR-033 — Topbar contains Zuri identity, the viewed-domain chip, ERP/PM lens toggle, command palette, New Project, and profile cluster—but no scope dropdown or selector. Scope choice begins at Home and moves to breadcrumb switching in the following slice.

- **Status:** done
- **Code:** `src/components/layouts/Topbar.jsx`
- **Follows:** SDD-012, SDD-018, SDD-021
- **Tests:** `tests/unit/domain-state.test.js` · `tests/unit/scope-view-context.test.js` · `tests/unit/topbar-no-dropdown.test.js`

### FR-034 — Breadcrumb is the scope switcher: its Group/Business crumb returns to Home (`/`), Workspace crumb opens `/workspaces`, and Project crumb opens `/projects`. It labels Group versus Business correctly and uses the active ERP/PM lens; a single workspace omits its crumb.

- **Status:** done
- **Code:** `src/components/layouts/Breadcrumb.jsx`
- **Follows:** SDD-013, SDD-018, SDD-021
- **Tests:** `tests/unit/breadcrumb-switcher.test.js` · `tests/unit/route-reachability.test.js` · `tests/unit/scope-view-context.test.js`

### FR-035 — Overview is the selected Business's operational home: scoped execution KPIs, project health, strategy, and shortcuts to enabled V2 domains. A missing Business selection is an actionable Home state, never a Group card roll-up.

- **Status:** done
- **Surface:** `/overview` (page)
- **Code:** `src/app/(pm)/overview/page.jsx`
- **Follows:** BR-001, SDD-014, SDD-020, SDD-032, SDD-033
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr059-strategy-edit.spec.js` · `tests/unit/fr059-strategy-edit-ui.test.js` · `tests/unit/fr060-business-home-read-model.test.js` · `tests/unit/fr060-business-home-visibility.test.js` · `tests/unit/overview-split.test.js`

### FR-036 — Project Team (`/projects/{id}/team`) lists Memberships in the project’s business scope, adds/removes business-scoped members, changes Owner/Member role, and shows each member’s active WorkItem assignee load. Group-workspace memberships remain read-only because they are tenant-wide.

- **Status:** done
- **Surface:** `/projects/[projectId]/team` (page) · `/api/projects/[id]/team` (api)
- **Code:** `src/app/(pm)/projects/[projectId]/team/page.jsx` · `src/app/api/projects/[id]/team/route.js` · `src/modules/identity/viewer-authority.js` · `src/modules/project-manager/application/project-team-service.js`
- **Follows:** BR-001, FR-036, SDD-015, SDD-015, BR-001, SEC-003, docs/features/FR-036-project-team.md, SDD-015, SEC-003, docs/features/FR-036-project-team.md, SEC-001, SEC-003, SEC-008
- **Tests:** `tests/unit/fr036-team-authorization.test.js` · `tests/unit/fr089-br018-team-grants-nothing.test.js` · `tests/unit/project-team-service.test.js` · `tests/unit/viewer-authority.test.js`

### FR-037 — Project Files (`/projects/{id}/files`) manages metadata references for documents and attachments linked to a Project and optionally a WorkItem. `ProjectFile` uses UUID + human code, validates a non-empty `url` or `blobRef`, and records every create/delete in audit. Binary upload/storage is outside the local MVP.

- **Feature:** FEAT-001 — File Manager — Business/Project files with managed local workspace
- **Status:** done
- **Surface:** `/projects/[projectId]/files` (page) · `/api/projects/[id]/files/[fileId]` (api) · `/api/projects/[id]/files` (api)
- **Code:** `src/app/(pm)/projects/[projectId]/files/page.jsx` · `src/app/api/projects/[id]/files/[fileId]/route.js` · `src/app/api/projects/[id]/files/route.js` · `src/modules/project-manager/application/project-file-service.js`
- **Follows:** BR-001, BR-002, FR-037, SDD-016, SDD-016, BR-002, SEC-003, docs/features/FR-037-project-files.md, SDD-016, SEC-003, docs/features/FR-037-project-files.md, SDD-023, SEC-001, SEC-003, SEC-007, SEC-008
- **Tests:** `tests/integration/fr072-project-file-authorization.test.js` · `tests/unit/authorization-seam-list-routes.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/fr045-w0-contract.test.js` · `tests/unit/project-file-service.test.js`

### FR-038 — My Profile (`/profile`) shows the resolved local account, language preference, LINE-link state, and local session. Users & Permissions (`/platform/users`) is OWNER-only and edits Membership role plus per-domain visibility; MEMBER receives no domain visibility unless explicitly granted, while OWNER/DEV retain role-bound all-domain access.

- **Status:** done
- **Surface:** `/platform/users` (page) · `/profile` (page) · `/api/platform/users` (api) · `/api/profile` (api)
- **Code:** `src/app/(pm)/platform/users/page.jsx` · `src/app/(pm)/profile/page.jsx` · `src/app/api/platform/users/route.js` · `src/app/api/profile/route.js` · `src/components/layouts/DomainBar.jsx` · `src/modules/identity/profile-permission-service.js` · `src/modules/identity/resolve-viewer.js` · `src/modules/identity/viewer-authority.js`
- **Follows:** ADR-008 §D4, docs/features/FR-031-viewer-gate.md, BR-001, FR-031, FR-038, SDD-017, SDD-017, SEC-003, docs/features/FR-038-profile-and-permissions.md, SDD-017, docs/features/FR-038-profile-and-permissions.md, SDD-024, SDD-034, SDD-035, SEC-001, SEC-003, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/unit/domain-navigation.test.js` · `tests/unit/fr036-team-authorization.test.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/fr061-per-business-domain-visibility.test.js` · `tests/unit/fr062-permissions-read-scope.test.js` · `tests/unit/fr076-product-owner-business-assignment.test.js` · `tests/unit/profile-permission-service.test.js` · `tests/unit/viewer-authority.test.js` · `tests/unit/viewer-gate.test.js`

### FR-039 — The Base Context Bar maps `Portfolio > Tenant > Business` to `Workspace > Organization > Business` and stops global shell scope at Business. Schema Workspace and Project are Development resources, not shell or sidebar parents; Organization is a UI label for Tenant, whose UUID and isolation semantics remain unchanged.

- **Status:** done
- **Code:** `src/components/layouts/Breadcrumb.jsx` · `src/components/layouts/Sidebar.jsx` · `src/components/layouts/Topbar.jsx` · `src/config/domains.js` · `src/config/modules.js` · `src/config/scope-views.js` · `src/context/ScopeContext.jsx`
- **Follows:** SDD-012, SDD-013, SDD-018, SDD-021, SDD-024, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr046-entry-contract.spec.js` · `tests/e2e/smoke.spec.js` · `tests/unit/breadcrumb-switcher.test.js` · `tests/unit/domain-navigation.test.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/scope-view-context.test.js` · `tests/unit/sidebar-visible-subdomains.test.js` · `tests/unit/topbar-no-dropdown.test.js`

### FR-040 — Project Work views: every Project provides a Structure Plan (WBS) and a project-local Dependency Map. Structure Plan renders the existing Project → Workstream → WorkContainer → WorkItem hierarchy. Dependency Map renders only dependency edges whose two endpoints both belong to the opened Project. The cross-project register remains Development → Dependencies. No new persistence model is introduced.

- **Status:** done
- **Surface:** `/projects/[projectId]/all-work` (page) · `/projects/[projectId]/dependencies` (page) · `/projects/[projectId]/milestones` (page) · `/projects/[projectId]/structure` (page) · `/projects/[projectId]/timeline` (page) · `/api/projects/[id]/dependencies` (api)
- **Code:** `src/app/(pm)/projects/[projectId]/all-work/page.jsx` · `src/app/(pm)/projects/[projectId]/dependencies/page.jsx` · `src/app/(pm)/projects/[projectId]/layout.jsx` · `src/app/(pm)/projects/[projectId]/milestones/page.jsx` · `src/app/(pm)/projects/[projectId]/structure/page.jsx` · `src/app/(pm)/projects/[projectId]/timeline/page.jsx` · `src/app/api/projects/[id]/dependencies/route.js` · `src/modules/project-manager/application/dependency-service.js` · `src/modules/project-manager/application/project-dependency-map.js` · `src/modules/project-manager/components/ProjectTabs.jsx` · `src/modules/project-manager/components/WorkViewTabs.jsx` · `src/modules/project-manager/views/DependencyMap.jsx` · `src/modules/project-manager/views/WbsCanvas.jsx`
- **Follows:** BR-001, BR-009, NFR-008, SDD-019, SDD-036, SDD-039, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr040-project-work.spec.js` · `tests/integration/fr072-dependency-authorization.test.js` · `tests/integration/project-core.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/dependency-map-view.test.js` · `tests/unit/project-dependency-map.test.js` · `tests/unit/project-dependency-route.test.js` · `tests/unit/project-dependency-service.test.js` · `tests/unit/project-execution-backpath.test.js` · `tests/unit/project-roadmap-ui.test.js` · `tests/unit/project-work-route.test.js` · `tests/unit/route-reachability.test.js` · `tests/unit/sot-pipeline-graph.test.js` · `tests/unit/wbs-structure.test.js`

### FR-041 — Business Overview renders the selected Business's Projects plus a Business Strategy read model: Roadmap and two or three ordered goal horizons. The service enforces horizon cardinality and viewer/business isolation; roadmap editing and Project links are a follow-up mutation slice.

- **Feature:** FEAT-002 — Business Home — shell-level cross-domain aggregation (Dashboard now; Goals & KPIs, Risks & Alerts, Reports later)
- **Status:** done
- **Surface:** `/overview` (page) · `/api/business/strategy` (api)
- **Code:** `prisma/seed.js` · `src/app/(pm)/overview/page.jsx` · `src/app/api/business/strategy/route.js` · `src/lib/shell-mode.js` · `src/modules/business/application/business-strategy-service.js` · `src/modules/project-manager/application/project-service.js`
- **Follows:** BR-001, BR-004, FR-020, NFR-007, SDD-004, SDD-014, SDD-020, SDD-021, SDD-024, SDD-032, SDD-033, SDD-036, SEC-001, SEC-008, docs/features/FR-020-adaptive-shell.md
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr059-strategy-edit.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/adaptive-shell.test.js` · `tests/integration/fr059-business-strategy-mutation.test.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/unit/business-strategy-route.test.js` · `tests/unit/business-strategy-service.test.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/fr059-strategy-edit-ui.test.js` · `tests/unit/fr059-strategy-validation.test.js` · `tests/unit/fr060-business-home-read-model.test.js` · `tests/unit/fr060-business-home-visibility.test.js` · `tests/unit/overview-split.test.js` · `tests/unit/project-list-contract.test.js` · `tests/unit/shell-mode.test.js`

### FR-042 — HR / People is a peer ERP domain (route key `people`) with a Business-scoped People Directory over Person/Membership. It is not nested under Development; Project Team remains Project-local. Attendance, leave, payroll, and performance are out of scope for this slice.

- **Status:** done
- **Surface:** `/overview` (page) · `/people/directory` (page) · `/people` (page) · `/api/people` (api)
- **Code:** `src/app/(pm)/overview/page.jsx` · `src/app/(pm)/people/directory/page.jsx` · `src/app/(pm)/people/page.jsx` · `src/app/api/people/route.js` · `src/config/domains.js` · `src/modules/people/application/people-service.js` · `src/modules/people/components/PeopleDirectory.jsx`
- **Follows:** BR-001, SDD-014, SDD-018, SDD-020, SDD-024, SDD-032, SDD-033, SEC-003, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr059-strategy-edit.spec.js` · `tests/unit/domain-navigation.test.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/fr059-strategy-edit-ui.test.js` · `tests/unit/fr060-business-home-read-model.test.js` · `tests/unit/fr060-business-home-visibility.test.js` · `tests/unit/overview-split.test.js` · `tests/unit/people-directory.test.js` · `tests/unit/people-route.test.js` · `tests/unit/people-service.test.js`

### FR-043 — Project stores a direct nullable `businessId` owner plus `workspaceId` as Development Space context. Business-scoped projects must match their Space owner; explicit portfolio/tenant shared projects remain null-owner and are never attributed to a Business Overview.

- **Status:** done
- **Surface:** `/projects/[projectId]` (page)
- **Code:** `prisma/seed.js` · `src/app/(pm)/projects/[projectId]/page.jsx` · `src/components/layouts/Breadcrumb.jsx` · `src/components/layouts/Topbar.jsx` · `src/context/ScopeContext.jsx` · `src/modules/business/application/business-strategy-service.js` · `src/modules/project-manager/application/project-list-read-model.js` · `src/modules/project-manager/application/project-service.js` · `src/modules/project-manager/import/plan-import-service.js`
- **Follows:** BR-001, BR-004, BR-009, FR-069, NFR-007, SDD-004, SDD-006, SDD-009, SDD-012, SDD-013, SDD-018, SDD-020, SDD-021, SDD-024, SDD-033, SDD-036, SDD-037, SEC-001, SEC-002, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr046-entry-contract.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/external-ref-import.test.js` · `tests/integration/fr059-business-strategy-mutation.test.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/import-target-authorization.test.js` · `tests/integration/plan-import.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/integration/project-list-contract.test.js` · `tests/unit/breadcrumb-switcher.test.js` · `tests/unit/business-strategy-service.test.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/project-business-context.test.js` · `tests/unit/project-list-contract.test.js` · `tests/unit/scope-view-context.test.js` · `tests/unit/topbar-no-dropdown.test.js`

### FR-044 — Entry routing is split into a minimal Landing (`/`), a demo Login stub in the historical routing slice, a Business Routing page (`/businesses`) that shows only viewer-visible Businesses, and the final BusinessShell (`/overview`) mounted only after a Business is selected. The current `/login` is credential Login under FR-046/ADR-017; the routing boundary remains FR-044.

- **Status:** done
- **Surface:** `/businesses` (page) · `/login` (page) · `/` (page)
- **Code:** `src/app/(entry)/businesses/page.jsx` · `src/app/(pm)/layout.jsx` · `src/app/layout.jsx` · `src/app/login/page.jsx` · `src/app/page.jsx` · `src/components/layouts/Breadcrumb.jsx` · `src/components/layouts/BusinessRoutingShell.jsx` · `src/components/layouts/BusinessShellGuard.jsx` · `src/components/layouts/EntryShell.jsx` · `src/components/layouts/Topbar.jsx` · `src/lib/business-routing.js` · `src/lib/business-shell-guard.js`
- **Follows:** SDD-012, SDD-013, SDD-018, SDD-021, SDD-022, SDD-024, SDD-029, SEC-008
- **Tests:** `tests/e2e/fr044-entry-routing.spec.js` · `tests/e2e/fr046-entry-contract.spec.js` · `tests/e2e/smoke.spec.js` · `tests/unit/breadcrumb-switcher.test.js` · `tests/unit/business-routing-page.test.js` · `tests/unit/business-routing.test.js` · `tests/unit/business-shell-guard.test.js` · `tests/unit/entry-routing-boundary.test.js` · `tests/unit/entry-surfaces.test.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/fr056-landing.test.js` · `tests/unit/route-reachability.test.js` · `tests/unit/scope-view-context.test.js` · `tests/unit/topbar-no-dropdown.test.js`

### FR-045 — Managed local file workspace: SQLite is authoritative for FileAsset identity, Business/Project ownership, links, version, status and audit; the filesystem stores real content plus disposable cache. Business File Manager aggregates Business-owned and child Project assets without copying content. Existing FR-037 ProjectFile rows/routes migrate through a compatibility boundary; local OS reveal is capability-gated and hosted mode denies it.

- **Feature:** FEAT-001 — File Manager — Business/Project files with managed local workspace
- **Status:** done
- **Surface:** `/backup` (page) · `/files` (page) · `/projects/[projectId]/files` (page) · `/api/backup/export` (api) · `/api/backup/import` (api) · `/api/business/files` (api) · `/api/files/[id]/content` (api) · `/api/files/[id]/relink` (api) · `/api/files/[id]/reveal` (api) · `/api/files/[id]` (api) · `/api/files/cache/rebuild` (api) · `/api/files/migrate` (api) · `/api/files/mounts` (api) · `/api/files/reconcile` (api) · `/api/files` (api)
- **Code:** `src/app/(pm)/backup/page.jsx` · `src/app/(pm)/files/page.jsx` · `src/app/(pm)/projects/[projectId]/files/page.jsx` · `src/app/api/backup/export/route.js` · `src/app/api/backup/import/route.js` · `src/app/api/business/files/route.js` · `src/app/api/files/[id]/content/route.js` · `src/app/api/files/[id]/relink/route.js` · `src/app/api/files/[id]/reveal/route.js` · `src/app/api/files/[id]/route.js` · `src/app/api/files/cache/rebuild/route.js` · `src/app/api/files/migrate/route.js` · `src/app/api/files/mounts/route.js` · `src/app/api/files/reconcile/route.js` · `src/app/api/files/route.js` · `src/config/domains.js` · `src/config/modules.js` · `src/modules/project-manager/application/backup-service.js` · `src/modules/project-manager/application/file-asset-service.js` · `src/modules/project-manager/application/file-manager-read-model.js` · `src/modules/project-manager/application/file-reconcile-cache-service.js` · `src/modules/project-manager/application/local-file-reveal-service.js` · `src/modules/project-manager/components/FileManagerViews.jsx` · `src/modules/project-manager/components/ManagedFilesPanel.jsx` · `src/modules/project-manager/components/useApi.js` · `src/modules/project-manager/local-files/filesystem-port.js` · `src/modules/project-manager/local-files/path-security.js`
- **Follows:** BR-008, BR-010, SDD-007, SDD-016, SDD-018, SDD-023, SDD-024, SDD-031, SEC-007, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr045-files.spec.js` · `tests/e2e/fr058-file-views.spec.js` · `tests/integration/backup.test.js` · `tests/integration/fr045-managed-files.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/domain-navigation.test.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/fr045-file-asset-service.test.js` · `tests/unit/fr045-file-manager-read-model.test.js` · `tests/unit/fr045-filesystem-port.test.js` · `tests/unit/fr045-path-security.test.js` · `tests/unit/fr045-reconcile-cache.test.js` · `tests/unit/fr045-reveal.test.js` · `tests/unit/fr045-schema-contract.test.js` · `tests/unit/fr045-w0-contract.test.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/fr058-file-manager-views-model.test.js` · `tests/unit/fr058-file-manager-views-ui.test.js` · `tests/unit/project-file-service.test.js`

### FR-046 — Production viewer entry contract: Business Routing consumes one atomic, server-filtered `/api/entry` response derived from a trusted request session and `resolveViewer()`. Hidden Businesses and unrelated ancestry are never returned; missing sessions fail closed; client-supplied identity/role/platform claims are never authorization input.

- **Status:** done
- **Surface:** `/businesses` (page) · `/audit` (page) · `/api/audit` (api) · `/api/auth/login` (api) · `/api/auth/logout` (api) · `/api/backup/export` (api) · `/api/backup/import` (api) · `/api/business/files` (api) · `/api/business/goals/[id]/projects/[projectId]` (api) · `/api/business/goals/[id]/projects` (api) · `/api/business/goals/[id]` (api) · `/api/business/goals` (api) · `/api/business/roadmaps/[id]` (api) · `/api/business/roadmaps` (api) · `/api/business/strategy` (api) · `/api/containers/[id]` (api) · `/api/containers` (api) · `/api/dependencies/[id]` (api) · `/api/dependencies` (api) · `/api/entry` (api) · `/api/files/[id]/content` (api) · `/api/files/[id]/relink` (api) · `/api/files/[id]/reveal` (api) · `/api/files/[id]` (api) · `/api/files/cache/rebuild` (api) · `/api/files/migrate` (api) · `/api/files/mounts` (api) · `/api/files/reconcile` (api) · `/api/files` (api) · `/api/gates/[id]` (api) · `/api/gates` (api) · `/api/milestones/[id]` (api) · `/api/milestones` (api) · `/api/people` (api) · `/api/platform/users` (api) · `/api/profile` (api) · `/api/progress/project/[id]` (api) · `/api/progress/workstream/[id]` (api) · `/api/projects/[id]/dependencies` (api) · `/api/projects/[id]/files/[fileId]` (api) · `/api/projects/[id]/files` (api) · `/api/projects/[id]` (api) · `/api/projects/[id]/team` (api) · `/api/projects/[id]/teams` (api) · `/api/projects/[id]/tree` (api) · `/api/projects` (api) · `/api/repositories/[id]` (api) · `/api/repositories/link/[id]` (api) · `/api/repositories/link` (api) · `/api/repositories` (api) · `/api/scope` (api) · `/api/teams/[id]/members` (api) · `/api/teams/[id]` (api) · `/api/teams` (api) · `/api/work/[id]` (api) · `/api/work` (api) · `/api/workspaces/[id]` (api) · `/api/workstreams/[id]` (api) · `/api/workstreams` (api) · `/login` (page)
- **Code:** `src/app/(entry)/businesses/page.jsx` · `src/app/(pm)/audit/page.jsx` · `src/app/api/audit/route.js` · `src/app/api/auth/login/route.js` · `src/app/api/auth/logout/route.js` · `src/app/api/backup/export/route.js` · `src/app/api/backup/import/route.js` · `src/app/api/business/files/route.js` · `src/app/api/business/goals/[id]/projects/[projectId]/route.js` · `src/app/api/business/goals/[id]/projects/route.js` · `src/app/api/business/goals/[id]/route.js` · `src/app/api/business/goals/route.js` · `src/app/api/business/roadmaps/[id]/route.js` · `src/app/api/business/roadmaps/route.js` · `src/app/api/business/strategy/route.js` · `src/app/api/containers/[id]/route.js` · `src/app/api/containers/route.js` · `src/app/api/dependencies/[id]/route.js` · `src/app/api/dependencies/route.js` · `src/app/api/entry/route.js` · `src/app/api/files/[id]/content/route.js` · `src/app/api/files/[id]/relink/route.js` · `src/app/api/files/[id]/reveal/route.js` · `src/app/api/files/[id]/route.js` · `src/app/api/files/cache/rebuild/route.js` · `src/app/api/files/migrate/route.js` · `src/app/api/files/mounts/route.js` · `src/app/api/files/reconcile/route.js` · `src/app/api/files/route.js` · `src/app/api/gates/[id]/route.js` · `src/app/api/gates/route.js` · `src/app/api/milestones/[id]/route.js` · `src/app/api/milestones/route.js` · `src/app/api/people/route.js` · `src/app/api/platform/users/route.js` · `src/app/api/profile/route.js` · `src/app/api/progress/project/[id]/route.js` · `src/app/api/progress/workstream/[id]/route.js` · `src/app/api/projects/[id]/dependencies/route.js` · `src/app/api/projects/[id]/files/[fileId]/route.js` · `src/app/api/projects/[id]/files/route.js` · `src/app/api/projects/[id]/route.js` · `src/app/api/projects/[id]/team/route.js` · `src/app/api/projects/[id]/teams/route.js` · `src/app/api/projects/[id]/tree/route.js` · `src/app/api/projects/route.js` · `src/app/api/repositories/[id]/route.js` · `src/app/api/repositories/link/[id]/route.js` · `src/app/api/repositories/link/route.js` · `src/app/api/repositories/route.js` · `src/app/api/scope/route.js` · `src/app/api/teams/[id]/members/route.js` · `src/app/api/teams/[id]/route.js` · `src/app/api/teams/route.js` · `src/app/api/work/[id]/route.js` · `src/app/api/work/route.js` · `src/app/api/workspaces/[id]/route.js` · `src/app/api/workstreams/[id]/route.js` · `src/app/api/workstreams/route.js` · `src/app/login/page.jsx` · `src/context/ScopeContext.jsx` · `src/modules/identity/auth-service.js` · `src/modules/identity/entry-read-model.js` · `src/modules/identity/request-viewer.js` · `src/modules/identity/session-port.js` · `src/modules/project-manager/application/work-read-service.js`
- **Follows:** BR-001, BR-008, BR-018, FR-036, FR-037, FR-038, FR-075, SDD-015, SDD-015, SEC-003, docs/features/FR-036-project-team.md, SDD-016, SDD-016, SEC-003, docs/features/FR-037-project-files.md, SDD-017, SDD-017, SEC-003, docs/features/FR-038-profile-and-permissions.md, SDD-017, docs/features/FR-038-profile-and-permissions.md, SDD-018, SDD-019, SDD-020, SDD-022, SDD-023, SDD-024, SDD-032, SDD-052, SEC-001, SEC-003, SEC-007, SEC-008, SEC-018
- **Tests:** `tests/e2e/fr046-entry-contract.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/backup.test.js` · `tests/integration/fr046-entry-contract.test.js` · `tests/integration/fr059-business-strategy-mutation.test.js` · `tests/integration/fr072-dependency-authorization.test.js` · `tests/integration/fr072-milestone-gate-authorization.test.js` · `tests/integration/fr072-project-file-authorization.test.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/fr072-repository-link-authorization.test.js` · `tests/integration/fr072-work-service-authorization.test.js` · `tests/integration/fr072-workspace-mutation-authorization.test.js` · `tests/integration/fr073-repository-scope.test.js` · `tests/integration/fr074-scope-creation-authorization.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/integration/fr089-team-scope.test.js` · `tests/integration/password-reset-flow.test.js` · `tests/integration/project-core.test.js` · `tests/integration/work-listing-scope.test.js` · `tests/unit/audit-page.test.js` · `tests/unit/auth-service.test.js` · `tests/unit/authorization-seam-list-routes.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/business-routing-page.test.js` · `tests/unit/business-routing.test.js` · `tests/unit/business-strategy-route.test.js` · `tests/unit/entry-surfaces.test.js` · `tests/unit/fr036-team-authorization.test.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/fr045-file-asset-service.test.js` · `tests/unit/fr045-reconcile-cache.test.js` · `tests/unit/fr045-reveal.test.js` · `tests/unit/fr046-api-ui-contract.test.js` · `tests/unit/fr046-auth-route.test.js` · `tests/unit/fr046-entry-read-model.test.js` · `tests/unit/fr046-session-port.test.js` · `tests/unit/fr061-per-business-domain-visibility.test.js` · `tests/unit/fr089-br018-team-grants-nothing.test.js` · `tests/unit/iam-session.test.js` · `tests/unit/password-reset-service.test.js` · `tests/unit/people-route.test.js` · `tests/unit/playwright-database-bootstrap.test.js` · `tests/unit/profile-permission-service.test.js` · `tests/unit/project-dependency-route.test.js` · `tests/unit/project-file-service.test.js` · `tests/unit/project-manager-mcp.test.js` · `tests/unit/project-team-service.test.js` · `tests/unit/run-bat-database-bootstrap.test.js` · `tests/unit/scope-view-context.test.js`

### FR-047 — Curated business-knowledge read contract: the SmartGift pilot exposes only an allow-listed, versioned public product projection through `BusinessKnowledgeReadPort`; DuckDB and Supabase are adapters. PII, cost, margin, invoice, unrestricted SQL and local paths are excluded.

- **Status:** n/a
- **Code:** `src/modules/agent/phase1-runtime.js` · `src/modules/knowledge/business-contract.js` · `src/modules/knowledge/supabase-business-knowledge.js`
- **Follows:** SDD-025, SDD-026, SDD-044, SEC-009, SEC-010, SEC-016
- **Tests:** `tests/unit/business-knowledge-contract.test.js` · `tests/unit/phase1-business-agent-runtime.test.js` · `tests/unit/supabase-business-knowledge.test.js`

### FR-048 — Provider selection contract: `ModelProviderPort` normalizes OpenRouter OAuth credential references and API-key adapters for OpenAI, Anthropic, Gemini and Groq. Public LINE cannot select consumer-plan CLI credentials, and automatic fallback is disabled.

- **Feature:** FEAT-004 — Phase 1 LINE Runtime Connections — Business-scoped provider selection, production secret resolution, local evaluation providers and secret-safe Platform management
- **Status:** n/a
- **Code:** `src/modules/agent/index.js` · `src/modules/agent/model-provider.js` · `src/modules/agent/openrouter-oauth.js` · `src/modules/agent/phase1-runtime.js` · `src/platform/integrations/llm/provider-catalog.js`
- **Follows:** SDD-025, SDD-026, SDD-027, SDD-044, SEC-009, SEC-010, SEC-011, SEC-016
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/unit/activation-readiness-integration.test.js` · `tests/unit/fr048-provider-catalog.test.js` · `tests/unit/model-provider-port.test.js` · `tests/unit/phase1-business-agent-runtime.test.js`

### FR-049 — Evidence-grounded answer: classify into a registered knowledge query, send only a bounded evidence packet to the configured provider, reject unsupported numbers/facts, and return a deterministic Thai fallback when evidence or provider output is insufficient.

- **Status:** n/a
- **Code:** `src/modules/agent/grounded-business-answer.js` · `src/modules/agent/index.js`
- **Follows:** SDD-025, SDD-027, SEC-009, SEC-011
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/unit/activation-readiness-integration.test.js` · `tests/unit/grounded-business-answer.test.js`

### FR-050 — Single-reply LINE delivery: one signature-verified normalized event produces at most one model request and one LINE reply, with durable-or-explicitly-bounded dedupe, kill switch, bounded timeout and truthful `ACCEPTED_BY_LINE` receipt semantics.

- **Status:** n/a
- **Surface:** `/api/agent/line-webhook` (api)
- **Code:** `src/app/api/agent/line-webhook/route.js`
- **Follows:** BR-011, BR-012, NFR-017, SDD-026, SDD-048, SEC-010
- **Tests:** `tests/integration/agent-webhook-route.test.js` · `tests/integration/line-oa-cross-repo-round-trip.test.js` · `tests/integration/line-oa-evidence-convergence.test.js` · `tests/integration/line-oa-failure-paths.test.js` · `tests/integration/line-oa-golden-path.test.js` · `tests/integration/line-webhook-transport-contract.test.js` · `tests/integration/smartgift-webhook-e2e.test.js`

### FR-051 — Production Supabase tenant isolation: SmartGift knowledge lives in private `zuri_core`, every row carries the reserved Tenant and Business UUIDs, composite foreign keys enforce ancestry, forced RLS plus tenant-leading indexes protect reads, and the DuckDB import retains SHA-256 lineage plus an immutable import audit event.

- **Status:** n/a
- **Code:** `src/modules/knowledge/postgres-business-knowledge.js`
- **Follows:** SDD-026, SEC-010
- **Tests:** `tests/unit/phase1-runtime-login-probe.test.js` · `tests/unit/postgres-business-knowledge.test.js` · `tests/unit/supabase-production-isolation.test.js`

### FR-052 — Server-owned LINE scope binding: the webhook rejects client-selected Tenant/Business IDs and resolves scope only from an active, destination-bound, hash-verified LINE binding. Runtime connects through an unprivileged login and executes each read with `SET LOCAL ROLE zuri_line_smartgift_ro`.

- **Status:** n/a
- **Surface:** `/api/agent/line-webhook` (api)
- **Code:** `src/app/api/agent/line-webhook/route.js` · `src/modules/agent/line-binding-resolver.js` · `src/modules/agent/line-channel-binding.js` · `src/modules/agent/phase1-runtime.js` · `src/modules/knowledge/runtime-postgres-config.js` · `src/platform/integrations/providers/line/line-oa-evidence.js` · `src/platform/integrations/providers/line/line-oa-webhook.js`
- **Follows:** BR-009, BR-011, BR-012, BR-020, FR-081, NFR-017, SDD-009, SDD-025, SDD-026, SDD-027, SDD-044, SDD-048, SEC-001, SEC-009, SEC-010, SEC-011, SEC-016, SEC-018, docs/domains/integration/features/FR-081-raw-external-ingestion.md
- **Tests:** `tests/integration/agent-webhook-route.test.js` · `tests/integration/line-oa-cross-repo-round-trip.test.js` · `tests/integration/line-oa-evidence-convergence.test.js` · `tests/integration/line-oa-golden-path.test.js` · `tests/integration/line-reply-record.test.js` · `tests/integration/line-webhook-unbound-production.test.js` · `tests/integration/smartgift-webhook-e2e.test.js` · `tests/unit/line-binding-resolver.test.js` · `tests/unit/line-channel-binding.test.js` · `tests/unit/line-webhook-scope-fail-closed.test.js` · `tests/unit/phase1-business-agent-runtime.test.js` · `tests/unit/phase1-runtime-login-probe.test.js` · `tests/unit/platform/line-oa-webhook.test.js` · `tests/unit/runtime-postgres-config.test.js`

### FR-053 — Phase 1 golden question evaluation: validate a versioned corpus of at least 20 approved business questions against registered queries, bounded evidence, policy outcomes and allowed numeric claims. The evaluator supports injected fake ports and an environment-only real-provider mode, emits redacted evidence, and requires 20/20 with zero unsupported numbers.

- **Status:** n/a
- **Code:** `src/modules/agent/activation-readiness-contract.js` · `src/modules/agent/golden-evaluation.js` · `src/modules/agent/index.js`
- **Follows:** BR-013, SDD-027, SEC-011
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/unit/activation-readiness-contract.test.js` · `tests/unit/activation-readiness-integration.test.js` · `tests/unit/golden-evaluation.test.js`

### FR-054 — Controlled LINE canary readiness: produce a secret-safe runtime-role isolation report and dry-run canary plan that validates exact project/Tenant/Business/binding/provider/evaluation prerequisites. Readiness code never activates a binding or calls LINE; receipt states distinguish accepted from display/read unknown.

- **Status:** n/a
- **Code:** `src/modules/agent/activation-readiness-contract.js` · `src/modules/agent/canary-preflight.js` · `src/modules/agent/index.js` · `src/modules/knowledge/index.js` · `src/modules/knowledge/runtime-isolation-probe.js` · `src/modules/knowledge/runtime-postgres-config.js`
- **Follows:** BR-013, SDD-026, SDD-027, SEC-010, SEC-011
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/integration/knowledge-project.test.js` · `tests/integration/knowledge-query.test.js` · `tests/integration/runtime-isolation-probe.postgres.test.js` · `tests/unit/activation-readiness-contract.test.js` · `tests/unit/activation-readiness-integration.test.js` · `tests/unit/line-canary-preflight.test.js` · `tests/unit/runtime-isolation-probe.test.js` · `tests/unit/runtime-postgres-config.test.js`

### FR-055 — Controlled LINE activation and receipt: a dry-run-default operator command may install HMAC hashes and activate exactly one expiring binding only through a versioned compare-and-swap transaction and dedicated least-privilege role. Routing-first rollback and append-only redacted receipt events preserve truthful `ACCEPTED_BY_LINE` versus display/read unknown semantics.

- **Status:** n/a
- **Code:** `src/modules/agent/line-activation-contract.js` · `src/modules/agent/line-binding-activation.js` · `src/modules/agent/line-operator.js` · `src/modules/agent/zuri-cli-canary-receipt.js`
- **Follows:** BR-014, NFR-013, SDD-028, SEC-012
- **Tests:** `tests/integration/controlled-line-activation.postgres.test.js` · `tests/integration/line-binding-activation.postgres.test.js` · `tests/unit/activation-readiness-integration.test.js` · `tests/unit/controlled-line-activation-migration.test.js` · `tests/unit/fr055-postgres-target-guard.test.js` · `tests/unit/line-activation-contract.test.js` · `tests/unit/line-binding-activation-cli.test.js` · `tests/unit/line-binding-activation.test.js` · `tests/unit/zuri-cli-canary-receipt.test.js`

### FR-056 — Zuri-branded entry landing: `/` presents a full-viewport, responsive Zuri Heritage composition with one route-bearing action to `/login`, code-native/local visuals, reduced-motion support, and no third-party fashion or commerce semantics. FR-044/046 routing and identity boundaries remain unchanged.

- **Status:** n/a
- **Surface:** `/` (page)
- **Code:** `src/app/page.jsx` · `src/components/landing/ZuriLanding.jsx` · `src/components/layouts/EntryShell.jsx`
- **Follows:** SDD-022, SDD-029
- **Tests:** `tests/unit/entry-surfaces.test.js` · `tests/unit/fr056-landing.test.js` · `tests/unit/route-reachability.test.js`

### FR-057 — Authorized agent context: every LINE turn resolves ExternalIdentity, Person, Membership, thread/session assurance and server-owned agent/workspace/project scope, then calls GoVibe/MSP API-010 `msp_vault_resolve` before API-009 retrieval; the model, prompt, client payload and stale session cannot widen the canonical authorized vault set.

- **Status:** n/a
- **Code:** `src/modules/agent/auth-context.js` · `src/modules/agent/context.js` · `src/modules/agent/memory-port.js` · `src/modules/agent/msp-memory-port.js` · `src/modules/agent/msp-vault-resolver.js` · `src/modules/agent/scoped-memory.js`
- **Follows:** BR-015, BR-020, SDD-030, SDD-052, SEC-013, SEC-018
- **Tests:** `tests/integration/agent-context.test.js` · `tests/integration/agent-msp-port.test.js` · `tests/integration/agent-multi-principal.test.js` · `tests/integration/agent-runtime.test.js` · `tests/integration/msp-vault-memory-port.test.js` · `tests/unit/msp-vault-resolver.test.js`

### FR-058 — File Manager views: the Business and Project File Manager render the existing FR-045 asset set in four switchable read views — grid (current behaviour), timeline (ordered by `FileAsset.updatedAt`/`createdAt`), by-project (the read model's existing BUSINESS/PROJECT `groups`), and preview (inline for authorized `LOCAL_FILE` content via `/api/files/{id}/content`, mime-gated; link-out for `EXTERNAL_URL`). View choice is client state only — no new persistence, route or write path; the read-model `assetDto` gains `createdAt`/`updatedAt` additively.

- **Feature:** FEAT-001 — File Manager — Business/Project files with managed local workspace
- **Status:** done
- **Code:** `src/modules/project-manager/application/file-manager-read-model.js` · `src/modules/project-manager/components/FileManagerViews.jsx` · `src/modules/project-manager/components/ManagedFilesPanel.jsx`
- **Follows:** SDD-023, SDD-031, SEC-007
- **Tests:** `tests/e2e/fr058-file-views.spec.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/fr045-file-manager-read-model.test.js` · `tests/unit/fr058-file-manager-views-model.test.js` · `tests/unit/fr058-file-manager-views-ui.test.js`

### FR-059 — Business Strategy mutation: create/update of `BusinessRoadmap` and its 2–3 ordered horizons, `BusinessGoal` (status/priority/progress/dates), and `ProjectGoal` link/unlink, through audited services in `project-manager/application`, authorized **per Business** — the caller must hold OWNER authority over the target Business (`viewer.ownedBusinessIds`), never merely the global OWNER label. The FR-041 read model remains the only read contract; horizon cardinality and Business isolation are enforced by the service.

- **Status:** done
- **Surface:** `/customer/conversations` (page) · `/overview` (page) · `/api/business/goals/[id]/projects/[projectId]` (api) · `/api/business/goals/[id]/projects` (api) · `/api/business/goals/[id]` (api) · `/api/business/goals` (api) · `/api/business/roadmaps/[id]` (api) · `/api/business/roadmaps` (api)
- **Code:** `src/app/(pm)/customer/conversations/page.jsx` · `src/app/(pm)/overview/page.jsx` · `src/app/api/business/goals/[id]/projects/[projectId]/route.js` · `src/app/api/business/goals/[id]/projects/route.js` · `src/app/api/business/goals/[id]/route.js` · `src/app/api/business/goals/route.js` · `src/app/api/business/roadmaps/[id]/route.js` · `src/app/api/business/roadmaps/route.js` · `src/modules/identity/viewer-authority.js` · `src/modules/project-manager/application/business-strategy-mutation-service.js` · `src/modules/project-manager/components/StrategyEditModals.jsx`
- **Follows:** BR-001, BR-011, NFR-004, SDD-007, SDD-014, SDD-020, SDD-024, SDD-032, SDD-033, SDD-050, SDD-053, SEC-001, SEC-003, SEC-005, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr059-strategy-edit.spec.js` · `tests/e2e/fr091-conversation-inbox.spec.js` · `tests/integration/fr059-business-strategy-mutation.test.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/fr059-strategy-edit-ui.test.js` · `tests/unit/fr059-strategy-validation.test.js` · `tests/unit/fr060-business-home-read-model.test.js` · `tests/unit/fr060-business-home-visibility.test.js` · `tests/unit/fr091-inbox-ui-contract.test.js` · `tests/unit/overview-split.test.js` · `tests/unit/repositories-page-ui-contract.test.js` · `tests/unit/viewer-authority.test.js`

### FR-060 — Business Home: a shell-level Tier-2 slot whose Dashboard aggregates the selected Business across domains — a briefing line, KPI tiles, per-domain health, and an attention queue ordered by impact. It is a **non-owning read projection**: every figure is recomputed from the owning domain's read model, nothing is stored, and no write path is added. Domains with no module render as **reserved slots, never as zero or as invented figures**; only live domains contribute to any score. FR-041's Business Overview becomes this Dashboard rather than a second surface beside it.

- **Feature:** FEAT-002 — Business Home — shell-level cross-domain aggregation (Dashboard now; Goals & KPIs, Risks & Alerts, Reports later)
- **Status:** done
- **Surface:** `/overview` (page)
- **Code:** `src/app/(pm)/overview/page.jsx` · `src/config/domains.js` · `src/config/modules.js` · `src/lib/business-shell-guard.js` · `src/modules/business/application/business-home-read-model.js` · `src/modules/project-manager/application/project-service.js`
- **Follows:** BR-001, BR-004, SDD-004, SDD-014, SDD-018, SDD-020, SDD-021, SDD-022, SDD-032, SDD-033, SDD-036, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr044-entry-routing.spec.js` · `tests/e2e/fr045-files.spec.js` · `tests/e2e/fr058-file-views.spec.js` · `tests/e2e/fr059-strategy-edit.spec.js` · `tests/e2e/fr060-business-home.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/unit/business-shell-guard.test.js` · `tests/unit/domain-navigation.test.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/fr059-strategy-edit-ui.test.js` · `tests/unit/fr060-business-home-read-model.test.js` · `tests/unit/fr060-business-home-visibility.test.js` · `tests/unit/fr061-per-business-domain-visibility.test.js` · `tests/unit/overview-split.test.js` · `tests/unit/project-list-contract.test.js` · `tests/unit/projects-dashboard-ui.test.js` · `tests/unit/sidebar-visible-subdomains.test.js`

### FR-061 — Per-Business domain visibility: `resolveViewer()` resolves which domains a principal may see **per Business**, not once per principal. Each Membership's grant applies only to the Businesses that Membership covers — an OWNER Membership confers all domains on the Businesses it owns, and never widens what the same principal sees in a Business where they hold only a MEMBER Membership. The viewer gains `domainsByBusinessId` (per-Business allow-list; absent or `[]` denies), and `domainsForBusiness(viewer, businessId)` is the only way a Business-scoped consumer may ask the question. The existing flat `visibleDomains` is retained and additively redefined as the union across visible Businesses — "may this principal see this domain *anywhere*" — and is never an authorization input for a Business-scoped decision. The route guard and the domain bar both read the per-Business answer.

- **Status:** done
- **Code:** `src/components/layouts/CommandPalette.jsx` · `src/components/layouts/DomainBar.jsx` · `src/lib/business-shell-guard.js` · `src/modules/identity/resolve-viewer.js` · `src/modules/identity/viewer-domains.js`
- **Follows:** ADR-008 §D4, docs/features/FR-031-viewer-gate.md, FR-031, FR-038, SDD-017, SDD-017, docs/features/FR-038-profile-and-permissions.md, SDD-018, SDD-022, SDD-034, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/unit/business-shell-guard.test.js` · `tests/unit/command-palette-index.test.js` · `tests/unit/domain-navigation.test.js` · `tests/unit/fr060-business-home-visibility.test.js` · `tests/unit/fr061-per-business-domain-visibility.test.js` · `tests/unit/fr076-product-owner-business-assignment.test.js` · `tests/unit/profile-permission-service.test.js` · `tests/unit/viewer-gate.test.js`

### FR-062 — Users & Permissions read scope: `GET /api/platform/users` returns only Memberships the caller may actually administer — those whose Business is in `viewer.ownedBusinessIds` — so the list can no longer disagree with the authority `updateUserPermissions` enforces. Tenant-wide Memberships (`businessId: null`) are returned **only for tenants where the caller owns a Business**, never unconditionally, and each row carries a server-decided `manageable` flag; the client renders a non-manageable row read-only rather than inferring editability itself. The response carries no field the surface does not display — `Person.email` is dropped.

- **Status:** done
- **Surface:** `/platform/users` (page)
- **Code:** `src/app/(pm)/platform/users/page.jsx` · `src/modules/identity/profile-permission-service.js`
- **Follows:** BR-001, FR-038, SDD-017, SDD-017, SEC-003, docs/features/FR-038-profile-and-permissions.md, SDD-035, SEC-001, SEC-003
- **Tests:** `tests/integration/fr089-team-scope.test.js` · `tests/unit/fr036-team-authorization.test.js` · `tests/unit/fr062-permissions-read-scope.test.js` · `tests/unit/profile-permission-service.test.js`

### FR-063 — Project Board: the project-local Work tab renders that Project's WorkItems as a status board — **one column per value of `WORK_STATUSES`**, derived from `src/lib/validation/enums.js` rather than a hand-written list, so no status can exist that the board silently drops. Opening a card opens the existing Workpackage editor; the board itself persists nothing — no column, order or card position is stored, and every status change goes through the FR-005 services.

- **Status:** done
- **Surface:** `/projects/[projectId]/board` (page)
- **Code:** `src/app/(pm)/projects/[projectId]/board/page.jsx` · `src/modules/project-manager/views/KanbanBoard.jsx`
- **Follows:** SDD-019, SDD-036
- **Tests:** `tests/unit/fr063-board-columns.test.js` · `tests/unit/plan-status-vocabulary.test.js`

### FR-064 — Schedule: Project and Milestone dates render as a derived month-grid timeline, available **global and project-scoped** (the same view under a different filter, mirroring FR-009). Bars come from `Project.startAt`/`targetAt`, markers from `Milestone.targetAt`. It is read-only and non-owning: nothing is persisted, no date is editable from this view, and a Project or Milestone with no dates simply does not render a bar.

- **Status:** done
- **Surface:** `/projects/[projectId]/timeline` (page) · `/timeline` (page)
- **Code:** `src/app/(pm)/projects/[projectId]/timeline/page.jsx` · `src/app/(pm)/timeline/page.jsx` · `src/modules/project-manager/application/project-service.js` · `src/modules/project-manager/views/universal/TimelineView.jsx`
- **Follows:** BR-001, BR-004, SDD-004, SDD-019, SDD-021, SDD-033, SDD-036, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/unit/global-view-scope-contract.test.js` · `tests/unit/project-list-contract.test.js` · `tests/unit/project-work-route.test.js`

### FR-065 — Import target authorization: the FR-012 pipeline authorizes the Workspace it is about to write to, instead of accepting whichever `workspaceId` the request body names. All three intake routes (`/api/import/dry-run`, `/api/import/commit`, `/api/import/xlsx`) resolve a viewer, and the target Workspace is resolved **before** validation so an unauthorized target is refused without the caller learning anything about the plan. (a) A **Business-scoped** Workspace requires `ownsBusiness(viewer, workspace.businessId)` — the same predicate the other write paths use, not a second reading of it; a caller who may see the Business but does not own it is refused. (b) A Workspace **above Business** (`scopeType` PORTFOLIO or TENANT) is refused with an explicit reason stating that no authority above Business is declared — this requirement deliberately does **not** invent one. Enabling such an import requires a prior FR that makes portfolio/tenant authority *holdable*: a viewer-contract change in the manner of FR-061, since today no principal can hold it. The dry run is authorized identically to the commit — a read-only preview of another scope's contents is the leak the commit guard would otherwise still allow.

- **Status:** done
- **Surface:** `/api/import/commit` (api) · `/api/import/dry-run` (api) · `/api/import/xlsx` (api)
- **Code:** `src/app/api/import/commit/route.js` · `src/app/api/import/dry-run/route.js` · `src/app/api/import/xlsx/route.js` · `src/modules/project-manager/import/import-authorization.js` · `src/modules/project-manager/import/plan-import-service.js`
- **Follows:** BR-001, BR-009, FR-069, SDD-006, SDD-009, SDD-021, SDD-037, SEC-001, SEC-002, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/external-ref-import.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/integration/import-target-authorization.test.js` · `tests/integration/plan-import-scope.test.js` · `tests/integration/plan-import.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/xlsx-intake.test.js` · `tests/unit/import-authorization.test.js`

### FR-066 — Profile-first onboarding: after a provider-neutral local identity/session exists, every new person completes a Profile before being asked to create or select operating scope. A Profile-only member may remain in Waiting Room without creating Organization/Tenant, Business, Space or Project; an owner may create a top-level Workspace and add those scopes only when needed. Profile is not an authorization grant.

- **Status:** planned
- **Code:** —
- **Follows:** —
- **Tests:** —

### FR-067 — Workspace collaboration boundary: an authorized Workspace/Tenant owner can issue a scoped, expiring, single-use invite that creates a separate WorkspaceMembership. Workspace membership grants only Workspace collaboration visibility; Tenant, Business, Space and Project access require separate server-authorized assignment, with audit and fail-closed replay/revocation behavior.

- **Status:** planned
- **Code:** —
- **Follows:** —
- **Tests:** —

### FR-068 — Human-visible Project Execution Roadmap: an authorized Human sees the same Project execution structure as Agents — current mode-specific phase/stage/period, sprint/batch/wave, backlog, linked `goal_id`/`risk_id` references when available, tags, Human/Agent assignees, dependencies/blocker owners, `gate_id`, evidence and closure, plus applicable supporting identity references — as a composed Work view over the existing Project/Workstream/WorkContainer/WorkItem model.

- **Feature:** FEAT-003 — Execution Planning — Human-visible Roadmap, Blueprint intake and stable identity bindings
- **Status:** done
- **Surface:** `/projects/[projectId]/roadmap` (page) · `/api/projects/[id]/roadmap` (api)
- **Code:** `src/app/(pm)/projects/[projectId]/roadmap/page.jsx` · `src/app/api/projects/[id]/roadmap/route.js` · `src/modules/project-manager/application/project-roadmap-labels.js` · `src/modules/project-manager/application/project-roadmap-read-model.js` · `src/modules/project-manager/application/work-read-service.js` · `src/modules/project-manager/components/WorkViewTabs.jsx`
- **Follows:** FR-070, SDD-019, SDD-039, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr040-project-work.spec.js` · `tests/integration/project-roadmap.test.js` · `tests/integration/work-listing-scope.test.js` · `tests/unit/authorization-seam-list-routes.test.js` · `tests/unit/project-manager-mcp.test.js` · `tests/unit/project-roadmap-read-model.test.js` · `tests/unit/project-roadmap-ui.test.js` · `tests/unit/project-work-route.test.js`

### FR-069 — Plan Blueprint and Human/Agent intake: after the user states an objective, Zuri may recommend an editable mode-specific Blueprint; Human forms and external Agent plans normalize to the same PlanEnvelope validation, dry-run, preview, authorization, transactional commit and audit path. Each mode has an `executionContractId`; every lifecycle/evidence step has run, step, attempt and replay IDs for tags, failure localization and append-only replay, with applicable `goal_id`/`risk_id` and supporting identity references. No first-step template picker, fake execution state or new execution mode.

- **Feature:** FEAT-003 — Execution Planning — Human-visible Roadmap, Blueprint intake and stable identity bindings
- **Status:** done
- **Surface:** `/api/mcp` (api)
- **Code:** `src/app/api/mcp/route.js` · `src/modules/project-manager/components/HumanPlanBuilderModal.jsx` · `src/modules/project-manager/import/human-plan-builder.js` · `src/modules/project-manager/import/plan-import-service.js` · `src/modules/project-manager/import/plan-schema.js` · `src/modules/project-manager/mcp/transport.js`
- **Follows:** BR-001, BR-003, BR-004, BR-007, BR-009, FR-069, SDD-002, SDD-006, SDD-009, SDD-021, SDD-037, SEC-001, SEC-002, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/external-ref-import.test.js` · `tests/integration/import-target-authorization.test.js` · `tests/integration/plan-import.test.js` · `tests/integration/project-business-binding.test.js` · `tests/unit/contract-plan-artifacts.test.js` · `tests/unit/domain-state.test.js` · `tests/unit/human-plan-builder.test.js` · `tests/unit/pipeline-mcp-transport.test.js` · `tests/unit/plan-schema.test.js` · `tests/unit/plan-status-vocabulary.test.js` · `tests/unit/project-manager-mcp.test.js` · `tests/unit/self-plan-generator.test.js`

### FR-070 — Stable execution, domain, goal, risk, tag, trace and supporting identities: every committed Execution Plan exposes canonical `executionModeId`, `executionContractId`, `planId` (= Workstream UUID), domain bindings, authorized `goal_id`/`goalIds[]`, resolved `risk_id`/`riskIds[]` when available, `containerId` plus a mode-valid period alias, `workItemId` plus a mode-valid item alias and `tagId` references; applicable `node_id`, `edge_id`, `artifact_id`, `contract_id` (CRM Contact), `meeting_id`, `call_id`, `followup_id`, `req_id`, `verify_id`, `gate_id`, `integration_id`, `graph_id`, `workflow_contract_id`, `workflow_id`, `runbook_id`, `promotion_id`, `skill_id` and `tool_id` references are owner-resolved and remain distinct from execution trace IDs.

- **Feature:** FEAT-003 — Execution Planning — Human-visible Roadmap, Blueprint intake and stable identity bindings
- **Status:** done
- **Code:** `src/modules/project-manager/application/project-roadmap-labels.js` · `src/modules/project-manager/application/project-roadmap-read-model.js` · `src/modules/project-manager/import/plan-import-service.js` · `src/modules/project-manager/import/plan-schema.js`
- **Follows:** BR-001, BR-004, BR-007, BR-009, FR-069, FR-070, SDD-002, SDD-006, SDD-009, SDD-021, SDD-037, SDD-039, SEC-001, SEC-002, SEC-008
- **Tests:** `tests/integration/external-ref-import.test.js` · `tests/integration/import-target-authorization.test.js` · `tests/integration/plan-import.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-roadmap.test.js` · `tests/unit/plan-schema.test.js` · `tests/unit/plan-status-vocabulary.test.js` · `tests/unit/project-roadmap-read-model.test.js` · `tests/unit/project-roadmap-ui.test.js`

### FR-071 — Supabase data pipeline monitor and replay: the governed SmartGift DuckDB/source-artifact → Supabase pipeline exposes stable definition, run, stage, step, attempt, record, batch, `doc_id`, `pic_id`, `fact_id`, destination and audit IDs, plus the complete supporting identity envelope (`node_id`, `edge_id`, `artifact_id`, `contract_id` (CRM Contact), `meeting_id`, `call_id`, `followup_id`, `req_id`, `verify_id`, `gate_id`, `integration_id`, `graph_id`, `workflow_contract_id`, `workflow_id`, `runbook_id`, `promotion_id`, `skill_id`, `tool_id`) on every stage/record event; monitors hashes/counts/status/tags/failure points; and supports authorized full, failed-stage, failed-record and provenance-filtered replay with immutable lineage, scope checks, RLS and idempotent destination writes.

- **Status:** n/a
- **Surface:** `/api/ingest/documents` (api) · `/api/mcp` (api) · `/api/pipelines/runs/[executionRunId]/events` (api) · `/api/pipelines/runs/[executionRunId]/replay` (api) · `/api/pipelines/runs/[executionRunId]` (api) · `/api/pipelines/runs` (api)
- **Code:** `src/app/api/ingest/documents/route.js` · `src/app/api/mcp/route.js` · `src/app/api/pipelines/runs/[executionRunId]/events/route.js` · `src/app/api/pipelines/runs/[executionRunId]/replay/route.js` · `src/app/api/pipelines/runs/[executionRunId]/route.js` · `src/app/api/pipelines/runs/route.js` · `src/modules/project-manager/mcp/transport.js` · `src/modules/project-manager/views/execution/mode-bodies.jsx` · `src/platform/integrations/core/cloud-sot-agent.js` · `src/platform/integrations/core/document-intake-contract.js` · `src/platform/integrations/core/pipeline-tracking-contract.js` · `src/platform/integrations/core/pipeline-tracking-service.js`
- **Follows:** BR-001, FR-071, SDD-042, SEC-001, SEC-003, SEC-008
- **Tests:** `tests/e2e/smoke.spec.js` · `tests/integration/openapi-docs.test.js` · `tests/unit/document-intake-ui.test.js` · `tests/unit/pipeline-mcp-transport.test.js` · `tests/unit/pipeline-monitor-ui.test.js` · `tests/unit/pipeline-tracking-route.test.js` · `tests/unit/platform/cloud-sot-agent.test.js` · `tests/unit/platform/document-intake-contract.test.js` · `tests/unit/platform/pipeline-tracking-contract.test.js` · `tests/unit/platform/pipeline-tracking-migration.test.js` · `tests/unit/platform/pipeline-tracking-service.test.js` · `tests/unit/project-manager-mcp.test.js` · `tests/unit/smartgift-document-intake-migration.test.js`

### FR-072 — Project-Manager mutation authorization: every mutating route repaid from `docs/.route-viewer-baseline.json` resolves a request viewer and the service behind it refuses the write unless `ownsBusiness(viewer, <governing Business>)`, where the governing Business is derived from the target's Space (`workspace.businessId`; for Project-scoped targets via the Project's Space per FR-043; for a Dependency, the governing Business of **both** endpoints; for a Project moved between Spaces, the authority of **both** the current governing Business and the destination Space). (a) A Business-governed target that is not owned answers exactly as a nonexistent one, so a refusal is never an enumeration oracle over another tenant's ids. (b) A target governed above Business (a Project in a PORTFOLIO/TENANT Space, a non-BUSINESS-scoped Workspace) is refused for **every** principal with a reason naming the missing authority — this requirement deliberately does **not** invent authority above Business; enabling such writes requires a prior FR that makes that authority holdable (FR-066/FR-067 direction), per the FR-065 precedent. Routes whose authorization question no declared rule answers (`/api/scope`, `/api/backup/import`) are out of scope and remain recorded debt in `docs/.route-viewer-baseline.json`, each with the missing decision named. (`/api/repositories` and `/api/repositories/[id]` were answered by FR-073 and repaid.)

- **Status:** done
- **Surface:** `/api/containers/[id]` (api) · `/api/containers` (api) · `/api/dependencies/[id]` (api) · `/api/dependencies` (api) · `/api/gates/[id]` (api) · `/api/gates` (api) · `/api/milestones/[id]` (api) · `/api/milestones` (api) · `/api/projects/[id]/files/[fileId]` (api) · `/api/projects/[id]/files` (api) · `/api/projects/[id]` (api) · `/api/projects` (api) · `/api/repositories/link/[id]` (api) · `/api/repositories/link` (api) · `/api/work/[id]` (api) · `/api/work` (api) · `/api/workspaces/[id]` (api) · `/api/workstreams/[id]` (api) · `/api/workstreams` (api)
- **Code:** `src/app/api/containers/[id]/route.js` · `src/app/api/containers/route.js` · `src/app/api/dependencies/[id]/route.js` · `src/app/api/dependencies/route.js` · `src/app/api/gates/[id]/route.js` · `src/app/api/gates/route.js` · `src/app/api/milestones/[id]/route.js` · `src/app/api/milestones/route.js` · `src/app/api/projects/[id]/files/[fileId]/route.js` · `src/app/api/projects/[id]/files/route.js` · `src/app/api/projects/[id]/route.js` · `src/app/api/projects/route.js` · `src/app/api/repositories/link/[id]/route.js` · `src/app/api/repositories/link/route.js` · `src/app/api/work/[id]/route.js` · `src/app/api/work/route.js` · `src/app/api/workspaces/[id]/route.js` · `src/app/api/workstreams/[id]/route.js` · `src/app/api/workstreams/route.js` · `src/modules/project-manager/application/dependency-service.js` · `src/modules/project-manager/application/milestone-gate-service.js` · `src/modules/project-manager/application/project-authorization.js` · `src/modules/project-manager/application/project-file-service.js` · `src/modules/project-manager/application/project-service.js` · `src/modules/project-manager/application/repository-service.js` · `src/modules/project-manager/application/scope-service.js` · `src/modules/project-manager/application/work-service.js`
- **Follows:** BR-001, BR-002, BR-004, FR-037, SDD-004, SDD-016, SDD-016, BR-002, SEC-003, docs/features/FR-037-project-files.md, SDD-016, SEC-003, docs/features/FR-037-project-files.md, SDD-019, SDD-021, SDD-033, SDD-036, SEC-001, SEC-003, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/adaptive-shell.test.js` · `tests/integration/fr059-business-strategy-mutation.test.js` · `tests/integration/fr072-dependency-authorization.test.js` · `tests/integration/fr072-milestone-gate-authorization.test.js` · `tests/integration/fr072-project-file-authorization.test.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/fr072-refusal-disclosure.test.js` · `tests/integration/fr072-repository-link-authorization.test.js` · `tests/integration/fr072-work-service-authorization.test.js` · `tests/integration/fr072-workspace-mutation-authorization.test.js` · `tests/integration/fr073-repository-scope.test.js` · `tests/integration/fr074-scope-creation-authorization.test.js` · `tests/integration/fr089-team-scope.test.js` · `tests/integration/project-authorization.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/integration/scope-and-isolation.test.js` · `tests/integration/work-listing-scope.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/fr089-br018-team-grants-nothing.test.js` · `tests/unit/global-view-drilldown.test.js` · `tests/unit/project-dependency-service.test.js` · `tests/unit/project-file-service.test.js` · `tests/unit/project-list-contract.test.js`

### FR-073 — Repository ownership: a `Repository` is owned by exactly one Business (`Repository.businessId`), which is the decision FR-072 recorded as missing for `/api/repositories` and `/api/repositories/[id]`. Business rather than Tenant or Portfolio is forced, not chosen: the viewer contract carries only Business-keyed grants, so no principal can hold authority above Business (SDD-037) and a higher-scoped Repository would be ungovernable. (a) Creating a Repository requires `ownsBusiness(viewer, businessId)`, and the Business is required at the input boundary so every new Repository is governed. (b) Updating one requires the same authority over its owning Business; an unowned Repository answers exactly as a nonexistent one. (c) Linking a Repository to a Project requires authority over **both** the Project's governing Business and the Repository's Business — the same fail-closed composition FR-072 applies to a Dependency edge. (d) `Repository.businessId` is nullable only for rows predating this requirement; such a Repository is governed by nobody, is refused for every principal with the missing owner named, and is invisible to every reader until backfilled (`scripts/backfill-repository-business.mjs`, which infers an owner only where a Repository's Project links agree and reports the rest rather than guessing). (e) Listing Repositories is scoped by `seesBusiness`, closing a cross-tenant read that previously returned every Repository in the installation with its project links attached.

- **Status:** done
- **Surface:** `/repositories` (page) · `/api/repositories/[id]` (api) · `/api/repositories` (api)
- **Code:** `prisma/seed.js` · `src/app/(pm)/repositories/page.jsx` · `src/app/api/repositories/[id]/route.js` · `src/app/api/repositories/route.js` · `src/lib/validation/entities.js` · `src/modules/project-manager/application/project-authorization.js` · `src/modules/project-manager/application/repository-service.js`
- **Follows:** BR-001, BR-002, NFR-007, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/fr072-refusal-disclosure.test.js` · `tests/integration/fr072-repository-link-authorization.test.js` · `tests/integration/fr073-repository-scope.test.js` · `tests/integration/project-authorization.test.js` · `tests/integration/project-core.test.js` · `tests/integration/project-inventory.test.js` · `tests/unit/repositories-page-ui-contract.test.js`

### FR-074 — Scope-creation authorization: every creator behind `POST /api/scope` resolves a viewer and is authorized at the scope it actually writes, in three tiers. (a) **Business scope** — `branch` and a BUSINESS-scoped `workspace` require `ownsBusiness(viewer, businessId)`. (b) **Tenant scope** — creating a `business` inside an existing Tenant, or a TENANT-scoped `workspace`, requires `ownsTenant(viewer, tenantId)`, surfaced on the viewer contract as `ownedTenantIds` from the tenant-wide OWNER Membership that already existed in the data and was previously only expanded into `ownedBusinessIds`. This names a held row; it grants nobody anything new, and is deliberately not satisfied by owning every Business in a Tenant. (c) **Self-service provisioning** — `businessInGroup` creates a new Tenant + Business + Workspace for any authenticated principal, because nothing exists to own beforehand, and **binds the creator as OWNER in the same transaction**. Without that binding the caller would provision scope they cannot subsequently write to, which is the defect this clause fixes as well as authorizes. `portfolio`, `tenant`, `legalEntity` and a PORTFOLIO-scoped `workspace` are installation primitives above any Tenant and require FR-075 operator authority. Self-service is never unauthenticated: the viewer is resolved, the write is attributed, and an audit event is recorded.

- **Status:** done
- **Surface:** `/api/scope` (api)
- **Code:** `src/app/api/scope/route.js` · `src/modules/identity/resolve-viewer.js` · `src/modules/identity/viewer-authority.js` · `src/modules/project-manager/application/scope-service.js`
- **Follows:** ADR-008 §D4, docs/features/FR-031-viewer-gate.md, BR-001, FR-031, SDD-017, SDD-034, SEC-001, SEC-008
- **Tests:** `tests/integration/adaptive-shell.test.js` · `tests/integration/fr072-workspace-mutation-authorization.test.js` · `tests/integration/fr074-scope-creation-authorization.test.js` · `tests/integration/scope-and-isolation.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/fr061-per-business-domain-visibility.test.js` · `tests/unit/fr076-product-owner-business-assignment.test.js` · `tests/unit/viewer-authority.test.js` · `tests/unit/viewer-gate.test.js`

### FR-075 — Installation-operator authority: an installation-wide operation is authorized by a named capability, `isOperator`, carried on the viewer contract and true only for a server-held platform grant (FR-031, on a trusted session per SEC-008), and false for every ordinary authenticated principal however much of the installation they own. It governs `POST /api/backup/import` — both the preview and the restore, since a preview of every table across every tenant is the same disclosure the restore guard would otherwise still permit — and the scope primitives above any Tenant (FR-074). This is a distinct *scope* of authority rather than a larger amount of Business ownership: a restore replaces Portfolios, Tenants, identities and audit rows, so no composition of `ownsBusiness` can express it, which is why the route was unrepayable until the capability was named. `isPlatform` remains visibility-only and is never read as authority (RCA 2026-08-16).

- **Status:** done
- **Surface:** `/api/backup/export` (api) · `/api/backup/import` (api)
- **Code:** `src/app/api/backup/export/route.js` · `src/app/api/backup/import/route.js` · `src/modules/identity/resolve-viewer.js` · `src/modules/identity/viewer-authority.js` · `src/modules/project-manager/application/backup-service.js` · `src/modules/project-manager/application/scope-service.js`
- **Follows:** ADR-008 §D4, docs/features/FR-031-viewer-gate.md, BR-001, BR-008, FR-031, SDD-017, SDD-023, SDD-034, SEC-001, SEC-008
- **Tests:** `tests/integration/backup.test.js` · `tests/integration/fr072-workspace-mutation-authorization.test.js` · `tests/integration/fr074-scope-creation-authorization.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/integration/scope-and-isolation.test.js` · `tests/unit/authorization-seam-routes.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/fr061-per-business-domain-visibility.test.js` · `tests/unit/fr076-product-owner-business-assignment.test.js` · `tests/unit/viewer-authority.test.js` · `tests/unit/viewer-gate.test.js`

### FR-076 — Product Owner Business role binding: a Person may hold one active generic `RoleBinding` with `roleKey=PRODUCT_OWNER` per assigned Business inside a customer Tenant; the registry expands it only to Product permissions for that Business, never Business/Tenant/Workspace ownership, Resource/Operations, Marketing, Platform, Integration, secret, LINE or import authority. Bindings are trusted, Business-scoped, revocable, audited and fail closed.

- **Status:** n/a
- **Code:** `src/lib/db.js` · `src/modules/identity/product-owner-authority.js` · `src/modules/identity/product-owner-service.js` · `src/modules/identity/rbac-service.js` · `src/modules/identity/rbac.js` · `src/modules/identity/resolve-viewer.js`
- **Follows:** ADR-008 §D4, docs/features/FR-031-viewer-gate.md, FR-031, SDD-017, SDD-034
- **Tests:** `tests/unit/application-identity-bootstrap-migration.test.js` · `tests/unit/application-schema-migration.test.js` · `tests/unit/customer-import-review-service.test.js` · `tests/unit/db-runtime-config.test.js` · `tests/unit/fr061-per-business-domain-visibility.test.js` · `tests/unit/fr076-product-owner-business-assignment.test.js` · `tests/unit/postgres-runtime-client.test.js` · `tests/unit/viewer-gate.test.js`

### FR-077 — Project Inventory MVP: an authorized viewer can open one Project and receive a stable, read-only `PROJECT_INVENTORY` DTO covering Project identity/Business/Space context, Workstreams/Containers/Items, Milestones/Gates, Project-contained Dependencies, legacy and managed file metadata, linked Repositories, visible Team/Memberships, strategy-based progress/evidence and redacted recent activity. The route uses trusted viewer scope, independent pagination/truncation metadata, no raw Prisma graph, no mutation, no external sync and does not change the Project List or `overview`/`timeline`/`workspace` compatibility views.

- **Feature:** FEAT-005 — Project Inventory — authorized, read-only Project-wide operational snapshot
- **Status:** done
- **Surface:** `/projects/[projectId]/inventory` (page) · `/api/projects/[id]/inventory` (api)
- **Code:** `src/app/(pm)/projects/[projectId]/inventory/page.jsx` · `src/app/api/projects/[id]/inventory/route.js` · `src/modules/project-manager/application/project-inventory-read-model.js`
- **Follows:** SDD-045
- **Tests:** `tests/e2e/fr077-project-inventory.spec.js` · `tests/integration/project-inventory.test.js` · `tests/unit/e2e-reconnecting-request.test.js` · `tests/unit/project-inventory-read-model.test.js` · `tests/unit/project-inventory-ui.test.js`

### FR-078 — Customer Profile backfill contract: the SmartGift historical customer pipeline has a fixed Tenant/Business scope, read-only source snapshot, machine-validated record/provenance envelope, explicit tax/name/corroboration resolution rules, duplicate/unresolved review queue, PII/financial/LINE exclusions, target Person/Customer schema gate, server-owned idempotent transaction and batch rollback; the first batch is applied with 3,439 Customer rows and 130 held review rows. The v0.3.0B review extension adds deterministic review IDs, redacted evidence, append-only Business-scoped decisions and a separate no-publish apply gate.

- **Feature:** FEAT-006 — Customer Data Backfill — scoped, provenance-preserving Customer Profile contract with entity resolution, PDPA gates and explicit duplicate review
- **Status:** n/a
- **Surface:** `/platform/customer-import-reviews` (page) · `/api/platform/customer-import-reviews/[caseId]/decisions` (api) · `/api/platform/customer-import-reviews` (api) · `/api/platform/customer-import-reviews/targets` (api)
- **Code:** `src/app/(pm)/platform/customer-import-reviews/page.jsx` · `src/app/api/platform/customer-import-reviews/[caseId]/decisions/route.js` · `src/app/api/platform/customer-import-reviews/route.js` · `src/app/api/platform/customer-import-reviews/targets/route.js` · `src/lib/db.js` · `src/modules/crm/customer-import-review-service.js` · `src/modules/crm/customer-import-review-store.js` · `src/modules/identity/rbac.js` · `src/modules/project-manager/application/backup-service.js`
- **Follows:** BR-008, SDD-023, SEC-008
- **Tests:** `tests/integration/backup.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/unit/application-identity-bootstrap-migration.test.js` · `tests/unit/application-schema-migration.test.js` · `tests/unit/customer-data-contract.test.js` · `tests/unit/customer-import-review-api.test.js` · `tests/unit/customer-import-review-contract.test.js` · `tests/unit/customer-import-review-queue-script.test.js` · `tests/unit/customer-import-review-service.test.js` · `tests/unit/customer-import-review-store-contract.test.js` · `tests/unit/customer-import-review-ui.test.js` · `tests/unit/customer-profile-backfill-migration.test.js` · `tests/unit/customer-profile-contract-receipt.test.js` · `tests/unit/customer-profile-target-verification.test.js` · `tests/unit/customer-review-runtime-login-migration.test.js` · `tests/unit/customer-review-runtime-login.test.js` · `tests/unit/db-runtime-config.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/fr076-product-owner-business-assignment.test.js` · `tests/unit/platform-approver-profile-migration.test.js` · `tests/unit/postgres-runtime-client.test.js`

### FR-079 — Phase 1 LINE runtime connection cut-over: after the server-owned LINE binding resolves the trusted Tenant/Business scope, the runtime selects exactly one `ACTIVE` `PRIMARY` `PHASE1_LINE_LLM` IntegrationConnection under that scope, resolves its opaque `secretRef` through the environment-selected provider-neutral SecretManagerPort, then composes the existing ModelProviderPort. Zero/multiple candidates, untrusted scope, secret-manager failure/expiry/version mismatch, production local-vault/raw-credential access and production/public-LINE Ollama selection fail closed before knowledge/model/reply work. Promotion uses compare-and-swap and a database uniqueness invariant; local Ollama is explicit local/dev/test/eval only and never automatic fallback. Production now selects Supabase Vault through the private resolver; live apply/provisioning/canary remain pending.

- **Feature:** FEAT-004 — Phase 1 LINE Runtime Connections — Business-scoped provider selection, production secret resolution, local evaluation providers and secret-safe Platform management
- **Status:** n/a
- **Code:** `src/modules/agent/grounded-business-answer.js` · `src/modules/agent/index.js` · `src/platform/integrations/core/credential-vault.js` · `src/platform/integrations/core/integration-registry.js` · `src/platform/integrations/core/secret-manager.js`
- **Follows:** BR-012, NFR-015, SDD-025, SDD-027, SDD-043, SEC-001, SEC-009, SEC-011, SEC-015
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/unit/activation-readiness-integration.test.js` · `tests/unit/connection-health.test.js` · `tests/unit/fr079-credential-vault.test.js` · `tests/unit/fr079-runtime-cutover.test.js` · `tests/unit/fr079-schema-contract.test.js` · `tests/unit/fr079-supabase-migration.test.js` · `tests/unit/grounded-business-answer.test.js`

### FR-080 — Platform Integrations UI: an owner with trusted Business authority can inspect and create Business-scoped IntegrationProvider/IntegrationConnection/IntegrationCredential metadata at `/platform/integrations`, with fixed `purpose=PHASE1_LINE_LLM`, redacted Vault status and explicit loading/error/empty states. The form accepts only `supabase-vault:<uuid>`; secret material is never returned to the browser or stored in Prisma, logs or audit events. The UI cannot activate LINE routing or replace FR-053/054/055 gates; promotion/rotation/revocation remain deferred lifecycle contracts. The read model now carries the AC-075.3 `health` field (`CONNECTED · DEGRADED · ERROR · DISABLED · MISCONFIGURED` plus every reason observed), computed from connection/credential state and `RawExternalRecord` arrival evidence rather than stored; the listing includes the `LINE_OA` channel alongside the Phase 1 model providers so channel health has no separate surface, while the create form stays fixed to `purpose=PHASE1_LINE_LLM`.

- **Feature:** FEAT-004 — Phase 1 LINE Runtime Connections — Business-scoped provider selection, production secret resolution, local evaluation providers and secret-safe Platform management
- **Status:** n/a
- **Surface:** `/platform/integrations` (page) · `/api/agent/heartbeat` (api) · `/api/platform/integrations/line-registry` (api) · `/api/platform/integrations` (api)
- **Code:** `src/app/(pm)/platform/integrations/page.jsx` · `src/app/api/agent/heartbeat/route.js` · `src/app/api/platform/integrations/line-registry/route.js` · `src/app/api/platform/integrations/route.js` · `src/modules/agent/phase1-runtime.js` · `src/modules/integration/application/integration-management-service.js` · `src/modules/integration/application/line-registry-service.js` · `src/platform/integrations/core/connection-health.js` · `src/platform/integrations/core/secret-manager.js`
- **Follows:** NFR-008, NFR-015, SDD-025, SDD-026, SDD-044, SEC-009, SEC-010, SEC-015, SEC-016
- **Tests:** `tests/integration/line-oa-connection-health.test.js` · `tests/unit/connection-health.test.js` · `tests/unit/fr079-runtime-cutover.test.js` · `tests/unit/fr080-integration-management.test.js` · `tests/unit/fr080-runtime-wiring.test.js` · `tests/unit/fr080-supabase-vault.test.js` · `tests/unit/fr080-ui-contract.test.js` · `tests/unit/line-registry-service.test.js` · `tests/unit/phase1-business-agent-runtime.test.js`

### FR-081 — Raw external ingestion boundary: every acquisition channel (webhook, pull, file, manual) converges on one normalized ingestion envelope carrying tenant, Business, connection, provider, lane, entity type, external id, source type and schema version, and a channel is added as an adapter rather than a second raw-write path. (a) Ingestion identity is `sha256(tenantId, connectionId, entityType, externalId, payloadHash)` over a canonically serialized payload, so a re-delivered event resolves to `UNCHANGED` instead of a duplicate row; the external id contributes to that identity and is never itself a key (BR-002). (b) Raw records are read and written only through a repository bound to one tenant/connection scope, which refuses a row outside it rather than filtering afterwards (SEC-001), and a referenced Business or IngestionRun must itself resolve inside that scope. (c) Raw ingestion persists the source payload verbatim and never writes domain truth: translation into business entities is a separate later path, so a failed translation cannot corrupt the evidence it was derived from. (d) A run records its own counts and terminal state, and a failure is preserved as a DeadLetterRecord naming the failing stage and owner rather than being retried silently. This requirement declares the ingestion substrate only; no scheduler, no translation ACL and no reader surface is in scope.

- **Status:** n/a
- **Surface:** `/api/agent/line-webhook` (api)
- **Code:** `src/app/api/agent/line-webhook/route.js` · `src/modules/project-manager/application/backup-service.js` · `src/platform/integrations/core/contracts.js` · `src/platform/integrations/core/idempotency.js` · `src/platform/integrations/core/integration-registry.js` · `src/platform/integrations/core/raw-ingest-service.js` · `src/platform/integrations/core/raw-record-repository.js` · `src/platform/integrations/providers/line/line-oa-evidence.js` · `src/platform/integrations/providers/line/line-oa-webhook.js`
- **Follows:** BR-002, BR-008, BR-009, BR-011, BR-012, FR-081, NFR-017, SDD-009, SDD-023, SDD-026, SDD-043, SDD-048, SEC-001, SEC-002, SEC-008, SEC-009, SEC-010, SEC-015, docs/domains/integration/features/FR-081-raw-external-ingestion.md
- **Tests:** `tests/integration/agent-webhook-route.test.js` · `tests/integration/backup.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/integration/line-oa-connection-health.test.js` · `tests/integration/line-oa-evidence-convergence.test.js` · `tests/integration/platform/integration-persistence.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/fr079-runtime-cutover.test.js` · `tests/unit/platform/integration-contracts.test.js` · `tests/unit/platform/line-oa-webhook.test.js` · `tests/unit/platform/raw-ingest-service.test.js` · `tests/unit/platform/raw-record-repository-read.test.js`

### FR-082 — Structure editing by direct manipulation: the project Structure Plan becomes editable in place — a `+` affordance on a node adds a child of the type the hierarchy allows at that level, and a node is reparented by drag. An invalid drop target is refused *during* the drag rather than accepted and explained afterwards. Layout stays derived; no node position is persisted (ADR-035 D3). Every drag ships with its single-pointer equivalent in the same change (`Move to…`), because NFR-008 binds WCAG 2.2 AA and SC 2.5.7 *Dragging Movements* is AA.

- **Feature:** FEAT-007 — Pipeline Builder — direct-manipulation structure and edge creation on one canvas, with a mandatory Handoff Contract on every edge and contract-gated release on the Board
- **Status:** planned
- **Code:** —
- **Follows:** —
- **Tests:** —

### FR-083 — Edge creation by direct manipulation: the project Dependency Map becomes the canvas where edges are made. Dragging from a source node's handle to a target node proposes an edge, and **the contract dialog that follows is not skippable** — cancelling it cancels the edge (BR-017). Self-edges and cycles are refused by calling the existing FR-007 rule, never a second implementation, and a refusal renders at the attempted edge with its reason. The canvas keeps its derived layout and its accessible edge-list twin, which is what makes the keyboard equivalent (select source → `Connect to…` → pick target) affordable rather than a second interaction model.

- **Feature:** FEAT-007 — Pipeline Builder — direct-manipulation structure and edge creation on one canvas, with a mandatory Handoff Contract on every edge and contract-gated release on the Board
- **Status:** planned
- **Code:** —
- **Follows:** —
- **Tests:** —

### FR-084 — Handoff Contract on a dependency edge: every `Dependency` carries a declared contract stating the **deliverable** the predecessor owes and the **acceptance** condition that says the debt is paid. Acceptance either references an existing `Gate` — whose status is then the single source of truth (ADR-035 D2) — or carries an explicit satisfied/unsatisfied mark with provenance. Persisted as one nullable JSON column with a Zod schema at the boundary (SDD-008); no new aggregate and no new model ownership, `Dependency` already belonging to the `project-manager` charter. Nullable at rest because rows predating the column exist: the invariant is enforced at the creation surface, and an edge with no contract renders as `contract undeclared` rather than looking complete (ADR-035 D6).

- **Feature:** FEAT-007 — Pipeline Builder — direct-manipulation structure and edge creation on one canvas, with a mandatory Handoff Contract on every edge and contract-gated release on the Board
- **Status:** planned
- **Code:** —
- **Follows:** —
- **Tests:** —

### FR-085 — Contract-gated release on the Board: a WorkItem whose inbound edges carry declared, unsatisfied contracts is **held**, and says so on its own card — naming the predecessor it waits for as a link, before the user attempts the move rather than as a refusal after it. An edge whose contract is `undeclared` (a row predating FR-084) does not hold anything: it is surfaced for backfill, never enforced retroactively, because turning a data-migration gap into a production stoppage is the worse of the two failures.

- **Feature:** FEAT-007 — Pipeline Builder — direct-manipulation structure and edge creation on one canvas, with a mandatory Handoff Contract on every edge and contract-gated release on the Board
- **Status:** planned
- **Code:** —
- **Follows:** —
- **Tests:** —

### FR-086 — Projects Dashboard: the Development `/projects` surface becomes the domain's Dashboard — a KPI band above the resource list — and its sidebar entry is labelled `Dashboard`, the shape every peer domain already has, so that "Overview" keeps meaning exactly one thing in this product (`/overview`, Business Home, FR-060). The band reports Projects by status, WorkItems by status, the **headcount actually working on the in-scope Projects** (distinct `WorkItem.assigneeRef`) and the **team count** from FR-089. The last two are shown as two figures because they answer different questions — people with work assigned, versus Teams attached to Projects — and neither is derivable from the other (ADR-036 D5, ADR-037 D4). Every band figure reconciles with the list beneath it: `PROJECT_STATUSES` has five values and the highlighted three are shown with an explicit account of the remainder rather than a subset that does not sum. The list carries Code · Project Name · Size · Space · Streams · Status · Progress · Target · PIC · Priority, where **Size is defined as the count of non-deleted WorkItems under the Project** (ADR-036 D2) and Progress comes from the existing pure calculators. A `Top 5 Priority Projects` panel orders by FR-087's field and, until priorities are set, renders an empty state saying so rather than substituting a deadline ordering the reader would misread as priority. `New project` becomes this page's primary action and is removed from the Topbar, where it currently duplicates a control the page already has.

- **Feature:** FEAT-008 — Projects Dashboard — a KPI band and enriched Project list for the Development domain, with the priority, accountable-owner and Team entities it needs to be honest
- **Status:** n/a
- **Surface:** `/projects` (page) · `/api/projects/overview` (api)
- **Code:** `prisma/seed.js` · `src/app/(pm)/projects/page.jsx` · `src/app/api/projects/overview/route.js` · `src/components/layouts/Topbar.jsx` · `src/config/domains.js` · `src/config/modules.js` · `src/lib/validation/enums.js` · `src/modules/project-manager/application/projects-dashboard-read-model.js`
- **Follows:** BR-004, BR-009, NFR-007, NFR-008, SDD-002, SDD-012, SDD-018, SDD-021, SDD-032, SDD-045, SDD-047, SEC-001
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/projects-dashboard.test.js` · `tests/integration/xlsx-intake.test.js` · `tests/unit/domain-navigation.test.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/plan-schema.test.js` · `tests/unit/project-list-contract.test.js` · `tests/unit/projects-dashboard-read-model.test.js` · `tests/unit/projects-dashboard-ui.test.js` · `tests/unit/scope-view-context.test.js` · `tests/unit/sidebar-visible-subdomains.test.js` · `tests/unit/topbar-no-dropdown.test.js`

### FR-087 — Project priority: `Project` carries a first-class priority whose values live in `src/lib/validation/enums.js` as the single source of truth every dropdown, OpenAPI document and validator derives from, never hand-copied. Additive and nullable at rest because rows predate the column. It exists because "Top 5 Priority" cannot be derived from anything currently stored — ordering by `targetAt` is a deadline list, and presenting one as the other is worse than not shipping the panel (ADR-036 D3).

- **Feature:** FEAT-008 — Projects Dashboard — a KPI band and enriched Project list for the Development domain, with the priority, accountable-owner and Team entities it needs to be honest
- **Status:** done
- **Surface:** `/projects` (page)
- **Code:** `prisma/seed.js` · `src/app/(pm)/projects/page.jsx` · `src/lib/validation/entities.js` · `src/lib/validation/enums.js` · `src/modules/project-manager/application/project-service.js` · `src/modules/project-manager/components/ProjectModal.jsx`
- **Follows:** BR-001, BR-004, BR-009, NFR-007, NFR-008, SDD-002, SDD-004, SDD-021, SDD-032, SDD-033, SDD-036, SDD-047, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/integration/xlsx-intake.test.js` · `tests/unit/plan-schema.test.js` · `tests/unit/project-list-contract.test.js` · `tests/unit/projects-dashboard-read-model.test.js` · `tests/unit/projects-dashboard-schema-migration.test.js` · `tests/unit/projects-dashboard-ui.test.js`

### FR-088 — Project accountable owner (PIC): `Project` carries one nullable accountable `Person`. This is deliberately neither FR-036 project Team membership — which says who *may work* here, being Business-scoped `Membership` rows — nor `WorkItem.assigneeRef`, which says who does one piece. One accountable name is a third fact, so it is stored rather than inferred from the busiest assignee, an inference that would change whenever work moved (ADR-036 D4).

- **Feature:** FEAT-008 — Projects Dashboard — a KPI band and enriched Project list for the Development domain, with the priority, accountable-owner and Team entities it needs to be honest
- **Status:** done
- **Surface:** `/projects` (page)
- **Code:** `prisma/seed.js` · `src/app/(pm)/projects/page.jsx` · `src/lib/validation/entities.js` · `src/modules/project-manager/application/project-service.js` · `src/modules/project-manager/components/ProjectModal.jsx`
- **Follows:** BR-001, BR-004, NFR-007, NFR-008, SDD-004, SDD-021, SDD-033, SDD-036, SDD-047, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/fr072-project-service-authorization.test.js` · `tests/integration/project-business-binding.test.js` · `tests/integration/project-core.test.js` · `tests/unit/project-list-contract.test.js` · `tests/unit/projects-dashboard-read-model.test.js` · `tests/unit/projects-dashboard-schema-migration.test.js` · `tests/unit/projects-dashboard-ui.test.js`

### FR-089 — Team as an organisational grouping: three additive Business-scoped models — `Team`, `TeamMembership` (Person ↔ Team) and `ProjectTeam` (many-to-many, because a Project is worked by several Teams and a Team works several Projects). A Team records who works together and **grants nothing**: the identity resolver does not read it, no route guard consults it, and adding a Person to a Team changes no role, no domain grant and no visible or owned Business (BR-018, ADR-037 D1). `TeamMembership` is deliberately separate from `Membership` — the same distinct-authority-layer discipline BR-016 applies to `WorkspaceMembership` — because `Membership` is the authority record `resolveViewer` reads, and merging grouping into it is how an unauthenticated POST minted business-owner authority on 2026-08-17. Work stays assigned to a Person (`WorkItem.assigneeRef`), never to a Team (ADR-037 D4). FR-036's existing "project Team" tab is untouched and its reconciliation with this entity is deferred deliberately (ADR-037 D5).

- **Feature:** FEAT-008 — Projects Dashboard — a KPI band and enriched Project list for the Development domain, with the priority, accountable-owner and Team entities it needs to be honest
- **Status:** done
- **Surface:** `/projects` (page) · `/api/projects/[id]/teams` (api) · `/api/teams/[id]/members` (api) · `/api/teams/[id]` (api) · `/api/teams` (api)
- **Code:** `prisma/seed.js` · `src/app/(pm)/projects/page.jsx` · `src/app/api/projects/[id]/teams/route.js` · `src/app/api/teams/[id]/members/route.js` · `src/app/api/teams/[id]/route.js` · `src/app/api/teams/route.js` · `src/modules/project-manager/application/backup-service.js` · `src/modules/project-manager/application/team-service.js`
- **Follows:** BR-002, BR-008, BR-018, FR-072, NFR-007, NFR-008, SDD-023, SDD-047, SEC-001, SEC-008
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/smoke.spec.js` · `tests/integration/backup.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/integration/fr089-team-scope.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/fr089-br018-team-grants-nothing.test.js` · `tests/unit/projects-dashboard-schema-migration.test.js` · `tests/unit/projects-dashboard-ui.test.js`

### FR-090 — Schema declaration for the live production-auth tables: `PersonCredential`, `PasswordResetToken` and `Workstream.laneId` exist on the Supabase database — `PersonCredential` with a real credential row and `laneId` with a distinct value on every Workstream — but existed in no committed schema, having been pushed there from the unmerged branch `codex/postgres-primary-runtime`. This requirement declares their shape so the schema describes the database that exists. It is deliberately **declaration only**: no service, route or UI is in scope, and the feature code remains on that branch. The reason it cannot wait for that branch to merge is that `prisma migrate diff` proposes `DROP TABLE "PersonCredential"` against an undeclared table, so any routine `db push` destroys a live credential without the operator reading the SQL. Registering the tables here removes the destructive suggestion without deciding the feature's fate. **Resolution (2026-08-26):** the branch was never merged and no longer needs to be — `main` grew its own superior implementations of everything it held (`PersonCredential` login/logout via FR-046/FR-095; password reset via FR-104, reimplemented rather than revived because the draft returned the raw reset token to the unauthenticated caller). Its FR-082/FR-083 claims stay burnt on the pipeline canvas. The branch is deleted; `Workstream.laneId` remains declared-only.

- **Status:** n/a
- **Code:** `src/modules/project-manager/application/backup-service.js`
- **Follows:** BR-008, SDD-023, SEC-008
- **Tests:** `tests/integration/backup.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/unit/fr045-backup-contract.test.js`

### FR-091 — CRM Conversation Inbox — the reader surface for the LINE ingress. `Customer`, `Conversation` and `Message` have been written by the FR-023 ingest seam since the first LINE turn, and FR-081 declared in as many words that **no reader surface was in scope** — so every message this product has ever received is invisible to the operator whose business received it. This requirement adds that surface and nothing else. `GET /api/crm/conversations` returns one authorized, read-only list (customer, channel, message count, last-message preview and time, owning-Business label); `GET /api/crm/conversations/{id}` returns one thread with its messages oldest-first and the customer behind it. Scope follows **BR-001, not the shell**: the CRM is tenant-shared, so the list is the Tenant of the selected Business, restricted to conversations whose `businessId` is null (tenant-shared — which is what an unbound LINE binding writes, and therefore the common case) or a Business this viewer can already see. A viewer is never handed a conversation belonging to a Business they could not open. The `customer` domain slot leaves `soon` and gains `/customer` (Dashboard) and `/customer/conversations` (Inbox). It **writes nothing**: no reply box, no status transition, no read-receipt. Replying is BR-011 territory and belongs to the edge runtime that owns the reply — a console that could also reply would make two reply owners, which is the one thing BR-011 exists to prevent. `Conversation.status` is displayed as stored and no enum is declared for it, because nothing in this slice writes it.

- **Feature:** FEAT-009 — CRM Conversation Inbox — the first reader surface over the LINE ingress, and the delivery receipt that makes it show both sides of a conversation rather than only what the customer said
- **Status:** done
- **Surface:** `/customer/conversations` (page) · `/customer` (page) · `/api/crm/conversations/[id]` (api) · `/api/crm/conversations` (api)
- **Code:** `src/app/(pm)/customer/conversations/page.jsx` · `src/app/(pm)/customer/page.jsx` · `src/app/api/crm/conversations/[id]/route.js` · `src/app/api/crm/conversations/route.js` · `src/config/domains.js` · `src/modules/crm/conversation-read-model.js`
- **Follows:** BR-001, BR-011, SDD-007, SDD-018, SDD-050, SDD-053, SEC-001, SEC-005, SEC-009
- **Tests:** `tests/e2e/fr041-business-first.spec.js` · `tests/e2e/fr060-business-home.spec.js` · `tests/e2e/fr091-conversation-inbox.spec.js` · `tests/integration/crm-conversation-inbox.test.js` · `tests/integration/crm-customer-consent.test.js` · `tests/integration/line-reply-record.test.js` · `tests/unit/command-palette-index.test.js` · `tests/unit/conversation-read-model.test.js` · `tests/unit/domain-navigation.test.js` · `tests/unit/fr045-api-ui-contract.test.js` · `tests/unit/fr091-inbox-ui-contract.test.js`

### FR-092 — Market translation core: an eligible Integration-owned `RawExternalRecord` is loaded through a trusted scoped read port and translated into one provider-neutral Market-owned `MarketObservation`. Source adapters may extract candidate fields but cannot author trusted scope/lineage. Canonical Product/Category resolution is delegated to governed Knowledge/GKS and unresolved identity remains a valid state.

- **Status:** n/a
- **Code:** `src/modules/market-intelligence/application/market-observation-service.js` · `src/modules/project-manager/application/backup-service.js`
- **Follows:** BR-008, BR-019, SDD-023, SDD-049, SEC-008, SEC-017
- **Tests:** `tests/integration/backup.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/integration/market-intelligence-persistence.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/market-intelligence-schema-migration.test.js`

### FR-093 — LINE reply delivery receipt: the outbound half of a conversation becomes a row. Nothing has ever written a `Message` with `direction: 'OUTBOUND'` — the reply is assembled here, handed to the edge runtime, sent to the customer and then forgotten — so FR-091's inbox shows one side of every conversation and its `OUTBOUND` count is structurally zero. `POST /api/agent/line-delivery` accepts a batch of receipts from the transport owner, each naming the **inbound `Message.id` it answers** and the text that was **actually sent**. (a) The receipt comes from the edge runtime *after* a successful send and not from this side at hand-over, because the two differ: when the stack cannot answer, the transport sends its own fallback text, and recording what this side produced would record a message the customer never received (BR-011 — the reply owner is the one who knows). (b) Scope is resolved by the same seam as the webhook (FR-052), and the named inbound message must resolve inside that scope — a binding for one tenant can never attach a reply to another tenant's conversation (SEC-001). (c) Idempotent on `reply:<inboundMessageId>` as the message's external id, so a redelivered receipt resolves to the existing row: one inbound message has one reply, which is exactly what the LINE Reply API allows per token. (d) The row records the text the customer received; whether it came from the stack or from the transport's fallback is recorded on the audit event, not in the body, because the body is what was said and the provenance is a different fact. The webhook response gains `conversationId` and `inboundMessageId` so the transport has something to name — on the **failure** result as well as the success one, because a failed turn is precisely when the transport substitutes its own text and a customer certainly received something. That failure result also gains the `eventId` it never carried: the transport matches results to events by that field, so a failed result was previously unfindable and its fallback was sent only because an unmatched result and a failed one both read as "not ok". All additive; the four fields the transport already reads are untouched.

- **Feature:** FEAT-009 — CRM Conversation Inbox — the first reader surface over the LINE ingress, and the delivery receipt that makes it show both sides of a conversation rather than only what the customer said
- **Status:** done
- **Surface:** `/api/agent/line-delivery` (api) · `/api/agent/line-webhook` (api)
- **Code:** `src/app/api/agent/line-delivery/route.js` · `src/app/api/agent/line-webhook/route.js` · `src/modules/agent/turn.js` · `src/modules/crm/reply-record-service.js`
- **Follows:** BR-011, BR-012, BR-020, FR-052, NFR-017, SDD-026, SDD-048, SDD-051, SEC-001, SEC-010, SEC-018
- **Tests:** `tests/integration/agent-turn.test.js` · `tests/integration/agent-webhook-route.test.js` · `tests/integration/line-oa-evidence-convergence.test.js` · `tests/integration/line-reply-record.test.js` · `tests/integration/line-webhook-transport-contract.test.js` · `tests/unit/reply-record-service.test.js`

### FR-094 — Canonical IAM principal: every trusted provider, credential or channel identity resolves to one internal `Person` through a namespaced external binding; unknown, revoked, ambiguous or duplicate subjects never receive private authority, and only active Membership/RoleBinding records contribute to scope or permission.

- **Feature:** FEAT-010 — Production Identity & Access Management — canonical Person/channel identity, persisted sessions, active Membership lifecycle, shared policy enforcement and agent/tool scope isolation
- **Status:** n/a
- **Code:** `src/modules/identity/authorization-context.js`
- **Follows:** BR-020, SDD-052, SEC-018
- **Tests:** `tests/integration/iam-authorization.test.js` · `tests/unit/authorization-context.test.js` · `tests/unit/canonical-iam-migration.test.js` · `tests/unit/canonical-iam-runtime-role-cutover.test.js`

### FR-095 — Persisted session lifecycle: successful login creates a revocable Session bound to Person with an opaque-token hash; every protected request checks live status and expiry, and logout, Person erasure, Membership suspension or explicit revocation denies the next request.

- **Feature:** FEAT-010 — Production Identity & Access Management — canonical Person/channel identity, persisted sessions, active Membership lifecycle, shared policy enforcement and agent/tool scope isolation
- **Status:** n/a
- **Surface:** `/api/auth/logout` (api)
- **Code:** `src/app/api/auth/logout/route.js` · `src/modules/identity/auth-service.js` · `src/modules/identity/erase-principal.js` · `src/modules/identity/session-port.js` · `src/modules/project-manager/application/backup-service.js`
- **Follows:** BR-008, SDD-023, SDD-024, SDD-052, SEC-003, SEC-008, SEC-018
- **Tests:** `tests/integration/backup.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/integration/identity-erase.test.js` · `tests/integration/password-reset-flow.test.js` · `tests/unit/auth-service.test.js` · `tests/unit/canonical-iam-migration.test.js` · `tests/unit/canonical-iam-runtime-role-cutover.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/fr046-auth-route.test.js` · `tests/unit/fr046-session-port.test.js` · `tests/unit/iam-session.test.js` · `tests/unit/password-reset-service.test.js`

### FR-096 — Shared policy enforcement: Web/API requests, agent turns, actions and tools resolve trusted principal, scope, membership and permission before protected work; payload, prompt, model output and tool arguments cannot widen server-owned authority.

- **Feature:** FEAT-010 — Production Identity & Access Management — canonical Person/channel identity, persisted sessions, active Membership lifecycle, shared policy enforcement and agent/tool scope isolation
- **Status:** n/a
- **Code:** `src/modules/agent/action-gate.js` · `src/modules/agent/auth-context.js` · `src/modules/agent/context.js` · `src/modules/agent/tools.js` · `src/modules/identity/authorization-context.js` · `src/modules/identity/session-port.js`
- **Follows:** BR-009, BR-015, BR-020, SDD-009, SDD-024, SDD-030, SDD-052, SEC-008, SEC-013, SEC-018
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/integration/agent-multi-principal.test.js` · `tests/integration/agent-tools.test.js` · `tests/integration/iam-authorization.test.js` · `tests/unit/authorization-context.test.js` · `tests/unit/canonical-iam-migration.test.js` · `tests/unit/canonical-iam-runtime-role-cutover.test.js` · `tests/unit/fr046-session-port.test.js` · `tests/unit/iam-session.test.js`

### FR-097 — Verified channel onboarding: a valid LINE signature proves transport origin only; a new channel subject remains pending until server-owned linking/onboarding and active Membership authorize private data or staff capability.

- **Feature:** FEAT-010 — Production Identity & Access Management — canonical Person/channel identity, persisted sessions, active Membership lifecycle, shared policy enforcement and agent/tool scope isolation
- **Status:** n/a
- **Surface:** `/api/agent/line-webhook` (api)
- **Code:** `src/app/api/agent/line-webhook/route.js` · `src/modules/agent/auth-context.js` · `src/modules/agent/line-binding-resolver.js` · `src/modules/agent/line-channel-binding.js` · `src/modules/agent/turn.js` · `src/modules/crm/line-ingest-service.js` · `src/modules/identity/channel-identity.js` · `src/modules/identity/link-line-identity.js` · `src/modules/identity/resolve-line-identity.js`
- **Follows:** BR-001, BR-002, BR-011, BR-012, BR-015, BR-020, NFR-017, SDD-026, SDD-030, SDD-048, SDD-052, SEC-001, SEC-010, SEC-013, SEC-018
- **Tests:** `tests/integration/agent-multi-principal.test.js` · `tests/integration/agent-turn.test.js` · `tests/integration/agent-webhook-route.test.js` · `tests/integration/channel-identity.test.js` · `tests/integration/identity-link.test.js` · `tests/integration/identity-resolve.test.js` · `tests/integration/line-ingest.test.js` · `tests/integration/line-oa-evidence-convergence.test.js` · `tests/unit/canonical-iam-migration.test.js` · `tests/unit/canonical-iam-runtime-role-cutover.test.js` · `tests/unit/line-binding-resolver.test.js` · `tests/unit/line-channel-binding.test.js`

### FR-098 — Agent/tool/MSP authorization: every retrieval, action and tool call consumes the immutable shared authorization context, uses only server-resolved resource/vault identifiers, audits denial without secrets or customer content, and fails closed before side effects.

- **Feature:** FEAT-010 — Production Identity & Access Management — canonical Person/channel identity, persisted sessions, active Membership lifecycle, shared policy enforcement and agent/tool scope isolation
- **Status:** n/a
- **Code:** `src/modules/agent/action-gate.js` · `src/modules/agent/auth-context.js` · `src/modules/agent/context.js` · `src/modules/agent/tools.js` · `src/modules/identity/authorization-context.js`
- **Follows:** BR-009, BR-015, BR-020, SDD-009, SDD-030, SDD-052, SEC-013, SEC-018
- **Tests:** `tests/integration/agent-action-gate.test.js` · `tests/integration/agent-context.test.js` · `tests/integration/agent-multi-principal.test.js` · `tests/integration/agent-tools.test.js` · `tests/integration/iam-authorization.test.js` · `tests/unit/authorization-context.test.js` · `tests/unit/canonical-iam-migration.test.js` · `tests/unit/canonical-iam-runtime-role-cutover.test.js`

### FR-099 — SoT pipeline plan board: the business-wide Source-of-Truth pipeline's phase plan (P0–P10) lives as strict-validated data (`contracts/sot-pipeline-plan.v1.json`) and is rendered at `/platform/sot-pipeline` with status **derived** from FR-071 run evidence plus FR-100 pending-decision counts — `planned/running/blocked/done` is computed by a pure function, never typed in, so the board cannot disagree with the tracking data it reads. Reader surface only; the plan file changes by PR.

- **Feature:** FEAT-011 — SoT Pipeline Console — plan board, human approval inbox with pull-based decision export, and a node/edge status graph for the business-wide Source-of-Truth pipeline
- **Status:** done
- **Surface:** `/platform/sot-pipeline` (page) · `/api/platform/sot/plan` (api)
- **Code:** `src/app/(pm)/platform/sot-pipeline/page.jsx` · `src/app/api/platform/sot/plan/route.js` · `src/modules/integration/application/sot-pipeline-graph.js` · `src/modules/integration/application/sot-plan-service.js` · `src/modules/integration/application/sot-plan.js`
- **Follows:** FR-099, FR-101, SEC-002
- **Tests:** `tests/unit/sot-pipeline-graph.test.js` · `tests/unit/sot-plan-board-ui.test.js` · `tests/unit/sot-plan-service.test.js` · `tests/unit/sot-plan-status.test.js`

### FR-100 — SoT approval inbox and decision export: one tenant/business-scoped `SotDecision` queue (PRICE_ROW, ENTITY, FILE_CLASSIFICATION, PHASE_GATE) that the external data plane **submits** into (idempotent batch, `.strict()` envelope, payload-hash versioning), a human **decides** in the browser (audited, immutable rows, new version to change a decision), and the data plane **pulls** from (`export?since=` cursor) to apply approved facts to its own DuckDB/graph stores — zuri-ai never writes into the retrieval substrate, keeping Tier 1 inside the ADR-043 boundary during the Boss-approved `:8888` interim. Closes the open loop where approvals in `price_approval.csv` reached nothing (17,702 staged price rows, 0 approved in store).

- **Feature:** FEAT-011 — SoT Pipeline Console — plan board, human approval inbox with pull-based decision export, and a node/edge status graph for the business-wide Source-of-Truth pipeline
- **Status:** n/a
- **Surface:** `/platform/sot-pipeline/inbox` (page) · `/api/platform/sot/decisions/[decisionId]/decide` (api) · `/api/platform/sot/decisions/export` (api) · `/api/platform/sot/decisions` (api)
- **Code:** `src/app/(pm)/platform/sot-pipeline/inbox/page.jsx` · `src/app/api/platform/sot/decisions/[decisionId]/decide/route.js` · `src/app/api/platform/sot/decisions/export/route.js` · `src/app/api/platform/sot/decisions/route.js` · `src/modules/integration/application/sot-decision-service.js` · `src/modules/project-manager/application/backup-service.js`
- **Follows:** BR-002, BR-008, FR-100, FR-102, SDD-023, SEC-002, SEC-008
- **Tests:** `tests/integration/backup.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/integration/sot-decisions-route.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/sot-data-plane-auth.test.js` · `tests/unit/sot-decision-migration.test.js` · `tests/unit/sot-decision-service.test.js` · `tests/unit/sot-inbox-ui.test.js`

### FR-101 — SoT pipeline graph dashboard: `/platform/sot-pipeline/graph` renders the FR-099 plan as read-only nodes and edges (hand-rolled SVG, topological layers, no client graph library) using the same `{nodes, edges}` data shape as FR-040's dependency map, with FR-099's derived status as node state and per-phase pending-decision badges linking into the FR-100 inbox. One API payload feeds both surfaces.

- **Feature:** FEAT-011 — SoT Pipeline Console — plan board, human approval inbox with pull-based decision export, and a node/edge status graph for the business-wide Source-of-Truth pipeline
- **Status:** done
- **Surface:** `/platform/sot-pipeline/graph` (page) · `/api/platform/sot/plan` (api)
- **Code:** `src/app/(pm)/platform/sot-pipeline/graph/page.jsx` · `src/app/api/platform/sot/plan/route.js` · `src/modules/integration/application/sot-pipeline-graph.js` · `src/modules/integration/application/sot-plan-service.js`
- **Follows:** FR-099, FR-101
- **Tests:** `tests/unit/sot-pipeline-graph.test.js` · `tests/unit/sot-plan-service.test.js`

### FR-102 — SoT data-plane service-account authentication: a `SotDataPlaneKey` bound to exactly one Tenant lets the SoT pipeline's external data plane authenticate to the FR-100 submit/export endpoints (`Authorization: Bearer sdpk_...`) without a browser session and without installation-operator authority. Revocation takes effect on the next request; the raw secret is never persisted, only its SHA-256 hash.

- **Status:** n/a
- **Code:** `src/modules/identity/sot-data-plane-auth.js` · `src/modules/integration/application/sot-decision-service.js` · `src/modules/project-manager/application/backup-service.js`
- **Follows:** BR-002, BR-008, FR-100, FR-102, SDD-023, SEC-002, SEC-008, SEC-019
- **Tests:** `tests/integration/backup.test.js` · `tests/integration/fr075-restore-authorization.test.js` · `tests/integration/sot-decisions-route.test.js` · `tests/unit/fr045-backup-contract.test.js` · `tests/unit/mint-sot-data-plane-key-cli.test.js` · `tests/unit/sot-data-plane-auth.test.js` · `tests/unit/sot-data-plane-key-migration.test.js` · `tests/unit/sot-decision-service.test.js` · `tests/unit/viewer-authority.test.js`

### FR-103 — SEC-005 PDPA consent, MVP scope: a Business owner attests in the CRM console that a Customer's consent was captured (`GRANTED`/`DECLINED`), recorded with timestamp and attesting Person on the Customer row FR-023 already treats as the CRM-sharing unit. Every Customer created from here on defaults to `PENDING`; rows that predate this column backfill to `GRANDFATHERED` rather than being retroactively blocked. Closes ethics-governance.md's open question #4 only — it does not gate AI processing, redact model input, or answer retention/provider-terms (#1, #2, #3, #6), which stay open.

- **Status:** n/a
- **Surface:** `/customer/conversations` (page) · `/api/crm/customers/[customerId]/consent` (api)
- **Code:** `src/app/(pm)/customer/conversations/page.jsx` · `src/app/api/crm/customers/[customerId]/consent/route.js` · `src/modules/crm/conversation-read-model.js` · `src/modules/crm/customer-consent-service.js`
- **Follows:** BR-001, BR-011, SDD-007, SDD-048, SDD-050, SDD-053, SEC-001, SEC-005, SEC-009
- **Tests:** `tests/e2e/fr091-conversation-inbox.spec.js` · `tests/integration/crm-conversation-inbox.test.js` · `tests/integration/crm-customer-consent.test.js` · `tests/unit/conversation-read-model.test.js` · `tests/unit/crm-customer-consent-route.test.js` · `tests/unit/customer-consent-migration.test.js` · `tests/unit/customer-consent-service.test.js` · `tests/unit/fr091-inbox-ui-contract.test.js` · `tests/unit/sot-decision-service.test.js`

### FR-104 — Owner-assisted password reset: a Business owner over a Business the target Person belongs to — the same authority boundary as FR-038 Membership administration — or the installation operator mints a single-use, one-hour, hash-bound reset token (`POST /api/platform/users/password-resets`), and the public `POST /api/auth/reset-password` consumes it: new `PersonCredential`, token burnt, **every active Session revoked**. The raw token appears exactly once, in the authenticated mint response, for out-of-band handover (LINE, in person); it is stored only as a SHA-256 digest and never logged or audited in any form. There is deliberately no public forgot-password route: with no mail transport, such a route either returns the token to the unauthenticated caller — an account-takeover primitive, which is what the abandoned FR-082 draft on `codex/postgres-primary-runtime` shipped and the reason it was not revived as-is — or returns nothing and resets nothing. Uses the `PasswordResetToken` table FR-090 declared (its `token` column now carries the digest).

- **Status:** done
- **Surface:** `/api/auth/reset-password` (api) · `/api/platform/users/password-resets` (api)
- **Code:** `src/app/api/auth/reset-password/route.js` · `src/app/api/platform/users/password-resets/route.js` · `src/modules/identity/auth-service.js`
- **Follows:** SDD-024, SDD-052, SDD-054, SEC-008, SEC-014, SEC-018
- **Tests:** `tests/integration/password-reset-flow.test.js` · `tests/unit/auth-service.test.js` · `tests/unit/fr046-auth-route.test.js` · `tests/unit/iam-session.test.js` · `tests/unit/password-reset-routes.test.js` · `tests/unit/password-reset-service.test.js`

### FR-105 — Platform Programme Roadmap: `/control/roadmap` is an installation-operator-only, read-only projection of the submitted 24-week programme. It is deliberately outside BusinessShell and `DOMAINS`: there is no active Business, Tenant, Project or Workstream scope, and the surface must not be mistaken for a user's operational work. A missing viewer follows the entry boundary; a trusted viewer is admitted only by the named `isOperator` capability from FR-075 — never by `isPlatform`, role, Business/Tenant ownership or domain visibility. The board is a static plan snapshot re-projected from ROADMAP-ZURI-AI-24W-PROGRAM's own frontmatter and tables (currently v0.3.0, baseline 7d8c9d0), carrying the document's `draft` status. It makes no write, persists no progress, exposes no API and never turns commit activity into programme completion. Declared as FR-105 rather than the branch's original FR-094, which main's canonical IAM slice claimed first (AGENTS.md §18 — the later declaration renumbers).

- **Status:** done
- **Surface:** `/control/roadmap` (page)
- **Code:** `src/app/(control)/control/roadmap/page.jsx` · `src/app/(control)/layout.jsx` · `src/components/layouts/PlatformControlGuard.jsx` · `src/components/layouts/PlatformControlShell.jsx` · `src/lib/platform-control-guard.js` · `src/modules/platform-control/components/ProgramRoadmapBoard.jsx` · `src/modules/platform-control/program-roadmap-data.js`
- **Follows:** NFR-008, SDD-055, SEC-020
- **Tests:** `tests/unit/platform-control-guard.test.js` · `tests/unit/platform-control-route-contract.test.js`

### FR-106 — Enterprise API tenant token authentication: the FR-019 Enterprise API refuses every request that does not present a valid per-Tenant service-account key, generalizing the FR-102 pattern (ADR-047 D3 deliberately scoped its `SotDataPlaneKey` to the two SoT routes and named this generalization as the follow-up) rather than inventing a second mechanism: an `ApiAccessKey` bound to exactly one Tenant, presented as `Authorization: Bearer`, stored only as a SHA-256 digest, minted by an installation operator or an owner in that Tenant with the raw secret shown exactly once, revocable with effect on the next request, and never readable back. Scope on every request is the key's own Tenant — a key can never widen the ExternalRef/upsert surface beyond the Tenant it names (SEC-001, BR-002), and an invalid, revoked or missing key answers identically so the endpoint is not an enumeration oracle. This closes SEC-006, which has held the Enterprise API in a declared-but-unenforced state since ADR-047 recorded that "no API-key mechanism exists anywhere in zuri-ai".

- **Status:** planned
- **Code:** —
- **Follows:** —
- **Tests:** —
