import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import prisma from '@/lib/db'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { getSotPlanStatus } from '@/modules/integration/application/sot-plan-service'
import { submitSotDecisions } from '@/modules/integration/application/sot-decision-service'

// @req FR-099 — the plan endpoint composes run evidence and pending decisions
// into derived phase status plus the FR-101 graph, scoped to the viewer.
// @tested tests/unit/sot-plan-service.test.js

const t = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
let tenantId
let businessId

function pipelineRunRow(definitionId, status, over = {}) {
  return {
    id: randomUUID(),
    executionRunId: `RUN-${t}-${Math.random().toString(36).slice(2, 8)}`,
    dataPipelineDefinitionId: definitionId,
    executionContractId: 'EXC-DATA-MIGRATION-V1',
    tenantId,
    businessId,
    status,
    correlationId: `corr-${t}`,
    idempotencyKey: randomUUID(),
    requestHash: 'a'.repeat(64),
    ...over,
  }
}

beforeAll(async () => {
  tenantId = randomUUID()
  await prisma.tenant.create({
    data: {
      id: tenantId, code: `TEN-SPS-${t}`, name: 'SoT Plan Tenant',
      portfolio: { create: { id: randomUUID(), code: `PF-SPS-${t}`, name: 'PF' } },
    },
  })
  const business = await prisma.business.create({
    data: { id: randomUUID(), tenantId, code: `BUS-SPS-${t}`, name: 'SmartGift' },
  })
  businessId = business.id
})

describe('FR-099 sot plan service', () => {
  it('refuses a viewer who cannot see the business', async () => {
    const stranger = makeViewer({ role: 'MEMBER', visibleBusinessIds: [], ownedBusinessIds: [] })
    await expect(getSotPlanStatus({ businessId }, { viewer: stranger })).rejects.toThrow(/scope/)
  })

  it('derives per-phase status from newest runs and pending decisions, and returns the graph', async () => {
    // P0's definition: an older FAILED run then a newer SUCCEEDED one — newest wins.
    await prisma.pipelineRun.create({ data: pipelineRunRow('DPL-SOT-P0-INVENTORY-V1', 'FAILED', { createdAt: new Date(Date.now() - 60000) }) })
    await prisma.pipelineRun.create({ data: pipelineRunRow('DPL-SOT-P0-INVENTORY-V1', 'SUCCEEDED') })
    // P2's definition currently running.
    await prisma.pipelineRun.create({ data: pipelineRunRow('DPL-SOT-P2-EXTRACT-V1', 'RUNNING') })
    // A pending human decision parks P3 as blocked.
    await submitSotDecisions({
      tenantId,
      submittedBy: 'sot-data-plane',
      items: [{ businessId, decisionType: 'PRICE_ROW', subjectRef: `PLAN-${t}-1`, phaseId: 'P3', payload: { x: 1 } }],
    }, { viewer: makeOperatorViewer() })

    const owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [businessId], ownedBusinessIds: [businessId] })
    const out = await getSotPlanStatus({ businessId }, { viewer: owner })

    const byId = new Map(out.phases.map((p) => [p.phaseId, p]))
    expect(byId.get('P0').status).toBe('done')
    expect(byId.get('P2').status).toBe('running')
    expect(byId.get('P3').status).toBe('blocked')
    expect(byId.get('P3').pendingDecisions).toBeGreaterThanOrEqual(1)
    expect(byId.get('P10').status).toBe('planned')

    expect(out.graph.nodes.some((n) => n.id === 'src-drive')).toBe(true)
    expect(out.graph.nodes.find((n) => n.id === 'P3').status).toBe('blocked')
    expect(byId.get('P0').runs[0].status).toBe('SUCCEEDED')
  })
})
