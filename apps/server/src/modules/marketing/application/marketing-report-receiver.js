// @tested tests/unit/marketing-report-wire.test.js, tests/integration/marketing-report-native.test.js
// @req FR-281, FR-282, FR-283 — reauthorize before replay; acknowledge outer commit only.
// @spec SDD-112, ZURI-GO-REPORT-PHYSICAL-DESIGN
import { randomUUID } from 'node:crypto'
import { reportCredentialHash, parseMarketingReport, reportError } from './marketing-report-wire.js'
import { lockMarketingReportScope, lockMarketingReportTarget, marketingReportRetryable, withMarketingReportTransaction } from './marketing-report-lock.js'

export function marketingReportReceipt(report) {
  return {
    contractVersion: report.contractVersion, receiverReceiptId: report.receiverReceiptId,
    reportId: report.sourceReportId, bindingId: report.bindingId, sourceCampaignId: report.sourceCampaignId,
    targetInitiativeId: report.initiativeId, reportRevision: report.reportRevision, payloadHash: report.payloadHash,
    acceptedAt: report.acceptedAt.toISOString(), status: report.status,
  }
}

export const receiverRetryable = marketingReportRetryable

function assertCurrentBinding(binding, envelope) {
  if (!binding || binding.status !== 'ACTIVE' || binding.revokedAt !== null || binding.permission !== 'marketing.report.ingest') throw reportError(401, 'REPORT_UNAUTHORIZED')
  const business = binding.policy.business
  if (!binding.policy.ingestEnabled || binding.tenantId !== binding.policy.tenantId || binding.tenantId !== business.tenantId || binding.businessId !== business.id || business.status !== 'ACTIVE'
    || envelope.target.bindingId !== binding.id || envelope.source.system !== binding.sourceSystem || envelope.source.deploymentId !== binding.sourceDeploymentId || envelope.source.sourceBusinessId !== binding.sourceBusinessId) throw reportError(404, 'REPORT_SCOPE_UNAVAILABLE')
}

async function acceptInTransaction(tx, keyHash, envelope, canonicalEnvelope, provider) {
  if (provider === 'sqlite') await lockMarketingReportScope(tx, { provider, keyHash })
  else {
    // This immutable identity is only a lock hint, never a reusable grant.
    const hint = await tx.marketingReportBinding.findUnique({ where: { keyHash }, select: { id: true, businessId: true } })
    if (!hint) throw reportError(401, 'REPORT_UNAUTHORIZED')
    await lockMarketingReportScope(tx, { provider, businessId: hint.businessId, bindingId: hint.id })
  }
  let binding = await tx.marketingReportBinding.findUnique({
    where: { keyHash }, include: { policy: { include: { business: true } } },
  })
  assertCurrentBinding(binding, envelope)
  if (provider === 'postgresql') {
    await lockMarketingReportTarget(tx, { provider, businessId: binding.businessId, initiativeId: envelope.target.initiativeId })
    // Business/native scope can change while a target lock is awaited. Re-read
    // authority and target under the acquired locks before replay or insertion.
    binding = await tx.marketingReportBinding.findUnique({ where: { keyHash }, include: { policy: { include: { business: true } } } })
    assertCurrentBinding(binding, envelope)
  }
  const initiative = await tx.marketingInitiative.findUnique({ where: { id: envelope.target.initiativeId }, include: { plan: true } })
  if (!initiative || initiative.tenantId !== binding.tenantId || initiative.businessId !== binding.businessId || initiative.status !== 'OPEN' || initiative.deletedAt !== null
    || initiative.plan.deletedAt !== null || initiative.plan.tenantId !== binding.tenantId || initiative.plan.businessId !== binding.businessId) throw reportError(404, 'REPORT_SCOPE_UNAVAILABLE')
  const existing = await tx.marketingExternalReport.findUnique({ where: { bindingId_sourceReportId: { bindingId: binding.id, sourceReportId: envelope.reportId } } })
  if (existing) {
    // Stored bytes are checked as well as the received digest. No latest source
    // recapture, regenerated acceptedAt or native metric projection occurs.
    parseMarketingReport(existing.canonicalEnvelope)
    if (existing.canonicalEnvelope !== canonicalEnvelope || existing.payloadHash !== envelope.payloadHash) throw reportError(409, 'REPORT_IDENTITY_CONFLICT')
    return { status: 200, receipt: marketingReportReceipt(existing) }
  }
  const id = randomUUID(), acceptedAt = new Date(), receiverReceiptId = randomUUID(), auditEventId = randomUUID()
  await tx.auditEvent.create({ data: {
    id: auditEventId, tenantId: binding.tenantId, businessId: binding.businessId,
    entityType: 'MARKETING_EXTERNAL_REPORT', entityId: id, action: 'REPORTED_EVIDENCE_ACCEPTED',
    actorType: 'MARKETING_REPORT_BINDING', actorId: binding.id,
    payloadJson: JSON.stringify({ reportId: envelope.reportId, bindingId: binding.id, initiativeId: initiative.id, payloadHash: envelope.payloadHash }),
  } })
  const report = await tx.marketingExternalReport.create({ data: {
    id, tenantId: binding.tenantId, businessId: binding.businessId, bindingId: binding.id, initiativeId: initiative.id, planId: initiative.planId,
    sourceDeploymentId: binding.sourceDeploymentId, sourceBusinessId: binding.sourceBusinessId,
    sourceCampaignId: envelope.campaign.sourceCampaignId, sourceReportId: envelope.reportId,
    contractVersion: envelope.contractVersion, reportRevision: 1, supersedesReportId: null,
    canonicalEnvelope, payloadHash: envelope.payloadHash, receiverReceiptId, acceptedAt,
    retainUntil: new Date(acceptedAt.getTime() + 90 * 86400000), auditEventId,
  } })
  return { status: 201, receipt: marketingReportReceipt(report) }
}

export async function receiveMarketingReport({ db, provider = 'sqlite', authorization, raw } = {}) {
  const keyHash = reportCredentialHash(authorization)
  const { envelope, canonicalEnvelope } = parseMarketingReport(raw)
  // Only the outer transaction's committed result escapes the shared boundary.
  return withMarketingReportTransaction(db, provider, tx => acceptInTransaction(tx, keyHash, envelope, canonicalEnvelope, provider))
}
