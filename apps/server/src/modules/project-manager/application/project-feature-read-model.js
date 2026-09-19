import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { requireSessionSecret } from '@/modules/identity/auth-service'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { resolveProjectDomain } from '@/modules/project-manager/project-domain-catalog'
import { createProjectFeatureRepository } from './project-feature-repository'
import { createGovernanceEvidencePort } from './governance-source-verifier'
import { computeProjectFeatureGraphEtag } from './project-feature-service'
import { activeWorkstream } from './active-filters'

// @req FR-252 — the Phase B Feature view reads only explicit ProjectFeature
// relationships after a complete Project hierarchy proof; it never infers a
// Feature from a Domain label, tag or Workstream binding.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/unit/project-feature-read-model.test.js, tests/integration/project-feature-read-routes.test.js

export const PROJECT_FEATURE_VIEW_SCHEMA_VERSION = '1.0'
export const MAX_FEATURE_VIEW_ROWS = 200
export const MAX_FEATURE_PAGE_ROWS = 50
export const MAX_CURSOR_LENGTH = 4096
export const FEATURE_CURSOR_TTL_MS = 15 * 60 * 1000

const CURSOR_PREFIX = 'pm_feature_cursor_v1'
const FEATURE_LIFECYCLES = ['DRAFT', 'ACTIVE', 'RETIRED']
const FEATURE_VISIBILITIES = ['ACTIVE', 'DELETED']
const FEATURE_ALLOCATION_STATES = ['UNALLOCATED', 'PARTIAL', 'COMPLETE_SPLIT']

const zIsoDate = z.string().datetime({ offset: true })

export const zFeatureReadError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().uuid(),
  retryable: z.boolean(),
  currentVersion: z.number().int().positive().nullable().optional(),
  currentEtag: z.string().max(4096).nullable().optional(),
  fields: z.array(z.object({
    path: z.string().min(1).max(256),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(1000),
  }).strict()).max(50).optional(),
}).strict()

export const zDomainReference = z.object({
  domainId: z.string().min(1).max(128),
  label: z.string().min(1).max(200),
  mappingState: z.enum(['MAPPED', 'UNMAPPED']),
}).strict()

export const zEvidence = z.object({
  state: z.enum(['AVAILABLE', 'UNKNOWN', 'UNAVAILABLE']),
  ref: z.string().max(1000).nullable().optional(),
}).strict()

export const zFeatureContribution = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  domainId: z.string().min(1).max(128),
  label: z.string().max(200).nullable(),
  mappingState: z.enum(['MAPPED', 'UNMAPPED']),
  responsibility: z.string().min(1).max(2000),
  deletedAt: zIsoDate.nullable().optional(),
  deleteBatchId: z.string().uuid().nullable().optional(),
}).strict()

export const zFeatureWorkLink = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  workItemId: z.string().uuid(),
  allocationBps: z.number().int().min(0).max(10000).nullable(),
  allocationState: z.enum(FEATURE_ALLOCATION_STATES),
  workItem: z.object({
    code: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
  }).strict(),
  deletedAt: zIsoDate.nullable().optional(),
  deleteBatchId: z.string().uuid().nullable().optional(),
}).strict()

export const zRequirementBinding = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  governanceSnapshotId: z.string().uuid(),
  sourceNamespace: z.string().min(1).max(128),
  requirementKey: z.string().min(1).max(128),
  revisionHash: z.string().regex(/^[0-9a-f]{64}$/),
  acceptanceRef: z.string().min(1).max(1000),
  canonicalSubject: z.string().nullable().optional(),
  bindingState: z.enum(['PINNED', 'UNAVAILABLE']),
  deletedAt: zIsoDate.nullable().optional(),
  deleteBatchId: z.string().uuid().nullable().optional(),
}).strict()

const featureRecordShape = {
  id: z.string().uuid(),
  version: z.number().int().positive(),
  projectId: z.string().uuid(),
  code: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  problem: z.string().min(1).max(5000),
  outcome: z.string().min(1).max(5000),
  primaryDomain: zDomainReference,
  contributions: z.array(zFeatureContribution).max(200),
  workLinks: z.array(zFeatureWorkLink).max(200),
  requirementBindings: z.array(zRequirementBinding).max(200),
  canonicalFeatureKey: z.string().min(1).max(200).nullable(),
  governanceSnapshotId: z.string().uuid().nullable(),
  lifecycle: z.enum(FEATURE_LIFECYCLES),
  deletedAt: zIsoDate.nullable().optional(),
  deleteBatchId: z.string().uuid().nullable().optional(),
  createdAt: zIsoDate.optional(),
  updatedAt: zIsoDate.optional(),
  uniqueWorkCount: z.number().int().nonnegative(),
  evidence: z.array(zEvidence).max(200),
  evidenceState: z.enum(['AVAILABLE', 'UNKNOWN', 'UNAVAILABLE']),
}

export const zFeatureRecord = z.object(featureRecordShape).strict().superRefine((value, ctx) => {
  const hasKey = value.canonicalFeatureKey !== null
  const hasSnapshot = value.governanceSnapshotId !== null
  if (hasKey !== hasSnapshot) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['canonicalFeatureKey'],
      message: 'canonicalFeatureKey and governanceSnapshotId must be paired',
    })
  }
})

export const zDeletedFeatureRecord = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  code: z.string().min(1).max(128),
  lifecycle: z.enum(FEATURE_LIFECYCLES),
  version: z.number().int().positive(),
  deletedAt: zIsoDate,
  deleteBatchId: z.string().uuid(),
}).strict()

export const zFeatureView = z.object({
  schemaVersion: z.literal(PROJECT_FEATURE_VIEW_SCHEMA_VERSION),
  projectId: z.string().uuid(),
  snapshotId: z.null(),
  snapshotState: z.literal('UNAVAILABLE'),
  observedAt: zIsoDate,
  uniqueWorkCount: z.number().int().nonnegative(),
  features: z.array(zFeatureRecord).max(MAX_FEATURE_VIEW_ROWS),
}).strict()

export const zFeatureRecordPage = z.object({
  items: z.array(z.union([zFeatureRecord, zDeletedFeatureRecord])).max(MAX_FEATURE_PAGE_ROWS),
  nextCursor: z.string().max(MAX_CURSOR_LENGTH).nullable(),
  observedAt: zIsoDate,
}).strict()

export const zGovernanceSnapshotMetadata = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().uuid(),
  commitSha: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
  manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  capturedAt: zIsoDate,
  validationStatus: z.literal('VALID'),
}).strict()

export const zGovernanceSnapshotPage = z.object({
  items: z.array(zGovernanceSnapshotMetadata).max(MAX_FEATURE_PAGE_ROWS),
  nextCursor: z.string().max(MAX_CURSOR_LENGTH).nullable(),
  observedAt: zIsoDate,
}).strict()

// Names consumed by the root OpenAPI composition. They are aliases of the
// strict candidate schemas, not a second wire contract.
export const zProjectFeatureView = zFeatureView
export const zProjectFeatureRecord = zFeatureRecord
export const zProjectFeatureRecordPage = zFeatureRecordPage
export const zProjectGovernanceSnapshotPage = zGovernanceSnapshotPage
export const zFeatureViewError = zFeatureReadError
export const zError = zFeatureReadError

const FEATURE_SELECT = Object.freeze({
  id: true,
  version: true,
  projectId: true,
  code: true,
  title: true,
  problem: true,
  outcome: true,
  primaryDomainId: true,
  canonicalFeatureKey: true,
  governanceSnapshotId: true,
  lifecycle: true,
  deletedAt: true,
  deleteBatchId: true,
})

const CONTRIBUTION_SELECT = Object.freeze({
  id: true,
  version: true,
  featureId: true,
  domainId: true,
  responsibility: true,
  deletedAt: true,
  deleteBatchId: true,
})

const WORK_LINK_SELECT = Object.freeze({
  id: true,
  version: true,
  featureId: true,
  workItemId: true,
  allocationBps: true,
  deletedAt: true,
  deleteBatchId: true,
})

const REQUIREMENT_SELECT = Object.freeze({
  id: true,
  version: true,
  featureId: true,
  governanceSnapshotId: true,
  sourceNamespace: true,
  requirementKey: true,
  revisionHash: true,
  acceptanceRef: true,
  deletedAt: true,
  deleteBatchId: true,
})

const WORK_ITEM_SELECT = Object.freeze({
  id: true,
  code: true,
  title: true,
  workstreamId: true,
  containerId: true,
  deletedAt: true,
  workstream: {
    select: { id: true, projectId: true, status: true, deletedAt: true },
  },
  container: {
    select: { id: true, workstreamId: true },
  },
})

const SNAPSHOT_SELECT = Object.freeze({
  id: true,
  repositoryId: true,
  commitSha: true,
  manifestHash: true,
  capturedAt: true,
  validationStatus: true,
  projectRepositoryId: true,
})

function readError(code, status = 503, retryable = status >= 500) {
  const error = new Error(code)
  error.name = 'ProjectFeatureReadError'
  error.code = code
  error.status = status
  error.retryable = retryable
  return error
}

function isUuid(value) {
  return typeof value === 'string' && z.string().uuid().safeParse(value).success
}

function isoDate(value, field) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw readError('DATA_INTEGRITY_UNAVAILABLE', 503)
  const result = date.toISOString()
  if (!zIsoDate.safeParse(result).success) throw readError('DATA_INTEGRITY_UNAVAILABLE', 503)
  void field
  return result
}

function scopeIds(scope) {
  return {
    projectId: scope?.project?.id || null,
    tenantId: scope?.tenantId || scope?.tenant?.id || null,
    businessId: scope?.businessId || scope?.business?.id || null,
  }
}

function domainReference(domainId) {
  const resolved = resolveProjectDomain(domainId)
  return {
    domainId: resolved.domainId,
    label: resolved.label,
    mappingState: resolved.mappingState,
  }
}

function asMap(value) {
  if (value instanceof Map) return value
  if (Array.isArray(value)) return new Map(value.filter((row) => row?.id).map((row) => [row.id, row]))
  if (value && typeof value === 'object') return new Map(Object.entries(value))
  return new Map()
}

/**
 * Derive allocation state per WorkItem. A zero is a supplied value, so a
 * single zero-valued link is PARTIAL rather than UNALLOCATED.
 */
export function deriveAllocationStates(workLinks = []) {
  const states = new Map()
  for (const link of workLinks) {
    if (!link || typeof link.workItemId !== 'string') throw readError('DATA_INTEGRITY_UNAVAILABLE', 503)
    const allocation = link.allocationBps
    if (allocation !== null && allocation !== undefined
      && (!Number.isInteger(allocation) || allocation < 0 || allocation > 10000)) {
      throw readError('DATA_INTEGRITY_UNAVAILABLE', 503)
    }
    const state = states.get(link.workItemId) || { anyValue: false, allValued: true, total: 0, count: 0 }
    state.count += 1
    if (allocation === null || allocation === undefined) {
      state.allValued = false
    } else {
      state.anyValue = true
      state.total += allocation
    }
    if (state.total > 10000) throw readError('DATA_INTEGRITY_UNAVAILABLE', 503)
    states.set(link.workItemId, state)
  }
  return new Map([...states.entries()].map(([id, state]) => {
    const value = !state.anyValue
      ? 'UNALLOCATED'
      : state.allValued && state.total === 10000
        ? 'COMPLETE_SPLIT'
        : 'PARTIAL'
    return [id, value]
  }))
}

function featureEvidence(feature, verified = null) {
  const snapshotId = feature.governanceSnapshotId ?? null
  const canonicalFeatureKey = feature.canonicalFeatureKey ?? null
  if (canonicalFeatureKey === null && snapshotId === null) {
    return { evidence: [], evidenceState: 'UNAVAILABLE' }
  }
  if (verified?.state === 'AVAILABLE'
    && verified.canonicalFeatureKey === canonicalFeatureKey
    && typeof verified.ref === 'string' && verified.ref.length > 0 && verified.ref.length <= 1000) {
    return { evidence: [{ state: 'AVAILABLE', ref: verified.ref }], evidenceState: 'AVAILABLE' }
  }
  // Stored metadata is never key proof. Missing or failed bound-commit
  // verification preserves the historical pair with explicit unavailability.
  return { evidence: [{ state: 'UNAVAILABLE', ref: null }], evidenceState: 'UNAVAILABLE' }
}

function featureContributionDto(row) {
  const domain = domainReference(row.domainId)
  return {
    id: row.id,
    version: row.version,
    domainId: row.domainId,
    label: domain.label,
    mappingState: domain.mappingState,
    responsibility: row.responsibility,
  }
}

function featureWorkLinkDto(row, workItems, allocationStates) {
  const item = workItems.get(row.workItemId)
  if (!item) throw readError('DATA_INTEGRITY_UNAVAILABLE', 503)
  return {
    id: row.id,
    version: row.version,
    workItemId: row.workItemId,
    allocationBps: row.allocationBps ?? null,
    allocationState: allocationStates.get(row.workItemId) || 'UNALLOCATED',
    workItem: { code: item.code, title: item.title },
  }
}

function requirementBindingDto(row, verified = null) {
  const pinned = verified?.state === 'AVAILABLE'
    && verified.sourceNamespace === row.sourceNamespace
    && verified.requirementKey === row.requirementKey
    && verified.revisionHash === row.revisionHash
    && typeof verified.canonicalSubject === 'string' && verified.canonicalSubject.length > 0
  return {
    id: row.id,
    version: row.version,
    governanceSnapshotId: row.governanceSnapshotId,
    sourceNamespace: row.sourceNamespace,
    requirementKey: row.requirementKey,
    revisionHash: row.revisionHash,
    acceptanceRef: row.acceptanceRef,
    canonicalSubject: pinned ? verified.canonicalSubject : null,
    bindingState: pinned ? 'PINNED' : 'UNAVAILABLE',
  }
}

export function buildProjectFeatureRecord({
  scope = null,
  projectId = scopeIds(scope).projectId,
  feature,
  contributions = [],
  workLinks = [],
  allWorkLinks = workLinks,
  requirementBindings = [],
  workItems = new Map(),
  featureEvidenceById = new Map(),
  requirementEvidenceById = new Map(),
} = {}) {
  if (!feature || typeof feature !== 'object') throw readError('DATA_INTEGRITY_UNAVAILABLE', 503)
  const itemMap = asMap(workItems)
  const allocationStates = deriveAllocationStates(allWorkLinks)
  const uniqueWorkIds = new Set()
  const contributionDomains = new Set()
  for (const row of contributions) {
    if (row.domainId === feature.primaryDomainId || contributionDomains.has(row.domainId)) {
      throw readError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
    }
    contributionDomains.add(row.domainId)
  }
  for (const row of workLinks) {
    if (!itemMap.has(row.workItemId)) throw readError('DATA_INTEGRITY_UNAVAILABLE', 503)
    uniqueWorkIds.add(row.workItemId)
  }
  const evidence = featureEvidence(feature, featureEvidenceById.get(feature.id))
  const record = {
    id: feature.id,
    version: feature.version,
    projectId: projectId || feature.projectId,
    code: feature.code,
    title: feature.title,
    problem: feature.problem,
    outcome: feature.outcome,
    primaryDomain: domainReference(feature.primaryDomainId),
    contributions: contributions.map(featureContributionDto),
    workLinks: workLinks.map((row) => featureWorkLinkDto(row, itemMap, allocationStates)),
    requirementBindings: requirementBindings.map((row) => requirementBindingDto(row, requirementEvidenceById.get(row.id))),
    canonicalFeatureKey: feature.canonicalFeatureKey ?? null,
    governanceSnapshotId: feature.governanceSnapshotId ?? null,
    lifecycle: feature.lifecycle,
    uniqueWorkCount: uniqueWorkIds.size,
    evidence: evidence.evidence,
    evidenceState: evidence.evidenceState,
  }
  return zFeatureRecord.parse(record)
}

export function buildProjectFeatureView({
  scope = null,
  projectId = scopeIds(scope).projectId,
  features = [],
  contributions = [],
  workLinks = [],
  requirementBindings = [],
  workItems = new Map(),
  featureEvidenceById = new Map(),
  requirementEvidenceById = new Map(),
  now = new Date(),
} = {}) {
  if (features.length > MAX_FEATURE_VIEW_ROWS) {
    throw readError('FEATURE_VIEW_LIMIT_EXCEEDED', 413, true)
  }
  const contributionByFeature = new Map()
  for (const row of contributions) {
    const rows = contributionByFeature.get(row.featureId) || []
    rows.push(row)
    contributionByFeature.set(row.featureId, rows)
  }
  const linksByFeature = new Map()
  for (const row of workLinks) {
    const rows = linksByFeature.get(row.featureId) || []
    rows.push(row)
    linksByFeature.set(row.featureId, rows)
  }
  const bindingsByFeature = new Map()
  for (const row of requirementBindings) {
    const rows = bindingsByFeature.get(row.featureId) || []
    rows.push(row)
    bindingsByFeature.set(row.featureId, rows)
  }
  const featureRows = features.map((feature) => buildProjectFeatureRecord({
    scope,
    projectId,
    feature,
    contributions: contributionByFeature.get(feature.id) || [],
    workLinks: linksByFeature.get(feature.id) || [],
    allWorkLinks: workLinks,
    requirementBindings: bindingsByFeature.get(feature.id) || [],
    workItems,
    featureEvidenceById,
    requirementEvidenceById,
  }))
  const itemMap = asMap(workItems)
  const result = {
    schemaVersion: PROJECT_FEATURE_VIEW_SCHEMA_VERSION,
    projectId,
    snapshotId: null,
    snapshotState: 'UNAVAILABLE',
    observedAt: isoDate(now, 'observedAt'),
    uniqueWorkCount: itemMap.size,
    features: featureRows,
  }
  return zFeatureView.parse(result)
}

export function buildDeletedFeatureRecord(feature) {
  return zDeletedFeatureRecord.parse({
    id: feature.id,
    projectId: feature.projectId,
    code: feature.code,
    lifecycle: feature.lifecycle,
    version: feature.version,
    deletedAt: isoDate(feature.deletedAt, 'deletedAt'),
    deleteBatchId: feature.deleteBatchId,
  })
}

function queryValue(query, key) {
  if (query instanceof URLSearchParams) return query.get(key)
  if (query && typeof query.get === 'function') return query.get(key)
  if (query && typeof query === 'object') {
    const value = query[key]
    return Array.isArray(value) ? value[0] : value
  }
  return null
}

function parseLimit(value) {
  if (value === null || value === undefined) return 50
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw readError('MALFORMED_REQUEST', 400, false)
  }
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_FEATURE_PAGE_ROWS) {
    throw readError('MALFORMED_REQUEST', 400, false)
  }
  return limit
}

export function parseFeatureListQuery(query) {
  const visibilityValue = queryValue(query, 'visibility')
  const lifecycleValue = queryValue(query, 'lifecycle')
  const cursor = queryValue(query, 'cursor')
  const visibility = visibilityValue == null ? 'ACTIVE' : visibilityValue
  const lifecycle = lifecycleValue == null ? null : lifecycleValue
  if (!FEATURE_VISIBILITIES.includes(visibility) || (lifecycle && !FEATURE_LIFECYCLES.includes(lifecycle))) {
    throw readError('MALFORMED_REQUEST', 400, false)
  }
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH)) {
    throw readError('INVALID_CURSOR', 400, false)
  }
  return { visibility, lifecycle, limit: parseLimit(queryValue(query, 'limit')), cursor }
}

export function parseSnapshotListQuery(query) {
  const cursor = queryValue(query, 'cursor')
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH)) {
    throw readError('INVALID_CURSOR', 400, false)
  }
  return { limit: parseLimit(queryValue(query, 'limit')), cursor }
}

function cursorSecret(env) {
  try {
    return requireSessionSecret(env)
  } catch {
    throw readError('SESSION_UNAVAILABLE', 503, true)
  }
}

function encodeCursor(payload, { env = process.env } = {}) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const value = CURSOR_PREFIX + '.' + encoded
  const signature = createHmac('sha256', cursorSecret(env)).update(value, 'utf8').digest('base64url')
  const token = value + '.' + signature
  if (token.length > MAX_CURSOR_LENGTH) throw readError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
  return token
}

export function decodeFeatureCursor(token, expected, { env = process.env, now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_CURSOR_LENGTH) {
    throw readError('INVALID_CURSOR', 400, false)
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== CURSOR_PREFIX || !parts[1] || !parts[2]) {
    throw readError('INVALID_CURSOR', 400, false)
  }
  const signed = parts[0] + '.' + parts[1]
  const expectedSignature = createHmac('sha256', cursorSecret(env)).update(signed, 'utf8').digest('base64url')
  const actual = Buffer.from(parts[2], 'utf8')
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
    throw readError('INVALID_CURSOR', 400, false)
  }
  let payload
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw readError('INVALID_CURSOR', 400, false)
  }
  if (!payload || payload.v !== 1 || !Number.isSafeInteger(payload.expiresAt)
    || payload.expiresAt <= Number(now)) {
    throw readError('INVALID_CURSOR', 400, false)
  }
  for (const key of ['tenantId', 'businessId', 'projectId', 'visibility', 'lifecycle', 'order']) {
    if (payload[key] !== expected[key]) throw readError('INVALID_CURSOR', 400, false)
  }
  if (!payload.position || typeof payload.position !== 'object') {
    throw readError('INVALID_CURSOR', 400, false)
  }
  return payload.position
}

function featureCursorPayload(scope, query, position, now) {
  const ids = scopeIds(scope)
  return {
    v: 1,
    tenantId: ids.tenantId,
    businessId: ids.businessId,
    projectId: ids.projectId,
    visibility: query.visibility,
    lifecycle: query.lifecycle,
    order: 'code,id',
    position,
    expiresAt: Number(now) + FEATURE_CURSOR_TTL_MS,
  }
}

function snapshotCursorPayload(scope, position, now) {
  const ids = scopeIds(scope)
  return {
    v: 1,
    tenantId: ids.tenantId,
    businessId: ids.businessId,
    projectId: ids.projectId,
    visibility: 'SNAPSHOTS',
    lifecycle: null,
    order: 'capturedAtDesc,id',
    position,
    expiresAt: Number(now) + FEATURE_CURSOR_TTL_MS,
  }
}

function afterSnapshotCursor(row, position) {
  if (!position) return true
  const capturedAt = isoDate(row.capturedAt, 'capturedAt')
  return capturedAt < position.capturedAt
    || (capturedAt === position.capturedAt && row.id > position.id)
}

function projectFeatureWhere(scope, { deleted = false, lifecycle = null, after = null } = {}) {
  const where = {
    projectId: scope.project.id,
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    deletedAt: deleted ? { not: null } : null,
  }
  if (lifecycle) where.lifecycle = lifecycle
  if (after) {
    where.OR = [
      { code: { gt: after.code } },
      { code: after.code, id: { gt: after.id } },
    ]
  }
  return where
}

async function readActiveWorkLinks(tx, scope) {
  return tx.featureWorkLink.findMany({
    where: {
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      deletedAt: null,
      feature: {
        projectId: scope.project.id,
        tenantId: scope.tenantId,
        businessId: scope.businessId,
        deletedAt: null,
      },
    },
    select: WORK_LINK_SELECT,
    orderBy: [{ workItemId: 'asc' }, { featureId: 'asc' }, { id: 'asc' }],
  })
}

async function readSelectedChildren(tx, scope, featureIds) {
  if (featureIds.length === 0) {
    return { contributions: [], workLinks: [], requirementBindings: [] }
  }
  const where = {
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    featureId: { in: featureIds },
    deletedAt: null,
  }
  const [contributions, workLinks, requirementBindings] = await Promise.all([
    tx.featureContribution.findMany({
      where,
      select: CONTRIBUTION_SELECT,
      orderBy: [{ featureId: 'asc' }, { domainId: 'asc' }, { id: 'asc' }],
    }),
    tx.featureWorkLink.findMany({
      where,
      select: WORK_LINK_SELECT,
      orderBy: [{ featureId: 'asc' }, { workItemId: 'asc' }, { id: 'asc' }],
    }),
    tx.requirementBinding.findMany({
      where,
      select: REQUIREMENT_SELECT,
      orderBy: [{ featureId: 'asc' }, { sourceNamespace: 'asc' }, { requirementKey: 'asc' }, { id: 'asc' }],
    }),
  ])
  return { contributions, workLinks, requirementBindings }
}

async function readWorkItems(tx, links, scope, { includeUnbound = false } = {}) {
  const ids = [...new Set(links.map((row) => row.workItemId))]
  if (ids.length === 0 && !includeUnbound) return new Map()
  const rows = await tx.workItem.findMany({
    where: includeUnbound
      ? { deletedAt: null, workstream: { projectId: scope.project.id, ...activeWorkstream() } }
      : { id: { in: ids } },
    select: WORK_ITEM_SELECT,
  })
  // Project totals use the same active population as the Domain view. Invalid
  // unlinked rows are excluded; an explicit invalid link still refuses below.
  const map = new Map(rows.filter((item) => item.deletedAt == null
    && item.workstreamId === item.workstream?.id
    && item.workstream?.projectId === scope.project.id
    && item.workstream?.deletedAt == null
    && item.workstream?.status !== 'ARCHIVED'
    && (item.containerId === null || item.container?.workstreamId === item.workstreamId))
    .map((row) => [row.id, row]))
  for (const id of ids) {
    if (!map.has(id)) {
      throw readError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
    }
  }
  return map
}

async function readProjectRepositories(tx, scope) {
  const rows = await tx.projectRepository.findMany({
    where: { projectId: scope.project.id },
    select: {
      id: true,
      projectId: true,
      repoId: true,
      repo: { select: { id: true, businessId: true, status: true } },
    },
    orderBy: [{ id: 'asc' }],
  })
  for (const row of rows) {
    if (row.projectId !== scope.project.id
      || !row.repo
      || row.repo.id !== row.repoId
      || row.repo.businessId !== scope.businessId) {
      throw readError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
    }
  }
  // Historical links remain readable when their same-scope source is inactive.
  // The evidence verifier independently requires ACTIVE before proving a key.
  return rows
}

async function readVerifiedEvidence(tx, scope, features, requirements, evidencePort) {
  const result = { featureEvidenceById: new Map(), requirementEvidenceById: new Map() }
  const snapshotIds = snapshotIdsFor(features, requirements)
  if (snapshotIds.length === 0) return result
  const projectRepositories = await readProjectRepositories(tx, scope)
  const projectRepositoryIds = projectRepositories.map((row) => row.id)
  const repositoryByProjectRepositoryId = new Map(projectRepositories.map((row) => [row.id, row.repoId]))
  if (projectRepositoryIds.length === 0) return result
  const rows = await tx.governanceSnapshot.findMany({
    where: {
      id: { in: snapshotIds },
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      projectRepositoryId: { in: projectRepositoryIds },
      validationStatus: 'VALID',
    },
  })
  for (const row of rows) {
    if (!projectRepositoryIds.includes(row.projectRepositoryId)
      || repositoryByProjectRepositoryId.get(row.projectRepositoryId) !== row.repositoryId
      || row.validationStatus !== 'VALID') {
      throw readError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
    }
  }
  const snapshots = new Map(rows.map((row) => [row.id, row]))
  const repositories = new Map(projectRepositories.map((row) => [row.id, row]))
  const featureById = new Map(features.map((row) => [row.id, row]))
  const verify = async (method, snapshot, input) => {
    if (!snapshot || typeof evidencePort?.[method] !== 'function') return null
    try {
      return await evidencePort[method]({
        tx, scope, snapshot, projectRepository: repositories.get(snapshot.projectRepositoryId), ...input,
      })
    } catch {
      return null
    }
  }
  for (const feature of features) {
    if (!feature.canonicalFeatureKey || !feature.governanceSnapshotId) continue
    result.featureEvidenceById.set(feature.id, await verify(
      'verifyFeatureKey', snapshots.get(feature.governanceSnapshotId),
      { canonicalFeatureKey: feature.canonicalFeatureKey },
    ))
  }
  for (const row of requirements) {
    const feature = featureById.get(row.featureId)
    if (!feature?.canonicalFeatureKey) continue
    const verified = await verify('verifyRequirement', snapshots.get(row.governanceSnapshotId), {
      feature, sourceNamespace: row.sourceNamespace, requirementKey: row.requirementKey, revisionHash: row.revisionHash,
    })
    if (verified?.canonicalFeatureKey === feature.canonicalFeatureKey) {
      result.requirementEvidenceById.set(row.id, verified)
    }
  }
  return result
}

function snapshotIdsFor(features, requirements) {
  return [...new Set([
    ...features.map((row) => row.governanceSnapshotId).filter(Boolean),
    ...requirements.map((row) => row.governanceSnapshotId).filter(Boolean),
  ])]
}

async function readFeatureSet(tx, scope, features, {
  allWorkLinks = null, includeUnboundWork = false, evidencePort = null, env = process.env,
} = {}) {
  const featureIds = features.map((row) => row.id)
  const links = allWorkLinks || await readActiveWorkLinks(tx, scope)
  const selected = await readSelectedChildren(tx, scope, featureIds)
  const workItems = await readWorkItems(tx, links, scope, { includeUnbound: includeUnboundWork })
  const evidence = await readVerifiedEvidence(tx, scope, features, selected.requirementBindings,
    evidencePort || createGovernanceEvidencePort({ env }))
  return { features, allWorkLinks: links, ...selected, workItems, ...evidence }
}

async function withReadTransaction(projectId, { db = prisma, viewer, repository = null }, callback) {
  if (!viewer) throw readError('AUTH_REQUIRED', 401, false)
  const repo = repository || createProjectFeatureRepository({ db })
  if (!repo || typeof repo.withProjectTransaction !== 'function') {
    throw readError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
  }
  return repo.withProjectTransaction({ projectId, viewer, mode: 'read' }, callback)
}

function validateProjectId(projectId) {
  if (!isUuid(projectId)) throw readError('RESOURCE_NOT_FOUND', 404, false)
}

export async function getProjectFeatureViewResponse(
  projectId,
  { db = prisma, viewer, repository = null, now = new Date(), evidencePort = null, env = process.env } = {},
) {
  validateProjectId(projectId)
  return withReadTransaction(projectId, { db, viewer, repository }, async (tx, scope) => {
    const features = await tx.projectFeature.findMany({
      where: projectFeatureWhere(scope),
      select: FEATURE_SELECT,
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: MAX_FEATURE_VIEW_ROWS + 1,
    })
    if (features.length > MAX_FEATURE_VIEW_ROWS) {
      throw readError('FEATURE_VIEW_LIMIT_EXCEEDED', 413, true)
    }
    const set = await readFeatureSet(tx, scope, features, { includeUnboundWork: true, evidencePort, env })
    const view = buildProjectFeatureView({
      scope,
      features,
      contributions: set.contributions,
      workLinks: set.allWorkLinks,
      requirementBindings: set.requirementBindings,
      workItems: set.workItems,
      featureEvidenceById: set.featureEvidenceById,
      requirementEvidenceById: set.requirementEvidenceById,
      now,
    })
    const graphRows = ownsBusiness(viewer, scope.businessId)
      ? await tx.projectFeature.findMany({
        where: { projectId: scope.project.id, tenantId: scope.tenantId, businessId: scope.businessId },
        select: { id: true, version: true, deletedAt: true },
        orderBy: [{ id: 'asc' }],
      })
      : null
    return {
      view,
      graphEtag: graphRows ? computeProjectFeatureGraphEtag(scope.project.id, graphRows) : null,
    }
  })
}

export async function getProjectFeatureView(projectId, options = {}) {
  return (await getProjectFeatureViewResponse(projectId, options)).view
}

export async function listProjectFeatures(
  projectId,
  {
    db = prisma,
    viewer,
    repository = null,
    visibility = 'ACTIVE',
    lifecycle = null,
    limit = 50,
    cursor = null,
    query = null,
    env = process.env,
    now = new Date(),
    evidencePort = null,
  } = {},
) {
  validateProjectId(projectId)
  const parsed = query ? parseFeatureListQuery(query) : parseFeatureListQuery({
    visibility, lifecycle, limit: String(limit), cursor,
  })
  return withReadTransaction(projectId, { db, viewer, repository }, async (tx, scope) => {
    if (parsed.visibility === 'DELETED' && !ownsBusiness(viewer, scope.business.id)) {
      // Tombstone visibility is deliberately redacted: callers who can read
      // the project but lack owner capability must not learn whether deleted
      // feature rows exist.
      throw readError('RESOURCE_NOT_FOUND', 404, false)
    }
    const ids = scopeIds(scope)
    const cursorExpected = {
      tenantId: ids.tenantId,
      businessId: ids.businessId,
      projectId: ids.projectId,
      visibility: parsed.visibility,
      lifecycle: parsed.lifecycle,
      order: 'code,id',
    }
    const position = parsed.cursor
      ? decodeFeatureCursor(parsed.cursor, cursorExpected, { env, now: now instanceof Date ? now.getTime() : Number(now) })
      : null
    const deleted = parsed.visibility === 'DELETED'
    const rows = await tx.projectFeature.findMany({
      where: projectFeatureWhere(scope, { deleted, lifecycle: parsed.lifecycle, after: position }),
      select: FEATURE_SELECT,
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: parsed.limit + 1,
    })
    const hasMore = rows.length > parsed.limit
    const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows
    if (deleted) {
      const items = pageRows.map(buildDeletedFeatureRecord)
      const nextCursor = hasMore
        ? encodeCursor(featureCursorPayload(scope, parsed, { code: pageRows.at(-1).code, id: pageRows.at(-1).id }, now instanceof Date ? now.getTime() : Number(now)), { env })
        : null
      return zFeatureRecordPage.parse({ items, nextCursor, observedAt: isoDate(now, 'observedAt') })
    }
    const activeLinks = await readActiveWorkLinks(tx, scope)
    const set = await readFeatureSet(tx, scope, pageRows, { allWorkLinks: activeLinks, evidencePort, env })
    const items = pageRows.map((feature) => buildProjectFeatureRecord({
      scope,
      feature,
      contributions: set.contributions.filter((row) => row.featureId === feature.id),
      workLinks: set.workLinks.filter((row) => row.featureId === feature.id),
      allWorkLinks: set.allWorkLinks,
      requirementBindings: set.requirementBindings.filter((row) => row.featureId === feature.id),
      workItems: set.workItems,
      featureEvidenceById: set.featureEvidenceById,
      requirementEvidenceById: set.requirementEvidenceById,
    }))
    const nextCursor = hasMore
      ? encodeCursor(featureCursorPayload(scope, parsed, { code: pageRows.at(-1).code, id: pageRows.at(-1).id }, now instanceof Date ? now.getTime() : Number(now)), { env })
      : null
    return zFeatureRecordPage.parse({ items, nextCursor, observedAt: isoDate(now, 'observedAt') })
  })
}

export async function getProjectFeature(
  projectId,
  featureId,
  { db = prisma, viewer, repository = null, evidencePort = null, env = process.env } = {},
) {
  validateProjectId(projectId)
  if (!isUuid(featureId)) throw readError('RESOURCE_NOT_FOUND', 404, false)
  return withReadTransaction(projectId, { db, viewer, repository }, async (tx, scope) => {
    const feature = await tx.projectFeature.findFirst({
      where: { ...projectFeatureWhere(scope), id: featureId },
      select: FEATURE_SELECT,
    })
    if (!feature) throw readError('RESOURCE_NOT_FOUND', 404, false)
    const activeLinks = await readActiveWorkLinks(tx, scope)
    const set = await readFeatureSet(tx, scope, [feature], { allWorkLinks: activeLinks, evidencePort, env })
    return buildProjectFeatureRecord({
      scope,
      feature,
      contributions: set.contributions,
      workLinks: set.workLinks,
      allWorkLinks: set.allWorkLinks,
      requirementBindings: set.requirementBindings,
      workItems: set.workItems,
      featureEvidenceById: set.featureEvidenceById,
      requirementEvidenceById: set.requirementEvidenceById,
    })
  })
}

export async function listProjectGovernanceSnapshots(
  projectId,
  {
    db = prisma,
    viewer,
    repository = null,
    limit = 50,
    cursor = null,
    query = null,
    env = process.env,
    now = new Date(),
  } = {},
) {
  validateProjectId(projectId)
  const parsed = query ? parseSnapshotListQuery(query) : parseSnapshotListQuery({
    limit: String(limit), cursor,
  })
  return withReadTransaction(projectId, { db, viewer, repository }, async (tx, scope) => {
    if (!ownsBusiness(viewer, scope.business.id)) throw readError('CAPABILITY_DENIED', 403, false)
    const ids = scopeIds(scope)
    const position = parsed.cursor
      ? decodeFeatureCursor(parsed.cursor, {
        tenantId: ids.tenantId,
        businessId: ids.businessId,
        projectId: ids.projectId,
        visibility: 'SNAPSHOTS',
        lifecycle: null,
        order: 'capturedAtDesc,id',
      }, { env, now: now instanceof Date ? now.getTime() : Number(now) })
      : null
    const projectRepositories = await readProjectRepositories(tx, scope)
    const projectRepositoryIds = projectRepositories.map((row) => row.id)
    const repositoryByProjectRepositoryId = new Map(projectRepositories.map((row) => [row.id, row.repoId]))
    const rows = projectRepositoryIds.length === 0
      ? []
      : await tx.governanceSnapshot.findMany({
        where: {
          tenantId: scope.tenantId,
          businessId: scope.businessId,
          projectRepositoryId: { in: projectRepositoryIds },
          validationStatus: 'VALID',
        },
        select: SNAPSHOT_SELECT,
        orderBy: [{ capturedAt: 'desc' }, { id: 'asc' }],
      })
    const filtered = rows.filter((row) => afterSnapshotCursor(row, position))
    for (const row of filtered) {
      if (repositoryByProjectRepositoryId.get(row.projectRepositoryId) !== row.repositoryId) {
        throw readError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
      }
    }
    const hasMore = filtered.length > parsed.limit
    const pageRows = hasMore ? filtered.slice(0, parsed.limit) : filtered
    const items = pageRows.map((row) => zGovernanceSnapshotMetadata.parse({
      id: row.id,
      repositoryId: row.repositoryId,
      commitSha: row.commitSha,
      manifestHash: row.manifestHash,
      capturedAt: isoDate(row.capturedAt, 'capturedAt'),
      validationStatus: 'VALID',
    }))
    const nextCursor = hasMore
      ? encodeCursor(snapshotCursorPayload(scope, {
        capturedAt: isoDate(pageRows.at(-1).capturedAt, 'capturedAt'),
        id: pageRows.at(-1).id,
      }, now instanceof Date ? now.getTime() : Number(now)), { env })
      : null
    return zGovernanceSnapshotPage.parse({ items, nextCursor, observedAt: isoDate(now, 'observedAt') })
  })
}

export function toPublicFeatureReadError(error) {
  const code = error?.code || error?.message
  if (error?.status === 401 || code === 'AUTH_REQUIRED') {
    return { status: 401, code: 'AUTH_REQUIRED', message: 'Authentication is required.', retryable: false }
  }
  if (error?.status === 403 || code === 'CAPABILITY_DENIED') {
    return { status: 403, code: 'CAPABILITY_DENIED', message: 'Capability denied.', retryable: false }
  }
  if (error?.status === 404 || code === 'RESOURCE_NOT_FOUND'
    || code === 'PHASE_B_PROJECT_NOT_FOUND' || code === 'PHASE_B_FEATURE_NOT_FOUND') {
    return { status: 404, code: 'RESOURCE_NOT_FOUND', message: 'Resource not found.', retryable: false }
  }
  if (error?.status === 400 || code === 'MALFORMED_REQUEST' || code === 'INVALID_CURSOR') {
    return {
      status: 400,
      code: code === 'INVALID_CURSOR' ? 'INVALID_CURSOR' : 'MALFORMED_REQUEST',
      message: 'Request is invalid.',
      retryable: false,
    }
  }
  if (error?.status === 413 || code === 'FEATURE_VIEW_LIMIT_EXCEEDED') {
    return {
      status: 413,
      code: 'FEATURE_VIEW_LIMIT_EXCEEDED',
      message: 'Feature view exceeds the response limit.',
      retryable: true,
    }
  }
  if (error?.status === 503 && (code === 'SESSION_UNAVAILABLE' || code === 'SERVICE_UNAVAILABLE')) {
    return { status: 503, code: 'SESSION_UNAVAILABLE', message: 'Session temporarily unavailable.', retryable: true }
  }
  return {
    status: 503,
    code: 'DATA_INTEGRITY_UNAVAILABLE',
    message: 'Project data is temporarily unavailable.',
    retryable: true,
  }
}
