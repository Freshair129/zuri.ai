// @req FR-292 — durable, currently authorized recovery claims, CAS, results and custody.
// @req FR-293 — recovery remains private until supported backup transfer is qualified.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-recovery-custody.test.js
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import prisma from '@/lib/db'
import { AUTH_SESSION_COOKIE, hashSessionToken, requireSessionSecret, verifySessionToken } from '@/modules/identity/auth-service'
import { readRequestCookie } from '@/modules/identity/session-port'
import { createPrivateBusinessObjectStoragePort } from '@/platform/storage/private-business-object-storage'
import { parseRecoveryDescriptor, parseRecoveryRequest, recoveryDescriptorForFile, recoveryError, recoverySha256 } from './managed-blob-recovery-contract'
import { withRecoveryTransaction, lockRecoveryRow, recoveryNow, commitRecoveryFileCAS, RECOVERY_FENCE_ID } from './managed-blob-recovery-repository'
import { createRecoverySpool } from './managed-blob-recovery-spool'
import { recordAudit } from './audit'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const conflict = () => recoveryError(409, 'MANAGED_BLOB_RECOVERY_CONFLICT')
const denied = () => recoveryError(404, 'MANAGED_BLOB_RECOVERY_NOT_FOUND')
const capacity = () => recoveryError(429, 'MANAGED_BLOB_RECOVERY_CAPACITY')
const recordBytes = 48 * 1024
const configHash = (purpose, env) => recoverySha256(JSON.stringify(Object.keys(env)
  .filter(key => key.startsWith(purpose === 'asset' ? 'ZURI_ASSET_' : 'ZURI_KNOWLEDGE_CATALOG_'))
  .sort().map(key => [key, env[key]])))
const descriptorOf = op => JSON.parse(op.expectedJson)
const result = (op, file, availability = 'NOT_CHECKED') => ({ operationId: op.id, state: op.state,
  version: op.version, fileId: op.fileId, ...(op.resultVersion == null ? {} : { fileVersion: op.resultVersion }),
  targetCurrent: op.state === 'COMMITTED' && file?.deletedAt == null && file?.status === 'ACTIVE'
    && file?.version === op.resultVersion && file?.blobRef === JSON.parse(op.receiptJson).ref,
  availability, outcome: op.state === 'STAGING' ? 'IN_PROGRESS' : op.state === 'UNKNOWN' ? 'RECONCILIATION_REQUIRED' : op.state,
  retryable: false, custody: { spoolBytes: op.spoolBytes, unresolved: op.unresolved, cleanup: op.cleanupState } })
const safe = fn => async (...args) => {
  try { return await fn(...args) } catch (error) {
    if (error?.message === 'Recovery request refused') throw error
    throw recoveryError(503, 'MANAGED_BLOB_RECOVERY_UNAVAILABLE')
  }
}

// Internal application composition only. No route, environment toggle, Viewer
// injection, selected-provider retry admission or activation is introduced.
export function createManagedBlobRecoveryService({ db = prisma, env = process.env, dataDirectory, fetchFn } = {}) {
  if (!path.isAbsolute(dataDirectory || '')) throw recoveryError(503, 'MANAGED_BLOB_RECOVERY_UNAVAILABLE')
  const configurationHash = purpose => configHash(purpose, env)
  const spoolRootHash = recoverySha256(path.resolve(dataDirectory))
  const spool = createRecoverySpool(dataDirectory)
  const port = (purpose, maxReadBytes) => createPrivateBusinessObjectStoragePort(purpose, env, { ...(fetchFn ? { fetchFn } : {}), ...(maxReadBytes !== undefined ? { maxReadBytes } : {}) })
  function actor(request) {
    const token = readRequestCookie(request, AUTH_SESSION_COOKIE)
    if (typeof token !== 'string' || token.length > 4096 || token.split('.').length !== 3) throw recoveryError(401, 'AUTH_REQUIRED')
    const identity = verifySessionToken(token, { secret: requireSessionSecret(env) })
    if (!identity?.sessionId) throw recoveryError(401, 'AUTH_REQUIRED')
    return { ...identity, tokenHash: hashSessionToken(token) }
  }
  async function authorized(tx, ctx, identity, fileId, operationId) {
    // Preliminary persisted proof prevents a revoked cookie from learning
    // target existence. This is a denial-only read; action authority is reread
    // below under the adopted native row locks and current database time.
    const earlySession = await tx.session.findUnique({ where: { id: identity.sessionId } })
    const earlyPerson = await tx.person.findUnique({ where: { id: identity.principalId } })
    if (!earlySession || earlySession.personId !== identity.principalId || earlySession.tokenHash !== identity.tokenHash
      || earlySession.status !== 'ACTIVE' || earlySession.revokedAt != null || earlySession.expiresAt <= new Date()
      || !earlyPerson || earlyPerson.accessDisabledAt != null) throw recoveryError(401, 'AUTH_REQUIRED')
    if (!uuid.test(fileId || '') || operationId !== undefined && !uuid.test(operationId || '')) throw denied()
    const op = operationId ? await tx.managedBlobRecoveryOperation.findUnique({ where: { id: operationId } }) : null
    const initialFile = await tx.fileAsset.findUnique({ where: { id: fileId } })
    if (operationId && (!op || op.actorId !== identity.principalId || op.fileId !== fileId)) throw denied()
    const scope = op || initialFile
    if (!scope) throw denied()
    for (const [table, id] of [['Tenant', scope.tenantId], ['Business', scope.businessId], ['Person', identity.principalId]]) {
      await lockRecoveryRow(tx, table, id, ctx.postgres)
    }
    const witnesses = await tx.membership.findMany({ where: { personId: identity.principalId, tenantId: scope.tenantId,
      role: 'OWNER', status: 'ACTIVE', OR: [{ businessId: scope.businessId, scopeType: 'BUSINESS' },
        { businessId: null, scopeType: { in: ['TENANT', 'BUSINESS'] } }] }, orderBy: { id: 'asc' } })
    for (const witness of witnesses) await lockRecoveryRow(tx, 'Membership', witness.id, ctx.postgres)
    await lockRecoveryRow(tx, 'Session', identity.sessionId, ctx.postgres)
    if (op) await lockRecoveryRow(tx, 'ManagedBlobRecoveryOperation', op.id, ctx.postgres)
    await lockRecoveryRow(tx, 'FileAsset', fileId, ctx.postgres)
    const now = await recoveryNow(tx, ctx.postgres)
    const session = await tx.session.findUnique({ where: { id: identity.sessionId } })
    const person = await tx.person.findUnique({ where: { id: identity.principalId } })
    if (!session || session.personId !== identity.principalId || session.tokenHash !== identity.tokenHash
      || session.status !== 'ACTIVE' || session.revokedAt != null || session.expiresAt <= now
      || identity.expiresAt * 1000 <= now.getTime() || !person || person.accessDisabledAt != null) throw recoveryError(401, 'AUTH_REQUIRED')
    const tenant = await tx.tenant.findUnique({ where: { id: scope.tenantId } })
    const business = await tx.business.findUnique({ where: { id: scope.businessId } })
    const current = await tx.membership.findMany({ where: { id: { in: witnesses.map(w => w.id) }, role: 'OWNER', status: 'ACTIVE',
      personId: person.id, tenantId: scope.tenantId, AND: [
        { OR: [{ businessId: scope.businessId, scopeType: 'BUSINESS' }, { businessId: null, scopeType: { in: ['TENANT', 'BUSINESS'] } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ] } })
    if (tenant?.status !== 'ACTIVE' || business?.status !== 'ACTIVE' || business.tenantId !== tenant.id || !current.length) throw denied()
    const file = await tx.fileAsset.findUnique({ where: { id: fileId } })
    if (!file || file.tenantId !== scope.tenantId || file.businessId !== scope.businessId) throw denied()
    return { file, op: op && await tx.managedBlobRecoveryOperation.findUnique({ where: { id: op.id } }), now, ownerWitnessIds: current.map(w => w.id) }
  }
  const transaction = (args, fn) => {
    const identity = actor(args.request)
    return withRecoveryTransaction(db, async (tx, ctx) => fn(tx, ctx,
      await authorized(tx, ctx, identity, args.fileId, args.operationId), identity))
  }
  const live = (op, ctx, now) => {
    if (op.generation !== ctx.fence.generation || op.spoolRootHash !== spoolRootHash || op.configHash !== configurationHash(descriptorOf(op).purpose)) throw conflict()
    if (op.expiresAt <= now) throw recoveryError(410, 'MANAGED_BLOB_RECOVERY_EXPIRED')
  }
  const binding = (op, input) => {
    const digest = recoverySha256(input.confirmationBinding)
    if (!op.confirmationDigest || !timingSafeEqual(Buffer.from(digest), Buffer.from(op.confirmationDigest))) throw conflict()
  }
  async function save(tx, op, patch) {
    if (Buffer.byteLength(JSON.stringify({ ...op, ...patch })) > 16 * 1024) throw recoveryError(503)
    const changed = await tx.managedBlobRecoveryOperation.updateMany({ where: { id: op.id, version: op.version },
      data: { ...patch, version: { increment: 1 } } })
    if (changed.count !== 1) throw conflict()
    return tx.managedBlobRecoveryOperation.findUnique({ where: { id: op.id } })
  }
  async function audit(tx, op, action) {
    if (op.auditCount >= 16 || !['COMMITTED', 'CLOSED'].includes(action) && op.auditCount >= 14) throw capacity()
    await recordAudit(tx, { entityType: 'MANAGED_BLOB_RECOVERY', entityId: op.id, action,
      actorId: op.actorId, tenantId: op.tenantId, businessId: op.businessId,
      payload: { fileId: op.fileId, state: op.state } })
    await tx.managedBlobRecoveryOperation.update({ where: { id: op.id }, data: { auditCount: { increment: 1 } } })
  }
  const sameFile = (op, file) => {
    const current = recoveryDescriptorForFile(file), expected = descriptorOf(op)
    if (Object.keys(expected).some(key => current[key] !== expected[key])) throw conflict()
  }
  const receipt = (op, value) => {
    const d = descriptorOf(op)
    if (!value || Object.keys(value).sort().join(',') !== 'byteLength,ref,sha256'
      || value.sha256 !== d.sha256 || value.byteLength !== d.byteLength || typeof value.ref !== 'string' || value.ref.length > 8192) throw conflict()
    port(d.purpose).validateRef({ ref: value.ref, tenantId: op.tenantId, businessId: op.businessId })
    // The owned key, not merely the scope, is the receipt binding.
    const key = value.ref.split('/').slice(4).join('/').split('?')[0].split('/').map(decodeURIComponent).join('/')
    if (key !== op.destinationKey) throw conflict()
    return JSON.stringify(value)
  }
  const api = {
    prepare: safe(async args => {
      const input = parseRecoveryRequest('prepare', args.input)
      return transaction(args, async (tx, ctx, { file, now }, identity) => {
        if (file.version !== input.expectedVersion) throw conflict()
        const descriptor = recoveryDescriptorForFile(file)
        port(descriptor.purpose).validateRef({ ref: file.blobRef, tenantId: file.tenantId, businessId: file.businessId })
        const unresolved = await tx.managedBlobRecoveryOperation.findMany({ where: { unresolved: true }, select: { actorId: true, businessId: true } })
        const retained = await tx.managedBlobRecoveryOperation.aggregate({ where: { businessId: file.businessId }, _sum: { reservedBytes: true, auditCount: true } })
        const retainedAudit = await tx.auditEvent.count({ where: { entityType: 'MANAGED_BLOB_RECOVERY', businessId: file.businessId } })
        const businessBytes = (retained._sum.reservedBytes || 0) + (retainedAudit - (retained._sum.auditCount || 0)) * 2048
        if (unresolved.length >= 64 || unresolved.filter(op => op.actorId === identity.principalId).length >= 2
          || unresolved.filter(op => op.businessId === file.businessId).length >= 8
          || ctx.fence.retainedBytes + recordBytes > 512 * 1024 * 1024 || businessBytes + recordBytes > 128 * 1024 * 1024) throw capacity()
        const id = randomUUID(), op = await tx.managedBlobRecoveryOperation.create({ data: {
          id, actorId: identity.principalId, tenantId: file.tenantId, businessId: file.businessId, fileId: file.id,
          expectedJson: JSON.stringify(descriptor), configHash: configurationHash(descriptor.purpose), spoolRootHash, generation: ctx.fence.generation,
          destinationKey: `${descriptor.purpose === 'asset' ? 'asset-evidence' : 'business-catalog'}/${file.tenantId}/${file.businessId}/recovery/${id}/${randomBytes(32).toString('hex')}`,
          expiresAt: new Date(now.getTime() + 15 * 60000), byteDeadline: new Date(now.getTime() + 24 * 3600000),
        } })
        await tx.managedBlobRecoveryInstallationFence.update({ where: { id: RECOVERY_FENCE_ID }, data: { retainedBytes: { increment: recordBytes } } })
        return { operationId: op.id, version: op.version, state: op.state, descriptor, expiresAt: op.expiresAt.toISOString() }
      })
    }),
    preview: safe(async args => {
      const supplied = parseRecoveryDescriptor(args.descriptor)
      const claim = await transaction(args, async (tx, ctx, { file, op, now }) => {
        live(op, ctx, now); sameFile(op, file)
        if (!['PREPARED', 'PREVIEWED'].includes(op.state)) throw conflict()
        if (Object.keys(supplied).some(key => supplied[key] !== descriptorOf(op)[key])) throw conflict()
        // Re-preview is permitted only after exact spool release, never by
        // replacing an existing private file under an earlier binding.
        if (op.spoolId || op.spoolBytes) throw conflict()
        const total = await tx.managedBlobRecoveryOperation.aggregate({ _sum: { spoolBytes: true } })
        if ((total._sum.spoolBytes || 0) + supplied.byteLength > 256 * 1024 * 1024) throw capacity()
        return save(tx, op, { state: 'PREVIEWING', spoolId: randomUUID(), spoolBytes: supplied.byteLength,
          workerId: randomUUID(), epoch: op.epoch + 1, leaseExpiresAt: new Date(Math.min(now.getTime() + 30000, op.expiresAt.getTime())) })
      })
      try {
        return await spool.write(claim.spoolId, supplied, args.chunks, { signal: args.signal, deadline: claim.leaseExpiresAt.getTime(), commit: promote => transaction(args, async (tx, ctx, { op, now }) => {
          live(op, ctx, now)
          if (op.state !== 'PREVIEWING' || op.epoch !== claim.epoch || op.workerId !== claim.workerId || op.leaseExpiresAt <= now) throw conflict()
          await promote()
          const confirmationBinding = randomBytes(32).toString('base64url')
          const saved = await save(tx, op, { state: 'PREVIEWED', confirmationDigest: recoverySha256(confirmationBinding), workerId: null, leaseExpiresAt: null })
          return { operationId: op.id, state: saved.state, version: saved.version, confirmationBinding }
        }) })
      } catch (error) {
        // Stream has closed. Settle only this worker's custody, even if its
        // owner was revoked mid-stream. This confers no read/attach authority.
        await withRecoveryTransaction(db, async (tx, ctx) => {
          const op = await tx.managedBlobRecoveryOperation.findUnique({ where: { id: claim.id } })
          if (op?.workerId === claim.workerId && op.generation === ctx.fence.generation && ['PREVIEWING', 'ABANDONED'].includes(op.state)) {
            await save(tx, op, { state: 'ABANDONED', epoch: op.epoch + 1, leaseExpiresAt: null, workerId: null, cleanupState: 'SPOOL_PENDING' })
          }
        }).catch(() => {})
        throw error
      }
    }),
    stage: safe(async args => {
      const input = parseRecoveryRequest('stage', args.input)
      const claim = await transaction(args, async (tx, ctx, { op, file, now }) => {
        live(op, ctx, now); binding(op, input); sameFile(op, file)
        if (op.state === 'STAGING' || op.state === 'UNKNOWN') return { pending: result(op, file) }
        if (op.state !== 'PREVIEWED' || op.version !== input.expectedOperationVersion || op.attempts !== 0 || !op.spoolId) throw conflict()
        return save(tx, op, { state: 'STAGING', attempts: 1, workerId: randomUUID(), epoch: op.epoch + 1,
          leaseExpiresAt: new Date(Math.min(now.getTime() + 30000, op.expiresAt.getTime())) })
      })
      if (claim.pending) return claim.pending
      try {
      let stored
      try {
        const d = descriptorOf(claim), content = await spool.read(claim.spoolId, d)
        // Attempt identity is committed before this single PUT. Neither DB
        // retry nor UNKNOWN handling repeats it without qualified provider proof.
        stored = await port(d.purpose).put({ key: claim.destinationKey, content })
        receipt(claim, stored)
        await port(d.purpose, d.byteLength).get({ ref: stored.ref, tenantId: claim.tenantId, businessId: claim.businessId,
          expectedSha256: d.sha256, expectedByteLength: d.byteLength })
      } catch {
        return await transaction(args, async (tx, ctx, { op, file }) => {
          if (op.state === 'STAGING' && op.epoch === claim.epoch) op = await save(tx, op, { state: 'UNKNOWN', cleanupState: 'RECONCILIATION_REQUIRED', workerId: null, leaseExpiresAt: null })
          return result(op, file)
        })
      }
      return await transaction(args, async (tx, ctx, { op, file, now }) => {
        if (op.state !== 'STAGING' || op.epoch !== claim.epoch || op.workerId !== claim.workerId) throw conflict()
        if (op.leaseExpiresAt <= now || op.expiresAt <= now) {
          return result(await save(tx, op, { state: 'UNKNOWN', cleanupState: 'RECONCILIATION_REQUIRED', workerId: null, leaseExpiresAt: null }), file)
        }
        live(op, ctx, now)
        return result(await save(tx, op, { state: 'STAGED', receiptJson: receipt(op, stored), workerId: null, leaseExpiresAt: null }), file)
      })
      } finally {
        // This worker's local IO has settled. Record custody even after actor
        // revocation; this bounded bookkeeping cannot grant STAGED/attachment.
        await withRecoveryTransaction(db, async (tx, ctx) => {
          const op = await tx.managedBlobRecoveryOperation.findUnique({ where: { id: claim.id } })
          if (op?.workerId !== claim.workerId || op.generation !== ctx.fence.generation) return
          await save(tx, op, { state: op.state === 'STAGING' ? 'UNKNOWN' : op.state, workerId: null, leaseExpiresAt: null,
            cleanupState: op.state === 'STAGING' ? 'RECONCILIATION_REQUIRED' : op.cleanupState })
        }).catch(() => {})
      }
    }),
    confirm: safe(async args => {
      const input = parseRecoveryRequest('confirm', args.input)
      const committed = await transaction(args, async (tx, ctx, { op, file, now, ownerWitnessIds }, identity) => {
        live(op, ctx, now); binding(op, input)
        if (op.state === 'COMMITTED') return { op, file }
        if (op.state !== 'STAGED' || op.cleanupState !== 'NONE' || op.version !== input.expectedOperationVersion) throw conflict()
        sameFile(op, file)
        const d = descriptorOf(op), stored = JSON.parse(op.receiptJson)
        receipt(op, stored)
        // Include every persisted eligibility/scope/content predicate. Locks
        // also conflict with existing writers that do not increment version.
        const changed = await commitRecoveryFileCAS(tx, { file, descriptor: d, ref: stored.ref, identity, witnessIds: ownerWitnessIds }, ctx.postgres)
        if (changed !== 1) throw conflict()
        const saved = await save(tx, op, { state: 'COMMITTED', resultVersion: d.fileVersion + 1, closedAt: now })
        await audit(tx, saved, 'COMMITTED')
        return { op: saved, file: await tx.fileAsset.findUnique({ where: { id: file.id } }) }
      })
      let availability = 'VERIFIED'
      const d = descriptorOf(committed.op), stored = JSON.parse(committed.op.receiptJson)
      try { await port(d.purpose, d.byteLength).get({ ref: stored.ref, tenantId: d.tenantId, businessId: d.businessId,
        expectedSha256: d.sha256, expectedByteLength: d.byteLength }) } catch { availability = 'RECOVERY_REQUIRED' }
      // Availability is an observation; never undo a committed tuple or audit.
      return transaction(args, async (tx, ctx, { op, file }) => {
        if (op.availability !== availability) op = await save(tx, op, { availability })
        return result(op, file, availability)
      })
    }),
    status: safe(args => transaction(args, async (tx, ctx, { op, file, now }) => {
      if (op.generation === ctx.fence.generation && op.state === 'STAGING' && op.leaseExpiresAt <= now) {
        op = await save(tx, op, { state: 'UNKNOWN', epoch: op.epoch + 1, cleanupState: 'RECONCILIATION_REQUIRED' })
      }
      return result(op, file)
    })),
    inspect: safe(async args => {
      parseRecoveryRequest('inspect', args.input)
      const claim = await transaction(args, async (tx, ctx, { op, file, now }) => {
        if (op.generation !== ctx.fence.generation || op.spoolRootHash !== spoolRootHash || op.configHash !== configurationHash(descriptorOf(op).purpose)) throw conflict()
        if (op.state === 'STAGING' && op.leaseExpiresAt <= now) op = await save(tx, op, { state: 'UNKNOWN', epoch: op.epoch + 1, cleanupState: 'RECONCILIATION_REQUIRED' })
        if (op.state !== 'UNKNOWN') return { done: result(op, file) }
        return op
      })
      if (claim.done) return claim.done
      const d = descriptorOf(claim)
      let found
      try { found = await port(d.purpose, d.byteLength).recover({ key: claim.destinationKey, tenantId: d.tenantId, businessId: d.businessId,
        expectedSha256: d.sha256, expectedByteLength: d.byteLength }) } catch { found = null }
      return transaction(args, async (tx, ctx, { op, file }) => {
        if (op.state !== 'UNKNOWN' || op.epoch !== claim.epoch || op.generation !== ctx.fence.generation) throw conflict()
        if (found) op = await save(tx, op, { state: 'STAGED', receiptJson: receipt(op, found), cleanupState: 'NONE', epoch: op.epoch + 1, workerId: null, leaseExpiresAt: null })
        // A negative/failed HEAD never proves a possibly in-flight PUT failed.
        return result(op, file)
      })
    }),
    abandon: safe(args => {
      const input = parseRecoveryRequest('abandon', args.input)
      return transaction(args, async (tx, ctx, { op, file }) => {
        if (op.generation !== ctx.fence.generation || op.version !== input.expectedOperationVersion || op.state === 'COMMITTED') throw conflict()
        // Provider deletion stays disabled until every attachment writer and
        // exact-version cleanup race is qualified; no source ref is ever erased.
        op = await save(tx, op, { state: 'ABANDONED', epoch: op.epoch + 1, cleanupState: op.attempts ? 'CLEANUP_PENDING' : 'SPOOL_PENDING' })
        return result(op, file)
      })
    }),
    cleanup: safe(async args => {
      const claim = await transaction(args, async (tx, ctx, { op }) => {
        if (op.generation !== ctx.fence.generation || op.spoolRootHash !== spoolRootHash || !['COMMITTED', 'ABANDONED'].includes(op.state)) throw conflict()
        // PREVIEWING/STAGING workers may still be alive after expiry. Never
        // release their quota on a missing file or infer that IO has stopped.
        if (op.leaseExpiresAt != null) throw conflict()
        return op
      })
      if (claim.spoolId) await spool.remove(claim.spoolId)
      return transaction(args, async (tx, ctx, { op, file, now }) => {
        if (op.version !== claim.version || op.generation !== ctx.fence.generation) throw conflict()
        const pending = op.state !== 'COMMITTED' && op.attempts > 0
        if (!pending && op.unresolved) {
          await audit(tx, op, 'CLOSED')
          op = await tx.managedBlobRecoveryOperation.findUnique({ where: { id: op.id } })
        }
        const retainedBytes = pending ? op.reservedBytes : 16 * 1024 + op.auditCount * 2048
        const release = op.reservedBytes - retainedBytes
        op = await save(tx, op, { spoolBytes: 0, spoolId: null, unresolved: pending,
          reservedBytes: retainedBytes,
          cleanupState: pending ? 'CLEANUP_PENDING' : 'NONE', closedAt: pending ? null : now,
          confirmationDigest: op.expiresAt <= now ? null : op.confirmationDigest })
        if (release > 0) await tx.managedBlobRecoveryInstallationFence.update({ where: { id: RECOVERY_FENCE_ID }, data: { retainedBytes: { decrement: release } } })
        return result(op, file)
      })
    }),
    // Internal maintenance is a custody policy, never a Business-read bypass.
    // It performs no provider deletion or FileAsset write. Each pass is bounded
    // to the installation's 64 unresolved operations / 64 expired results.
    maintain: safe(async () => {
      const claims = await withRecoveryTransaction(db, async (tx, ctx) => {
        const now = await recoveryNow(tx, ctx.postgres)
        const rows = await tx.managedBlobRecoveryOperation.findMany({ where: { generation: ctx.fence.generation,
          spoolRootHash,
          spoolId: { not: null }, byteDeadline: { lte: now } }, take: 64, orderBy: { id: 'asc' } })
        const claims = []
        for (const op of rows) claims.push(await save(tx, op, { state: op.state === 'COMMITTED' ? 'COMMITTED' : 'ABANDONED',
          epoch: op.epoch + 1, confirmationDigest: null, cleanupState: 'SPOOL_PENDING' }))
        return claims
      })
      let deletedSpools = 0
      for (const claim of claims) {
        try { await spool.remove(claim.spoolId) } catch { continue }
        await withRecoveryTransaction(db, async (tx, ctx) => {
          let op = await tx.managedBlobRecoveryOperation.findUnique({ where: { id: claim.id } })
          if (!op || op.version !== claim.version || op.generation !== ctx.fence.generation) return
          // Expired lease does not prove the worker stopped. Unlink only exact
          // owned names; retain reservation/intent until that worker settles.
          if (op.workerId != null) { await save(tx, op, { cleanupState: 'RECONCILIATION_REQUIRED' }); return }
          const pending = op.attempts > 0 && op.state !== 'COMMITTED'
          if (!pending && op.unresolved) {
            await audit(tx, op, 'CLOSED')
            op = await tx.managedBlobRecoveryOperation.findUnique({ where: { id: op.id } })
          }
          const retained = pending ? op.reservedBytes : 16384 + op.auditCount * 2048
          await save(tx, op, { spoolId: null, spoolBytes: 0, unresolved: pending,
            cleanupState: pending ? 'CLEANUP_PENDING' : 'NONE', reservedBytes: retained,
            closedAt: pending ? null : await recoveryNow(tx, ctx.postgres) })
          if (op.reservedBytes > retained) await tx.managedBlobRecoveryInstallationFence.update({ where: { id: RECOVERY_FENCE_ID },
            data: { retainedBytes: { decrement: op.reservedBytes - retained } } })
          deletedSpools++
        })
      }
      const deletedRecords = await withRecoveryTransaction(db, async (tx, ctx) => {
        const cutoff = new Date((await recoveryNow(tx, ctx.postgres)).getTime() - 30 * 86400000)
        const rows = await tx.managedBlobRecoveryOperation.findMany({ where: { generation: ctx.fence.generation,
          unresolved: false, spoolId: null, closedAt: { lte: cutoff } }, take: 64, orderBy: { id: 'asc' } })
        for (const op of rows) {
          await tx.managedBlobRecoveryOperation.delete({ where: { id: op.id } })
          await tx.managedBlobRecoveryInstallationFence.update({ where: { id: RECOVERY_FENCE_ID },
            data: { retainedBytes: { decrement: op.reservedBytes - op.auditCount * 2048 } } })
        }
        // Retained immutable audits remain charged globally and per Business,
        // even after result deletion. Never erase evidence to admit new work.
        return rows.length
      })
      return { deletedSpools, deletedRecords }
    }),
  }
  return Object.freeze(api)
}
