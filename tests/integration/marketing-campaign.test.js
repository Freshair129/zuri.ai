import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import {
  createMarketingCampaign,
  getMarketingCampaign,
  listMarketingCampaigns,
  updateMarketingCampaign,
} from '@/modules/marketing/application/marketing-campaign-service'
import {
  createMarketingPlan,
  decideMarketingPlan,
  reviewMarketingPlan,
} from '@/modules/marketing/application/marketing-plan-service'
import { createMarketingPmHandoffService } from '@/modules/marketing/application/marketing-pm-handoff-service'
import { createMarketingCampaignRepository } from '@/modules/marketing/infrastructure/marketing-campaign-repository'

// @req FR-156 — real Campaign identity, immutable brief reuse, explicit PM
// receipt binding, Business/Tenant refusal and CAS/rollback evidence.
// @spec SDD-087, SEC-001, SEC-003
// @tested tests/integration/marketing-campaign.test.js

const DOMAINS = ['growth']
const now = () => new Date('2026-09-06T12:00:00.000Z')

function suffix() {
  return randomUUID().slice(0, 8).toUpperCase()
}

function viewer(businessId, principal, owner = true) {
  return makeViewer({
    role: owner ? 'OWNER' : 'MEMBER',
    visibleBusinessIds: [businessId],
    ownedBusinessIds: owner ? [businessId] : [],
    visibleDomains: DOMAINS,
    domainsByBusinessId: { [businessId]: DOMAINS },
    principal: { id: principal, code: principal, displayName: principal },
  })
}

const payload = {
  objective: 'Launch an evidence-backed demand campaign',
  situation: 'The offer needs a bounded experiment.',
  audience: 'Thai SME owners',
  channels: ['META_ADS', 'SEO'],
  budget: 10000,
  currency: 'THB',
  successMetric: 'Qualified leads',
  actions: [{ title: 'Prepare campaign creative' }],
  campaignBrief: {
    startDate: '2026-09-10',
    endDate: '2026-09-20',
    offer: 'A bounded first-month offer',
    conditions: 'Only qualified businesses in the target segment',
  },
}

let business
let workspace
let owner
let reviewer
let campaign

const deps = (viewerArg, clock = now) => ({
  db: prisma,
  viewer: viewerArg,
  createRepository: createMarketingCampaignRepository,
  now: clock,
})

function auditFailureDb() {
  const models = [
    'marketingPlan',
    'marketingPlanVersion',
    'marketingReview',
    'marketingDecision',
    'marketingHandoff',
    'marketingInitiative',
  ]
  const db = {
    business: prisma.business,
    $transaction: (callback) => prisma.$transaction((tx) => callback(new Proxy(tx, {
      get(target, property, receiver) {
        if (property === 'auditEvent') return { create: async () => { throw new Error('forced campaign audit failure') } }
        return Reflect.get(target, property, receiver)
      },
    }))),
  }
  models.forEach((name) => { db[name] = prisma[name] })
  return db
}

describe('Marketing Campaign initiative persistence (FR-156)', () => {
  beforeAll(async () => {
    const id = suffix()
    const portfolio = await createPortfolio({ name: `Campaign ${id}`, code: `PF-CAM-${id}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Campaign tenant ${id}`, code: `TNT-CAM-${id}` })
    business = await createBusiness({ tenantId: tenant.id, name: `Campaign business ${id}`, code: `BUS-CAM-${id}` })
    workspace = await createWorkspace({
      businessId: business.id,
      scopeType: 'BUSINESS',
      name: `Campaign workspace ${id}`,
      code: `WS-CAM-${id}`,
    })
    owner = viewer(business.id, `campaign-owner-${id}`)
    reviewer = viewer(business.id, `campaign-reviewer-${id}`)
  })

  it('creates the Plan, immutable brief version, Initiative and audits atomically', async () => {
    campaign = await createMarketingCampaign(
      { businessId: business.id, title: 'First Campaign', payload },
      deps(owner),
    )
    expect(campaign).toMatchObject({
      businessId: business.id,
      status: 'OPEN',
      phase: 'DRAFT',
      version: 1,
      plan: { title: 'First Campaign', currentVersion: { payload } },
    })
    expect(await prisma.marketingInitiative.count({ where: { id: campaign.id } })).toBe(1)
    expect(await prisma.marketingPlan.count({ where: { id: campaign.planId } })).toBe(1)
    expect(await prisma.auditEvent.count({ where: { entityType: 'MARKETING_INITIATIVE', entityId: campaign.id, action: 'CREATED' } })).toBe(1)
  })

  it('rolls back both Plan and Initiative when audit persistence fails', async () => {
    const beforePlans = await prisma.marketingPlan.count()
    const beforeInitiatives = await prisma.marketingInitiative.count()
    await expect(createMarketingCampaign(
      { businessId: business.id, title: 'Rollback Campaign', payload },
      { ...deps(owner), db: auditFailureDb() },
    )).rejects.toThrow('forced campaign audit failure')
    expect(await prisma.marketingPlan.count()).toBe(beforePlans)
    expect(await prisma.marketingInitiative.count()).toBe(beforeInitiatives)
  })

  it('fails closed for a visible owner-elsewhere and permits read-only detail only', async () => {
    const outsider = ownsElsewhere({ owns: `${business.id}-other`, sees: business.id, visibleDomains: DOMAINS })
    const visibleOutsider = await getMarketingCampaign(
      { viewer: outsider, businessId: business.id, initiativeId: campaign.id },
      { db: prisma, createRepository: createMarketingCampaignRepository },
    )
    expect(visibleOutsider.canWrite).toBe(false)

    const member = viewer(business.id, 'campaign-member', false)
    const visible = await getMarketingCampaign(
      { viewer: member, businessId: business.id, initiativeId: campaign.id },
      { db: prisma, createRepository: createMarketingCampaignRepository },
    )
    expect(visible.canWrite).toBe(false)
    await expect(updateMarketingCampaign(campaign.id, {
      action: 'close', businessId: business.id, expectedVersion: 1, reason: 'member cannot close',
    }, deps(member))).rejects.toMatchObject({ status: 404 })
  })

  it('rejects reversed dates and a revision that removes campaignBrief', async () => {
    await expect(createMarketingCampaign(
      {
        businessId: business.id,
        title: 'Bad campaign',
        payload: { ...payload, campaignBrief: { ...payload.campaignBrief, endDate: '2026-09-01' } },
      },
      deps(owner),
    )).rejects.toThrow(/endDate/i)

    await expect(updateMarketingCampaign(campaign.id, {
      action: 'revise',
      businessId: business.id,
      expectedVersion: campaign.version,
      expectedPlanVersion: campaign.plan.version,
      title: 'First Campaign Revised',
      payload: { ...payload, campaignBrief: undefined },
    }, deps(owner))).rejects.toThrow(/campaignBrief/i)
  })

  it('appends a Strategy revision and Campaign CAS together', async () => {
    const revised = await updateMarketingCampaign(campaign.id, {
      action: 'revise',
      businessId: business.id,
      expectedVersion: campaign.version,
      expectedPlanVersion: campaign.plan.version,
      title: 'First Campaign Revised',
      payload: { ...payload, objective: 'A revised bounded demand campaign' },
    }, deps(owner))
    campaign = revised
    expect(revised).toMatchObject({
      version: 2,
      plan: { currentRevision: 2, version: 2, title: 'First Campaign Revised' },
    })
    expect(await prisma.auditEvent.count({ where: { entityType: 'MARKETING_INITIATIVE', entityId: campaign.id, action: 'REVISED' } })).toBe(1)
  })

  it('binds only an approved, receipt-backed PM handoff and preserves its IDs', async () => {
    const reviewed = await reviewMarketingPlan(campaign.planId, {
      businessId: business.id,
      expectedVersion: campaign.plan.version,
      planVersionId: campaign.plan.currentVersion.id,
      payloadHash: campaign.plan.currentVersion.payloadHash,
      verdict: 'PASS',
      rationale: 'Independent review',
    }, { db: prisma, viewer: reviewer, now })
    const approved = await decideMarketingPlan(campaign.planId, {
      businessId: business.id,
      expectedVersion: reviewed.version,
      planVersionId: reviewed.currentVersion.id,
      payloadHash: reviewed.currentVersion.payloadHash,
      reviewId: reviewed.reviews.at(-1).id,
      verdict: 'APPROVE',
      rationale: 'Approved',
      expiresAt: '2026-09-07T00:00:00.000Z',
    }, { db: prisma, viewer: owner, now })
    const handoffService = createMarketingPmHandoffService({ db: prisma, now })
    const handoffInput = {
      planId: campaign.planId,
      businessId: business.id,
      workspaceId: workspace.id,
      expectedVersion: approved.version,
    }
    const preview = await handoffService.preview({ ...handoffInput, action: 'preview' }, { viewer: owner })
    const committed = await handoffService.commit({ ...handoffInput, action: 'commit', previewHash: preview.previewHash }, { viewer: owner })
    const bound = await updateMarketingCampaign(campaign.id, {
      action: 'bind-handoff',
      businessId: business.id,
      expectedVersion: campaign.version,
      expectedPlanVersion: committed.preview.plan.version + 1,
      handoffId: committed.receipt.handoffId,
    }, deps(owner))
    campaign = bound
    expect(bound).toMatchObject({
      id: campaign.id,
      handoffId: committed.receipt.handoffId,
      phase: 'EXECUTING',
      execution: { status: 'READY', handoff: { projectId: committed.receipt.projectId } },
    })
    expect(bound.plan.handoffs.map((row) => row.id)).toContain(committed.receipt.handoffId)
  })

  it('rejects a stale Plan CAS before associating the receipt', async () => {
    const before = await prisma.marketingInitiative.findUnique({ where: { id: campaign.id } })
    const handoffId = before.handoffId
    await expect(updateMarketingCampaign(campaign.id, {
      action: 'bind-handoff',
      businessId: business.id,
      expectedVersion: before.version,
      expectedPlanVersion: 1,
      handoffId,
    }, deps(owner))).rejects.toMatchObject({ status: 409 })
    const after = await prisma.marketingInitiative.findUnique({ where: { id: campaign.id } })
    expect(after).toMatchObject({ version: before.version, handoffId })
  })

  it('does not expose a receipt the PM adapter rejects, and list phase falls back to approval', async () => {
    const row = await prisma.marketingHandoff.findUnique({ where: { id: campaign.handoffId } })
    const original = row.receiptJson
    const receipt = JSON.parse(original)
    await prisma.marketingHandoff.update({
      where: { id: row.id },
      data: { receiptJson: JSON.stringify({ ...receipt, pm: { ...receipt.pm, status: 'FORGED' } }) },
    })
    try {
      const detail = await getMarketingCampaign(
        { viewer: owner, businessId: business.id, initiativeId: campaign.id },
        { db: prisma, createRepository: createMarketingCampaignRepository, now },
      )
      expect(detail.handoffId).toBeNull()
      expect(detail.plan.handoffs).toEqual([])
      expect(detail.execution).toMatchObject({ status: 'UNAVAILABLE', handoff: null, roadmap: null })

      const listing = await listMarketingCampaigns(
        { viewer: owner, businessId: business.id },
        { db: prisma, createRepository: createMarketingCampaignRepository, now },
      )
      expect(listing.campaigns.find((item) => item.id === campaign.id)).toMatchObject({ phase: 'APPROVED', handoffId: null })
    } finally {
      await prisma.marketingHandoff.update({ where: { id: row.id }, data: { receiptJson: original } })
    }
  })

  it('refuses binding an archived Strategy plan without changing the Campaign', async () => {
    const initiativeBefore = await prisma.marketingInitiative.findUnique({ where: { id: campaign.id } })
    const planBefore = await prisma.marketingPlan.findUnique({ where: { id: campaign.planId } })
    await prisma.marketingPlan.update({ where: { id: campaign.planId }, data: { status: 'ARCHIVED' } })
    try {
      await expect(updateMarketingCampaign(campaign.id, {
        action: 'bind-handoff',
        businessId: business.id,
        expectedVersion: initiativeBefore.version,
        expectedPlanVersion: planBefore.version,
        handoffId: initiativeBefore.handoffId,
      }, deps(owner))).rejects.toMatchObject({ status: 409 })
      expect(await prisma.marketingInitiative.findUnique({ where: { id: campaign.id } }))
        .toMatchObject({ version: initiativeBefore.version, handoffId: initiativeBefore.handoffId })
    } finally {
      await prisma.marketingPlan.update({ where: { id: campaign.planId }, data: { status: planBefore.status } })
    }
  })

  it('lists bounded summaries and closes without mutating PM execution', async () => {
    const listing = await listMarketingCampaigns(
      { viewer: owner, businessId: business.id },
      { db: prisma, createRepository: createMarketingCampaignRepository, now },
    )
    expect(listing.campaigns[0]).toMatchObject({ id: campaign.id, phase: 'EXECUTING' })
    expect(listing.campaigns[0]).not.toHaveProperty('plan.versions')

    const current = await prisma.marketingInitiative.findUnique({ where: { id: campaign.id } })
    const closed = await updateMarketingCampaign(campaign.id, {
      action: 'close', businessId: business.id, expectedVersion: current.version, reason: 'Debrief recorded for the first run',
    }, deps(owner))
    expect(closed).toMatchObject({ status: 'CLOSED', phase: 'CLOSED', canWrite: false })
    await expect(updateMarketingCampaign(campaign.id, {
      action: 'cancel', businessId: business.id, expectedVersion: closed.version, reason: 'must be refused',
    }, deps(owner))).rejects.toMatchObject({ status: 409 })
  })
})
