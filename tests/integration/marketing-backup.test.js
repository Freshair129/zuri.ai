// @req FR-155, FR-154, FR-156 — restore preserves immutable planning evidence and PM receipt references.
// @spec SDD-086, BR-008
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer, makeOperatorViewer } from '../factories/viewer'
import { createProject } from '@/modules/project-manager/application/project-service'
import { exportSnapshot, importSnapshot } from '@/modules/project-manager/application/backup-service'
import { hashMarketingPlanContent, serializeMarketingPlanVersion } from '@/modules/marketing/domain/marketing-plan-contract'
import { getMarketingPlan } from '@/modules/marketing/application/marketing-plan-service'
import { getMarketingCampaign } from '@/modules/marketing/application/marketing-campaign-service'

describe('Marketing evidence backup', () => {
  it('round-trips non-empty evidence and execution links in FK order', async () => {
    const portfolio = await createPortfolio({ code: 'PF-MKT-BAK', name: 'Marketing backup' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-MKT-BAK', name: 'Marketing backup' })
    const business = await createBusiness({ tenantId: tenant.id, code: 'BUS-MKT-BAK', name: 'Marketing backup' })
    const workspace = await createWorkspace({ businessId: business.id, scopeType: 'BUSINESS', code: 'WS-MKT-BAK', name: 'Marketing backup' })
    const viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['growth', 'projects'] })
    const project = await createProject({ workspaceId: workspace.id, code: 'PRJ-MKT-BAK', name: 'Accepted execution' }, { viewer })
    const plan = await prisma.marketingPlan.create({ data: { tenantId: tenant.id, businessId: business.id, code: 'MKT-BAK', title: 'Reviewed strategy', createdBy: 'author', status: 'APPROVED' } })
    const content = { title: plan.title, payload: { objective: 'Evidence survives restore', situation: 'Existing audience', audience: 'Business customers', channels: ['META_ADS'], budget: 1000, currency: 'THB', successMetric: 'Qualified enquiries', actions: [{ title: 'Prepare creative' }], campaignBrief: { startDate: '2026-09-10', endDate: '2026-09-30', offer: 'Consultation', conditions: 'Business customers' } } }
    const revision = await prisma.marketingPlanVersion.create({ data: { planId: plan.id, revision: 1, payloadJson: serializeMarketingPlanVersion(content), payloadHash: hashMarketingPlanContent(content), createdBy: 'author' } })
    const review = await prisma.marketingReview.create({ data: { planId: plan.id, planVersionId: revision.id, payloadHash: revision.payloadHash, verdict: 'PASS', rationale: 'Independent review', reviewerId: 'reviewer' } })
    const decision = await prisma.marketingDecision.create({ data: { planId: plan.id, planVersionId: revision.id, payloadHash: revision.payloadHash, reviewId: review.id, verdict: 'APPROVE', rationale: 'Accepted', actorId: 'approver', expiresAt: new Date('2030-01-01') } })
    const handoff = await prisma.marketingHandoff.create({ data: { planId: plan.id, planVersionId: revision.id, workspaceId: workspace.id, projectId: project.id, payloadHash: revision.payloadHash, envelopeHash: 'b'.repeat(64), receiptJson: '{"committed":true}', createdBy: 'approver' } })
    const initiative = await prisma.marketingInitiative.create({ data: { tenantId: tenant.id, businessId: business.id, code: 'MKT-CAM-BAK', planId: plan.id, handoffId: handoff.id, status: 'CLOSED', closureReason: 'Debrief retained', createdBy: 'approver' } })
    const snapshot = await exportSnapshot()
    for (const [model, row] of [['marketingPlan', plan], ['marketingPlanVersion', revision], ['marketingReview', review], ['marketingDecision', decision], ['marketingHandoff', handoff], ['marketingInitiative', initiative]]) {
      expect(snapshot.tables[model]?.some(candidate => candidate.id === row.id)).toBe(true)
    }
    expect(await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })).toMatchObject({ restored: true })
    const restored = await prisma.marketingHandoff.findUnique({ where: { id: handoff.id }, include: { plan: true, planVersion: true, workspace: true, project: true } })
    expect(restored).toMatchObject({ receiptJson: handoff.receiptJson, envelopeHash: handoff.envelopeHash, plan: { id: plan.id }, planVersion: { payloadJson: revision.payloadJson }, workspace: { businessId: business.id }, project: { id: project.id } })
    expect(await prisma.marketingDecision.findUnique({ where: { id: decision.id }, include: { review: true } })).toMatchObject({ verdict: 'APPROVE', review: { reviewerId: 'reviewer' } })
    expect(await prisma.marketingInitiative.findUnique({ where: { id: initiative.id }, include: { plan: true, handoff: true } })).toMatchObject({ status: 'CLOSED', closureReason: 'Debrief retained', version: 1, businessId: business.id, plan: { id: plan.id }, handoff: { id: handoff.id, projectId: project.id } })
    const readable = await getMarketingPlan({ planId: plan.id, businessId: business.id, viewer }, { db: prisma })
    expect(readable.currentVersion).toMatchObject({ title: content.title, payload: content.payload, payloadHash: revision.payloadHash })
    const restoredCampaign = await getMarketingCampaign({ viewer, businessId: business.id, initiativeId: initiative.id }, { db: prisma })
    expect(restoredCampaign).toMatchObject({ id: initiative.id, status: 'CLOSED', closureReason: 'Debrief retained', plan: { currentVersion: { payload: content.payload } } })
    // This backup fixture deliberately has no real PM import provenance. Restore
    // preserves its row but the Campaign boundary must not expose it as execution.
    expect(restoredCampaign.execution.status).toBe('UNAVAILABLE')
    expect(restoredCampaign.plan.handoffs).toEqual([])
  })
})
