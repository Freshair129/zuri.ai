// @req FR-292, FR-293 — durable installation exclusion and native authority ordering.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-recovery-custody.test.js
import { isPostgres } from './pipeline-writer'
import { recoveryError } from './managed-blob-recovery-contract'
import { randomUUID } from 'node:crypto'
import { RECOVERY_MUTEX, hasReadOnlyRecoveryFence } from './managed-blob-recovery-lock'

export const RECOVERY_FENCE_ID = 'installation'
const tables = new Set(['Tenant', 'Business', 'Person', 'Membership', 'Session', 'ManagedBlobRecoveryOperation', 'FileAsset'])
export async function lockRecoveryRow(tx, table, id, postgres) {
  if (!tables.has(table) || typeof id !== 'string') throw recoveryError()
  if (postgres) await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id"=$1 FOR UPDATE`, id)
}
export async function recoveryNow(tx, postgres) {
  return postgres ? new Date((await tx.$queryRawUnsafe('SELECT clock_timestamp() AS "now"'))[0].now) : new Date()
}

export async function commitRecoveryFileCAS(tx, { file, descriptor: d, ref, identity, witnessIds }, postgres) {
  if (!postgres) {
    const now = new Date()
    const session = await tx.session.findFirst({ where: { id: identity.sessionId, personId: identity.principalId,
      tokenHash: identity.tokenHash, status: 'ACTIVE', revokedAt: null, expiresAt: { gt: now } } })
    const witness = await tx.membership.findFirst({ where: { id: { in: witnessIds }, role: 'OWNER', status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } })
    if (!session || identity.expiresAt * 1000 <= now.getTime()) throw recoveryError(401, 'AUTH_REQUIRED')
    if (!witness) throw recoveryError(404, 'MANAGED_BLOB_RECOVERY_NOT_FOUND')
    return (await tx.fileAsset.updateMany({ where: { id: file.id, version: d.fileVersion, status: 'ACTIVE', deletedAt: null,
      tenantId: d.tenantId, businessId: d.businessId, storageKind: 'MANAGED_BLOB', blobRef: file.blobRef, sha256: d.sha256, size: d.byteLength },
    data: { blobRef: ref, version: { increment: 1 } } })).count
  }
  // Prisma DateTime is TIMESTAMP WITHOUT TIME ZONE. Explicit UTC is necessary
  // even when the server/cluster session uses Asia/Bangkok. Expiry is evaluated
  // in the final CAS statement using database wall time, never BEGIN's now().
  const rows = await tx.$queryRawUnsafe(`UPDATE "FileAsset" SET "blobRef"=$1,"version"="version"+1,"updatedAt"=timezone('UTC',clock_timestamp())
    WHERE "id"=$2 AND "version"=$3 AND "status"='ACTIVE' AND "deletedAt" IS NULL
      AND "tenantId"=$4 AND "businessId"=$5 AND "storageKind"='MANAGED_BLOB' AND "blobRef"=$6 AND "sha256"=$7 AND "size"=$8
      AND EXISTS (SELECT 1 FROM "Session" s WHERE s.id=$9 AND s."personId"=$10 AND s."tokenHash"=$11
        AND s.status='ACTIVE' AND s."revokedAt" IS NULL AND s."expiresAt">timezone('UTC',clock_timestamp()))
      AND $12::double precision > extract(epoch FROM clock_timestamp())
      AND EXISTS (SELECT 1 FROM "Membership" m WHERE m.id IN (SELECT jsonb_array_elements_text($13::jsonb))
        AND m."personId"=$10 AND m."tenantId"=$4 AND m.role='OWNER' AND m.status='ACTIVE'
        AND (m."expiresAt" IS NULL OR m."expiresAt">timezone('UTC',clock_timestamp()))
        AND ((m."businessId"=$5 AND m."scopeType"='BUSINESS') OR (m."businessId" IS NULL AND m."scopeType" IN ('TENANT','BUSINESS'))))
    RETURNING "id"`, ref, file.id, d.fileVersion, d.tenantId, d.businessId, file.blobRef, d.sha256, d.byteLength,
  identity.sessionId, identity.principalId, identity.tokenHash, identity.expiresAt, JSON.stringify(witnessIds))
  return rows.length
}

// Only DB work belongs here. An aborted transaction never replays provider IO.
// Prisma's existing default 5s transaction deadline is retained.
export async function withRecoveryTransaction(db, callback) {
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
        if (!fence || fence.mode !== 'READY' || fence.generation < 1) throw recoveryError(503, 'MANAGED_BLOB_RECOVERY_NOT_ADMITTED')
        // Serializable waiters must conflict rather than commit a pre-wait snapshot.
        await tx.managedBlobRecoveryInstallationFence.update({ where: { id: fence.id }, data: { version: { increment: 1 } } })
        return callback(tx, { postgres, fence })
      }, { isolationLevel: 'Serializable' })
    } catch (error) {
      const retry = error?.code === 'P2034' || ['40001', '40P01'].includes(error?.meta?.code)
        || /serialization|could not serialize|deadlock|SQLITE_BUSY|SQLITE_LOCKED|database is locked|lock timeout/i.test(error?.message || '')
      if (!retry) throw error
      if (attempt === 2 || Date.now() >= deadline) throw recoveryError(503, 'MANAGED_BLOB_RECOVERY_BUSY')
    }
  }
  throw recoveryError(503)
}

// Called inside the snapshot's own transaction, before extraction/replacement.
// Legacy targets with no admitted recovery installation retain prior behavior.
// Recovery is still inactive: a target with any journal history is refused until
// FR-293's supported transfer and restored-generation admission are implemented.
async function snapshotFence(tx, postgres) {
  const readOnly = postgres && hasReadOnlyRecoveryFence(tx)
  if (postgres && !readOnly) {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1::int,$2::int)::text AS locked', ...RECOVERY_MUTEX)
    await tx.$queryRawUnsafe('SELECT "id" FROM "ManagedBlobRecoveryInstallationFence" WHERE "id"=$1 FOR UPDATE', RECOVERY_FENCE_ID)
  }
  else if (!postgres) await tx.$executeRawUnsafe('UPDATE "ManagedBlobRecoveryInstallationFence" SET "version"="version" WHERE "id"=?', RECOVERY_FENCE_ID)
  const fences = await tx.$queryRawUnsafe('SELECT "id","mode","generation","restoreAttemptId" FROM "ManagedBlobRecoveryInstallationFence" WHERE "id"=' + (postgres ? '$1' : '?'), RECOVERY_FENCE_ID)
  const counts = await tx.$queryRawUnsafe('SELECT COUNT(*) AS "count" FROM "ManagedBlobRecoveryOperation"')
  if (Number(counts[0].count)) throw recoveryError(409, 'MANAGED_BLOB_TRANSFER_REQUIRED')
  return fences[0] || null
}
export async function assertRecoverySnapshotQuiescent(tx, postgres) {
  const fence = await snapshotFence(tx, postgres)
  if (fence && fence.mode !== 'READY') throw recoveryError(409, 'MANAGED_BLOB_TRANSFER_REQUIRED')
  if (fence && !hasReadOnlyRecoveryFence(tx)) await tx.$executeRawUnsafe('UPDATE "ManagedBlobRecoveryInstallationFence" SET "version"="version"+1 WHERE "id"=' + (postgres ? '$1' : '?'), RECOVERY_FENCE_ID)
}

// Durable RESTORING precedes the replace-all transaction and remains in force
// through its filesystem/status postpass, even if either phase crashes.
export async function beginRecoverySnapshotRestore(db) {
  const postgres = isPostgres(db)
  return db.$transaction(async tx => {
    const fence = await snapshotFence(tx, postgres)
    if (!fence) return null
    if (fence.mode !== 'READY') throw recoveryError(409, 'MANAGED_BLOB_TRANSFER_REQUIRED')
    const restoreAttemptId = randomUUID()
    await tx.managedBlobRecoveryInstallationFence.update({ where: { id: fence.id }, data: {
      mode: 'RESTORING', generation: { increment: 1 }, version: { increment: 1 }, restoreAttemptId,
    } })
    return { generation: fence.generation + 1, restoreAttemptId }
  }, { isolationLevel: 'Serializable' })
}
export async function assertRecoveryRestoreClaim(tx, db, claim) {
  const fence = await snapshotFence(tx, isPostgres(db))
  if (!claim ? fence != null : !fence || fence.mode !== 'RESTORING' || fence.generation !== claim.generation || fence.restoreAttemptId !== claim.restoreAttemptId) {
    throw recoveryError(409, 'MANAGED_BLOB_TRANSFER_REQUIRED')
  }
}
export async function finishRecoverySnapshotRestore(db, claim) {
  if (!claim) return
  const changed = await db.managedBlobRecoveryInstallationFence.updateMany({ where: { id: RECOVERY_FENCE_ID,
    mode: 'RESTORING', generation: claim.generation, restoreAttemptId: claim.restoreAttemptId }, data: { mode: 'NEEDS_ADMISSION', version: { increment: 1 } } })
  if (changed.count !== 1) throw recoveryError(503, 'MANAGED_BLOB_RECOVERY_NOT_ADMITTED')
}
