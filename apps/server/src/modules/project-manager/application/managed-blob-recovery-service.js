// @req FR-292 — authorized preparation input from persisted session and file scope.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-recovery.test.js
import prisma from '@/lib/db'
import { AUTH_SESSION_COOKIE, hashSessionToken, requireSessionSecret, verifySessionToken } from '@/modules/identity/auth-service'
import { readRequestCookie } from '@/modules/identity/session-port'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { createPrivateBusinessObjectStoragePort } from '@/platform/storage/private-business-object-storage'
import { recoveryDescriptorForFile, parseRecoveryRequest, recoveryError } from './managed-blob-recovery-contract'
import { isPostgres } from './pipeline-writer'
export { createManagedBlobRecoveryService } from './managed-blob-recovery-custody'

// This is a read-only input builder, deliberately not the proposed HTTP create-
// operation handler. No operation ID, PREPARED state, quota reservation, token or
// expiry is issued. OR2 must reauthorize under its native fence and durably record
// intent before any staging/IO; this returned value grants no future action.
export async function readManagedBlobRecoveryPreparation({ request, fileId, input }, { db = prisma, env = process.env } = {}) {
  try {
    const token = readRequestCookie(request, AUTH_SESSION_COOKIE)
    if (typeof token !== 'string' || token.length > 4096 || token.split('.').length !== 3) throw recoveryError(401, 'AUTH_REQUIRED')
    const identity = verifySessionToken(token, { secret: requireSessionSecret(env) })
    if (!identity?.sessionId) throw recoveryError(401, 'AUTH_REQUIRED')
    const value = parseRecoveryRequest('prepare', input)
    return await db.$transaction(async tx => {
      const [session, person, file] = await Promise.all([
        tx.session.findUnique({ where: { id: identity.sessionId } }),
        tx.person.findUnique({ where: { id: identity.principalId } }),
        tx.fileAsset.findUnique({ where: { id: typeof fileId === 'string' ? fileId : '' } }),
      ])
      const now = new Date()
      if (!session || session.personId !== identity.principalId || session.tokenHash !== hashSessionToken(token)
        || session.status !== 'ACTIVE' || session.revokedAt != null || session.expiresAt <= now
        || !person || person.accessDisabledAt != null) throw recoveryError(401, 'AUTH_REQUIRED')
      const denied = () => recoveryError(404, 'MANAGED_BLOB_RECOVERY_NOT_FOUND')
      if (!file || file.deletedAt != null || file.status !== 'ACTIVE') throw denied()
      const [tenant, business] = await Promise.all([
        tx.tenant.findUnique({ where: { id: file.tenantId } }),
        tx.business.findUnique({ where: { id: file.businessId } }),
      ])
      if (tenant?.status !== 'ACTIVE' || business?.status !== 'ACTIVE' || business.tenantId !== tenant.id) throw denied()
      // No trusted-Viewer injection, platform/operator flag or role-binding
      // shortcut. Reuse Identity's direct/Tenant OWNER compatibility predicate.
      const viewer = await resolveViewer({ principalId: person.id, db: tx, now })
      if (!ownsBusiness(viewer, business.id)) throw denied()
      // The general Viewer expands Business IDs for navigation. Recovery also
      // needs a qualifying persisted witness in this exact Tenant/Business;
      // inconsistent legacy rows cannot turn a foreign Tenant into authority.
      const witnesses = await tx.membership.findMany({ where: {
        personId: person.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE',
      } })
      const decisionTime = isPostgres(db)
        ? new Date((await tx.$queryRawUnsafe('SELECT clock_timestamp() AS "now"'))[0].now)
        : new Date()
      if (!Number.isFinite(decisionTime.getTime()) || session.expiresAt <= decisionTime
        || identity.expiresAt * 1000 <= decisionTime.getTime()) throw recoveryError(401, 'AUTH_REQUIRED')
      if (!witnesses.some(witness => (witness.expiresAt == null || witness.expiresAt > decisionTime)
        && (witness.businessId === business.id && witness.scopeType === 'BUSINESS'
          || witness.businessId == null && ['TENANT', 'BUSINESS'].includes(witness.scopeType)))) throw denied()
      if (file.version !== value.expectedVersion) throw recoveryError(409, 'MANAGED_BLOB_RECOVERY_CONFLICT')
      const descriptor = recoveryDescriptorForFile(file)
      const port = createPrivateBusinessObjectStoragePort(descriptor.purpose, env)
      port.validateRef({ ref: file.blobRef, tenantId: file.tenantId, businessId: file.businessId })
      return Object.freeze({ descriptor })
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error?.message === 'Recovery request refused') throw error
    throw recoveryError(503, 'MANAGED_BLOB_RECOVERY_UNAVAILABLE')
  }
}
