// @req FR-153, FR-154 — restore preserves immutable planning evidence and PM receipt references.
// @spec SDD-086, BR-008
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer, makeOperatorViewer } from '../factories/viewer'
import { createProject } from '@/modules/project-manager/application/project-service'
import { exportSnapshot, importSnapshot } from '@/modules/project-manager/application/backup-service'

describe('Marketing evidence backup', () => {
  it('round-trips non-empty evidence and execution links in FK order', async () => {
    const portfolio = await createPortfolio({ code: 'PF-MKT-BAK', name: 'Marketing backup' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-MKT-BAK', name: 'Marketing backup' })
    const business = await createBusiness({ tenantId: tenant.id, code: 'BUS-MKT-BAK', name: 'Marketing backup' })
    const workspace = await createWorkspace({ businessId: business.id, scopeType: 'BUSINESS', code: 'WS-MKT-BAK', name: 'Marketing backup' })
    const viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['growth', 'projects'] })
    const project = await createProject({ workspaceId: workspace.id, code: 'PRJ-MKT-BAK', name: 'Accepted execution' }, { viewer })
    const plan = await prisma.marketingPlan.create({ data: { tenantId: tenant.id, businessId: business.id, code: 'MKT-BAK', title: 'Reviewed strategy', createdBy: 'author', status: 'APPROVED' } })
    const revision = await prisma.marketingPlanVersion.create({ data: { planId: plan.id, revision: 1, payloadJson: '{"objective":"Evidence survives restore"}', payloadHash: 'a'.repeat(64), createdBy: 'author' } })
    const review = await prisma.marketingReview.create({ data: { planId: plan.id, planVersionId: revision.id, payloadHash: revision.payloadHash, verdict: 'PASS', rationale: 'Independent review', reviewerId: 'reviewer' } })
    const decision = await prisma.marketingDecision.create({ data: { planId: plan.id, planVersionId: revision.id, payloadHash: revision.payloadHash, reviewId: review.id, verdict: 'APPROVE', rationale: 'Accepted', actorId: 'approver', expiresAt: new Date('2030-01-01') } })
    const handoff = await prisma.marketingHandoff.create({ data: { planId: plan.id, planVersionId: revision.id, workspaceId: workspace.id, projectId: project.id, payloadHash: revision.payloadHash, envelopeHash: 'b'.repeat(64), receiptJson: '{"committed":true}', createdBy: 'approver' } })
    const snapshot = await exportSnapshot()
    for (const [model, row] of [['marketingPlan', plan], ['marketingPlanVersion', revision], ['marketingReview', review], ['marketingDecision', decision], ['marketingHandoff', handoff]]) {
      expect(snapshot.tables[model]?.some(candidate => candidate.id === row.id)).toBe(true)
    }
    expect(await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })).toMatchObject({ restored: true })
    const restored = await prisma.marketingHandoff.findUnique({ where: { id: handoff.id }, include: { plan: true, planVersion: true, workspace: true, project: true } })
    expect(restored).toMatchObject({ receiptJson: handoff.receiptJson, envelopeHash: handoff.envelopeHash, plan: { id: plan.id }, planVersion: { payloadJson: revision.payloadJson }, workspace: { businessId: business.id }, project: { id: project.id } })
    expect(await prisma.marketingDecision.findUnique({ where: { id: decision.id }, include: { review: true } })).toMatchObject({ verdict: 'APPROVE', review: { reviewerId: 'reviewer' } })
  })
})
