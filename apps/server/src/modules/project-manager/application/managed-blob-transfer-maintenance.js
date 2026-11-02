// @req FR-293 — private transfer payload retention is bounded and auditable.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import prisma from '@/lib/db'
import { createManagedBlobTransferSpool } from './managed-blob-transfer-spool'
import { recordAudit } from './audit'
import { updateTransferJob, withManagedBlobTransferTransaction } from './managed-blob-transfer-repository'

const BATCH_SIZE = 64
const SAFE_TERMINAL_STATES = ['COMPLETE', 'NEEDS_ADMISSION', 'FAILED', 'ABANDONED']

function requireDirectory(value) {
  if (typeof value !== 'string' || !value || !(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value))) {
    throw Object.assign(new Error('Managed blob transfer maintenance unavailable'), { code: 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE' })
  }
  return value
}

export async function maintainManagedBlobTransferCustody({ db = prisma, dataDirectory, clock = () => Date.now() } = {}) {
  const spool = createManagedBlobTransferSpool(requireDirectory(dataDirectory))
  const now = new Date(clock())
  const claims = await withManagedBlobTransferTransaction(db, async tx => {
    const interruptedUploads = await tx.managedBlobBackupTransferJob.findMany({ where: {
      kind: 'RESTORE', state: 'PREPARED', unresolved: true, attempts: 0, restoreAttemptId: null,
      OR: [
        { workerId: { not: null }, leaseExpiresAt: { lte: now } },
        // Recover PREPARED rows created by an earlier runtime which did not
        // persist an upload lease. expiresAt is the finite compatibility bound.
        { leaseExpiresAt: null, expiresAt: { lte: now } },
      ],
    }, take: BATCH_SIZE, orderBy: { expiresAt: 'asc' } })
    for (const job of interruptedUploads) {
      if ((job.spoolId && job.spoolId !== job.id) || job.cleanupState !== 'NONE') continue
      const entries = await tx.managedBlobBackupTransferEntry.findMany({ where: { jobId: job.id } })
      if (entries.length !== 0) continue
      const claimed = await updateTransferJob(tx, job, { state: 'ABANDONED', unresolved: true,
        cleanupState: 'ABANDON_PENDING', spoolId: job.id, spoolSha256: null, spoolBytes: 0,
        confirmationDigest: null, workerId: null, leaseExpiresAt: null, closedAt: now,
        outcomeJson: JSON.stringify({ outcome: 'INTERRUPTED_PREVIEW', cleanup: 'PENDING' }) })
      await recordAudit(tx, { entityType: 'SNAPSHOT', entityId: job.id, action: 'TRANSFER_PREVIEW_INTERRUPTED',
        actorId: job.actorId, payload: { payloadCleanupPending: true } })
      interruptedUploads[interruptedUploads.indexOf(job)] = claimed
    }

    const expiredPreviews = await tx.managedBlobBackupTransferJob.findMany({ where: {
      state: 'PREVIEWED', unresolved: true, attempts: 0, restoreAttemptId: null,
      workerId: null, leaseExpiresAt: null, expiresAt: { lte: now },
    }, take: BATCH_SIZE, orderBy: { expiresAt: 'asc' } })

    for (const job of expiredPreviews) {
      const entries = await tx.managedBlobBackupTransferEntry.findMany({ where: { jobId: job.id } })
      // PREVIEWED has not crossed the replace-all boundary only while every
      // object remains an untouched intent. Anything else stays quarantined.
      if (job.spoolId !== job.id || entries.length === 0 || entries.some(entry => entry.state !== 'PENDING' || entry.attempts !== 0
        || entry.targetRef || entry.workerId || entry.leaseExpiresAt)) continue
      await tx.managedBlobBackupTransferEntry.updateMany({ where: { jobId: job.id,
        state: 'PENDING', attempts: 0, unresolved: true }, data: {
        state: 'ABANDONED', unresolved: false, closedAt: now, workerId: null, leaseExpiresAt: null,
      } })
      const closed = await updateTransferJob(tx, job, { state: 'ABANDONED', unresolved: true,
        cleanupState: 'ABANDON_PENDING', confirmationDigest: null,
        outcomeJson: JSON.stringify({ outcome: 'EXPIRED', cleanup: 'PENDING' }), closedAt: now })
      await recordAudit(tx, { entityType: 'SNAPSHOT', entityId: job.id, action: 'TRANSFER_PREVIEW_EXPIRED',
        actorId: job.actorId, payload: { entryCount: entries.length, payloadCleanupPending: Boolean(job.spoolId) } })
      expiredPreviews[expiredPreviews.indexOf(job)] = closed
    }

    const eligible = await tx.managedBlobBackupTransferJob.findMany({ where: {
      spoolId: { not: null }, workerId: null, leaseExpiresAt: null,
      OR: [
        { state: { in: SAFE_TERMINAL_STATES }, unresolved: false, byteDeadline: { lte: now } },
        { state: 'ABANDONED', unresolved: false },
        { state: 'ABANDONED', unresolved: true, cleanupState: 'ABANDON_PENDING' },
        // Principal erasure already committed. This exact package name is the
        // only byte custody the pending erasure cleanup may unlink.
        { state: 'ERASURE_CLEANUP_PENDING', actorId: null },
      ],
    }, take: BATCH_SIZE, orderBy: { byteDeadline: 'asc' } })
    const byId = new Map([...interruptedUploads.filter(job => job.cleanupState === 'ABANDON_PENDING'),
      ...expiredPreviews.filter(job => job.spoolId === job.id), ...eligible].map(job => [job.id, job]))
    return [...byId.values()]
  })

  let removed = 0, retained = 0
  for (const claim of claims) {
    // The only supported spool id is the row's UUID. Never follow DB-provided
    // paths or clear quota for a differently named object.
    if (claim.spoolId !== claim.id) { retained++; continue }
    try { await spool.remove(claim.id) } catch { retained++; continue }
    const cleared = await withManagedBlobTransferTransaction(db, async tx => {
      const current = await tx.managedBlobBackupTransferJob.findUnique({ where: { id: claim.id } })
      if (!current || current.version !== claim.version || current.spoolId !== claim.id
        || current.workerId || current.leaseExpiresAt) return false
      const abandonCleanupPending = current.state === 'ABANDONED' && current.cleanupState === 'ABANDON_PENDING'
      if (current.state === 'ERASURE_CLEANUP_PENDING') {
        if (current.actorId !== null) return false
        await tx.managedBlobBackupTransferEntry.deleteMany({ where: { jobId: current.id } })
      }
      await recordAudit(tx, { entityType: 'SNAPSHOT', entityId: current.id,
        action: current.state === 'ERASURE_CLEANUP_PENDING' ? 'TRANSFER_ERASURE_CUSTODY_CLEARED'
          : abandonCleanupPending ? 'TRANSFER_ABANDON_CUSTODY_CLEARED' : 'TRANSFER_PAYLOAD_EXPIRED',
        actorId: current.actorId, payload: { payloadBytesRemoved: current.spoolBytes, kind: current.kind } })
      let priorOutcome = current.state
      try { priorOutcome = JSON.parse(current.outcomeJson || '{}').outcome || current.state } catch {}
      await updateTransferJob(tx, current, { ...(current.state === 'ERASURE_CLEANUP_PENDING'
        ? { state: 'ABANDONED', unresolved: false, outcomeJson: JSON.stringify({ outcome: 'ERASURE_CUSTODY_CLEARED' }) }
        : abandonCleanupPending
          ? { unresolved: false, cleanupState: 'COMPLETE', outcomeJson: JSON.stringify({ outcome: priorOutcome, cleanup: 'COMPLETE' }) }
          : { outcomeJson: JSON.stringify({ outcome: priorOutcome, cleanup: 'COMPLETE' }) }),
      spoolId: null, spoolSha256: null, packageSha256: current.state === 'NEEDS_ADMISSION' ? current.packageSha256 : null,
      spoolBytes: 0, spoolReservedBytes: 0, confirmationDigest: null, countsJson: null,
      snapshotSpoolBytes: 0, restoreRemountsJson: null, resultJson: null,
      snapshotSha256: current.state === 'NEEDS_ADMISSION' ? current.snapshotSha256 : null,
      sourceConfigHash: null, sourceRevision: null, admissionJson: current.state === 'NEEDS_ADMISSION' ? current.admissionJson : null,
      resultJson: current.state === 'NEEDS_ADMISSION' ? current.resultJson : null,
      })
      return true
    })
    if (cleared) removed++
    else retained++
  }
  return { examined: claims.length, payloadsRemoved: removed, retainedForReconciliation: retained }
}

let maintenanceState
export function startManagedBlobTransferMaintenance({ dataDirectory = process.env.ZURI_MANAGED_BLOB_TRANSFER_DATA_DIRECTORY,
  run = maintainManagedBlobTransferCustody, intervalMs = 60_000 } = {}) {
  if (maintenanceState || !dataDirectory) return false
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) return false
  const state = { stopped: false, timer: null }
  maintenanceState = state
  const tick = async () => {
    if (state.stopped) return
    try {
      const result = await run({ dataDirectory })
      if (result.payloadsRemoved || result.retainedForReconciliation) {
        console.info('[managed-blob-transfer-maintenance]', {
          payloadsRemoved: result.payloadsRemoved, retainedForReconciliation: result.retainedForReconciliation,
        })
      }
    } catch (error) {
      const code = /^MANAGED_BLOB_TRANSFER_[A-Z_]+$/.test(error?.code || '') ? error.code : 'MAINTENANCE_UNAVAILABLE'
      console.warn('[managed-blob-transfer-maintenance]', { code })
    } finally {
      if (!state.stopped) {
        state.timer = setTimeout(tick, intervalMs)
        state.timer.unref?.()
      }
    }
  }
  state.timer = setTimeout(tick, 0)
  state.timer.unref?.()
  return true
}
