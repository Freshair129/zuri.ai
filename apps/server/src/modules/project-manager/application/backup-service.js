// @req FR-149 — restored LINE jobs preserve delivery evidence but cannot resume sends.
// @spec ADR-061
// @tested tests/integration/line-server-backup.test.js
// @req FR-013 - snapshot export/import with preview and confirmation.
// @req FR-157 — Content roots, immutable versions, reviews and decisions restore in FK order.
// @tested tests/integration/marketing-content-backup.test.js
// @req FR-123 - plugin auth material is installation security state, not
// business data; restore revokes it instead of exporting or restoring it.
// @req FR-078 - customer import batches, review cases, decisions and provenance
// must survive snapshot restore.
// @req FR-045 - portable FileAsset metadata, optional content and explicit remount gaps.
// @req FR-075 - restore is an installation-wide operation and requires operator
// authority. This is what took /api/backup/import off the route-viewer baseline.
// The route was unrepayable for as long as the only holdable authority was
// per-Business: importSnapshot deletes and replaces every Portfolio, Tenant,
// Business, identity and audit row, so owning every Business that exists today
// still says nothing about the rows a snapshot introduces. The answer was to
// name the capability, not to compose a bigger loop over ownsBusiness.
// @spec BR-008, SDD-023, ADR-016 D10
// @spec SEC-008
// @tested tests/integration/backup.test.js, tests/integration/crm-conversation-analysis.test.js, tests/unit/fr045-backup-contract.test.js
// @tested tests/integration/fr075-restore-authorization.test.js
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { BROADCAST_INTENT_STATUSES, hashMarketingBroadcastPayload, parseMarketingBroadcastPayload } from '@/modules/marketing/domain/marketing-broadcast-contract'
import { recordAudit } from './audit'
import { createLocalFilesystemPort } from '../local-files/filesystem-port'
import { requireViewer } from './project-authorization'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import {
  BILLING_DOCUMENT_TYPES,
  BILLING_NON_VAT_POLICIES,
  BILLING_PROMPTPAY_PROVIDER,
  BILLING_TARGET_TYPES,
  BILLING_VAT_TREATMENTS,
  BILLING_WALK_IN_POLICIES,
} from '@/modules/commerce/domain/billing'
import {
  hashStocktake,
  INT32_MAX,
  INVENTORY_STOCKTAKE_MAX_LINES,
  INVENTORY_STOCKTAKE_STATUSES,
} from '@/modules/inventory/domain/inventory-stocktake'

/**
 * Guard for both entry points below.
 *
 * The preview is guarded as well as the restore, deliberately: it returns a row
 * count for every table across every tenant, which is the same disclosure the
 * restore guard would otherwise hand out for free. FR-065 made the identical
 * call for the import dry run — "a read-only preview of another scope's contents
 * is the leak the commit guard would otherwise still allow."
 */
function assertRestoreOperator(viewer) {
  requireViewer(viewer, 'backup restore')
  if (!isInstallationOperator(viewer)) {
    const error = new Error(
      'Restoring a snapshot replaces every tenant in this installation. It requires ' +
      'operator authority (a platform grant, or the local installation session) — ' +
      'owning Businesses does not confer it, however many.'
    )
    error.status = 403
    throw error
  }
}

export const SNAPSHOT_SCHEMA_VERSION = '1.0'
export const MARKETING_BROADCAST_RECOVERY_MANIFEST_VERSION = 'marketing-broadcast-recovery.v1'
const MARKETING_BROADCAST_RECOVERY_TABLES = Object.freeze(['marketingBroadcastIntent', 'marketingBroadcastIntentVersion'])
export const GENESIS_RAG17_RECOVERY_MANIFEST_VERSION = 'genesisrag17-recovery.v1'
export const COMMERCE_BILLING_RECOVERY_MANIFEST_VERSION = 'commerce-billing-recovery.v1'
export const INVENTORY_STOCKTAKE_RECOVERY_MANIFEST_VERSION = 'inventory-stocktake-recovery.v1'
export const LINE_WORKER_MEMORY_RECOVERY_MANIFEST_VERSION = 'line-worker-memory-recovery.v1'
const COMMERCE_BILLING_RECOVERY_TABLES = Object.freeze([
  'businessBillingProfile',
  'commerceDocumentSequence',
  'commerceDocument',
])
const COMMERCE_BILLING_DOCUMENT_STATUSES = Object.freeze(['ISSUED'])
const INVENTORY_STOCKTAKE_RECOVERY_TABLES = Object.freeze([
  'inventoryLedgerFence',
  'inventoryStocktake',
])
const GENESIS_RAG17_RECOVERY_TABLES = Object.freeze([
  'genesisRag17IngestionIntent',
  'genesisRag17SourceMention',
])
const LINE_WORKER_MEMORY_RECOVERY_TABLES = Object.freeze(['lineConversationJob', 'agentTraceEvent'])
const LINE_WORKER_MEMORY_STATES = Object.freeze(['NONE', 'PENDING', 'ACKNOWLEDGED', 'CLOSED'])
const LINE_WORKER_MEMORY_AUDIENCES = Object.freeze(['DIRECT', 'GROUP', 'ROOM'])
const LINE_WORKER_MEMORY_TRACE_KINDS = Object.freeze([
  'MEMORY_DELIVERY_PENDING', 'MEMORY_DELIVERY_ATTEMPT',
  'MEMORY_DELIVERY_ACKNOWLEDGED', 'MEMORY_DELIVERY_CLOSED',
])

function validSnapshotDate(value) {
  return value instanceof Date
    ? !Number.isNaN(value.getTime())
    : typeof value === 'string' && value.trim() && !Number.isNaN(new Date(value).getTime())
}

function snapshotTracePayload(row) {
  if (row?.payloadJson && typeof row.payloadJson === 'object' && !Array.isArray(row.payloadJson)) return row.payloadJson
  if (typeof row?.payloadJson !== 'string') return null
  try {
    const payload = JSON.parse(row.payloadJson)
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  } catch {
    return null
  }
}

function hasMemoryPendingCheckpoint(snapshot, job) {
  const traces = Array.isArray(snapshot?.tables?.agentTraceEvent) ? snapshot.tables.agentTraceEvent : []
  const messages = Array.isArray(snapshot?.tables?.message) ? snapshot.tables.message : []
  const conversations = Array.isArray(snapshot?.tables?.conversation) ? snapshot.tables.conversation : []
  return traces.some((trace) => {
    if (!trace || trace.kind !== 'MEMORY_DELIVERY_PENDING' || trace.turnId !== job.id
      || trace.tenantId !== job.tenantId || trace.businessId !== job.businessId
      || trace.idempotencyKey !== `memory-delivery:pending:${job.id}`
      || !validSnapshotDate(trace.occurredAt)) return false
    const payload = snapshotTracePayload(trace)
    if (!payload || payload.jobId !== job.id || payload.inboundMessageId !== job.inboundMessageId
      || payload.channelAccountId !== job.channelAccountId || payload.audienceKind !== job.audienceKind
      || payload.providerAcceptance !== 'ACCEPTED_BY_LINE'
      || typeof payload.outboundMessageId !== 'string' || !payload.outboundMessageId.trim()
      || payload.receiptId !== payload.outboundMessageId
      || typeof payload.externalThreadRef !== 'string' || !payload.externalThreadRef.trim()) return false
    const inbound = messages.find(message => message?.id === job.inboundMessageId)
    const outbound = messages.find(message => message?.id === payload.outboundMessageId)
    if (!inbound || inbound.direction !== 'INBOUND' || !outbound || outbound.direction !== 'OUTBOUND'
      || inbound.conversationId !== outbound.conversationId) return false
    const conversation = conversations.find(item => item?.id === inbound.conversationId)
    return conversation?.tenantId === job.tenantId && conversation.businessId === job.businessId
      && conversation.channel === 'LINE' && conversation.channelAccountId === job.channelAccountId
      && conversation.externalThreadId === payload.externalThreadRef
  })
}

// Parents precede children for restore; reverse order is used for deletion.
const SNAPSHOT_MODELS = [
  'portfolio', 'integrationProvider', 'tenant', 'legalEntity', 'legalEntityIdentifier', 'business', 'branch',
  // @req FR-186 — issuer/tax/PromptPay settings are Business-owned operating
  // configuration, while the LegalEntity and Branch identity above remain the
  // authoritative seller records.  The profile and numbering sequence must
  // restore before a CommerceDocument can be recreated.
  'businessBillingProfile', 'commerceDocumentSequence',
  // @req FR-081 — the ingestion tables hang off a connection, so they restore after
  // it and delete before the Tenant/Business they reference. The three integration
  // metadata models were absent from this list entirely; a restore silently dropped
  // them, which the new foreign keys turn from invisible data loss into a hard error.
  'integrationConnection', 'integrationCredential', 'ingestionRun', 'rawExternalRecord',
  'syncCursor', 'externalEntityRef', 'deadLetterRecord',
  // @req FR-092 — translated market state is restored after its Integration
  // evidence and before downstream projections exist.
  'marketObservation',
  // @req FR-146 — a LINE OA Studio account references a LINE_OA connection
  // (above) and a Business (top of this list), so it restores after both and
  // deletes before them. Operating truth, not credential material: it holds
  // no secret and is exported whole.
  'lineOaAccount',
  // @req FR-153 — a LIFF app registry row hangs off its account: design data,
  // no secret, exported whole.
  'lineOaLiffApp',
  // A roadmap hangs off a Business, a horizon off the roadmap, and a goal off
  // both — so they restore in that order and delete in the reverse. All three,
  // plus projectGoal and roleBinding below, were absent from this list until the
  // coverage check below started deriving it from the schema.
  'businessRoadmap', 'businessRoadmapHorizon', 'businessGoal',
  'person', 'customerImportBatch', 'customerImportReviewCase', 'membership', 'roleBinding',
  // @req FR-090 — both hang off Person, so they restore after it and delete
  // before it. A snapshot that omitted them would silently drop the credential
  // a person logs in with, which is the class of loss this list exists to stop.
  // @req FR-095 — a persisted session is a child of Person and must survive a
  // portable restore; raw token material is never exported by the model.
  // @req FR-094, FR-095 — MFA factors and Passkey credentials hang off Person and must survive restore to prevent lockout.
  'session', 'personCredential', 'passwordResetToken', 'mfaFactor', 'passkeyCredential',
  // @req FR-107 — an operator grant hangs off Person; a snapshot that omitted
  // it would restore an installation with no operator (or silently drop one).
  'platformGrant',
  // @req FR-067 — both hang off Portfolio (top of this list) and Person (just
  // above), so they restore here and delete in the reverse. Like
  // passwordResetToken, an invite's raw token is never exported — the model
  // stores only the SHA-256 digest (SEC-014).
  'workspaceMembership', 'workspaceInvite',
  // @req FR-089 — a Team hangs off a Business (restored at the top of this list)
  // and a TeamMembership off both that Team and the Person above, so they
  // restore in this order and delete in the reverse. `projectTeam` needs
  // `project` as well and therefore waits for the next line.
  'team', 'teamMembership',
  'workspace', 'project', 'planImportReceipt', 'projectTeam', 'projectGoal', 'workstream', 'workContainer', 'workItem',
  'milestone', 'gate', 'dependency', 'repository', 'projectRepository',
  'projectFile', 'fileAsset', 'fileLink',
  // @req FR-151 — a rich menu hangs off a LINE OA account (above) and its
  // versions reference the FileAsset image (just above), so both restore after
  // those and delete before them. Design data, no secret: exported whole.
  'lineOaRichMenu', 'lineOaRichMenuVersion',
  // @req FR-152 — a publish job references its account, menu and version, so it
  // restores after all three. Operational state only (stage, status, the
  // external richMenuId); it holds no token, so it is exported whole.
  'lineOaRichMenuJob',
  // @req FR-159, FR-158, FR-160 — preserve Marketing evidence after its PM and scope parents.
  // @tested tests/integration/marketing-backup.test.js
  'marketingPlan', 'marketingPlanVersion', 'marketingReview', 'marketingDecision', 'marketingHandoff', 'marketingInitiative',
  'marketingContentBrief', 'marketingContentVersion', 'marketingContentReview', 'marketingContentDecision',
  // @req FR-185 — restore planning identities before their immutable revisions.
  'marketingBroadcastIntent', 'marketingBroadcastIntentVersion',
  // @req FR-161 — Business-scoped Marketing intake is recoverable request
  // evidence; owner-domain PM/CRM/Commerce rows remain in their own tables.
  'marketingOperationsIntake',
  // @req FR-154, FR-155 — the Inventory domain hangs off Tenant and Business
  // (top of this list). Catalogue parents first — category, family and factory
  // before the master that references them, the master before its products,
  // products before the bundle items, lots and serial units that reference
  // them, and the ledger last because a movement names a lot and a serial
  // unit. Deletion is the reverse. Design and operating data, no secret:
  // exported whole.
  'inventoryCategory', 'productFamily', 'factory', 'productMaster', 'product',
  'productBundle', 'productBundleItem',
  // @req FR-156 — a recipe hangs off its output product and its lines off the
  // recipe and the component products, so both restore after `product`.
  'productRecipe', 'productRecipeLine',
  // @req FR-174 — a location hangs off its Business only, and every located
  // movement names it, so it restores BEFORE the ledger and deletes after it.
  'warehouseLocation',
  'productLot', 'serialUnit', 'stockMovement',
  // @req FR-184 — the lock-only revision follows the append-only ledger, and
  // the durable preview/result follows the fence. Reverse deletion removes
  // stocktake evidence before its fence and ledger parents.
  'inventoryLedgerFence', 'inventoryStocktake',
  // @req FR-176, FR-177, FR-180 — work orders and reservations reference
  // products, recipes and locations, all above, and nothing references them, so
  // they restore last of the Inventory block. They hold intent and progress,
  // never a quantity the ledger also holds; no secret, exported whole.
  'customizationWorkOrder', 'kittingWorkOrder', 'stockReservation',
  'externalRef', 'externalIdentity', 'channelIdentity', 'identityLinkToken',
  'pipelineRun', 'pipelineStep', 'pipelineEventReceipt', 'pipelineRecordEvent', 'pipelineReconciliation', 'pipelineGateDecision',
  // @req FR-110 — the evidence importer's per-scope cursor into GKS's export
  // (ADR-068 D2). No relation to any row here — its scope columns are GKS's
  // KnowledgeScope, not foreign keys — so it restores anywhere after the
  // ledger it feeds; a lost cursor only replays a page the receiver's
  // idempotency already makes harmless. Bookkeeping, no secret: exported whole.
  'knowledgeEvidenceCursor',
  // @req FR-109, FR-110 — restore versioned lineage after RawExternalRecord,
  // then the pre-Stage 1 intent, durable occurrences, attempt outbox, terminal
  // evidence and publication proof. Intent and occurrence rows deliberately
  // carry no foreign keys to pipeline data, so this order is a restore/delete
  // convention rather than a database constraint.
  // @req FR-173 — restore corpus parents before sources, jobs and immutable generations.
  'knowledgeCorpus', 'knowledgeSource', 'knowledgeIngestion', 'knowledgeCorpusGeneration',
  'knowledgeRawArtifact', 'knowledgeParsedArtifact', 'knowledgeChunk',
  'genesisRag17IngestionIntent', 'genesisRag17SourceMention',
  'genesisRag17Batch', 'genesisRag17StageEvidence', 'genesisRag17PublicationReceipt', 'genesisRag17EvidenceCursor',
  // @req FR-100 — a SoT decision hangs off Tenant (and optionally Business),
  // so it restores after them and deletes before them, alongside the pipeline
  // evidence it gates.
  'sotDecision',
  // @req FR-102 — a data-plane key hangs off Tenant only; like session/
  // personCredential above, only its hash restores, never the raw secret,
  // which the model never persists in the first place.
  'sotDataPlaneKey',
  // @req FR-106 — the Enterprise API key hangs off Tenant only; same rule as
  // sotDataPlaneKey above: only its hash restores, never the raw secret,
  // which the model never persists in the first place.
  'apiAccessKey',
  'customer', 'customerImportProvenance', 'customerImportReviewDecision', 'conversation', 'message',
  // @req FR-161 — a sales task hangs off Business, Person (assignee) and
  // optionally Customer and Conversation, so it restores after all of them.
  // Operating data, no secret: exported whole.
  'salesTask',
  // @req FR-166, FR-163 — an order hangs off Business, Customer and
  // Conversation, its lines off the order and Product, a payment off the order
  // and the slip FileAsset — all restored above this line, so these restore
  // here and delete in the reverse. Money and slip references, no secret.
  'salesOrder', 'salesOrderLine', 'payment',
  // @req FR-186 — issued documents are immutable evidence.  Their order and
  // branch parents are above, so restore them after payments and before the
  // audit stream; requestHash and sequenceNumber preserve idempotency and the
  // next number after recovery.
  'commerceDocument',
  // @req FR-164, FR-165 — a supplier hangs off Tenant and Business, a purchase
  // order off the supplier, its lines off the order and Product, a goods
  // receipt off the order and its lines off the receipt and the order lines —
  // parents first, so these restore here and delete in the reverse. Contact
  // and cost data, no secret: exported whole.
  'supplier', 'purchaseOrder', 'purchaseOrderLine', 'goodsReceipt', 'goodsReceiptLine',
  // Its account and inbound Message must both exist before restoring the ledger.
  'lineConversationJob',
  'agentTraceEvent',
  // @req FR-127 — analyses are derived children of Conversation and must travel
  // with it so an export/import round trip does not silently lose CRM context.
  'conversationAnalysis', 'auditEvent',
  // @req FR-133, FR-134, FR-135, FR-136 — Asset truth and its evidence,
  // reference, temporal and calculation history are one recoverable unit.
  // Parent rows precede children for restore; reverse deletion preserves FKs.
  'assetIntake', 'assetLot', 'registeredAsset', 'assetEvidence', 'assetProcurementRef',
  'assetResponsibility', 'assetLocationHistory', 'assetProjectAllocation', 'assetDepreciationCandidate',
]

/**
 * Models deliberately outside the snapshot, each with the reason it is not
 * restorable. `scripts/doc-preflight.mjs` derives the expected set from
 * `prisma/schema.prisma` and accepts a model only if it appears in
 * SNAPSHOT_MODELS or here — a name with no reason is not an exclusion, it is
 * the omission this pair exists to stop.
 *
 * RCA: .brain/rca/2026-08-18-snapshot-model-list-drifted-from-the-schema.md
 */
export const SNAPSHOT_EXCLUDED_MODELS = {
  pluginInstallation:
    'FR-123 first-party plugin installation bindings are security state, not business data. A restore clears ' +
    'them, so a recovered installation requires explicit plugin re-registration rather than inheriting a ' +
    'binding whose owner may no longer hold the authority it was granted under (ADR-052).',
  pluginAuthorizationCode:
    'FR-123 one-time authorization codes are short-lived credential material with a 60-second life. They are ' +
    'never exported or restored, so a recovery can never reopen a code-exchange window that had already closed.',
  pluginSession:
    'FR-123 opaque bearer sessions are credentials. They are never exported or restored, so a restore cannot ' +
    'carry an old plugin session forward past the revocation or expiry that ended it.',
  edgeDeviceCredential:
    'FR-144 edge device credentials are credential material — a SHA-256 lookup hash bound to one Business. ' +
    'They are never exported or restored, so a recovery cannot resurrect a key that was revoked, and a ' +
    'restored installation pairs its devices again under the authority that holds it then (SEC-025).',
  assetExtractionJob:
    'FR-143 extraction jobs are in-flight work, not business truth: a queued job names a device lease that ' +
    'expired the moment the installation stopped, and the candidate a completed one produced already lives ' +
    'on AssetEvidence.extractionJson, which IS exported. Restoring the queue would hand a device work whose ' +
    'result the restore already carries.',
  localWorkspaceMount:
    'Device-local mount paths. Deleted explicitly before the sweep and never restored: a mount names a ' +
    'filesystem on one machine, so carrying it into another installation would point at a path that does ' +
    'not exist there (SEC-007).',
}

function localAssets(snapshot) {
  return (snapshot?.tables?.fileAsset || []).filter((asset) => asset.storageKind === 'LOCAL_FILE' && asset.relativePath)
}

function contentManifest(snapshot) {
  return Array.isArray(snapshot?.fileContentManifest) ? snapshot.fileContentManifest : []
}

const KNOWLEDGE_ADMISSION_TABLES = ['knowledgeCorpus', 'knowledgeSource', 'knowledgeIngestion', 'knowledgeCorpusGeneration']

function admissionRecoveryManifest(snapshot) {
  const manifest = snapshot?.knowledgeAdmissionRecovery
  if (manifest === undefined) return { errors: [], warnings: ['KNOWLEDGE_ADMISSION_RECOVERY_UNAVAILABLE: snapshot has no admission recovery manifest'] }
  const errors = []
  if (manifest?.schemaVersion !== 'knowledge-admission-recovery.v1' || JSON.stringify(manifest?.requiredTables) !== JSON.stringify(KNOWLEDGE_ADMISSION_TABLES)) errors.push('Invalid knowledge admission recovery manifest')
  for (const table of KNOWLEDGE_ADMISSION_TABLES) if (!Array.isArray(snapshot?.tables?.[table])) errors.push(`Knowledge admission recovery snapshot is missing required table: ${table}`)
  return { errors, warnings: [] }
}

function recoveryManifest(snapshot) {
  const manifest = snapshot?.genesisRag17Recovery
  if (manifest === undefined) {
    return {
      errors: [],
      warnings: ['GENESISRAG17_RECOVERY_UNAVAILABLE: snapshot has no source recovery manifest; no missing intents or mentions will be invented'],
      recovery: { status: 'UNAVAILABLE', manifestVersion: null },
    }
  }
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push('GenesisRAG17 recovery manifest is not an object')
  } else {
    if (manifest.schemaVersion !== GENESIS_RAG17_RECOVERY_MANIFEST_VERSION) {
      errors.push(`Unsupported GenesisRAG17 recovery manifest version: ${manifest.schemaVersion} (expected ${GENESIS_RAG17_RECOVERY_MANIFEST_VERSION})`)
    }
    if (!Array.isArray(manifest.requiredTables) || manifest.requiredTables.length !== GENESIS_RAG17_RECOVERY_TABLES.length
      || manifest.requiredTables.some((model, index) => model !== GENESIS_RAG17_RECOVERY_TABLES[index])) {
      errors.push(`GenesisRAG17 recovery manifest must name ${GENESIS_RAG17_RECOVERY_TABLES.join(' and ')}`)
    }
    for (const model of GENESIS_RAG17_RECOVERY_TABLES) {
      if (!Array.isArray(snapshot?.tables?.[model])) errors.push(`GenesisRAG17 recovery snapshot is missing required table: ${model}`)
    }
  }
  return {
    errors,
    warnings: [],
    recovery: { status: errors.length ? 'INVALID' : 'AVAILABLE', manifestVersion: manifest?.schemaVersion || null },
  }
}

/**
 * Billing is a feature-specific recovery boundary. Older snapshots can still
 * be inspected by previewSnapshot, but previewImport must never replace live
 * billing evidence with empty arrays when those older snapshots omit the new
 * tables. A complete export also gets referential and sequence checks here so
 * a bad document cannot be restored as detached evidence.
 */
function commerceBillingRecovery(snapshot) {
  const tables = snapshot?.tables || {}
  const missing = COMMERCE_BILLING_RECOVERY_TABLES.filter((model) => !Array.isArray(tables[model]))
  const manifest = snapshot?.commerceBillingRecovery
  const result = {
    status: 'AVAILABLE',
    manifestVersion: manifest?.schemaVersion || null,
    errors: [],
    warnings: [],
  }

  // A manifest is an explicit claim that the artifact carries a complete
  // Commerce recovery set.  Treating a declared-but-incomplete manifest as an
  // old snapshot would make a malformed new export look safely importable on an
  // empty installation.  Only an artifact with no manifest at all gets the
  // backwards-compatible UNAVAILABLE state.
  if (manifest !== undefined && (
    !manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schemaVersion !== COMMERCE_BILLING_RECOVERY_MANIFEST_VERSION
    || JSON.stringify(manifest.requiredTables) !== JSON.stringify(COMMERCE_BILLING_RECOVERY_TABLES)
  )) {
    result.errors.push(`Invalid Commerce billing recovery manifest (expected ${COMMERCE_BILLING_RECOVERY_MANIFEST_VERSION})`)
  }
  if (manifest !== undefined && missing.length) {
    for (const model of missing) result.errors.push(`Commerce billing recovery snapshot is missing required table: ${model}`)
  }
  if (result.errors.length) {
    result.status = 'INVALID'
    return result
  }
  if (missing.length) {
    result.status = 'UNAVAILABLE'
    result.warnings.push(`COMMERCE_BILLING_RECOVERY_UNAVAILABLE: snapshot is missing ${missing.join(', ')}`)
    return result
  }

  const tenants = new Map((tables.tenant || []).map((row) => [row.id, row]))
  const businesses = new Map((tables.business || []).map((row) => [row.id, row]))
  const branches = new Map((tables.branch || []).map((row) => [row.id, row]))
  const orders = new Map((tables.salesOrder || []).map((row) => [row.id, row]))
  const sequences = new Map()
  for (const row of tables.businessBillingProfile) {
    const label = row?.id || '<unknown>'
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      result.errors.push(`Commerce billing profile ${label} is not an object`)
      continue
    }
    const business = businesses.get(row.businessId)
    const tenant = tenants.get(row.tenantId)
    if (!business || business.tenantId !== row.tenantId || !tenant) result.errors.push(`Commerce billing profile ${row.id} has inconsistent Business/Tenant references`)
    if (!Number.isInteger(row.version) || row.version <= 0 || row.version > 2_147_483_647) result.errors.push(`Commerce billing profile ${row.id} has an invalid version`)
    if (row.vatRateBps !== null && row.vatRateBps !== undefined && (!Number.isInteger(row.vatRateBps) || row.vatRateBps < 0 || row.vatRateBps > 10000)) result.errors.push(`Commerce billing profile ${row.id} has an invalid VAT rate`)
    if (row.vatTreatment !== null && row.vatTreatment !== undefined && !BILLING_VAT_TREATMENTS.includes(row.vatTreatment)) result.errors.push(`Commerce billing profile ${row.id} has an invalid VAT treatment`)
    if (row.nonVatDocumentPolicy !== null && row.nonVatDocumentPolicy !== undefined && !BILLING_NON_VAT_POLICIES.includes(row.nonVatDocumentPolicy)) result.errors.push(`Commerce billing profile ${row.id} has an invalid non-VAT policy`)
    if (row.walkInDocumentPolicy !== null && row.walkInDocumentPolicy !== undefined && !BILLING_WALK_IN_POLICIES.includes(row.walkInDocumentPolicy)) result.errors.push(`Commerce billing profile ${row.id} has an invalid walk-in policy`)
    if (row.promptPayProvider !== null && row.promptPayProvider !== undefined && row.promptPayProvider !== BILLING_PROMPTPAY_PROVIDER) result.errors.push(`Commerce billing profile ${row.id} has an invalid PromptPay provider`)
    if (row.promptPayTargetType !== null && row.promptPayTargetType !== undefined && !BILLING_TARGET_TYPES.includes(row.promptPayTargetType)) result.errors.push(`Commerce billing profile ${row.id} has an invalid PromptPay target type`)
  }
  for (const row of tables.commerceDocumentSequence) {
    const label = row?.id || '<unknown>'
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      result.errors.push(`Commerce billing sequence ${label} is not an object`)
      continue
    }
    const business = businesses.get(row.businessId)
    const tenant = tenants.get(row.tenantId)
    if (!business || business.tenantId !== row.tenantId || !tenant) result.errors.push(`Commerce billing sequence ${row.id} has inconsistent Business/Tenant references`)
    if (!BILLING_DOCUMENT_TYPES.includes(row.documentType)) result.errors.push(`Commerce billing sequence ${row.id} has an invalid documentType`)
    if (!Number.isInteger(row.calendarYear) || row.calendarYear <= 0 || row.calendarYear > 2_147_483_647) result.errors.push(`Commerce billing sequence ${row.id} has an invalid calendarYear`)
    if (!Number.isInteger(row.lastSequence) || row.lastSequence < 0 || row.lastSequence > 2_147_483_647) result.errors.push(`Commerce billing sequence ${row.id} has an invalid lastSequence`)
    sequences.set(`${row.businessId}|${row.documentType}|${row.calendarYear}`, row)
  }
  const documentKeys = new Set()
  for (const row of tables.commerceDocument) {
    const label = row?.id || '<unknown>'
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      result.errors.push(`Commerce document ${label} is not an object`)
      continue
    }
    const business = businesses.get(row.businessId)
    const tenant = tenants.get(row.tenantId)
    const order = orders.get(row.orderId)
    const branch = branches.get(row.branchId)
    if (!business || business.tenantId !== row.tenantId || !tenant) result.errors.push(`Commerce document ${row.id} has inconsistent Business/Tenant references`)
    if (!order || order.businessId !== row.businessId || order.tenantId !== row.tenantId) result.errors.push(`Commerce document ${row.id} has an inconsistent SalesOrder reference`)
    if (!branch || branch.businessId !== row.businessId || branch.tenantId !== row.tenantId) result.errors.push(`Commerce document ${row.id} has an inconsistent Branch reference`)
    if (!BILLING_DOCUMENT_TYPES.includes(row.documentType)) result.errors.push(`Commerce document ${row.id} has an invalid documentType`)
    if (!COMMERCE_BILLING_DOCUMENT_STATUSES.includes(row.status)) result.errors.push(`Commerce document ${row.id} has an invalid status`)
    if (!Number.isInteger(row.calendarYear) || row.calendarYear <= 0 || row.calendarYear > 2_147_483_647) result.errors.push(`Commerce document ${row.id} has an invalid calendarYear`)
    if (!row.requestHash || typeof row.requestHash !== 'string') result.errors.push(`Commerce document ${row.id} is missing requestHash`)
    if (!Number.isInteger(row.sequenceNumber) || row.sequenceNumber <= 0 || row.sequenceNumber > 2_147_483_647) result.errors.push(`Commerce document ${row.id} has an invalid sequenceNumber`)
    if (!row.idempotencyKey || typeof row.idempotencyKey !== 'string') result.errors.push(`Commerce document ${row.id} is missing idempotencyKey`)
    if (!row.documentNumber || typeof row.documentNumber !== 'string') result.errors.push(`Commerce document ${row.id} is missing documentNumber`)
    if (typeof row.snapshotJson !== 'string') {
      result.errors.push(`Commerce document ${row.id} has an invalid snapshotJson`)
    } else {
      try {
        const parsed = JSON.parse(row.snapshotJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) result.errors.push(`Commerce document ${row.id} has an invalid snapshotJson`)
      } catch {
        result.errors.push(`Commerce document ${row.id} has an invalid snapshotJson`)
      }
    }
    const sequenceKey = `${row.businessId}|${row.documentType}|${row.calendarYear}`
    const sequence = sequences.get(sequenceKey)
    if (!sequence) result.errors.push(`Commerce document ${row.id} has no matching sequence row`)
    else if (row.sequenceNumber > sequence.lastSequence) result.errors.push(`Commerce document ${row.id} exceeds its restored sequence counter`)
    const duplicateKey = `${row.businessId}|${row.documentType}|${row.calendarYear}|${row.sequenceNumber}`
    if (documentKeys.has(duplicateKey)) result.errors.push(`Commerce documents reuse sequence ${duplicateKey}`)
    documentKeys.add(duplicateKey)
  }
  return result
}

/**
 * Stocktake is a feature-specific recovery boundary for the same reason as
 * Commerce billing: a legacy snapshot may predate these tables, but a newly
 * declared manifest must be complete and structurally safe before the global
 * replacement transaction is allowed to delete anything.
 */
function inventoryStocktakeRecovery(snapshot) {
  const tables = snapshot?.tables || {}
  const missing = INVENTORY_STOCKTAKE_RECOVERY_TABLES.filter((model) => !Array.isArray(tables[model]))
  const manifest = snapshot?.inventoryStocktakeRecovery
  const result = {
    status: 'AVAILABLE',
    manifestVersion: manifest?.schemaVersion || null,
    errors: [],
    warnings: [],
  }

  // Presence of the two arrays alone is not provenance. A legacy artifact may
  // contain ad-hoc keys, but only the declared manifest makes their completeness
  // part of the recovery contract.
  if (manifest === undefined) {
    result.status = 'UNAVAILABLE'
    result.warnings.push('INVENTORY_STOCKTAKE_RECOVERY_UNAVAILABLE: snapshot has no stocktake recovery manifest')
    return result
  }

  if (
    !manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schemaVersion !== INVENTORY_STOCKTAKE_RECOVERY_MANIFEST_VERSION
    || JSON.stringify(manifest.requiredTables) !== JSON.stringify(INVENTORY_STOCKTAKE_RECOVERY_TABLES)
  ) {
    result.errors.push(`Invalid Inventory stocktake recovery manifest (expected ${INVENTORY_STOCKTAKE_RECOVERY_MANIFEST_VERSION})`)
  }
  if (missing.length) {
    for (const model of missing) result.errors.push(`Inventory stocktake recovery snapshot is missing required table: ${model}`)
  }
  if (result.errors.length) {
    result.status = 'INVALID'
    return result
  }
  if (missing.length) {
    result.status = 'UNAVAILABLE'
    result.warnings.push(`INVENTORY_STOCKTAKE_RECOVERY_UNAVAILABLE: snapshot is missing ${missing.join(', ')}`)
    return result
  }

  const tenants = new Map((tables.tenant || []).map((row) => [row?.id, row]))
  const businesses = new Map((tables.business || []).map((row) => [row?.id, row]))
  const fences = new Map()
  const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  const nonEmpty = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max
  const int32 = (value, minimum = 0) => Number.isInteger(value) && value >= minimum && value <= INT32_MAX
  const signedInt32 = (value) => int32(value, -INT32_MAX - 1)
  const aggregateInt = (value) => Number.isSafeInteger(value)
    && value >= (-INT32_MAX - 1) * INVENTORY_STOCKTAKE_MAX_LINES
    && value <= INT32_MAX * INVENTORY_STOCKTAKE_MAX_LINES
  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  const stocktakeLineKey = (line) => JSON.stringify([line?.productId, line?.locationId ?? null, line?.lotId ?? null])
  const addIdentityError = (row, label, fields) => {
    for (const field of fields) if (!uuid(row?.[field])) result.errors.push(`Inventory stocktake ${label} ${field} is not a UUID`)
  }
  const movementById = new Map()
  if (Array.isArray(tables.stockMovement)) {
    for (const movement of tables.stockMovement) {
      if (!isObject(movement) || !uuid(movement.id)) continue
      if (movementById.has(movement.id)) result.errors.push(`Inventory stocktake recovery reuses StockMovement id ${movement.id}`)
      movementById.set(movement.id, movement)
    }
  }

  for (const row of tables.inventoryLedgerFence) {
    const label = row?.id || '<unknown>'
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      result.errors.push(`Inventory ledger fence ${label} is not an object`)
      continue
    }
    addIdentityError(row, 'ledger fence', ['id', 'tenantId', 'businessId'])
    if (!int32(row.mutationRevision)) result.errors.push(`Inventory ledger fence ${row.id} has an invalid mutationRevision`)
    const business = businesses.get(row.businessId)
    const tenant = tenants.get(row.tenantId)
    if (business && business.tenantId !== row.tenantId) result.errors.push(`Inventory ledger fence ${row.id} has an inconsistent Business/Tenant reference`)
    if (tenants.size && !tenant) result.errors.push(`Inventory ledger fence ${row.id} references a missing Tenant`)
    if (businesses.size && !business) result.errors.push(`Inventory ledger fence ${row.id} references a missing Business`)
    const key = `${row.tenantId}|${row.businessId}`
    if (fences.has(key)) result.errors.push(`Inventory ledger fences reuse scope ${key}`)
    fences.set(key, row)
  }

  const stocktakeKeys = new Set()
  for (const row of tables.inventoryStocktake) {
    const label = row?.id || '<unknown>'
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      result.errors.push(`Inventory stocktake ${label} is not an object`)
      continue
    }
    addIdentityError(row, 'stocktake', ['id', 'tenantId', 'businessId'])
    if (!nonEmpty(row.idempotencyKey)) result.errors.push(`Inventory stocktake ${row.id} is missing idempotencyKey`)
    if (!nonEmpty(row.payloadHash, 128)) result.errors.push(`Inventory stocktake ${row.id} is missing payloadHash`)
    if (!nonEmpty(row.snapshotHash, 128)) result.errors.push(`Inventory stocktake ${row.id} is missing snapshotHash`)
    if (!int32(row.snapshotVersion)) result.errors.push(`Inventory stocktake ${row.id} has an invalid snapshotVersion`)
    if (!int32(row.version, 1)) result.errors.push(`Inventory stocktake ${row.id} has an invalid version`)
    if (!INVENTORY_STOCKTAKE_STATUSES.includes(row.status)) result.errors.push(`Inventory stocktake ${row.id} has an invalid status`)
    const business = businesses.get(row.businessId)
    const tenant = tenants.get(row.tenantId)
    if (business && business.tenantId !== row.tenantId) result.errors.push(`Inventory stocktake ${row.id} has an inconsistent Business/Tenant reference`)
    if (tenants.size && !tenant) result.errors.push(`Inventory stocktake ${row.id} references a missing Tenant`)
    if (businesses.size && !business) result.errors.push(`Inventory stocktake ${row.id} references a missing Business`)
    const scopeKey = `${row.tenantId}|${row.businessId}|${row.idempotencyKey}`
    if (stocktakeKeys.has(scopeKey)) result.errors.push(`Inventory stocktakes reuse idempotency key ${scopeKey}`)
    stocktakeKeys.add(scopeKey)

    let parsed = null
    if (typeof row.normalizedLinesJson !== 'string') {
      result.errors.push(`Inventory stocktake ${row.id} has an invalid normalizedLinesJson`)
    } else {
      try {
        parsed = JSON.parse(row.normalizedLinesJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      } catch {
        result.errors.push(`Inventory stocktake ${row.id} has an invalid normalizedLinesJson`)
      }
    }
    if (parsed) {
      if (!Array.isArray(parsed.requestLines) || !parsed.requestLines.length || !Array.isArray(parsed.lines) || !parsed.lines.length || !Array.isArray(parsed.missingBuckets) || typeof parsed.complete !== 'boolean') {
        result.errors.push(`Inventory stocktake ${row.id} has an invalid normalized snapshot shape`)
      }
      if (Array.isArray(parsed.requestLines) && Array.isArray(parsed.lines) && parsed.requestLines.length !== parsed.lines.length) {
        result.errors.push(`Inventory stocktake ${row.id} has mismatched request and snapshot line counts`)
      }
      if (parsed.snapshotVersion !== row.snapshotVersion || parsed.snapshotHash !== row.snapshotHash) result.errors.push(`Inventory stocktake ${row.id} has an inconsistent snapshot token`)
      const { snapshotHash, ...hashable } = parsed
      if (snapshotHash && uuid(row.businessId) && hashStocktake({ businessId: row.businessId, snapshotVersion: row.snapshotVersion, ...hashable }) !== row.snapshotHash) result.errors.push(`Inventory stocktake ${row.id} has an invalid snapshot hash`)
      for (const line of (Array.isArray(parsed.requestLines) ? parsed.requestLines : [])) {
        if (!isObject(line)) {
          result.errors.push(`Inventory stocktake ${row.id} has a malformed request line`)
          continue
        }
        addIdentityError(line, 'request line', ['productId'])
        if (line.locationId !== null && !uuid(line.locationId)) result.errors.push(`Inventory stocktake ${row.id} has an invalid request locationId`)
        if (line.lotId !== null && !uuid(line.lotId)) result.errors.push(`Inventory stocktake ${row.id} has an invalid request lotId`)
        if (!int32(line.countedQuantity)) result.errors.push(`Inventory stocktake ${row.id} has an invalid countedQuantity`)
      }
      for (const line of (Array.isArray(parsed.lines) ? parsed.lines : [])) {
        if (!isObject(line)) {
          result.errors.push(`Inventory stocktake ${row.id} has a malformed snapshot line`)
          continue
        }
        addIdentityError(line, 'snapshot line', ['productId'])
        if (line.locationId !== null && !uuid(line.locationId)) result.errors.push(`Inventory stocktake ${row.id} has an invalid snapshot locationId`)
        if (line.lotId !== null && !uuid(line.lotId)) result.errors.push(`Inventory stocktake ${row.id} has an invalid snapshot lotId`)
        if (!int32(line.countedQuantity) || !signedInt32(line.expectedQuantity) || !signedInt32(line.variance)) result.errors.push(`Inventory stocktake ${row.id} has invalid snapshot quantities`)
      }
    }

    let resultJson = null
    if (row.resultJson !== null && row.resultJson !== undefined) {
      if (typeof row.resultJson !== 'string') result.errors.push(`Inventory stocktake ${row.id} has an invalid resultJson`)
      else {
        try {
          resultJson = JSON.parse(row.resultJson)
          if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) throw new Error('not an object')
        } catch {
          result.errors.push(`Inventory stocktake ${row.id} has an invalid resultJson`)
        }
      }
    }
    if (row.status === 'COMMITTED' && !resultJson) result.errors.push(`Inventory stocktake ${row.id} is COMMITTED without resultJson`)
    if (row.status === 'PREVIEWED' && resultJson) result.errors.push(`Inventory stocktake ${row.id} is PREVIEWED with a commit result`)
    if (row.status === 'COMMITTED' && !row.committedAt) result.errors.push(`Inventory stocktake ${row.id} is COMMITTED without committedAt`)
    if (row.status === 'PREVIEWED' && row.committedAt) result.errors.push(`Inventory stocktake ${row.id} is PREVIEWED with committedAt`)
    if (resultJson) {
      const movementIdsValid = Array.isArray(resultJson.movementIds)
      const movementCountValid = int32(resultJson.movementCount)
      const varianceTotalValid = aggregateInt(resultJson.varianceTotal)
      const lineBalancesValid = Array.isArray(resultJson.lineBalances)
      const fenceRevisionValid = int32(resultJson.fenceRevision)
      if (!movementIdsValid || !movementCountValid || !varianceTotalValid || !lineBalancesValid || !fenceRevisionValid) {
        result.errors.push(`Inventory stocktake ${row.id} has an invalid commit result`)
      }
      const movementIds = movementIdsValid ? resultJson.movementIds : []
      const seenMovementIds = new Set()
      for (const movementId of movementIds) {
        if (!uuid(movementId)) {
          result.errors.push(`Inventory stocktake ${row.id} has an invalid StockMovement id`)
          continue
        }
        if (seenMovementIds.has(movementId)) result.errors.push(`Inventory stocktake ${row.id} has duplicate StockMovement id ${movementId}`)
        seenMovementIds.add(movementId)
      }
      if (movementCountValid && resultJson.movementCount !== movementIds.length) {
        result.errors.push(`Inventory stocktake ${row.id} has movementCount inconsistent with movementIds`)
      }

      const snapshotLines = Array.isArray(parsed?.lines) ? parsed.lines : []
      const validSnapshotLines = snapshotLines.length > 0 && snapshotLines.every((line) => (
        isObject(line)
        && uuid(line.productId)
        && (line.locationId === null || uuid(line.locationId))
        && (line.lotId === null || uuid(line.lotId))
        && int32(line.countedQuantity)
        && signedInt32(line.expectedQuantity)
        && signedInt32(line.variance)
      ))
      const snapshotLineByKey = new Map(validSnapshotLines ? snapshotLines.map((line) => [stocktakeLineKey(line), line]) : [])
      const resultLineByKey = new Map()
      let varianceSum = 0
      if (lineBalancesValid) {
        if (validSnapshotLines && resultJson.lineBalances.length !== snapshotLines.length) {
          result.errors.push(`Inventory stocktake ${row.id} has a result line count inconsistent with its snapshot`)
        }
        for (const line of resultJson.lineBalances) {
          if (!isObject(line)) {
            result.errors.push(`Inventory stocktake ${row.id} has a malformed result line`)
            continue
          }
          addIdentityError(line, 'result line', ['productId'])
          if (line.locationId !== null && !uuid(line.locationId)) result.errors.push(`Inventory stocktake ${row.id} has an invalid result locationId`)
          if (line.lotId !== null && !uuid(line.lotId)) result.errors.push(`Inventory stocktake ${row.id} has an invalid result lotId`)
          const quantitiesValid = int32(line.countedQuantity)
            && signedInt32(line.expectedQuantity)
            && signedInt32(line.variance)
            && int32(line.postCommitQuantity)
          if (!quantitiesValid) result.errors.push(`Inventory stocktake ${row.id} has invalid result quantities`)
          if (quantitiesValid && line.postCommitQuantity !== line.countedQuantity) result.errors.push(`Inventory stocktake ${row.id} has an invalid post-commit quantity`)
          const key = stocktakeLineKey(line)
          if (resultLineByKey.has(key)) result.errors.push(`Inventory stocktake ${row.id} reuses a result line identity`)
          resultLineByKey.set(key, line)
          if (quantitiesValid) {
            varianceSum += line.variance
          }
          const snapshotLine = snapshotLineByKey.get(key)
          if (!snapshotLine) result.errors.push(`Inventory stocktake ${row.id} has a result line absent from its snapshot`)
          else if (
            line.expectedQuantity !== snapshotLine.expectedQuantity
            || line.countedQuantity !== snapshotLine.countedQuantity
            || line.variance !== snapshotLine.variance
          ) result.errors.push(`Inventory stocktake ${row.id} has a result line inconsistent with its snapshot`)
        }
        if (validSnapshotLines) {
          for (const line of snapshotLines) {
            if (!resultLineByKey.has(stocktakeLineKey(line))) result.errors.push(`Inventory stocktake ${row.id} is missing a result line`)
          }
        }
        if (varianceTotalValid && (!aggregateInt(varianceSum) || resultJson.varianceTotal !== varianceSum)) {
          result.errors.push(`Inventory stocktake ${row.id} has a varianceTotal inconsistent with its result lines`)
        }
      }

      if (row.status === 'COMMITTED') {
        if (!Array.isArray(tables.stockMovement)) {
          result.errors.push(`Inventory stocktake ${row.id} is COMMITTED without a StockMovement snapshot`)
        }
        const referencedMovements = []
        for (const movementId of movementIds) {
          const movement = movementById.get(movementId)
          if (!movement) {
            result.errors.push(`Inventory stocktake ${row.id} references missing StockMovement ${movementId}`)
            continue
          }
          if (movement.tenantId !== row.tenantId || movement.businessId !== row.businessId) {
            result.errors.push(`Inventory stocktake ${row.id} references a StockMovement outside its Tenant/Business scope`)
          }
          if (movement.kind !== 'ADJUSTMENT') result.errors.push(`Inventory stocktake ${row.id} references a non-ADJUSTMENT StockMovement`)
          if (movement.reference !== `STOCKTAKE:${row.id}`) result.errors.push(`Inventory stocktake ${row.id} references a StockMovement with an inconsistent reference`)
          if (!uuid(movement.productId) || (movement.lotId !== null && !uuid(movement.lotId))) result.errors.push(`Inventory stocktake ${row.id} references a StockMovement with an invalid product or lot identity`)
          if ((movement.sourceLocationId !== null && !uuid(movement.sourceLocationId)) || (movement.targetLocationId !== null && !uuid(movement.targetLocationId))) {
            result.errors.push(`Inventory stocktake ${row.id} references a StockMovement with an invalid location identity`)
          }
          if (!signedInt32(movement.quantity) || movement.quantity === 0) {
            result.errors.push(`Inventory stocktake ${row.id} references a StockMovement with an invalid quantity`)
          } else referencedMovements.push(movement)
        }
        if (referencedMovements.length === movementIds.length && varianceTotalValid) {
          const movementVarianceTotal = referencedMovements.reduce((sum, movement) => sum + movement.quantity, 0)
          if (!aggregateInt(movementVarianceTotal) || movementVarianceTotal !== resultJson.varianceTotal) {
            result.errors.push(`Inventory stocktake ${row.id} has StockMovement quantities inconsistent with varianceTotal`)
          }
        }
        if (validSnapshotLines && lineBalancesValid) {
          const movementsByLine = new Map()
          for (const movement of referencedMovements) {
            const positive = movement.quantity > 0
            const locationId = positive ? movement.targetLocationId : movement.sourceLocationId
            const oppositeLocation = positive ? movement.sourceLocationId : movement.targetLocationId
            if (oppositeLocation !== null) result.errors.push(`Inventory stocktake ${row.id} has a StockMovement with two locations`)
            const key = stocktakeLineKey({ productId: movement.productId, locationId: locationId ?? null, lotId: movement.lotId ?? null })
            const line = resultLineByKey.get(key)
            if (!line) {
              result.errors.push(`Inventory stocktake ${row.id} has a StockMovement absent from its result lines`)
              continue
            }
            movementsByLine.set(key, (movementsByLine.get(key) || 0) + 1)
            if (movement.quantity !== line.variance) result.errors.push(`Inventory stocktake ${row.id} has a StockMovement quantity inconsistent with its result line`)
          }
          for (const line of snapshotLines) {
            const movementCount = movementsByLine.get(stocktakeLineKey(line)) || 0
            if (line.variance === 0 && movementCount !== 0) result.errors.push(`Inventory stocktake ${row.id} has a movement for a zero-variance line`)
            if (line.variance !== 0 && movementCount !== 1) result.errors.push(`Inventory stocktake ${row.id} has an incorrect movement count for a nonzero line`)
          }
        }
      }
    }
    const fence = fences.get(`${row.tenantId}|${row.businessId}`)
    if (fence && row.snapshotVersion > fence.mutationRevision) result.errors.push(`Inventory stocktake ${row.id} exceeds its restored fence revision`)
    if (fence && resultJson && (resultJson.fenceRevision < row.snapshotVersion || resultJson.fenceRevision > fence.mutationRevision)) result.errors.push(`Inventory stocktake ${row.id} has an inconsistent fence revision`)
  }
  if (result.errors.length) result.status = 'INVALID'
  return result
}

function lineWorkerMemoryRecovery(snapshot) {
  const tables = snapshot?.tables || {}
  const manifest = snapshot?.lineWorkerMemoryRecovery
  const rows = Array.isArray(tables.lineConversationJob) ? tables.lineConversationJob : []
  const result = { status: 'UNAVAILABLE', manifestVersion: manifest?.schemaVersion || null, errors: [], warnings: [] }
  if (manifest === undefined) {
    result.warnings.push('LINE_WORKER_MEMORY_RECOVERY_UNAVAILABLE: snapshot has no memory recovery manifest; pending memory receipts are not claimed as preserved')
    if (rows.some((row) => row?.memorySyncOptIn === true
      || (typeof row?.memoryDeliveryState === 'string' && row.memoryDeliveryState !== 'NONE'))) {
      result.warnings.push('LINE_WORKER_MEMORY_RECOVERY_UNAVAILABLE: memory fields in a legacy snapshot are untrusted and will be restored as opt-out defaults')
    }
    return result
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schemaVersion !== LINE_WORKER_MEMORY_RECOVERY_MANIFEST_VERSION
    || JSON.stringify(manifest.requiredTables) !== JSON.stringify(LINE_WORKER_MEMORY_RECOVERY_TABLES)) {
    result.errors.push(`Invalid LINE worker memory recovery manifest (expected ${LINE_WORKER_MEMORY_RECOVERY_MANIFEST_VERSION})`)
  }
  for (const model of LINE_WORKER_MEMORY_RECOVERY_TABLES) {
    if (!Array.isArray(tables[model])) result.errors.push(`LINE worker memory recovery snapshot is missing required table: ${model}`)
  }
  for (const row of rows) {
    const label = row?.id || '<unknown>'
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      result.errors.push(`LINE worker memory recovery job ${label} is not an object`)
      continue
    }
    if (typeof row.memorySyncOptIn !== 'boolean') result.errors.push(`LINE worker memory recovery job ${label} has an invalid memorySyncOptIn`)
    if (!LINE_WORKER_MEMORY_STATES.includes(row.memoryDeliveryState)) result.errors.push(`LINE worker memory recovery job ${label} has an invalid memoryDeliveryState`)
    if (!Number.isInteger(row.memoryDeliveryAttempts) || row.memoryDeliveryAttempts < 0) result.errors.push(`LINE worker memory recovery job ${label} has an invalid memoryDeliveryAttempts`)
    if (!LINE_WORKER_MEMORY_AUDIENCES.includes(row.audienceKind)) result.errors.push(`LINE worker memory recovery job ${label} has an invalid audienceKind`)
    for (const field of ['memoryDeliveryNextAttemptAt', 'memoryDeliveryLeaseUntil']) {
      const value = row[field]
      const validDate = value === null || validSnapshotDate(value)
      if (!validDate) result.errors.push(`LINE worker memory recovery job ${label} has an invalid ${field}`)
    }
    if (row.memorySyncOptIn === false && row.memoryDeliveryState !== 'NONE') {
      result.errors.push(`LINE worker memory recovery job ${label} has opt-out memory with non-NONE state`)
    }
    if (row.memoryDeliveryState === 'NONE'
      && (row.memoryDeliveryAttempts !== 0 || row.memoryDeliveryNextAttemptAt !== null || row.memoryDeliveryLeaseUntil !== null)) {
      result.errors.push(`LINE worker memory recovery job ${label} has operational memory fields with NONE state`)
    }
    if (row.memoryDeliveryState !== 'PENDING'
      && (row.memoryDeliveryNextAttemptAt !== null || row.memoryDeliveryLeaseUntil !== null)) {
      result.errors.push(`LINE worker memory recovery job ${label} has a retry cursor on a terminal state`)
    }
    if (row.memoryDeliveryState === 'PENDING') {
      if (row.status !== 'RECORDED') result.errors.push(`LINE worker memory recovery job ${label} has pending memory without RECORDED status`)
      if (!validSnapshotDate(row.acceptedAt)) result.errors.push(`LINE worker memory recovery job ${label} has pending memory without provider acceptance time`)
      if (!hasMemoryPendingCheckpoint(snapshot, row)) {
        result.errors.push(`LINE worker memory recovery job ${label} has no matching scoped MEMORY_DELIVERY_PENDING checkpoint`)
      }
    }
  }
  if (result.errors.length) result.status = 'INVALID'
  else result.status = 'AVAILABLE'
  return result
}

function marketingBroadcastRecovery(snapshot) {
  const tables = snapshot?.tables || {}
  const missing = MARKETING_BROADCAST_RECOVERY_TABLES.filter((model) => !Array.isArray(tables[model]))
  const manifest = snapshot?.marketingBroadcastRecovery
  const result = {
    status: 'AVAILABLE',
    manifestVersion: manifest?.schemaVersion || null,
    errors: [],
    warnings: [],
  }
  if (manifest === undefined) {
    result.status = 'UNAVAILABLE'
    result.warnings.push('MARKETING_BROADCAST_RECOVERY_UNAVAILABLE: snapshot has no broadcast recovery manifest')
    return result
  }
  if (manifest !== undefined && (
    !manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schemaVersion !== MARKETING_BROADCAST_RECOVERY_MANIFEST_VERSION
    || JSON.stringify(manifest.requiredTables) !== JSON.stringify(MARKETING_BROADCAST_RECOVERY_TABLES)
  )) result.errors.push(`Invalid Marketing broadcast recovery manifest (expected ${MARKETING_BROADCAST_RECOVERY_MANIFEST_VERSION})`)
  if (manifest !== undefined && missing.length) for (const model of missing) result.errors.push(`Marketing broadcast recovery snapshot is missing required table: ${model}`)
  if (result.errors.length) {
    result.status = 'INVALID'
    return result
  }
  if (missing.length) {
    result.status = 'UNAVAILABLE'
    result.warnings.push(`MARKETING_BROADCAST_RECOVERY_UNAVAILABLE: snapshot is missing ${missing.join(', ')}`)
    return result
  }

  const tenants = new Map((tables.tenant || []).map((row) => [row.id, row]))
  const businesses = new Map((tables.business || []).map((row) => [row.id, row]))
  const accounts = new Map((tables.lineOaAccount || []).map((row) => [row.id, row]))
  const content = new Map((tables.marketingContentVersion || []).map((row) => [row.id, row]))
  const briefs = new Map((tables.marketingContentBrief || []).map((row) => [row.id, row]))
  const intents = new Map()
  const idempotency = new Set()
  const codes = new Set()
  for (const row of tables.marketingBroadcastIntent) {
    const label = row?.id || '<unknown>'
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      result.errors.push(`Marketing broadcast intent ${label} is not an object`)
      continue
    }
    if (intents.has(row.id)) result.errors.push(`Marketing broadcast intents reuse id ${row.id}`)
    intents.set(row.id, row)
    const business = businesses.get(row.businessId)
    const tenant = tenants.get(row.tenantId)
    if (!business || business.tenantId !== row.tenantId || !tenant) result.errors.push(`Marketing broadcast intent ${row.id} has inconsistent Business/Tenant references`)
    if (!row.code || !row.idempotencyKey || !row.createdBy) result.errors.push(`Marketing broadcast intent ${row.id} is missing identity fields`)
    if (!BROADCAST_INTENT_STATUSES.includes(row.status)) result.errors.push(`Marketing broadcast intent ${row.id} has invalid status`)
    if (!Number.isInteger(row.currentRevision) || row.currentRevision < 1) result.errors.push(`Marketing broadcast intent ${row.id} has invalid currentRevision`)
    if (!Number.isInteger(row.version) || row.version < 1) result.errors.push(`Marketing broadcast intent ${row.id} has invalid version`)
    const idempotencyKey = `${row.businessId}|${row.idempotencyKey}`
    const codeKey = `${row.businessId}|${row.code}`
    if (idempotency.has(idempotencyKey)) result.errors.push(`Marketing broadcast intents reuse idempotency key ${idempotencyKey}`)
    if (codes.has(codeKey)) result.errors.push(`Marketing broadcast intents reuse code ${codeKey}`)
    idempotency.add(idempotencyKey)
    codes.add(codeKey)
  }
  const revisions = new Map()
  for (const row of tables.marketingBroadcastIntentVersion) {
    const label = row?.id || '<unknown>'
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      result.errors.push(`Marketing broadcast version ${label} is not an object`)
      continue
    }
    const intent = intents.get(row.intentId)
    if (!intent) {
      result.errors.push(`Marketing broadcast version ${row.id} references a missing intent`)
      continue
    }
    const key = `${row.intentId}|${row.revision}`
    if (revisions.has(key)) result.errors.push(`Marketing broadcast versions reuse revision ${key}`)
    revisions.set(key, row)
    if (!Number.isInteger(row.revision) || row.revision < 1) result.errors.push(`Marketing broadcast version ${row.id} has invalid revision`)
    try {
      const value = parseMarketingBroadcastPayload(row.payloadJson, row.payloadHash)
      if (hashMarketingBroadcastPayload(value) !== row.payloadHash) result.errors.push(`Marketing broadcast version ${row.id} has a non-canonical payload hash`)
      const brief = briefs.get(value.content.briefId)
      const contentVersion = content.get(value.content.contentVersionId)
      if (!brief || brief.businessId !== intent.businessId) result.errors.push(`Marketing broadcast version ${row.id} references content outside its Business`)
      if (!contentVersion || contentVersion.briefId !== value.content.briefId || contentVersion.payloadHash !== value.content.payloadHash) result.errors.push(`Marketing broadcast version ${row.id} references stale content evidence`)
      if (value.account) {
        const account = accounts.get(value.account.lineOaAccountId)
        // The snapshot is historical evidence. An account version or status
        // can legitimately advance after the planning revision was recorded;
        // current freshness is resolved by the read DTO as UNAVAILABLE. The
        // recovery gate validates only that the referenced identity remains in
        // the same Business and that the immutable payload/hash is coherent.
        if (!account || account.businessId !== intent.businessId) result.errors.push(`Marketing broadcast version ${row.id} references LINE account outside its Business`)
      }
    } catch {
      result.errors.push(`Marketing broadcast version ${row.id} has an invalid payload or hash`)
    }
  }
  for (const intent of intents.values()) {
    const rows = tables.marketingBroadcastIntentVersion.filter((row) => row.intentId === intent.id).sort((a, b) => a.revision - b.revision)
    if (!rows.some((row) => row.revision === 1)) result.errors.push(`Marketing broadcast intent ${intent.id} is missing revision 1`)
    if (!rows.some((row) => row.revision === intent.currentRevision)) result.errors.push(`Marketing broadcast intent ${intent.id} is missing current revision ${intent.currentRevision}`)
    for (let index = 0; index < rows.length; index += 1) if (rows[index].revision !== index + 1) result.errors.push(`Marketing broadcast intent ${intent.id} has a non-contiguous revision history`)
  }
  if (result.errors.length) result.status = 'INVALID'
  return result
}

export async function exportSnapshot({
  db = prisma,
  includeBinaryContent = false,
  filesystemPort = createLocalFilesystemPort(),
} = {}) {
  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    genesisRag17Recovery: {
      schemaVersion: GENESIS_RAG17_RECOVERY_MANIFEST_VERSION,
      requiredTables: [...GENESIS_RAG17_RECOVERY_TABLES],
    },
    knowledgeAdmissionRecovery: { schemaVersion: 'knowledge-admission-recovery.v1', requiredTables: [...KNOWLEDGE_ADMISSION_TABLES] },
    marketingBroadcastRecovery: {
      schemaVersion: MARKETING_BROADCAST_RECOVERY_MANIFEST_VERSION,
      requiredTables: [...MARKETING_BROADCAST_RECOVERY_TABLES],
    },
    commerceBillingRecovery: {
      schemaVersion: COMMERCE_BILLING_RECOVERY_MANIFEST_VERSION,
      requiredTables: [...COMMERCE_BILLING_RECOVERY_TABLES],
    },
    inventoryStocktakeRecovery: {
      schemaVersion: INVENTORY_STOCKTAKE_RECOVERY_MANIFEST_VERSION,
      requiredTables: [...INVENTORY_STOCKTAKE_RECOVERY_TABLES],
    },
    lineWorkerMemoryRecovery: {
      schemaVersion: LINE_WORKER_MEMORY_RECOVERY_MANIFEST_VERSION,
      requiredTables: [...LINE_WORKER_MEMORY_RECOVERY_TABLES],
    },
    tables: {},
  }
  for (const model of SNAPSHOT_MODELS) {
    const rows = await db[model].findMany()
    // Ciphertext is still a credential capability on the installation that has
    // its key. It has no place in a portable business snapshot.
    snapshot.tables[model] = model === 'lineConversationJob'
      ? rows.map(({ sealedReplyToken, ...row }) => row)
      : rows
  }

  const mounts = includeBinaryContent
    ? await db.localWorkspaceMount.findMany({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } })
    : []
  const mountByBusiness = new Map()
  for (const mount of mounts) if (!mountByBusiness.has(mount.businessId)) mountByBusiness.set(mount.businessId, mount)
  snapshot.fileContentManifest = []
  for (const asset of localAssets(snapshot)) {
    const entry = {
      fileId: asset.id, businessId: asset.businessId, relativePath: asset.relativePath,
      sha256: asset.sha256 || null, size: asset.size, contentIncluded: false,
    }
    if (includeBinaryContent) {
      const mount = mountByBusiness.get(asset.businessId)
      if (mount) {
        try {
          const content = await filesystemPort.read({ mountRoot: mount.rootPath, relativePath: asset.relativePath })
          entry.contentIncluded = true
          entry.contentBase64 = content.toString('base64')
        } catch (error) {
          entry.contentError = error?.message || 'Content unavailable'
        }
      } else entry.contentError = 'Active remount unavailable'
    }
    snapshot.fileContentManifest.push(entry)
  }
  await recordAudit(db, {
    entityType: 'SNAPSHOT', entityId: 'local', action: 'EXPORTED',
    payload: { counts: Object.fromEntries(Object.entries(snapshot.tables).map(([key, rows]) => [key, rows.length])), includeBinaryContent },
  })
  return snapshot
}

export function previewSnapshot(snapshot, { remounts = [] } = {}) {
  const errors = []
  const warnings = []
  let recovery = { status: 'UNKNOWN', manifestVersion: null }
  if (!snapshot || typeof snapshot !== 'object') errors.push('Snapshot is not an object')
  else {
    if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) errors.push(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion} (expected ${SNAPSHOT_SCHEMA_VERSION})`)
    if (!snapshot.tables || typeof snapshot.tables !== 'object') errors.push('Snapshot has no tables')
    const manifest = recoveryManifest(snapshot)
    const admission = admissionRecoveryManifest(snapshot)
    errors.push(...admission.errors)
    warnings.push(...admission.warnings)
    errors.push(...manifest.errors)
    warnings.push(...manifest.warnings)
    recovery = manifest.recovery
  }
  if (errors.length) return { valid: false, errors, warnings, recovery, counts: null }
  const counts = Object.fromEntries(SNAPSHOT_MODELS.map((model) => [model, Array.isArray(snapshot.tables[model]) ? snapshot.tables[model].length : 0]))
  const remounted = new Set(remounts.map((mount) => mount.businessId))
  const businessIds = [...new Set(localAssets(snapshot).map((asset) => asset.businessId))]
  const included = new Set(contentManifest(snapshot).filter((entry) => entry.contentIncluded).map((entry) => entry.fileId))
  return {
    valid: true, errors: [], warnings, recovery, counts, exportedAt: snapshot.exportedAt || null,
    mountRequiredBusinessIds: businessIds.filter((businessId) => !remounted.has(businessId)).sort(),
    missingContentFileIds: localAssets(snapshot).filter((asset) => !included.has(asset.id)).map((asset) => asset.id).sort(),
  }
}

export async function previewImport(snapshot, { remounts = [], db = prisma, viewer } = {}) {
  assertRestoreOperator(viewer)
  const base = previewSnapshot(snapshot, { remounts })
  if (!base.valid) return base
  const billing = commerceBillingRecovery(snapshot)
  const marketingBroadcast = marketingBroadcastRecovery(snapshot)
  const inventory = inventoryStocktakeRecovery(snapshot)
  const lineWorkerMemory = lineWorkerMemoryRecovery(snapshot)
  const current = {}
  for (const model of SNAPSHOT_MODELS) current[model] = await db[model].count()
  const currentMemoryJobs = await db.lineConversationJob.count({ where: {
    OR: [{ memorySyncOptIn: true }, { memoryDeliveryState: { not: 'NONE' } }],
  } })
  const currentMemoryEvidence = await db.agentTraceEvent.count({ where: { kind: { in: [...LINE_WORKER_MEMORY_TRACE_KINDS] } } })
  // An older snapshot may be useful for read-only inspection, but importing it
  // while any billing row exists would silently turn omitted arrays into deletes.
  // An installation with no billing rows can still restore the older snapshot;
  // the explicit UNAVAILABLE status tells the operator that this feature had no
  // recoverable source in that artifact.
  if (billing.status === 'UNAVAILABLE' && COMMERCE_BILLING_RECOVERY_TABLES.some((model) => current[model] > 0)) {
    billing.errors.push('Commerce billing recovery is unavailable while the installation contains billing rows; refusing a restore that would erase evidence')
  }
  // A legacy snapshot can still be previewed on an empty installation, but it
  // cannot replace an installation that already contains stocktake evidence.
  // That would erase pending observations and the fence revision that protects
  // later ledger reads without giving the operator an explicit refusal.
  if (inventory.status === 'UNAVAILABLE' && INVENTORY_STOCKTAKE_RECOVERY_TABLES.some((model) => current[model] > 0)) {
    inventory.errors.push('Inventory stocktake recovery is unavailable while the installation contains stocktake rows; refusing a restore that would erase evidence')
  }
  if (marketingBroadcast.status === 'UNAVAILABLE' && MARKETING_BROADCAST_RECOVERY_TABLES.some(model => current[model] > 0)) {
    marketingBroadcast.errors.push('Marketing broadcast recovery is unavailable while the installation contains broadcast rows; refusing a restore that would erase planning evidence')
  }
  if (lineWorkerMemory.status === 'UNAVAILABLE' && (currentMemoryJobs > 0 || currentMemoryEvidence > 0)) {
    lineWorkerMemory.errors.push('LINE worker memory recovery is unavailable while the installation contains enrolled jobs or memory evidence; refusing a restore that would erase evidence')
  }
  return {
    ...base,
    valid: base.valid && billing.errors.length === 0 && inventory.errors.length === 0 && lineWorkerMemory.errors.length === 0 && marketingBroadcast.errors.length === 0,
    errors: [...base.errors, ...billing.errors, ...inventory.errors, ...lineWorkerMemory.errors, ...marketingBroadcast.errors],
    warnings: [...base.warnings, ...billing.warnings, ...inventory.warnings, ...lineWorkerMemory.warnings, ...marketingBroadcast.warnings],
    billingRecovery: billing,
    inventoryStocktakeRecovery: inventory,
    lineWorkerMemoryRecovery: lineWorkerMemory,
    marketingBroadcastRecovery: marketingBroadcast,
    current,
    wouldReplace: Object.values(current).some((count) => count > 0),
  }
}

/** Restore is recovery of evidence, never authorization to repeat an external send. */
function restoredRow(model, row, { lineWorkerMemoryRecovery } = {}) {
  if (model === 'lineOaAccount') return {
    ...row, serverEnabled: false, transportEpoch: (row.transportEpoch ?? 1) + 1,
    version: (row.version ?? 1) + 1,
  }
  if (model !== 'lineConversationJob') return row
  const { sealedReplyToken, ...rest } = row
  const preserveMemoryRecovery = lineWorkerMemoryRecovery?.status === 'AVAILABLE'
  const memory = preserveMemoryRecovery
    ? { memorySyncOptIn: row.memorySyncOptIn, memoryDeliveryState: row.memoryDeliveryState,
      memoryDeliveryAttempts: row.memoryDeliveryAttempts, memoryDeliveryNextAttemptAt: row.memoryDeliveryNextAttemptAt,
      memoryDeliveryLeaseUntil: null }
    : { audienceKind: 'DIRECT', memorySyncOptIn: false, memoryDeliveryState: 'NONE', memoryDeliveryAttempts: 0,
      memoryDeliveryNextAttemptAt: null, memoryDeliveryLeaseUntil: null }
  const restored = { ...rest, sealedReplyToken: null, claimantId: null, leaseExpiresAt: null,
    // A restored account is disabled above. Preserve the durable pending receipt
    // and its retry cursor for inspection/recovery, but never restore an active
    // scanner lease that could cause an external MSP effect automatically.
    ...memory,
    version: (row.version ?? 1) + 1 }
  // A send in progress at export may have reached LINE. Keep that uncertainty
  // visible and blocking cutover rather than inventing a safe failure.
  if (row.status === 'SENDING' || (row.status === 'READY' && row.firstSendAt)) return { ...restored, status: 'UNKNOWN', errorCode: 'RESTORED_SEND_OUTCOME_UNKNOWN' }
  if (row.status === 'QUEUED' || row.status === 'CLAIMED' || row.status === 'READY') {
    return { ...restored, status: 'CANCELLED', errorCode: 'RESTORED_REQUIRES_REVIEW' }
  }
  // ACCEPTED is persisted provider evidence; its only next step is CRM repair.
  // Existing UNKNOWN and all terminal outcomes remain exactly as recorded.
  return restored
}

export async function importSnapshot(snapshot, {
  confirm = false,
  remounts = [],
  db = prisma,
  viewer,
  filesystemPort = createLocalFilesystemPort(),
} = {}) {
  assertRestoreOperator(viewer)
  const preview = await previewImport(snapshot, { remounts, db, viewer })
  if (!preview.valid) return { restored: false, ...preview }
  if (!confirm) return { restored: false, needsConfirmation: true, ...preview }
  for (const mount of remounts) {
    if (!mount.businessId || !mount.deviceKey || !path.win32.isAbsolute(mount.rootPath || '')) throw new Error('Each remount requires businessId, deviceKey and an absolute Windows rootPath')
  }

  await db.$transaction(async (tx) => {
    // @req FR-123 — excluded plugin auth records are revoked at the recovery
    // boundary rather than left active beside a restored business snapshot.
    // Deleting the installation cascades to its codes and sessions, so one
    // statement clears all three; leaving them would mean a token minted before
    // the restore still authenticates against the data that replaced it.
    await tx.pluginInstallation.deleteMany()
    await tx.localWorkspaceMount.deleteMany()
    for (const model of [...SNAPSHOT_MODELS].reverse()) await tx[model].deleteMany()
    for (const model of SNAPSHOT_MODELS) {
      for (const row of snapshot.tables[model] || []) await tx[model].create({ data: restoredRow(model, row, { lineWorkerMemoryRecovery: preview.lineWorkerMemoryRecovery }) })
    }
    for (const mount of remounts) {
      const business = await tx.business.findUnique({ where: { id: mount.businessId }, select: { tenantId: true } })
      if (!business) throw new Error(`Remount Business not found: ${mount.businessId}`)
      await tx.localWorkspaceMount.create({ data: { tenantId: business.tenantId, businessId: mount.businessId, deviceKey: mount.deviceKey, rootPath: path.win32.normalize(mount.rootPath) } })
    }
    await recordAudit(tx, { entityType: 'SNAPSHOT', entityId: 'local', action: 'RESTORED', payload: { exportedAt: snapshot.exportedAt || null, counts: preview.counts } })
  }, {
    // Prisma's default interactive-transaction budget is 5s, and the loop above
    // is one `create` per row across every model in SNAPSHOT_MODELS — so its
    // cost grows with the schema itself, not with anything a caller passes. It
    // crossed the default once FR-089's three models and the plan-import
    // receipt joined the list, and the error it produced said "Transaction not
    // found", which reads like a dropped connection rather than a clock running
    // out. That misleading message is most of why this deserves a comment.
    //
    // The budget is raised rather than the transaction split: a restore that
    // committed halfway would leave the installation holding a mixture of two
    // snapshots, and there is no meaningful state between "every table
    // replaced" and "none of them". Whole-or-nothing is the property worth
    // paying for, and it is the one BR-008 relies on.
    maxWait: 10_000,
    timeout: 120_000,
  })

  const remountByBusiness = new Map(remounts.map((mount) => [mount.businessId, mount]))
  const manifestByFile = new Map(contentManifest(snapshot).map((entry) => [entry.fileId, entry]))
  const unresolvedContentFileIds = []
  for (const asset of localAssets(snapshot)) {
    const mount = remountByBusiness.get(asset.businessId)
    const manifest = manifestByFile.get(asset.id)
    let active = false
    if (mount && manifest?.contentIncluded && manifest.contentBase64) {
      const stagingRoot = path.win32.join(mount.rootPath, '.zuri', 'temp')
      const stagingName = `restore-${randomUUID()}.tmp`
      await filesystemPort.stageWrite({ stagingRoot, stagingName, content: Buffer.from(manifest.contentBase64, 'base64') })
      await filesystemPort.promote({ mountRoot: mount.rootPath, stagingRoot, stagingName, relativePath: asset.relativePath })
      active = true
    } else if (mount) {
      try {
        await filesystemPort.stat({ mountRoot: mount.rootPath, relativePath: asset.relativePath })
        active = true
      } catch { /* missing content is reported, not guessed */ }
    }
    if (!active) unresolvedContentFileIds.push(asset.id)
    await db.fileAsset.update({ where: { id: asset.id }, data: { status: active ? 'ACTIVE' : 'MISSING' } })
  }
  return {
    restored: true,
    counts: preview.counts,
    warnings: preview.warnings,
    recovery: preview.recovery,
    billingRecovery: preview.billingRecovery,
    inventoryStocktakeRecovery: preview.inventoryStocktakeRecovery,
    lineWorkerMemoryRecovery: preview.lineWorkerMemoryRecovery,
    marketingBroadcastRecovery: preview.marketingBroadcastRecovery,
    unresolvedContentFileIds,
  }
}
