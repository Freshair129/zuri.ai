import { randomUUID } from 'node:crypto'

import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { getLineOaAccount } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { getMarketingContent } from './marketing-content-service'
import {
  assertMarketingReadAccess,
  assertMarketingWriteAccess,
  marketingConflict,
  marketingNotFound,
} from './marketing-authority'
import {
  BROADCAST_DISPATCH_UNAVAILABLE,
  BROADCAST_INTENT_STATUSES,
  broadcastPayloadIdentity,
  parseMarketingBroadcastPayload,
  zMarketingBroadcastActionInput,
  zMarketingBroadcastCreateInput,
  zMarketingBroadcastIntentId,
} from '../domain/marketing-broadcast-contract'

// @req FR-185 — persist Business-scoped LINE broadcast planning identities,
// immutable revisions and owner references without creating a send path.
// @spec FR-157, FR-159, FR-160, FR-103, SEC-001, SEC-003
// @tested tests/integration/marketing-broadcast-intent.test.js,
//   tests/unit/marketing/marketing-broadcast-service.test.js

const ENTITY = 'MARKETING_BROADCAST_INTENT'
const MAX_ROWS = 100

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function principalId(viewer) {
  const id = viewer?.principal?.id
  if (typeof id !== 'string' || !id) throw new Error('Marketing broadcast service requires a resolved viewer principal')
  return id
}

function timestamp(now) {
  const value = typeof now === 'function' ? now() : now
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Marketing broadcast clock returned an invalid date')
  return date
}

function requireDependencies(db) {
  if (!db?.marketingBroadcastIntent || !db?.marketingBroadcastIntentVersion) {
    throw new Error('Marketing broadcast service requires generated Prisma broadcast models')
  }
}

function portsOf(ports = {}) {
  return {
    getLineOaAccount: ports.getLineOaAccount || getLineOaAccount,
    getMarketingContent: ports.getMarketingContent || getMarketingContent,
  }
}

function mapReferenceError(error, code) {
  if (error?.status === 404) return failure(422, code)
  return error
}

async function readReferences(payload, { viewer, businessId, db, ports }) {
  const unavailable = []
  const p = portsOf(ports)

  if (payload.account) {
    try {
      const account = await p.getLineOaAccount(payload.account.lineOaAccountId, { viewer, db })
      if (!account || account.businessId !== businessId || account.status === 'ARCHIVED') {
        unavailable.push('BROADCAST_LINE_ACCOUNT_UNAVAILABLE')
      } else if (account.version !== payload.account.accountVersion) {
        unavailable.push('BROADCAST_LINE_ACCOUNT_VERSION_STALE')
      }
    } catch (error) {
      if (error?.status === 404) unavailable.push('BROADCAST_LINE_ACCOUNT_UNAVAILABLE')
      else throw error
    }
  } else unavailable.push('BROADCAST_LINE_ACCOUNT_UNAVAILABLE')

  try {
    const content = await p.getMarketingContent(
      { viewer, businessId, briefId: payload.content.briefId },
      { db },
    )
    const current = content?.currentVersion
    if (!content || content.businessId !== businessId || current?.id !== payload.content.contentVersionId) {
      unavailable.push('BROADCAST_CONTENT_VERSION_STALE')
    } else if (current.payloadHash !== payload.content.payloadHash) {
      unavailable.push('BROADCAST_CONTENT_HASH_STALE')
    }
  } catch (error) {
    if (error?.status === 404) unavailable.push('BROADCAST_CONTENT_UNAVAILABLE')
    else throw error
  }

  return unavailable.length
    ? { state: 'UNAVAILABLE', reasonCodes: [...new Set(unavailable)] }
    : { state: 'READY', reasonCodes: [] }
}

async function requireReferences(payload, context) {
  const state = await readReferences(payload, context)
  // Only the explicit null-account form is permitted to create an intent with
  // an unavailable LINE account. A supplied account that is missing, hidden,
  // archived or cross-Business is a stale reference and must fail closed.
  const blocking = state.reasonCodes.filter((code) => !(
    payload.account === null && code === 'BROADCAST_LINE_ACCOUNT_UNAVAILABLE'
  ))
  if (blocking.length) throw failure(422, blocking[0])
  return state
}

async function loadIntent(db, id, { includeDeleted = false } = {}) {
  const intent = await db.marketingBroadcastIntent.findUnique({
    where: { id },
    include: { revisions: { orderBy: [{ revision: 'asc' }, { id: 'asc' }] } },
  })
  if (!intent || (!includeDeleted && intent.deletedAt)) return null
  return intent
}

function currentVersion(intent) {
  const revision = intent?.revisions?.find((item) => item.revision === intent.currentRevision)
  if (!revision) throw failure(409, 'BROADCAST_CURRENT_REVISION_MISSING')
  return revision
}

function revisionDto(row) {
  let payload = null
  let state = 'UNAVAILABLE'
  try {
    payload = parseMarketingBroadcastPayload(row.payloadJson, row.payloadHash)
    state = 'READY'
  } catch {
    // A malformed stored artifact is visible as unavailable; it is never
    // repaired by reconstructing a payload from another source.
  }
  return {
    id: row.id,
    revision: row.revision,
    payloadHash: row.payloadHash,
    payload,
    state,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

function intentDto(intent, { canWrite = false, referenceState = null } = {}) {
  const current = currentVersion(intent)
  return {
    readModel: 'MARKETING_BROADCAST_INTENT',
    id: intent.id,
    tenantId: intent.tenantId,
    businessId: intent.businessId,
    code: intent.code,
    status: intent.status,
    currentRevision: intent.currentRevision,
    version: intent.version,
    idempotencyKey: intent.idempotencyKey,
    createdBy: intent.createdBy,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    deletedAt: intent.deletedAt,
    canWrite: canWrite && intent.status === 'PLANNING' && !intent.deletedAt,
    currentVersion: revisionDto(current),
    revisions: (intent.revisions || []).map(revisionDto),
    referenceState: referenceState || { state: 'UNKNOWN', reasonCodes: ['REFERENCE_NOT_RECHECKED'] },
    dispatch: { ...BROADCAST_DISPATCH_UNAVAILABLE },
  }
}

function sameIdempotentRequest(existing, identity, data, actorId) {
  if (!existing || existing.createdBy !== actorId) return false
  if (data.code && data.code !== existing.code) return false
  try {
    // Idempotency identifies the original create request. A later revision is
    // intentionally allowed to change the current payload without changing
    // what a retry of that original request means.
    const initial = existing.revisions?.find((item) => item.revision === 1)
    return initial?.payloadHash === identity.payloadHash
  } catch {
    return false
  }
}

async function referenceStateForIntent(intent, { viewer, businessId, db, ports } = {}) {
  let payload
  try {
    payload = parseMarketingBroadcastPayload(currentVersion(intent).payloadJson, currentVersion(intent).payloadHash)
  } catch {
    return { state: 'UNAVAILABLE', reasonCodes: ['BROADCAST_PAYLOAD_INVALID'] }
  }
  try {
    return await readReferences(payload, { viewer, businessId, db, ports })
  } catch {
    // A timeout or failed owner read is not equivalent to a stale reference.
    return { state: 'UNKNOWN', reasonCodes: ['BROADCAST_REFERENCE_READ_UNKNOWN'] }
  }
}

function generatedCode(id) {
  return `BRD-${String(id).replace(/[^a-z0-9]/gi, '').slice(0, 12).toUpperCase()}`
}

async function withTransaction(db, callback) {
  if (typeof db.$transaction !== 'function') return callback(db)
  return db.$transaction(callback)
}

export async function listMarketingBroadcastIntents({ businessId, viewer } = {}, {
  db = prisma,
  now = () => new Date(),
  ports = {},
} = {}) {
  requireDependencies(db)
  const { scope, canWrite } = await assertMarketingReadAccess({ db, viewer, businessId })
  const generatedAt = timestamp(now).toISOString()
  const rows = await db.marketingBroadcastIntent.findMany({
    where: { tenantId: scope.tenantId, businessId: scope.businessId, deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: MAX_ROWS + 1,
    include: { revisions: { orderBy: [{ revision: 'asc' }, { id: 'asc' }] } },
  })
  const intents = await Promise.all(rows.slice(0, MAX_ROWS).map(async (intent) => {
    const current = intent.revisions?.find((revision) => revision.revision === intent.currentRevision)
    let state = 'UNAVAILABLE'
    if (current) {
      try {
        parseMarketingBroadcastPayload(current.payloadJson, current.payloadHash)
        state = 'READY'
      } catch { /* preserve malformed evidence as unavailable */ }
    }
    const referenceState = current
      ? await referenceStateForIntent(intent, { viewer, businessId: scope.businessId, db, ports })
      : { state: 'UNAVAILABLE', reasonCodes: ['BROADCAST_CURRENT_REVISION_MISSING'] }
    return {
      id: intent.id,
      businessId: intent.businessId,
      code: intent.code,
      status: intent.status,
      currentRevision: intent.currentRevision,
      version: intent.version,
      createdBy: intent.createdBy,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
      state: referenceState.state === 'UNKNOWN' ? 'UNKNOWN' : state === 'READY' && referenceState.state === 'READY' ? 'READY' : 'UNAVAILABLE',
      referenceState,
      dispatch: { ...BROADCAST_DISPATCH_UNAVAILABLE },
    }
  }))
  return {
    readModel: 'MARKETING_BROADCAST_INTENTS',
    schemaVersion: '1.0',
    businessId: scope.businessId,
    generatedAt,
    canWrite,
    intents,
    state: intents.length ? 'READY' : 'EMPTY',
    truncated: rows.length > MAX_ROWS,
  }
}

export async function getMarketingBroadcastIntent({ id, businessId, viewer } = {}, {
  db = prisma,
  now = () => new Date(),
  ports = {},
} = {}) {
  requireDependencies(db)
  const { scope, canWrite } = await assertMarketingReadAccess({ db, viewer, businessId })
  const intentId = zMarketingBroadcastIntentId.parse(id)
  const intent = await loadIntent(db, intentId)
  if (!intent || intent.tenantId !== scope.tenantId || intent.businessId !== scope.businessId) {
    throw marketingNotFound('Marketing broadcast intent not found')
  }
  const referenceState = await referenceStateForIntent(intent, { viewer, businessId: scope.businessId, db, ports })
  return intentDto(intent, { canWrite, referenceState })
}

export async function createMarketingBroadcastIntent(input, {
  viewer,
  db = prisma,
  now = () => new Date(),
  idFactory = randomUUID,
  ports = {},
} = {}) {
  requireDependencies(db)
  const data = zMarketingBroadcastCreateInput.parse(input)
  const actorId = principalId(viewer)
  const identity = broadcastPayloadIdentity(data.payload)
  const at = timestamp(now)
  const id = idFactory()

  try {
    const intent = await withTransaction(db, async (tx) => {
      const { scope } = await assertMarketingWriteAccess({ db: tx, viewer, businessId: data.businessId })
      const existing = await tx.marketingBroadcastIntent.findUnique({ where: { businessId_idempotencyKey: { businessId: scope.businessId, idempotencyKey: data.idempotencyKey } }, include: { revisions: true } })
      if (existing) {
        if (!sameIdempotentRequest(existing, identity, data, actorId)) throw marketingConflict('BROADCAST_INTENT_IDEMPOTENCY_CONFLICT')
        return existing
      }
      await requireReferences(data.payload, { viewer, businessId: scope.businessId, db: tx, ports })
      const created = await tx.marketingBroadcastIntent.create({
        data: {
          id,
          tenantId: scope.tenantId,
          businessId: scope.businessId,
          code: data.code || generatedCode(id),
          status: 'PLANNING',
          currentRevision: 1,
          version: 1,
          idempotencyKey: data.idempotencyKey,
          createdBy: actorId,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
        },
      })
      const revision = await tx.marketingBroadcastIntentVersion.create({
        data: {
          id: idFactory(),
          intentId: created.id,
          revision: 1,
          payloadJson: identity.payloadJson,
          payloadHash: identity.payloadHash,
          createdBy: actorId,
          createdAt: at,
        },
      })
      await recordAudit(tx, {
        entityType: ENTITY,
        entityId: created.id,
        action: 'MARKETING_BROADCAST_INTENT_CREATED',
        actorId,
        payload: {
          tenantId: created.tenantId,
          businessId: created.businessId,
          intentId: created.id,
          revision: revision.revision,
          payloadHash: revision.payloadHash,
          status: created.status,
          version: created.version,
        },
      })
      return tx.marketingBroadcastIntent.findUnique({ where: { id: created.id }, include: { revisions: true } })
    })
    return intentDto(intent, { canWrite: true, referenceState: await referenceStateForIntent(intent, { viewer, businessId: data.businessId, db, ports }) })
  } catch (error) {
    if (error?.code !== 'P2002') throw error
    // The fallback is still an authorized read. Do not use a raced unique-key
    // error to disclose an intent from a hidden Business/Tenant.
    const { scope } = await assertMarketingWriteAccess({ db, viewer, businessId: data.businessId })
    const existing = await db.marketingBroadcastIntent.findUnique({ where: { businessId_idempotencyKey: { businessId: data.businessId, idempotencyKey: data.idempotencyKey } }, include: { revisions: true } })
    if (!existing || existing.tenantId !== scope.tenantId || existing.businessId !== scope.businessId || !sameIdempotentRequest(existing, identity, data, actorId)) throw marketingConflict('BROADCAST_INTENT_IDEMPOTENCY_CONFLICT')
    return intentDto(existing, { canWrite: true, referenceState: await referenceStateForIntent(existing, { viewer, businessId: scope.businessId, db, ports }) })
  }
}

export async function updateMarketingBroadcastIntent(id, input, {
  viewer,
  db = prisma,
  now = () => new Date(),
  idFactory = randomUUID,
  ports = {},
} = {}) {
  requireDependencies(db)
  const intentId = zMarketingBroadcastIntentId.parse(id)
  const data = zMarketingBroadcastActionInput.parse(input)
  const actorId = principalId(viewer)
  const at = timestamp(now)
  const updated = await withTransaction(db, async (tx) => {
    const { scope } = await assertMarketingWriteAccess({ db: tx, viewer, businessId: data.businessId })
    const intent = await loadIntent(tx, intentId)
    if (!intent || intent.tenantId !== scope.tenantId || intent.businessId !== scope.businessId || intent.deletedAt) {
      throw marketingNotFound('Marketing broadcast intent not found')
    }
    if (!BROADCAST_INTENT_STATUSES.includes(intent.status)) throw marketingConflict('BROADCAST_INTENT_STATUS_INVALID')
    if (intent.version !== data.expectedVersion) throw marketingConflict('BROADCAST_INTENT_VERSION_CONFLICT')

    if (data.action === 'revise') {
      if (intent.status === 'ARCHIVED') throw marketingConflict('BROADCAST_INTENT_ARCHIVED')
      const identity = broadcastPayloadIdentity(data.payload)
      await requireReferences(data.payload, { viewer, businessId: scope.businessId, db: tx, ports })
      const revisionNumber = intent.currentRevision + 1
      const result = await tx.marketingBroadcastIntent.updateMany({
        where: { id: intent.id, tenantId: scope.tenantId, businessId: scope.businessId, status: 'PLANNING', deletedAt: null, version: data.expectedVersion },
        data: { currentRevision: revisionNumber, version: { increment: 1 }, updatedAt: at },
      })
      if (result.count !== 1) throw marketingConflict('BROADCAST_INTENT_VERSION_CONFLICT')
      const revision = await tx.marketingBroadcastIntentVersion.create({
        data: { id: idFactory(), intentId: intent.id, revision: revisionNumber, payloadJson: identity.payloadJson, payloadHash: identity.payloadHash, createdBy: actorId, createdAt: at },
      })
      await recordAudit(tx, {
        entityType: ENTITY,
        entityId: intent.id,
        action: 'MARKETING_BROADCAST_INTENT_REVISED',
        actorId,
        payload: { tenantId: scope.tenantId, businessId: scope.businessId, intentId: intent.id, revision: revision.revision, payloadHash: revision.payloadHash, status: 'PLANNING', version: data.expectedVersion + 1 },
      })
    } else {
      const result = await tx.marketingBroadcastIntent.updateMany({
        where: { id: intent.id, tenantId: scope.tenantId, businessId: scope.businessId, status: 'PLANNING', deletedAt: null, version: data.expectedVersion },
        data: { status: 'ARCHIVED', deletedAt: at, version: { increment: 1 }, updatedAt: at },
      })
      if (result.count !== 1) throw marketingConflict('BROADCAST_INTENT_VERSION_CONFLICT')
      await recordAudit(tx, {
        entityType: ENTITY,
        entityId: intent.id,
        action: 'MARKETING_BROADCAST_INTENT_ARCHIVED',
        actorId,
        payload: { tenantId: scope.tenantId, businessId: scope.businessId, intentId: intent.id, revision: intent.currentRevision, payloadHash: currentVersion(intent).payloadHash, status: 'ARCHIVED', version: data.expectedVersion + 1 },
      })
    }
    return loadIntent(tx, intent.id, { includeDeleted: true })
  })
  return intentDto(updated, { canWrite: false, referenceState: await referenceStateForIntent(updated, { viewer, businessId: data.businessId, db, ports }) })
}
