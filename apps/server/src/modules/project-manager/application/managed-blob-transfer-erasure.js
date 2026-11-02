// @req FR-022, FR-293 — transfer custody follows principal erasure and never retains an actor handle.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { isPostgres } from './pipeline-writer'
import { RECOVERY_MUTEX } from './managed-blob-recovery-lock'
import { createManagedBlobTransferSpool } from './managed-blob-transfer-spool'
import { recordAudit } from './audit'

const FENCE_ID = 'installation'
const refuse = () => Object.assign(new Error('Managed blob transfer custody is unresolved.'),
  { status: 409, code: 'MANAGED_BLOB_TRANSFER_ERASURE_CUSTODY_OPEN' })

async function lockTransferFence(tx) {
  if (isPostgres(tx)) {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1::int,$2::int)::text AS locked', ...RECOVERY_MUTEX)
    await tx.$queryRawUnsafe('SELECT "id" FROM "ManagedBlobRecoveryInstallationFence" WHERE "id"=$1 FOR UPDATE', FENCE_ID)
  }
  const fence = await tx.managedBlobRecoveryInstallationFence.findUnique({ where: { id: FENCE_ID } })
  if (!fence) return
  await tx.managedBlobRecoveryInstallationFence.update({ where: { id: FENCE_ID }, data: { version: { increment: 1 } } })
}

// Runs inside Identity's existing principal-erasure transaction. A running or
// ambiguous job blocks erasure until its exact external custody is resolved.
// Resolved packages move to a non-actor cleanup state; payload deletion is an
// exact post-commit unlink followed by an audited journal close.
export async function redactManagedBlobTransferActor(tx, personId) {
  if (!tx || typeof personId !== 'string' || !personId) throw refuse()
  await lockTransferFence(tx)
  const jobs = await tx.managedBlobBackupTransferJob.findMany({ where: { actorId: personId },
    orderBy: { createdAt: 'asc' } })
  if (jobs.some(job => ['PREPARED', 'COPYING', 'RESTORING', 'UNKNOWN', 'METADATA_COMMITTED', 'ERASURE_CLEANUP_PENDING'].includes(job.state)
    && (job.unresolved || job.state === 'ERASURE_CLEANUP_PENDING'))) throw refuse()

  const cleanupJobIds = []
  for (const job of jobs) {
    if (job.spoolId) {
      await tx.managedBlobBackupTransferJob.update({ where: { id: job.id }, data: { actorId: null,
        state: 'ERASURE_CLEANUP_PENDING', unresolved: true, workerId: null, leaseExpiresAt: null,
        confirmationDigest: null, outcomeJson: JSON.stringify({ outcome: 'ERASURE_CLEANUP_PENDING' }),
        version: { increment: 1 } } })
      cleanupJobIds.push(job.id)
    } else {
      await tx.managedBlobBackupTransferJob.update({ where: { id: job.id }, data: { actorId: null, version: { increment: 1 } } })
    }
  }
  if (jobs.length) await recordAudit(tx, { entityType: 'SNAPSHOT', entityId: 'managed-blob-transfer-erasure',
    action: 'TRANSFER_ERASURE_CUSTODY_PENDING', actorId: null,
    payload: { jobsRedacted: jobs.length, payloadCleanupPending: cleanupJobIds.length } })
  return { redactedJobs: jobs.length, cleanupJobIds }
}

export async function completeManagedBlobTransferErasureCleanup(db, { jobId, dataDirectory } = {}) {
  const spool = createManagedBlobTransferSpool(dataDirectory)
  await spool.remove(jobId)
  return db.$transaction(async tx => {
    const job = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } })
    if (!job || job.state !== 'ERASURE_CLEANUP_PENDING' || job.actorId !== null) return false
    await tx.managedBlobBackupTransferEntry.deleteMany({ where: { jobId } })
    const changed = await tx.managedBlobBackupTransferJob.updateMany({ where: { id: jobId,
      state: 'ERASURE_CLEANUP_PENDING', actorId: null }, data: { state: 'ABANDONED', unresolved: false,
      spoolId: null, spoolSha256: null, packageSha256: null, spoolBytes: 0, spoolReservedBytes: 0,
      confirmationDigest: null, countsJson: null, admissionJson: null,
      restoreRemountsJson: null, resultJson: null,
      outcomeJson: JSON.stringify({ outcome: 'ERASURE_CUSTODY_CLEARED' }),
      snapshotSha256: null, sourceConfigHash: null, sourceRevision: null,
      closedAt: new Date(), version: { increment: 1 } } })
    if (changed.count !== 1) return false
    await recordAudit(tx, { entityType: 'SNAPSHOT', entityId: jobId, action: 'TRANSFER_ERASURE_CUSTODY_CLEARED',
      actorId: null, payload: { payloadBytesRemoved: job.spoolBytes } })
    return true
  }, { isolationLevel: 'Serializable' })
}
