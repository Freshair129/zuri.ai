import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import {
  createMarketingPlan,
  decideMarketingPlan,
  reviseMarketingPlan,
  reviewMarketingPlan,
} from '@/modules/marketing/application/marketing-plan-service'
import { createMarketingPmHandoffService } from '@/modules/marketing/application/marketing-pm-handoff-service'
import { readMarketingCampaignExecution } from '@/modules/marketing/application/marketing-campaign-execution'

// @req FR-160 — a selected Marketing initiative receipt projects the existing
// PM execution roadmap with Business scope, immutable revision and provenance.
// @spec SDD-087, SEC-001, SEC-003
// @tested tests/integration/marketing-campaign-execution.test.js

const payload = {
  objective: 'Launch an evidence-backed customer campaign',
  situation: 'The existing audience needs a focused offer.',
  audience: 'existing customers',
  channels: ['META_ADS', 'TIKTOK_ADS', 'INSTAGRAM', 'GA4', 'SEO'],
  budget: 100000,
  currency: 'THB',
  successMetric: 'Measure qualified leads after launch.',
  actions: [{ title: 'Prepare campaign creative' }, { title: 'Review audience experiment' }],
}

let sequence = 0

function viewerFor(businessId, {
  owner = true,
  principalId = `campaign-reader-${businessId}`,
  visibleBusinessIds = [businessId],
} = {}) {
  return makeViewer({
    role: owner ? 'OWNER' : 'MEMBER',
    visibleBusinessIds,
    ownedBusinessIds: owner ? [businessId] : [],
    visibleDomains: ['growth'],
    domainsByBusinessId: Object.fromEntries(visibleBusinessIds.map((id) => [id, ['growth']])),
    principal: { id: principalId, code: 'CAMPAIGN', displayName: 'Campaign Reader' },
  })
}

async function acceptedFixture() {
  const suffix = `${Date.now()}-${sequence++}`
  const portfolio = await createPortfolio({ code: `PF-CAM-${suffix}`, name: 'Campaign group' })
  const tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-CAM-${suffix}`, name: 'Campaign tenant' })
  const business = await createBusiness({ tenantId: tenant.id, code: `BUS-CAM-${suffix}`, name: 'Campaign business' })
  const workspace = await createWorkspace({
    code: `WS-CAM-${suffix}`,
    name: 'Campaign workspace',
    scopeType: 'BUSINESS',
    businessId: business.id,
  })
  const owner = viewerFor(business.id, { principalId: `campaign-owner-${suffix}` })
  const reviewer = viewerFor(business.id, { principalId: `campaign-reviewer-${suffix}` })
  const now = () => new Date('2026-09-06T12:00:00.000Z')

  const created = await createMarketingPlan(
    { businessId: business.id, title: `Customer campaign ${suffix}`, payload },
    { db: prisma, viewer: owner, now },
  )
  const reviewed = await reviewMarketingPlan(
    created.id,
    {
      businessId: business.id,
      expectedVersion: created.version,
      planVersionId: created.currentVersion.id,
      payloadHash: created.currentVersion.payloadHash,
      verdict: 'PASS',
      rationale: 'Independent campaign review.',
    },
    { db: prisma, viewer: reviewer, now },
  )
  const approved = await decideMarketingPlan(
    created.id,
    {
      businessId: business.id,
      expectedVersion: reviewed.version,
      planVersionId: reviewed.currentVersion.id,
      payloadHash: reviewed.currentVersion.payloadHash,
      reviewId: reviewed.reviews.at(-1).id,
      verdict: 'APPROVE',
      rationale: 'Approved for PM execution.',
      expiresAt: '2026-09-07T00:00:00.000Z',
    },
    { db: prisma, viewer: owner, now },
  )

  const handoffService = createMarketingPmHandoffService({ db: prisma, now })
  const input = {
    planId: approved.id,
    businessId: business.id,
    workspaceId: workspace.id,
    expectedVersion: approved.version,
    action: 'preview',
  }
  const preview = await handoffService.preview(input, { viewer: owner })
  expect(preview.valid).toBe(true)
  const committed = await handoffService.commit(
    { ...input, action: 'commit', previewHash: preview.previewHash },
    { viewer: owner },
  )
  expect(committed.committed).toBe(true)
  const handoff = await prisma.marketingHandoff.findUnique({ where: { id: committed.receipt.handoffId } })
  const project = await prisma.project.findUnique({ where: { id: committed.receipt.projectId } })
  const planAfterHandoff = await prisma.marketingPlan.findUnique({ where: { id: approved.id } })

  return {
    business,
    tenant,
    workspace,
    owner,
    reviewer,
    plan: approved,
    currentPlanVersionId: approved.currentVersion.id,
    handoff,
    project,
    planAfterHandoff,
  }
}

function read(fixture, overrides = {}, options = {}) {
  return readMarketingCampaignExecution({
    viewer: fixture.owner,
    businessId: fixture.business.id,
    planId: fixture.plan.id,
    handoffId: fixture.handoff.id,
    currentPlanVersionId: fixture.currentPlanVersionId,
    ...overrides,
  }, options)
}

function expectUnavailable(result, hiddenIds = []) {
  expect(result.status).toBe('UNAVAILABLE')
  expect(result.handoff).toBeNull()
  expect(result.roadmap).toBeNull()
  const serialized = JSON.stringify(result)
  for (const id of hiddenIds) expect(serialized).not.toContain(id)
}

describe('Marketing Campaign PM execution read adapter (FR-160)', () => {
  it('projects a real approved, handed-off Strategy into the authorized PM roadmap', async () => {
    const fixture = await acceptedFixture()

    const result = await read(fixture)

    expect(result).toMatchObject({ status: 'READY', reasonCode: null })
    expect(result.handoff).toEqual({
      id: fixture.handoff.id,
      planVersionId: fixture.currentPlanVersionId,
      revision: 1,
      payloadHash: fixture.handoff.payloadHash,
      workspaceId: fixture.workspace.id,
      projectId: fixture.project.id,
      isCurrentRevision: true,
    })
    expect(result.roadmap.readModel).toBe('EXECUTION_ROADMAP')
    expect(result.roadmap.project.id).toBe(fixture.project.id)
    expect(result.roadmap.project.businessId).toBe(fixture.business.id)
    expect(result.roadmap.plans[0].executionModeId).toBe('B2C_CAMPAIGN')
    expect(result.roadmap.plans[0].progressStrategy).toBe('KPI_ATTAINMENT')
    expect(result.roadmap.items.map((item) => item.title)).toEqual(expect.arrayContaining(payload.actions.map((action) => action.title)))
  })

  it('allows an authorized read-only Business member without granting mutation authority', async () => {
    const fixture = await acceptedFixture()
    const reader = viewerFor(fixture.business.id, { owner: false, principalId: 'campaign-member-reader' })

    const result = await read(fixture, { viewer: reader })

    expect(result.status).toBe('READY')
    expect(result.roadmap.project.id).toBe(fixture.project.id)
    expect(reader.ownedBusinessIds).toEqual([])
  })

  it('fails closed for a cross-tenant Business viewer without leaking the PM target', async () => {
    const fixture = await acceptedFixture()
    const other = await acceptedFixture()
    const result = await read(fixture, { viewer: other.owner })

    expectUnavailable(result, [fixture.handoff.id, fixture.project.id, fixture.business.id])
  })

  it('rejects a persisted handoff selected from another Marketing plan', async () => {
    const fixture = await acceptedFixture()
    const other = await acceptedFixture()
    const result = await read(fixture, { handoffId: other.handoff.id })

    expectUnavailable(result, [other.handoff.id, other.project.id])
  })

  it('keeps a historical receipt readable and marks it when the current revision changes', async () => {
    const fixture = await acceptedFixture()
    const revised = await reviseMarketingPlan(
      fixture.plan.id,
      {
        businessId: fixture.business.id,
        expectedVersion: fixture.planAfterHandoff.version,
        title: `${fixture.plan.title} revised`,
        payload: { ...payload, objective: 'Revised campaign objective' },
      },
      { db: prisma, viewer: fixture.owner, now: () => new Date('2026-09-06T13:00:00.000Z') },
    )

    const result = await read(fixture, { currentPlanVersionId: revised.currentVersion.id })

    expect(result.status).toBe('READY')
    expect(result.handoff.planVersionId).toBe(fixture.currentPlanVersionId)
    expect(result.handoff.isCurrentRevision).toBe(false)
    expect(result.roadmap.project.id).toBe(fixture.project.id)
  })

  it('returns unavailable when the selected Project is deleted', async () => {
    const fixture = await acceptedFixture()
    await prisma.project.update({ where: { id: fixture.project.id }, data: { deletedAt: new Date() } })

    const result = await read(fixture)

    expectUnavailable(result, [fixture.project.id, fixture.handoff.id])
  })

  it('returns unavailable for a damaged Marketing receipt instead of trusting its Project ID', async () => {
    const fixture = await acceptedFixture()
    const receipt = JSON.parse(fixture.handoff.receiptJson)
    await prisma.marketingHandoff.update({
      where: { id: fixture.handoff.id },
      data: { receiptJson: JSON.stringify({ ...receipt, projectId: 'forged-project-id' }) },
    })

    const result = await read(fixture)

    expectUnavailable(result, [fixture.project.id, fixture.handoff.id, 'forged-project-id'])
  })

  it('accepts a valid Business Workspace with a nullable tenantId', async () => {
    const fixture = await acceptedFixture()
    await prisma.workspace.update({ where: { id: fixture.workspace.id }, data: { tenantId: null } })

    const result = await read(fixture)

    expect(result.status).toBe('READY')
    expect(result.handoff.projectId).toBe(fixture.project.id)
  })

  it('reads through an interactive transaction client without nesting a transaction', async () => {
    const fixture = await acceptedFixture()

    const result = await prisma.$transaction((tx) => read(fixture, {}, { db: tx }))

    expect(result.status).toBe('READY')
    expect(result.roadmap.project.id).toBe(fixture.project.id)
  })
})
