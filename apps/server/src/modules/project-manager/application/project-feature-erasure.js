import { createHash } from 'node:crypto'
import { isInstallationOperator, ownsBusiness } from '@/modules/identity/viewer-authority'
import { resolveProjectFeatureScope } from './project-feature-repository'

// @req FR-252 — apply only the server-reviewed Project Feature text targets
// carried by Identity's existing erasure transaction. No subject is inferred
// from authorship, receipt actors, names or text search.
// @spec ADR-097; docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/project-feature-erasure.test.js, tests/integration/phase-b-identity-erasure.test.js

export const PROJECT_FEATURE_ERASURE_VERSION = 'pm-erasure.v1'
export const PROJECT_FEATURE_ERASURE_REDACTION = '[erased]'

const FIELD_ALLOWLIST = Object.freeze({
  ProjectFeature: Object.freeze(['title', 'problem', 'outcome']),
  FeatureContribution: Object.freeze(['responsibility']),
})
const RECORD_TYPES = new Set(Object.keys(FIELD_ALLOWLIST))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DIGEST = /^[0-9a-f]{64}$/
const MAX_TARGETS = 200
const MANIFEST_KEYS = new Set([
  'version',
  'tenantId',
  'businessId',
  'subjectPersonId',
  'reviewerPersonId',
  'requestId',
  'reasonRef',
  'targets',
  'manifestSha256',
  // Advisory metadata may be carried by the review producer, but it never
  // participates in the digest or grants authority.
  'status',
])

function erasureError(code, status = 409, details = null) {
  const error = new Error(code)
  error.name = 'ProjectFeatureErasureError'
  error.code = code
  error.status = status
  error.retryable = false
  if (details) error.details = details
  return error
}

function requireUuid(value, code) {
  if (typeof value !== 'string' || !UUID.test(value)) throw erasureError(code, 400)
  return value
}

function requireString(value, code, max = 256) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw erasureError(code, 400)
  return value
}

function assertPlainObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw erasureError(code, 400)
}

function targetKey(target) {
  return `${target.projectId}\u0000${target.recordType}\u0000${target.recordId}\u0000${target.field}`
}

function compareTargets(a, b) {
  for (const key of ['projectId', 'recordType', 'recordId', 'field']) {
    if (a[key] < b[key]) return -1
    if (a[key] > b[key]) return 1
  }
  return 0
}

function normalizeTarget(input) {
  assertPlainObject(input, 'PM_ERASURE_TARGET_INVALID')
  const allowedKeys = new Set(['projectId', 'recordType', 'recordId', 'field', 'expectedVersion'])
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) throw erasureError('PM_ERASURE_TARGET_INVALID', 400)
  const target = {
    projectId: requireUuid(input.projectId, 'PM_ERASURE_PROJECT_ID_INVALID'),
    recordType: input.recordType,
    recordId: requireUuid(input.recordId, 'PM_ERASURE_RECORD_ID_INVALID'),
    field: input.field,
    expectedVersion: input.expectedVersion,
  }
  if (!RECORD_TYPES.has(target.recordType)) throw erasureError('PM_ERASURE_RECORD_TYPE_INVALID', 400)
  if (!FIELD_ALLOWLIST[target.recordType].includes(target.field)) throw erasureError('PM_ERASURE_FIELD_NOT_ALLOWED', 400)
  if (!Number.isInteger(target.expectedVersion) || target.expectedVersion < 1) {
    throw erasureError('PM_ERASURE_VERSION_INVALID', 400)
  }
  return target
}

/**
 * Return the exact UTF-8 JSON string bound by a reviewed manifest. The digest
 * excludes `manifestSha256` and the advisory `status`; neither is authority.
 */
export function canonicalReviewedProjectFeatureManifest(manifest) {
  assertPlainObject(manifest, 'PM_ERASURE_MANIFEST_INVALID')
  if (Object.keys(manifest).some((key) => !MANIFEST_KEYS.has(key))) {
    throw erasureError('PM_ERASURE_MANIFEST_INVALID', 400)
  }
  if (manifest.version !== PROJECT_FEATURE_ERASURE_VERSION) throw erasureError('PM_ERASURE_VERSION_INVALID', 400)
  if (manifest.status !== undefined && (typeof manifest.status !== 'string' || manifest.status.length > 32)) {
    throw erasureError('PM_ERASURE_MANIFEST_INVALID', 400)
  }

  const normalizedTargets = Array.isArray(manifest.targets)
    ? manifest.targets.map(normalizeTarget).sort(compareTargets)
    : (() => { throw erasureError('PM_ERASURE_TARGETS_REQUIRED', 400) })()
  if (normalizedTargets.length < 1 || normalizedTargets.length > MAX_TARGETS) {
    throw erasureError('PM_ERASURE_TARGETS_INVALID', 400)
  }
  const keys = new Set()
  const versions = new Map()
  for (const target of normalizedTargets) {
    const key = targetKey(target)
    if (keys.has(key)) throw erasureError('PM_ERASURE_DUPLICATE_TARGET', 400)
    keys.add(key)
    const recordKey = `${target.recordType}\u0000${target.recordId}`
    const priorVersion = versions.get(recordKey)
    if (priorVersion !== undefined && priorVersion !== target.expectedVersion) {
      throw erasureError('PM_ERASURE_VERSION_CONFLICT', 409)
    }
    versions.set(recordKey, target.expectedVersion)
  }

  const canonical = {
    version: PROJECT_FEATURE_ERASURE_VERSION,
    tenantId: requireUuid(manifest.tenantId, 'PM_ERASURE_TENANT_ID_INVALID'),
    businessId: requireUuid(manifest.businessId, 'PM_ERASURE_BUSINESS_ID_INVALID'),
    subjectPersonId: requireUuid(manifest.subjectPersonId, 'PM_ERASURE_SUBJECT_ID_INVALID'),
    reviewerPersonId: requireUuid(manifest.reviewerPersonId, 'PM_ERASURE_REVIEWER_ID_INVALID'),
    requestId: requireString(manifest.requestId, 'PM_ERASURE_REQUEST_ID_INVALID'),
    reasonRef: requireString(manifest.reasonRef, 'PM_ERASURE_REASON_REF_INVALID'),
    targets: normalizedTargets,
  }
  return JSON.stringify(canonical)
}

export function digestReviewedProjectFeatureManifest(manifest) {
  return createHash('sha256')
    .update(Buffer.from(canonicalReviewedProjectFeatureManifest(manifest), 'utf8'))
    .digest('hex')
}

function parseCanonicalManifest(manifest) {
  const canonicalJson = canonicalReviewedProjectFeatureManifest(manifest)
  const digest = createHash('sha256').update(Buffer.from(canonicalJson, 'utf8')).digest('hex')
  if (!Object.prototype.hasOwnProperty.call(manifest, 'manifestSha256')) {
    throw erasureError('PM_ERASURE_MANIFEST_DIGEST_REQUIRED', 400)
  }
  if (!DIGEST.test(manifest.manifestSha256)) {
    throw erasureError('PM_ERASURE_MANIFEST_DIGEST_INVALID', 400)
  }
  if (manifest.manifestSha256 !== digest) {
    throw erasureError('PM_ERASURE_MANIFEST_DIGEST_MISMATCH', 409)
  }
  return { value: JSON.parse(canonicalJson), digest }
}

function authorityReviewerId(authority) {
  return authority?.viewer?.principal?.id || null
}

function assertAuthority(manifest, authority, digest) {
  assertPlainObject(authority, 'PM_ERASURE_AUTHORITY_REQUIRED')
  const reviewerId = authorityReviewerId(authority)
  const tenantId = authority.tenantId || authority.scope?.tenantId
  const businessId = authority.businessId || authority.scope?.businessId
  if (tenantId !== manifest.tenantId || businessId !== manifest.businessId) {
    throw erasureError('PM_ERASURE_AUTHORITY_SCOPE_MISMATCH', 403)
  }
  if (authority.subjectPersonId !== manifest.subjectPersonId) {
    throw erasureError('PM_ERASURE_SUBJECT_AUTHORITY_MISMATCH', 403)
  }
  if (reviewerId !== manifest.reviewerPersonId) {
    throw erasureError('PM_ERASURE_REVIEWER_AUTHORITY_MISMATCH', 403)
  }
  const viewer = authority.viewer
  if (!viewer || (!isInstallationOperator(viewer) && !ownsBusiness(viewer, manifest.businessId))) {
    throw erasureError('PM_ERASURE_BUSINESS_AUTHORITY_REQUIRED', 403)
  }
  if (authority.reviewedManifestSha256 !== undefined && authority.reviewedManifestSha256 !== digest) {
    throw erasureError('PM_ERASURE_REVIEW_MISMATCH', 403)
  }
  return { viewer, reviewed: authority.wholeFieldsApproved === true }
}

function configuredPostgres(tx) {
  const provider = tx?.dialect
    || tx?.provider
    || tx?._engineConfig?.activeProvider
    || tx?._client?._engineConfig?.activeProvider
    || tx?._activeProvider
    || tx?._engineConfig?.datasources?.[0]?.activeProvider
    || tx?._engineConfig?.datasources?.[0]?.provider
  if (typeof provider !== 'string') return null
  if (/postgres/i.test(provider)) return true
  if (/sqlite/i.test(provider)) return false
  return null
}

async function executeRaw(tx, sql, params = []) {
  if (typeof tx.$executeRawUnsafe === 'function') return tx.$executeRawUnsafe(sql, ...params)
  if (typeof tx.$executeRaw === 'function') return tx.$executeRaw(sql, ...params)
  throw erasureError('PM_ERASURE_SCOPE_BINDING_UNAVAILABLE', 503)
}

async function queryRaw(tx, sql, params = []) {
  if (typeof tx.$queryRawUnsafe === 'function') return tx.$queryRawUnsafe(sql, ...params)
  if (typeof tx.$queryRaw === 'function') return tx.$queryRaw(sql, ...params)
  throw erasureError('PM_ERASURE_LOCK_UNAVAILABLE', 503)
}

async function bindScope(tx, scope, postgres) {
  if (!postgres) return
  await executeRaw(
    tx,
    "SELECT set_config('zuri.pm_tenant_id', $1, true), set_config('zuri.pm_business_id', $2, true)",
    [scope.tenantId, scope.businessId],
  )
  const rows = await queryRaw(
    tx,
    "SELECT NULLIF(current_setting('zuri.pm_tenant_id', true), '') AS \"tenantId\", NULLIF(current_setting('zuri.pm_business_id', true), '') AS \"businessId\"",
  )
  const bound = rows?.[0]
  if (!bound || bound.tenantId !== scope.tenantId || bound.businessId !== scope.businessId) {
    throw erasureError('PM_ERASURE_SCOPE_BINDING_MISMATCH', 503)
  }
}

async function readInitialScope(tx, postgres) {
  if (!postgres) return null
  const rows = await queryRaw(
    tx,
    "SELECT NULLIF(current_setting('zuri.pm_tenant_id', true), '') AS \"tenantId\", NULLIF(current_setting('zuri.pm_business_id', true), '') AS \"businessId\"",
  )
  const row = rows?.[0] || {}
  const tenantId = row.tenantId ?? null
  const businessId = row.businessId ?? null
  if ((tenantId && !businessId) || (!tenantId && businessId)) {
    throw erasureError('PM_ERASURE_INITIAL_SCOPE_INVALID', 503)
  }
  if ((tenantId !== null && typeof tenantId !== 'string') || (businessId !== null && typeof businessId !== 'string')) {
    throw erasureError('PM_ERASURE_INITIAL_SCOPE_INVALID', 503)
  }
  return tenantId === null ? null : { tenantId, businessId }
}

function assertInitialScopeRecognized(initialScope, scope) {
  if (initialScope && (initialScope.tenantId !== scope.tenantId || initialScope.businessId !== scope.businessId)) {
    throw erasureError('PM_ERASURE_INITIAL_SCOPE_UNRECOGNIZED', 503)
  }
}

async function restoreScope(tx, initialScope, postgres) {
  if (!postgres) return
  await executeRaw(
    tx,
    "SELECT set_config('zuri.pm_tenant_id', $1, true), set_config('zuri.pm_business_id', $2, true)",
    [initialScope?.tenantId || '', initialScope?.businessId || ''],
  )
  const rows = await queryRaw(
    tx,
    "SELECT NULLIF(current_setting('zuri.pm_tenant_id', true), '') AS \"tenantId\", NULLIF(current_setting('zuri.pm_business_id', true), '') AS \"businessId\"",
  )
  const restored = rows?.[0] || {}
  if ((restored.tenantId ?? null) !== (initialScope?.tenantId ?? null)
    || (restored.businessId ?? null) !== (initialScope?.businessId ?? null)) {
    throw erasureError('PM_ERASURE_SCOPE_RESTORE_MISMATCH', 503)
  }
}

async function withProjectScope(tx, scope, initialScope, postgres, callback) {
  assertInitialScopeRecognized(initialScope, scope)
  if (!postgres) return callback()
  try {
    // A failed readback can happen after set_config changes the local setting;
    // keep binding inside the restoration guard so an outer Identity tx never
    // retains a partial PM scope.
    await bindScope(tx, scope, postgres)
    return await callback()
  } finally {
    await restoreScope(tx, initialScope, postgres)
  }
}

async function lockSubject(tx, subjectPersonId, postgres, authority) {
  if (typeof authority?.replayLock === 'function') {
    await authority.replayLock(tx, subjectPersonId)
    return
  }
  if (postgres) {
    const rows = await queryRaw(tx, 'SELECT "id" FROM "Person" WHERE "id" = $1 FOR UPDATE', [subjectPersonId])
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw erasureError('PM_ERASURE_SUBJECT_NOT_FOUND', 404)
    }
    return
  }
  if (typeof tx.person?.findUnique === 'function') {
    const subject = await tx.person.findUnique({ where: { id: subjectPersonId }, select: { id: true } })
    if (!subject) throw erasureError('PM_ERASURE_SUBJECT_NOT_FOUND', 404)
    return
  }
  throw erasureError('PM_ERASURE_LOCK_UNAVAILABLE', 503)
}

async function lockProject(tx, projectId, postgres) {
  if (postgres) {
    const rows = await queryRaw(tx, 'SELECT "id" FROM "Project" WHERE "id" = $1 FOR UPDATE', [projectId])
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw erasureError('PM_ERASURE_PROJECT_NOT_FOUND', 404)
    }
    return
  }
  if (typeof tx.project?.findUnique === 'function') {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) throw erasureError('PM_ERASURE_PROJECT_NOT_FOUND', 404)
    return
  }
  throw erasureError('PM_ERASURE_LOCK_UNAVAILABLE', 503)
}

function emptyResult(status, manifestSha256 = null, extra = {}) {
  const base = {
    status,
    manifestSha256,
    changedRowCount: 0,
    changedFieldCount: 0,
  }
  return { ...base, audit: { ...base, ...extra } }
}

function parseAuditPayload(row) {
  try {
    const payload = JSON.parse(row.payloadJson || '{}')
    return payload && typeof payload.pmErasure === 'object' ? payload.pmErasure : null
  } catch {
    return null
  }
}

async function replayResult(tx, manifest, digest) {
  if (typeof tx.auditEvent?.findMany !== 'function') throw erasureError('PM_ERASURE_REPLAY_LOOKUP_UNAVAILABLE', 503)
  const rows = await tx.auditEvent.findMany({
    where: { entityType: 'PRINCIPAL', entityId: manifest.subjectPersonId, action: 'ERASED' },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: { id: true, payloadJson: true },
  })
  for (const row of rows) {
    const prior = parseAuditPayload(row)
    if (!prior || !['APPLIED', 'REPLAYED'].includes(prior.status)) continue
    if (prior.requestId === manifest.requestId && prior.manifestSha256 !== digest) {
      throw erasureError('PM_ERASURE_REPLAY_CONFLICT', 409)
    }
    if (prior.manifestSha256 === digest) {
      return emptyResult('REPLAYED', digest, {
        reviewerPersonId: manifest.reviewerPersonId,
        requestId: manifest.requestId,
        reasonRef: manifest.reasonRef,
        targets: manifest.targets,
      })
    }
  }
  return null
}

function featureParentForContribution(row, parentById) {
  const parent = parentById.get(row.featureId)
  if (!parent) throw erasureError('PM_ERASURE_TARGET_NOT_FOUND', 409)
  return parent
}

function assertTargetRow(target, row, scopeByProject, parent = null) {
  if (!row) throw erasureError('PM_ERASURE_TARGET_NOT_FOUND', 409)
  const scope = scopeByProject.get(target.projectId)
  if (!scope) throw erasureError('PM_ERASURE_SCOPE_MISMATCH', 409)
  const projectId = target.recordType === 'ProjectFeature' ? row.projectId : parent?.projectId
  const rowScopeMatches = row.tenantId === scope.tenantId && row.businessId === scope.businessId
  const parentScopeMatches = target.recordType === 'ProjectFeature'
    || (parent?.tenantId === scope.tenantId && parent?.businessId === scope.businessId)
  if (projectId !== target.projectId || !rowScopeMatches || !parentScopeMatches) {
    throw erasureError('PM_ERASURE_TARGET_SCOPE_MISMATCH', 409)
  }
  if (!Number.isInteger(row.version) || row.version !== target.expectedVersion) {
    throw erasureError('PM_ERASURE_VERSION_CONFLICT', 409)
  }
}

/**
 * Apply the reviewed PM portion inside an already-open Identity transaction.
 * This function intentionally never starts a transaction or appends an audit;
 * the caller composes CRM/Identity/PM and writes the one existing erasure audit.
 */
export async function applyReviewedProjectFeatureErasure(
  tx,
  manifest,
  { authority = null, now = new Date() } = {},
) {
  if (!tx || typeof tx !== 'object') throw erasureError('PM_ERASURE_TRANSACTION_REQUIRED', 500)
  if (manifest === null || manifest === undefined) return emptyResult('UNMAPPED')

  const { value, digest } = parseCanonicalManifest(manifest)
  const auth = assertAuthority(manifest, authority, digest)
  if (authority.mappingStatus === 'UNMAPPED' || authority.unmapped === true) {
    return emptyResult('UNMAPPED', digest, {
      reviewerPersonId: value.reviewerPersonId,
      requestId: value.requestId,
      reasonRef: value.reasonRef,
      targets: value.targets,
    })
  }
  if (!auth.reviewed) {
    return emptyResult('PENDING', digest, {
      reviewerPersonId: value.reviewerPersonId,
      requestId: value.requestId,
      reasonRef: value.reasonRef,
      targets: value.targets,
    })
  }

  const postgres = configuredPostgres(tx)
  if (postgres === null) throw erasureError('PM_ERASURE_DATABASE_DIALECT_UNAVAILABLE', 503)
  // Identity may compose PM with CRM/Integration work in one transaction. If
  // that transaction already carries a local PM scope, it must be either empty
  // or the exact reviewed scope; the port never trusts or silently overwrites a
  // caller's unrelated scope. Every bounded Project callback restores it.
  const initialScope = await readInitialScope(tx, postgres)
  // Refuse a foreign nonempty scope before subject locking or replay lookup;
  // an exact replay cannot bypass this transaction-local isolation boundary.
  assertInitialScopeRecognized(initialScope, {
    tenantId: value.tenantId,
    businessId: value.businessId,
  })
  await lockSubject(tx, value.subjectPersonId, postgres, authority)

  const projectIds = [...new Set(value.targets.map((target) => target.projectId))].sort()
  const scopes = new Map()
  for (const projectId of projectIds) {
    // This is the ancestry proof for every target Project. It runs before any
    // ProjectFeature/Contribution lookup, including when all targets are tombstones.
    const scope = await resolveProjectFeatureScope(projectId, {
      db: tx,
      viewer: auth.viewer,
      authority,
      mode: 'erasure',
    })
    scopes.set(projectId, scope)
  }
  for (const projectId of projectIds) {
    await lockProject(tx, projectId, postgres)
    // Re-prove the complete ancestry and current authority after each
    // deterministic Project lock, before any protected-family lookup.
    const recheckedScope = await resolveProjectFeatureScope(projectId, {
      db: tx,
      viewer: auth.viewer,
      authority,
      mode: 'erasure',
    })
    scopes.set(projectId, recheckedScope)
  }

  const replay = await replayResult(tx, value, digest)
  if (replay) return replay

  // Read and validate every Project's target set before the first update. The
  // caller's transaction provides rollback, while this ordering also makes a
  // direct adapter/fake unable to observe a partial PM application.
  const targetsByProject = new Map(projectIds.map((projectId) => [
    projectId,
    value.targets.filter((target) => target.projectId === projectId),
  ]))
  const featureById = new Map()
  const contributionById = new Map()
  const parentById = new Map()

  for (const projectId of projectIds) {
    const projectTargets = targetsByProject.get(projectId)
    await withProjectScope(tx, scopes.get(projectId), initialScope, postgres, async () => {
      const featureIds = [...new Set(projectTargets
        .filter((target) => target.recordType === 'ProjectFeature')
        .map((target) => target.recordId))]
      const contributionIds = [...new Set(projectTargets
        .filter((target) => target.recordType === 'FeatureContribution')
        .map((target) => target.recordId))]
      const featureRows = featureIds.length
        ? await tx.projectFeature.findMany({ where: { id: { in: featureIds } } })
        : []
      const contributionRows = contributionIds.length
        ? await tx.featureContribution.findMany({ where: { id: { in: contributionIds } } })
        : []
      const parentIds = [...new Set(contributionRows.map((row) => row.featureId).filter(Boolean))]
      const parentRows = parentIds.length
        ? await tx.projectFeature.findMany({ where: { id: { in: parentIds } } })
        : []
      for (const row of featureRows) featureById.set(row.id, row)
      for (const row of contributionRows) contributionById.set(row.id, row)
      for (const row of parentRows) parentById.set(row.id, row)

      for (const target of projectTargets) {
        const row = target.recordType === 'ProjectFeature'
          ? featureById.get(target.recordId)
          : contributionById.get(target.recordId)
        const parent = target.recordType === 'FeatureContribution' && row
          ? featureParentForContribution(row, parentById)
          : null
        assertTargetRow(target, row, scopes, parent)
      }
    })
  }

  const featureChanges = new Map()
  const contributionChanges = new Map()
  for (const target of value.targets) {
    const row = target.recordType === 'ProjectFeature'
      ? featureById.get(target.recordId)
      : contributionById.get(target.recordId)
    const change = target.recordType === 'ProjectFeature'
      ? featureChanges.get(row.id) || { row, fields: new Set(), parentBump: false }
      : contributionChanges.get(row.id) || { row, fields: new Set() }
    if (row[target.field] !== PROJECT_FEATURE_ERASURE_REDACTION) change.fields.add(target.field)
    if (target.recordType === 'ProjectFeature') featureChanges.set(row.id, change)
    else contributionChanges.set(row.id, change)
  }
  for (const change of contributionChanges.values()) {
    if (!change.fields.size) continue
    const parent = featureParentForContribution(change.row, parentById)
    const parentChange = featureChanges.get(parent.id) || { row: parent, fields: new Set(), parentBump: false }
    parentChange.parentBump = true
    featureChanges.set(parent.id, parentChange)
  }

  let changedRowCount = 0
  let changedFieldCount = 0
  for (const projectId of projectIds) {
    const projectFeatures = [...featureChanges.values()]
      .filter((change) => change.row.projectId === projectId)
      .sort((a, b) => a.row.id.localeCompare(b.row.id))
    const projectContributions = [...contributionChanges.values()]
      .filter((change) => parentById.get(change.row.featureId)?.projectId === projectId)
      .sort((a, b) => a.row.id.localeCompare(b.row.id))
    await withProjectScope(tx, scopes.get(projectId), initialScope, postgres, async () => {
      for (const change of projectFeatures) {
        if (!change.fields.size && !change.parentBump) continue
        const data = {}
        for (const field of [...change.fields].sort()) data[field] = PROJECT_FEATURE_ERASURE_REDACTION
        data.version = { increment: 1 }
        const updated = await tx.projectFeature.updateMany({
          where: { id: change.row.id, version: change.row.version },
          data,
        })
        if (updated.count !== 1) throw erasureError('PM_ERASURE_VERSION_CONFLICT', 409)
        changedRowCount += 1
        changedFieldCount += change.fields.size
      }
      for (const change of projectContributions) {
        if (!change.fields.size) continue
        const data = {}
        for (const field of [...change.fields].sort()) data[field] = PROJECT_FEATURE_ERASURE_REDACTION
        data.version = { increment: 1 }
        const updated = await tx.featureContribution.updateMany({
          where: { id: change.row.id, version: change.row.version },
          data,
        })
        if (updated.count !== 1) throw erasureError('PM_ERASURE_VERSION_CONFLICT', 409)
        changedRowCount += 1
        changedFieldCount += change.fields.size
      }
    })
  }

  const result = {
    status: 'APPLIED',
    manifestSha256: digest,
    changedRowCount,
    changedFieldCount,
  }
  return {
    ...result,
    audit: {
      ...result,
      reviewerPersonId: value.reviewerPersonId,
      requestId: value.requestId,
      reasonRef: value.reasonRef,
      targets: value.targets,
    },
  }
}

export { FIELD_ALLOWLIST as PROJECT_FEATURE_ERASURE_FIELD_ALLOWLIST }

export default applyReviewedProjectFeatureErasure
