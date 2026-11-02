// @req FR-293 — PM-owned, bounded export/preview/confirm with target-local custody.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import prisma from '@/lib/db'
import { createPrivateBusinessObjectStoragePort, parseBusinessObjectRef } from '@/platform/storage/private-business-object-storage'
import { AUTH_SESSION_COOKIE, hashSessionToken, verifySessionToken } from '@/modules/identity/auth-service'
import { readRequestCookie } from '@/modules/identity/session-port'
import { assertOperator } from '@/modules/identity/operator-use'
import { canonicalJSON } from './handoff-contract'
import { extractSnapshot, previewImport, importSnapshot, completeManagedBlobTransferPostpass,
  assertManagedBlobTransferRetentionSafe, normalizeManagedBlobTransferRemounts } from './backup-service'
import { buildManagedBlobTransferPayload, decodeManagedBlobTransfer, encodeManagedBlobTransfer,
  listManagedBlobTransferSources } from './managed-blob-transfer-contract'
import { createManagedBlobTransferSpool } from './managed-blob-transfer-spool'
import { runManagedBlobTransferProviderCall } from './managed-blob-transfer-io'
import { MANAGED_BLOB_TRANSFER_CODEC_PROFILE, MANAGED_BLOB_TRANSFER_PROFILE,
  managedBlobTransferConfigHash, managedBlobTransferSourceRevision } from './managed-blob-transfer-profile'
import { managedBlobTransferTestTargetFingerprint } from './managed-blob-transfer-test-admission'
import { createManagedBlobTransferSnapshotPermit, createManagedBlobTransferImportPermit,
  assertManagedBlobTransferOperator } from './managed-blob-transfer-authority'
import { beginManagedBlobTransferRestore, assertTransferReady, reserveTransferPayload,
  resumeManagedBlobTransferRestore, MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS,
  transferJobDTO, updateTransferJob, withManagedBlobTransferTransaction } from './managed-blob-transfer-repository'
import { recordAudit } from './audit'

const digest = value => createHash('sha256').update(value).digest('hex')
const unavailable = (status = 503, code = 'MANAGED_BLOB_TRANSFER_UNAVAILABLE') =>
  Object.assign(new Error('Managed blob transfer refused'), { status, code })
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const nowDate = clock => new Date(clock())
const codecProfile = MANAGED_BLOB_TRANSFER_CODEC_PROFILE
const jobDeadline = job => {
  if (job.kind === 'RESTORE' && job.restoreClaimedAt) {
    return job.restoreClaimedAt.getTime() + MANAGED_BLOB_TRANSFER_PROFILE.jobDurationMs
  }
  const startedAt = job.kind === 'EXPORT' && job.workerStartedAt ? job.workerStartedAt : job.createdAt
  return Math.min(startedAt.getTime() + MANAGED_BLOB_TRANSFER_PROFILE.jobDurationMs, job.byteDeadline.getTime())
}

function requireTransferDirectory(value) {
  if (!path.isAbsolute(value || '')) throw unavailable(503, 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE')
  return path.resolve(value)
}

function safeFailure(error) {
  if (Number.isInteger(error?.status) && typeof error?.code === 'string' && /^MANAGED_BLOB_TRANSFER_|^AUTH_REQUIRED$|^CSRF_INVALID$/.test(error.code)) return error
  return unavailable(error?.status === 413 ? 413 : error?.status === 400 ? 400 : 503,
    error?.status === 413 ? 'MANAGED_BLOB_TRANSFER_TOO_LARGE' : error?.status === 400 ? 'MANAGED_BLOB_TRANSFER_INVALID' : 'MANAGED_BLOB_TRANSFER_UNAVAILABLE')
}

function validJobId(id) { return typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id) }

function confirmationDigest(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null
  return digest(Buffer.from(value, 'base64url'))
}

function sameDigest(left, right) {
  if (!isHash(left) || !isHash(right)) return false
  const a = Buffer.from(left, 'hex'), b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

function jobCounts(snapshot, preview = null) {
  const tables = snapshot?.tables || {}
  return {
    snapshotRows: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : 0])),
    wouldReplace: preview?.wouldReplace === true,
    localFileRestore: preview ? { mountRequiredBusinessIds: preview.mountRequiredBusinessIds || [],
      missingContentFiles: preview.missingContentFileIds?.length || 0 } : null,
    transferEntries: 0,
    originalBytes: 0,
    packageBytes: 0,
  }
}

function transferCounts(snapshot, manifest, packageBytes, preview = null) {
  return { ...jobCounts(snapshot, preview), transferEntries: manifest.entryCount,
    originalBytes: manifest.totalOriginalBytes, packageBytes }
}

function makeTargetKey(entryId, entry) {
  const binding = entry.bindings[0]
  const namespace = entry.purpose === 'asset' ? 'asset-evidence' : 'business-catalog'
  return `${namespace}/${binding.tenantId}/${binding.businessId}/recovery/${entryId}/${entry.sha256}`
}

function targetSnapshotWithRefs(decoded, entryRows) {
  const snapshot = structuredClone(decoded.snapshot)
  const rowsByModel = { fileAsset: new Map(), projectFile: new Map() }
  for (const model of ['fileAsset', 'projectFile']) {
    for (const row of snapshot.tables[model] || []) rowsByModel[model].set(row.id, row)
  }
  for (const entryRow of entryRows) {
    const ref = entryRow.targetRef
    if (!ref || entryRow.state !== 'VERIFIED') throw unavailable(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
    const bindings = JSON.parse(entryRow.bindingsJson)
    for (const binding of bindings) {
      const row = rowsByModel[binding.model]?.get(binding.id)
      if (!row || digest(Buffer.from(canonicalJSON(row))) !== binding.sourceRowSha256
        || digest(Buffer.from(String(row.blobRef))) !== binding.sourceRefSha256) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_PACKAGE_CHANGED')
      row.blobRef = ref
    }
  }
  return snapshot
}

export function createManagedBlobBackupTransferService({ db = prisma, env = process.env, dataDirectory,
  storageFactory = (purpose, maxReadBytes) => createPrivateBusinessObjectStoragePort(purpose, env, { maxReadBytes }), sourceRevision,
  testAdmission = null, clock = () => Date.now(), uploadDeadlineMs = 120_000, spool: suppliedSpool } = {}) {
  const root = requireTransferDirectory(dataDirectory)
  const spool = suppliedSpool || createManagedBlobTransferSpool(root)
  const runningExports = new Map()
  const revision = typeof sourceRevision === 'function' ? sourceRevision
    : () => sourceRevision ?? managedBlobTransferSourceRevision(env)

  async function operatorProof({ request, viewer, session }) {
    assertOperator(viewer, 'Installation operator authority is required')
    const actorId = viewer?.principal?.id
    const token = readRequestCookie(request, AUTH_SESSION_COOKIE)
    const verified = token && verifySessionToken(token, { secret: env.ZURI_SESSION_SECRET, now: clock() })
    if (!actorId || !session || session.state !== 'AUTHENTICATED' || session.sessionId?.startsWith('legacy-')
      || !verified?.sessionId || verified.sessionId !== session.sessionId || verified.principalId !== actorId) {
      throw unavailable(401, 'AUTH_REQUIRED')
    }
    const tokenHash = hashSessionToken(token), now = nowDate(clock)
    const [persisted, grant, person] = await Promise.all([
      db.session.findUnique({ where: { id: verified.sessionId } }),
      db.platformGrant.findFirst({ where: { personId: actorId, capability: 'OPERATOR', status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { createdAt: 'asc' } }),
      db.person.findUnique({ where: { id: actorId }, select: { accessDisabledAt: true } }),
    ])
    if (!persisted || persisted.personId !== actorId || persisted.tokenHash !== tokenHash || persisted.status !== 'ACTIVE'
      || persisted.revokedAt || persisted.expiresAt <= now || !grant || !person || person.accessDisabledAt) {
      throw unavailable(401, 'AUTH_REQUIRED')
    }
    return { actorId, sessionId: verified.sessionId, tokenHash, tokenExpiresAt: verified.expiresAt * 1000, grantId: grant.id }
  }

  async function findJob(jobId, actorId) {
    if (!validJobId(jobId)) throw unavailable(404, 'MANAGED_BLOB_TRANSFER_NOT_FOUND')
    const job = await db.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
    if (!job || job.actorId !== actorId) throw unavailable(404, 'MANAGED_BLOB_TRANSFER_NOT_FOUND')
    return job
  }

  async function closeUnwrittenJob(jobId, actorId, desiredState = 'FAILED') {
    let removed = false
    try { await spool.remove(jobId); removed = true } catch { /* preserve reservation and unresolved custody */ }
    return withManagedBlobTransferTransaction(db, async tx => {
      const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
      if (!job || job.actorId !== actorId) return null
      const next = await updateTransferJob(tx, job, {
        state: removed ? desiredState : 'UNKNOWN', unresolved: !removed,
        spoolId: removed ? null : job.spoolId, spoolBytes: removed ? 0 : job.spoolBytes,
        spoolSha256: removed ? null : job.spoolSha256,
        spoolReservedBytes: removed ? 0 : job.spoolReservedBytes,
        snapshotSpoolBytes: removed ? 0 : job.snapshotSpoolBytes,
        confirmationDigest: removed ? null : job.confirmationDigest,
        workerId: null, leaseExpiresAt: null,
        closedAt: removed ? nowDate(clock) : null,
        outcomeJson: JSON.stringify({ outcome: removed ? desiredState : 'CLEANUP_REQUIRED' }),
      })
      return next
    })
  }

  async function clearCompletedPackage(jobId) {
    try {
      await spool.remove(jobId)
      return await withManagedBlobTransferTransaction(db, async tx => {
        const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
        if (!job || job.state !== 'NEEDS_ADMISSION' || job.spoolId !== jobId) return job
        return updateTransferJob(tx, job, { spoolId: null, spoolSha256: null, spoolBytes: 0,
          spoolReservedBytes: 0, restoreRemountsJson: null, outcomeJson: JSON.stringify({ outcome: 'RESTORED_NEEDS_ADMISSION',
            postpass: 'COMPLETE', cleanup: 'COMPLETE' }) })
      })
    } catch {
      return db.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
    }
  }

  async function beginExport({ request, viewer, session, includeBinaryContent = false, expectedGeneration }) {
    const proof = await operatorProof({ request, viewer, session })
    const configHash = managedBlobTransferConfigHash(env), sourceCommit = revision()
    if (!/^[a-f0-9]{40}$/.test(sourceCommit || '')) throw unavailable(503, 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE')
    const id = randomUUID(), createdAt = nowDate(clock)
    const setup = await withManagedBlobTransferTransaction(db, async (tx, { fence }) => {
      await assertTransferReady(tx, fence, { expectedGeneration })
      let job = await tx.managedBlobBackupTransferJob.create({ data: {
        id, actorId: proof.actorId, kind: 'EXPORT', state: 'PREPARED', generation: fence.generation,
        sourceGeneration: fence.generation, sourceConfigHash: configHash, targetConfigHash: configHash,
        sourceRevision: sourceCommit, expiresAt: new Date(createdAt.getTime() + MANAGED_BLOB_TRANSFER_PROFILE.confirmationTtlMs),
        byteDeadline: new Date(createdAt.getTime() + MANAGED_BLOB_TRANSFER_PROFILE.byteRetentionMs),
        workerId: randomUUID(), leaseExpiresAt: new Date(createdAt.getTime() + MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS),
        reservedBytes: 0, unresolved: true,
      } })
      job = await reserveTransferPayload(tx, job.id, MANAGED_BLOB_TRANSFER_PROFILE.maxPackageBytes, MANAGED_BLOB_TRANSFER_PROFILE.spoolQuotaBytes)
      await recordAudit(tx, { entityType: 'OPERATOR_ACTION', entityId: 'local', action: 'BACKUP_EXPORT',
        actorId: proof.actorId, payload: { transferJobId: id, generation: fence.generation, includeBinaryContent } })
      const permit = createManagedBlobTransferSnapshotPermit(job.id)
      const snapshot = await extractSnapshot({ db: tx, includeBinaryContent, transferPermit: permit })
      const sources = buildSourceList(snapshot)
      if (!sources.length || sources.length > codecProfile.maxEntries) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_REQUIRED')
      const snapshotBytes = Buffer.from(canonicalJSON(snapshot))
      if (snapshotBytes.length > codecProfile.maxSnapshotBytes) throw unavailable(413, 'MANAGED_BLOB_TRANSFER_TOO_LARGE')
      job = await updateTransferJob(tx, job, { snapshotSha256: digest(snapshotBytes), countsJson: JSON.stringify(jobCounts(snapshot)), sourceRevision: sourceCommit })
      return { job, snapshotBytes, sourceGeneration: fence.generation, configHash, proof }
    })
    try {
      const snapshotReceipt = await spool.write(id, [setup.snapshotBytes], { artifact: 'snapshot',
        maxBytes: codecProfile.maxSnapshotBytes, deadline: setup.job.byteDeadline.getTime() })
      if (!sameDigest(snapshotReceipt.sha256, setup.job.snapshotSha256)) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_PACKAGE_CHANGED')
      const workerId = setup.job.workerId
      const job = await withManagedBlobTransferTransaction(db, async tx => {
        const current = await tx.managedBlobBackupTransferJob.findUnique({ where: { id } })
        if (!current || current.state !== 'PREPARED' || current.workerId !== workerId) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
        return updateTransferJob(tx, current, { state: 'COPYING', snapshotSpoolBytes: snapshotReceipt.byteLength,
          workerStartedAt: nowDate(clock), epoch: { increment: 1 },
          leaseExpiresAt: new Date(clock() + MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS) })
      })
      return { job }
    } catch (error) {
      await closeUnwrittenJob(id, proof.actorId).catch(() => {})
      throw error
    }
  }

  function buildSourceList(snapshot) {
    // Kept lazy to make every package producer pass the same strict codec inventory.
    return listManagedBlobTransferSources(snapshot)
  }

  async function assertExportWorker(jobId, workerId, epoch) {
    const job = await db.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
    const deadlineAt = job ? jobDeadline(job) : 0
    if (!job || job.kind !== 'EXPORT' || job.state !== 'COPYING' || job.workerId !== workerId || job.epoch !== epoch
      || clock() >= deadlineAt || !job.leaseExpiresAt || job.leaseExpiresAt <= nowDate(clock)) {
      throw unavailable(409, job && clock() >= deadlineAt
        ? 'MANAGED_BLOB_TRANSFER_JOB_DURATION_EXCEEDED' : 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
    }
    const now = nowDate(clock)
    const [grant, person] = await Promise.all([
      db.platformGrant.findFirst({ where: { personId: job.actorId, capability: 'OPERATOR', status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true } }),
      db.person.findUnique({ where: { id: job.actorId }, select: { accessDisabledAt: true } }),
    ])
    if (!grant || !person || person.accessDisabledAt) throw unavailable(401, 'AUTH_REQUIRED')
    return job
  }

  function startExportHeartbeat(job) {
    let stopped = false, lost = false
    const deadlineAt = jobDeadline(job)
    const beat = async () => {
      if (stopped || lost) return
      if (clock() >= deadlineAt) { lost = true; return }
      try {
        const renewed = await db.managedBlobBackupTransferJob.updateMany({ where: { id: job.id, state: 'COPYING',
          workerId: job.workerId, epoch: job.epoch }, data: { leaseExpiresAt: new Date(clock() + MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS) } })
        if (renewed.count !== 1) lost = true
      } catch { lost = true }
    }
    const timer = setInterval(beat, Math.max(1_000, Math.floor(MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS / 3)))
    timer.unref?.()
    return { async assert() {
      if (clock() >= deadlineAt) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_DURATION_EXCEEDED')
      if (lost) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
      return assertExportWorker(job.id, job.workerId, job.epoch)
    }, deadlineAt, stop() { stopped = true; clearInterval(timer) } }
  }

  async function failExportWorker(jobId, workerId, epoch, code) {
    return withManagedBlobTransferTransaction(db, async tx => {
      const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
      if (!job || !['PREPARED', 'COPYING'].includes(job.state) || job.workerId !== workerId || job.epoch !== epoch) return job
      try { await spool.remove(jobId) } catch {
        return updateTransferJob(tx, job, { state: 'UNKNOWN', unresolved: true, workerId: null, leaseExpiresAt: null,
          outcomeJson: JSON.stringify({ outcome: 'CLEANUP_REQUIRED' }) })
      }
      const failed = await updateTransferJob(tx, job, { state: 'FAILED', unresolved: false, spoolId: null,
        spoolSha256: null, spoolBytes: 0, snapshotSpoolBytes: 0, spoolReservedBytes: 0,
        workerId: null, leaseExpiresAt: null, closedAt: nowDate(clock),
        outcomeJson: JSON.stringify({ outcome: code }) })
      await recordAudit(tx, { entityType: 'SNAPSHOT', entityId: job.id, action: 'TRANSFER_EXPORT_FAILED',
        actorId: job.actorId, payload: { code, sourceGeneration: job.sourceGeneration } })
      return failed
    })
  }

  async function runExportWorker(jobId, workerId, epoch) {
    let current
    try {
      current = await assertExportWorker(jobId, workerId, epoch)
      const heartbeat = startExportHeartbeat(current)
      try {
        const snapshotBytes = await spool.read(jobId, { artifact: 'snapshot', byteLength: current.snapshotSpoolBytes,
          sha256: current.snapshotSha256, maxBytes: codecProfile.maxSnapshotBytes })
        const snapshot = JSON.parse(snapshotBytes.toString('utf8'))
        if (Buffer.from(canonicalJSON(snapshot)).compare(snapshotBytes) !== 0) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_PACKAGE_CHANGED')
        await assertManagedBlobTransferRetentionSafe(db, snapshot)
        const sources = buildSourceList(snapshot), originals = new Map()
        for (const source of sources) {
          await heartbeat.assert()
          const port = storageFactory(source.purpose, source.byteLength)
          const bytes = await runManagedBlobTransferProviderCall(signal => port.get({ ref: source.ref,
            tenantId: source.tenantId, businessId: source.businessId, expectedSha256: source.sha256,
            expectedByteLength: source.byteLength, signal }), { timeoutMs: MANAGED_BLOB_TRANSFER_PROFILE.providerOperationTimeoutMs,
            deadlineAt: heartbeat.deadlineAt, clock })
          await heartbeat.assert()
          const actual = Buffer.from(bytes)
          if (actual.length !== source.byteLength || digest(actual) !== source.sha256) throw unavailable(503, 'MANAGED_BLOB_TRANSFER_SOURCE_UNAVAILABLE')
          originals.set(source.ref, actual)
        }
        const payload = buildManagedBlobTransferPayload({ snapshot, originals,
          sourceGeneration: current.sourceGeneration, sourceConfigSha256: current.sourceConfigHash,
          sourceRevision: current.sourceRevision, exportedAt: current.createdAt.toISOString() }, codecProfile)
        const bytes = encodeManagedBlobTransfer(payload, codecProfile)
        if (bytes.length > MANAGED_BLOB_TRANSFER_PROFILE.maxPackageBytes) throw unavailable(413, 'MANAGED_BLOB_TRANSFER_TOO_LARGE')
        await heartbeat.assert()
        let receipt
        try {
          receipt = await spool.write(jobId, [bytes], { maxBytes: MANAGED_BLOB_TRANSFER_PROFILE.maxPackageBytes,
            deadline: Math.min(current.byteDeadline.getTime(), clock() + uploadDeadlineMs),
            commit: link => withManagedBlobTransferTransaction(db, async tx => {
              const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
              if (!job || job.state !== 'COPYING' || job.workerId !== workerId || job.epoch !== epoch
                || !job.leaseExpiresAt || job.leaseExpiresAt <= nowDate(clock)) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
              await link()
            }) })
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error
          receipt = await spool.read(jobId, { byteLength: bytes.length, sha256: digest(bytes),
            maxBytes: MANAGED_BLOB_TRANSFER_PROFILE.maxPackageBytes }).then(existing => ({ byteLength: existing.length, sha256: digest(existing) }))
        }
        const complete = await withManagedBlobTransferTransaction(db, async tx => {
          const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
          if (!job || job.actorId !== current.actorId || job.state !== 'COPYING' || job.workerId !== workerId || job.epoch !== epoch
            || job.leaseExpiresAt <= nowDate(clock)) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
          const completed = await updateTransferJob(tx, job, { state: 'COMPLETE', unresolved: false, spoolId: job.id,
            spoolSha256: receipt.sha256, packageSha256: digest(bytes), spoolBytes: receipt.byteLength,
            snapshotSpoolBytes: 0, spoolReservedBytes: receipt.byteLength,
            countsJson: JSON.stringify(transferCounts(snapshot, payload.manifest, receipt.byteLength)),
            workerId: null, leaseExpiresAt: null,
            outcomeJson: JSON.stringify({ outcome: 'COMPLETE' }), closedAt: nowDate(clock) })
          await recordAudit(tx, { entityType: 'SNAPSHOT', entityId: job.id, action: 'TRANSFER_EXPORTED',
            actorId: current.actorId, payload: { packageSha256: digest(bytes), entryCount: sources.length,
              sourceGeneration: current.sourceGeneration } })
          return completed
        })
        try { await spool.removeArtifact(jobId, 'snapshot') } catch { /* exact snapshot remains for bounded maintenance */ }
        return transferJobDTO(complete)
      } finally { heartbeat.stop() }
    } catch (error) {
      await failExportWorker(jobId, workerId, epoch, error?.code || 'SOURCE_UNAVAILABLE').catch(() => {})
      throw safeFailure(error)
    }
  }

  function dispatchExport(job) {
    if (!job || runningExports.has(job.id)) return
    const task = runExportWorker(job.id, job.workerId, job.epoch).finally(() => runningExports.delete(job.id))
    runningExports.set(job.id, task)
    task.catch(() => {})
  }

  async function resumePendingExports({ actorId } = {}) {
    if (typeof actorId !== 'string' || !actorId) throw unavailable(401, 'AUTH_REQUIRED')
    const now = nowDate(clock)
    const prepared = await db.managedBlobBackupTransferJob.findMany({ where: { kind: 'EXPORT', state: 'PREPARED',
      actorId, unresolved: true, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }, take: 16 })
    for (const job of prepared) await failExportWorker(job.id, job.workerId, job.epoch, 'INTERRUPTED_BEFORE_SELECTION_STAGING').catch(() => {})
    const waiting = await db.managedBlobBackupTransferJob.findMany({ where: { kind: 'EXPORT', state: 'COPYING', unresolved: true,
      actorId, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }, take: 16 })
    for (const stale of waiting) {
      const claimed = await withManagedBlobTransferTransaction(db, async tx => {
        const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: stale.id } })
        if (!job || job.actorId !== actorId || job.state !== 'COPYING'
          || (job.leaseExpiresAt && job.leaseExpiresAt > nowDate(clock))) return null
        const workerId = randomUUID(), workerStartedAt = nowDate(clock)
        const next = await updateTransferJob(tx, job, { workerId, epoch: { increment: 1 },
          workerStartedAt, leaseExpiresAt: new Date(clock() + MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS) })
        await recordAudit(tx, { entityType: 'OPERATOR_ACTION', entityId: 'local', action: 'TRANSFER_EXPORT_RESUMED',
          actorId, payload: { transferJobId: job.id, generation: job.sourceGeneration } })
        return next
      })
      if (claimed) dispatchExport(claimed)
    }
    return { interrupted: prepared.length, resumed: waiting.length }
  }

  async function exportPackage(args) {
    const setup = await beginExport(args)
    dispatchExport(setup.job)
    return transferJobDTO(setup.job)
  }

  async function packageBytes({ request, viewer, session, jobId }) {
    const proof = await operatorProof({ request, viewer, session })
    const job = await findJob(jobId, proof.actorId)
    if (job.kind !== 'EXPORT' || job.state !== 'COMPLETE' || !job.spoolId || job.byteDeadline <= nowDate(clock)) {
      throw unavailable(404, 'MANAGED_BLOB_TRANSFER_NOT_FOUND')
    }
    const bytes = await spool.read(job.spoolId, { byteLength: job.spoolBytes,
      sha256: job.spoolSha256, maxBytes: MANAGED_BLOB_TRANSFER_PROFILE.maxPackageBytes })
    if (!sameDigest(digest(bytes), job.packageSha256)) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_PACKAGE_CHANGED')
    return { bytes, job: transferJobDTO(job) }
  }

  async function createPreviewJob(proof, configHash) {
    const id = randomUUID(), workerId = randomUUID(), at = nowDate(clock)
    return withManagedBlobTransferTransaction(db, async (tx, { fence }) => {
      await assertTransferReady(tx, fence)
      let job = await tx.managedBlobBackupTransferJob.create({ data: {
        id, actorId: proof.actorId, kind: 'RESTORE', state: 'PREPARED', generation: fence.generation,
        targetConfigHash: configHash, expiresAt: new Date(at.getTime() + MANAGED_BLOB_TRANSFER_PROFILE.confirmationTtlMs),
        byteDeadline: new Date(at.getTime() + MANAGED_BLOB_TRANSFER_PROFILE.byteRetentionMs), spoolId: id,
        workerId, leaseExpiresAt: new Date(at.getTime() + MANAGED_BLOB_TRANSFER_PROFILE.jobDurationMs), unresolved: true,
      } })
      job = await reserveTransferPayload(tx, id, MANAGED_BLOB_TRANSFER_PROFILE.maxPackageBytes, MANAGED_BLOB_TRANSFER_PROFILE.spoolQuotaBytes)
      await recordAudit(tx, { entityType: 'OPERATOR_ACTION', entityId: 'local', action: 'BACKUP_PREVIEW',
        actorId: proof.actorId, payload: { transferJobId: id, generation: fence.generation } })
      return job
    })
  }

  async function finishInvalidPreview(job, actorId, error) {
    const claimed = await withManagedBlobTransferTransaction(db, async tx => {
      const current = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: job.id } })
      if (!current || current.actorId !== actorId || current.kind !== 'RESTORE' || current.state !== 'PREPARED'
        || current.version !== job.version || current.workerId !== job.workerId || current.epoch !== job.epoch) return null
      return updateTransferJob(tx, current, { state: 'ABANDONED', unresolved: true, cleanupState: 'ABANDON_PENDING',
        spoolId: current.id, confirmationDigest: null, workerId: null, leaseExpiresAt: null, closedAt: nowDate(clock),
        outcomeJson: JSON.stringify({ outcome: 'PREVIEW_REJECTED', cleanup: 'PENDING' }) })
    }).catch(() => null)
    if (claimed) {
      try {
        await spool.remove(claimed.id)
        await withManagedBlobTransferTransaction(db, async tx => {
          const current = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: claimed.id } })
          if (!current || current.version !== claimed.version || current.state !== 'ABANDONED'
            || current.cleanupState !== 'ABANDON_PENDING' || current.spoolId !== current.id) return current
          return updateTransferJob(tx, current, { unresolved: false, cleanupState: 'COMPLETE', spoolId: null,
            spoolSha256: null, packageSha256: null, spoolBytes: 0, spoolReservedBytes: 0,
            outcomeJson: JSON.stringify({ outcome: 'PREVIEW_REJECTED', cleanup: 'COMPLETE' }) })
        })
      } catch { /* keep unresolved custody for maintenance reconciliation */ }
    }
    throw safeFailure(error)
  }

  async function previewPackage({ request, viewer, session, chunks, contentLength, signal }) {
    const proof = await operatorProof({ request, viewer, session }), configHash = managedBlobTransferConfigHash(env)
    if (contentLength != null && (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > codecProfile.maxPackageBytes)) {
      throw unavailable(contentLength > codecProfile.maxPackageBytes ? 413 : 400, 'MANAGED_BLOB_TRANSFER_INVALID')
    }
    const job = await createPreviewJob(proof, configHash)
    try {
      const receipt = await spool.write(job.id, chunks, { maxBytes: codecProfile.maxPackageBytes,
        deadline: Math.min(job.expiresAt.getTime(), clock() + uploadDeadlineMs), signal,
        commit: link => withManagedBlobTransferTransaction(db, async (tx, { fence }) => {
          await assertTransferReady(tx, fence, { expectedGeneration: job.generation, exceptJobId: job.id })
          const current = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: job.id } })
          if (!current || current.kind !== 'RESTORE' || current.state !== 'PREPARED' || current.version !== job.version
            || current.workerId !== job.workerId || current.epoch !== job.epoch
            || !current.leaseExpiresAt || current.leaseExpiresAt <= nowDate(clock)) {
            throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
          }
          await link()
        }) })
      if (contentLength != null && receipt.byteLength !== contentLength) throw unavailable(400, 'MANAGED_BLOB_TRANSFER_INVALID')
      const bytes = await spool.read(job.id, { byteLength: receipt.byteLength, sha256: receipt.sha256,
        maxBytes: codecProfile.maxPackageBytes })
      const decoded = decodeManagedBlobTransfer(bytes, codecProfile)
      const permit = createManagedBlobTransferSnapshotPermit(job.id)
      const preview = await previewImport(decoded.snapshot, { db, viewer, transferPermit: permit })
      if (!preview.valid) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_SNAPSHOT_REFUSED')
      await assertManagedBlobTransferRetentionSafe(db, decoded.snapshot)
      const token = randomBytes(32).toString('base64url'), bindingDigest = digest(Buffer.from(token, 'base64url'))
      const result = await withManagedBlobTransferTransaction(db, async (tx, { fence }) => {
        await assertTransferReady(tx, fence, { expectedGeneration: job.generation, exceptJobId: job.id })
        const current = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: job.id } })
        if (!current || current.kind !== 'RESTORE' || current.state !== 'PREPARED' || current.version !== job.version
          || current.actorId !== proof.actorId || current.workerId !== job.workerId || current.epoch !== job.epoch
          || !current.leaseExpiresAt || current.leaseExpiresAt <= nowDate(clock)
          || current.targetConfigHash !== configHash || current.expiresAt <= nowDate(clock)) {
          throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
        }
        for (const entry of decoded.manifest.entries) {
          const entryId = randomUUID()
          await tx.managedBlobBackupTransferEntry.create({ data: { id: entryId, jobId: job.id,
            objectId: entry.objectId, purpose: entry.purpose, sha256: entry.sha256, byteLength: entry.byteLength,
            bindingsJson: JSON.stringify(entry.bindings), targetKey: makeTargetKey(entryId, entry), state: 'PENDING', unresolved: true } })
        }
        return updateTransferJob(tx, current, { state: 'PREVIEWED', sourceGeneration: decoded.manifest.sourceGeneration,
          sourceConfigHash: decoded.manifest.sourceConfigSha256, sourceRevision: decoded.manifest.sourceRevision,
          snapshotSha256: decoded.manifest.snapshotSha256, packageSha256: decoded.packageSha256,
          spoolId: job.id, spoolSha256: receipt.sha256, spoolBytes: receipt.byteLength,
          spoolReservedBytes: receipt.byteLength, confirmationDigest: bindingDigest, workerId: null, leaseExpiresAt: null,
          countsJson: JSON.stringify(transferCounts(decoded.snapshot, decoded.manifest, receipt.byteLength, preview)),
          outcomeJson: JSON.stringify({ outcome: 'PREVIEWED', entryCount: decoded.manifest.entryCount }),
        })
      })
      return { ...transferJobDTO(result), confirmationBinding: token,
        testAdmissionCheckEnabled: Boolean(testAdmission) }
    } catch (error) {
      await finishInvalidPreview(job, proof.actorId, error)
    }
  }

  function hasClaimedRestore(job) {
    return job.kind === 'RESTORE' && Boolean(job.restoreAttemptId) && job.unresolved
      && ['RESTORING', 'UNKNOWN', 'METADATA_COMMITTED'].includes(job.state)
  }

  async function readPackageForJob(job) {
    if (!job.spoolId || (job.byteDeadline <= nowDate(clock) && !hasClaimedRestore(job))) {
      throw unavailable(410, 'MANAGED_BLOB_TRANSFER_EXPIRED')
    }
    const bytes = await spool.read(job.spoolId, { byteLength: job.spoolBytes,
      sha256: job.spoolSha256, maxBytes: codecProfile.maxPackageBytes })
    if (!sameDigest(digest(bytes), job.packageSha256)) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_PACKAGE_CHANGED')
    return decodeManagedBlobTransfer(bytes, codecProfile)
  }

  async function currentFence() {
    return db.managedBlobRecoveryInstallationFence.findUnique({ where: { id: 'installation' } })
  }

  async function authorizeTestTarget(job, decoded, packageSha256) {
    if (!testAdmission || typeof testAdmission.authorize !== 'function') throw unavailable(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
    const signedAdmissionConfigured = Boolean(env.ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_PUBLIC_KEY_FILE
      && (job.admissionJson || env.ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_FILE))
    if ((env.NODE_ENV !== 'test' && !signedAdmissionConfigured) || typeof db.$queryRawUnsafe !== 'function') {
      throw unavailable(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
    }
    let identity
    try {
      identity = (await db.$queryRawUnsafe(`SELECT current_database() AS "databaseName",
        host(inet_server_addr()) AS "serverAddress", current_setting('data_directory') AS "directory",
        (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",
        (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid"`))[0]
    } catch { throw unavailable(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED') }
    if (identity?.databaseName !== 'zuri_server_test' || !['127.0.0.1', '::1'].includes(identity.serverAddress)
      || typeof identity.directory !== 'string' || !/^\d+$/.test(identity.databaseOid || '')
      || !/^\d+$/.test(identity.systemIdentifier || '')) {
      throw unavailable(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
    }
    const targetFingerprintSha256 = managedBlobTransferTestTargetFingerprint(identity)
    const targetGeneration = job.state === 'PREVIEWED' ? job.generation : job.generation - 1
    if (!Number.isSafeInteger(targetGeneration) || targetGeneration < 1) {
      throw unavailable(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
    }
    const targetId = `embedded-postgres:${targetFingerprintSha256.slice(0, 16)}`
    const expected = { databaseName: identity.databaseName, databaseOid: identity.databaseOid,
      transferJobId: job.id, targetId, targetFingerprintSha256, targetGeneration,
      targetConfigHash: job.targetConfigHash, sourceRevision: decoded.manifest.sourceRevision,
      packageSha256 }
    let admission
    try {
      if (job.admissionJson) {
        const prior = JSON.parse(job.admissionJson)
        if (typeof testAdmission.verifyPersisted !== 'function') throw unavailable(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
        admission = await testAdmission.verifyPersisted(prior, expected)
        if (canonicalJSON(prior) !== canonicalJSON(admission)) throw unavailable(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
      } else {
        admission = await testAdmission.authorize({ db, job: transferJobDTO(job), manifest: decoded.manifest,
          snapshot: decoded.snapshot, ...expected })
      }
    }
    catch {
      throw unavailable(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
    }
    const admissionMatches = admission && admission.schemaVersion === 'managed-blob-transfer-test-admission.v1'
      && admission.environment === 'TEST' && admission.databaseName === 'zuri_server_test'
      && admission.databaseName === identity.databaseName && admission.databaseOid === identity.databaseOid
      && admission.transferJobId === job.id && admission.targetId === targetId
      && admission.targetGeneration === targetGeneration && admission.targetFingerprintSha256 === targetFingerprintSha256
      && isHash(admission.syntheticDatasetSha256) && isHash(admission.targetConfigSha256)
      && admission.targetConfigSha256 === job.targetConfigHash && isHash(admission.sourceEvidenceSha256)
      && admission.maintenanceMode === true && admission.quiesced === true
      && admission.sourceRevision === decoded.manifest.sourceRevision && admission.packageSha256 === packageSha256
      && validJobId(admission.admissionId) && typeof admission.signature === 'string'
    if (!admissionMatches) {
      throw unavailable(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
    }
    return { ...admission, maintenanceMode: true, quiesced: true }
  }

  async function markUnknown(jobId, actorId, code = 'RECONCILIATION_REQUIRED') {
    return withManagedBlobTransferTransaction(db, async tx => {
      const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
      if (!job || job.actorId !== actorId || ['METADATA_COMMITTED', 'NEEDS_ADMISSION', 'COMPLETE'].includes(job.state)) return job
      return updateTransferJob(tx, job, { state: 'UNKNOWN', unresolved: true,
        outcomeJson: JSON.stringify({ outcome: code }), workerId: null, leaseExpiresAt: null })
    })
  }

  async function assertRestoreWorker(jobId, worker) {
    const job = await db.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
    if (!job || job.state !== 'RESTORING' || job.workerId !== worker.workerId || job.epoch !== worker.epoch
      || !job.leaseExpiresAt || job.leaseExpiresAt <= nowDate(clock)) {
      throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
    }
    if (clock() >= jobDeadline(job)) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_DURATION_EXCEEDED')
    return job
  }

  function startRestoreHeartbeat(job) {
    const worker = { workerId: job.workerId, epoch: job.epoch }
    const deadlineAt = jobDeadline(job)
    let stopped = false, lost = false, timer
    const beat = async () => {
      if (stopped || lost) return
      if (clock() >= deadlineAt) { lost = true; return }
      try {
        const renewed = await db.managedBlobBackupTransferJob.updateMany({ where: { id: job.id,
          state: 'RESTORING', workerId: worker.workerId, epoch: worker.epoch },
        data: { leaseExpiresAt: new Date(clock() + MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS) } })
        if (renewed.count !== 1) lost = true
      } catch { lost = true }
    }
    timer = setInterval(beat, Math.max(1_000, Math.floor(MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS / 3)))
    timer.unref?.()
    return { ...worker, deadlineAt, async assert() {
      if (clock() >= deadlineAt) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_DURATION_EXCEEDED')
      if (lost) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
      return assertRestoreWorker(job.id, worker)
    }, stop() { stopped = true; clearInterval(timer) } }
  }

  async function prepareEntries(jobId, worker) {
    return withManagedBlobTransferTransaction(db, async tx => {
      const entries = await tx.managedBlobBackupTransferEntry.findMany({ where: { jobId }, orderBy: { objectId: 'asc' } })
      for (const entry of entries) {
        if (entry.state === 'VERIFIED') continue
        if (entry.state === 'WRITING' && entry.attempts === 1
          && entry.workerId === worker.workerId && entry.epoch === worker.epoch) continue
        if (entry.state !== 'PENDING' || entry.attempts !== 0 || entry.targetRef || !entry.targetKey) {
          throw unavailable(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
        }
        const claimed = await tx.managedBlobBackupTransferEntry.updateMany({ where: { id: entry.id, jobId,
          state: 'PENDING', attempts: 0, targetRef: null, workerId: null },
        data: { state: 'WRITING', attempts: 1, workerId: worker.workerId, epoch: worker.epoch,
          leaseExpiresAt: new Date(clock() + MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS) } })
        if (claimed.count !== 1) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
      }
      return tx.managedBlobBackupTransferEntry.findMany({ where: { jobId }, orderBy: { objectId: 'asc' } })
    })
  }

  async function verifyEntry(currentJob, entry, content, worker) {
    const bindings = JSON.parse(entry.bindingsJson), first = bindings[0]
    if (!first || !isHash(entry.sha256) || content.length !== entry.byteLength || digest(content) !== entry.sha256) {
      throw unavailable(409, 'MANAGED_BLOB_TRANSFER_PACKAGE_CHANGED')
    }
    const fileRow = await db.fileAsset.findFirst({ where: { id: { in: bindings.filter(b => b.model === 'fileAsset').map(b => b.id) } }, select: { mime: true } })
    const port = storageFactory(entry.purpose, entry.byteLength)
    let ref = entry.targetRef
    if (entry.state === 'VERIFIED' && ref) {
      const bytes = await runManagedBlobTransferProviderCall(signal => port.get({ ref, tenantId: first.tenantId,
        businessId: first.businessId, expectedSha256: entry.sha256, expectedByteLength: entry.byteLength, signal }),
      { timeoutMs: MANAGED_BLOB_TRANSFER_PROFILE.providerOperationTimeoutMs, deadlineAt: worker.deadlineAt, clock })
      if (bytes.length !== entry.byteLength || digest(bytes) !== entry.sha256) throw unavailable(503, 'MANAGED_BLOB_TRANSFER_PROVIDER_UNAVAILABLE')
      return ref
    }
    if (entry.state !== 'WRITING' || entry.attempts !== 1 || currentJob.state !== 'RESTORING' || ref
      || entry.workerId !== worker.workerId || entry.epoch !== worker.epoch
      || currentJob.workerId !== worker.workerId || currentJob.epoch !== worker.epoch) {
      throw unavailable(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
    }
    let receipt
    try {
      await worker.assert()
      receipt = await runManagedBlobTransferProviderCall(signal => port.put({ key: entry.targetKey, content,
        mime: fileRow?.mime || 'application/octet-stream', signal }),
      { timeoutMs: MANAGED_BLOB_TRANSFER_PROFILE.providerOperationTimeoutMs, deadlineAt: worker.deadlineAt, clock })
    } catch { throw unavailable(503, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED') }
    await worker.assert()
    ref = receipt?.ref
    const parsed = parseBusinessObjectRef(ref)
    if (parsed.purpose !== entry.purpose || parsed.key !== entry.targetKey) throw unavailable(503, 'MANAGED_BLOB_TRANSFER_PROVIDER_UNAVAILABLE')
    await withManagedBlobTransferTransaction(db, async tx => {
      const changed = await tx.managedBlobBackupTransferEntry.updateMany({ where: { id: entry.id, jobId: currentJob.id,
        state: 'WRITING', targetKey: entry.targetKey, workerId: worker.workerId, epoch: worker.epoch },
        data: { state: 'WRITTEN', targetRef: ref, receiptJson: JSON.stringify({ refSha256: digest(Buffer.from(ref)),
          sha256: receipt.sha256, byteLength: receipt.byteLength }), leaseExpiresAt: null } })
      if (changed.count !== 1) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
    })
    const bytes = await runManagedBlobTransferProviderCall(signal => port.get({ ref, tenantId: first.tenantId,
      businessId: first.businessId, expectedSha256: entry.sha256, expectedByteLength: entry.byteLength, signal }),
    { timeoutMs: MANAGED_BLOB_TRANSFER_PROFILE.providerOperationTimeoutMs, deadlineAt: worker.deadlineAt, clock })
    if (bytes.length !== entry.byteLength || digest(bytes) !== entry.sha256
      || receipt.sha256 !== entry.sha256 || receipt.byteLength !== entry.byteLength) throw unavailable(503, 'MANAGED_BLOB_TRANSFER_PROVIDER_UNAVAILABLE')
    await withManagedBlobTransferTransaction(db, async tx => {
      const current = await tx.managedBlobBackupTransferEntry.findUnique({ where: { id: entry.id } })
      if (!current || current.targetKey !== entry.targetKey || current.targetRef !== ref || current.state !== 'WRITTEN') {
        throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
      }
      await tx.managedBlobBackupTransferEntry.update({ where: { id: entry.id }, data: { state: 'VERIFIED', unresolved: false,
        receiptJson: JSON.stringify({ refSha256: digest(Buffer.from(ref)), sha256: entry.sha256, byteLength: entry.byteLength }),
        workerId: null, leaseExpiresAt: null } })
    })
    return ref
  }

  async function reconcileEntry(job, entry, decoded, deadlineAt) {
    const bindings = JSON.parse(entry.bindingsJson), first = bindings[0], port = storageFactory(entry.purpose, entry.byteLength)
    let ref = entry.targetRef
    if (!ref) {
      if (entry.attempts !== 1 || !entry.targetKey || typeof port.recover !== 'function') return false
      const receipt = await runManagedBlobTransferProviderCall(signal => port.recover({ key: entry.targetKey,
        tenantId: first.tenantId, businessId: first.businessId, expectedSha256: entry.sha256,
        expectedByteLength: entry.byteLength, signal }),
      { timeoutMs: MANAGED_BLOB_TRANSFER_PROFILE.providerOperationTimeoutMs, deadlineAt, clock })
      if (!receipt?.ref) return false
      ref = receipt.ref
    }
    const parsed = parseBusinessObjectRef(ref)
    if (parsed.key !== entry.targetKey || parsed.purpose !== entry.purpose) return false
    const bytes = await runManagedBlobTransferProviderCall(signal => port.get({ ref, tenantId: first.tenantId,
      businessId: first.businessId, expectedSha256: entry.sha256, expectedByteLength: entry.byteLength, signal }),
    { timeoutMs: MANAGED_BLOB_TRANSFER_PROFILE.providerOperationTimeoutMs, deadlineAt, clock })
    if (bytes.length !== entry.byteLength || digest(bytes) !== entry.sha256) return false
    await withManagedBlobTransferTransaction(db, async tx => {
      const current = await tx.managedBlobBackupTransferEntry.findUnique({ where: { id: entry.id } })
      if (!current || current.targetKey !== entry.targetKey || current.attempts !== entry.attempts
        || !['WRITING', 'WRITTEN', 'UNKNOWN', 'PENDING'].includes(current.state)) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
      await tx.managedBlobBackupTransferEntry.update({ where: { id: entry.id }, data: { targetRef: ref, state: 'VERIFIED', unresolved: false,
        receiptJson: JSON.stringify({ refSha256: digest(Buffer.from(ref)), sha256: entry.sha256, byteLength: entry.byteLength }), workerId: null, leaseExpiresAt: null } })
    })
    return true
  }

  async function confirm({ request, viewer, session, jobId, input, onAccepted = () => {} }) {
    const proof = await operatorProof({ request, viewer, session }), job = await findJob(jobId, proof.actorId)
    if (job.state === 'NEEDS_ADMISSION') { onAccepted(transferJobDTO(job)); return transferJobDTO(job) }
    const suppliedDigest = confirmationDigest(input?.confirmationBinding)
    const bindingValid = Boolean(suppliedDigest && sameDigest(suppliedDigest, job.confirmationDigest))
    const claimedResume = hasClaimedRestore(job)
    if ((job.state === 'PREVIEWED' && !bindingValid)
      || (claimedResume && input?.confirmationBinding !== undefined && !bindingValid)
      || (!['PREVIEWED', 'RESTORING', 'UNKNOWN', 'METADATA_COMMITTED'].includes(job.state))) {
      throw unavailable(409, 'MANAGED_BLOB_TRANSFER_CONFIRMATION_INVALID')
    }
    if (job.version !== input.expectedJobVersion) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
    if (job.expiresAt <= nowDate(clock) && !hasClaimedRestore(job)) throw unavailable(410, 'MANAGED_BLOB_TRANSFER_EXPIRED')
    const configHash = managedBlobTransferConfigHash(env)
    if (job.targetConfigHash !== configHash) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_CONFIG_CHANGED')
    const decoded = await readPackageForJob(job)
    if (decoded.packageSha256 !== job.packageSha256 || decoded.manifest.sourceGeneration !== job.sourceGeneration
      || decoded.manifest.snapshotSha256 !== job.snapshotSha256
      || decoded.manifest.sourceConfigSha256 !== job.sourceConfigHash || decoded.manifest.sourceRevision !== job.sourceRevision) {
      throw unavailable(409, 'MANAGED_BLOB_TRANSFER_PACKAGE_CHANGED')
    }
    const admission = await authorizeTestTarget(job, decoded, job.packageSha256)
    if (job.admissionJson) {
      let prior
      try { prior = JSON.parse(job.admissionJson) } catch { throw unavailable(409, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED') }
      if (canonicalJSON(prior) !== canonicalJSON(admission)) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
    }
    await assertManagedBlobTransferRetentionSafe(db, decoded.snapshot)

    let restoreRemounts
    try {
      if (job.state === 'PREVIEWED') restoreRemounts = normalizeManagedBlobTransferRemounts(decoded.snapshot, input.remounts ?? [])
      else {
        const persisted = JSON.parse(job.restoreRemountsJson || 'null')
        if (!Array.isArray(persisted)) throw new Error('Missing restore remount plan')
        restoreRemounts = normalizeManagedBlobTransferRemounts(decoded.snapshot, persisted)
      }
    } catch { throw unavailable(400, 'MANAGED_BLOB_TRANSFER_INVALID') }

    if (job.state === 'METADATA_COMMITTED') {
      onAccepted(transferJobDTO(job))
      const claim = { transferJobId: job.id, generation: job.generation, restoreAttemptId: job.restoreAttemptId }
      const fence = await currentFence()
      if (!claim.restoreAttemptId || fence?.mode !== 'RESTORING' || fence.generation !== claim.generation
        || fence.restoreAttemptId !== claim.restoreAttemptId) {
        throw unavailable(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
      }
      const entries = await db.managedBlobBackupTransferEntry.findMany({ where: { jobId: job.id }, orderBy: { objectId: 'asc' } })
      if (!entries.length || entries.some(entry => entry.state !== 'VERIFIED')) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
      const targetSnapshot = targetSnapshotWithRefs(decoded, entries)
      const postpass = await completeManagedBlobTransferPostpass(targetSnapshot, { db, restoreClaim: claim, remounts: restoreRemounts })
      const done = await clearCompletedPackage(job.id)
      return { ...transferJobDTO(done), postpass }
    }

    if (job.state === 'RESTORING' && job.workerId && job.leaseExpiresAt > nowDate(clock)) {
      onAccepted(transferJobDTO(job)); return transferJobDTO(job)
    }

    let entries = await db.managedBlobBackupTransferEntry.findMany({ where: { jobId: job.id }, orderBy: { objectId: 'asc' } })
    if (!entries.length || entries.length !== decoded.manifest.entries.length) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_PACKAGE_CHANGED')
    let claim
    if (job.state === 'PREVIEWED') {
      claim = await beginManagedBlobTransferRestore(db, { jobId: job.id, actorId: proof.actorId,
        expectedJobVersion: job.version, expectedGeneration: job.generation, operatorProof: proof, admission,
        restoreRemountsJson: JSON.stringify(restoreRemounts) })
    } else {
      const fence = await currentFence()
      if (!job.restoreAttemptId || fence?.mode !== 'RESTORING' || fence.generation !== job.generation
        || fence.restoreAttemptId !== job.restoreAttemptId) {
        throw unavailable(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
      }
      // Reconciliation is an operator-triggered, read-only check. Give this
      // request its own finite window so a long-parked ambiguous write can be
      // proved before a fresh restore worker claim is admitted.
      const reconciliationDeadlineAt = clock() + MANAGED_BLOB_TRANSFER_PROFILE.jobDurationMs
      for (const entry of entries) {
        if (entry.state === 'VERIFIED' || (entry.state === 'PENDING' && entry.attempts === 0 && !entry.targetRef)) continue
        try { await reconcileEntry(job, entry, decoded, reconciliationDeadlineAt) }
        catch { /* exact read-only reconciliation remains unresolved */ }
      }
      entries = await db.managedBlobBackupTransferEntry.findMany({ where: { jobId: job.id }, orderBy: { objectId: 'asc' } })
      if (entries.some(entry => entry.state !== 'VERIFIED'
        && !(entry.state === 'PENDING' && entry.attempts === 0 && !entry.targetRef))) {
        await markUnknown(job.id, proof.actorId, 'RECONCILIATION_REQUIRED')
        throw unavailable(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
      }
      claim = await resumeManagedBlobTransferRestore(db, { jobId: job.id, actorId: proof.actorId,
        expectedJobVersion: job.version, operatorProof: proof })
      if (claim.active) { onAccepted(transferJobDTO(claim.job)); return transferJobDTO(claim.job) }
    }

    let currentJob = await db.managedBlobBackupTransferJob.findUnique({ where: { id: job.id } })
    onAccepted(transferJobDTO(currentJob))
    const worker = startRestoreHeartbeat(currentJob)
    try {
      entries = await prepareEntries(job.id, worker)
      const contentById = decoded.objects
      for (const entry of entries) {
        if (entry.state === 'VERIFIED') {
          await verifyEntry(currentJob, entry, contentById.get(entry.objectId), worker)
          continue
        }
        const content = contentById.get(entry.objectId)
        if (!content) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_PACKAGE_CHANGED')
        await verifyEntry(currentJob, entry, content, worker)
      }
      entries = await db.managedBlobBackupTransferEntry.findMany({ where: { jobId: job.id }, orderBy: { objectId: 'asc' } })
      const targetSnapshot = targetSnapshotWithRefs(decoded, entries)
      if (managedBlobTransferConfigHash(env) !== job.targetConfigHash) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_CONFIG_CHANGED')
      currentJob = await worker.assert()
      const permit = createManagedBlobTransferImportPermit({ jobId: job.id, snapshot: targetSnapshot,
        restoreClaim: claim, operatorProof: proof, workerId: worker.workerId, workerEpoch: worker.epoch,
        expectedJobVersion: currentJob.version, snapshotSha256: job.snapshotSha256, packageSha256: job.packageSha256,
        admissionSha256: digest(Buffer.from(canonicalJSON(admission))) })
      const restored = await importSnapshot(targetSnapshot, { db, viewer, confirm: true, transferPermit: permit,
        remounts: restoreRemounts })
      if (!restored?.restored) throw unavailable(409, 'MANAGED_BLOB_TRANSFER_METADATA_REFUSED')
      let done = await db.managedBlobBackupTransferJob.findUnique({ where: { id: job.id } })
      if (done.state !== 'NEEDS_ADMISSION') throw unavailable(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
      done = await clearCompletedPackage(job.id)
      return transferJobDTO(done)
    } catch (error) {
      await markUnknown(job.id, proof.actorId, error?.code || 'RECONCILIATION_REQUIRED').catch(() => {})
      throw safeFailure(error)
    } finally { worker.stop() }
  }

  async function startConfirm(args) {
    let accepted = false, resolveAccepted, rejectAccepted
    const admission = new Promise((resolve, reject) => { resolveAccepted = resolve; rejectAccepted = reject })
    const completion = confirm({ ...args, onAccepted(job) { accepted = true; resolveAccepted(job) } })
      .catch(error => { if (!accepted) rejectAccepted(error); throw error })
    completion.catch(() => {})
    const job = await admission
    return { job, completion }
  }

  async function inspect({ request, viewer, session, jobId }) {
    const proof = await operatorProof({ request, viewer, session }), job = await findJob(jobId, proof.actorId)
    if (job.state === 'METADATA_COMMITTED') return { ...transferJobDTO(job), reconciliation: { nextAction: 'CONFIRM_POSTPASS' } }
    if (!['UNKNOWN', 'RESTORING'].includes(job.state) || !job.restoreAttemptId) return transferJobDTO(job)
    if (job.workerId && job.leaseExpiresAt > nowDate(clock)) {
      return { ...transferJobDTO(job), reconciliation: { nextAction: 'WAIT' } }
    }
    const decoded = await readPackageForJob(job), entries = await db.managedBlobBackupTransferEntry.findMany({ where: { jobId }, orderBy: { objectId: 'asc' } })
    const reconciliationDeadlineAt = clock() + MANAGED_BLOB_TRANSFER_PROFILE.jobDurationMs
    for (const entry of entries) {
      if (entry.state === 'VERIFIED') continue
      try { await reconcileEntry(job, entry, decoded, reconciliationDeadlineAt) }
      catch { /* exact read-only reconciliation remains unresolved */ }
    }
    const refreshed = await db.managedBlobBackupTransferEntry.findMany({ where: { jobId } })
    const resumable = refreshed.every(entry => entry.state === 'VERIFIED'
      || (entry.state === 'PENDING' && entry.attempts === 0 && !entry.targetRef))
    return { ...transferJobDTO(await findJob(jobId, proof.actorId)), reconciliation: {
      verifiedEntries: refreshed.filter(entry => entry.state === 'VERIFIED').length,
      unresolvedEntries: refreshed.filter(entry => entry.state !== 'VERIFIED').length,
      nextAction: resumable ? 'CONFIRM' : 'RECONCILIATION_REQUIRED',
    } }
  }

  async function status({ request, viewer, session, jobId }) {
    const proof = await operatorProof({ request, viewer, session })
    return transferJobDTO(await findJob(jobId, proof.actorId))
  }

  async function current({ request, viewer, session }) {
    const proof = await operatorProof({ request, viewer, session })
    await resumePendingExports({ actorId: proof.actorId })
    const jobs = await db.managedBlobBackupTransferJob.findMany({ where: { actorId: proof.actorId },
      orderBy: { updatedAt: 'desc' }, take: 20 })
    return jobs.map(transferJobDTO)
  }

  async function abandon({ request, viewer, session, jobId, expectedJobVersion }) {
    const proof = await operatorProof({ request, viewer, session })
    const claimed = await withManagedBlobTransferTransaction(db, async tx => {
      await assertManagedBlobTransferOperator(tx, proof)
      const row = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
      if (!row || row.version !== expectedJobVersion || row.actorId !== proof.actorId
        || !['PREVIEWED', 'COMPLETE', 'FAILED'].includes(row.state) || row.attempts > 0 || row.restoreAttemptId
        || row.workerId || row.leaseExpiresAt || row.cleanupState !== 'NONE'
        || (row.spoolId && row.spoolId !== row.id)) {
        throw unavailable(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
      }
      await tx.managedBlobBackupTransferEntry.updateMany({ where: { jobId }, data: { state: 'ABANDONED', unresolved: false,
        workerId: null, leaseExpiresAt: null, closedAt: nowDate(clock) } })
      return updateTransferJob(tx, row, { state: 'ABANDONED', unresolved: true, cleanupState: 'ABANDON_PENDING',
        confirmationDigest: null, outcomeJson: JSON.stringify({ outcome: 'ABANDONED', cleanup: 'PENDING' }),
        spoolId: row.id, closedAt: nowDate(clock) })
    })
    try { await spool.remove(claimed.id) } catch { return transferJobDTO(claimed) }
    const closed = await withManagedBlobTransferTransaction(db, async tx => {
      const row = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: claimed.id } })
      if (!row || row.version !== claimed.version || row.actorId !== proof.actorId || row.state !== 'ABANDONED'
        || row.cleanupState !== 'ABANDON_PENDING' || (row.spoolId && row.spoolId !== row.id)) return row
      return updateTransferJob(tx, row, { unresolved: false, cleanupState: 'COMPLETE', spoolId: null,
        spoolSha256: null, spoolBytes: 0, snapshotSpoolBytes: 0, spoolReservedBytes: 0,
        restoreRemountsJson: null, resultJson: null,
        outcomeJson: JSON.stringify({ outcome: 'ABANDONED', cleanup: 'COMPLETE' }) })
    })
    return transferJobDTO(closed)
  }

  return Object.freeze({ exportPackage, resumePendingExports, packageBytes, previewPackage, confirm, startConfirm, inspect, status, current, abandon })
}
