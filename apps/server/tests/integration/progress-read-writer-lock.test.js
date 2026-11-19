// @req FR-011, FR-084 — a progress read recomputes under a non-writer
//   transaction and refreshes the advisory progressCache in a separate short
//   writer transaction, only when it is stale, so a page view never holds the
//   global graph writer lock for the length of its load.
// @spec ADR-035, SDD-046
// @tested tests/integration/progress-read-writer-lock.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { persistImportViewer } from '../helpers/persist-import-viewer'
import { makeViewer } from '../factories/viewer'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createItem } from '@/modules/project-manager/application/work-service'
import { computeProjectProgress, computeWorkstreamProgress } from '@/modules/project-manager/application/progress-service'
import { withPipelineTransaction } from '@/modules/project-manager/application/pipeline-transaction'

let project, ws, viewer

describe('progress reads and the graph writer lock', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'PRL Group', code: 'PF-PRL' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'PRL Tenant', code: 'TNT-PRL' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'PRL Business', code: 'BUS-PRL' })
    const workspace = await createWorkspace({ name: 'PRL WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-PRL' })
    viewer = await persistImportViewer(makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] }))
    project = await createProject({ workspaceId: workspace.id, name: 'PRL Project', code: 'PRJ-PRL' }, { viewer })
    ws = await createWorkstream({ projectId: project.id, name: 'PRL stream', executionMode: 'SOFTWARE_SPRINT', code: 'WST-PRL' }, { viewer })
    await createItem({ workstreamId: ws.id, subtype: 'TASK', title: 'Done task', code: 'WI-PRL-1', status: 'DONE' }, { viewer })
  })

  it('refreshes a stale cache after the read, for workstream and project reads', async () => {
    await prisma.workstream.update({ where: { id: ws.id }, data: { progressCache: -1 } })
    const stream = await computeWorkstreamProgress(ws.id)
    expect((await prisma.workstream.findUnique({ where: { id: ws.id } })).progressCache).toBe(stream.percent)

    await prisma.workstream.update({ where: { id: ws.id }, data: { progressCache: -1 } })
    const rollup = await computeProjectProgress(project.id)
    expect(rollup.percent).toBe(stream.percent)
    expect((await prisma.workstream.findUnique({ where: { id: ws.id } })).progressCache).toBe(stream.percent)
  })

  it('does not enter a writer transaction when the cache is already current', async () => {
    await computeWorkstreamProgress(ws.id)
    const original = prisma.$transaction.bind(prisma)
    let transactions = 0
    prisma.$transaction = (...args) => { transactions += 1; return original(...args) }
    try {
      await computeWorkstreamProgress(ws.id)
      await computeProjectProgress(project.id)
    } finally {
      prisma.$transaction = original
    }
    // One read transaction per call; no second (writer) transaction.
    expect(transactions).toBe(2)
  })

  it('computes inside a read-only pipeline transaction without writing', async () => {
    await prisma.workstream.update({ where: { id: ws.id }, data: { progressCache: -1 } })
    const result = await withPipelineTransaction(prisma, tx => computeWorkstreamProgress(ws.id, { db: tx }), { write: false })
    expect(result.workstreamId).toBe(ws.id)
    expect((await prisma.workstream.findUnique({ where: { id: ws.id } })).progressCache).toBe(-1)
  })
})
