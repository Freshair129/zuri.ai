import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import {
  createMarketingPlan,
  decideMarketingPlan,
  getApprovedMarketingPlanForHandoff,
  getMarketingPlan,
  listMarketingPlans,
  reviseMarketingPlan,
  reviewMarketingPlan,
  archiveMarketingPlan,
} from '@/modules/marketing/application/marketing-plan-service'
import { createMarketingPlanRepository } from '@/modules/marketing/infrastructure/marketing-plan-repository'
import { hashMarketingPlanContent } from '@/modules/marketing/domain/marketing-plan-contract'

// @req FR-153 — the real SQLite persistence path proves Business/Tenant scope,
// immutable revisions, independent review, exact decisions, expiry/revocation,
// archive refusal and audit/CAS behaviour.
// @spec SDD-086, BR-001, SEC-001, SEC-003
// @tested tests/integration/marketing-plan.test.js

const DOMAINS = ['projects', 'people', 'platform', 'growth']
const payload = {
  objective: 'Increase qualified inbound demand',
  situation: 'The current funnel has no consistent campaign learning loop.',
  audience: 'Thai SME owners seeking an operating system',
  channels: ['META_ADS', 'SEO'],
  budget: 10000,
  currency: 'THB',
  successMetric: 'Qualified leads at an agreed acquisition cost',
  actions: [{ title: 'Publish the first evidence-backed brief' }],
}

let businessA
let businessB
let ownerA
let reviewerA
let plan
let now

const deps = (viewer, clock = () => now) => ({
  db: prisma,
  viewer,
  createRepository: createMarketingPlanRepository,
  now: clock,
})

function suffix() {
  return randomUUID().slice(0, 8).toUpperCase()
}

describe('Marketing Strategy plan persistence (FR-153)', () => {
  beforeAll(async () => {
    const id = suffix()
    const portfolio = await createPortfolio({ name: `Marketing ${id}`, code: `PF-MKT-${id}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `Marketing A ${id}`, code: `TNT-MKT-A-${id}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `Marketing B ${id}`, code: `TNT-MKT-B-${id}` })
    businessA = await createBusiness({ tenantId: tenantA.id, name: `Marketing Business A ${id}`, code: `BUS-MKT-A-${id}` })
    businessB = await createBusiness({ tenantId: tenantB.id, name: `Marketing Business B ${id}`, code: `BUS-MKT-B-${id}` })

    ownerA = makeViewer({
      principal: { id: 'marketing-owner-a' },
      visibleBusinessIds: [businessA.id],
      ownedBusinessIds: [businessA.id],
      visibleDomains: DOMAINS,
    })
    reviewerA = makeViewer({
      principal: { id: 'marketing-reviewer-a' },
      visibleBusinessIds: [businessA.id],
      ownedBusinessIds: [businessA.id],
      visibleDomains: DOMAINS,
    })
    now = new Date('2026-09-06T12:00:00.000Z')
  })

  it('creates the first revision with a title-bound hash and one audit event', async () => {
    plan = await createMarketingPlan(
      { businessId: businessA.id, title: 'Demand Plan', payload },
      deps(ownerA),
    )

    expect(plan).toMatchObject({
      businessId: businessA.id,
      status: 'DRAFT',
      currentRevision: 1,
      version: 1,
      currentVersion: {
        revision: 1,
        title: 'Demand Plan',
        payload,
        payloadHash: hashMarketingPlanContent({ title: 'Demand Plan', payload }),
      },
    })
    expect(await prisma.marketingPlanVersion.count({ where: { planId: plan.id } })).toBe(1)
    const listing = await listMarketingPlans(
      { viewer: ownerA, businessId: businessA.id },
      { db: prisma, createRepository: createMarketingPlanRepository },
    )
    expect(listing).toMatchObject({ canWrite: true, truncated: false })
    expect(listing.plans[0]).toMatchObject({ id: plan.id, title: 'Demand Plan', canWrite: true })
    expect(listing.plans[0]).not.toHaveProperty('versions')
    expect(await prisma.auditEvent.count({
      where: { entityType: 'MARKETING_PLAN', entityId: plan.id, action: 'CREATED' },
    })).toBe(1)
  })

  it('does not let a visible owner-elsewhere viewer enumerate or write another Business', async () => {
    const attacker = ownsElsewhere({
      owns: businessA.id,
      sees: businessB.id,
      visibleDomains: DOMAINS,
    })
    await expect(getMarketingPlan(
      { viewer: attacker, businessId: businessB.id, planId: plan.id },
      { db: prisma, createRepository: createMarketingPlanRepository },
    )).rejects.toMatchObject({ status: 404 })
    await expect(createMarketingPlan(
      { businessId: businessB.id, title: 'Cross scope', payload },
      deps(attacker),
    )).rejects.toMatchObject({ status: 404 })
  })

  it('appends an immutable revision and refuses a stale expected version', async () => {
    const before = await prisma.marketingPlanVersion.findUnique({
      where: { id: plan.currentVersion.id },
    })
    const revised = await reviseMarketingPlan(
      plan.id,
      { businessId: businessA.id, expectedVersion: 1, title: 'Demand Plan v2', payload: { ...payload, budget: 12000 } },
      deps(ownerA),
    )
    expect(revised.currentRevision).toBe(2)
    expect(revised.version).toBe(2)
    expect(revised.versions).toHaveLength(2)
    expect(await prisma.marketingPlanVersion.findUnique({ where: { id: before.id } })).toEqual(before)

    await expect(reviseMarketingPlan(
      plan.id,
      { businessId: businessA.id, expectedVersion: 1, title: 'Stale', payload },
      deps(ownerA),
    )).rejects.toMatchObject({ status: 409 })
    plan = revised
  })

  it('requires an independent reviewer but allows the accountable plan author to approve', async () => {
    await expect(reviewMarketingPlan(
      plan.id,
      {
        businessId: businessA.id,
        expectedVersion: plan.version,
        planVersionId: plan.currentVersion.id,
        payloadHash: plan.currentVersion.payloadHash,
        verdict: 'PASS',
        rationale: 'The author cannot provide the independent review.',
        action: 'review',
      },
      deps(ownerA),
    )).rejects.toMatchObject({ status: 409 })

    plan = await reviewMarketingPlan(
      plan.id,
      {
        businessId: businessA.id,
        expectedVersion: plan.version,
        planVersionId: plan.currentVersion.id,
        payloadHash: plan.currentVersion.payloadHash,
        verdict: 'PASS',
        rationale: 'The current plan is coherent and evidence-ready.',
        action: 'review',
      },
      deps(reviewerA),
    )
    const firstPassReview = plan.reviews.at(-1)
    expect(firstPassReview).toMatchObject({ verdict: 'PASS', reviewerId: 'marketing-reviewer-a' })

    plan = await decideMarketingPlan(
      plan.id,
      {
        businessId: businessA.id,
        expectedVersion: plan.version,
        planVersionId: plan.currentVersion.id,
        payloadHash: plan.currentVersion.payloadHash,
        reviewId: firstPassReview.id,
        verdict: 'APPROVE',
        rationale: 'Approved by the accountable Business owner.',
        expiresAt: '2026-09-06T13:00:00.000Z',
      },
      deps(ownerA),
    )
    expect(plan.status).toBe('APPROVED')
    expect(plan.decisions.at(-1)).toMatchObject({ verdict: 'APPROVE', actorId: 'marketing-owner-a' })

    plan = await reviewMarketingPlan(
      plan.id,
      {
        businessId: businessA.id,
        expectedVersion: plan.version,
        planVersionId: plan.currentVersion.id,
        payloadHash: plan.currentVersion.payloadHash,
        verdict: 'CHANGES_REQUIRED',
        rationale: 'Clarify the evidence threshold before handoff.',
      },
      deps(reviewerA),
    )
    expect(plan.status).toBe('DRAFT')
    await expect(decideMarketingPlan(
      plan.id,
      {
        businessId: businessA.id,
        expectedVersion: plan.version,
        planVersionId: plan.currentVersion.id,
        payloadHash: plan.currentVersion.payloadHash,
        reviewId: firstPassReview.id,
        verdict: 'APPROVE',
        rationale: 'The superseded PASS must not authorize this revision.',
        expiresAt: '2026-09-06T13:00:00.000Z',
      },
      deps(ownerA),
    )).rejects.toMatchObject({ status: 409 })

    plan = await reviewMarketingPlan(
      plan.id,
      {
        businessId: businessA.id,
        expectedVersion: plan.version,
        planVersionId: plan.currentVersion.id,
        payloadHash: plan.currentVersion.payloadHash,
        verdict: 'PASS',
        rationale: 'The evidence threshold is now explicit.',
      },
      deps(reviewerA),
    )
    const secondPassReview = plan.reviews.at(-1)
    plan = await decideMarketingPlan(
      plan.id,
      {
        businessId: businessA.id,
        expectedVersion: plan.version,
        planVersionId: plan.currentVersion.id,
        payloadHash: plan.currentVersion.payloadHash,
        reviewId: secondPassReview.id,
        verdict: 'APPROVE',
        rationale: 'Approved after the latest independent PASS.',
        expiresAt: '2026-09-06T13:00:00.000Z',
      },
      deps(ownerA),
    )
    expect(plan.status).toBe('APPROVED')
  })

  it('exports one exact approval gate for PM and rejects expiry, revocation and archive mutation', async () => {
    const approved = await getApprovedMarketingPlanForHandoff({
      planId: plan.id,
      businessId: businessA.id,
      expectedVersion: plan.version,
      viewer: ownerA,
      db: prisma,
      now,
      createRepository: createMarketingPlanRepository,
    })
    expect(approved.approval.verdict).toBe('APPROVE')
    expect(approved.plan.currentVersion.payloadHash).toBe(plan.currentVersion.payloadHash)

    await expect(getApprovedMarketingPlanForHandoff({
      planId: plan.id,
      businessId: businessA.id,
      expectedVersion: plan.version,
      viewer: ownerA,
      db: prisma,
      now: () => new Date('2026-09-06T14:00:00.000Z'),
      createRepository: createMarketingPlanRepository,
    })).rejects.toMatchObject({ status: 409 })

    plan = await decideMarketingPlan(
      plan.id,
      {
        businessId: businessA.id,
        expectedVersion: plan.version,
        planVersionId: plan.currentVersion.id,
        payloadHash: plan.currentVersion.payloadHash,
        verdict: 'REVOKE',
        rationale: 'The accountable owner revoked the approval before handoff.',
      },
      deps(ownerA),
    )
    expect(plan.status).toBe('DRAFT')
    await expect(getApprovedMarketingPlanForHandoff({
      planId: plan.id,
      businessId: businessA.id,
      expectedVersion: plan.version,
      viewer: ownerA,
      db: prisma,
      now,
      createRepository: createMarketingPlanRepository,
    })).rejects.toMatchObject({ status: 409 })

    plan = await archiveMarketingPlan(
      plan.id,
      { businessId: businessA.id, expectedVersion: plan.version, action: 'archive' },
      deps(ownerA),
    )
    expect(plan.status).toBe('ARCHIVED')
    await expect(reviseMarketingPlan(
      plan.id,
      { businessId: businessA.id, expectedVersion: plan.version, title: 'Archived edit', payload },
      deps(ownerA),
    )).rejects.toMatchObject({ status: 409 })
  })
})
