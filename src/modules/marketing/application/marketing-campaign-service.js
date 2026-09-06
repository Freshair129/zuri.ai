import { randomUUID } from 'node:crypto'

import prisma from '@/lib/db'
import { readMarketingCampaignExecution as readMarketingCampaignExecutionAdapter } from '@/modules/marketing/application/marketing-campaign-execution'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  assertMarketingReadAccess,
  assertMarketingWriteAccess,
  marketingConflict,
  marketingNotFound,
} from '@/modules/marketing/application/marketing-authority'
import {
  getApprovedMarketingPlanForHandoff,
  createMarketingPlan,
  reviseMarketingPlan,
  toMarketingPlanDto,
} from '@/modules/marketing/application/marketing-plan-service'
import {
  MARKETING_CAMPAIGN_STATUSES,
  phaseForMarketingCampaign,
  unavailableMarketingCampaignResults,
  zMarketingCampaignActionInput,
  zMarketingCampaignCreateInput,
} from '@/modules/marketing/domain/marketing-campaign-contract'
import {
  hashMarketingPlanContent,
  parseMarketingPlanVersionPayload,
} from '@/modules/marketing/domain/marketing-plan-contract'
import { createMarketingPlanRepository } from '@/modules/marketing/infrastructure/marketing-plan-repository'
import { createMarketingCampaignRepository } from '@/modules/marketing/infrastructure/marketing-campaign-repository'

// @req FR-156 — create and mutate a Business-scoped Campaign identity while
// reusing immutable Strategy evidence and an explicitly authorized PM receipt.
// @spec SDD-087, SEC-001, SEC-003
// @tested tests/integration/marketing-campaign.test.js

function requireDependencies({ db, createRepository }) {
  if (!db?.business?.findUnique) {
    throw new Error('Marketing campaign service requires a Prisma client with a Business model')
  }
  if (typeof createRepository !== 'function') {
    throw new Error('Marketing campaign repository factory is required')
  }
}

function principalId(viewer) {
  const id = viewer?.principal?.id
  if (typeof id !== 'string' || !id) throw new Error('Marketing campaign service requires a resolved viewer principal')
  return id
}

function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Marketing campaign clock returned an invalid date')
  return date
}

function requireRepository(db, createRepository, scope) {
  const repository = createRepository(db, scope)
  if (!repository || typeof repository.load !== 'function' || typeof repository.transaction !== 'function') {
    throw new Error('Marketing campaign repository must support load and transaction')
  }
  return repository
}

function requireAggregate(aggregate) {
  if (!aggregate?.initiative || !aggregate.plan) throw marketingNotFound('Marketing campaign not found')
  return aggregate
}

function currentPlanVersion(aggregate) {
  const version = aggregate.revisions.find((row) => row.revision === aggregate.plan.currentRevision)
  if (!version) throw marketingConflict('Marketing plan current revision is missing')
  return version
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function campaignCode(title, id) {
  const slug = String(title)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'CAMPAIGN'
  return `MKT-CAM-${slug}-${id.slice(0, 8).toUpperCase()}`
}

function assertCampaignMutable(initiative) {
  if (!MARKETING_CAMPAIGN_STATUSES.includes(initiative.status)) {
    throw marketingConflict('Marketing campaign status is invalid')
  }
  if (initiative.status === 'CLOSED' || initiative.status === 'CANCELLED') {
    throw marketingConflict('Closed or cancelled Marketing campaigns cannot be changed')
  }
}

function versionContent(version) {
  const content = parseMarketingPlanVersionPayload(version.payloadJson)
  const payloadHash = hashMarketingPlanContent({ title: content.title, payload: content.payload })
  if (payloadHash !== version.payloadHash) {
    throw marketingConflict('Marketing plan revision hash is invalid')
  }
  return { ...content, payloadHash }
}

function handoffDto(handoff, receipt) {
  return {
    id: handoff.id,
    planId: handoff.planId,
    planVersionId: handoff.planVersionId,
    workspaceId: handoff.workspaceId,
    projectId: handoff.projectId,
    payloadHash: handoff.payloadHash,
    envelopeHash: handoff.envelopeHash,
    receipt,
    createdBy: handoff.createdBy,
    createdAt: handoff.createdAt,
  }
}

function unavailableExecution(reasonCode) {
  return {
    status: 'UNAVAILABLE',
    reasonCode,
    handoff: null,
    roadmap: null,
  }
}

async function readExecution(reader, input, dependencies) {
  const result = await reader(input, dependencies)
  if (!result || result.status !== 'READY' || !result.roadmap) {
    return unavailableExecution(result?.reasonCode || 'EXECUTION_UNAVAILABLE')
  }
  return result
}

/**
 * The PM adapter is the authority for a receipt's project/workspace binding,
 * provenance and caller read permission. Marketing only chooses candidate
 * rows from this Plan and exposes rows the adapter proves READY.
 */
async function authorizedHandoffs({ db, viewer, aggregate, candidates, readExecutionPort }) {
  const currentVersion = currentPlanVersion(aggregate)
  const rows = []
  for (const handoff of candidates) {
    if (!handoff || handoff.planId !== aggregate.plan.id) continue
    const version = aggregate.revisions.find((row) => row.id === handoff.planVersionId)
    if (!version || version.planId !== aggregate.plan.id) continue
    const execution = await readExecution(
      readExecutionPort,
      {
        viewer,
        businessId: aggregate.plan.businessId,
        planId: aggregate.plan.id,
        handoffId: handoff.id,
        currentPlanVersionId: currentVersion.id,
      },
      { db },
    )
    if (execution.status !== 'READY') continue
    const receipt = parseJson(handoff.receiptJson)
    if (!receipt || typeof receipt !== 'object') continue
    rows.push({
      handoff,
      version,
      receipt,
      execution,
      dto: handoffDto(handoff, receipt),
    })
  }
  return rows
}

async function hasCurrentApproval({ db, viewer, aggregate, now = () => new Date() }) {
  if (aggregate.plan.status !== 'APPROVED') return false
  try {
    await getApprovedMarketingPlanForHandoff({
      planId: aggregate.plan.id,
      businessId: aggregate.plan.businessId,
      expectedVersion: aggregate.plan.version,
      viewer,
      db,
      operation: 'preview',
      now,
    })
    return true
  } catch (error) {
    if (error?.status === 404 || error?.status === 409) return false
    throw error
  }
}

function summaryPlan(aggregate) {
  const version = currentPlanVersion(aggregate)
  const content = versionContent(version)
  return {
    id: aggregate.plan.id,
    title: aggregate.plan.title,
    status: aggregate.plan.status,
    currentRevision: aggregate.plan.currentRevision,
    version: aggregate.plan.version,
    budget: content.payload.budget,
    currency: content.payload.currency,
    channels: content.payload.channels,
    campaignBrief: content.payload.campaignBrief,
  }
}

async function toSummary({ db, viewer, aggregate, canWrite, readExecutionPort, now }) {
  const selectedCandidate = aggregate.handoffs.find((row) => row.id === aggregate.initiative.handoffId)
  const validHandoffs = selectedCandidate
    ? await authorizedHandoffs({
        db,
        viewer,
        aggregate,
        candidates: [selectedCandidate],
        readExecutionPort,
      })
    : []
  const selected = validHandoffs.find((row) => row.handoff.id === aggregate.initiative.handoffId)
  const approved = await hasCurrentApproval({ db, viewer, aggregate, now })
  const phase = phaseForMarketingCampaign({
    initiative: aggregate.initiative,
    hasReadyHandoff: Boolean(selected),
    hasCurrentApproval: approved,
  })
  const plan = summaryPlan(aggregate)
  return {
    id: aggregate.initiative.id,
    code: aggregate.initiative.code,
    businessId: aggregate.initiative.businessId,
    tenantId: aggregate.initiative.tenantId,
    planId: aggregate.initiative.planId,
    handoffId: selected?.handoff.id || null,
    status: aggregate.initiative.status,
    phase,
    version: aggregate.initiative.version,
    title: plan.title,
    currentRevision: plan.currentRevision,
    budget: plan.budget,
    currency: plan.currency,
    channels: plan.channels,
    campaignBrief: plan.campaignBrief,
    canWrite: canWrite && aggregate.initiative.status === 'OPEN',
  }
}

async function toDetail({ db, viewer, aggregate, canWrite, readExecutionPort, now }) {
  const validHandoffs = await authorizedHandoffs({
    db,
    viewer,
    aggregate,
    candidates: aggregate.handoffs,
    readExecutionPort,
  })
  const selected = validHandoffs.find((row) => row.handoff.id === aggregate.initiative.handoffId)
  let execution = unavailableExecution(selected ? 'EXECUTION_UNAVAILABLE' : 'NO_HANDOFF')
  if (selected) {
    execution = selected.execution
    if (execution.status === 'READY') {
      execution = {
        status: 'READY',
        reasonCode: null,
        handoff: {
          id: selected.handoff.id,
          planVersionId: selected.handoff.planVersionId,
          revision: selected.version.revision,
          payloadHash: selected.handoff.payloadHash,
          workspaceId: selected.handoff.workspaceId,
          projectId: selected.handoff.projectId,
          isCurrentRevision: selected.version.id === currentPlanVersion(aggregate).id,
        },
        roadmap: execution.roadmap,
      }
    }
  }
  const approved = await hasCurrentApproval({ db, viewer, aggregate, now })
  const phase = phaseForMarketingCampaign({
    initiative: aggregate.initiative,
    hasReadyHandoff: execution.status === 'READY',
    hasCurrentApproval: approved,
  })
  const plan = toMarketingPlanDto(aggregate, { canWrite })
  // Existing Strategy DTOs include receipt data. Only validated, same-scope
  // rows may cross this Campaign boundary; an invalid/deleted link is omitted.
  plan.handoffs = validHandoffs.map((row) => row.dto)
  return {
    id: aggregate.initiative.id,
    code: aggregate.initiative.code,
    businessId: aggregate.initiative.businessId,
    tenantId: aggregate.initiative.tenantId,
    planId: aggregate.initiative.planId,
    handoffId: selected?.handoff.id || null,
    status: aggregate.initiative.status,
    phase,
    closureReason: aggregate.initiative.closureReason,
    version: aggregate.initiative.version,
    createdAt: aggregate.initiative.createdAt,
    updatedAt: aggregate.initiative.updatedAt,
    canWrite: canWrite && aggregate.initiative.status === 'OPEN',
    plan,
    execution,
    results: { ...unavailableMarketingCampaignResults },
  }
}

async function loadScopedAggregate({ db, createRepository, scope, initiativeId }) {
  const repository = requireRepository(db, createRepository, scope)
  const aggregate = await repository.load(initiativeId)
  return { repository, aggregate: requireAggregate(aggregate) }
}

export async function listMarketingCampaigns(
  { viewer, businessId } = {},
  {
    db = prisma,
    createRepository = createMarketingCampaignRepository,
    readMarketingCampaignExecution = readMarketingCampaignExecutionAdapter,
    now = () => new Date(),
  } = {},
) {
  requireDependencies({ db, createRepository })
  const { scope, canWrite } = await assertMarketingReadAccess({ db, viewer, businessId })
  const repository = requireRepository(db, createRepository, scope)
  const listed = await repository.listInitiatives({ limit: 100 })
  const initiatives = Array.isArray(listed) ? listed : listed.initiatives
  const truncated = Array.isArray(listed) ? false : listed.truncated === true
  const campaigns = []
  for (const initiative of initiatives) {
    const aggregate = await repository.load(initiative.id)
    if (aggregate) campaigns.push(await toSummary({ db, viewer, aggregate, canWrite, readExecutionPort: readMarketingCampaignExecution, now }))
  }
  return { campaigns, canWrite, truncated }
}

export async function getMarketingCampaign(
  { viewer, businessId, initiativeId } = {},
  {
    db = prisma,
    createRepository = createMarketingCampaignRepository,
    readMarketingCampaignExecution: readExecutionPort = readMarketingCampaignExecutionAdapter,
    now = () => new Date(),
  } = {},
) {
  requireDependencies({ db, createRepository })
  const { scope, canWrite } = await assertMarketingReadAccess({ db, viewer, businessId })
  const { aggregate } = await loadScopedAggregate({ db, createRepository, scope, initiativeId })
  if (aggregate.initiative.businessId !== businessId) throw marketingNotFound('Marketing campaign not found')
  return toDetail({ db, viewer, aggregate, canWrite, readExecutionPort, now })
}

export async function createMarketingCampaign(
  input,
  {
    db = prisma,
    viewer,
    createRepository = createMarketingCampaignRepository,
    now = () => new Date(),
    idFactory = randomUUID,
    readMarketingCampaignExecution = readMarketingCampaignExecutionAdapter,
  } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingCampaignCreateInput.parse(input)
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)

  const aggregate = await repository.transaction(async (txRepository, tx) => {
    const plan = await createMarketingPlan(
      { businessId: data.businessId, title: data.title, payload: data.payload },
      {
        db: tx,
        viewer,
        createRepository: createMarketingPlanRepository,
        now: () => timestamp,
        idFactory,
      },
    )
    const initiativeId = idFactory()
    const initiative = await txRepository.createInitiative({
      id: initiativeId,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      code: campaignCode(data.title, initiativeId),
      planId: plan.id,
      handoffId: null,
      status: 'OPEN',
      closureReason: null,
      version: 1,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    })
    await recordAudit(tx, {
      entityType: 'MARKETING_INITIATIVE',
      entityId: initiative.id,
      action: 'CREATED',
      actorId,
      payload: {
        tenantId: scope.tenantId,
        businessId: scope.businessId,
        planId: plan.id,
        initiativeId: initiative.id,
        planVersionId: plan.currentVersion.id,
        payloadHash: plan.currentVersion.payloadHash,
      },
    })
    return txRepository.load(initiative.id)
  })

  return toDetail({ db, viewer, aggregate, canWrite: true, readExecutionPort: readMarketingCampaignExecution, now })
}

async function reviseCampaign(initiativeId, data, dependencies) {
  const {
    db = prisma,
    viewer,
    createRepository = createMarketingCampaignRepository,
    now = () => new Date(),
    idFactory = randomUUID,
    readMarketingCampaignExecution = readMarketingCampaignExecutionAdapter,
  } = dependencies
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)
  const aggregate = await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(initiativeId))
    if (current.initiative.businessId !== data.businessId) throw marketingNotFound('Marketing campaign not found')
    assertCampaignMutable(current.initiative)
    if (current.initiative.version !== data.expectedVersion) throw marketingConflict('Marketing campaign changed; reload before revising')
    if (current.plan.version !== data.expectedPlanVersion) throw marketingConflict('Marketing plan changed; reload before revising')
    const planInput = {
      action: 'revise',
      businessId: data.businessId,
      expectedVersion: data.expectedPlanVersion,
      title: data.title,
      payload: data.payload,
    }
    const revisedPlan = await reviseMarketingPlan(current.plan.id, planInput, {
      db: tx,
      viewer,
      createRepository: createMarketingPlanRepository,
      now: () => timestamp,
      idFactory,
    })
    const updated = await txRepository.casUpdateInitiative(initiativeId, data.expectedVersion, { updatedAt: timestamp })
    await recordAudit(tx, {
      entityType: 'MARKETING_INITIATIVE',
      entityId: initiativeId,
      action: 'REVISED',
      actorId,
      payload: {
        businessId: data.businessId,
        planId: current.plan.id,
        expectedVersion: data.expectedVersion,
        expectedPlanVersion: data.expectedPlanVersion,
        previousPlanVersionId: currentPlanVersion(current).id,
        planVersionId: revisedPlan.currentVersion.id,
        payloadHash: revisedPlan.currentVersion.payloadHash,
      },
    })
    return txRepository.load(updated.id)
  })
  return toDetail({ db, viewer, aggregate, canWrite: true, readExecutionPort: readMarketingCampaignExecution, now })
}

async function bindCampaignHandoff(initiativeId, data, dependencies) {
  const {
    db = prisma,
    viewer,
    createRepository = createMarketingCampaignRepository,
    now = () => new Date(),
    readMarketingCampaignExecution = readMarketingCampaignExecutionAdapter,
  } = dependencies
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)
  const aggregate = await repository.transaction(async (txRepository, tx, txPlanRepository) => {
    const current = requireAggregate(await txRepository.load(initiativeId))
    if (current.initiative.businessId !== data.businessId) throw marketingNotFound('Marketing campaign not found')
    assertCampaignMutable(current.initiative)
    if (current.plan.deletedAt || current.plan.status === 'ARCHIVED') {
      throw marketingConflict('Archived Marketing plans cannot receive a Campaign handoff')
    }
    if (current.initiative.version !== data.expectedVersion) throw marketingConflict('Marketing campaign changed; reload before binding')
    if (current.plan.version !== data.expectedPlanVersion) throw marketingConflict('Marketing plan changed; reload before binding')
    const checked = (await authorizedHandoffs({
      db: tx,
      viewer,
      aggregate: current,
      candidates: current.handoffs.filter((row) => row.id === data.handoffId),
      readExecutionPort: readMarketingCampaignExecution,
    }))[0]
    if (!checked) throw marketingConflict('Marketing handoff is not readable or does not belong to this Campaign')
    const handoff = checked.handoff

    // Guard the Strategy parent in this same transaction. The increment is a
    // reservation boundary for the handoff selection, so a concurrent Strategy
    // revision cannot silently bind a receipt against a different Plan state.
    await txPlanRepository.casUpdatePlan(current.plan.id, data.expectedPlanVersion, { updatedAt: timestamp })
    const updated = await txRepository.casUpdateInitiative(initiativeId, data.expectedVersion, {
      handoffId: handoff.id,
      updatedAt: timestamp,
    })
    await recordAudit(tx, {
      entityType: 'MARKETING_INITIATIVE',
      entityId: initiativeId,
      action: 'HANDOFF_BOUND',
      actorId,
      payload: {
        businessId: data.businessId,
        planId: current.plan.id,
        handoffId: handoff.id,
        planVersionId: handoff.planVersionId,
        payloadHash: handoff.payloadHash,
        expectedVersion: data.expectedVersion,
        expectedPlanVersion: data.expectedPlanVersion,
      },
    })
    return txRepository.load(updated.id)
  })
  return toDetail({ db, viewer, aggregate, canWrite: true, readExecutionPort: readMarketingCampaignExecution, now })
}

async function closeOrCancelCampaign(initiativeId, data, dependencies) {
  const {
    db = prisma,
    viewer,
    createRepository = createMarketingCampaignRepository,
    now = () => new Date(),
  } = dependencies
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)
  const aggregate = await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(initiativeId))
    if (current.initiative.businessId !== data.businessId) throw marketingNotFound('Marketing campaign not found')
    assertCampaignMutable(current.initiative)
    const updated = await txRepository.casUpdateInitiative(initiativeId, data.expectedVersion, {
      status: data.action === 'close' ? 'CLOSED' : 'CANCELLED',
      closureReason: data.reason,
      updatedAt: timestamp,
    })
    await recordAudit(tx, {
      entityType: 'MARKETING_INITIATIVE',
      entityId: initiativeId,
      action: data.action === 'close' ? 'CLOSED' : 'CANCELLED',
      actorId,
      payload: {
        businessId: data.businessId,
        planId: current.plan.id,
        expectedVersion: data.expectedVersion,
        reason: data.reason,
      },
    })
    return txRepository.load(updated.id)
  })
  return toDetail({ db, viewer, aggregate, canWrite: false, readExecutionPort: readMarketingCampaignExecutionAdapter, now })
}

export async function updateMarketingCampaign(
  initiativeId,
  input,
  dependencies = {},
) {
  const data = zMarketingCampaignActionInput.parse(input)
  if (data.action === 'revise') return reviseCampaign(initiativeId, data, dependencies)
  if (data.action === 'bind-handoff') return bindCampaignHandoff(initiativeId, data, dependencies)
  return closeOrCancelCampaign(initiativeId, data, dependencies)
}

export {
  toSummary as toMarketingCampaignSummaryDto,
  toDetail as toMarketingCampaignDto,
}
