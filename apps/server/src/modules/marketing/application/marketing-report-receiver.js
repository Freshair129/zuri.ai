// @tested tests/unit/marketing-report-wire.test.js, tests/integration/marketing-report-native.test.js
// @req FR-281, FR-282, FR-283 — reauthorize before replay; acknowledge outer commit only.
// @spec SDD-112, ZURI-GO-REPORT-PHYSICAL-DESIGN
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { reportCredentialHash, parseMarketingReport, reportError } from './marketing-report-wire.js'

export function marketingReportReceipt(report) {
  return {
    contractVersion: report.contractVersion, receiverReceiptId: report.receiverReceiptId,
    reportId: report.sourceReportId, bindingId: report.bindingId, sourceCampaignId: report.sourceCampaignId,
    targetInitiativeId: report.initiativeId, reportRevision: report.reportRevision, payloadHash: report.payloadHash,
    acceptedAt: report.acceptedAt.toISOString(), status: report.status,
  }
}

export function receiverRetryable(error) {
  // Installed Prisma 5.22 native mappings are qualified by the concurrency test.
  return error?.code === 'P1008' || error?.code === 'P2034'
    || error?.code === 'P2010' && ['5', '6', 'SQLITE_BUSY', 'SQLITE_LOCKED'].includes(String(error.meta?.code))
    || error?.code === 'P2002' && /bindingId.*sourceReportId|sourceReportId.*bindingId/.test(String(error.meta?.target))
}

async function acceptInTransaction(tx, keyHash, envelope, canonicalEnvelope) {
  // This write is deliberately first: every subsequent grant read belongs to
  // the same SQLite writer transaction as policy disable / credential revoke.
  await tx.$executeRaw`UPDATE "MarketingReportBinding" SET "id"="id" WHERE "keyHash"=${keyHash}`
  const binding = await tx.marketingReportBinding.findUnique({
    where: { keyHash }, include: { policy: { include: { business: true } } },
  })
  if (!binding || binding.status !== 'ACTIVE' || binding.revokedAt !== null || binding.permission !== 'marketing.report.ingest') throw reportError(401, 'REPORT_UNAUTHORIZED')
  const business = binding.policy.business
  if (!binding.policy.ingestEnabled || binding.tenantId !== binding.policy.tenantId || binding.tenantId !== business.tenantId || binding.businessId !== business.id || business.status !== 'ACTIVE'
    || envelope.target.bindingId !== binding.id || envelope.source.system !== binding.sourceSystem || envelope.source.deploymentId !== binding.sourceDeploymentId || envelope.source.sourceBusinessId !== binding.sourceBusinessId) throw reportError(404, 'REPORT_SCOPE_UNAVAILABLE')
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

export async function receiveMarketingReport({ db, authorization, raw } = {}) {
  const keyHash = reportCredentialHash(authorization)
  const { envelope, canonicalEnvelope } = parseMarketingReport(raw)
  if (!db?.$transaction) throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
  const deadline = performance.now() + 5000
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = Math.floor(deadline - performance.now())
    if (remaining <= 0) break
    try {
      const result = await db.$transaction(tx => acceptInTransaction(tx, keyHash, envelope, canonicalEnvelope), {
        maxWait: Math.min(1000, remaining), timeout: Math.min(1200, remaining),
      })
      // Only the outer transaction's committed result escapes this function.
      if (performance.now() >= deadline) throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
      return result
    } catch (error) {
      if (error?.status) throw error
      if (!receiverRetryable(error) || attempt === 2) throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
      const wait = attempt === 0 ? 25 : 100
      if (performance.now() + wait >= deadline) break
      await delay(wait)
    }
  }
  throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
}
