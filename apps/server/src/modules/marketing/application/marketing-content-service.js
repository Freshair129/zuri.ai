import { randomUUID } from 'node:crypto'

import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { getMarketingCampaign } from '@/modules/marketing/application/marketing-campaign-service'
import {
  readMarketingContentReferences as defaultReadMarketingContentReferences,
  resolveMarketingContentAsset as defaultResolveMarketingContentAsset,
} from '@/modules/marketing/application/marketing-content-references'
import {
  assertMarketingReadAccess,
  assertMarketingWriteAccess,
  marketingConflict,
  marketingNotFound,
} from '@/modules/marketing/application/marketing-authority'
import {
  isActiveRightsWindow,
  isFiniteFutureDate,
  hashMarketingContentContent,
  parseMarketingContentVersionPayload,
  serializeMarketingContentVersion,
  zMarketingContentActionInput,
  zMarketingContentCreateInput,
  zMarketingContentDecisionInput,
  zMarketingContentPayload,
  zMarketingContentPayloadInput,
  zMarketingContentRevisionInput,
  zMarketingContentReviewInput,
} from '@/modules/marketing/domain/marketing-content-contract'
import { createMarketingContentRepository } from '@/modules/marketing/infrastructure/marketing-content-repository'

// @req FR-157 — persist Content briefs through one scoped service with
// immutable versions, independent review, exact decisions, live rights/file
// checks and atomic audit/CAS writes.
// @spec SDD-088, BR-001, SEC-001, SEC-003
// @tested tests/integration/marketing-content.test.js

const SHA256 = /^[a-f0-9]{64}$/

function requireDependencies({ db, createRepository }) {
  if (!db?.business?.findUnique) {
    throw new Error('Marketing content service requires a Prisma client with a Business model')
  }
  if (typeof createRepository !== 'function') {
    throw new Error('Marketing content repository factory is required')
  }
}

function principalId(viewer) {
  const id = viewer?.principal?.id
  if (typeof id !== 'string' || !id) {
    throw new Error('Marketing content service requires a resolved viewer principal')
  }
  return id
}

function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Marketing content clock returned an invalid date')
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
    throw new Error('Marketing content repository must support load and transaction')
  }
  return repository
}

function requireAggregate(aggregate) {
  if (!aggregate?.brief) throw marketingNotFound('Marketing content brief not found')
  return aggregate
}

function currentVersion(aggregate) {
  const version = aggregate.revisions.find((item) => item.revision === aggregate.brief.currentRevision)
  if (!version) throw marketingConflict('Marketing content current revision is missing')
  return version
}

function versionContent(version) {
  let content
  try {
    content = parseMarketingContentVersionPayload(version.payloadJson)
  } catch (error) {
    throw marketingConflict(error.message)
  }
  const payloadHash = hashMarketingContentContent(content)
  if (payloadHash !== version.payloadHash) {
    throw marketingConflict('Marketing content revision hash is invalid')
  }
  return { ...content, payloadHash }
}

function assertCurrentBinding(aggregate, { contentVersionId, payloadHash }) {
  const version = currentVersion(aggregate)
  if (version.id !== contentVersionId || version.payloadHash !== payloadHash) {
    throw marketingConflict('Marketing content revision is stale; reload before deciding')
  }
  const content = versionContent(version)
  if (content.title !== aggregate.brief.title) {
    throw marketingConflict('Marketing content title is inconsistent with its current revision')
  }
  return { version, content }
}

function assertMutable(aggregate) {
  if (aggregate.brief.status === 'ARCHIVED') {
    throw marketingConflict('Archived Marketing content briefs cannot be changed')
  }
  if (aggregate.brief.deletedAt) throw marketingNotFound('Marketing content brief not found')
}

function actorAudit(actorId, extra = {}) {
  return { ...extra, actorId }
}

function auditPayload(aggregate, version, extra = {}) {
  return {
    businessId: aggregate.brief.businessId,
    tenantId: aggregate.brief.tenantId,
    briefId: aggregate.brief.id,
    contentVersionId: version?.id || null,
    revision: version?.revision || aggregate.brief.currentRevision,
    payloadHash: version?.payloadHash || null,
    ...extra,
  }
}

function parseDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function normalizeResolvedFile(result) {
  if (!result) return null
  if ((result.file || result.asset) && result.status && result.status !== 'READY') return null
  return result.file || result.asset || result
}

async function resolveFileForWrite({ viewer, businessId, fileId }, { db, resolveAsset = defaultResolveMarketingContentAsset }) {
  const result = await resolveAsset({ viewer, businessId, fileId }, { db })
  const file = normalizeResolvedFile(result)
  if (!file) {
    throw marketingNotFound('Marketing file asset not found')
  }
  const state = file.state ?? file.status
  if (state !== 'ACTIVE') throw marketingConflict('Marketing file asset is not active')
  if (!Number.isInteger(file.version) || file.version < 1 || !SHA256.test(file.sha256 || '')) {
    throw marketingConflict('Marketing file asset fingerprint is unavailable')
  }
  return file
}

async function readReferences({ viewer, businessId, payload }, {
  db,
  now,
  readMarketingContentReferences = defaultReadMarketingContentReferences,
} = {}) {
  return readMarketingContentReferences({
    viewer,
    businessId,
    asset: payload.asset,
    production: payload.production,
  }, { db, now })
}

async function normalizePayload(input, {
  viewer,
  businessId,
  db,
  now,
  resolveAsset = defaultResolveMarketingContentAsset,
  readMarketingContentReferences = defaultReadMarketingContentReferences,
  getCampaign = getMarketingCampaign,
} = {}) {
  const parsed = zMarketingContentPayloadInput.parse(input)
  let asset = null
  if (parsed.asset) {
    const file = await resolveFileForWrite({ viewer, businessId, fileId: parsed.asset.fileId }, { db, resolveAsset })
    asset = { fileId: file.id, fileVersion: file.version, sha256: file.sha256 }
  }

  if (parsed.initiativeId) {
    let campaign
    try {
      campaign = await getCampaign(
        { viewer, businessId, initiativeId: parsed.initiativeId },
        { db, now },
      )
    } catch (error) {
      if (error?.status === 404) throw marketingNotFound('Marketing campaign not found')
      throw error
    }
    if (!campaign || campaign.businessId !== businessId) throw marketingNotFound('Marketing campaign not found')
  }

  const payload = zMarketingContentPayload.parse({ ...parsed, asset })
  const references = await readMarketingContentReferences({
    viewer,
    businessId,
    asset: payload.asset,
    production: payload.production,
  }, { db, now })
  if (payload.asset && references.asset?.status !== 'READY') {
    throw marketingConflict(references.asset?.reasonCode || 'Marketing file asset is unavailable')
  }
  if (payload.production && references.production?.status !== 'READY') {
    throw marketingNotFound('Marketing production reference not found')
  }
  return payload
}

function versionDto(aggregate, version) {
  const content = versionContent(version)
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
    briefId: review.briefId,
    contentVersionId: review.contentVersionId,
    payloadHash: review.payloadHash,
    sequence: review.sequence,
    verdict: review.verdict,
    rationale: review.rationale,
    rightsConfirmed: review.rightsConfirmed,
    brandConfirmed: review.brandConfirmed,
    reviewerId: review.reviewerId,
    createdAt: review.createdAt,
  }
}

function decisionDto(decision) {
  return {
    id: decision.id,
    briefId: decision.briefId,
    contentVersionId: decision.contentVersionId,
    payloadHash: decision.payloadHash,
    sequence: decision.sequence,
    reviewId: decision.reviewId,
    verdict: decision.verdict,
    rationale: decision.rationale,
    actorId: decision.actorId,
    expiresAt: decision.expiresAt,
    createdAt: decision.createdAt,
  }
}

function latestBySequence(rows) {
  if (!rows.length) return null
  const sequences = rows.map((row) => Number(row.sequence))
  if (sequences.some((sequence) => !Number.isInteger(sequence) || sequence < 1)) {
    throw marketingConflict('Marketing content acceptance sequence is invalid')
  }
  const highest = Math.max(...sequences)
  const latest = rows.filter((row) => Number(row.sequence) === highest)
  if (latest.length > 1) throw marketingConflict('Marketing content acceptance sequence is ambiguous')
  return latest[0]
}

function currentReview(aggregate, versionId, payloadHash) {
  const latest = latestBySequence(aggregate.reviews.filter((review) => review.contentVersionId === versionId))
  if (latest && payloadHash !== undefined && latest.payloadHash !== payloadHash) return null
  return latest
}

function assertIndependentReview(review, version, payloadHash) {
  if (!review || review.contentVersionId !== version.id || review.payloadHash !== payloadHash || review.reviewerId === version.createdBy) {
    throw marketingConflict('Marketing content review is stale or not independent')
  }
  return review
}

function assertLatestPassReview(aggregate, version, payloadHash, reviewId) {
  const latest = currentReview(aggregate, version.id)
  if (!latest || latest.id !== reviewId || latest.verdict !== 'PASS') {
    throw marketingConflict('APPROVE requires a PASS review of the latest current revision')
  }
  const review = assertIndependentReview(latest, version, payloadHash)
  if (!review.rightsConfirmed || !review.brandConfirmed) {
    throw marketingConflict('APPROVE requires rights and brand confirmation')
  }
  return review
}

function assertDecisionReviewBinding(aggregate, version, data) {
  if (!data.reviewId) return null
  const review = aggregate.reviews.find((row) => row.id === data.reviewId)
  return assertIndependentReview(review, version, data.payloadHash)
}

async function evaluateApproval(aggregate, { viewer, db, now, resolveAsset, readMarketingContentReferences } = {}) {
  const version = currentVersion(aggregate)
  const content = versionContent(version)
  const decision = latestBySequence(aggregate.decisions)
  const invalid = (reasonCode) => ({
    valid: false,
    reasonCode,
    decisionId: decision?.id || null,
    version,
    content,
    decision,
    review: null,
    references: null,
  })
  if (aggregate.brief.status === 'ARCHIVED' || aggregate.brief.deletedAt) return invalid('ARCHIVED')
  if (content.title !== aggregate.brief.title) return invalid('TITLE_MISMATCH')
  if (!decision || decision.contentVersionId !== version.id || decision.payloadHash !== version.payloadHash) return invalid('NO_CURRENT_APPROVAL')
  if (decision.verdict === 'REVOKE') return invalid('REVOKED')
  if (decision.verdict !== 'APPROVE') return invalid('NOT_APPROVED')
  let review
  try {
    review = assertLatestPassReview(aggregate, version, version.payloadHash, decision.reviewId)
  } catch (error) {
    if (error?.status === 409) return invalid('REVIEW_INVALID')
    throw error
  }
  const expiresAt = parseDate(decision.expiresAt)
  if (!isFiniteFutureDate(expiresAt, now)) return invalid('DECISION_EXPIRED')
  if (!content.payload.asset || !content.payload.rights) return invalid('OUTPUT_RIGHTS_REQUIRED')
  if (!isActiveRightsWindow(content.payload.rights, now)) return invalid('RIGHTS_EXPIRED')
  const validUntil = parseDate(content.payload.rights.validUntil)
  if (!validUntil || expiresAt > validUntil) return invalid('DECISION_EXPIRES_AFTER_RIGHTS')
  const references = await readReferences({ viewer, businessId: aggregate.brief.businessId, payload: content.payload }, {
    db,
    now,
    readMarketingContentReferences,
    resolveAsset,
  })
  if (references.asset?.status !== 'READY') return invalid(references.asset?.reasonCode || 'FILE_UNAVAILABLE')
  return {
    valid: true,
    reasonCode: null,
    decisionId: decision.id,
    version,
    content,
    decision,
    review,
    references,
  }
}

async function toReferencesForVersion({ aggregate, version, viewer, db, now, resolveAsset, readMarketingContentReferences }) {
  const content = versionContent(version)
  return readReferences({ viewer, businessId: aggregate.brief.businessId, payload: content.payload }, {
    db,
    now,
    readMarketingContentReferences,
    resolveAsset,
  })
}

async function toReferences({ aggregate, viewer, db, now, resolveAsset, readMarketingContentReferences }) {
  return toReferencesForVersion({
    aggregate,
    version: currentVersion(aggregate),
    viewer,
    db,
    now,
    resolveAsset,
    readMarketingContentReferences,
  })
}

function phaseForContent({ aggregate, approval, references }) {
  if (aggregate.brief.status === 'ARCHIVED') return 'ARCHIVED'
  if (approval.valid) return 'APPROVED'
  const version = currentVersion(aggregate)
  const review = currentReview(aggregate, version.id, version.payloadHash)
  if (review) return 'REVIEW'
  if (references?.production?.status === 'READY') return 'PRODUCTION'
  return 'DRAFT'
}

function briefSummary(aggregate, { canWrite, approval, references }) {
  const version = currentVersion(aggregate)
  return {
    id: aggregate.brief.id,
    tenantId: aggregate.brief.tenantId,
    businessId: aggregate.brief.businessId,
    code: aggregate.brief.code,
    title: aggregate.brief.title,
    status: aggregate.brief.status,
    currentRevision: aggregate.brief.currentRevision,
    version: aggregate.brief.version,
    createdBy: aggregate.brief.createdBy,
    createdAt: aggregate.brief.createdAt,
    updatedAt: aggregate.brief.updatedAt,
    deletedAt: aggregate.brief.deletedAt,
    currentVersion: versionDto(aggregate, version),
    phase: phaseForContent({ aggregate, approval, references }),
    approval: {
      valid: approval.valid,
      reasonCode: approval.reasonCode,
      decisionId: approval.decisionId,
    },
    references,
    canWrite: canWrite && aggregate.brief.status !== 'ARCHIVED',
  }
}

export function toMarketingContentDto(aggregate, {
  canWrite = false,
  approval = { valid: false, reasonCode: 'NOT_EVALUATED', decisionId: null },
  references = { asset: { status: 'UNAVAILABLE', reasonCode: 'NOT_EVALUATED', file: null }, production: { status: 'UNAVAILABLE', reasonCode: 'NOT_EVALUATED', project: null, workItem: null } },
} = {}) {
  const value = requireAggregate(aggregate)
  const summary = briefSummary(value, { canWrite, approval, references })
  return {
    ...summary,
    versions: value.revisions.map((revision) => versionDto(value, revision)),
    reviews: value.reviews.map(reviewDto),
    decisions: value.decisions.map(decisionDto),
    canWrite: canWrite && value.brief.status !== 'ARCHIVED',
  }
}

function auditEntity(aggregate, version, action, actorId, extra = {}) {
  return {
    entityType: 'MARKETING_CONTENT_BRIEF',
    entityId: aggregate.brief.id,
    action,
    actorId,
    payload: auditPayload(aggregate, version, actorAudit(actorId, extra)),
  }
}

async function loadScopedAggregate({ db, createRepository, scope, briefId }) {
  const repository = requireRepository(db, createRepository, scope)
  const aggregate = await repository.load(briefId)
  return { repository, aggregate: requireAggregate(aggregate) }
}

export async function listMarketingContent(
  { viewer, businessId } = {},
  {
    db = prisma,
    createRepository = createMarketingContentRepository,
    now = () => new Date(),
    resolveAsset = defaultResolveMarketingContentAsset,
    readMarketingContentReferences,
  } = {},
) {
  requireDependencies({ db, createRepository })
  const clock = resolveNow(now)
  const { scope, canWrite } = await assertMarketingReadAccess({ db, viewer, businessId })
  const repository = requireRepository(db, createRepository, scope)
  const listed = await repository.listBriefs({ limit: 100 })
  const briefs = []
  for (const row of listed.briefs) {
    const aggregate = await repository.load(row.id)
    if (!aggregate) continue
    const approval = await evaluateApproval(aggregate, { viewer, db, now: clock, resolveAsset, readMarketingContentReferences })
    const references = await toReferences({ aggregate, viewer, db, now: clock, resolveAsset, readMarketingContentReferences })
    briefs.push(briefSummary(aggregate, { canWrite, approval, references }))
  }
  return { briefs, truncated: listed.truncated, canWrite }
}

export async function getMarketingContent(
  { viewer, businessId, briefId } = {},
  {
    db = prisma,
    createRepository = createMarketingContentRepository,
    now = () => new Date(),
    resolveAsset = defaultResolveMarketingContentAsset,
    readMarketingContentReferences,
  } = {},
) {
  requireDependencies({ db, createRepository })
  const clock = resolveNow(now)
  const { scope, canWrite } = await assertMarketingReadAccess({ db, viewer, businessId })
  const { aggregate } = await loadScopedAggregate({ db, createRepository, scope, briefId })
  if (aggregate.brief.businessId !== businessId) throw marketingNotFound('Marketing content brief not found')
  const approval = await evaluateApproval(aggregate, { viewer, db, now: clock, resolveAsset, readMarketingContentReferences })
  const references = await toReferences({ aggregate, viewer, db, now: clock, resolveAsset, readMarketingContentReferences })
  return toMarketingContentDto(aggregate, { canWrite, approval, references })
}

export async function createMarketingContent(
  input,
  {
    db = prisma,
    viewer,
    createRepository = createMarketingContentRepository,
    now = () => new Date(),
    idFactory = randomUUID,
    resolveAsset = defaultResolveMarketingContentAsset,
    readMarketingContentReferences = defaultReadMarketingContentReferences,
    getCampaign = getMarketingCampaign,
  } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingContentCreateInput.parse(input)
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const briefId = idFactory()
  const repository = requireRepository(db, createRepository, scope)
  await repository.transaction(async (txRepository, tx) => {
    const payload = await normalizePayload(data.payload, {
      viewer,
      businessId: data.businessId,
      db: tx,
      now: timestamp,
      resolveAsset,
      readMarketingContentReferences,
      getCampaign,
    })
    const brief = await txRepository.createBrief({
      id: briefId,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      code: nextContentCode(data.title, briefId),
      title: data.title,
      status: 'OPEN',
      currentRevision: 1,
      version: 1,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    })
    const revision = await txRepository.createRevision({
      id: idFactory(),
      briefId: brief.id,
      revision: 1,
      payloadJson: serializeMarketingContentVersion({ title: data.title, payload }),
      payloadHash: hashMarketingContentContent({ title: data.title, payload }),
      createdBy: actorId,
      createdAt: timestamp,
    })
    await recordAudit(tx, auditEntity({ brief }, revision, 'CREATED', actorId))
    return txRepository.load(brief.id)
  })
  return getMarketingContent(
    { viewer, businessId: data.businessId, briefId },
    { db, createRepository, now, resolveAsset, readMarketingContentReferences },
  )
}

function nextContentCode(title, id) {
  const slug = String(title)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'CONTENT'
  return `MKT-CRE-${slug}-${id.slice(0, 8).toUpperCase()}`
}

export async function reviseMarketingContent(
  briefId,
  input,
  {
    db = prisma,
    viewer,
    createRepository = createMarketingContentRepository,
    now = () => new Date(),
    idFactory = randomUUID,
    resolveAsset = defaultResolveMarketingContentAsset,
    readMarketingContentReferences = defaultReadMarketingContentReferences,
    getCampaign = getMarketingCampaign,
  } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingContentRevisionInput.parse(withoutAction(input))
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)
  await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(briefId))
    if (current.brief.businessId !== data.businessId) throw marketingNotFound('Marketing content brief not found')
    assertMutable(current)
    const payload = await normalizePayload(data.payload, {
      viewer,
      businessId: data.businessId,
      db: tx,
      now: timestamp,
      resolveAsset,
      readMarketingContentReferences,
      getCampaign,
    })
    const revision = current.brief.currentRevision + 1
    const payloadHash = hashMarketingContentContent({ title: data.title, payload })
    const next = await txRepository.appendRevision({
      briefId,
      expectedVersion: data.expectedVersion,
      revision,
      updatedAt: timestamp,
      data: {
        id: idFactory(),
        title: data.title,
        payloadJson: serializeMarketingContentVersion({ title: data.title, payload }),
        payloadHash,
        createdBy: actorId,
        createdAt: timestamp,
      },
    })
    const version = currentVersion(next)
    await recordAudit(tx, auditEntity(next, version, 'REVISION_APPENDED', actorId, { expectedVersion: data.expectedVersion }))
  })
  return getMarketingContent({ viewer, businessId: data.businessId, briefId }, {
    db,
    createRepository,
    now,
    resolveAsset,
    readMarketingContentReferences,
  })
}

export async function reviewMarketingContent(
  briefId,
  input,
  {
    db = prisma,
    viewer,
    createRepository = createMarketingContentRepository,
    now = () => new Date(),
    idFactory = randomUUID,
    resolveAsset = defaultResolveMarketingContentAsset,
    readMarketingContentReferences = defaultReadMarketingContentReferences,
  } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingContentReviewInput.parse({ ...input, action: 'review' })
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)
  await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(briefId))
    if (current.brief.businessId !== data.businessId) throw marketingNotFound('Marketing content brief not found')
    assertMutable(current)
    const { version, content } = assertCurrentBinding(current, data)
    if (version.createdBy === actorId) throw marketingConflict('Marketing content reviewer must differ from the revision author')
    if (data.verdict === 'PASS' && content.payload.asset && (!data.rightsConfirmed || !data.brandConfirmed)) {
      throw marketingConflict('PASS review with an output requires rights and brand confirmation')
    }
    const next = await txRepository.appendReview({
      briefId,
      expectedVersion: data.expectedVersion,
      updatedAt: timestamp,
      data: {
        id: idFactory(),
        briefId,
        contentVersionId: version.id,
        payloadHash: data.payloadHash,
        sequence: data.expectedVersion + 1,
        verdict: data.verdict,
        rationale: data.rationale,
        rightsConfirmed: data.rightsConfirmed,
        brandConfirmed: data.brandConfirmed,
        reviewerId: actorId,
        createdAt: timestamp,
      },
    })
    await recordAudit(tx, auditEntity(next, version, 'REVIEWED', actorId, {
      expectedVersion: data.expectedVersion,
      sequence: data.expectedVersion + 1,
      verdict: data.verdict,
      reviewId: next.reviews[next.reviews.length - 1]?.id || null,
    }))
  })
  return getMarketingContent({ viewer, businessId: data.businessId, briefId }, {
    db,
    createRepository,
    now,
    resolveAsset,
    readMarketingContentReferences,
  })
}

async function validateDecision(aggregate, data, actorId, now, dependencies) {
  assertMutable(aggregate)
  const { version, content } = assertCurrentBinding(aggregate, data)
  const review = data.reviewId ? assertDecisionReviewBinding(aggregate, version, data) : null
  if (data.verdict === 'APPROVE') {
    const latest = assertLatestPassReview(aggregate, version, data.payloadHash, data.reviewId)
    if (!content.payload.asset || !content.payload.rights) throw marketingConflict('APPROVE requires an output and rights')
    const expiresAt = parseDate(data.expiresAt)
    if (!isFiniteFutureDate(expiresAt, now)) throw marketingConflict('APPROVE requires a finite future expiresAt')
    if (!isActiveRightsWindow(content.payload.rights, now)) throw marketingConflict('Marketing content rights are not active')
    const validUntil = parseDate(content.payload.rights.validUntil)
    if (!validUntil || expiresAt > validUntil) throw marketingConflict('Decision expiry cannot exceed rights expiry')
    const references = await readReferences({ viewer: dependencies.viewer, businessId: aggregate.brief.businessId, payload: content.payload }, {
      db: dependencies.db,
      now,
      readMarketingContentReferences: dependencies.readMarketingContentReferences,
      resolveAsset: dependencies.resolveAsset,
    })
    if (references.asset?.status !== 'READY') throw marketingConflict(references.asset?.reasonCode || 'Marketing file asset is unavailable')
    return { version, content, review: latest, expiresAt }
  }
  if (data.reviewId) assertIndependentReview(review, version, data.payloadHash)
  if (data.verdict === 'REVOKE') {
    const latest = latestBySequence(aggregate.decisions)
    if (!latest || latest.verdict !== 'APPROVE' || latest.contentVersionId !== version.id || latest.payloadHash !== data.payloadHash) {
      throw marketingConflict('REVOKE requires the current revision to have an approval')
    }
  }
  return { version, content, review, expiresAt: null, actorId }
}

export async function decideMarketingContent(
  briefId,
  input,
  {
    db = prisma,
    viewer,
    createRepository = createMarketingContentRepository,
    now = () => new Date(),
    idFactory = randomUUID,
    resolveAsset = defaultResolveMarketingContentAsset,
    readMarketingContentReferences,
  } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingContentDecisionInput.parse({ ...input, action: 'decide' })
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)
  await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(briefId))
    if (current.brief.businessId !== data.businessId) throw marketingNotFound('Marketing content brief not found')
    const checked = await validateDecision(current, data, actorId, timestamp, {
      db: tx,
      viewer,
      resolveAsset,
      readMarketingContentReferences,
    })
    const next = await txRepository.appendDecision({
      briefId,
      expectedVersion: data.expectedVersion,
      updatedAt: timestamp,
      data: {
        id: idFactory(),
        briefId,
        contentVersionId: checked.version.id,
        payloadHash: data.payloadHash,
        sequence: data.expectedVersion + 1,
        reviewId: data.reviewId || null,
        verdict: data.verdict,
        rationale: data.rationale,
        actorId,
        expiresAt: checked.expiresAt,
        createdAt: timestamp,
      },
    })
    await recordAudit(tx, auditEntity(next, checked.version, 'DECIDED', actorId, {
      expectedVersion: data.expectedVersion,
      sequence: data.expectedVersion + 1,
      verdict: data.verdict,
      decisionId: next.decisions[next.decisions.length - 1]?.id || null,
      reviewId: data.reviewId || null,
    }))
  })
  return getMarketingContent({ viewer, businessId: data.businessId, briefId }, {
    db,
    createRepository,
    now,
    resolveAsset,
    readMarketingContentReferences,
  })
}

export async function archiveMarketingContent(
  briefId,
  input,
  {
    db = prisma,
    viewer,
    createRepository = createMarketingContentRepository,
    now = () => new Date(),
  } = {},
) {
  requireDependencies({ db, createRepository })
  const data = zMarketingContentActionInput.parse(input)
  if (data.action !== 'archive') throw new Error('Marketing content archive action is required')
  const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
  const actorId = principalId(viewer)
  const timestamp = resolveNow(now)
  const repository = requireRepository(db, createRepository, scope)
  await repository.transaction(async (txRepository, tx) => {
    const current = requireAggregate(await txRepository.load(briefId))
    if (current.brief.businessId !== data.businessId) throw marketingNotFound('Marketing content brief not found')
    assertMutable(current)
    const version = currentVersion(current)
    const next = await txRepository.archive({ briefId, expectedVersion: data.expectedVersion, updatedAt: timestamp })
    await recordAudit(tx, auditEntity(next, version, 'ARCHIVED', actorId, { expectedVersion: data.expectedVersion }))
  })
  return getMarketingContent({ viewer, businessId: data.businessId, briefId }, { db, createRepository, now })
}

export async function updateMarketingContent(briefId, input, dependencies = {}) {
  const parsed = zMarketingContentActionInput.parse(input)
  if (parsed.action === 'revise') return reviseMarketingContent(briefId, parsed, dependencies)
  if (parsed.action === 'review') return reviewMarketingContent(briefId, parsed, dependencies)
  if (parsed.action === 'decide') return decideMarketingContent(briefId, parsed, dependencies)
  return archiveMarketingContent(briefId, parsed, dependencies)
}

export async function getMarketingContentAsset(
  { viewer, businessId, assetId } = {},
  {
    db = prisma,
    createRepository = createMarketingContentRepository,
    now = () => new Date(),
    resolveAsset = defaultResolveMarketingContentAsset,
    readMarketingContentReferences,
  } = {},
) {
  requireDependencies({ db, createRepository })
  const clock = resolveNow(now)
  const { scope, canWrite } = await assertMarketingReadAccess({ db, viewer, businessId })
  const repository = requireRepository(db, createRepository, scope)
  const aggregate = requireAggregate(await repository.loadByVersionId(assetId))
  if (aggregate.brief.businessId !== businessId) throw marketingNotFound('Marketing content asset not found')
  const version = aggregate.revisions.find((row) => row.id === assetId)
  if (!version) throw marketingNotFound('Marketing content asset not found')
  const approval = await evaluateApproval(aggregate, { viewer, db, now: clock, resolveAsset, readMarketingContentReferences })
  const currentReferences = await toReferences({ aggregate, viewer, db, now: clock, resolveAsset, readMarketingContentReferences })
  const requestedReferences = await toReferencesForVersion({
    aggregate,
    version,
    viewer,
    db,
    now: clock,
    resolveAsset,
    readMarketingContentReferences,
  })
  const detail = toMarketingContentDto(aggregate, { canWrite, approval, references: currentReferences })
  return {
    brief: detail,
    assetVersion: versionDto(aggregate, version),
    references: requestedReferences,
    isCurrent: version.id === currentVersion(aggregate).id,
    usable: version.id === currentVersion(aggregate).id && approval.valid,
  }
}
