// @req FR-005, FR-017 — the Create Task modal's envelope travels the real
// pipeline: a standalone task creates the Business inbox Project and its
// workstream through the same dry run → commit the first time and only adds an
// item every time after; a task bound to an existing Project updates that
// Project and Workstream in place (no duplicate, no reset of the workstream's
// own fields) and inserts the one item. This is the proof the old direct
// POST /api/workstreams + POST /api/work path never had.
// @spec BR-004, BR-009, SDD-006, SDD-009
// @tested tests/integration/task-modal-intake.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import {
  buildTaskEnvelope,
  inboxProjectFor,
  inboxWorkstreamFor,
} from '@/modules/project-manager/import/task-envelope'

let business
let otherBusiness
let workspace
let otherWorkspace
let viewer

const kinds = (rows) => rows.map((row) => row.kind).sort()

const task = (over = {}) => ({
  title: 'ส่งเอกสารสรุปยอดขายให้บัญชี',
  description: 'รวบรวมยอดขายรายสาขาแล้วส่งภายในวันศุกร์',
  subtype: 'CHECKLIST_ITEM',
  status: 'PLANNED',
  weight: 1,
  createdBy: 'Local Owner',
  delegator: 'AI Agent',
  approver: 'คุณพรพร',
  ...over,
})

describe('Create Task modal → canonical import pipeline', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Task Modal Group', code: 'PF-TASKBOX' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Task Modal Tenant', code: 'TNT-TASKBOX' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Taskbox Business', code: 'BUS-TASKBOX' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'Other Business', code: 'BUS-OTHERBOX' })
    workspace = await createWorkspace({ name: 'Taskbox WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-TASKBOX' })
    otherWorkspace = await createWorkspace({ name: 'Other WS', scopeType: 'BUSINESS', businessId: otherBusiness.id, code: 'WS-OTHERBOX' })
    viewer = makeViewer({
      visibleBusinessIds: [business.id, otherBusiness.id],
      ownedBusinessIds: [business.id, otherBusiness.id],
    })
  })

  it('a standalone task, first time: the inbox Project and workstream are created through the pipeline', async () => {
    const plan = buildTaskEnvelope({ business, task: task(), suffix: 'T1' })
    const dry = await dryRunPlan(plan, { workspaceId: workspace.id, viewer })
    expect(dry.errors).toEqual([])
    expect(dry.valid).toBe(true)
    expect(kinds(dry.preview.inserts)).toEqual(['item', 'project', 'workstream'])
    expect(dry.preview.updates).toEqual([])
    expect(dry.preview.conflicts).toEqual([])

    const result = await commitPlan(plan, { workspaceId: workspace.id, viewer })
    expect(result.committed).toBe(true)

    const project = await prisma.project.findUnique({ where: { code: inboxProjectFor(business).code } })
    expect(project).toMatchObject({ businessId: business.id, workspaceId: workspace.id })
    const workstreams = await prisma.workstream.findMany({ where: { projectId: project.id } })
    expect(workstreams).toHaveLength(1)
    expect(workstreams[0]).toMatchObject({
      code: inboxWorkstreamFor(business).code,
      executionMode: 'OPERATIONS',
      progressStrategy: 'SLA_SCORE',
    })
    const items = await prisma.workItem.findMany({ where: { workstreamId: workstreams[0].id } })
    expect(items).toHaveLength(1)
    expect(JSON.parse(items[0].metadataJson)).toMatchObject({
      createdBy: 'Local Owner',
      delegator: 'AI Agent',
      approver: 'คุณพรพร',
      isStandalone: true,
    })
  })

  it('a second standalone task: inbox Project and workstream are updates, only the item is inserted', async () => {
    const plan = buildTaskEnvelope({ business, task: task({ title: 'ตรวจนับสต็อกสิ้นเดือน' }), suffix: 'T2' })
    const dry = await dryRunPlan(plan, { workspaceId: workspace.id, viewer })
    expect(dry.valid).toBe(true)
    expect(kinds(dry.preview.inserts)).toEqual(['item'])
    expect(kinds(dry.preview.updates)).toEqual(['project', 'workstream'])
    expect(dry.preview.conflicts).toEqual([])

    const result = await commitPlan(plan, { workspaceId: workspace.id, viewer })
    expect(result.committed).toBe(true)

    expect(await prisma.project.count({ where: { code: inboxProjectFor(business).code } })).toBe(1)
    const workstreams = await prisma.workstream.findMany({ where: { code: inboxWorkstreamFor(business).code } })
    expect(workstreams).toHaveLength(1)
    expect(await prisma.workItem.count({ where: { workstreamId: workstreams[0].id } })).toBe(2)
  })

  it('a task bound to an existing Project updates it in place and keeps the workstream\'s own fields', async () => {
    // What the modal fetches: the Project from GET /api/projects?businessId
    // (code, name, workspace.code, workspaceId) and the Workstream from
    // GET /api/workstreams?projectId (code, name, mode, strategy, weight).
    const projectRow = await prisma.project.findUnique({
      where: { code: inboxProjectFor(business).code },
      include: { workspace: { select: { code: true } } },
    })
    const workstreamRow = await prisma.workstream.findFirst({ where: { projectId: projectRow.id } })
    // A weight the form never knew about: it must survive the update.
    await prisma.workstream.update({ where: { id: workstreamRow.id }, data: { progressWeight: 2.5 } })
    const fetchedWorkstream = await prisma.workstream.findUnique({ where: { id: workstreamRow.id } })

    const plan = buildTaskEnvelope({
      business,
      project: projectRow,
      workstream: fetchedWorkstream,
      task: task({ title: 'ยืนยันยอดกับสาขา', subtype: 'ISSUE' }),
      suffix: 'T3',
    })
    expect(plan.scope).toEqual({ workspaceCode: 'WS-TASKBOX' })

    const dry = await dryRunPlan(plan, { workspaceId: projectRow.workspaceId, viewer })
    expect(dry.valid).toBe(true)
    expect(kinds(dry.preview.inserts)).toEqual(['item'])
    expect(kinds(dry.preview.updates)).toEqual(['project', 'workstream'])

    const result = await commitPlan(plan, { workspaceId: projectRow.workspaceId, viewer })
    expect(result.committed).toBe(true)
    expect(result.projectId).toBe(projectRow.id)

    const after = await prisma.workstream.findUnique({ where: { id: workstreamRow.id } })
    expect(after).toMatchObject({
      name: workstreamRow.name,
      executionMode: workstreamRow.executionMode,
      progressStrategy: workstreamRow.progressStrategy,
      progressWeight: 2.5,
    })
    expect(await prisma.workstream.count({ where: { projectId: projectRow.id } })).toBe(1)
    expect((await prisma.project.findUnique({ where: { id: projectRow.id } })).name).toBe(projectRow.name)

    const items = await prisma.workItem.findMany({ where: { workstreamId: workstreamRow.id }, orderBy: { createdAt: 'asc' } })
    expect(items).toHaveLength(3)
    const bound = items.find((item) => item.title === 'ยืนยันยอดกับสาขา')
    expect(bound.subtype).toBe('ISSUE')
    expect(JSON.parse(bound.metadataJson).isStandalone).toBe(false)
  })

  it('a task bound to a Project with no workstream yet adds a general workstream through the same envelope', async () => {
    const bare = await prisma.project.create({
      data: { code: 'PRJ-TASKBOX-BARE', name: 'Bare project', businessId: business.id, workspaceId: workspace.id, status: 'ACTIVE' },
    })
    const plan = buildTaskEnvelope({ business, project: bare, task: task({ title: 'งานแรกของโปรเจกต์' }), suffix: 'T4' })
    const dry = await dryRunPlan(plan, { workspaceId: workspace.id, viewer })
    expect(dry.valid).toBe(true)
    expect(kinds(dry.preview.inserts)).toEqual(['item', 'workstream'])
    expect(kinds(dry.preview.updates)).toEqual(['project'])
    const result = await commitPlan(plan, { workspaceId: workspace.id, viewer })
    expect(result.committed).toBe(true)
    expect(result.projectId).toBe(bare.id)
    const workstreams = await prisma.workstream.findMany({ where: { projectId: bare.id } })
    expect(workstreams).toHaveLength(1)
    expect(workstreams[0].code).toBe('WST-PRJ-TASKBOX-BARE-GENERAL')
  })

  it('a second Business gets its own inbox codes, so its first standalone task never conflicts', async () => {
    const plan = buildTaskEnvelope({ business: otherBusiness, task: task({ title: 'งานของอีกธุรกิจ' }), suffix: 'T5' })
    expect(plan.project.code).not.toBe(inboxProjectFor(business).code)
    const dry = await dryRunPlan(plan, { workspaceId: otherWorkspace.id, viewer })
    expect(dry.valid).toBe(true)
    expect(dry.preview.conflicts).toEqual([])
    expect(kinds(dry.preview.inserts)).toEqual(['item', 'project', 'workstream'])
  })

  it('the inbox envelope aimed at another Business\'s Space is refused as a conflict, never written', async () => {
    // The Business's inbox Project already exists in WS-TASKBOX; the same
    // codes sent to a different Space must surface in the preview, not land.
    const plan = buildTaskEnvelope({ business, task: task({ title: 'ผิด Space' }), suffix: 'T6' })
    const dry = await dryRunPlan(plan, { workspaceId: otherWorkspace.id, viewer })
    expect(dry.valid).toBe(false)
    expect(dry.preview.conflicts.map((c) => c.kind)).toContain('project')
    const result = await commitPlan(plan, { workspaceId: otherWorkspace.id, viewer })
    expect(result.committed).toBe(false)
  })
})
