// @req FR-157 — backup retains creative revisions and independent decision evidence.
// @spec SDD-088, BR-008
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import { exportSnapshot, importSnapshot } from '@/modules/project-manager/application/backup-service'

describe('Marketing Content backup', () => {
  it('restores nonempty immutable content, review and decision rows in FK order', async () => {
    const portfolio = await createPortfolio({ code: 'PF-CONTENT-BAK', name: 'Content backup' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-CONTENT-BAK', name: 'Content backup' })
    const business = await createBusiness({ tenantId: tenant.id, code: 'BUS-CONTENT-BAK', name: 'Content backup' })
    const brief = await prisma.marketingContentBrief.create({ data: { businessId: business.id, tenantId: tenant.id, code: 'CRE-BAK', title: 'Creative intent', createdBy: 'author' } })
    const payloadJson = JSON.stringify({ title: brief.title, payload: { objective: 'Qualified enquiries', audience: 'Business buyers', message: 'Gift consultation', claims: 'No unsupported claim', shotList: 'Product detail', acceptanceCriteria: 'Readable caption', evidenceReference: 'Reviewed product facts', format: 'IMAGE', initiativeId: null, channels: ['INSTAGRAM'], asset: null, rights: null, production: null } })
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex')
    const revision = await prisma.marketingContentVersion.create({ data: { briefId: brief.id, revision: 1, payloadJson, payloadHash, createdBy: 'author' } })
    const review = await prisma.marketingContentReview.create({ data: { briefId: brief.id, contentVersionId: revision.id, payloadHash, verdict: 'CHANGES_REQUIRED', rationale: 'Output evidence required', reviewerId: 'reviewer' } })
    const decision = await prisma.marketingContentDecision.create({ data: { briefId: brief.id, contentVersionId: revision.id, payloadHash, reviewId: review.id, verdict: 'REJECT', rationale: 'Complete output evidence', actorId: 'owner' } })
    const snapshot = await exportSnapshot()
    for (const [model, row] of [['marketingContentBrief', brief], ['marketingContentVersion', revision], ['marketingContentReview', review], ['marketingContentDecision', decision]]) {
      expect(snapshot.tables[model]).toEqual(expect.arrayContaining([expect.objectContaining({ id: row.id })]))
    }
    expect(await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })).toMatchObject({ restored: true })
    const restored = await prisma.marketingContentDecision.findUnique({ where: { id: decision.id }, include: { brief: true, contentVersion: true, review: true } })
    expect(restored).toMatchObject({ verdict: 'REJECT', brief: { businessId: business.id, version: 1 }, contentVersion: { payloadJson, payloadHash }, review: { reviewerId: 'reviewer', rightsConfirmed: false, brandConfirmed: false } })
  })
})
