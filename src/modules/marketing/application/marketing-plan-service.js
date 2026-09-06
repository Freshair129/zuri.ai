import { randomUUID } from 'node:crypto'

import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  assertMarketingReadAccess,
  assertMarketingWriteAccess,
  marketingConflict,
  marketingNotFound,
} from './marketing-authority'
import {
  MARKETING_PLAN_DECISION_VERDICTS,
  assertMarketingCampaignBriefPreserved,
  parseMarketingPlanVersionPayload,
  hashMarketingPlanContent,
  isFiniteFutureDate,
  serializeMarketingPlanVersion,
  zMarketingPlanActionInput,
  zMarketingPlanCreateInput,
  zMarketingPlanDecisionInput,
  zMarketingPlanRevisionInput,
  zMarketingPlanReviewInput,
} from '@/modules/marketing/domain/marketing-plan-contract'
import { createMarketingPlanRepository } from '@/modules/marketing/infrastructure/marketing-plan-repository'

// @req FR-155 — persist the Marketing Strategy lifecycle through one scoped
// service, with immutable revisions, independent review, exact decisions,
// expiry/revocation and audit in the same transaction.
// @spec SDD-086, BR-001, SEC-001, SEC-003
// @tested tests/integration/marketing-plan.test.js

function requireDependencies({ db, createRepository }) {
  if (!db?.business?.findUnique) {
    throw new Error('Marketing plan service requires a Prisma client with a Business model')
  }
  if (typeof createRepository !== 'function') {
    throw new Error('Marketing plan repository factory is required')
  }
}

function principalId(viewer) {
  const id = viewer?.principal?.id
  if (typeof id !== 'string' || !id) {
    throw new Error('Marketing plan service requires a resolved viewer principal')
  }
  return id
}

function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Marketing plan clock returned an invalid date')
  return date
}

function withoutAction(input) {
  if (!input || typeof input !== 'object') return input
  const { action: _action, ...rest } = input
  return rest
}

function requireRepository(db, createRepository, scope) {
  const repository = createRepository(db, scope)
  if (!repository || typeof repository.load !== 'function' || typeof repository.transaction !== 'function') {
    throw new Error('Marketing plan repository must support load and transaction')
  }
  return repository
}

function requireAggregate(aggregate) {
  if (!aggregate?.plan) throw marketingNotFound('Marketing plan not found')
  return aggregate
}

function currentVersion(aggregate) {
  const version = aggregate.revisions.find((item) => item.revision === aggregate.plan.currentRevision)
  if (!version) throw new Error('Marketing plan current revision is missing')
  return version
}

function versionContent(aggregate, version) {
  const parsed = parseMarketingPlanVersionPayload(version.payloadJson)
  const title = parsed.title
  return {
    title,
    payload: parsed.payload,
    payloadHash: hashMarketingPlanContent({ title, payload: parsed.payload }),
  }
}

function assertCurrentBinding(aggregate, { planVersionId, payloadHash }) {
  const version = currentVersion(aggregate)
  if (version.id !== planVersionId || version.payloadHash !== payloadHash) {
    throw marketingConflict('Marketing plan revision is stale; reload before deciding')
  }
  const content = versionContent(aggregate, version)
  if (content.title !== aggregate.plan.title) {
    throw marketingConflict('Marketing plan title is inconsistent with its current revision')
  }
  if (content.payloadHash !== payloadHash) {
    throw marketingConflict('Marketing plan revision hash is invalid')
  }
  return { version, content }
}

function assertMutable(aggregate) {
  if (aggregate.plan.status === 'ARCHIVED') {
    throw marketingConflict('Archived Marketing plans cannot be changed')
  }
}

function actorAudit(actorId, extra = {}) {
  return { ...extra, actorId }
}

function auditPayload(aggregate, version, extra = {}) {
  return {
    businessId: aggregate.plan.businessId,
    tenantId: aggregate.plan.tenantId,
    planId: aggregate.plan.id,
    planVersionId: version?.id || null,
    revision: version?.revision || aggregate.plan.currentRevision,
    payloadHash: version?.payloadHash || null,
    ...extra,
  }
}

function versionDto(aggregate, version) {
  const content = versionContent(aggregate, version)
  return {
    id: version.id,
    revision: version.revision,
    title: content.title,
    payloadHash: version.payloadHash,
    payload: content.payload,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
  }
}

function reviewDto(review) {
  return {
    id: review.id,
    planId: review.planId,
    planVersionId: review.planVersionId,
    payloadHash: review.payloadHash,
    verdict: review.verdict,
    rationale: review.rationale,
    reviewerId: review.reviewerId,
    createdAt: review.createdAt,
  }
}

function decisionDto(decision) {
  return {
    id: decision.id,
    planId: decision.planId,
    planVersionId: decision.planVersionId,
    payloadHash: decision.payloadHash,
    reviewId: decision.reviewId,
    verdict: decision.verdict,
    rationale: decision.rationale,
    actorId: decision.actorId,
    expiresAt: decision.expiresAt,
    createdAt: decision.createdAt,
  }
}

function handoffDto(handoff) {
  return {
    id: handoff.id,
    planId: handoff.planId,
    planVersionId: handoff.planVersionId,
    workspaceId: handoff.workspaceId,
    projectId: handoff.projectId,
    payloadHash: handoff.payloadHash,
    envelopeHash: handoff.envelopeHash,
    receipt: parseJson(handoff.receiptJson, null),
    createdBy: handoff.createdBy,
    createdAt: handoff.createdAt,
  }
}

function parseJson(json, fallback) {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}

export function toMarketingPlanDto(aggregate, { canWrite = false } = {}) {
  const value = requireAggregate(aggregate)
  const current = currentVersion(value)
  return {
    id: value.plan.id,
    tenantId: value.plan.tenantId,
    businessId: value.plan.businessId,
    code: value.plan.code,
    title: value.plan.title,
    status: value.plan.status,
    currentRevision: value.plan.currentRevision,
    version: value.plan.version,
    createdBy: value.plan.createdBy,
    createdAt: value.plan.createdAt,
    updatedAt: value.plan.updatedAt,
    deletedAt: value.plan.deletedAt,
    currentVersion: versionDto(value, current),
    versions: value.revisions.map((revision) => versionDto(value, revision)),
    reviews: value.reviews.map(reviewDto),
    decisions: value.decisions.map(decisionDto),
    handoffs: value.handoffs.map(handoffDto),
    canWrite,
  }
}

function toMarketingPlanSummaryDto(plan, { canWrite = false } = {}) {
  return {
    id: plan.id,
    tenantId: plan.tenantId,
    businessId: plan.businessId,
    code: plan.code,
    title: plan.title,
    status: plan.status,
    currentRevision: plan.currentRevision,
    version: plan.version,
    createdBy: plan.createdBy,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    deletedAt: plan.deletedAt,
    canWrite,
  }
}

function assertPlanBusiness(aggregate, businessId) {
  if (aggregate.plan.businessId !== businessId) throw marketingNotFound('Marketing plan not found')
}

function nextPlanCode(title, id) {
  const slug = title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'PLAN'
  return `MKT-${slug}-${id.slice(0, 8).toUpperCase()}`
}

function latestDecision(decisions) {
  return [...decisions].sort((left, right) => {
    const byDate = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    if (byDate) return byDate
    return String(right.id).localeCompare(String(left.id))
  })[0] || null
}

function latestReview(reviews) {
  return [...reviews].sort((left, right) => {
    const byDate = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    if (byDate) return byDate
    return String(right.id).localeCompare(String(left.id))
  })[0] || null
}

function monotonicDecisionTime(decisions, now) {
  const latest = latestDecision(decisions)
  if (!latest) return now
  const latestTime = new Date(latest.createdAt).getTime()
  return new Date(Math.max(now.getTime(), latestTime + 1))
}

function monotonicReviewTime(reviews, now) {
  const latest = latestReview(reviews)
  if (!latest) return now
  const latestTime = new Date(latest.createdAt).getTime()
  return new Date(Math.max(now.getTime(), latestTime + 1))
}

function findReview(aggregate, reviewId) {
  return aggregate.reviews.find((review) => review.id === reviewId) || null
}

function assertIndependentReviewBinding(review, version, payloadHash) {
  if (
    !review ||
    review.planVersionId !== version.id ||
    review.payloadHash !== payloadHash ||
    review.reviewerId === version.createdBy
  ) {
    throw marketingConflict('Marketing review is stale or not independent')
  }
  return review
}

function latestReviewForVersion(aggregate, versionId) {
  return latestReview(aggregate.reviews.filter((review) => review.planVersionId === versionId))
}

function assertLatestPassReview(aggregate, version, payloadHash, reviewId) {
  const latest = latestReviewForVersion(aggregate, version.id)
  if (!latest || latest.id !== reviewId || latest.verdict !== 'PASS') {
    throw marketingConflict('APPROVE requires a PASS review of the latest current revision')
  }
  return assertIndependentReviewBinding(latest, version, payloadHash)
}

function assertCurrentApproval(aggregate, now) {
  const { version, content } = assertCurrentBinding(aggregate, {
    planVersionId: currentVersion(aggregate).id,
    payloadHash: currentVersion(aggregate).payloadHash,
  })
  const approval = latestDecision(aggregate.decisions)
  if (
    !approval ||
    approval.verdict !== 'APPROVE' ||
    approval.planVersionId !== version.id ||
    approval.payloadHash !== version.payloadHash
  ) {
    throw marketingConflict('Marketing plan approval is missing, revoked, or stale')
  }
  const review = assertLatestPassReview(aggregate, version, version.payloadHash, approval.reviewId)
  if (!isFiniteFutureDate(new Date(approval.expiresAt), now)) {
    throw marketingConflict('Marketing plan approval is missing, revoked, or expired')
  }
  return { version, content, approval, review }
}

async function loadScopedAggregate({ db, createRepository, scope, planId }) {
  const repository = requireRepository(db, createRepository, scope)
  const aggregate = await repository.load(planId)
  requireAggregate(aggregate)
  return { repository, aggregate }
}

export async function listMarketingPlans(
  { viewer, businessId } = {},
  { db, createRepository = createMarketingPlanRepository } = {},
) {
  requireDependencies({ db, createRepository })
  const { scope, canWrite } = await assertMarketingReadAccess({ db, viewer, businessId })
  const repository = requireRepository(db, createRepository, scope)
  const listed = await repository.listPlans({ limit: 100 })
  const plans = Array.isArray(listed) ? listed : listed.plans
  const truncated = Array.isArray(listed) ? false : listed.truncated === true
  return {
    plans: plans.map((plan) => toMarketingPlanSummaryDto(plan, {
      canWrite: canWrite && plan.status !== 'ARCHIVED',
    })),
    canWrite,
    truncated,
  }
}

export async function getMarketingPlan(
  { viewer, businessId, planId } = {},
  { db, createRepository = createMarketingPlanRepository } = {},
) {
  requireDependencies({ db, createRepository })
  const { scope, canWrite } = await assertMarketingReadAccess({ db, viewer, businessId })
  const { aggregate } = await loadScopedAggregate({ db, createRepository, scope, planId })
  assertPlanBusiness(aggregate, businessId)
  return toMarketingPlanDto(aggregate, {
    canWrite: canWrite && aggregate.plan.status !== 'ARCHIVED',
  })
}

export async function createMarketingPlan(
  input,
  { db, viewer, createRepository = createMarketingPlanRepository, now = () => new Date(), idFactory = randomUUID } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingPlanCreateInput.parse(input)
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const planId = idFactory()
  const payloadHash = hashMarketingPlanContent({ title: data.title, payload: data.payload })
  const repository = requireRepository(db, createRepository, scope)

  const aggregate = await repository.transaction(async (txRepository, tx) => {
    const plan = await txRepository.createPlan({
      id: planId,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      code: nextPlanCode(data.title, planId),
      title: data.title,
      status: 'DRAFT',
      currentRevision: 1,
      version: 1,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    })
    const revision = await txRepository.createRevision({
      id: idFactory(),
      planId: plan.id,
      revision: 1,
      payloadJson: serializeMarketingPlanVersion({ title: data.title, payload: data.payload }),
      payloadHash,
      createdBy: actorId,
      createdAt: timestamp,
    })
    await recordAudit(tx, {
      entityType: 'MARKETING_PLAN',
      entityId: plan.id,
      action: 'CREATED',
      actorId,
      payload: auditPayload({ plan }, revision, actorAudit(actorId)),
    })
    return txRepository.load(plan.id)
  })

  return toMarketingPlanDto(aggregate, { canWrite: true })
}

export async function reviseMarketingPlan(
  planId,
  input,
  { db, viewer, createRepository = createMarketingPlanRepository, now = () => new Date(), idFactory = randomUUID } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingPlanRevisionInput.parse(withoutAction(input))
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const payloadHash = hashMarketingPlanContent({ title: data.title, payload: data.payload })
  const repository = requireRepository(db, createRepository, scope)

  const aggregate = await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(planId))
    assertPlanBusiness(current, data.businessId)
    assertMutable(current)
    try {
      assertMarketingCampaignBriefPreserved(versionContent(current, currentVersion(current)).payload, data.payload)
    } catch (error) {
      throw marketingConflict(error.message)
    }
    const revision = current.plan.currentRevision + 1
    const next = await txRepository.appendRevision({
      planId,
      expectedVersion: data.expectedVersion,
      revision,
      updatedAt: timestamp,
      data: {
        id: idFactory(),
        title: data.title,
        payloadJson: serializeMarketingPlanVersion({ title: data.title, payload: data.payload }),
        payloadHash,
        createdBy: actorId,
        createdAt: timestamp,
      },
    })
    const version = currentVersion(next)
    await recordAudit(tx, {
      entityType: 'MARKETING_PLAN',
      entityId: planId,
      action: 'REVISION_APPENDED',
      actorId,
      payload: auditPayload(next, version, actorAudit(actorId, { expectedVersion: data.expectedVersion })),
    })
    return txRepository.load(planId)
  })

  return toMarketingPlanDto(aggregate, { canWrite: true })
}

export async function reviewMarketingPlan(
  planId,
  input,
  { db, viewer, createRepository = createMarketingPlanRepository, now = () => new Date(), idFactory = randomUUID } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingPlanReviewInput.parse({ ...input, action: 'review' })
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)

  const aggregate = await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(planId))
    assertPlanBusiness(current, data.businessId)
    assertMutable(current)
    const { version } = assertCurrentBinding(current, data)
    if (version.createdBy === actorId) {
      throw marketingConflict('Marketing plan reviewer must differ from the revision author')
    }
    const reviewCreatedAt = monotonicReviewTime(current.reviews, timestamp)

    const next = await txRepository.appendReview({
      planId,
      expectedVersion: data.expectedVersion,
      status: 'DRAFT',
      updatedAt: timestamp,
      data: {
        id: idFactory(),
        planId,
        planVersionId: version.id,
        payloadHash: data.payloadHash,
        verdict: data.verdict,
        rationale: data.rationale,
        reviewerId: actorId,
        createdAt: reviewCreatedAt,
      },
    })
    await recordAudit(tx, {
      entityType: 'MARKETING_PLAN',
      entityId: planId,
      action: 'REVIEWED',
      actorId,
      payload: auditPayload(next, version, actorAudit(actorId, {
        verdict: data.verdict,
        reviewId: next.reviews[next.reviews.length - 1]?.id || null,
      })),
    })
    return txRepository.load(planId)
  })

  return toMarketingPlanDto(aggregate, { canWrite: true })
}

function validateDecision(aggregate, data, actorId, now) {
  assertMutable(aggregate)
  const { version, content } = assertCurrentBinding(aggregate, data)
  const review = data.reviewId ? findReview(aggregate, data.reviewId) : null

  if (data.verdict === 'APPROVE') {
    assertLatestPassReview(aggregate, version, data.payloadHash, data.reviewId)
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null
    if (!isFiniteFutureDate(expiresAt, now)) {
      throw new Error('APPROVE requires a finite future expiresAt')
    }
    return { version, content, review: findReview(aggregate, data.reviewId), expiresAt }
  }

  if (data.reviewId) assertIndependentReviewBinding(review, version, data.payloadHash)

  if (data.verdict === 'REVOKE') {
    const latest = latestDecision(aggregate.decisions)
    if (!latest || latest.verdict !== 'APPROVE' || latest.planVersionId !== version.id || latest.payloadHash !== data.payloadHash) {
      throw marketingConflict('REVOKE requires the current revision to have an approval')
    }
  }

  return { version, content, review, expiresAt: null }
}

export async function decideMarketingPlan(
  planId,
  input,
  { db, viewer, createRepository = createMarketingPlanRepository, now = () => new Date(), idFactory = randomUUID } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingPlanDecisionInput.parse({ ...input, action: 'decide' })
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)

  const aggregate = await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(planId))
    assertPlanBusiness(current, data.businessId)
    const checked = validateDecision(current, data, actorId, timestamp)
    const decisionCreatedAt = monotonicDecisionTime(current.decisions, timestamp)
    const status = data.verdict === 'APPROVE' ? 'APPROVED' : 'DRAFT'
    const next = await txRepository.appendDecision({
      planId,
      expectedVersion: data.expectedVersion,
      status,
      updatedAt: timestamp,
      data: {
        id: idFactory(),
        planId,
        planVersionId: checked.version.id,
        payloadHash: data.payloadHash,
        reviewId: checked.review?.id || null,
        verdict: data.verdict,
        rationale: data.rationale,
        actorId,
        expiresAt: checked.expiresAt,
        createdAt: decisionCreatedAt,
      },
    })
    const decision = latestDecision(next.decisions)
    await recordAudit(tx, {
      entityType: 'MARKETING_PLAN',
      entityId: planId,
      action: `DECISION_${data.verdict}`,
      actorId,
      payload: auditPayload(next, checked.version, actorAudit(actorId, {
        decisionId: decision?.id || null,
        verdict: data.verdict,
        reviewId: checked.review?.id || null,
        expiresAt: checked.expiresAt,
      })),
    })
    return txRepository.load(planId)
  })

  return toMarketingPlanDto(aggregate, { canWrite: true })
}

export async function archiveMarketingPlan(
  planId,
  input,
  { db, viewer, createRepository = createMarketingPlanRepository, now = () => new Date() } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingPlanActionInput.parse({ ...input, action: 'archive' })
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)

  const aggregate = await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(planId))
    assertPlanBusiness(current, data.businessId)
    assertMutable(current)
    const next = await txRepository.archive({ planId, expectedVersion: data.expectedVersion, updatedAt: timestamp })
    const version = currentVersion(next)
    await recordAudit(tx, {
      entityType: 'MARKETING_PLAN',
      entityId: planId,
      action: 'ARCHIVED',
      actorId,
      payload: auditPayload(next, version, actorAudit(actorId, { expectedVersion: data.expectedVersion })),
    })
    return txRepository.load(planId)
  })

  return toMarketingPlanDto(aggregate, { canWrite: false })
}

/**
 * PM's read-side approval gate. It intentionally performs the same scope,
 * current-version, hash, PASS-review and expiry checks as decideMarketingPlan.
 * PM can then use the returned immutable DTO and commit its own transaction;
 * MarketingHandoff remains PM-owned and is not written by this helper.
 */
export async function getApprovedMarketingPlanForHandoff({
  planId,
  businessId,
  expectedVersion,
  viewer,
  db,
  now = () => new Date(),
  createRepository = createMarketingPlanRepository,
  operation = 'commit',
} = {}) {
  requireDependencies({ db, createRepository })
  // Preview is a read of an already-approved artifact. Commit callers remain
  // owner-gated by default, including unknown operation values.
  const access = operation === 'preview'
    ? await assertMarketingReadAccess({ db, viewer, businessId })
    : await assertMarketingWriteAccess({ db, viewer, businessId })
  const { scope } = access
  const repository = requireRepository(db, createRepository, scope)
  const aggregate = requireAggregate(await repository.load(planId))
  assertPlanBusiness(aggregate, businessId)
  if (aggregate.plan.version !== expectedVersion) {
    throw marketingConflict('Marketing plan changed; reload before handoff')
  }
  if (aggregate.plan.status !== 'APPROVED') {
    throw marketingConflict('Marketing plan is not approved for handoff')
  }

  const { approval } = assertCurrentApproval(aggregate, resolveNow(now))

  return {
    plan: toMarketingPlanDto(aggregate, { canWrite: access.canWrite }),
    approval: decisionDto(approval),
  }
}

export {
  MARKETING_PLAN_DECISION_VERDICTS,
  zMarketingPlanActionInput,
}
