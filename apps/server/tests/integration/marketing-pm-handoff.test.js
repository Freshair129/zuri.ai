import { beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import {
  buildPlanEnvelope,
  createMarketingPmHandoffService,
} from '@/modules/marketing/application/marketing-pm-handoff-service'
import { hashMarketingPlanContent } from '@/modules/marketing/domain/marketing-plan-contract'
import { createMarketingPlan, decideMarketingPlan, reviewMarketingPlan } from '@/modules/marketing/application/marketing-plan-service'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'

// @req FR-158 — the Marketing handoff preserves exact approval, target scope,
// preview concurrency, transactional receipt association and replay semantics.
// @spec SDD-086, BR-007, SEC-001, SEC-003
// @tested tests/integration/marketing-pm-handoff.test.js

let sequence = 0

const payload = {
  objective: 'Launch the new customer campaign',
  situation: 'The existing audience needs a focused offer.',
  audience: 'existing customers',
  channels: ['META_ADS', 'TIKTOK_ADS', 'INSTAGRAM', 'GA4', 'SEO'],
  budget: 100000,
  currency: 'THB',
  successMetric: 'Measure qualified leads after launch.',
  actions: [{ title: 'Prepare campaign creative' }, { title: 'Review audience experiment' }],
}

function viewerFor(businessId, { owner = true } = {}) {
  return makeViewer({
    role: owner ? 'OWNER' : 'MEMBER',
    visibleBusinessIds: [businessId],
    ownedBusinessIds: owner ? [businessId] : [],
    visibleDomains: ['growth'],
    domainsByBusinessId: { [businessId]: ['growth'] },
    principal: { id: `person-handoff-${businessId}`, code: 'HANDOFF', displayName: 'Handoff Test' },
  })
}

async function fixture() {
  const suffix = `${Date.now()}-${sequence++}`
  const portfolio = await createPortfolio({ code: `PF-MKT-${suffix}`, name: 'Marketing handoff group' })
  const tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-MKT-${suffix}`, name: 'Marketing handoff tenant' })
  const business = await createBusiness({ tenantId: tenant.id, code: `BUS-MKT-${suffix}`, name: 'Marketing handoff business' })
  const workspace = await createWorkspace({
    code: `WS-MKT-${suffix}`,
    name: 'Marketing handoff workspace',
    scopeType: 'BUSINESS',
    businessId: business.id,
  })
  const createdAt = new Date('2026-09-06T00:00:00.000Z')
  const plan = await prisma.marketingPlan.create({
    data: {
      tenantId: tenant.id,
      businessId: business.id,
      code: `PLAN-MKT-${suffix}`,
      title: 'Customer campaign',
      status: 'APPROVED',
      currentRevision: 1,
      version: 3,
      createdBy: 'author-person',
      createdAt,
    },
  })
  const version = await prisma.marketingPlanVersion.create({
    data: {
      planId: plan.id,
      revision: 1,
      payloadJson: JSON.stringify({ title: 'Customer campaign', payload }),
      payloadHash: hashMarketingPlanContent({ title: 'Customer campaign', payload }),
      createdBy: 'author-person',
      createdAt,
    },
  })
  const review = await prisma.marketingReview.create({
    data: {
      planId: plan.id,
      planVersionId: version.id,
      payloadHash: version.payloadHash,
      verdict: 'PASS',
      rationale: 'Reviewed by an independent owner.',
      reviewerId: 'reviewer-person',
      createdAt,
    },
  })
  const decision = await prisma.marketingDecision.create({
    data: {
      planId: plan.id,
      planVersionId: version.id,
      payloadHash: version.payloadHash,
      reviewId: review.id,
      verdict: 'APPROVE',
      rationale: 'Approved for PM execution.',
      actorId: 'approver-person',
      expiresAt: new Date('2026-09-07T00:00:00.000Z'),
      createdAt,
    },
  })
  const readApprovedPlan = async ({ db }) => {
    const currentPlan = await db.marketingPlan.findUnique({ where: { id: plan.id } })
    const currentVersion = await db.marketingPlanVersion.findUnique({ where: { id: version.id } })
    const currentReview = await db.marketingReview.findUnique({ where: { id: review.id } })
    const currentDecision = await db.marketingDecision.findUnique({ where: { id: decision.id } })
    return {
      plan: {
        ...currentPlan,
        currentVersion: {
          id: currentVersion.id,
          revision: currentVersion.revision,
          payloadHash: currentVersion.payloadHash,
          payload,
          createdBy: currentVersion.createdBy,
          createdAt: currentVersion.createdAt,
        },
        reviews: [currentReview],
        decisions: [currentDecision],
      },
      approval: currentDecision,
    }
  }
  const makeDryRun = ({ changed = false } = {}) => {
    let calls = 0
    return {
      get calls() {
        return calls
      },
      run: async (envelope, { workspaceId }) => {
        calls += 1
        const insertCount = changed ? calls : 3
        return {
          valid: true,
          errors: [],
          workspace: { id: workspaceId, code: workspace.code, name: workspace.name, businessId: business.id },
          resolution: { [envelope.project.code]: { entityId: 'resolved-project', matchedBy: 'code' } },
          preview: {
            inserts: Array.from({ length: insertCount }, (_, index) => ({ kind: 'item', code: `I-${index}` })),
            updates: [],
            conflicts: [],
            summary: { insertCount, updateCount: 0, conflictCount: 0 },
          },
        }
      },
    }
  }
  return { business, workspace, plan, version, review, decision, readApprovedPlan, makeDryRun }
}

function serviceFor(fx, { dryRun = fx.makeDryRun(), commit = null } = {}) {
  return createMarketingPmHandoffService({
    db: prisma,
    readApprovedPlan: fx.readApprovedPlan,
    dryRun: dryRun.run,
    commit: commit || (async () => ({ committed: true, projectId: fx.projectId, projectCode: 'resolved-project', auditEventId: 'pm-audit' })),
    now: () => new Date('2026-09-06T12:00:00.000Z'),
  })
}

async function inputFor(fx, action = 'preview', viewer = viewerFor(fx.business.id), previewHash) {
  return {
    planId: fx.plan.id,
    businessId: fx.business.id,
    workspaceId: fx.workspace.id,
    expectedVersion: fx.plan.version,
    action,
    ...(previewHash ? { previewHash } : {}),
  }
}

describe('Marketing PM handoff', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('builds a schema 1.2 B2C envelope with stable scoped Project and revision-specific work', async () => {
    const fx = await fixture()
    const envelope = buildPlanEnvelope({
      plan: fx.plan,
      version: fx.version,
      payload,
      business: fx.business,
      workspace: fx.workspace,
    })
    expect(envelope.schemaVersion).toBe('1.2')
    expect(envelope.project.code).toContain(fx.business.id)
    expect(envelope.project.code).toContain(fx.workspace.id)
    expect(envelope.workstreams[0].code).toContain('R1')
    expect(envelope.workstreams[0].progressStrategy).toBe('KPI_ATTAINMENT')
    expect(envelope.workstreams[0].items.map((item) => item.title)).toEqual(payload.actions.map((action) => action.title))
    expect(envelope.generatedAt).toBe(fx.version.createdAt.toISOString())
  })

  it('preserves PM import authority for preview and commit through the real services', async () => {
    const fx = await fixture()
    const service = createMarketingPmHandoffService({ db: prisma, now: () => new Date('2026-09-06T12:00:00.000Z') })
    const owner = viewerFor(fx.business.id)
    const ownerPreview = await service.preview(await inputFor(fx), { viewer: owner })
    expect(ownerPreview.valid).toBe(true)
    const visible = viewerFor(fx.business.id, { owner: false })
    const preview = await service.preview(await inputFor(fx, 'preview', visible), { viewer: visible })
    expect(preview.valid).toBe(false)
    expect(preview.errors).toEqual(expect.arrayContaining([expect.stringContaining('Target workspace not found')]))
    await expect(service.commit(await inputFor(fx, 'commit', visible, ownerPreview.previewHash), { viewer: visible })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.marketingHandoff.count({ where: { planId: fx.plan.id } })).toBe(0)
  })

  it('rejects a stale expectedVersion before PM preview or mutation', async () => {
    const fx = await fixture()
    const dryRun = fx.makeDryRun()
    const service = serviceFor(fx, { dryRun })
    await expect(
      service.preview({ ...(await inputFor(fx)), expectedVersion: fx.plan.version - 1 }, { viewer: viewerFor(fx.business.id) }),
    ).rejects.toMatchObject({ code: 'MARKETING_PLAN_VERSION_STALE' })
    expect(dryRun.calls).toBe(0)
  })

  it('refuses persisted replay outside Business visibility before asking PM', async () => {
    const fx = await fixture()
    const projectCode = `MKT-${fx.business.id}-${fx.workspace.id}-${fx.plan.code}`
    const project = await prisma.project.create({ data: { code: projectCode, businessId: fx.business.id, workspaceId: fx.workspace.id, name: fx.plan.title, type: 'MARKETING_PLAN' } })
    const dryRun = fx.makeDryRun()
    const service = serviceFor(fx, { dryRun, commit: async () => ({ committed: true, projectId: project.id, projectCode }) })
    const owner = viewerFor(fx.business.id)
    const preview = await service.preview(await inputFor(fx), { viewer: owner })
    await service.commit(await inputFor(fx, 'commit', owner, preview.previewHash), { viewer: owner })
    const callsBefore = dryRun.calls
    const hidden = makeViewer({ role: 'MEMBER', principal: { id: 'hidden-marketing-viewer' }, visibleBusinessIds: [], ownedBusinessIds: [], visibleDomains: ['growth'] })
    await expect(service.preview(await inputFor(fx), { viewer: hidden })).rejects.toMatchObject({ status: 404 })
    expect(dryRun.calls).toBe(callsBefore)
  })

  it('rejects caller-supplied tenant or actor scope fields', async () => {
    const fx = await fixture()
    const service = serviceFor(fx)
    const viewer = viewerFor(fx.business.id)
    await expect(
      service.preview({ ...(await inputFor(fx)), tenantId: 'attacker-tenant', actorId: 'attacker' }, { viewer }),
    ).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('rejects a changed PM preview between preview and commit', async () => {
    const fx = await fixture()
    const dryRun = fx.makeDryRun({ changed: true })
    const service = serviceFor(fx, { dryRun })
    const viewer = viewerFor(fx.business.id)
    const preview = await service.preview(await inputFor(fx), { viewer })
    await expect(service.commit(await inputFor(fx, 'commit', viewer, preview.previewHash), { viewer })).rejects.toMatchObject({ code: 'MARKETING_HANDOFF_PREVIEW_STALE' })
    expect(await prisma.marketingHandoff.count({ where: { planId: fx.plan.id } })).toBe(0)
  })

  it('rolls back Marketing receipt and audit when PM commit fails', async () => {
    const fx = await fixture()
    const auditCountBefore = await prisma.auditEvent.count({ where: { action: 'MARKETING_PM_HANDOFF_COMMITTED' } })
    const dryRun = fx.makeDryRun()
    const service = serviceFor(fx, {
      dryRun,
      commit: async () => {
        throw new Error('simulated PM failure')
      },
    })
    const viewer = viewerFor(fx.business.id)
    const preview = await service.preview(await inputFor(fx), { viewer })
    await expect(service.commit(await inputFor(fx, 'commit', viewer, preview.previewHash), { viewer })).rejects.toThrow('simulated PM failure')
    expect(await prisma.marketingHandoff.count({ where: { planId: fx.plan.id } })).toBe(0)
    expect(await prisma.auditEvent.count({ where: { action: 'MARKETING_PM_HANDOFF_COMMITTED' } })).toBe(auditCountBefore)
  })

  it('rolls back the real PM import, CAS and receipt when Marketing audit fails', async () => {
    const fx = await fixture()
    const projectCode = `MKT-${fx.business.id}-${fx.workspace.id}-${fx.plan.code}`
    const viewer = viewerFor(fx.business.id)
    const service = createMarketingPmHandoffService({
      db: prisma,
      now: () => new Date('2026-09-06T12:00:00.000Z'),
      audit: async () => {
        throw new Error('simulated Marketing audit failure')
      },
    })
    const preview = await service.preview(await inputFor(fx), { viewer })
    await expect(
      service.commit(await inputFor(fx, 'commit', viewer, preview.previewHash), { viewer }),
    ).rejects.toThrow('simulated Marketing audit failure')

    expect(await prisma.project.findUnique({ where: { code: projectCode } })).toBeNull()
    expect(await prisma.marketingHandoff.count({ where: { planId: fx.plan.id } })).toBe(0)
    expect((await prisma.marketingPlan.findUnique({ where: { id: fx.plan.id } }))?.version).toBe(fx.plan.version)
    const receipts = await prisma.planImportReceipt.findMany({ include: { project: true } })
    expect(receipts.some((receipt) => receipt.project?.code === projectCode)).toBe(false)
    const importedAudits = await prisma.auditEvent.findMany({ where: { action: 'PLAN_IMPORTED' } })
    expect(importedAudits.some((event) => JSON.parse(event.payloadJson).projectCode === projectCode)).toBe(false)
  })

  it('preserves an existing Project lifecycle status while the PM importer advances its version', async () => {
    const fx = await fixture()
    const projectCode = `MKT-${fx.business.id}-${fx.workspace.id}-${fx.plan.code}`
    const project = await prisma.project.create({
      data: {
        code: projectCode,
        businessId: fx.business.id,
        workspaceId: fx.workspace.id,
        name: fx.plan.title,
        type: 'MARKETING_PLAN',
        status: 'ACTIVE',
        version: 7,
      },
    })
    const priorVersion = await prisma.marketingPlanVersion.create({
      data: {
        planId: fx.plan.id,
        revision: 2,
        payloadJson: JSON.stringify({ title: fx.plan.title, payload }),
        payloadHash: hashMarketingPlanContent({ title: fx.plan.title, payload }),
        createdBy: 'author-person',
        createdAt: new Date('2026-09-06T00:00:01.000Z'),
      },
    })
    await prisma.marketingHandoff.create({
      data: {
        planId: fx.plan.id,
        planVersionId: priorVersion.id,
        workspaceId: fx.workspace.id,
        projectId: project.id,
        payloadHash: priorVersion.payloadHash,
        envelopeHash: 'prior-envelope-hash',
        receiptJson: JSON.stringify({
          handoffId: 'prior-handoff',
          planId: fx.plan.id,
          businessId: fx.business.id,
          planVersionId: priorVersion.id,
          expectedVersion: fx.plan.version - 1,
          workspaceId: fx.workspace.id,
          projectId: project.id,
          payloadHash: priorVersion.payloadHash,
          envelopeHash: 'prior-envelope-hash',
          previewHash: 'prior-preview-hash',
        }),
        createdBy: 'author-person',
      },
    })
    const viewer = viewerFor(fx.business.id)
    const service = createMarketingPmHandoffService({ db: prisma, now: () => new Date('2026-09-06T12:00:00.000Z') })
    const preview = await service.preview(await inputFor(fx), { viewer })
    expect(preview.valid).toBe(true)
    expect(preview.envelope.project.status).toBe('ACTIVE')
    expect(preview.preview.pm.currentProject.version).toBe(7)

    const committed = await service.commit(
      await inputFor(fx, 'commit', viewer, preview.previewHash),
      { viewer },
    )
    expect(committed.committed).toBe(true)
    const updatedProject = await prisma.project.findUnique({ where: { id: project.id } })
    expect(updatedProject?.status).toBe('ACTIVE')
    expect(updatedProject?.version).toBe(8)
  })

  it('replays the immutable receipt without a second PM commit', async () => {
    const fx = await fixture()
    const projectCode = `MKT-${fx.business.id}-${fx.workspace.id}-${fx.plan.code}`
    const project = await prisma.project.create({
      data: { code: projectCode, businessId: fx.business.id, workspaceId: fx.workspace.id, name: fx.plan.title, type: 'MARKETING_PLAN' },
    })
    fx.projectId = project.id
    const commit = vi.fn(async () => ({ committed: true, projectId: project.id, projectCode, auditEventId: 'pm-audit' }))
    const service = serviceFor(fx, { commit })
    const viewer = viewerFor(fx.business.id)
    const preview = await service.preview(await inputFor(fx), { viewer })
    const first = await service.commit(await inputFor(fx, 'commit', viewer, preview.previewHash), { viewer })
    const second = await service.commit(await inputFor(fx, 'commit', viewer, preview.previewHash), { viewer })
    expect(first.replay).toBe(false)
    expect(second.replay).toBe(true)
    expect(second.receipt).toEqual(first.receipt)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(await prisma.marketingHandoff.count({ where: { planId: fx.plan.id } })).toBe(1)
  })

  it('rejects a historical receipt whose row or immutable version binding is inconsistent', async () => {
    const fx = await fixture()
    const projectCode = `MKT-${fx.business.id}-${fx.workspace.id}-${fx.plan.code}`
    const project = await prisma.project.create({
      data: { code: projectCode, businessId: fx.business.id, workspaceId: fx.workspace.id, name: fx.plan.title, type: 'MARKETING_PLAN' },
    })
    fx.projectId = project.id
    const service = serviceFor(fx, {
      commit: async () => ({ committed: true, projectId: project.id, projectCode, auditEventId: 'pm-audit' }),
    })
    const viewer = viewerFor(fx.business.id)
    const preview = await service.preview(await inputFor(fx), { viewer })
    const committed = await service.commit(await inputFor(fx, 'commit', viewer, preview.previewHash), { viewer })
    const handoff = await prisma.marketingHandoff.findUnique({ where: { id: committed.receipt.handoffId } })
    const receipt = JSON.parse(handoff.receiptJson)

    await prisma.marketingHandoff.update({
      where: { id: handoff.id },
      data: { receiptJson: JSON.stringify({ ...receipt, payloadHash: '0'.repeat(64) }) },
    })
    await expect(service.preview(await inputFor(fx), { viewer })).rejects.toMatchObject({ code: 'MARKETING_RECEIPT_CORRUPT' })

    await prisma.marketingHandoff.update({ where: { id: handoff.id }, data: { receiptJson: JSON.stringify(receipt) } })
    await prisma.marketingPlanVersion.update({
      where: { id: fx.version.id },
      data: { payloadJson: JSON.stringify({ title: fx.plan.title, payload: { ...payload, objective: 'Tampered revision content' } }) },
    })
    await expect(service.preview(await inputFor(fx), { viewer })).rejects.toMatchObject({ code: 'MARKETING_RECEIPT_CORRUPT' })
  })

  it('replays history after the decision has expired or been revoked', async () => {
    const fx = await fixture()
    const projectCode = `MKT-${fx.business.id}-${fx.workspace.id}-${fx.plan.code}`
    const project = await prisma.project.create({
      data: { code: projectCode, businessId: fx.business.id, workspaceId: fx.workspace.id, name: fx.plan.title, type: 'MARKETING_PLAN' },
    })
    fx.projectId = project.id
    const service = serviceFor(fx)
    const viewer = viewerFor(fx.business.id)
    const preview = await service.preview(await inputFor(fx), { viewer })
    const first = await service.commit(await inputFor(fx, 'commit', viewer, preview.previewHash), { viewer })
    await prisma.marketingDecision.update({ where: { id: fx.decision.id }, data: { verdict: 'REVOKE', expiresAt: null } })
    const second = await service.commit(await inputFor(fx, 'commit', viewer, preview.previewHash), { viewer })
    expect(second.replay).toBe(true)
    expect(second.receipt).toEqual(first.receipt)
  })

  it('rechecks PM target authorization before replaying historical receipts', async () => {
    const fx = await fixture()
    const projectCode = `MKT-${fx.business.id}-${fx.workspace.id}-${fx.plan.code}`
    const project = await prisma.project.create({
      data: { code: projectCode, businessId: fx.business.id, workspaceId: fx.workspace.id, name: fx.plan.title, type: 'MARKETING_PLAN' },
    })
    fx.projectId = project.id
    const authorized = fx.makeDryRun()
    const service = serviceFor(fx, {
      dryRun: authorized,
      commit: async () => ({ committed: true, projectId: project.id, projectCode, auditEventId: 'pm-audit' }),
    })
    const viewer = viewerFor(fx.business.id)
    const preview = await service.preview(await inputFor(fx), { viewer })
    await service.commit(await inputFor(fx, 'commit', viewer, preview.previewHash), { viewer })

    const denied = {
      run: async () => ({
        valid: false,
        errors: ['Target workspace not found'],
        workspace: { id: fx.workspace.id, businessId: fx.business.id },
      }),
    }
    const replayService = serviceFor(fx, { dryRun: denied })
    await expect(replayService.preview(await inputFor(fx), { viewer })).rejects.toMatchObject({
      status: 404,
      code: 'MARKETING_WORKSPACE_NOT_FOUND',
    })
  })

  it('creates and approves through Marketing core, then commits through the real PM importer', async () => {
    const fx = await fixture()
    // The fixture above supplies the real scope roots; use a fresh Business
    // owner with distinct principals so the core review independence rule is
    // exercised by the same service that the route uses.
    const author = viewerFor(fx.business.id)
    author.principal = { id: 'marketing-author', code: 'AUTHOR', displayName: 'Marketing Author' }
    const reviewer = viewerFor(fx.business.id)
    reviewer.principal = { id: 'marketing-reviewer', code: 'REVIEWER', displayName: 'Marketing Reviewer' }
    const now = () => new Date('2026-09-06T12:00:00.000Z')
    const created = await createMarketingPlan(
      { businessId: fx.business.id, title: 'Core service campaign', payload },
      { db: prisma, viewer: author, now },
    )
    const reviewed = await reviewMarketingPlan(
      created.id,
      {
        businessId: fx.business.id,
        expectedVersion: created.version,
        planVersionId: created.currentVersion.id,
        payloadHash: created.currentVersion.payloadHash,
        verdict: 'PASS',
        rationale: 'Independent core review.',
      },
      { db: prisma, viewer: reviewer, now },
    )
    const approved = await decideMarketingPlan(
      created.id,
      {
        businessId: fx.business.id,
        expectedVersion: reviewed.version,
        planVersionId: reviewed.currentVersion.id,
        payloadHash: reviewed.currentVersion.payloadHash,
        reviewId: reviewed.reviews[0].id,
        verdict: 'APPROVE',
        rationale: 'Core approval for PM execution.',
        expiresAt: '2026-09-07T00:00:00.000Z',
      },
      { db: prisma, viewer: author, now },
    )
    const service = createMarketingPmHandoffService({ db: prisma, now })
    const input = {
      planId: approved.id,
      businessId: fx.business.id,
      workspaceId: fx.workspace.id,
      expectedVersion: approved.version,
      action: 'preview',
    }
    const preview = await service.preview(input, { viewer: author })
    expect(preview.valid).toBe(true)
    const committed = await service.commit({ ...input, action: 'commit', previewHash: preview.previewHash }, { viewer: author })
    expect(committed.committed).toBe(true)
    expect(committed.replay).toBe(false)

    const handoff = await prisma.marketingHandoff.findUnique({ where: { id: committed.receipt.handoffId } })
    const project = await prisma.project.findUnique({ where: { id: committed.receipt.projectId }, include: { workstreams: { include: { items: true, containers: true } } } })
    const pmReceipt = await prisma.planImportReceipt.findFirst({ where: { projectId: project.id } })
    const planAfter = await prisma.marketingPlan.findUnique({ where: { id: approved.id } })
    expect(handoff?.envelopeHash).toBe(committed.receipt.envelopeHash)
    expect(project?.workspaceId).toBe(fx.workspace.id)
    expect(project?.businessId).toBe(fx.business.id)
    expect(project?.workstreams).toHaveLength(1)
    expect(project.workstreams[0].items).toHaveLength(payload.actions.length)
    expect(project.workstreams[0].containers).toHaveLength(1)
    expect(pmReceipt?.payloadHash).toBeTruthy()
    expect(planAfter?.version).toBe(approved.version + 1)
    expect(await prisma.auditEvent.count({ where: { action: 'MARKETING_PM_HANDOFF_COMMITTED', entityId: handoff.id } })).toBe(1)
    expect(await prisma.auditEvent.count({ where: { action: 'PLAN_IMPORTED', entityId: project.id } })).toBe(1)
  })
})
