import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import {
  createMarketingOperationsIntake,
  getMarketingOperationsHandoff,
  getMarketingOperationsIntake,
  listMarketingOperations,
  updateMarketingOperationsIntake,
} from '@/modules/marketing/application/marketing-operations-service'

// @req FR-162 — real Operations persistence proves Business/Tenant scope,
// audited CAS intake writes, bounded aggregate state and validated owner
// projections without duplicate PM records.
// @spec SDD-089, FR-158, SEC-001, SEC-003
// @tested tests/integration/marketing-operations.test.js

const DOMAINS = ['growth']
const NOW = new Date('2026-09-07T04:00:00.000Z')

function suffix() {
  return randomUUID().slice(0, 8).toUpperCase()
}

function ownerViewer(businessId, principal = 'operations-owner') {
  return makeViewer({
    principal: { id: principal, code: principal, displayName: principal },
    visibleBusinessIds: [businessId],
    ownedBusinessIds: [businessId],
    visibleDomains: DOMAINS,
    domainsByBusinessId: { [businessId]: DOMAINS },
  })
}

function memberViewer(businessId) {
  return makeViewer({
    role: 'MEMBER',
    principal: { id: 'operations-member', code: 'operations-member', displayName: 'Member' },
    visibleBusinessIds: [businessId],
    ownedBusinessIds: [],
    visibleDomains: DOMAINS,
    domainsByBusinessId: { [businessId]: DOMAINS },
  })
}

describe('Marketing Operations coordination (FR-162)', () => {
  let business
  let tenant
  let workspace
  let owner
  let intake
  let handoff
  let project

  beforeAll(async () => {
    const id = suffix()
    const portfolio = await createPortfolio({ name: `Operations ${id}`, code: `PF-OPS-${id}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `Operations tenant ${id}`, code: `TNT-OPS-${id}` })
    business = await createBusiness({ tenantId: tenant.id, name: `Operations business ${id}`, code: `BUS-OPS-${id}` })
    workspace = await createWorkspace({ businessId: business.id, scopeType: 'BUSINESS', name: `Operations workspace ${id}`, code: `WS-OPS-${id}` })
    owner = ownerViewer(business.id)
    const person = await prisma.person.create({ data: { code: `PER-OPS-${id}`, displayName: 'Operations owner' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: JSON.stringify(DOMAINS) } })

    const plan = await prisma.marketingPlan.create({
      data: { tenantId: tenant.id, businessId: business.id, code: `PLAN-OPS-${id}`, title: 'Operations plan', status: 'APPROVED', createdBy: owner.principal.id },
    })
    const version = await prisma.marketingPlanVersion.create({
      data: { planId: plan.id, revision: 1, payloadJson: JSON.stringify({ title: plan.title, payload: {} }), payloadHash: 'a'.repeat(64), createdBy: owner.principal.id },
    })
    project = await prisma.project.create({ data: { code: `PRJ-OPS-${id}`, businessId: business.id, workspaceId: workspace.id, name: 'Operations PM project', status: 'ACTIVE' } })
    handoff = await prisma.marketingHandoff.create({
      data: {
        planId: plan.id,
        planVersionId: version.id,
        workspaceId: workspace.id,
        projectId: project.id,
        payloadHash: version.payloadHash,
        envelopeHash: 'b'.repeat(64),
        receiptJson: JSON.stringify({ status: 'SUCCEEDED', planId: plan.id, planVersionId: version.id, workspaceId: workspace.id, projectId: project.id, pm: { status: 'SUCCEEDED', projectId: project.id } }),
        createdBy: owner.principal.id,
      },
    })
  })

  const readExecution = async ({ planId, handoffId }) => ({
    status: 'READY',
    reasonCode: null,
    handoff: { id: handoffId, planVersionId: 'version-1', revision: 1, payloadHash: 'a'.repeat(64), workspaceId: workspace.id, projectId: project.id, isCurrentRevision: true },
    roadmap: {
      project: { id: project.id, code: project.code, name: project.name, status: 'ACTIVE', startAt: null, targetAt: '2026-09-15T00:00:00.000Z', progress: { percent: 25 } },
      plans: [{ planId: 'workstream-1', projectId: project.id, name: 'Operations workstream', status: 'ACTIVE', startAt: null, targetAt: '2026-09-12T00:00:00.000Z', progress: { percent: 10 } }],
      items: [
        { workItemId: 'item-1', projectId: project.id, title: 'Prepare owner receipt', code: 'WI-1', status: 'READY', startAt: null, targetAt: '2026-09-10T00:00:00.000Z' },
        { workItemId: 'item-1', projectId: project.id, title: 'Prepare owner receipt', code: 'WI-1', status: 'READY', startAt: null, targetAt: '2026-09-10T00:00:00.000Z' },
      ],
      closure: { gates: [] },
      meta: { generatedAt: NOW.toISOString() },
    },
  })

  it('creates and updates one audited intake with expected-version CAS', async () => {
    const created = await createMarketingOperationsIntake({
      businessId: business.id,
      title: 'Autumn landing refresh',
      capability: 'Website & CRO',
      objective: 'Improve qualified conversion from the search landing page.',
      requiredAt: '2026-09-12T00:00:00.000Z',
      evidenceReference: 'analytics://landing/v1',
    }, { viewer: owner }, { db: prisma })
    intake = created.intake
    expect(intake).toMatchObject({ businessId: business.id, status: 'NEW', version: 1 })
    expect(await prisma.auditEvent.count({ where: { entityType: 'MARKETING_OPERATIONS_INTAKE', entityId: intake.id, action: 'MARKETING_OPERATIONS_INTAKE_CREATED' } })).toBe(1)
    const updated = await updateMarketingOperationsIntake(intake.id, { action: 'update', businessId: business.id, expectedVersion: 1, fields: { status: 'TRIAGED', title: 'Autumn landing refresh v2' } }, { viewer: owner }, { db: prisma })
    expect(updated.intake).toMatchObject({ id: intake.id, status: 'TRIAGED', version: 2, title: 'Autumn landing refresh v2' })
    await expect(updateMarketingOperationsIntake(intake.id, { action: 'update', businessId: business.id, expectedVersion: 1, fields: { title: 'stale' } }, { viewer: owner }, { db: prisma })).rejects.toMatchObject({ status: 409 })
  })

  it('composes approvals, PM calendar and handoff receipts with stable deduped IDs', async () => {
    const aggregate = await listMarketingOperations({ businessId: business.id, viewer: owner }, { db: prisma, now: NOW, readMarketingCampaignExecution: readExecution })
    expect(aggregate).toMatchObject({ readModel: 'MARKETING_OPERATIONS', businessId: business.id, canWrite: true })
    expect(aggregate.sections.intake.state).toBe('READY')
    expect(aggregate.sections.approvals.state).toBe('READY')
    expect(aggregate.sections.calendar.state).toBe('READY')
    expect(aggregate.sections.handoffs.state).toBe('READY')
    expect(aggregate.calendar.filter((row) => row.recordType === 'WORK_ITEM')).toHaveLength(1)
    expect(aggregate.handoffs[0]).toMatchObject({ id: handoff.id, status: 'READY', projectId: project.id })
    expect(aggregate.handoffs[0]).not.toHaveProperty('_roadmap')
  })

  it('returns explicit handoff detail and refuses member writes', async () => {
    const detail = await getMarketingOperationsHandoff(handoff.id, { businessId: business.id, viewer: owner }, { db: prisma, readMarketingCampaignExecution: readExecution })
    expect(detail).toMatchObject({ businessId: business.id, handoff: { id: handoff.id, status: 'READY', projectId: project.id } })
    await expect(createMarketingOperationsIntake({ businessId: business.id, title: 'Member request', capability: 'SEO', objective: 'No write' }, { viewer: memberViewer(business.id) }, { db: prisma })).rejects.toMatchObject({ status: 404 })
    const visible = await getMarketingOperationsIntake(intake.id, { businessId: business.id, viewer: memberViewer(business.id) }, { db: prisma })
    expect(visible.canWrite).toBe(false)
  })
})
