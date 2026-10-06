// @tested tests/unit/marketing-report-wire.test.js, tests/integration/marketing-report-native.test.js
// @req FR-281 — trusted installation-operator commands; no browser secret surface.
// @spec SDD-112, ZURI-GO-REPORT-PHYSICAL-DESIGN
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { isInstallationOperator } from '../../identity/viewer-authority.js'
import { recordAudit } from '../../project-manager/application/audit.js'
import { reportError } from './marketing-report-wire.js'

function operator(viewer) {
  if (!isInstallationOperator(viewer)) throw reportError(403, 'REPORT_OPERATOR_REQUIRED')
}
const version = value => Number.isSafeInteger(value) && value >= 0 && value < 2147483647
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const safe = (value, pattern) => typeof value === 'string' && pattern.test(value)
async function audit(tx, viewer, business, entityType, entityId, action, payload) {
  await recordAudit(tx, { tenantId: business.tenantId, businessId: business.id, entityType, entityId, action, actorId: viewer.principal?.id ?? null, payload })
}

export async function setMarketingReportPolicy({ db, viewer, businessId, expectedVersion, ingestEnabled }) {
  operator(viewer)
  if (!safe(businessId, UUID) || !version(expectedVersion) || typeof ingestEnabled !== 'boolean') throw reportError(422, 'REPORT_POLICY_INVALID')
  return db.$transaction(async tx => {
    const business = await tx.business.findUnique({ where: { id: businessId } })
    if (!business) throw reportError(404, 'REPORT_SCOPE_UNAVAILABLE')
    const existing = await tx.marketingReportPolicy.findUnique({ where: { businessId } })
    if (!existing) {
      // An absent policy can only be provisioned disabled. Enabling is a
      // separate expected-version command, never an implicit credential grant.
      if (expectedVersion !== 0 || ingestEnabled) throw reportError(409, 'REPORT_POLICY_CONFLICT')
      const policy = await tx.marketingReportPolicy.create({ data: { businessId, tenantId: business.tenantId, ingestEnabled: false } })
      await audit(tx, viewer, business, 'MARKETING_REPORT_POLICY', businessId, 'CREATED_DISABLED', { version: 1 })
      return policy
    }
    if (existing.version !== expectedVersion) throw reportError(409, 'REPORT_POLICY_CONFLICT')
    if (existing.ingestEnabled === ingestEnabled) return existing
    const changed = await tx.marketingReportPolicy.updateMany({ where: { businessId, version: expectedVersion }, data: { ingestEnabled, version: { increment: 1 } } })
    if (changed.count !== 1) throw reportError(409, 'REPORT_POLICY_CONFLICT')
    await audit(tx, viewer, business, 'MARKETING_REPORT_POLICY', businessId, ingestEnabled ? 'ENABLED' : 'DISABLED', { fromVersion: expectedVersion, version: expectedVersion + 1 })
    return tx.marketingReportPolicy.findUnique({ where: { businessId } })
  })
}

export async function createMarketingReportBinding({ db, viewer, businessId, sourceDeploymentId, sourceBusinessId }) {
  operator(viewer)
  if (!safe(businessId, UUID) || !safe(sourceBusinessId, UUID) || !safe(sourceDeploymentId, ID)) throw reportError(422, 'REPORT_BINDING_INVALID')
  const credential = 'zmr_' + randomBytes(32).toString('base64url')
  const keyHash = createHash('sha256').update(credential, 'utf8').digest('hex')
  const binding = await db.$transaction(async tx => {
    const policy = await tx.marketingReportPolicy.findUnique({ where: { businessId }, include: { business: true } })
    if (!policy || policy.tenantId !== policy.business.tenantId) throw reportError(404, 'REPORT_SCOPE_UNAVAILABLE')
    const created = await tx.marketingReportBinding.create({ data: { id: randomUUID(), keyHash, businessId, tenantId: policy.tenantId, sourceDeploymentId, sourceBusinessId } })
    await audit(tx, viewer, policy.business, 'MARKETING_REPORT_BINDING', created.id, 'CREATED', { bindingId: created.id, sourceDeploymentId, sourceBusinessId })
    const { keyHash: privateHash, ...handover } = created
    return handover
  })
  // Private server/operator handover only, once and after commit. No route
  // returns this result, and neither plaintext nor hash is written to audit.
  return { binding, credential }
}

export async function revokeMarketingReportBinding({ db, viewer, bindingId, expectedVersion }) {
  operator(viewer)
  if (!safe(bindingId, UUID) || !version(expectedVersion) || expectedVersion < 1) throw reportError(422, 'REPORT_BINDING_INVALID')
  return db.$transaction(async tx => {
    const binding = await tx.marketingReportBinding.findUnique({ where: { id: bindingId }, include: { policy: { include: { business: true } } } })
    if (!binding || binding.status !== 'ACTIVE' || binding.version !== expectedVersion) throw reportError(409, 'REPORT_BINDING_CONFLICT')
    const changed = await tx.marketingReportBinding.updateMany({ where: { id: bindingId, version: expectedVersion, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date(), version: { increment: 1 } } })
    if (changed.count !== 1) throw reportError(409, 'REPORT_BINDING_CONFLICT')
    await audit(tx, viewer, binding.policy.business, 'MARKETING_REPORT_BINDING', binding.id, 'REVOKED', { bindingId, fromVersion: expectedVersion, version: expectedVersion + 1 })
    return { bindingId, status: 'REVOKED', version: expectedVersion + 1 }
  })
}
