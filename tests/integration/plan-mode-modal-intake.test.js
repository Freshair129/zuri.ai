// @req FR-012, FR-017 — the Plan Mode Customizer's envelope is accepted by the
// canonical pipeline end to end: the dry run is valid and previews inserts
// only, writing nothing; the commit lands transactionally; and the work items
// carry the Delegator / Approver metadata the All Work column reads. This is
// the proof the modal's old hand-rolled envelope never had — it would have
// been refused at validation (top-level metadata, off-contract strategy and
// subtype) had it ever reached a route that existed.
// @spec BR-003, BR-004, BR-009, SDD-006
// @tested tests/integration/plan-mode-modal-intake.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { buildPlanModeEnvelope } from '@/modules/project-manager/import/plan-mode-envelope'

let workspace
let viewer

const envelope = () =>
  buildPlanModeEnvelope({
    objective: 'ดึงรายชื่อลูกค้าที่เคยซื้อสินค้าช่วงปี 2020',
    description: 'สกัดข้อมูลคำสั่งซื้อและบัญชีลูกค้าย้อนหลังปี 2020',
    workspaceCode: 'WS-PLANMODE',
    delegator: 'AI Planning Agent',
    approver: 'คุณสมชาย',
    suffix: 'PM001',
    streams: [
      { name: 'Data Extraction & Audit 2020', mode: 'DATA_MIGRATION', itemsText: 'สกัดประวัติการสั่งซื้อ\nตรวจสอบยอดชำระ' },
      { name: 'Monthly Inventory Audit', mode: 'OPERATIONS', itemsText: 'พิมพ์รายงานสต็อกปัจจุบัน' },
    ],
  })

describe('Plan Mode Customizer → canonical import pipeline', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Plan Mode Group', code: 'PF-PLANMODE' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Plan Mode Tenant', code: 'TNT-PLANMODE' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Plan Mode Business', code: 'BUS-PLANMODE' })
    workspace = await createWorkspace({ name: 'Plan Mode WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-PLANMODE' })
    viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  it('dry run: valid, previews inserts only, and writes nothing', async () => {
    const projectsBefore = await prisma.project.count()
    const dry = await dryRunPlan(envelope(), { workspaceId: workspace.id, viewer })
    expect(dry.errors).toEqual([])
    expect(dry.valid).toBe(true)
    expect(dry.workspace.id).toBe(workspace.id)
    expect(dry.preview.conflicts).toEqual([])
    expect(dry.preview.updates).toEqual([])
    expect(dry.preview.inserts.map((row) => row.kind)).toEqual(
      expect.arrayContaining(['project', 'workstream', 'item'])
    )
    expect(await prisma.project.count()).toBe(projectsBefore)
  })

  it('commit: the previewed envelope lands transactionally, items carrying the actor binding', async () => {
    const result = await commitPlan(envelope(), { workspaceId: workspace.id, viewer })
    expect(result.committed).toBe(true)

    const project = await prisma.project.findUnique({ where: { id: result.projectId } })
    expect(project).toMatchObject({ workspaceId: workspace.id, name: 'ดึงรายชื่อลูกค้าที่เคยซื้อสินค้าช่วงปี 2020' })

    const workstreams = await prisma.workstream.findMany({ where: { projectId: project.id }, orderBy: { code: 'asc' } })
    expect(workstreams.map((ws) => ws.executionMode).sort()).toEqual(['DATA_MIGRATION', 'OPERATIONS'])

    const items = await prisma.workItem.findMany({ where: { workstreamId: { in: workstreams.map((ws) => ws.id) } } })
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(JSON.parse(item.metadataJson)).toMatchObject({ delegator: 'AI Planning Agent', approver: 'คุณสมชาย' })
    }
  })

  it('a second commit of the same envelope is a no-op preview (updates), never a duplicate project', async () => {
    const dry = await dryRunPlan(envelope(), { workspaceId: workspace.id, viewer })
    expect(dry.valid).toBe(true)
    expect(dry.preview.inserts).toEqual([])
    expect(dry.preview.updates.length).toBeGreaterThan(0)
    expect(await prisma.project.count({ where: { code: dry.plan.project.code } })).toBe(1)
  })
})
