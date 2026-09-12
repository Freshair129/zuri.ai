import { z } from 'zod'
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { zPlanEnvelope, zExternalRef } from '../import/plan-schema'
import { zDomainRow, zDomainViewError, zProjectDomainView } from '../application/project-domain-read-model'
import {
  zFeatureReadError, zFeatureView, zFeatureRecord, zDeletedFeatureRecord,
  zFeatureRecordPage, zGovernanceSnapshotMetadata, zGovernanceSnapshotPage,
} from '../application/project-feature-read-model'
import {
  zFeatureCreateInput, zFeaturePatchInput, zContributionInput, zContributionsReplaceInput,
  zWorkLinkInput, zWorkLinksReplaceInput, zFeatureWorkSet, zFeatureWorkGraphInput,
  zRequirementBindingInput, zRequirementBindingsReplaceInput, zMutationReceipt, zMutationError,
} from '../application/project-feature-service'
import {
  zSourceManifestEntry, zSourceManifest, zCaptureSnapshotInput,
  zGovernanceVerificationProof, zGovernanceSnapshot,
} from '../application/governance-source-verifier'
import { zSnapshotCaptureResult } from '../application/governance-snapshot-service'
import { EXECUTION_MODES, PROGRESS_STRATEGIES } from '@/lib/validation/enums'
import { zAssetIntakeEnvelope } from '@/modules/asset-management/domain/asset-intake'
import { AUTH_SESSION_COOKIE } from '@/modules/identity/auth-service'
import { zApiWriteCsrfToken, zApiWriteCsrfError } from '@/modules/identity/api-write-csrf'

// @req FR-019 — OpenAPI 3 generated FROM the Zod schemas that actually run at
// request time, so the integration docs cannot drift from validation.
// @spec docs/features/FR-019-enterprise-api.md
// @tested tests/integration/openapi-docs.test.js

extendZodWithOpenApi(z)

const FEATURE_MUTATIONS = [
  { method: 'post', path: '/api/projects/{id}/features', operationId: 'createProjectFeature', schema: zFeatureCreateInput, summary: 'Create a Project Feature draft', create: true },
  { method: 'patch', path: '/api/projects/{id}/features/{featureId}', operationId: 'updateProjectFeature', schema: zFeaturePatchInput, summary: 'Edit Feature fields and lifecycle', cas: true },
  { method: 'put', path: '/api/projects/{id}/features/{featureId}/contributions', operationId: 'replaceProjectFeatureContributions', schema: zContributionsReplaceInput, summary: 'Replace supporting Domain contributions', cas: true },
  { method: 'put', path: '/api/projects/{id}/features/{featureId}/work-links', operationId: 'replaceProjectFeatureWorkLinks', schema: zWorkLinksReplaceInput, summary: 'Replace one Feature WorkItem relationship set', cas: true },
  { method: 'put', path: '/api/projects/{id}/feature-work-links', operationId: 'redistributeProjectFeatureWorkLinks', schema: zFeatureWorkGraphInput, summary: 'Replace named Feature WorkItem sets atomically', cas: true },
  { method: 'put', path: '/api/projects/{id}/features/{featureId}/requirement-bindings', operationId: 'replaceProjectFeatureRequirementBindings', schema: zRequirementBindingsReplaceInput, summary: 'Replace verified requirement revision bindings', cas: true },
  { method: 'delete', path: '/api/projects/{id}/features/{featureId}', operationId: 'deleteProjectFeature', summary: 'Soft-delete one Feature and its active relationship cohort', cas: true },
  { method: 'post', path: '/api/projects/{id}/features/{featureId}/restore', operationId: 'restoreProjectFeature', summary: 'Restore the matching Feature deletion cohort', cas: true },
  { method: 'post', path: '/api/projects/{id}/governance-snapshots', operationId: 'captureProjectGovernanceSnapshot', schema: zCaptureSnapshotInput, summary: 'Capture server-verified bound-commit evidence', create: true, capture: true },
]

// This is the machine-readable mirror of the current Next route tree. The
// integration test enumerates src/app/api/**/route.js and fails when this
// inventory or the generated document falls behind a route change.
export const CURRENT_API_ROUTE_INVENTORY = [
  // @req FR-252 — Identity-owned session-bound API-write CSRF issuance.
  ['/api/auth/csrf', ['GET']],
  ['/api/projects/{id}/feature-view', ['GET']],
  ['/api/projects/{id}/features', ['GET', 'POST']],
  ['/api/projects/{id}/features/{featureId}', ['GET', 'PATCH', 'DELETE']],
  ['/api/projects/{id}/features/{featureId}/contributions', ['PUT']],
  ['/api/projects/{id}/features/{featureId}/work-links', ['PUT']],
  ['/api/projects/{id}/features/{featureId}/requirement-bindings', ['PUT']],
  ['/api/projects/{id}/features/{featureId}/restore', ['POST']],
  ['/api/projects/{id}/feature-work-links', ['PUT']],
  ['/api/projects/{id}/governance-snapshots', ['GET', 'POST']],
  // @req FR-253 — private Commerce rules and explicit sell-side admission.
  ['/api/commerce/pricing-rules', ['GET', 'POST']],
  ['/api/commerce/pricing-rules/{id}', ['PATCH']],
  ['/api/commerce/pricing-rules/{id}/actions', ['POST']],
  ['/api/commerce/pricing-rules/preview', ['POST']],
  ['/api/commerce/pricing-rules/calculate', ['POST']],
  ['/api/commerce/pricing-rules/catalog', ['POST']],
  // @req FR-173 — shared source admission and scoped corpus retrieval.
  ['/api/knowledge/ingestions', ['GET', 'POST']], ['/api/knowledge/ingestions/{runId}', ['GET']],
  ['/api/knowledge/queries', ['POST']], ['/api/knowledge/citations/{citationId}', ['GET']],
  // @req FR-254 — enumerate the Console read contracts alongside existing admission.
  ['/api/knowledge/sources/{sourceId}', ['GET', 'DELETE']],
  ['/api/knowledge/sources', ['GET']], ['/api/knowledge/console/runs', ['GET']],
  ['/api/knowledge/console/runs/{executionRunId}', ['GET']],
  ['/api/knowledge/corpora', ['GET']], ['/api/knowledge/corpora/{corpusId}/generations', ['GET']],
  ['/api/knowledge/citations/{citationId}/artifact', ['GET']],
  // @req FR-236 — LINE FAQ knowledge candidates (ADR-090 D6).
  ['/api/knowledge/candidates', ['GET', 'POST']], ['/api/knowledge/candidates/{id}', ['GET', 'PATCH']],
  ['/api/knowledge/candidates/{id}/decision', ['POST']],
  // @req FR-237 — LINE knowledge gap report (ADR-090 D7).
  ['/api/knowledge/gap-report', ['GET']],
  // @req FR-159, FR-158 — Business-scoped Strategy lifecycle and PM handoff.
  ['/api/growth/plans', ['GET', 'POST']], ['/api/growth/plans/{id}', ['GET', 'PATCH']],
  ['/api/growth/plans/{id}/handoff', ['POST']],
  ['/api/growth/campaigns', ['GET', 'POST']], ['/api/growth/campaigns/{id}', ['GET', 'PATCH']],
  // @req FR-161 — one Operations aggregate, audited Intake mutations and
  // read-only handoff detail.
  ['/api/growth/operations', ['GET', 'POST']], ['/api/growth/operations/intake/{intakeId}', ['GET', 'PATCH']],
  ['/api/growth/operations/handoffs/{handoffId}', ['GET']],
  // @req FR-157 — scoped Content lifecycle and owner reference choices.
  ['/api/growth/content', ['GET', 'POST']], ['/api/growth/content/briefs/{id}', ['GET', 'PATCH']],
  ['/api/growth/content/assets/{id}', ['GET']], ['/api/growth/content/references', ['GET']],
  // @req FR-185 — Business-scoped broadcast planning identities and
  // read-only Marketing projections. These handlers never send to a provider.
  ['/api/growth/ask-marketing', ['POST']],
  ['/api/growth/broadcast-intents', ['GET', 'POST']], ['/api/growth/broadcast-intents/{id}', ['GET', 'PATCH']],
  ['/api/growth/paid-media', ['GET']],
  // @req FR-149, FR-150 — ADR-061 native ingress and optional executor.
  ['/api/line-oa/accounts/{id}/webhook', ['POST']], ['/api/line-oa/accounts/{id}/jobs', ['GET']],
  ['/api/line-oa/accounts/{id}/transport-health', ['GET']],
  ['/api/line-oa/worker', ['POST']], ['/api/line-oa/connections', ['POST']],
  // @req FR-223, FR-224 — write-only credential rotation, revocation and live
  // validation (ADR-089); nothing they answer carries material.
  ['/api/line-oa/connections/{id}/credential', ['POST']],
  ['/api/line-oa/connections/{id}/credential/revoke', ['POST']],
  ['/api/line-oa/connections/{id}/credential/validate', ['POST']],
  ['/api/line-oa/jobs/{id}/acknowledge-unknown', ['POST']],
  ['/api/line-oa/jobs/{id}/trace', ['GET']],
  ['/api/line-oa/jobs/failures', ['GET']],
  ['/api/edge/conversation-jobs/claim', ['POST']],
  ['/api/edge/conversation-jobs/{id}/context', ['POST']], ['/api/edge/conversation-jobs/{id}/tools', ['POST']],
  ['/api/edge/conversation-jobs/{id}/complete', ['POST']], ['/api/edge/conversation-jobs/{id}/fail', ['POST']],
  // @req FR-244 — the identity-free residency poll (ADR-061, ADR-094 D6 option A).
  ['/api/edge/model-residency', ['POST']],
  // @req FR-143, FR-144 — the edge-executed extraction surface: three
  // owner-governed credential operations on the Platform side, four
  // device-authenticated job operations, and the review surface's job read.
  ['/api/platform/edge-devices/credentials', ['GET', 'POST']], ['/api/platform/edge-devices/credentials/{id}', ['DELETE']],
  // @req FR-144 — expiring browser approval and one-use Desktop credential handover.
  ['/api/edge/pairing/start', ['POST']], ['/api/edge/pairing/approve', ['POST']], ['/api/edge/pairing/poll', ['POST']],
  ['/api/edge/extraction-jobs/claim', ['POST']], ['/api/edge/extraction-jobs/{id}/evidence', ['GET']],
  ['/api/edge/extraction-jobs/{id}/complete', ['POST']], ['/api/edge/extraction-jobs/{id}/fail', ['POST']],
  ['/api/assets/evidence/{id}/extraction-job', ['GET']],
  // @req FR-146 — LINE OA Studio accounts: list/connect on the collection,
  // read and versioned actions (pause, resume, archive, set default, switch
  // transport mode) on the item. Archive is a PATCH action, never a DELETE.
  ['/api/line-oa/accounts', ['GET', 'POST']], ['/api/line-oa/accounts/{id}', ['GET', 'PATCH']],
  ['/api/line-oa/rich-menus', ['GET', 'POST']], ['/api/line-oa/rich-menus/{id}', ['GET', 'PATCH']],
  ['/api/line-oa/rich-menus/{id}/jobs', ['GET', 'POST', 'PATCH']], ['/api/line-oa/rich-menu-worker', ['POST']], ['/api/platform/programme-usage-reports', ['POST']], ['/api/platform/task-usage-ledger', ['GET']], ['/api/platform/programme-usage-reports/whoami', ['GET']], ['/api/platform/harness-pairing/start', ['POST']], ['/api/platform/harness-pairing/approve', ['POST']], ['/api/platform/harness-pairing/poll', ['POST']], ['/api/platform/harness-devices', ['GET']], ['/api/platform/harness-devices/{id}', ['PATCH']],
  // @req FR-247 — the deduplicated error list (GET) and resolving one (PATCH).
  ['/api/platform/error-events', ['GET']], ['/api/platform/error-events/{id}', ['PATCH']],
  // @req FR-248, FR-249 — record one's own usage (POST), read the breakdown
  // (GET), and the deployment-authenticated 90-day rollup.
  ['/api/platform/usage-events', ['GET', 'POST']], ['/api/platform/usage-events/rollup', ['POST']],
  ['/api/line-oa/liff-apps', ['GET', 'POST']], ['/api/line-oa/liff-apps/{id}', ['GET', 'PATCH']],
  // @req FR-154, FR-155 — the Inventory domain: six catalogue collections
  // (list + create), the product item (read + versioned action; archive is an
  // action, never a DELETE), the lot collection, the read-only serial-unit
  // list, the append-only ledger (list + record) and the recomputed summary.
  ['/api/inventory/categories', ['GET', 'POST']], ['/api/inventory/families', ['GET', 'POST']], ['/api/inventory/factories', ['GET', 'POST']],
  ['/api/inventory/product-masters', ['GET', 'POST']], ['/api/inventory/products', ['GET', 'POST']], ['/api/inventory/products/{id}', ['GET', 'PATCH']],
  ['/api/inventory/bundles', ['GET', 'POST']], ['/api/inventory/lots', ['GET', 'POST']], ['/api/inventory/serial-units', ['GET']],
  ['/api/inventory/stock-movements', ['GET', 'POST']], ['/api/inventory/stock', ['GET']],
  // @req FR-156 — recipes (bill of materials at a batch size): collection
  // (list + create), item (read exploded to a quantity + versioned action)
  // and the atomic build (POST only).
  ['/api/inventory/recipes', ['GET', 'POST']], ['/api/inventory/recipes/{id}', ['GET', 'PATCH']], ['/api/inventory/recipes/{id}/build', ['POST']],
  // @req FR-182 — the SCM operations surface (ADR-074): locations and the
  // atomic transfer, both work orders with their versioned action, reservations
  // and ATP, the shelf-life audit and de-kitting. Every one is a thin handler
  // over the service FR-174..FR-181 already shipped.
  ['/api/inventory/locations', ['GET', 'POST']], ['/api/inventory/locations/{id}', ['GET', 'PATCH']],
  ['/api/inventory/location-stock', ['GET']], ['/api/inventory/transfers', ['POST']],
  ['/api/inventory/customization-work-orders', ['GET', 'POST']], ['/api/inventory/customization-work-orders/{id}', ['GET', 'PATCH']],
  ['/api/inventory/kitting-work-orders', ['GET', 'POST']], ['/api/inventory/kitting-work-orders/{id}', ['GET', 'PATCH']],
  ['/api/inventory/reservations', ['GET', 'POST']], ['/api/inventory/reservations/{id}', ['PATCH']],
  ['/api/inventory/atp', ['GET']], ['/api/inventory/shelf-life', ['GET', 'POST']],
  ['/api/inventory/de-kitting', ['POST']],
  // @req FR-184 — strict NONE/LOT physical stocktake preview, atomic commit
  // and read-only durable detail; SERIAL and unconfigured locations remain
  // explicit service refusals rather than hidden ledger writes.
  ['/api/inventory/stocktakes/preview', ['POST']], ['/api/inventory/stocktakes/commit', ['POST']],
  ['/api/inventory/stocktakes/{id}', ['GET']],
  // @req FR-203, FR-204, FR-206, FR-207 — SKU governance (ADR-083): resolve an
  // identifier to its SKU before creating one, the identifier and unit
  // conversion collections of a SKU (list + add + versioned action), the
  // read-only catalogue hygiene report and the replenishment suggestion.
  ['/api/inventory/products/resolve', ['GET']],
  ['/api/inventory/products/{id}/identifiers', ['GET', 'POST', 'PATCH']],
  ['/api/inventory/products/{id}/unit-conversions', ['GET', 'POST', 'PATCH']],
  ['/api/inventory/catalog-hygiene', ['GET']], ['/api/inventory/replenishment', ['GET']],
  // @req FR-208, FR-209 — catalogue intake (ADR-084): the recent-intakes list, the
  // JSON preview and commit, one intake (read + CANCEL action, never a DELETE),
  // the Business-specific workbook template and the workbook upload preview.
  ['/api/inventory/catalog-intakes', ['GET']], ['/api/inventory/catalog-intakes/preview', ['POST']],
  ['/api/inventory/catalog-intakes/commit', ['POST']], ['/api/inventory/catalog-intakes/{id}', ['GET', 'PATCH']],
  ['/api/inventory/catalog-intakes/template', ['GET']], ['/api/inventory/catalog-intakes/xlsx', ['POST']],
  ['/api/agent/heartbeat', ['GET', 'POST', 'DELETE']], ['/api/agent/line-asset-handoff', ['POST']], ['/api/agent/line-delivery', ['POST']], ['/api/agent/line-webhook', ['POST']], ['/api/assets/evidence', ['POST']], ['/api/assets/evidence/{id}/extract', ['POST']], ['/api/assets/evidence/{id}/review', ['POST']], ['/api/assets/import/sheets', ['POST']], ['/api/assets/import/template', ['GET']], ['/api/assets/import/xlsx', ['POST']], ['/api/assets/intakes', ['POST']], ['/api/assets/intakes/export', ['GET']], ['/api/assets/intakes/validate', ['POST']], ['/api/assets/lookup', ['GET']], ['/api/assets/register', ['GET', 'POST']], ['/api/assets/register/{id}', ['GET']], ['/api/assets/register/{id}/depreciation', ['GET']], ['/api/assets/register/{id}/dispose', ['GET', 'POST']], ['/api/assets/register/{id}/maintenance', ['GET', 'POST']], ['/api/assets/register/{id}/responsibility', ['POST']], ['/api/assets/register/{id}/relocate', ['POST']], ['/api/assets/register/{id}/allocate', ['POST']], ['/api/assets/register/{id}/return', ['POST']], ['/api/assets/register/{id}/verify', ['POST']], ['/api/audit', ['GET']], ['/api/backup/export', ['GET']], ['/api/backup/import', ['POST']],
  ['/api/business/files', ['GET']], ['/api/business/goals', ['POST']], ['/api/business/goals/{id}', ['PATCH']], ['/api/business/goals/{id}/projects', ['POST']], ['/api/business/goals/{id}/projects/{projectId}', ['DELETE']],
  ['/api/business/roadmaps', ['POST']], ['/api/business/roadmaps/{id}', ['PATCH']], ['/api/business/strategy', ['GET']],
  // @req FR-169 — the only writer of Business.capabilitiesJson; PATCH only.
  ['/api/businesses/{id}/capabilities', ['PATCH']],
  // @req FR-236 — the only writer of Business.knowledgeCandidatesEnabled
  // (ADR-090 D6, TASK-ZAI-099); PATCH only, OWNER-scoped, same shape as the
  // capability toggle above.
  ['/api/businesses/{id}/knowledge-candidates-toggle', ['PATCH']],
  ['/api/containers', ['POST']], ['/api/containers/{id}', ['PATCH']],
  ['/api/crm/conversations', ['GET']], ['/api/crm/conversations/{id}', ['GET']],
  // @req FR-246 — the staff reply writer: a Business owner sends a reply from the
  // Inbox composer, pushed through the LINE transport and recorded only on
  // acceptance (ADR-093 evidence gap). POST only.
  ['/api/crm/conversations/{id}/reply', ['POST']],
  // @req FR-233 — the third, read-only reader: message search and per-account
  // follow/unfollow counts. GET only, same as the inbox above.
  ['/api/crm/conversations/search', ['GET']], ['/api/crm/conversations/event-counts', ['GET']],
  ['/api/crm/customers/{customerId}/consent', ['POST']],
  // @req FR-022 — the PDPA erasure trigger. POST only: there is no preview of an
  // erasure, and the redacted Customer row survives, so DELETE would misdescribe it.
  ['/api/crm/customers/{customerId}/erasure', ['POST']],
  // @req FR-245 — the chat evidence archive's one retrieval path (ADR-093 D7,
  // TASK-ZAI-112). POST only, same reasoning as the erasure row above: no GET
  // preview, and every call is independently audited regardless of how many
  // times the same range is asked for.
  ['/api/crm/customers/{customerId}/chat-evidence/retrieve', ['POST']],
  // @req SEC-034 — records a legal hold on a Customer's chat evidence archive
  // (ADR-093 D6, TASK-ZAI-113). POST only, same reasoning as the erasure and
  // retrieval rows above: this appends a new history row, never replaces or
  // previews one, and every recording is independently audited.
  ['/api/crm/customers/{customerId}/legal-hold', ['POST']],
  // @req FR-230 — the nightly retention sweep's scheduled entry point (ADR-091 D1,
  // D2). Deployment-authenticated (ZURI_RETENTION_SWEEP_TOKEN), same shape as
  // /api/line-oa/worker and /api/platform/programme-usage-reports below.
  ['/api/crm/retention-sweep', ['POST']],
  // @req FR-161 — sales tasks: the collection (list + create) and the item
  // (read + versioned action; cancel is an action, never a DELETE).
  ['/api/crm/sales-tasks', ['GET', 'POST']], ['/api/crm/sales-tasks/{id}', ['GET', 'PATCH']],
  // @req FR-166, FR-163 — commerce: the order collection and item (cancel is
  // an action, never a DELETE), the order's payments (list + record), the
  // payment item (read + verify/reject action) and the revenue read model.
  ['/api/commerce/orders', ['GET', 'POST']], ['/api/commerce/orders/{id}', ['GET', 'PATCH']],
  ['/api/commerce/orders/{id}/payments', ['GET', 'POST']], ['/api/commerce/payments/{id}', ['GET', 'PATCH']],
  ['/api/commerce/revenue', ['GET']],
  // @req FR-186 — Business-scoped billing configuration, durable document
  // preview/issuance, and read-only issued-document retrieval.
  ['/api/commerce/billing/config', ['GET', 'PATCH']],
  ['/api/commerce/billing/documents/preview', ['POST']],
  ['/api/commerce/billing/documents', ['POST']],
  ['/api/commerce/billing/documents/{id}', ['GET']],
  // @req FR-183 — POS catalogue reads and atomic checkout composition over
  // existing Commerce payments plus the Inventory append-only ledger.
  ['/api/commerce/pos/catalogue', ['GET']],
  ['/api/commerce/pos/checkout', ['POST']],
  // @req FR-164, FR-165 — procurement: suppliers (list + create; archive is
  // an action, never a DELETE), purchase orders (list + create, read +
  // versioned action) and the goods receipts of one order (list + post —
  // never edited, so no PATCH).
  ['/api/procurement/suppliers', ['GET', 'POST']], ['/api/procurement/suppliers/{id}', ['GET', 'PATCH']],
  ['/api/procurement/purchase-orders', ['GET', 'POST']], ['/api/procurement/purchase-orders/{id}', ['GET', 'PATCH']],
  ['/api/procurement/purchase-orders/{id}/receipts', ['GET', 'POST']],
  ['/api/procurement/receipts', ['GET']], ['/api/procurement/receipts/{id}', ['GET']],
  // @req FR-092 — Market Intelligence's surface-reachable endpoints. Reads are GET
  // only; the only writer of MarketObservation rows is the owner-triggered
  // production translation run below.
  ['/api/market/observations', ['GET']],
  ['/api/market/translations', ['POST']],
  ['/api/dependencies', ['GET', 'POST']], ['/api/dependencies/{id}', ['DELETE']], ['/api/docs', ['GET']], ['/api/entry', ['GET']], ['/api/files', ['GET', 'POST']], ['/api/files/{id}', ['DELETE']],
  ['/api/files/{id}/content', ['GET']], ['/api/files/{id}/relink', ['POST']], ['/api/files/{id}/reveal', ['POST']], ['/api/files/cache/rebuild', ['POST']], ['/api/files/migrate', ['POST']], ['/api/files/mounts', ['GET', 'POST']], ['/api/files/reconcile', ['POST']],
  ['/api/gates', ['POST']], ['/api/gates/{id}', ['PATCH']], ['/api/health', ['GET']], ['/api/import/bundle/commit', ['POST']], ['/api/import/bundle/dry-run', ['POST']], ['/api/import/commit', ['POST']], ['/api/import/dry-run', ['POST']], ['/api/import/template', ['GET']], ['/api/import/xlsx', ['POST']], ['/api/ingest/documents', ['GET', 'POST']], ['/api/mcp', ['POST']],
  // @req FR-110, FR-109 — the knowledge ingestion reporter surface (ADR-067):
  // the run read a reporter needs before it can name a step, the Stage 9–16
  // report, the Stage 17 decision, and the close — four paths, four operations.
  ['/api/pipelines/knowledge/{executionRunId}', ['GET']], ['/api/pipelines/knowledge/{executionRunId}/stages', ['POST']],
  ['/api/pipelines/knowledge/{executionRunId}/gate', ['POST']], ['/api/pipelines/knowledge/{executionRunId}/finish', ['POST']],
  // @req FR-110 — the pull half (ADR-068): one operator tick of the evidence
  // importer, zuri-ai → MSP → gks_stage_evidence_export. One path, one operation.
  ['/api/pipelines/knowledge/evidence/pull', ['POST']],
  ['/api/milestones', ['GET', 'POST']], ['/api/milestones/{id}', ['PATCH']], ['/api/people', ['GET']], ['/api/people/employment', ['POST']], ['/api/people/employment/{employmentId}', ['PATCH']], ['/api/pipelines/health', ['GET']], ['/api/pipelines/runs', ['GET', 'POST']], ['/api/pipelines/runs/{executionRunId}', ['GET']], ['/api/pipelines/runs/{executionRunId}/events', ['POST']], ['/api/pipelines/runs/{executionRunId}/replay', ['POST']], ['/api/platform/customer-import-reviews', ['GET']], ['/api/platform/customer-import-reviews/{caseId}/decisions', ['POST']], ['/api/platform/customer-import-reviews/targets', ['GET']], ['/api/platform/sot/plan', ['GET']], ['/api/platform/sot/decisions', ['GET', 'POST']], ['/api/platform/sot/decisions/{decisionId}/decide', ['POST']], ['/api/platform/sot/decisions/export', ['GET']],
  // @req FR-106 — GET lists key metadata for the Tenants the caller may govern
  // (never key material); POST mints; DELETE revokes.
  ['/api/platform/api-access-keys', ['GET', 'POST']], ['/api/platform/api-access-keys/{id}', ['DELETE']],
  ['/api/platform/integrations', ['GET', 'POST']], ['/api/platform/integrations/line-registry', ['GET', 'POST']], ['/api/platform/users', ['GET', 'PATCH']], ['/api/profile', ['GET']], ['/api/progress/portfolio', ['GET']], ['/api/progress/project/{id}', ['GET']], ['/api/progress/workstream/{id}', ['GET']],
  ['/api/projects', ['GET', 'POST']], ['/api/projects/{id}', ['GET', 'PATCH', 'DELETE']], ['/api/projects/{id}/dependencies', ['GET']], ['/api/projects/{id}/files', ['GET', 'POST']], ['/api/projects/{id}/files/{fileId}', ['DELETE']], ['/api/projects/{id}/inventory', ['GET']], ['/api/projects/{id}/roadmap', ['GET']], ['/api/projects/{id}/domain-view', ['GET']], ['/api/projects/{id}/team', ['GET', 'POST', 'PATCH', 'DELETE']], ['/api/projects/{id}/teams', ['GET', 'POST', 'DELETE']], ['/api/projects/{id}/tree', ['GET']], ['/api/projects/overview', ['GET']],
  ['/api/repositories', ['GET', 'POST']], ['/api/repositories/{id}', ['PATCH']], ['/api/repositories/link', ['POST']], ['/api/repositories/link/{id}', ['DELETE']], ['/api/resolve', ['GET']], ['/api/scope', ['GET', 'POST']], ['/api/auth/login', ['POST']], ['/api/auth/logout', ['POST']], ['/api/auth/reset-password', ['POST']], ['/api/auth/signup', ['POST']], ['/api/onboarding/profile', ['POST']], ['/api/onboarding/state', ['GET']], ['/api/onboarding/workspaces', ['POST']], ['/api/workspace-invites', ['POST']], ['/api/workspace-invites/accept', ['POST']], ['/api/workspace-invites/{id}', ['DELETE']], ['/api/workspace-memberships', ['GET', 'DELETE']], ['/api/platform/users/password-resets', ['POST']],
  // @req FR-038 — the owner attaches an existing Person to a Business they own.
  ['/api/platform/users/memberships', ['POST']],
  // @req FR-191 — the withdrawal half of a grant's life (ADR-077 D2).
  ['/api/platform/users/memberships/{id}/lifecycle', ['POST']],
  ['/api/platform/users/offboard', ['POST']], ['/api/teams', ['GET', 'POST']], ['/api/teams/{id}', ['GET', 'PATCH', 'DELETE']], ['/api/teams/{id}/members', ['POST', 'DELETE']], ['/api/viewer', ['GET']],
  // @req FR-199 — access history a Business owner can read for their own
  // scope (ADR-080), and the current-state grant roster for one Business.
  ['/api/platform/access-history', ['GET']],
  ['/api/platform/businesses/{businessId}/grants', ['GET']],
  // @req FR-123 — the plugin authorization boundary (ADR-052).
  // GET renders the consent screen (it redirects there and mints nothing);
  // POST is the consent form's own submission and the only path that mints.
  ['/api/plugin/auth/authorize', ['GET', 'POST']], ['/api/plugin/auth/capabilities', ['GET']], ['/api/plugin/auth/revoke', ['POST']], ['/api/plugin/auth/token', ['POST']],
  ['/api/work', ['GET', 'POST']], ['/api/work/{id}', ['PATCH', 'DELETE']], ['/api/workspaces/{id}', ['PATCH', 'DELETE']], ['/api/workstreams', ['GET', 'POST']], ['/api/workstreams/{id}', ['PATCH', 'DELETE']],
  // @req FR-022, FR-097 — verified channel onboarding and identity link tokens (ADR-045).
  ['/api/identity/link-tokens', ['POST']],
  ['/api/identity/link-tokens/redeem', ['POST']],
  ['/api/identity/channel-identities', ['GET']],
  // @req FR-094, FR-095 — Multi-Factor Authentication (TOTP) and session step-up elevation (ADR-045).
  ['/api/auth/mfa/totp/enroll', ['POST']],
  ['/api/auth/mfa/totp/verify', ['POST']],
  ['/api/auth/mfa/factors', ['GET', 'DELETE']],
  ['/api/auth/step-up', ['POST']],
  // @req FR-094, FR-095 — FIDO2 WebAuthn Passkey authentication and lifecycle (ADR-045).
  ['/api/auth/webauthn/register/options', ['POST']],
  ['/api/auth/webauthn/register/verify', ['POST']],
  ['/api/auth/webauthn/login/options', ['POST']],
  ['/api/auth/webauthn/login/verify', ['POST']],
  ['/api/auth/webauthn/credentials', ['GET', 'DELETE']],
  ['/api/auth/webauthn/step-up', ['POST']],
]

const zRouteInventoryRequest = z.record(z.string(), z.unknown()).openapi({
  description: 'Handler-specific request fields are intentionally not inferred here. See Appendix A and live handler validation for the route-specific contract.',
})

const zRouteInventoryResponse = z.any().openapi({
  description: 'Handler-specific response fields are intentionally not inferred here. This operation proves route coverage only; the route and Appendix A remain the detailed contract authority.',
})

const zBinaryResponse = z.string().openapi({ format: 'binary' })

function pathParameters(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({ name: match[1], in: 'path', required: true, schema: z.string() }))
}

function genericRequest(path, method) {
  if (!['post', 'put', 'patch'].includes(method)) return undefined
  if (path === '/api/assets/evidence' || path === '/api/assets/import/xlsx') {
    return { body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ format: 'binary' }) }) } } } }
  }
  if (path === '/api/import/xlsx') {
    return { body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ format: 'binary' }), workspaceId: z.string().optional(), projectId: z.string().optional() }) } } } }
  }
  if (path === '/api/files/{id}/reveal') return undefined
  // @req FR-123 — the consent approval is an HTML form submission, not a JSON
  // call. Documenting it as JSON would describe a request this handler refuses.
  if (path === '/api/plugin/auth/authorize') {
    return {
      body: {
        content: {
          'application/x-www-form-urlencoded': {
            schema: z.object({
              decision: z.enum(['approve', 'deny']),
              csrf_token: z.string(),
              request_token: z.string(),
            }),
          },
        },
      },
    }
  }
  return { body: { content: { 'application/json': { schema: zRouteInventoryRequest } } } }
}

function genericResponses(path) {
  if (path === '/api/files/{id}/content') return { 200: { description: 'Authorized file content stream', content: { 'application/octet-stream': { schema: zBinaryResponse } } } }
  return {
    200: json(zRouteInventoryResponse, 'Route-specific success response; fields are intentionally not generalized here'),
    400: json(zError, 'Route-specific validation or malformed request error'),
    401: json(zError, 'Authentication required'),
    403: json(zError, 'Viewer is not authorized for the requested scope'),
    404: json(zError, 'Resource or route-specific target was not found'),
  }
}

function registerInventoryOperations(registry) {
  const detailedOperations = new Set(['get /api/auth/csrf', 'get /api/projects/{id}/domain-view', 'get /api/projects/{id}/feature-view', 'get /api/projects/{id}/features', 'get /api/projects/{id}/features/{featureId}', 'get /api/projects/{id}/governance-snapshots', 'post /api/assets/intakes/validate', 'post /api/import/dry-run', 'post /api/import/commit', 'get /api/resolve', 'get /api/import/template'])
  for (const route of FEATURE_MUTATIONS) detailedOperations.add(`${route.method} ${route.path}`)
  for (const [path, methods] of CURRENT_API_ROUTE_INVENTORY) {
    for (const method of methods) {
      const methodName = method.toLowerCase()
      if (detailedOperations.has(`${methodName} ${path}`)) continue
      registry.registerPath({
        method: methodName,
        path,
        summary: `Route inventory: ${method} ${path}`,
        description: `Current handler inventory coverage for ${method} ${path}. This generic operation is deliberately transparent: handler-specific request and response fields are not claimed here; use Appendix A and live route validation for the detailed contract.`,
        tags: ['Route inventory'],
        parameters: pathParameters(path),
        request: genericRequest(path, methodName),
        responses: genericResponses(path),
        'x-zuri-contract': 'route-inventory',
      })
    }
  }
}

const zImportRequest = z
  .object({
    plan: zPlanEnvelope,
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
  })
  .strict()

const zPreviewRow = z.object({
  kind: z.string(),
  code: z.string(),
  title: z.string().optional(),
  reason: z.string().optional(),
  matchedBy: z.enum(['externalRef', 'newMapping']).optional(),
  planCode: z.string().optional(),
})

const zDryRunResponse = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  workspace: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable().optional(),
  preview: z
    .object({
      inserts: z.array(zPreviewRow),
      updates: z.array(zPreviewRow),
      conflicts: z.array(zPreviewRow),
      dependencyCount: z.number(),
      externalRefCount: z.number(),
      matchedByExternalId: z.number(),
      summary: z.object({ insertCount: z.number(), updateCount: z.number(), conflictCount: z.number() }),
    })
    .nullable(),
})

const zCommitResponse = z.object({
  committed: z.boolean(),
  projectId: z.string().optional(),
  projectCode: z.string().optional(),
  errors: z.array(z.string()).optional(),
})

const zResolveResponse = z.object({
  id: z.string(),
  code: z.string(),
  type: z.string(),
  externalRef: zExternalRef.partial().optional(),
  externalRefs: z
    .array(z.object({ system: z.string(), value: z.string(), labelAs: z.boolean(), verifiedAt: z.string().nullable() }))
    .optional(),
})

const zAssetValidationIssue = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
})

const zAssetValidationResponse = z.object({
  mode: z.literal('PREVIEW_ONLY'),
  applied: z.literal(false),
  providerActions: z.array(z.string()),
  validation: z.object({
    ok: z.boolean(),
    value: zAssetIntakeEnvelope.nullable(),
    conflicts: z.array(z.unknown()),
    requiresHumanReview: z.boolean(),
    issues: z.array(zAssetValidationIssue),
  }),
  depreciationPreview: z.unknown().nullable(),
  unavailableAdapters: z.array(z.enum([
    'LINE_BINARY',
    'OCR_VISION',
    'GOOGLE_SHEET_SYNC',
    'PROCUREMENT_LOOKUP',
    'FINANCE_POSTING',
  ])),
})

const zError = z.object({ error: z.string(), issues: z.array(z.string()).optional() })

const json = (schema, description) => ({ description, content: { 'application/json': { schema } } })

export function buildOpenApiDocument({ serverUrl = '/' } = {}) {
  const registry = new OpenAPIRegistry()
  registry.register('PlanEnvelope', zPlanEnvelope)
  registry.register('ExternalRef', zExternalRef)
  registry.register('ImportRequest', zImportRequest)
  registry.register('DryRunResponse', zDryRunResponse)
  registry.register('CommitResponse', zCommitResponse)
  registry.register('ResolveResponse', zResolveResponse)
  registry.register('AssetIntakeEnvelope', zAssetIntakeEnvelope)
  registry.register('AssetValidationResponse', zAssetValidationResponse)
  registry.register('DomainRow', zDomainRow)
  registry.register('DomainView', zProjectDomainView)
  registry.register('DomainViewError', zDomainViewError)
  registry.register('CsrfToken', zApiWriteCsrfToken)
  registry.register('ApiWriteCsrfError', zApiWriteCsrfError)
  registry.register('FeatureReadError', zFeatureReadError)
  registry.register('FeatureRecord', zFeatureRecord)
  registry.register('DeletedFeatureRecord', zDeletedFeatureRecord)
  registry.register('FeatureView', zFeatureView)
  registry.register('FeatureRecordPage', zFeatureRecordPage)
  registry.register('GovernanceSnapshotMetadata', zGovernanceSnapshotMetadata)
  registry.register('GovernanceSnapshotPage', zGovernanceSnapshotPage)
  for (const [name, schema] of Object.entries({
    FeatureCreateInput: zFeatureCreateInput, FeaturePatchInput: zFeaturePatchInput,
    ContributionInput: zContributionInput, ContributionsReplaceInput: zContributionsReplaceInput,
    WorkLinkInput: zWorkLinkInput, WorkLinksReplaceInput: zWorkLinksReplaceInput,
    FeatureWorkSet: zFeatureWorkSet, FeatureWorkGraphInput: zFeatureWorkGraphInput,
    RequirementBindingInput: zRequirementBindingInput, RequirementBindingsReplaceInput: zRequirementBindingsReplaceInput,
    MutationReceipt: zMutationReceipt, MutationError: zMutationError,
    SourceManifestEntry: zSourceManifestEntry, SourceManifest: zSourceManifest,
    CaptureSnapshotInput: zCaptureSnapshotInput, GovernanceVerificationProof: zGovernanceVerificationProof,
    GovernanceSnapshot: zGovernanceSnapshot, SnapshotCaptureResult: zSnapshotCaptureResult,
  })) registry.register(name, schema)
  registry.registerComponent('securitySchemes', 'SessionAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: AUTH_SESSION_COOKIE,
    description: 'Current server-resolved session. Authorization is recomputed from live server state; no role is inferred from cookie labels.',
  })
  registry.register('Error', zError)

  // @req FR-252 — detailed read contracts use the same strict runtime DTOs;
  // mutation operations join only when their handlers are implemented.
  const featureFailure = (description) => ({
    description,
    headers: {
      'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
      'X-Request-ID': { schema: { type: 'string', format: 'uuid' } },
    },
    content: { 'application/json': { schema: { $ref: '#/components/schemas/FeatureReadError' } } },
  })
  const pageQuery = {
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).max(4096).optional(),
  }
  const featureReads = [
    {
      path: '/api/projects/{id}/feature-view', operationId: 'getProjectFeatureView',
      summary: 'Read explicit Project Features and distinct WorkItem counts',
      schema: 'FeatureView',
      description: 'Full Project hierarchy is proved before reads. At most 200 active records; shared work counts once. Aggregate snapshot remains UNAVAILABLE. Per-record key/revision evidence requires bound-commit verification. Owners receive the complete graph CAS token in ETag; shared readers do not.',
      etagDescription: 'Owner-only graph CAS token over all Feature ids, versions and deletion instants, including tombstones in the same read transaction.',
      extraResponses: { 413: featureFailure('FEATURE_VIEW_LIMIT_EXCEEDED: the aggregate exceeds its fixed response bound.') },
    },
    {
      path: '/api/projects/{id}/features', operationId: 'listProjectFeatures',
      summary: 'List active Features or owner-visible minimal tombstones',
      schema: 'FeatureRecordPage',
      description: 'Stable code/id ordering and a signed scope-bound cursor. ACTIVE includes non-deleted DRAFT, ACTIVE and RETIRED records. Non-owner DELETED requests receive a redacted 404.',
      query: z.object({ ...pageQuery, visibility: z.enum(['ACTIVE', 'DELETED']).optional(), lifecycle: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).optional() }).strict(),
      extraResponses: { 400: featureFailure('MALFORMED_REQUEST or INVALID_CURSOR: bounded query or cursor is invalid.') },
    },
    {
      path: '/api/projects/{id}/features/{featureId}', operationId: 'getProjectFeature',
      summary: 'Read one scoped active Feature and its explicit relationships',
      schema: 'FeatureRecord', detail: true,
      description: 'The Feature must belong to the authorized URL Project. Unknown, deleted, foreign and invalid-hierarchy targets share a redacted 404.',
      etagDescription: 'Strong Feature CAS token for the returned id and version.',
    },
    {
      path: '/api/projects/{id}/governance-snapshots', operationId: 'listProjectGovernanceSnapshots',
      summary: 'List owner-authorized Project snapshot metadata',
      schema: 'GovernanceSnapshotPage',
      description: 'Business owner capability is required after Project hierarchy proof. Returns bounded metadata only; no source manifest, verification payload, checkout path or mutation receipt.',
      query: z.object(pageQuery).strict(),
      extraResponses: {
        400: featureFailure('MALFORMED_REQUEST or INVALID_CURSOR: bounded query or cursor is invalid.'),
        403: featureFailure('CAPABILITY_DENIED: an in-scope reader lacks snapshot metadata capability.'),
      },
    },
  ]
  for (const route of featureReads) {
    registry.registerPath({
      method: 'get', path: route.path, operationId: route.operationId,
      summary: route.summary, description: route.description,
      tags: ['Feature view'], security: [{ SessionAuth: [] }],
      request: {
        params: z.object({ id: z.string().uuid(), ...(route.detail ? { featureId: z.string().uuid() } : {}) }).strict(),
        ...(route.query ? { query: route.query } : {}),
      },
      responses: {
        200: {
          description: 'Authorized read; no persistence, audit or progress change.',
          headers: {
            'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
            ...(route.etagDescription ? { ETag: { description: route.etagDescription, schema: { type: 'string', maxLength: 4096 } } } : {}),
          },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/' + route.schema } } },
        },
        401: featureFailure('AUTH_REQUIRED: no valid live session.'),
        404: featureFailure('RESOURCE_NOT_FOUND: missing, deleted, foreign or hierarchy-invalid target; identifiers are redacted.'),
        503: featureFailure('SESSION_UNAVAILABLE or DATA_INTEGRITY_UNAVAILABLE: source authority is unavailable; internal details are redacted.'),
        ...route.extraResponses,
      },
    })
  }

  const mutationHeaders = {
    'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
    'X-Request-ID': { schema: { type: 'string', format: 'uuid' } },
  }
  const mutationFailure = (description) => ({
    description, headers: mutationHeaders,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/MutationError' } } },
  })
  for (const route of FEATURE_MUTATIONS) {
    const success = (description) => ({
      description,
      headers: { ...mutationHeaders, ETag: { schema: { type: 'string', minLength: 1, maxLength: 4096 } } },
      content: { 'application/json': { schema: { $ref: '#/components/schemas/' + (route.capture ? 'SnapshotCaptureResult' : 'MutationReceipt') } } },
    })
    registry.registerPath({
      method: route.method, path: route.path, operationId: route.operationId,
      summary: route.summary, tags: ['Feature mutations'], security: [{ SessionAuth: [] }],
      description: 'Live session, exact configured Origin, session-bound CSRF and Business mutation authority are required. Project hierarchy is proved and locked before body normalization, receipt lookup or effects. Rows, one receipt and one AuditEvent commit atomically. Same normalized intent replays the original effect with a fresh requestId; a changed hash refuses. ' +
        (route.capture ? 'Input is intent only. The operator-bound Git verifier supplies VALID proof; failed capture inserts nothing. Response is {snapshot,receipt}, without an absolute checkout path.' : 'Response is the direct receipt. Read the current DTO after success. Unknown Domain, invalid allocation, unproven key/revision and cross-scope bindings refuse.') +
        (route.cas ? ' If-Match must equal the current strong Feature or complete graph token.' : ''),
      request: {
        params: z.object({ id: z.string().uuid(), ...(route.path.includes('{featureId}') ? { featureId: z.string().uuid() } : {}) }).strict(),
        headers: z.object({
          Origin: z.string().url(),
          'X-CSRF-Token': z.string().min(1),
          'Idempotency-Key': z.string().min(8).max(128),
          ...(route.cas ? { 'If-Match': z.string().min(1).max(4096) } : {}),
        }),
        ...(route.schema ? { body: { required: true, content: { 'application/json': { schema: route.schema } } } } : {}),
      },
      responses: {
        200: success(route.create ? 'Original committed result replayed after fresh authorization.' : 'Mutation committed, or original committed result replayed after fresh authorization.'),
        ...(route.create ? { 201: success('First successful creation; durable effect and receipt committed.') } : {}),
        400: mutationFailure('MALFORMED_REQUEST: the owned request body or idempotency input is invalid.'),
        401: mutationFailure('AUTH_REQUIRED: missing, expired or revoked live session.'),
        403: mutationFailure('CSRF_INVALID or CAPABILITY_DENIED: origin/token or Business mutation authority refused.'),
        404: mutationFailure('RESOURCE_NOT_FOUND: missing, foreign, deleted or hierarchy-invalid target; no cross-scope details.'),
        409: mutationFailure('Idempotency, duplicate code, relationship or restore allocation conflict; no partial change.'),
        ...(route.cas ? {
          412: mutationFailure('VERSION_MISMATCH: reread currentVersion/currentEtag before a new deliberate intent.'),
          428: mutationFailure('PRECONDITION_REQUIRED: If-Match was not supplied.'),
        } : {}),
        422: mutationFailure('Domain, lifecycle, capacity, graph membership, allocation or verified snapshot/revision invariant refused.'),
        503: mutationFailure('SESSION_UNAVAILABLE or DATA_INTEGRITY_UNAVAILABLE: safe retryable refusal without internal details.'),
      },
    })
  }

  // @req FR-252 — publish the issuer's actual runtime schemas and refusal
  // contract; no Feature mutation route is advertised before it exists.
  const csrfFailure = (description) => ({
    description,
    headers: {
      'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } },
      'X-Request-ID': { schema: { type: 'string', format: 'uuid' } },
    },
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiWriteCsrfError' } } },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/auth/csrf',
    operationId: 'getApiWriteCsrfToken',
    summary: 'Issue a live-session-bound API-write CSRF token',
    description:
      'Requires the live persisted zuri_session and the configured PUBLIC_BASE_URL Origin. ' +
      'When this GET has no Origin, Sec-Fetch-Site same-origin or a same-origin Referer is required. ' +
      'The zuri_api_write.v1 token expires within 15 minutes and before its session expires. ' +
      'Keep it in browser memory; no CORS response is provided. It is distinct from plugin consent and grants no Business capability.',
    tags: ['Identity CSRF'],
    security: [{ SessionAuth: [] }],
    responses: {
      200: {
        description: 'Session-bound API-write token; never cache or persist it in browser storage.',
        headers: { 'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } } },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CsrfToken' } } },
      },
      401: csrfFailure('AUTH_REQUIRED: no valid live persisted session.'),
      403: csrfFailure('CSRF_INVALID: request origin is foreign or unproven.'),
      503: csrfFailure('SESSION_UNAVAILABLE: session store, issuer or explicit configuration is unavailable; details are redacted.'),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/assets/intakes/validate',
    summary: 'Validate one canonical Asset intake envelope without applying it',
    description:
      'Requires a trusted viewer with access to the selected Business and Asset Management domain. ' +
      'This preview performs no upload, OCR/Vision call, LINE retrieval, Sheet synchronization, ' +
      'Procurement lookup, Asset persistence, Finance approval or journal posting.',
    tags: ['Asset Management'],
    request: { body: { content: { 'application/json': { schema: zAssetIntakeEnvelope } } } },
    responses: {
      200: json(zAssetValidationResponse, 'Validation result and optional deterministic depreciation preview'),
      400: json(zError, 'Malformed request'),
      401: json(zError, 'Authentication required'),
      403: json(zError, 'Asset Management is not enabled for this Business'),
      404: json(zError, 'Business not found or not visible'),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/projects/{id}/domain-view',
    operationId: 'getProjectDomainView',
    summary: 'Read the authorized Project Execution Domains projection',
    description:
      'Read-only Phase A projection of FR-070 Workstream domain bindings. ' +
      'Authorization is resolved against the Project Business/Workspace hierarchy before Workstream or WorkItem aggregation. ' +
      'Unknown immutable domain ids remain visible as UNMAPPED; Feature, blocker, contract, gap and snapshot fields remain unavailable in Phase A.',
    tags: ['Domain view'],
    security: [{ SessionAuth: [] }],
    request: { params: z.object({ id: z.string().uuid() }).strict() },
    responses: {
      200: {
        description: 'Successful authorized result.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/DomainView' } } },
      },
      401: {
        description: 'No valid live session. The redacted body contains no Project, Business or domain identifiers.',
        headers: {
          'X-Request-ID': {
            description: 'Fresh server-generated request UUID; equal to the response body requestId.',
            schema: { type: 'string', format: 'uuid' },
          },
        },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/DomainViewError' } } },
      },
      404: {
        description: 'The Project is unknown, deleted, foreign-scope or hierarchy-invalid. The same redacted response prevents target enumeration.',
        headers: {
          'X-Request-ID': {
            description: 'Fresh server-generated request UUID; equal to the response body requestId.',
            schema: { type: 'string', format: 'uuid' },
          },
        },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/DomainViewError' } } },
      },
      503: {
        description: 'The session or read service is temporarily unavailable; internal details are redacted.',
        headers: {
          'X-Request-ID': {
            description: 'Fresh server-generated request UUID; equal to the response body requestId.',
            schema: { type: 'string', format: 'uuid' },
          },
        },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/DomainViewError' } } },
      },
      500: {
        description: 'Unexpected failure; internal details are redacted.',
        headers: {
          'X-Request-ID': {
            description: 'Fresh server-generated request UUID; equal to the response body requestId.',
            schema: { type: 'string', format: 'uuid' },
          },
        },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/DomainViewError' } } },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/import/dry-run',
    summary: 'Validate a plan envelope and preview the changes — writes nothing',
    description:
      'Identity is resolved externalRef → code → new. Conflicts (an external id pointing at a different record, ' +
      'a type mismatch, or the same id claimed twice in one batch) are reported, never guessed.',
    tags: ['Intake'],
    request: { body: { content: { 'application/json': { schema: zImportRequest } } } },
    responses: {
      200: json(zDryRunResponse, 'Validation result plus the insert/update/conflict preview'),
      400: json(zError, 'Malformed request'),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/import/commit',
    summary: 'Commit a plan envelope in a single transaction',
    description:
      'Re-runs the dry run and refuses on any conflict. Entities matched by external id are updated in place — ' +
      'their existing code is never overwritten. Every commit appends a PLAN_IMPORTED audit event.',
    tags: ['Intake'],
    request: { body: { content: { 'application/json': { schema: zImportRequest } } } },
    responses: {
      200: json(zCommitResponse, 'Commit result'),
      400: json(zError, 'Malformed request'),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/resolve',
    summary: 'Resolve a record by our code or by the customer’s own core id',
    description: 'Resolve by internal type/code or external system/value. The response preserves the internal id and returns mapped external references without changing primary-key ownership.',
    tags: ['Identity'],
    request: {
      query: z.object({
        type: z.string().optional().openapi({ example: 'PROJECT' }),
        code: z.string().optional().openapi({ example: 'PRJ-B01-TRANSFORM' }),
        system: z.string().optional().openapi({ example: 'SAP' }),
        value: z.string().optional().openapi({ example: 'CUST-88421' }),
      }),
    },
    responses: {
      200: json(zResolveResponse, 'Internal id plus any external ids mapped to it'),
      404: json(zError, 'Nothing matched'),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/import/template',
    summary: 'Download the Excel intake template generated from this schema',
    description: 'Returns the XLSX intake template generated from the same PlanEnvelope contract used by the JSON intake endpoints.',
    tags: ['Intake'],
    responses: { 200: { description: 'XLSX workbook' } },
  })

  registerInventoryOperations(registry)

  const generator = new OpenApiGeneratorV3(registry.definitions)
  const document = generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Zuri v2 Project Manager — Enterprise Intake API',
      version: '1.1.0',
      description: [
        'Backend-first integration surface. Every intake surface (UI wizard, Excel, agent JSON, this API)',
        'ends at the same pipeline: validate → dry run → preview → transactional commit → audit.',
        '',
        'Identity rules:',
        '- Your core id stays yours: it is mapped onto our internal UUID and never becomes a primary key.',
        '- Our `code` is our namespace; an external id never overwrites it.',
        '- Upsert order is externalRef → code → create.',
        '',
        `Execution modes: ${EXECUTION_MODES.join(', ')}.`,
        `Progress strategies: ${PROGRESS_STRATEGIES.join(', ')}.`,
        '',
        'The document contains complete current route coverage. Operations tagged x-zuri-contract=route-inventory are explicit inventory entries whose handler-specific fields are intentionally not generalized; Appendix A and runtime validation remain authoritative for those details.',
      ].join('\n'),
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'Intake', description: 'Plan envelope in, work graph out' },
      { name: 'Asset Management', description: 'Evidence-backed physical Asset intake previews' },
      { name: 'Domain view', description: 'Authorized Project Execution Domains projections' },
      { name: 'Feature view', description: 'Scoped explicit Project Features and verified reference reads' },
      { name: 'Feature mutations', description: 'Owner writes with live CSRF, CAS, idempotency and atomic audit' },
      { name: 'Identity', description: 'Map customer core ids onto internal records' },
      { name: 'Route inventory', description: 'Complete current route/method coverage with transparent generic boundaries' },
    ],
    'x-zuri-route-inventory': {
      source: 'src/app/api/**/route.js',
      pathCount: CURRENT_API_ROUTE_INVENTORY.length,
      operationCount: CURRENT_API_ROUTE_INVENTORY.reduce((count, [, methods]) => count + methods.length, 0),
    },
  })
  // OpenAPI 3.0 represents Zod's `z.null()` as `nullable: true`. Add the
  // candidate's explicit null enum to the two Phase A fields so consumers can
  // distinguish an unavailable value from a nullable future value, while the
  // runtime Zod schemas remain the single validation authority.
  for (const [schemaName, field] of [['DomainView', 'snapshotId'], ['DomainRow', 'blockerCount']]) {
    const schema = document.components?.schemas?.[schemaName]
    if (schema?.properties?.[field]) schema.properties[field].enum = [null]
  }
  // Zod superRefine predicates are not represented by zod-to-openapi. Keep
  // their machine-readable forms explicit and exercise both validators with
  // the same pair/discriminator/path cases in openapi-docs.test.js.
  const schemas = document.components.schemas
  const provenancePair = [
    {
      required: ['canonicalFeatureKey', 'governanceSnapshotId'],
      properties: {
        canonicalFeatureKey: { type: 'string', nullable: true, enum: [null] },
        governanceSnapshotId: { type: 'string', nullable: true, enum: [null] },
      },
    },
    {
      required: ['canonicalFeatureKey', 'governanceSnapshotId'],
      properties: {
        canonicalFeatureKey: { type: 'string', minLength: 1, maxLength: 200 },
        governanceSnapshotId: { type: 'string', format: 'uuid' },
      },
    },
  ]
  schemas.FeatureCreateInput.oneOf = [
    { not: { anyOf: [{ required: ['canonicalFeatureKey'] }, { required: ['governanceSnapshotId'] }] } },
    ...provenancePair,
  ]
  schemas.FeatureRecord.oneOf = provenancePair
  schemas.FeaturePatchInput.minProperties = 1
  const receiptKinds = {
    CREATE_FEATURE: ['PROJECT', 'POST', 'PROJECT_FEATURE'],
    UPDATE_FEATURE: ['FEATURE', 'PATCH', 'PROJECT_FEATURE'],
    REPLACE_CONTRIBUTIONS: ['FEATURE', 'PUT', 'PROJECT_FEATURE'],
    REPLACE_WORK_LINKS: ['FEATURE', 'PUT', 'PROJECT_FEATURE'],
    REPLACE_FEATURE_WORK_GRAPH: ['PROJECT', 'PUT', 'PROJECT_FEATURE_GRAPH'],
    REPLACE_REQUIREMENT_BINDINGS: ['FEATURE', 'PUT', 'PROJECT_FEATURE'],
    DELETE_FEATURE: ['FEATURE', 'DELETE', 'PROJECT_FEATURE'],
    RESTORE_FEATURE: ['FEATURE', 'POST', 'PROJECT_FEATURE'],
    CAPTURE_GOVERNANCE_SNAPSHOT: ['PROJECT', 'POST', 'GOVERNANCE_SNAPSHOT'],
  }
  schemas.MutationReceipt.properties.version = { type: 'integer', minimum: 1, nullable: true }
  schemas.MutationReceipt.oneOf = Object.entries(receiptKinds).map(([operation, [targetType, httpMethod, resourceType]]) => ({
    required: ['operation', 'targetType', 'httpMethod', 'resourceType', 'version'],
    properties: {
      operation: { type: 'string', enum: [operation] },
      targetType: { type: 'string', enum: [targetType] },
      httpMethod: { type: 'string', enum: [httpMethod] },
      resourceType: { type: 'string', enum: [resourceType] },
      version: resourceType === 'PROJECT_FEATURE'
        ? { type: 'integer', minimum: 1 }
        : { type: 'integer', nullable: true, enum: [null] },
    },
  }))
  schemas.SnapshotCaptureResult.properties.receipt = {
    allOf: [
      { $ref: '#/components/schemas/MutationReceipt' },
      { properties: { operation: { type: 'string', enum: ['CAPTURE_GOVERNANCE_SNAPSHOT'] } } },
    ],
  }
  schemas.SnapshotCaptureResult.description = 'A committed snapshot and its CAPTURE_GOVERNANCE_SNAPSHOT receipt. snapshot.id must equal receipt.resourceId; the server validates this cross-field relationship.'
  schemas.SnapshotCaptureResult['x-resource-identity'] = 'snapshot.id == receipt.resourceId'
  schemas.SourceManifestEntry.properties.path.pattern = /^(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\\\u0000-\u001f\u007f])[^/]+(?:\/[^/]+)*$/.source
  schemas.SourceManifest['x-maxBytes'] = 1024 * 1024
  schemas.SourceManifest.description = 'Compact UTF-8 normalized manifest, at most 1 MiB. Paths are unique across entries. Runtime also enforces path uniqueness when hashes differ; JSON Schema uniqueItems alone cannot express that key constraint.'
  schemas.SourceManifest.properties.entries.uniqueItems = true
  schemas.FeatureWorkGraphInput.properties.affectedWorkItemIds.uniqueItems = true
  return document
}
