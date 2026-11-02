// @req FR-293 — durable transfer jobs share the installation recovery fence.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { isPostgres } from './pipeline-writer'
import { RECOVERY_FENCE_ID } from './managed-blob-recovery-repository'
import { RECOVERY_MUTEX } from './managed-blob-recovery-lock'
import { randomUUID } from 'node:crypto'
import { assertManagedBlobTransferOperator } from './managed-blob-transfer-authority'
import { recordAudit } from './audit'

const denied = (status, code) => Object.assign(new Error('Managed blob transfer refused'), { status, code })
export const MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS = 30_000

export async function withManagedBlobTransferTransaction(db, callback) {
  const postgres = isPostgres(db), deadline = Date.now() + 5000
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        if (postgres) {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '4000ms'")
          await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1::int,$2::int)::text AS locked', ...RECOVERY_MUTEX)
          await tx.$queryRawUnsafe('SELECT "id" FROM "ManagedBlobRecoveryInstallationFence" WHERE "id"=$1 FOR UPDATE', RECOVERY_FENCE_ID)
        } else await tx.$executeRawUnsafe('UPDATE "ManagedBlobRecoveryInstallationFence" SET "version"="version" WHERE "id"=?', RECOVERY_FENCE_ID)
        const fence = await tx.managedBlobRecoveryInstallationFence.findUnique({ where: { id: RECOVERY_FENCE_ID } })
        if (!fence) throw denied(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
        await tx.managedBlobRecoveryInstallationFence.update({ where: { id: fence.id }, data: { version: { increment: 1 } } })
        return callback(tx, { postgres, fence })
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      const retry = error?.code === 'P2034' || ['40001', '40P01'].includes(error?.meta?.code)
        || /serialization|could not serialize|deadlock|SQLITE_BUSY|SQLITE_LOCKED|database is locked|lock timeout/i.test(error?.message || '')
      if (!retry) throw error
      if (attempt === 2 || Date.now() >= deadline) throw denied(503, 'MANAGED_BLOB_TRANSFER_BUSY')
    }
  }
  throw denied(503, 'MANAGED_BLOB_TRANSFER_BUSY')
}

export async function assertTransferReady(tx, fence, { expectedGeneration, exceptJobId } = {}) {
  if (!fence || fence.mode !== 'READY' || fence.generation < 1) throw denied(503, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
  if (expectedGeneration !== undefined && fence.generation !== expectedGeneration) throw denied(409, 'MANAGED_BLOB_TRANSFER_TARGET_CHANGED')
  const recovery = await tx.managedBlobRecoveryOperation.count({ where: { unresolved: true } })
  const transfer = await tx.managedBlobBackupTransferJob.count({ where: {
    unresolved: true, ...(exceptJobId ? { id: { not: exceptJobId } } : {}),
  } })
  if (recovery || transfer) throw denied(409, 'MANAGED_BLOB_TRANSFER_BUSY')
  return fence
}

export async function reserveTransferPayload(tx, jobId, requestedBytes, quotaBytes) {
  if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0
    || !Number.isSafeInteger(quotaBytes) || quotaBytes < requestedBytes) throw denied(503, 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE')
  const jobs = await tx.managedBlobBackupTransferJob.findMany({ where: { spoolReservedBytes: { gt: 0 } }, select: { id: true, spoolReservedBytes: true } })
  const total = jobs.reduce((sum, job) => sum + job.spoolReservedBytes, 0)
  if (!Number.isSafeInteger(total) || total + requestedBytes > quotaBytes) throw denied(429, 'MANAGED_BLOB_TRANSFER_QUOTA')
  return tx.managedBlobBackupTransferJob.update({ where: { id: jobId }, data: { spoolReservedBytes: requestedBytes, version: { increment: 1 } } })
}

export async function updateTransferJob(tx, job, data) {
  const changed = await tx.managedBlobBackupTransferJob.updateMany({ where: { id: job.id, version: job.version },
    data: { ...data, version: { increment: 1 } } })
  if (changed.count !== 1) throw denied(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
  return tx.managedBlobBackupTransferJob.findUnique({ where: { id: job.id } })
}

export async function beginManagedBlobTransferRestore(db, { jobId, actorId, expectedJobVersion, expectedGeneration,
  operatorProof, admission, restoreRemountsJson } = {}) {
  return withManagedBlobTransferTransaction(db, async (tx, { fence }) => {
    await assertManagedBlobTransferOperator(tx, operatorProof)
    const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
    if (!job || job.kind !== 'RESTORE' || job.actorId !== actorId) throw denied(404, 'MANAGED_BLOB_TRANSFER_NOT_FOUND')
    if (job.state !== 'PREVIEWED' || job.version !== expectedJobVersion || job.generation !== expectedGeneration
      || job.expiresAt <= new Date() || !job.unresolved || !admission?.admissionId) throw denied(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
    const usedAdmission = await tx.managedBlobBackupTransferJob.findUnique({ where: { admissionId: admission.admissionId } })
    if (usedAdmission) throw denied(409, 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED')
    await assertTransferReady(tx, fence, { expectedGeneration, exceptJobId: job.id })
    await recordAudit(tx, { entityType: 'OPERATOR_ACTION', entityId: 'local', action: 'TRANSFER_RESTORE_CONFIRM',
      actorId, payload: { transferJobId: job.id, sourceGeneration: job.sourceGeneration,
        targetGeneration: expectedGeneration, remountCount: JSON.parse(restoreRemountsJson || '[]').length } })
    const restoreAttemptId = randomUUID()
    const workerId = randomUUID()
    const changedFence = await tx.managedBlobRecoveryInstallationFence.updateMany({
      where: { id: RECOVERY_FENCE_ID, mode: 'READY', generation: expectedGeneration },
      data: { mode: 'RESTORING', generation: { increment: 1 }, version: { increment: 1 }, restoreAttemptId },
    })
    if (changedFence.count !== 1) throw denied(409, 'MANAGED_BLOB_TRANSFER_TARGET_CHANGED')
    const changedJob = await tx.managedBlobBackupTransferJob.updateMany({
      where: { id: job.id, version: job.version, kind: 'RESTORE', state: 'PREVIEWED', unresolved: true },
      data: { state: 'RESTORING', generation: expectedGeneration + 1, restoreAttemptId,
        admissionJson: JSON.stringify(admission), admissionId: admission.admissionId,
        restoreRemountsJson: restoreRemountsJson || '[]', auditCount: { increment: 1 },
        restoreClaimedAt: new Date(), attempts: { increment: 1 }, workerId, epoch: { increment: 1 },
        leaseExpiresAt: new Date(Date.now() + MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS), version: { increment: 1 } },
    })
    if (changedJob.count !== 1) throw denied(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
    const claimed = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: job.id } })
    return { transferJobId: job.id, generation: expectedGeneration + 1, restoreAttemptId,
      workerId, epoch: claimed.epoch }
  })
}

// A crashed worker may be replaced only after its lease expires and only when
// every provider intent is either untouched or already verified. Ambiguous
// WRITING/WRITTEN entries require inspect() to reconcile the exact target key;
// this function never authorizes another PUT for them.
export async function resumeManagedBlobTransferRestore(db, { jobId, actorId, expectedJobVersion, operatorProof } = {}) {
  return withManagedBlobTransferTransaction(db, async (tx, { fence }) => {
    await assertManagedBlobTransferOperator(tx, operatorProof)
    const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
    if (!job || job.kind !== 'RESTORE' || job.actorId !== actorId) throw denied(404, 'MANAGED_BLOB_TRANSFER_NOT_FOUND')
    if (!['RESTORING', 'UNKNOWN'].includes(job.state) || job.version !== expectedJobVersion
      || !job.unresolved || !job.restoreAttemptId || fence.mode !== 'RESTORING'
      || fence.generation !== job.generation || fence.restoreAttemptId !== job.restoreAttemptId) {
      throw denied(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
    }
    const now = new Date()
    if (job.workerId && job.leaseExpiresAt && job.leaseExpiresAt > now) return { active: true, job }
    const entries = await tx.managedBlobBackupTransferEntry.findMany({ where: { jobId } })
    if (!entries.length || entries.some(entry => entry.state !== 'VERIFIED'
      && !(entry.state === 'PENDING' && entry.attempts === 0 && !entry.targetRef))) {
      throw denied(409, 'MANAGED_BLOB_TRANSFER_RECONCILIATION_REQUIRED')
    }
    const workerId = randomUUID()
    const changed = await tx.managedBlobBackupTransferJob.updateMany({
      where: { id: job.id, version: job.version, state: job.state, workerId: job.workerId,
        leaseExpiresAt: job.leaseExpiresAt, restoreAttemptId: job.restoreAttemptId },
      data: { state: 'RESTORING', workerId, epoch: { increment: 1 },
        restoreClaimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + MANAGED_BLOB_TRANSFER_WORKER_LEASE_MS),
        outcomeJson: JSON.stringify({ outcome: 'RESTORE_RESUMED' }), version: { increment: 1 } },
    })
    if (changed.count !== 1) throw denied(409, 'MANAGED_BLOB_TRANSFER_JOB_CHANGED')
    const claimed = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: job.id } })
    return { active: false, transferJobId: job.id, generation: job.generation,
      restoreAttemptId: job.restoreAttemptId, workerId, epoch: claimed.epoch }
  })
}

export function transferJobDTO(job) {
  if (!job) return null
  let counts = null, outcome = null
  try { counts = job.countsJson ? JSON.parse(job.countsJson) : null } catch {}
  try { outcome = job.outcomeJson ? JSON.parse(job.outcomeJson)?.outcome ?? null : null } catch {}
  return Object.freeze({
    jobId: job.id, kind: job.kind, jobVersion: job.version, generation: job.generation,
    state: job.state, snapshotSha256: job.snapshotSha256 || null, packageSha256: job.packageSha256 || null,
    counts, expiresAt: job.expiresAt?.toISOString?.() || null, outcome,
    resumeAvailable: job.kind === 'RESTORE' && Boolean(job.restoreAttemptId) && job.unresolved
      && Boolean(job.admissionJson) && ['RESTORING', 'UNKNOWN', 'METADATA_COMMITTED'].includes(job.state),
    cleanupPending: job.cleanupState === 'ABANDON_PENDING' || job.state === 'ERASURE_CLEANUP_PENDING',
    retryable: false,
  })
}
