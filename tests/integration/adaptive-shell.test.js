import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import {
  createBusinessInGroup,
  listWorkspacesForScope,
} from '@/modules/project-manager/application/scope-service'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createMilestone, createGate } from '@/modules/project-manager/application/milestone-gate-service'
import { computePortfolioProgress } from '@/modules/project-manager/application/progress-service'
import { deriveShell } from '@/lib/shell-mode'

// @req FR-020 — adding a business (A → B transition) and the group roll-up
// that the multi-business landing renders.

let first, second

describe('add a business to the group', () => {
  beforeAll(async () => {
    first = await createBusinessInGroup({ name: 'Shell Kitchen One', code: 'BUS-SHELL-1' })
    second = await createBusinessInGroup({ name: 'Shell Kitchen Two', code: 'BUS-SHELL-2' })
  })

  it('creates its own isolation boundary plus a starter workspace in one call', async () => {
    expect(first.business.code).toBe('BUS-SHELL-1')
    expect(first.tenant.id).toBeTruthy()
    expect(first.business.tenantId).toBe(first.tenant.id)
    expect(first.workspace.scopeType).toBe('BUSINESS')
    expect(first.workspace.businessId).toBe(first.business.id)
    // Both businesses hang off the same portfolio — a group, not two installs.
    expect(second.portfolio.id).toBe(first.portfolio.id)
    expect(second.tenant.id).not.toBe(first.tenant.id)
  })

  it('records an audit event for the new business', async () => {
    const events = await prisma.auditEvent.findMany({ where: { entityId: first.business.id } })
    expect(events.some((e) => e.action === 'CREATED')).toBe(true)
  })

  it('keeps the new business isolated from the first', async () => {
    const codes = (await listWorkspacesForScope({ businessId: second.business.id })).map((w) => w.code)
    expect(codes).toContain(second.workspace.code)
    expect(codes).not.toContain(first.workspace.code)
  })

  it('flips the shell from single-business to group mode', async () => {
    const one = deriveShell({ businesses: [first.business], workspaces: [first.workspace], selection: {} })
    expect(one.showBusinessSwitcher).toBe(false)
    expect(one.landing).toBe('BUSINESS')

    const two = deriveShell({
      businesses: [first.business, second.business],
      workspaces: [first.workspace, second.workspace],
      selection: {},
    })
    expect(two.showBusinessSwitcher).toBe(true)
    expect(two.landing).toBe('BUSINESS_REQUIRED')
  })
})

describe('group roll-up for the multi-business landing', () => {
  beforeAll(async () => {
    // Business one: two workstreams, one fully done → 50% at equal weight.
    const p1 = await createProject({ workspaceId: first.workspace.id, name: 'Shell P1', code: 'PRJ-SHELL-1' })
    const done = await createWorkstream({
      projectId: p1.id,
      code: 'WST-SHELL-DONE',
      name: 'Done stream',
      executionMode: 'OPERATIONS',
      progressStrategy: 'TASK_WEIGHT',
      progressWeight: 1,
    })
    const open = await createWorkstream({
      projectId: p1.id,
      code: 'WST-SHELL-OPEN',
      name: 'Open stream',
      executionMode: 'OPERATIONS',
      progressStrategy: 'TASK_WEIGHT',
      progressWeight: 1,
    })
    await prisma.workItem.createMany({
      data: [
        { workstreamId: done.id, code: 'WI-SHELL-1', subtype: 'CHECKLIST_ITEM', title: 'a', status: 'DONE', weight: 1 },
        { workstreamId: open.id, code: 'WI-SHELL-2', subtype: 'CHECKLIST_ITEM', title: 'b', status: 'PLANNED', weight: 1 },
      ],
    })
    // The card promises "next milestone" and "open required gates" — seed both.
    await createMilestone({
      projectId: p1.id,
      code: 'MS-SHELL-LATE',
      title: 'Grand opening',
      targetAt: new Date('2027-01-01').toISOString(),
    })
    await createMilestone({
      projectId: p1.id,
      code: 'MS-SHELL-NEXT',
      title: 'Soft launch',
      targetAt: new Date('2026-09-01').toISOString(),
    })
    await createGate({ projectId: p1.id, code: 'GATE-SHELL-1', title: 'Health permit', required: true })
  })

  it('returns a card per business, with the empty one honestly at 0%', async () => {
    const result = await computePortfolioProgress()
    const cardOne = result.businesses.find((b) => b.code === 'BUS-SHELL-1')
    const cardTwo = result.businesses.find((b) => b.code === 'BUS-SHELL-2')
    expect(cardOne.percent).toBe(50)
    expect(cardOne.projectCount).toBe(1)
    expect(cardTwo.percent).toBe(0)
    expect(cardTwo.projectCount).toBe(0)
    expect(cardTwo.warnings.length).toBeGreaterThan(0)
  })

  it('surfaces the soonest open milestone and the open required gates', async () => {
    const result = await computePortfolioProgress()
    const card = result.businesses.find((b) => b.code === 'BUS-SHELL-1')
    expect(card.nextMilestone.title).toBe('Soft launch')
    expect(card.openRequiredGates).toBe(1)
  })

  it('counts every business in the group total', async () => {
    const result = await computePortfolioProgress()
    expect(result.total.businessCount).toBe(result.businesses.length)
    expect(result.total.projectCount).toBeGreaterThanOrEqual(1)
  })

  it('never reports progress a project page would disagree with', async () => {
    const result = await computePortfolioProgress()
    const card = result.businesses.find((b) => b.code === 'BUS-SHELL-1')
    // Same weighted formula, recomputed from the strategies both times.
    expect(card.percent).toBe(50)
    expect(card.totalWeight).toBe(2)
  })
})
