import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { commitPlan, dryRunPlan } from '@/modules/project-manager/import/plan-import-service'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { parseMarketingPlanVersionPayload, zMarketingPlanPayload } from '@/modules/marketing/domain/marketing-plan-contract'

// @req FR-154 — an approved Marketing revision can be previewed and handed to
// the existing PM PlanEnvelope importer exactly once per revision/Workspace.
// @spec SDD-086, BR-007, SEC-001, SEC-003 — approval, target scope, immutable
// hashes, transactional receipt association and replay-safe execution.
// @tested tests/integration/marketing-pm-handoff.test.js

const EMPTY_IDENTITY_REFS = Object.freeze({
  gateIds: [],
  artifactIds: [],
  contractIds: [],
  meetingIds: [],
  callIds: [],
  followupIds: [],
  reqIds: [],
  verifyIds: [],
  integrationId: null,
  graphId: null,
  nodeIds: [],
  edgeIds: [],
  workflowContractId: null,
  workflowId: null,
  runbookId: null,
  runbookIds: [],
  promotionId: null,
  promotionIds: [],
  skillIds: [],
  toolIds: [],
})

export const marketingHandoffInputSchema = z
  .object({
    planId: z.string().min(1),
    businessId: z.string().min(1),
    workspaceId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    action: z.enum(['preview', 'commit']),
    previewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'commit' && !value.previewHash) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['previewHash'], message: 'previewHash is required for commit' })
    }
  })

function serviceError(status, message, code = null) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = canonicalize(value[key])
        return result
      }, {})
  }
  return value
}

export function hashCanonical(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function parseJson(value, fallback = null) {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function principalId(viewer) {
  const id = viewer?.principal?.id
  if (!id) throw serviceError(401, 'AUTH_REQUIRED', 'AUTH_REQUIRED')
  return id
}

function createdAtIso(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw serviceError(409, 'Marketing revision timestamp is invalid', 'INVALID_REVISION_TIMESTAMP')
  return date.toISOString()
}

function normalizeApprovedRecord(record) {
  // This is the one agreed core-to-handoff DTO. Approval ordering and the
  // latest-decision rule stay in the Marketing service; this adapter only
  // consumes its already scoped result.
  const plan = record?.plan
  const version = plan?.currentVersion
  const decision = record?.approval
  const review = decision?.reviewId ? plan?.reviews?.find((candidate) => candidate.id === decision.reviewId) : null
  if (!plan || !version || !decision || !review) {
    throw serviceError(409, 'Marketing plan approval evidence is incomplete', 'MARKETING_APPROVAL_INCOMPLETE')
  }
  return { plan, version, review, decision }
}

function assertApproved(record, input, now) {
  const { plan, version, review, decision } = record
  if (plan.id !== input.planId || plan.businessId !== input.businessId) {
    throw serviceError(404, 'Marketing plan not found', 'MARKETING_PLAN_NOT_FOUND')
  }
  if (plan.deletedAt || plan.status !== 'APPROVED') {
    throw serviceError(409, 'Marketing plan is not approved for handoff', 'MARKETING_PLAN_NOT_APPROVED')
  }
  if (plan.version !== input.expectedVersion) {
    throw serviceError(409, `Marketing plan version is stale; expected ${input.expectedVersion}`, 'MARKETING_PLAN_VERSION_STALE')
  }
  if (plan.currentRevision !== undefined && version.revision !== plan.currentRevision) {
    throw serviceError(409, 'Marketing plan revision is no longer current', 'MARKETING_REVISION_SUPERSEDED')
  }
  if (review.planId !== plan.id || review.planVersionId !== version.id || review.payloadHash !== version.payloadHash || review.verdict !== 'PASS') {
    throw serviceError(409, 'Marketing plan lacks a matching PASS review', 'MARKETING_REVIEW_MISMATCH')
  }
  if (
    review.reviewerId &&
    version.createdBy &&
    review.reviewerId === version.createdBy
  ) {
    throw serviceError(409, 'Marketing review must be independent of the revision author', 'MARKETING_REVIEW_NOT_INDEPENDENT')
  }
  if (
    decision.planId !== plan.id ||
    decision.planVersionId !== version.id ||
    decision.payloadHash !== version.payloadHash ||
    decision.verdict !== 'APPROVE' ||
    (decision.reviewId && decision.reviewId !== review.id)
  ) {
    throw serviceError(409, 'Marketing plan lacks a matching approval decision', 'MARKETING_DECISION_MISMATCH')
  }
  const expiresAt = new Date(decision.expiresAt || 0)
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    throw serviceError(409, 'Marketing plan approval has expired', 'MARKETING_APPROVAL_EXPIRED')
  }
}

async function defaultReadApprovedPlan(args) {
  // The core lane owns approval ordering and the latest-decision rule. Keeping
  // this seam dynamic lets the handoff adapter land independently while the
  // core service is being integrated, without duplicating repository writes.
  const module = await import('./marketing-plan-service')
  const reader = module.getApprovedMarketingPlanForHandoff
  if (!reader) throw serviceError(500, 'Marketing handoff approval reader is unavailable', 'MARKETING_HANDOFF_CORE_READER_UNAVAILABLE')
  return reader(args)
}

function asTransactionDb(tx) {
  const proxy = new Proxy(tx, {
    get(target, property) {
      if (property === '$transaction') return async (fn) => fn(proxy)
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return proxy
}

function revisionCode(plan, version, workspace, suffix) {
  return `MKT-${plan.id}-${workspace.id}-R${version.revision}-${suffix}`
}

function projectCode(plan, businessId, workspaceId) {
  // Project.code is globally unique. Including both scope UUIDs prevents two
  // Businesses using the same human plan code from resolving one PM Project.
  return `MKT-${businessId}-${workspaceId}-${plan.code}`
}

function payloadFromVersion(version) {
  const parsed = zMarketingPlanPayload.safeParse(version.payload)
  if (!parsed.success) {
    throw serviceError(409, `Marketing revision payload is invalid: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`, 'MARKETING_PAYLOAD_INVALID')
  }
  const channels = parsed.data.channels
  if (new Set(channels).size !== channels.length) {
    throw serviceError(409, 'Marketing revision channels must be unique', 'MARKETING_CHANNELS_INVALID')
  }
  return parsed.data
}

function payloadFromStoredVersion(version) {
  try {
    return zMarketingPlanPayload.parse(parseMarketingPlanVersionPayload(version.payloadJson).payload)
  } catch (error) {
    throw serviceError(409, error.message || 'Marketing revision payload is invalid', 'MARKETING_PAYLOAD_INVALID')
  }
}

export function buildPlanEnvelope({ plan, version, payload, business, workspace, existingProject = null }) {
  const generatedAt = createdAtIso(version.createdAt)
  const pCode = projectCode(plan, business.id, workspace.id)
  const wsCode = revisionCode(plan, version, workspace, 'WS')
  const containerCode = revisionCode(plan, version, workspace, 'CAMPAIGN')
  const sourceMetadata = {
    source: 'marketing-plan',
    planId: plan.id,
    planVersionId: version.id,
    objective: payload.objective,
    situation: payload.situation,
    audience: payload.audience,
    channels: payload.channels,
    budget: payload.budget,
    currency: payload.currency,
    successMetric: payload.successMetric,
  }
  return {
    schemaVersion: '1.2',
    generatedBy: 'zuri-marketing-pm-handoff',
    generatedAt,
    scope: {
      businessCode: business.code,
      workspaceCode: workspace.code,
    },
    project: {
      code: pCode,
      name: plan.title,
      description: payload.objective,
      type: 'MARKETING_PLAN',
      status: existingProject?.status || 'PLANNED',
    },
    trace: {
      correlationId: `marketing.handoff:${plan.id}:${version.id}:${workspace.id}`,
      idempotencyKey: `marketing.handoff:${version.id}:${workspace.id}`,
    },
    domainBinding: {
      primaryDomainId: 'DOM-MARKETING',
      supportingDomainIds: ['DOM-CRM'],
      technicalOwnerDomainId: 'TD-PROJECT-MANAGER',
    },
    identityRefs: { ...EMPTY_IDENTITY_REFS },
    workstreams: [
      {
        code: wsCode,
        name: `Marketing plan: ${plan.title} (revision ${version.revision})`,
        executionMode: 'B2C_CAMPAIGN',
        executionModeId: 'EXM-B2C-CAMPAIGN',
        executionContractId: 'EXC-B2C-CAMPAIGN-V1',
        contractVersion: '1.0.0',
        progressStrategy: 'KPI_ATTAINMENT',
        progressWeight: 1,
        containers: [
          {
            code: containerCode,
            subtype: 'CAMPAIGN',
            title: plan.title,
            status: 'PLANNED',
            metadata: sourceMetadata,
          },
        ],
        items: payload.actions.map((action, index) => ({
          code: revisionCode(plan, version, workspace, `A${String(index + 1).padStart(3, '0')}`),
          containerCode,
          subtype: 'EXPERIMENT',
          title: action.title,
          status: 'PLANNED',
          metadata: {
            source: 'marketing-plan',
            planId: plan.id,
            planVersionId: version.id,
            actionIndex: index + 1,
          },
        })),
      },
    ],
    repositories: [],
    dependencies: [],
  }
}

async function loadScope(db, plan, input, { allowInactive = false } = {}) {
  const workspace = await db.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { id: true, code: true, name: true, businessId: true, tenantId: true, scopeType: true, status: true },
  })
  if (!workspace || workspace.businessId !== plan.businessId || workspace.scopeType !== 'BUSINESS' || (!allowInactive && workspace.status !== 'ACTIVE')) {
    throw serviceError(404, 'Target workspace not found', 'MARKETING_WORKSPACE_NOT_FOUND')
  }
  // Always reload the scope roots from the transaction client. The core reader
  // may return a deliberately narrow DTO; its optional business projection is
  // evidence, never the authority for tenant/workspace binding.
  const business = await db.business.findUnique({
    where: { id: plan.businessId },
    select: { id: true, code: true, name: true, tenantId: true },
  })
  if (!business || business.id !== input.businessId || business.tenantId !== plan.tenantId || workspace.tenantId && workspace.tenantId !== business.tenantId) {
    throw serviceError(404, 'Marketing plan not found', 'MARKETING_PLAN_NOT_FOUND')
  }
  return { business, workspace }
}

async function findHandoff(db, { planVersionId, workspaceId }) {
  if (!db.marketingHandoff?.findUnique) return null
  return db.marketingHandoff.findUnique({ where: { planVersionId_workspaceId: { planVersionId, workspaceId } } })
}

async function findHistoricalHandoff(db, input) {
  if (!db.marketingHandoff?.findMany) return null
  const rows = await db.marketingHandoff.findMany({
    where: { planId: input.planId, workspaceId: input.workspaceId },
    orderBy: { createdAt: 'desc' },
  })
  for (const row of rows) {
    const receipt = parseJson(row.receiptJson)
    if (
      receipt?.planId === input.planId &&
      receipt?.businessId === input.businessId &&
      receipt?.workspaceId === input.workspaceId &&
      receipt?.expectedVersion === input.expectedVersion
    ) {
      return { row, receipt }
    }
  }
  return null
}

async function findProject(db, code) {
  if (!db.project?.findUnique) return null
  return db.project.findUnique({
    where: { code },
    select: { id: true, code: true, workspaceId: true, businessId: true, status: true, version: true },
  })
}

function assertHistoricalPmTarget(pm, plan, workspace) {
  if (!pm) throw serviceError(404, 'Target workspace not found', 'MARKETING_WORKSPACE_NOT_FOUND')
  if (pm.workspace && (pm.workspace.id !== workspace.id || pm.workspace.businessId !== plan.businessId)) {
    throw serviceError(404, 'Target workspace not found', 'MARKETING_WORKSPACE_NOT_FOUND')
  }
  if (pm.valid === false && (pm.errors || []).some((message) => /target workspace|authorized|authorization|not found/i.test(message))) {
    throw serviceError(404, 'Target workspace not found', 'MARKETING_WORKSPACE_NOT_FOUND')
  }
}

function publicReplay({ envelope, previewHash, receipt, preview = null, plan, version, workspace, business }) {
  return {
    valid: true,
    replay: true,
    receipt,
    previewHash,
    envelope,
    preview: {
      plan: { id: plan.id, code: plan.code, title: plan.title, version: plan.version, currentRevision: plan.currentRevision },
      planVersionId: version.id,
      payloadHash: version.payloadHash,
      envelopeHash: hashCanonical(envelope),
      projectCode: envelope.project.code,
      business: { id: business.id, code: business.code, name: business.name },
      workspace: { id: workspace.id, code: workspace.code, name: workspace.name, businessId: workspace.businessId },
      pm: preview,
      existingHandoff: { id: receipt.handoffId || null, projectId: receipt.projectId, receipt },
    },
  }
}

function withoutContext(result) {
  if (!result || typeof result !== 'object') return result
  const { _context, ...publicResult } = result
  return publicResult
}

async function prepare(input, { viewer, db, readApprovedPlan, dryRun, now, operation }) {
  assertDomainVisible(viewer, input.businessId, 'growth')
  const historical = await findHistoricalHandoff(db, input)
  if (historical) {
    const receipt = historical.receipt
    const envelope = receipt.envelope
    if (!envelope || !receipt.envelopeHash || hashCanonical(envelope) !== receipt.envelopeHash) {
      throw serviceError(409, 'Stored Marketing handoff receipt is inconsistent', 'MARKETING_RECEIPT_CORRUPT')
    }
    const plan = await db.marketingPlan?.findUnique?.({ where: { id: input.planId } })
    const version = await db.marketingPlanVersion?.findUnique?.({ where: { id: historical.row.planVersionId } })
    if (!plan || plan.businessId !== input.businessId || !version) throw serviceError(404, 'Marketing plan not found', 'MARKETING_PLAN_NOT_FOUND')
    const scope = await loadScope(db, plan, input, { allowInactive: true })
    const replayPm = await dryRun(envelope, { workspaceId: input.workspaceId, viewer, db })
    assertHistoricalPmTarget(replayPm, plan, scope.workspace)
    const previewHash = receipt.previewHash || hashCanonical({
      planId: input.planId,
      planVersionId: historical.row.planVersionId,
      workspaceId: input.workspaceId,
      payloadHash: historical.row.payloadHash,
      envelopeHash: historical.row.envelopeHash,
      envelope,
      pm: receipt.preview || null,
    })
    return {
      ...publicReplay({ envelope, previewHash, receipt: { ...receipt, handoffId: historical.row.id }, preview: receipt.preview || null, plan, version, workspace: scope.workspace, business: scope.business }),
      _context: { plan, version, business: scope.business, workspace: scope.workspace, payload: payloadFromStoredVersion(version), existing: historical.row },
    }
  }

  const record = normalizeApprovedRecord(await readApprovedPlan({
    planId: input.planId,
    businessId: input.businessId,
    expectedVersion: input.expectedVersion,
    viewer,
    db,
    now,
    operation,
  }))
  assertApproved(record, input, now)
  const { plan, version } = record
  const scope = await loadScope(db, plan, input)
  const payload = payloadFromVersion(version)
  const pCode = projectCode(plan, scope.business.id, scope.workspace.id)
  const existingProject = await findProject(db, pCode)
  if (existingProject && (existingProject.businessId !== plan.businessId || existingProject.workspaceId !== input.workspaceId)) {
    throw serviceError(409, 'Stable Marketing Project identity is outside the target scope', 'MARKETING_PROJECT_SCOPE_CONFLICT')
  }
  if (existingProject?.status === 'ARCHIVED') {
    throw serviceError(409, 'Archived PM Projects cannot receive a Marketing revision', 'MARKETING_PROJECT_ARCHIVED')
  }
  const envelope = buildPlanEnvelope({ plan, version, payload, business: scope.business, workspace: scope.workspace, existingProject })
  const envelopeHash = hashCanonical(envelope)
  const existing = await findHandoff(db, { planVersionId: version.id, workspaceId: input.workspaceId })
  if (existing) {
    const receipt = parseJson(existing.receiptJson)
    if (!receipt || existing.payloadHash !== version.payloadHash || existing.envelopeHash !== envelopeHash) {
      throw serviceError(409, 'Existing Marketing handoff does not match the immutable revision', 'MARKETING_HANDOFF_HASH_CONFLICT')
    }
    return {
      ...publicReplay({ envelope, previewHash: receipt.previewHash, receipt: { ...receipt, handoffId: existing.id }, preview: receipt.preview || null, plan, version, workspace: scope.workspace, business: scope.business }),
      _context: { plan, version, business: scope.business, workspace: scope.workspace, payload, existing },
    }
  }
  const pm = await dryRun(envelope, { workspaceId: input.workspaceId, viewer, db })
  const errors = [...(pm?.errors || [])]
  if (pm?.workspace?.businessId && pm.workspace.businessId !== plan.businessId) errors.push('PM resolved a Workspace outside the Marketing Business')
  const pmPreview = pm?.preview || null
  const updates = pmPreview?.updates || []
  const projectUpdates = updates.filter((entry) => entry.kind === 'project' && entry.code === envelope.project.code)
  const unrelatedUpdates = updates.filter((entry) => !(entry.kind === 'project' && entry.code === envelope.project.code))
  if (unrelatedUpdates.length) errors.push('Marketing handoff preview would overwrite existing PM work outside its stable Project')

  const prior = await db.marketingHandoff?.findFirst?.({ where: { planId: plan.id, workspaceId: input.workspaceId }, orderBy: { createdAt: 'desc' } })
  if (updates.length && !prior && projectUpdates.length) {
    errors.push('Target PM Project already exists without a prior Marketing handoff')
  }
  if (prior && projectUpdates.length) {
    const priorReceipt = parseJson(prior.receiptJson)
    const existingProject = await db.project?.findUnique?.({ where: { code: envelope.project.code }, select: { id: true, workspaceId: true, businessId: true } })
    if (
      priorReceipt?.projectId &&
      (!existingProject || existingProject.id !== priorReceipt.projectId || existingProject.workspaceId !== input.workspaceId || existingProject.businessId !== plan.businessId)
    ) {
      errors.push('Stable Marketing Project identity does not match the prior handoff receipt')
    }
  }
  const pmState = {
    valid: pm?.valid !== false,
    errors: pm?.errors || [],
    workspace: pm?.workspace || null,
    resolution: pm?.resolution || {},
    preview: pmPreview,
    currentProject: existingProject
      ? {
          id: existingProject.id,
          workspaceId: existingProject.workspaceId,
          businessId: existingProject.businessId,
          status: existingProject.status,
          version: existingProject.version,
        }
      : null,
  }
  const previewHash = hashCanonical({
    planId: plan.id,
    planVersionId: version.id,
    workspaceId: input.workspaceId,
    payloadHash: version.payloadHash,
    envelopeHash,
    envelope,
    pm: pmState,
  })
  const preview = {
    plan: { id: plan.id, code: plan.code, title: plan.title, version: plan.version, currentRevision: plan.currentRevision },
    planVersionId: version.id,
    payloadHash: version.payloadHash,
    envelopeHash,
    projectCode: envelope.project.code,
    business: { id: scope.business.id, code: scope.business.code, name: scope.business.name },
    workspace: { id: scope.workspace.id, code: scope.workspace.code, name: scope.workspace.name, businessId: scope.workspace.businessId },
    pm: pmState,
  }
  return {
    valid: errors.length === 0 && pm?.valid !== false,
    errors,
    replay: false,
    previewHash,
    envelope,
    preview,
    _context: { plan, version, business: scope.business, workspace: scope.workspace, payload, existing: null, pm, pmState, existingProject },
  }
}

export function createMarketingPmHandoffService({
  db = prisma,
  readApprovedPlan = defaultReadApprovedPlan,
  dryRun = dryRunPlan,
  commit = commitPlan,
  audit = recordAudit,
  now: nowFactory = () => new Date(),
  } = {}) {
  const preview = async (input, { viewer } = {}) => {
    const parsed = marketingHandoffInputSchema.parse({ ...input, action: 'preview' })
    return withoutContext(await prepare(parsed, { viewer, db, readApprovedPlan, dryRun, now: nowFactory(), operation: 'preview' }))
  }

  const commitHandoff = async (input, { viewer } = {}) => {
    const parsed = marketingHandoffInputSchema.parse({ ...input, action: 'commit' })
    assertDomainVisible(viewer, parsed.businessId, 'growth')
    if (!ownsBusiness(viewer, parsed.businessId)) throw serviceError(404, 'Business not found', 'MARKETING_HANDOFF_NOT_FOUND')
    const requestedHash = parsed.previewHash
    const before = await prepare(parsed, { viewer, db, readApprovedPlan, dryRun, now: nowFactory(), operation: 'commit-preview' })
    if (before.previewHash !== requestedHash) throw serviceError(409, 'Marketing handoff preview is stale', 'MARKETING_HANDOFF_PREVIEW_STALE')
    if (!before.valid) throw serviceError(409, before.errors?.[0] || 'Marketing PM preview is invalid', 'MARKETING_PM_PREVIEW_INVALID')
    if (before.replay) return { committed: true, replay: true, ...withoutContext(before) }

    const result = await db.$transaction(async (tx) => {
      const txDb = asTransactionDb(tx)
      const live = await prepare(parsed, { viewer, db: txDb, readApprovedPlan, dryRun, now: nowFactory(), operation: 'commit' })
      if (live.previewHash !== requestedHash) throw serviceError(409, 'Marketing handoff changed after preview', 'MARKETING_HANDOFF_CHANGED_AFTER_PREVIEW')
      if (live.replay) return { committed: true, replay: true, ...withoutContext(live) }
      if (!live.valid) throw serviceError(409, live.errors?.[0] || 'Marketing PM preview is invalid', 'MARKETING_PM_PREVIEW_INVALID')
      const { plan, version, workspace, business, pmState } = live._context
      const cas = await txDb.marketingPlan.updateMany({
        where: { id: plan.id, businessId: business.id, version: plan.version, status: 'APPROVED', deletedAt: null },
        data: { version: { increment: 1 } },
      })
      if (cas.count !== 1) throw serviceError(409, 'Marketing plan changed; reload before handoff', 'MARKETING_PLAN_VERSION_STALE')
      const pmResult = await commit(live.envelope, { workspaceId: workspace.id, viewer, db: txDb })
      if (!pmResult?.committed) throw serviceError(409, pmResult?.errors?.[0] || 'PM handoff commit failed', 'MARKETING_PM_COMMIT_FAILED')
      if (!pmResult.projectId) throw serviceError(500, 'PM handoff did not return a Project id', 'MARKETING_PM_RECEIPT_INVALID')
      const committedAt = nowFactory().toISOString()
      const handoffId = randomUUID()
      const receipt = {
        status: 'SUCCEEDED',
        handoffId,
        planId: plan.id,
        businessId: business.id,
        planVersionId: version.id,
        expectedVersion: plan.version,
        workspaceId: workspace.id,
        projectId: pmResult.projectId,
        projectCode: pmResult.projectCode || live.envelope.project.code,
        payloadHash: version.payloadHash,
        envelopeHash: live.preview.envelopeHash,
        previewHash: live.previewHash,
        envelope: live.envelope,
        preview: pmState,
        pm: pmResult,
        committedAt,
      }
      const handoff = await txDb.marketingHandoff.create({
        data: {
          id: handoffId,
          planId: plan.id,
          planVersionId: version.id,
          workspaceId: workspace.id,
          projectId: pmResult.projectId,
          payloadHash: version.payloadHash,
          envelopeHash: live.preview.envelopeHash,
          receiptJson: JSON.stringify(receipt),
          createdBy: principalId(viewer),
        },
      })
      await audit(txDb, {
        entityType: 'MARKETING_HANDOFF',
        entityId: handoff.id,
        action: 'MARKETING_PM_HANDOFF_COMMITTED',
        payload: {
          planId: plan.id,
          planVersionId: version.id,
          workspaceId: workspace.id,
          projectId: pmResult.projectId,
          payloadHash: version.payloadHash,
          envelopeHash: live.preview.envelopeHash,
          previewHash: live.previewHash,
          pmReceipt: pmResult,
        },
        actorId: principalId(viewer),
      })
      return {
        committed: true,
        replay: false,
        receipt,
        previewHash: live.previewHash,
        envelope: live.envelope,
        preview: live.preview,
      }
    })
    return result
  }

  return { preview, commit: commitHandoff }
}

export async function previewMarketingPlanHandoff(input, options = {}) {
  return createMarketingPmHandoffService(options).preview(input, options)
}

export async function commitMarketingPlanHandoff(input, options = {}) {
  return createMarketingPmHandoffService(options).commit(input, options)
}
