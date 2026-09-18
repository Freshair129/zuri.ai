import { createHash, randomUUID } from 'node:crypto'
import { z, ZodError } from 'zod'
import prisma from '@/lib/db'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { hasOperatorGrant } from '@/modules/identity/operator-bootstrap'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { createSessionPort } from '@/modules/identity/session-port'
import { hasSuperadminGrant } from '@/modules/identity/superadmin-grant'
import { PROJECT_DOMAIN_CATALOG_BY_ID } from '@/modules/project-manager/project-domain-catalog'
import { recordAudit } from './audit'
import { createGovernanceEvidencePort } from './governance-source-verifier'
import { createProjectFeatureRepository, resolveProjectFeatureScope } from './project-feature-repository'

// @req FR-252 — Project Feature mutation authority is explicit, scoped and
// atomic across the base record and its three complete relationship sets.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/unit/project-feature-service.test.js, tests/integration/project-feature-mutations.test.js, tests/integration/project-feature-graph.test.js

const MAX_FEATURES = 200
const MAX_CHILD_ROWS = 200
const MAX_GRAPH_FEATURES = 50
const MAX_GRAPH_WORK_ITEMS = 200
const FEATURE_LIFECYCLES = ['DRAFT', 'ACTIVE', 'RETIRED']
const MUTATION_OPERATIONS = [
  'CREATE_FEATURE',
  'UPDATE_FEATURE',
  'REPLACE_CONTRIBUTIONS',
  'REPLACE_WORK_LINKS',
  'REPLACE_FEATURE_WORK_GRAPH',
  'REPLACE_REQUIREMENT_BINDINGS',
  'DELETE_FEATURE',
  'RESTORE_FEATURE',
  'CAPTURE_GOVERNANCE_SNAPSHOT',
]

const zUuid = z.string().uuid()
const zIsoDate = z.string().datetime({ offset: true })
const zNullablePair = z.string().min(1).max(200).nullable().optional()

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key)
}

function pairRefinement(value, ctx) {
  const hasKey = hasOwn(value, 'canonicalFeatureKey')
  const hasSnapshot = hasOwn(value, 'governanceSnapshotId')
  if ((hasKey && value.canonicalFeatureKey === undefined) || (hasSnapshot && value.governanceSnapshotId === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['canonicalFeatureKey'], message: 'Canonical feature and snapshot cannot be undefined.' })
    return
  }
  if (hasKey !== hasSnapshot) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['canonicalFeatureKey'], message: 'Canonical feature and snapshot must be supplied together.' })
    return
  }
  if (hasKey && ((value.canonicalFeatureKey === null) !== (value.governanceSnapshotId === null))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['canonicalFeatureKey'], message: 'Canonical feature and snapshot must both be null or both be present.' })
  }
}

export const zFeatureCreateInput = z.object({
  code: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(500),
  problem: z.string().trim().min(1).max(5000),
  outcome: z.string().trim().min(1).max(5000),
  primaryDomainId: z.string().trim().min(1).max(128),
  canonicalFeatureKey: zNullablePair,
  governanceSnapshotId: zUuid.nullable().optional(),
  lifecycle: z.literal('DRAFT').optional(),
}).strict().superRefine(pairRefinement)

export const zFeaturePatchInput = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  problem: z.string().trim().min(1).max(5000).optional(),
  outcome: z.string().trim().min(1).max(5000).optional(),
  primaryDomainId: z.string().trim().min(1).max(128).optional(),
  lifecycle: z.enum(FEATURE_LIFECYCLES).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one editable field is required.',
})

export const zContributionInput = z.object({
  domainId: z.string().trim().min(1).max(128),
  responsibility: z.string().trim().min(1).max(2000),
}).strict()

export const zContributionsReplaceInput = z.object({
  contributions: z.array(zContributionInput).max(MAX_CHILD_ROWS),
}).strict()

export const zWorkLinkInput = z.object({
  workItemId: zUuid,
  allocationBps: z.number().int().min(0).max(10000).nullable(),
}).strict()

export const zWorkLinksReplaceInput = z.object({
  allocationMode: z.enum(['UNALLOCATED', 'COMPLETE_SPLIT']),
  links: z.array(zWorkLinkInput).max(MAX_CHILD_ROWS),
}).strict()

export const zFeatureWorkSet = z.object({
  featureId: zUuid,
  links: z.array(zWorkLinkInput).max(MAX_CHILD_ROWS),
}).strict()

export const zFeatureWorkGraphInput = z.object({
  allocationMode: z.enum(['UNALLOCATED', 'COMPLETE_SPLIT']),
  affectedWorkItemIds: z.array(zUuid).min(1).max(MAX_GRAPH_WORK_ITEMS),
  featureSets: z.array(zFeatureWorkSet).min(1).max(MAX_GRAPH_FEATURES),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.affectedWorkItemIds).size !== value.affectedWorkItemIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['affectedWorkItemIds'], message: 'Affected WorkItem ids must be unique.' })
  }
  const featureIds = value.featureSets.map((set) => set.featureId)
  if (new Set(featureIds).size !== featureIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['featureSets'], message: 'Feature sets must be unique by featureId.' })
  }
})

export const zRequirementBindingInput = z.object({
  governanceSnapshotId: zUuid,
  sourceNamespace: z.string().trim().min(1).max(128),
  requirementKey: z.string().trim().min(1).max(128),
  revisionHash: z.string().regex(/^[0-9a-f]{64}$/),
  acceptanceRef: z.string().trim().min(1).max(1000),
}).strict()

export const zRequirementBindingsReplaceInput = z.object({
  bindings: z.array(zRequirementBindingInput).max(MAX_CHILD_ROWS),
}).strict()

export const zMutationReceipt = z.object({
  receiptId: zUuid,
  targetId: zUuid,
  targetType: z.enum(['PROJECT', 'FEATURE']),
  operation: z.enum(MUTATION_OPERATIONS),
  httpMethod: z.enum(['POST', 'PATCH', 'PUT', 'DELETE']),
  resourceId: zUuid,
  resourceType: z.enum(['PROJECT_FEATURE', 'PROJECT_FEATURE_GRAPH', 'GOVERNANCE_SNAPSHOT']),
  status: z.literal('COMMITTED'),
  version: z.union([z.number().int().positive(), z.null()]),
  etag: z.string().min(1).max(4096),
  recordedAt: zIsoDate,
  auditRef: z.string().min(1),
  requestId: zUuid,
}).strict().superRefine((value, ctx) => {
  const expected = {
    CREATE_FEATURE: { targetType: 'PROJECT', httpMethod: 'POST', resourceType: 'PROJECT_FEATURE', version: 'feature' },
    UPDATE_FEATURE: { targetType: 'FEATURE', httpMethod: 'PATCH', resourceType: 'PROJECT_FEATURE', version: 'feature' },
    REPLACE_CONTRIBUTIONS: { targetType: 'FEATURE', httpMethod: 'PUT', resourceType: 'PROJECT_FEATURE', version: 'feature' },
    REPLACE_WORK_LINKS: { targetType: 'FEATURE', httpMethod: 'PUT', resourceType: 'PROJECT_FEATURE', version: 'feature' },
    REPLACE_FEATURE_WORK_GRAPH: { targetType: 'PROJECT', httpMethod: 'PUT', resourceType: 'PROJECT_FEATURE_GRAPH', version: 'graph' },
    REPLACE_REQUIREMENT_BINDINGS: { targetType: 'FEATURE', httpMethod: 'PUT', resourceType: 'PROJECT_FEATURE', version: 'feature' },
    DELETE_FEATURE: { targetType: 'FEATURE', httpMethod: 'DELETE', resourceType: 'PROJECT_FEATURE', version: 'feature' },
    RESTORE_FEATURE: { targetType: 'FEATURE', httpMethod: 'POST', resourceType: 'PROJECT_FEATURE', version: 'feature' },
    CAPTURE_GOVERNANCE_SNAPSHOT: { targetType: 'PROJECT', httpMethod: 'POST', resourceType: 'GOVERNANCE_SNAPSHOT', version: 'graph' },
  }[value.operation]
  if (!expected) return
  for (const key of ['targetType', 'httpMethod', 'resourceType']) {
    if (value[key] !== expected[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Receipt discriminator is invalid.' })
  }
  const versionValid = expected.version === 'graph' ? value.version === null : Number.isInteger(value.version) && value.version >= 1
  if (!versionValid) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['version'], message: 'Receipt version is invalid for this resource.' })
})

export const zMutationError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: zUuid,
  retryable: z.boolean(),
  currentVersion: z.number().int().positive().nullable().optional(),
  currentEtag: z.string().max(4096).nullable().optional(),
  fields: z.array(z.object({
    path: z.string().min(1).max(256),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(1000),
  }).strict()).max(50).optional(),
}).strict()

export class ProjectFeatureMutationError extends Error {
  constructor(code, status = 422, retryable = false, details = {}) {
    super(code)
    this.name = 'ProjectFeatureMutationError'
    this.code = code
    this.status = status
    this.retryable = retryable
    Object.assign(this, details)
  }
}

function mutationError(code, status = 422, retryable = false, details = {}) {
  return new ProjectFeatureMutationError(code, status, retryable, details)
}

function fieldsFromZod(error) {
  if (!(error instanceof ZodError)) return undefined
  return error.issues.slice(0, 50).map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : 'request',
    code: 'INVALID_FIELD',
    message: 'Request field is invalid.',
  }))
}

function parseInput(schema, value) {
  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) throw mutationError('MALFORMED_REQUEST', 400, false, { fields: fieldsFromZod(error) })
    throw error
  }
}

function ensureUuid(value, code = 'RESOURCE_NOT_FOUND') {
  if (!zUuid.safeParse(value).success) throw mutationError(code, code === 'RESOURCE_NOT_FOUND' ? 404 : 400)
  return value
}

function ensurePrincipal(viewer) {
  const principalId = viewer?.principal?.id
  if (!zUuid.safeParse(principalId).success && !(typeof principalId === 'string' && principalId.trim())) {
    throw mutationError('AUTH_REQUIRED', 401)
  }
  return principalId
}

function headerValue(request, name) {
  if (typeof request?.headers?.get === 'function') return request.headers.get(name)
  return request?.headers?.[name] ?? request?.headers?.[name.toLowerCase()] ?? null
}

function requireIdempotencyKey(value) {
  if (typeof value !== 'string' || value.trim().length < 8 || value.trim().length > 128) {
    throw mutationError('MALFORMED_REQUEST', 400, false, {
      fields: [{ path: 'Idempotency-Key', code: 'INVALID_HEADER', message: 'Request field is invalid.' }],
    })
  }
  return value.trim()
}

function requireIfMatch(value) {
  if (typeof value !== 'string' || value.trim() === '') throw mutationError('PRECONDITION_REQUIRED', 428)
  return value.trim()
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex')
}

function sortedBy(rows, fields) {
  return [...rows].sort((left, right) => {
    for (const field of fields) {
      const a = String(left?.[field] ?? '')
      const b = String(right?.[field] ?? '')
      if (a < b) return -1
      if (a > b) return 1
    }
    return 0
  })
}

function normalizeCommand(operation, input) {
  if (operation === 'CREATE_FEATURE') return parseInput(zFeatureCreateInput, input)
  if (operation === 'UPDATE_FEATURE') return parseInput(zFeaturePatchInput, input)
  if (operation === 'REPLACE_CONTRIBUTIONS') {
    const value = parseInput(zContributionsReplaceInput, input)
    return { contributions: sortedBy(value.contributions, ['domainId', 'responsibility']) }
  }
  if (operation === 'REPLACE_WORK_LINKS') {
    const value = parseInput(zWorkLinksReplaceInput, input)
    return { allocationMode: value.allocationMode, links: sortedBy(value.links, ['workItemId']) }
  }
  if (operation === 'REPLACE_FEATURE_WORK_GRAPH') {
    const value = parseInput(zFeatureWorkGraphInput, input)
    return {
      allocationMode: value.allocationMode,
      affectedWorkItemIds: [...value.affectedWorkItemIds].sort(),
      featureSets: sortedBy(value.featureSets, ['featureId']).map((set) => ({
        featureId: set.featureId,
        links: sortedBy(set.links, ['workItemId']),
      })),
    }
  }
  if (operation === 'REPLACE_REQUIREMENT_BINDINGS') {
    const value = parseInput(zRequirementBindingsReplaceInput, input)
    return { bindings: sortedBy(value.bindings, ['governanceSnapshotId', 'sourceNamespace', 'requirementKey', 'revisionHash']) }
  }
  return {}
}

function featureEtag(feature) {
  return `"PROJECT_FEATURE/${feature.id}/v${feature.version}"`
}

function graphEtag(projectId, features) {
  const canonicalRows = sortedBy(features, ['id', 'version', 'deletedAt']).map((feature) => ({
    id: feature.id,
    version: feature.version,
    deletedAt: feature.deletedAt ? new Date(feature.deletedAt).toISOString() : null,
  }))
  const digest = createHash('sha256').update(JSON.stringify(canonicalRows), 'utf8').digest('hex')
  return `"PROJECT_FEATURE_GRAPH/${projectId}/${digest}"`
}

export function computeProjectFeatureGraphEtag(projectId, features) {
  ensureUuid(projectId, 'MALFORMED_REQUEST')
  return graphEtag(projectId, features)
}

function expectedEtag(ifMatch, current, kind = 'feature') {
  const currentEtag = kind === 'graph' ? current : featureEtag(current)
  if (typeof ifMatch !== 'string' || ifMatch.trim() === '') throw mutationError('PRECONDITION_REQUIRED', 428)
  if (ifMatch !== currentEtag) {
    throw mutationError('VERSION_MISMATCH', 412, false, {
      currentVersion: kind === 'graph' ? null : current.version,
      currentEtag,
    })
  }
}

function dateIso(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw mutationError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
  return date.toISOString()
}

function receiptDto(row, requestId) {
  return zMutationReceipt.parse({
    receiptId: row.id,
    targetId: row.targetId,
    targetType: row.targetType,
    operation: row.operation,
    httpMethod: row.httpMethod,
    resourceId: row.resourceId,
    resourceType: row.resourceType,
    status: 'COMMITTED',
    version: row.version ?? null,
    etag: row.etag,
    recordedAt: dateIso(row.createdAt),
    auditRef: row.auditEventId,
    requestId,
  })
}

function mapPrismaConflict(error, operation) {
  if (error?.code !== 'P2002') return error
  if (operation === 'CREATE_FEATURE') return mutationError('DUPLICATE_FEATURE_CODE', 409)
  return mutationError('CHILD_SET_CONFLICT', 409)
}

async function findMutationReceipt(tx, scope, { operation, targetId, principalId, idempotencyKey }) {
  return tx.projectFeatureMutationReceipt.findFirst({
    where: {
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      principalId,
      operation,
      targetId,
      idempotencyKey,
    },
  })
}

async function mutationTransaction({ db, repository, projectId, viewer }, callback) {
  const repo = repository || createProjectFeatureRepository({ db })
  if (!repo || typeof repo.withProjectTransaction !== 'function') throw mutationError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
  return repo.withProjectTransaction({ projectId, viewer, mode: 'mutation' }, (tx, scope) => callback(tx, scope, repo))
}

async function reproveMutationAuthority(tx, scope, { projectId, viewer, session, now, postgres = false }) {
  const principalId = ensurePrincipal(viewer)
  if (!session) return { viewer, scope, principalId, now }
  if (session.state !== 'AUTHENTICATED'
    || session.principalId !== principalId
    || typeof session.sessionId !== 'string'
    || !zUuid.safeParse(session.sessionId).success) {
    throw mutationError('AUTH_REQUIRED', 401)
  }
  if (typeof tx.session?.findUnique !== 'function') throw mutationError('SESSION_UNAVAILABLE', 503, true)

  // The repository's Serializable transaction can have taken its snapshot
  // while waiting for the Project lock. Lock the live authority rows before
  // reading them so a concurrent revoke either becomes visible or causes the
  // bounded transaction retry; a stale pre-lock Membership/Session snapshot
  // must never authorize the effect.
  if (postgres) {
    await queryMutationLock(
      tx,
      'SELECT "id" FROM "Session" WHERE "id" = $1 FOR UPDATE',
      [session.sessionId],
    )
    await queryMutationLock(
      tx,
      'SELECT "id" FROM "Membership" WHERE "personId" = $1 AND "tenantId" = $2 AND ("businessId" = $3 OR "businessId" IS NULL) ORDER BY "id" ASC FOR UPDATE',
      [session.principalId, scope.tenantId, scope.businessId],
    )
    await queryMutationLock(
      tx,
      'SELECT "id" FROM "PlatformGrant" WHERE "personId" = $1 ORDER BY "id" ASC FOR UPDATE',
      [session.principalId],
    )
  }

  // The authority-row locks can wait behind a concurrent revoke or grant
  // update. Capture the comparison clock only after every lock has completed;
  // the pre-lock transaction time must never make an expired session/grant
  // appear live. This same instant is returned to the effect pipeline below.
  const authorityNow = new Date()

  const liveSession = await tx.session.findUnique({
    where: { id: session.sessionId },
    select: { id: true, personId: true, status: true, expiresAt: true },
  })
  const expiresAt = liveSession?.expiresAt ? new Date(liveSession.expiresAt).getTime() : NaN
  if (!liveSession
    || liveSession.personId !== session.principalId
    || liveSession.status !== 'ACTIVE'
    || !Number.isFinite(expiresAt)
    || expiresAt <= authorityNow.getTime()) {
    throw mutationError('AUTH_REQUIRED', 401)
  }

  let freshViewer
  try {
    const [freshPlatformGrant, freshSuperadminGrant] = await Promise.all([
      hasOperatorGrant(session.principalId, tx, authorityNow.getTime()),
      hasSuperadminGrant(session.principalId, tx, authorityNow.getTime()),
    ])
    freshViewer = await resolveViewer({
      principalId: session.principalId,
      platformGrant: freshPlatformGrant,
      superadminGrant: freshSuperadminGrant,
      db: tx,
      now: authorityNow.getTime(),
    })
  } catch (error) {
    if (/principal (?:was not found|is required)/i.test(error?.message || '')) throw mutationError('AUTH_REQUIRED', 401)
    throw mutationError('SESSION_UNAVAILABLE', 503, true)
  }
  if (ensurePrincipal(freshViewer) !== principalId) throw mutationError('AUTH_REQUIRED', 401)

  const freshScope = await resolveProjectFeatureScope(projectId, { db: tx, viewer: freshViewer, mode: 'mutation' })
  if (freshScope.tenantId !== scope.tenantId || freshScope.businessId !== scope.businessId) {
    throw mutationError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
  }
  return { viewer: freshViewer, scope: freshScope, principalId, now: authorityNow }
}

async function queryMutationLock(tx, sql, params) {
  if (typeof tx.$queryRawUnsafe !== 'function') throw mutationError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
  const rows = await tx.$queryRawUnsafe(sql, ...params)
  if (!Array.isArray(rows)) throw mutationError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
  return rows
}

function placeholders(start, count) {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(', ')
}

/**
 * PostgreSQL's Project lock in the W2 repository protects the hierarchy. W4
 * adds deterministic row locks for the Feature graph and every child set that
 * can participate in the command. SQLite already serializes writes through
 * the W2 BEGIN IMMEDIATE adapter, so this deliberately has no SQLite branch.
 */
async function lockProjectFeatureMutationRows(tx, scope, repository, { operation, targetType, targetId, command }) {
  if (repository?.dialect !== 'postgres') return
  await queryMutationLock(
    tx,
    'SELECT "id" FROM "ProjectFeature" WHERE "projectId" = $1 AND "tenantId" = $2 AND "businessId" = $3 ORDER BY "id" ASC FOR UPDATE',
    [scope.project.id, scope.tenantId, scope.businessId],
  )

  if (targetType === 'FEATURE') {
    for (const table of ['FeatureContribution', 'FeatureWorkLink', 'RequirementBinding']) {
      await queryMutationLock(
        tx,
        `SELECT "id" FROM "${table}" WHERE "featureId" = $1 AND "tenantId" = $2 AND "businessId" = $3 ORDER BY "id" ASC FOR UPDATE`,
        [targetId, scope.tenantId, scope.businessId],
      )
    }
  }

  const affectedIds = operation === 'REPLACE_FEATURE_WORK_GRAPH'
    ? command?.affectedWorkItemIds || []
    : operation === 'REPLACE_WORK_LINKS'
      ? (command?.links || []).map((row) => row.workItemId)
      : []
  if (affectedIds.length) {
    const uniqueIds = [...new Set(affectedIds)]
    const marks = placeholders(4, uniqueIds.length)
    await queryMutationLock(
      tx,
      `SELECT "fwl"."id" FROM "FeatureWorkLink" AS "fwl" INNER JOIN "ProjectFeature" AS "pf" ON "pf"."id" = "fwl"."featureId" WHERE "pf"."projectId" = $1 AND "pf"."tenantId" = $2 AND "pf"."businessId" = $3 AND "fwl"."workItemId" IN (${marks}) ORDER BY "fwl"."id" ASC FOR UPDATE`,
      [scope.project.id, scope.tenantId, scope.businessId, ...uniqueIds],
    )
  }
}

async function runMutation({
  db = prisma,
  repository = null,
  projectId,
  viewer,
  operation,
  httpMethod,
  targetType,
  targetId,
  resourceType,
  command = {},
  normalize = null,
  ifMatch = null,
  idempotencyKey,
  requestId = randomUUID(),
  sessionId = null,
  session = null,
  evidencePort = null,
  env = process.env,
  callback,
}) {
  ensureUuid(projectId, 'RESOURCE_NOT_FOUND')
  ensureUuid(targetId, 'RESOURCE_NOT_FOUND')
  ensureUuid(requestId, 'MALFORMED_REQUEST')
  const principalId = ensurePrincipal(viewer)
  if (session?.principalId && session.principalId !== principalId) throw mutationError('AUTH_REQUIRED', 401)
  const result = await mutationTransaction({ db, repository, projectId, viewer }, async (tx, scope, repo) => {
    let now = new Date()
    const authority = await reproveMutationAuthority(tx, scope, {
      projectId,
      viewer,
      session,
      now,
      postgres: repo?.dialect === 'postgres',
    })
    now = authority.now || now
    const rawCommand = typeof command === 'function' ? await command() : command
    const normalizedCommand = normalize ? normalize(rawCommand) : rawCommand
    const key = requireIdempotencyKey(idempotencyKey)
    await lockProjectFeatureMutationRows(tx, authority.scope, repo, {
      operation,
      targetType,
      targetId,
      command: normalizedCommand,
    })
    const effectivePrincipalId = authority.principalId
    const payloadHash = sha256(normalizedCommand)
    const prior = await findMutationReceipt(tx, authority.scope, { operation, targetId, principalId: effectivePrincipalId, idempotencyKey: key })
    if (prior) {
      if (prior.payloadHash !== payloadHash) throw mutationError('IDEMPOTENCY_KEY_REUSED', 409)
      return { receipt: receiptDto(prior, requestId), httpStatus: 200, replayed: true }
    }

    let effect
    try {
      effect = await callback(tx, authority.scope, {
        evidencePort: evidencePort ?? createGovernanceEvidencePort({ env }),
        ifMatch,
        now,
        principalId: effectivePrincipalId,
        viewer: authority.viewer,
        command: normalizedCommand,
      })
    } catch (error) {
      throw mapPrismaConflict(error, operation)
    }

    const audit = await recordAudit(tx, {
      entityType: resourceType === 'PROJECT_FEATURE_GRAPH'
        ? 'PROJECT_FEATURE_GRAPH'
        : resourceType === 'GOVERNANCE_SNAPSHOT'
          ? 'GOVERNANCE_SNAPSHOT'
          : 'PROJECT_FEATURE',
      entityId: effect.auditEntityId || effect.resourceId,
      action: operation,
      payload: normalizedCommand,
      actorId: effectivePrincipalId,
      tenantId: authority.scope.tenantId,
      businessId: authority.scope.businessId,
      requestId,
      sessionId: session?.sessionId ?? sessionId,
      beforeJson: effect.before || null,
      afterJson: effect.after || null,
    })
    const created = await tx.projectFeatureMutationReceipt.create({
      data: {
        tenantId: authority.scope.tenantId,
        businessId: authority.scope.businessId,
        projectId: authority.scope.project.id,
        featureId: effect.featureId || null,
        targetId,
        targetType,
        httpMethod,
        principalId: effectivePrincipalId,
        operation,
        idempotencyKey: key,
        payloadHash,
        resourceId: effect.resourceId,
        resourceType,
        version: effect.version ?? null,
        etag: effect.etag,
        auditEventId: audit.id,
        status: 'COMMITTED',
      },
    })
    return {
      receipt: receiptDto(created, requestId),
      httpStatus: operation === 'CREATE_FEATURE' || operation === 'CAPTURE_GOVERNANCE_SNAPSHOT' ? 201 : 200,
      replayed: false,
    }
  })
  return result
}

/**
 * Shared locked transaction, idempotency, audit and receipt pipeline for W4
 * mutations and W5's server-verified snapshot capture. W5 supplies its own
 * effect callback; it must return resourceId, etag and a null version for a
 * GovernanceSnapshot receipt and must never perform a nested transaction.
 */
export async function runProjectFeatureMutation(options) {
  return runMutation(options)
}

async function findFeature(tx, scope, featureId, { deleted = false } = {}) {
  const feature = await tx.projectFeature.findFirst({
    where: {
      id: featureId,
      projectId: scope.project.id,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      deletedAt: deleted ? { not: null } : null,
    },
  })
  if (!feature) throw mutationError('RESOURCE_NOT_FOUND', 404)
  return feature
}

function assertKnownDomain(domainId) {
  if (!PROJECT_DOMAIN_CATALOG_BY_ID[domainId]) throw mutationError('DOMAIN_ID_UNRECOGNIZED', 422)
}

async function findProjectRepository(tx, scope, projectRepositoryId) {
  const row = await tx.projectRepository.findFirst({
    where: { id: projectRepositoryId, projectId: scope.project.id },
    select: { id: true, projectId: true, repoId: true, repo: { select: { id: true, businessId: true, status: true } } },
  })
  if (!row || row.projectId !== scope.project.id || !row.repo || row.repo.id !== row.repoId || row.repo.businessId !== scope.businessId || row.repo.status === 'DELETED') {
    throw mutationError('SNAPSHOT_INVALID', 422)
  }
  return row
}

async function findValidSnapshot(tx, scope, snapshotId) {
  const snapshot = await tx.governanceSnapshot.findFirst({
    where: { id: snapshotId, tenantId: scope.tenantId, businessId: scope.businessId, validationStatus: 'VALID' },
  })
  if (!snapshot) throw mutationError('SNAPSHOT_REQUIRED', 422)
  const projectRepository = await findProjectRepository(tx, scope, snapshot.projectRepositoryId)
  if (snapshot.repositoryId !== projectRepository.repoId) throw mutationError('SNAPSHOT_INVALID', 422)
  return { snapshot, projectRepository }
}

async function verifyFeatureEvidence(tx, scope, input, evidencePort) {
  if (input.canonicalFeatureKey === null || input.governanceSnapshotId === null || input.canonicalFeatureKey === undefined) return null
  const { snapshot, projectRepository } = await findValidSnapshot(tx, scope, input.governanceSnapshotId)
  if (!evidencePort || typeof evidencePort.verifyFeatureKey !== 'function') throw mutationError('SNAPSHOT_REQUIRED', 422)
  const result = await evidencePort.verifyFeatureKey({ tx, scope, snapshot, projectRepository, canonicalFeatureKey: input.canonicalFeatureKey })
  if (!result || result.state !== 'AVAILABLE' || result.canonicalFeatureKey !== input.canonicalFeatureKey) throw mutationError('SNAPSHOT_INVALID', 422)
  return result
}

async function validateContributionRows(tx, scope, feature, rows) {
  const seen = new Set()
  for (const row of rows) {
    assertKnownDomain(row.domainId)
    if (seen.has(row.domainId) || row.domainId === feature.primaryDomainId) throw mutationError('PRIMARY_DOMAIN_DUPLICATE', 422)
    seen.add(row.domainId)
  }
}

async function findWorkItems(tx, scope, workItemIds) {
  const unique = [...new Set(workItemIds)]
  if (unique.length === 0) return new Map()
  const rows = await tx.workItem.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      workstreamId: true,
      containerId: true,
      deletedAt: true,
      workstream: { select: { id: true, projectId: true, deletedAt: true, status: true } },
      container: { select: { id: true, workstreamId: true } },
    },
  })
  const map = new Map(rows.map((row) => [row.id, row]))
  for (const id of unique) {
    const item = map.get(id)
    if (!item || item.deletedAt || !item.workstream || item.workstream.projectId !== scope.project.id || item.workstream.deletedAt || item.workstream.status === 'ARCHIVED' || item.workstream.id !== item.workstreamId || (item.containerId && (!item.container || item.container.workstreamId !== item.workstreamId))) {
      throw mutationError('CROSS_PROJECT_WORK_LINK', 422)
    }
  }
  return map
}

async function activeProjectWorkLinks(tx, scope, workItemIds = null) {
  return tx.featureWorkLink.findMany({
    where: {
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      deletedAt: null,
      ...(workItemIds?.length ? { workItemId: { in: workItemIds } } : {}),
      feature: { projectId: scope.project.id, tenantId: scope.tenantId, businessId: scope.businessId, deletedAt: null },
    },
    select: { id: true, featureId: true, workItemId: true, allocationBps: true, version: true },
    orderBy: [{ workItemId: 'asc' }, { featureId: 'asc' }, { id: 'asc' }],
  })
}

function linksByWorkItem(rows) {
  const result = new Map()
  for (const row of rows) {
    const values = result.get(row.workItemId) || []
    values.push(row)
    result.set(row.workItemId, values)
  }
  return result
}

function validateAllocation(mode, rowsByWorkItem) {
  for (const rows of rowsByWorkItem.values()) {
    let total = 0
    let allValued = true
    for (const row of rows) {
      if (row.allocationBps === null || row.allocationBps === undefined) allValued = false
      else if (!Number.isInteger(row.allocationBps) || row.allocationBps < 0 || row.allocationBps > 10000) throw mutationError('INVALID_ALLOCATION', 422)
      else total += row.allocationBps
    }
    if (total > 10000) throw mutationError('INVALID_ALLOCATION', 422)
    if (mode === 'COMPLETE_SPLIT' && (!allValued || total !== 10000)) throw mutationError('INVALID_ALLOCATION', 422)
  }
}

async function validateWorkLinkRows(tx, scope, featureId, links, allocationMode) {
  const ids = links.map((row) => row.workItemId)
  if (new Set(ids).size !== ids.length) throw mutationError('CHILD_SET_CONFLICT', 409)
  await findWorkItems(tx, scope, ids)
  const existing = await activeProjectWorkLinks(tx, scope, ids)
  const rows = existing.filter((row) => row.featureId !== featureId)
  rows.push(...links.map((row) => ({ featureId, ...row })))
  validateAllocation(allocationMode, linksByWorkItem(rows))
  return rows
}

async function bumpFeature(tx, featureId) {
  return tx.projectFeature.update({ where: { id: featureId }, data: { version: { increment: 1 } } })
}

async function completeSetRows(tx, {
  model,
  feature,
  desired,
  key,
  fields,
  now,
  validate,
  bump = true,
}) {
  const current = await tx[model].findMany({ where: { featureId: feature.id }, orderBy: [{ id: 'asc' }] })
  await validate(current, desired)
  const active = current.filter((row) => row.deletedAt === null)
  const activeByKey = new Map(active.map((row) => [key(row), row]))
  const deletedByKey = new Map(current.filter((row) => row.deletedAt !== null).map((row) => [key(row), row]))
  const desiredKeys = new Set(desired.map(key))
  const removed = active.filter((row) => !desiredKeys.has(key(row)))
  const deleteBatchId = removed.length ? randomUUID() : null
  const changed = []

  for (const row of desired) {
    const rowKey = key(row)
    const existing = activeByKey.get(rowKey)
    const deleted = deletedByKey.get(rowKey)
    const values = fields(row)
    if (existing) {
      const changedFields = Object.keys(values).some((field) => existing[field] !== values[field])
      if (changedFields) {
        await tx[model].update({ where: { id: existing.id }, data: { ...values, version: { increment: 1 } } })
        changed.push(existing.id)
      }
    } else if (deleted) {
      await tx[model].update({ where: { id: deleted.id }, data: { ...values, deletedAt: null, deleteBatchId: null, version: { increment: 1 } } })
      changed.push(deleted.id)
    } else {
      const created = await tx[model].create({ data: { ...values, tenantId: feature.tenantId, businessId: feature.businessId, featureId: feature.id, version: 1 } })
      changed.push(created.id)
    }
  }

  for (const row of removed) {
    await tx[model].update({ where: { id: row.id }, data: { deletedAt: now, deleteBatchId, version: { increment: 1 } } })
    changed.push(row.id)
  }
  const updatedFeature = bump && (changed.length > 0 || desired.length === 0 || active.length > 0) ? await bumpFeature(tx, feature.id) : feature
  return { changed, updatedFeature, deleteBatchId }
}

async function validateBindingRows(tx, scope, feature, bindings, evidencePort) {
  const seen = new Set()
  for (const row of bindings) {
    const key = `${row.governanceSnapshotId}|${row.sourceNamespace}|${row.requirementKey}`
    if (seen.has(key)) throw mutationError('CHILD_SET_CONFLICT', 409)
    seen.add(key)
    const { snapshot, projectRepository } = await findValidSnapshot(tx, scope, row.governanceSnapshotId)
    if (!evidencePort || typeof evidencePort.verifyRequirement !== 'function') throw mutationError('SNAPSHOT_REQUIRED', 422)
    const result = await evidencePort.verifyRequirement({ tx, scope, feature, snapshot, projectRepository, ...row })
    if (!result || result.state !== 'AVAILABLE' || result.revisionHash !== row.revisionHash) throw mutationError('REQUIREMENT_REVISION_MISMATCH', 422)
  }
}

async function createFeatureEffect(tx, scope, input, { evidencePort, now }) {
  assertKnownDomain(input.primaryDomainId)
  const existing = await tx.projectFeature.findFirst({ where: { projectId: scope.project.id, code: input.code } })
  if (existing) throw mutationError(existing.deletedAt ? 'DELETED_FEATURE_CODE_REQUIRES_RESTORE' : 'DUPLICATE_FEATURE_CODE', 409)
  const count = await tx.projectFeature.count({ where: { projectId: scope.project.id, deletedAt: null } })
  if (count >= MAX_FEATURES) throw mutationError('FEATURE_LIMIT_REACHED', 422)
  await verifyFeatureEvidence(tx, scope, input, evidencePort)
  const feature = await tx.projectFeature.create({
    data: {
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      projectId: scope.project.id,
      code: input.code,
      title: input.title,
      problem: input.problem,
      outcome: input.outcome,
      primaryDomainId: input.primaryDomainId,
      canonicalFeatureKey: input.canonicalFeatureKey ?? null,
      governanceSnapshotId: input.governanceSnapshotId ?? null,
      lifecycle: 'DRAFT',
      version: 1,
    },
  })
  return { resourceId: feature.id, featureId: feature.id, version: feature.version, etag: featureEtag(feature), auditEntityId: feature.id, after: feature }
}

async function updateFeatureEffect(tx, scope, featureId, input, { ifMatch }) {
  const feature = await findFeature(tx, scope, featureId)
  expectedEtag(ifMatch, feature)
  if (input.primaryDomainId !== undefined) {
    assertKnownDomain(input.primaryDomainId)
    const activeContributions = await tx.featureContribution.findMany({
      where: { featureId: feature.id, deletedAt: null },
      select: { domainId: true },
    })
    if (activeContributions.some((row) => row.domainId === input.primaryDomainId)) {
      throw mutationError('PRIMARY_DOMAIN_DUPLICATE', 422)
    }
  }
  if (input.lifecycle !== undefined) {
    const currentIndex = FEATURE_LIFECYCLES.indexOf(feature.lifecycle)
    const nextIndex = FEATURE_LIFECYCLES.indexOf(input.lifecycle)
    if (currentIndex < 0 || nextIndex < currentIndex || nextIndex > currentIndex + 1) throw mutationError('INVALID_LIFECYCLE', 422)
  }
  const data = {}
  for (const field of ['title', 'problem', 'outcome', 'primaryDomainId', 'lifecycle']) {
    if (input[field] !== undefined && input[field] !== feature[field]) data[field] = input[field]
  }
  const updated = Object.keys(data).length
    ? await tx.projectFeature.update({ where: { id: feature.id }, data: { ...data, version: { increment: 1 } } })
    : feature
  return { resourceId: updated.id, featureId: updated.id, version: updated.version, etag: featureEtag(updated), auditEntityId: updated.id, before: feature, after: updated }
}

async function replaceContributionsEffect(tx, scope, featureId, input, { ifMatch, now }) {
  const feature = await findFeature(tx, scope, featureId)
  expectedEtag(ifMatch, feature)
  const result = await completeSetRows(tx, {
    model: 'featureContribution',
    feature,
    desired: input.contributions,
    key: (row) => row.domainId,
    fields: (row) => ({ domainId: row.domainId, responsibility: row.responsibility }),
    now,
    validate: (current, desired) => validateContributionRows(tx, scope, feature, desired),
  })
  const updated = result.updatedFeature
  return { resourceId: feature.id, featureId: feature.id, version: updated.version, etag: featureEtag(updated), auditEntityId: feature.id, before: feature, after: updated }
}

async function replaceWorkLinksEffect(tx, scope, featureId, input, { ifMatch, now }) {
  const feature = await findFeature(tx, scope, featureId)
  expectedEtag(ifMatch, feature)
  await validateWorkLinkRows(tx, scope, featureId, input.links, input.allocationMode)
  const result = await completeSetRows(tx, {
    model: 'featureWorkLink',
    feature,
    desired: input.links,
    key: (row) => row.workItemId,
    fields: (row) => ({ workItemId: row.workItemId, allocationBps: row.allocationBps }),
    now,
    validate: async () => {},
  })
  const updated = result.updatedFeature
  return { resourceId: feature.id, featureId: feature.id, version: updated.version, etag: featureEtag(updated), auditEntityId: feature.id, before: feature, after: updated }
}

async function replaceBindingsEffect(tx, scope, featureId, input, { ifMatch, evidencePort, now }) {
  const feature = await findFeature(tx, scope, featureId)
  expectedEtag(ifMatch, feature)
  await validateBindingRows(tx, scope, feature, input.bindings, evidencePort)
  const result = await completeSetRows(tx, {
    model: 'requirementBinding',
    feature,
    desired: input.bindings,
    key: (row) => `${row.governanceSnapshotId}|${row.sourceNamespace}|${row.requirementKey}`,
    fields: (row) => ({ governanceSnapshotId: row.governanceSnapshotId, sourceNamespace: row.sourceNamespace, requirementKey: row.requirementKey, revisionHash: row.revisionHash, acceptanceRef: row.acceptanceRef }),
    now,
    validate: async () => {},
  })
  const updated = result.updatedFeature
  return { resourceId: feature.id, featureId: feature.id, version: updated.version, etag: featureEtag(updated), auditEntityId: feature.id, before: feature, after: updated }
}

async function replaceGraphEffect(tx, scope, input, { ifMatch }) {
  const allFeatures = await tx.projectFeature.findMany({ where: { projectId: scope.project.id, tenantId: scope.tenantId, businessId: scope.businessId }, orderBy: [{ id: 'asc' }] })
  const currentEtag = graphEtag(scope.project.id, allFeatures)
  expectedEtag(ifMatch, currentEtag, 'graph')
  const featureIds = input.featureSets.map((set) => set.featureId)
  if (new Set(featureIds).size !== featureIds.length) throw mutationError('CHILD_SET_CONFLICT', 409)
  const named = await tx.projectFeature.findMany({ where: { id: { in: featureIds }, projectId: scope.project.id, tenantId: scope.tenantId, businessId: scope.businessId, deletedAt: null } })
  if (named.length !== featureIds.length) throw mutationError('RESOURCE_NOT_FOUND', 404)
  const currentNamedLinks = await tx.featureWorkLink.findMany({ where: { featureId: { in: featureIds }, tenantId: scope.tenantId, businessId: scope.businessId, deletedAt: null }, select: { featureId: true, workItemId: true, allocationBps: true, id: true } })
  const submittedIds = input.featureSets.flatMap((set) => set.links.map((link) => link.workItemId))
  const oldIds = currentNamedLinks.map((row) => row.workItemId)
  const exactIds = new Set([...oldIds, ...submittedIds])
  if (exactIds.size !== input.affectedWorkItemIds.length || input.affectedWorkItemIds.some((id) => !exactIds.has(id))) throw mutationError('GRAPH_MEMBERSHIP_MISMATCH', 422)
  await findWorkItems(tx, scope, input.affectedWorkItemIds)
  const existingAffected = await activeProjectWorkLinks(tx, scope, input.affectedWorkItemIds)
  const namedSet = new Set(featureIds)
  const proposed = existingAffected.filter((row) => !namedSet.has(row.featureId))
  for (const set of input.featureSets) {
    if (new Set(set.links.map((link) => link.workItemId)).size !== set.links.length) throw mutationError('CHILD_SET_CONFLICT', 409)
    proposed.push(...set.links.map((link) => ({ featureId: set.featureId, ...link })))
  }
  validateAllocation(input.allocationMode, linksByWorkItem(proposed))
  for (const set of input.featureSets) {
    const feature = named.find((row) => row.id === set.featureId)
    await completeSetRows(tx, {
      model: 'featureWorkLink',
      feature,
      desired: set.links,
      key: (row) => row.workItemId,
      fields: (row) => ({ workItemId: row.workItemId, allocationBps: row.allocationBps }),
      now: new Date(),
      validate: async () => {},
    })
  }
  const updatedFeatures = await tx.projectFeature.findMany({ where: { projectId: scope.project.id, tenantId: scope.tenantId, businessId: scope.businessId }, orderBy: [{ id: 'asc' }] })
  return { resourceId: scope.project.id, version: null, etag: graphEtag(scope.project.id, updatedFeatures), auditEntityId: scope.project.id, after: { featureIds, affectedWorkItemIds: input.affectedWorkItemIds } }
}

async function deleteFeatureEffect(tx, scope, featureId, { ifMatch, now }) {
  const feature = await findFeature(tx, scope, featureId)
  expectedEtag(ifMatch, feature)
  const batch = randomUUID()
  const updated = await tx.projectFeature.update({ where: { id: feature.id }, data: { deletedAt: now, deleteBatchId: batch, version: { increment: 1 } } })
  for (const model of ['featureContribution', 'featureWorkLink', 'requirementBinding']) {
    await tx[model].updateMany({ where: { featureId: feature.id, deletedAt: null }, data: { deletedAt: now, deleteBatchId: batch, version: { increment: 1 } } })
  }
  return { resourceId: feature.id, featureId: feature.id, version: updated.version, etag: featureEtag(updated), auditEntityId: feature.id, before: feature, after: updated }
}

async function restoreFeatureEffect(tx, scope, featureId, { ifMatch, now }) {
  const feature = await findFeature(tx, scope, featureId, { deleted: true })
  expectedEtag(ifMatch, feature)
  const count = await tx.projectFeature.count({ where: { projectId: scope.project.id, deletedAt: null } })
  if (count >= MAX_FEATURES) throw mutationError('FEATURE_LIMIT_REACHED', 422)
  if (!feature.deleteBatchId) throw mutationError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
  const children = {}
  for (const model of ['featureContribution', 'featureWorkLink', 'requirementBinding']) {
    const activeChildren = await tx[model].count({ where: { featureId: feature.id, deletedAt: null } })
    if (activeChildren > 0) throw mutationError('DATA_INTEGRITY_UNAVAILABLE', 503, true)
    children[model] = await tx[model].findMany({ where: { featureId: feature.id, deletedAt: { not: null }, deleteBatchId: feature.deleteBatchId }, orderBy: [{ id: 'asc' }] })
  }
  const links = children.featureWorkLink
  await findWorkItems(tx, scope, links.map((row) => row.workItemId))
  const existing = await activeProjectWorkLinks(tx, scope, [...new Set(links.map((row) => row.workItemId))])
  const proposed = [...existing, ...links.map((row) => ({ featureId: feature.id, workItemId: row.workItemId, allocationBps: row.allocationBps }))]
  validateAllocation('UNALLOCATED', linksByWorkItem(proposed))
  await validateContributionRows(tx, scope, feature, children.featureContribution)
  for (const row of children.requirementBinding) await findValidSnapshot(tx, scope, row.governanceSnapshotId)
  const updated = await tx.projectFeature.update({ where: { id: feature.id }, data: { deletedAt: null, deleteBatchId: null, version: { increment: 1 } } })
  for (const model of ['featureContribution', 'featureWorkLink', 'requirementBinding']) {
    if (children[model].length) await tx[model].updateMany({ where: { id: { in: children[model].map((row) => row.id) } }, data: { deletedAt: null, deleteBatchId: null, version: { increment: 1 } } })
  }
  void now
  return { resourceId: feature.id, featureId: feature.id, version: updated.version, etag: featureEtag(updated), auditEntityId: feature.id, before: feature, after: updated }
}

/** Resolve one live session and bind the mutation to Identity's API-write CSRF token. */
export async function resolveRequestViewerForFeatureMutation(request, { db = prisma, env = process.env, sessionPort = createSessionPort(), now = Date.now() } = {}) {
  let session
  try {
    session = await sessionPort.read(request)
  } catch {
    throw mutationError('SESSION_UNAVAILABLE', 503, true)
  }
  if (!session || session.state !== 'AUTHENTICATED') throw mutationError('AUTH_REQUIRED', 401)
  let viewer
  try {
    viewer = await resolveViewer({
      principalId: session.principalId,
      platformGrant: session.platformGrant === true,
      superadminGrant: session.superadminGrant === true,
      db,
    })
  } catch (error) {
    if (error?.status === 401 || /principal (?:was not found|is required)/i.test(error?.message || '')) throw mutationError('AUTH_REQUIRED', 401)
    throw mutationError('SESSION_UNAVAILABLE', 503, true)
  }
  try {
    assertApiWriteCsrfToken({ request, token: headerValue(request, 'x-csrf-token'), session, env, now })
  } catch (error) {
    if (error?.status === 401) throw mutationError('AUTH_REQUIRED', 401)
    if (error?.status === 403) throw mutationError('CSRF_INVALID', 403)
    throw mutationError('SESSION_UNAVAILABLE', 503, true)
  }
  return { viewer, session }
}

export async function createProjectFeature(projectId, input, options = {}) {
  return runMutation({ ...options, projectId, operation: 'CREATE_FEATURE', httpMethod: 'POST', targetType: 'PROJECT', targetId: projectId, resourceType: 'PROJECT_FEATURE', command: input, normalize: (value) => normalizeCommand('CREATE_FEATURE', value), callback: (tx, scope, context) => createFeatureEffect(tx, scope, context.command, context) })
}

export async function updateProjectFeature(projectId, featureId, input, options = {}) {
  return runMutation({ ...options, projectId, operation: 'UPDATE_FEATURE', httpMethod: 'PATCH', targetType: 'FEATURE', targetId: featureId, resourceType: 'PROJECT_FEATURE', command: input, normalize: (value) => normalizeCommand('UPDATE_FEATURE', value), ifMatch: options.ifMatch, callback: (tx, scope, context) => updateFeatureEffect(tx, scope, featureId, context.command, context) })
}

export async function replaceProjectFeatureContributions(projectId, featureId, input, options = {}) {
  return runMutation({ ...options, projectId, operation: 'REPLACE_CONTRIBUTIONS', httpMethod: 'PUT', targetType: 'FEATURE', targetId: featureId, resourceType: 'PROJECT_FEATURE', command: input, normalize: (value) => normalizeCommand('REPLACE_CONTRIBUTIONS', value), ifMatch: options.ifMatch, callback: (tx, scope, context) => replaceContributionsEffect(tx, scope, featureId, context.command, context) })
}

export async function replaceProjectFeatureWorkLinks(projectId, featureId, input, options = {}) {
  return runMutation({ ...options, projectId, operation: 'REPLACE_WORK_LINKS', httpMethod: 'PUT', targetType: 'FEATURE', targetId: featureId, resourceType: 'PROJECT_FEATURE', command: input, normalize: (value) => normalizeCommand('REPLACE_WORK_LINKS', value), ifMatch: options.ifMatch, callback: (tx, scope, context) => replaceWorkLinksEffect(tx, scope, featureId, context.command, context) })
}

export async function replaceProjectFeatureRequirementBindings(projectId, featureId, input, options = {}) {
  return runMutation({ ...options, projectId, operation: 'REPLACE_REQUIREMENT_BINDINGS', httpMethod: 'PUT', targetType: 'FEATURE', targetId: featureId, resourceType: 'PROJECT_FEATURE', command: input, normalize: (value) => normalizeCommand('REPLACE_REQUIREMENT_BINDINGS', value), ifMatch: options.ifMatch, callback: (tx, scope, context) => replaceBindingsEffect(tx, scope, featureId, context.command, context) })
}

export async function redistributeProjectFeatureWorkLinks(projectId, input, options = {}) {
  return runMutation({ ...options, projectId, operation: 'REPLACE_FEATURE_WORK_GRAPH', httpMethod: 'PUT', targetType: 'PROJECT', targetId: projectId, resourceType: 'PROJECT_FEATURE_GRAPH', command: input, normalize: (value) => normalizeCommand('REPLACE_FEATURE_WORK_GRAPH', value), ifMatch: options.ifMatch, callback: (tx, scope, context) => replaceGraphEffect(tx, scope, context.command, context) })
}

export async function deleteProjectFeature(projectId, featureId, options = {}) {
  return runMutation({ ...options, projectId, operation: 'DELETE_FEATURE', httpMethod: 'DELETE', targetType: 'FEATURE', targetId: featureId, resourceType: 'PROJECT_FEATURE', command: {}, ifMatch: options.ifMatch, callback: (tx, scope, context) => deleteFeatureEffect(tx, scope, featureId, context) })
}

export async function restoreProjectFeature(projectId, featureId, options = {}) {
  return runMutation({ ...options, projectId, operation: 'RESTORE_FEATURE', httpMethod: 'POST', targetType: 'FEATURE', targetId: featureId, resourceType: 'PROJECT_FEATURE', command: {}, ifMatch: options.ifMatch, callback: (tx, scope, context) => restoreFeatureEffect(tx, scope, featureId, context) })
}

export function toPublicProjectFeatureMutationError(error) {
  const code = error?.code || error?.message
  const mapping = {
    AUTH_REQUIRED: [401, 'Authentication is required.', false],
    CSRF_INVALID: [403, 'CSRF validation failed.', false],
    CAPABILITY_DENIED: [403, 'Capability denied.', false],
    RESOURCE_NOT_FOUND: [404, 'Resource not found.', false],
    MALFORMED_REQUEST: [400, 'Request is invalid.', false],
    IDEMPOTENCY_KEY_REUSED: [409, 'Idempotency key was already used with different input.', false],
    DUPLICATE_FEATURE_CODE: [409, 'Feature code is already in use.', false],
    DELETED_FEATURE_CODE_REQUIRES_RESTORE: [409, 'The deleted Feature code must be restored.', false],
    CHILD_SET_CONFLICT: [409, 'Feature relationship set conflicts with existing data.', false],
    GRAPH_MEMBERSHIP_MISMATCH: [422, 'Affected WorkItems do not match the submitted graph.', false],
    ALLOCATION_RESTORE_CONFLICT: [409, 'Restoring these allocations would exceed the WorkItem limit.', false],
    VERSION_MISMATCH: [412, 'The Feature version does not match.', false],
    PRECONDITION_REQUIRED: [428, 'If-Match is required.', false],
    FEATURE_LIMIT_REACHED: [422, 'The Project Feature limit has been reached.', false],
    SESSION_UNAVAILABLE: [503, 'Session service temporarily unavailable.', true],
    DATA_INTEGRITY_UNAVAILABLE: [503, 'Stored Feature data is unavailable.', true],
  }
  const repositoryMappings = {
    PHASE_B_PROJECT_NOT_FOUND: [404, 'RESOURCE_NOT_FOUND', 'Resource not found.', false],
    PHASE_B_FEATURE_NOT_FOUND: [404, 'RESOURCE_NOT_FOUND', 'Resource not found.', false],
    PHASE_B_SCOPE_UNBOUND: [404, 'RESOURCE_NOT_FOUND', 'Resource not found.', false],
    PHASE_B_SCOPE_INVALID: [404, 'RESOURCE_NOT_FOUND', 'Resource not found.', false],
    PHASE_B_SCOPE_MISMATCH: [404, 'RESOURCE_NOT_FOUND', 'Resource not found.', false],
    PHASE_B_PROJECT_ID_REQUIRED: [400, 'MALFORMED_REQUEST', 'Request is invalid.', false],
    PHASE_B_FEATURE_ID_REQUIRED: [400, 'MALFORMED_REQUEST', 'Request is invalid.', false],
    PHASE_B_DATABASE_DIALECT_UNAVAILABLE: [503, 'DATA_INTEGRITY_UNAVAILABLE', 'Stored Feature data is unavailable.', true],
    PHASE_B_TRANSACTION_REQUIRED: [503, 'DATA_INTEGRITY_UNAVAILABLE', 'Stored Feature data is unavailable.', true],
    PHASE_B_TRANSACTION_UNAVAILABLE: [503, 'DATA_INTEGRITY_UNAVAILABLE', 'Stored Feature data is unavailable.', true],
    PHASE_B_PROJECT_LOCK_UNAVAILABLE: [503, 'DATA_INTEGRITY_UNAVAILABLE', 'Stored Feature data is unavailable.', true],
    PHASE_B_SCOPE_BINDING_UNAVAILABLE: [503, 'DATA_INTEGRITY_UNAVAILABLE', 'Stored Feature data is unavailable.', true],
    PHASE_B_SCOPE_BINDING_MISMATCH: [503, 'DATA_INTEGRITY_UNAVAILABLE', 'Stored Feature data is unavailable.', true],
  }
  const validationCodes = new Set(['DOMAIN_ID_UNRECOGNIZED', 'PRIMARY_DOMAIN_DUPLICATE', 'CROSS_PROJECT_WORK_LINK', 'INVALID_ALLOCATION', 'SNAPSHOT_REQUIRED', 'SNAPSHOT_INVALID', 'REQUIREMENT_REVISION_MISMATCH', 'INVALID_LIFECYCLE'])
  const repositoryMapping = repositoryMappings[code]
  const mapped = mapping[code]
    || (repositoryMapping ? [repositoryMapping[0], repositoryMapping[2], repositoryMapping[3]] : null)
    || (validationCodes.has(code) ? [422, 'Request violates a Feature invariant.', false] : [503, 'Feature mutation service temporarily unavailable.', true])
  const publicCode = mapping[code]
    ? code
    : repositoryMapping
      ? repositoryMapping[1]
      : (validationCodes.has(code) ? code : mapped[0] === 400 ? 'MALFORMED_REQUEST' : mapped[0] === 404 ? 'RESOURCE_NOT_FOUND' : mapped[0] === 412 ? 'VERSION_MISMATCH' : mapped[0] === 428 ? 'PRECONDITION_REQUIRED' : mapped[0] === 403 ? code : mapped[0] === 409 ? code : mapped[0] === 422 ? code : mapped[0] === 401 ? 'AUTH_REQUIRED' : 'SESSION_UNAVAILABLE')
  return {
    status: repositoryMapping ? repositoryMapping[0] : (error?.status || mapped[0]),
    code: publicCode,
    message: mapped[1],
    retryable: error?.retryable ?? mapped[2],
    ...(error?.currentVersion !== undefined ? { currentVersion: error.currentVersion } : {}),
    ...(error?.currentEtag !== undefined ? { currentEtag: error.currentEtag } : {}),
    ...(error?.fields ? { fields: error.fields.slice(0, 50) } : {}),
  }
}

export function mutationResponseHeaders(receipt, requestId) {
  return {
    'Cache-Control': 'no-store',
    'ETag': receipt.etag,
    'X-Request-ID': requestId,
  }
}
