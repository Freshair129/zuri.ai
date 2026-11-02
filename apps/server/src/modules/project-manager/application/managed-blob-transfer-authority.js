// @req FR-293 — only the transfer orchestrator can carry the validated backup exception.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { isPostgres } from './pipeline-writer'

const snapshotPermits = new WeakMap()
const importPermits = new WeakMap()

export function createManagedBlobTransferSnapshotPermit(jobId) {
  if (typeof jobId !== 'string' || !jobId) throw new Error('Managed blob transfer refused')
  const permit = Object.freeze(Object.create(null))
  snapshotPermits.set(permit, jobId)
  return permit
}

export function managedBlobTransferSnapshotPermitJob(permit) {
  return permit && snapshotPermits.get(permit) || null
}

export function createManagedBlobTransferImportPermit({ jobId, snapshot, restoreClaim, operatorProof,
  workerId, workerEpoch, expectedJobVersion, snapshotSha256, packageSha256, admissionSha256 } = {}) {
  if (typeof jobId !== 'string' || !jobId || !snapshot || typeof snapshot !== 'object'
    || !restoreClaim || typeof restoreClaim.restoreAttemptId !== 'string' || !operatorProof
    || typeof workerId !== 'string' || !Number.isSafeInteger(workerEpoch) || !Number.isSafeInteger(expectedJobVersion)) {
    throw new Error('Managed blob transfer refused')
  }
  const permit = Object.freeze(Object.create(null))
  importPermits.set(permit, Object.freeze({ jobId, snapshot, restoreClaim, operatorProof, workerId, workerEpoch, expectedJobVersion,
    snapshotSha256, packageSha256, admissionSha256 }))
  return permit
}

export function managedBlobTransferImportState(snapshot, permit) {
  const state = permit && importPermits.get(permit)
  return state?.snapshot === snapshot ? state : null
}

// Re-read the exact current persisted session and operator grant inside the
// replacement transaction. The request viewer and clear cookie are never
// portable job authority.
export async function assertManagedBlobTransferOperator(tx, proof) {
  if (!proof || typeof proof.actorId !== 'string' || typeof proof.sessionId !== 'string'
    || typeof proof.grantId !== 'string' || !/^[a-f0-9]{64}$/.test(proof.tokenHash || '')
    || !Number.isFinite(proof.tokenExpiresAt)) throw Object.assign(new Error('Managed blob transfer refused'), { status: 401, code: 'AUTH_REQUIRED' })
  const postgres = isPostgres(tx)
  if (postgres) {
    await tx.$queryRawUnsafe('SELECT "id" FROM "Session" WHERE "id"=$1 FOR UPDATE', proof.sessionId)
    await tx.$queryRawUnsafe('SELECT "id" FROM "Person" WHERE "id"=$1 FOR UPDATE', proof.actorId)
    await tx.$queryRawUnsafe('SELECT "id" FROM "PlatformGrant" WHERE "id"=$1 FOR UPDATE', proof.grantId)
  }
  const now = postgres
    ? new Date((await tx.$queryRawUnsafe('SELECT clock_timestamp() AS "now"'))[0].now)
    : new Date()
  const [session, person, grant] = await Promise.all([
    tx.session.findUnique({ where: { id: proof.sessionId } }),
    tx.person.findUnique({ where: { id: proof.actorId } }),
    tx.platformGrant.findUnique({ where: { id: proof.grantId } }),
  ])
  const live = session && session.personId === proof.actorId && session.tokenHash === proof.tokenHash
    && session.status === 'ACTIVE' && !session.revokedAt && session.expiresAt > now
    && proof.tokenExpiresAt > now.getTime()
    && person && person.accessDisabledAt == null
    && grant && grant.personId === proof.actorId && grant.capability === 'OPERATOR' && grant.status === 'ACTIVE'
    && !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now)
  if (!live) throw Object.assign(new Error('Managed blob transfer refused'), { status: 401, code: 'AUTH_REQUIRED' })
  return true
}
