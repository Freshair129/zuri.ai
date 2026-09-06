import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../../factories/viewer'

// @req FR-162 — Operations handlers resolve the trusted viewer and delegate
// all scope, source and mutation checks to the application service.
// @spec SDD-089, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-operations-route.test.js

const {
  createMarketingOperationsIntake,
  getMarketingOperationsHandoff,
  getMarketingOperationsIntake,
  listMarketingOperations,
  updateMarketingOperationsIntake,
  resolveRequestViewer,
  prismaClient,
} = vi.hoisted(() => ({
  createMarketingOperationsIntake: vi.fn(),
  getMarketingOperationsHandoff: vi.fn(),
  getMarketingOperationsIntake: vi.fn(),
  listMarketingOperations: vi.fn(),
  updateMarketingOperationsIntake: vi.fn(),
  resolveRequestViewer: vi.fn(),
  prismaClient: { marker: 'operations-prisma' },
}))

vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/marketing/application/marketing-operations-service', () => ({
  createMarketingOperationsIntake,
  getMarketingOperationsHandoff,
  getMarketingOperationsIntake,
  listMarketingOperations,
  updateMarketingOperationsIntake,
}))

const { GET: listRoute, POST: createRoute } = await import('@/app/api/growth/operations/route')
const { GET: intakeRoute, PATCH: intakePatchRoute } = await import('@/app/api/growth/operations/intake/[intakeId]/route')
const { GET: handoffRoute } = await import('@/app/api/growth/operations/handoffs/[handoffId]/route')

const viewer = makeViewer({
  principal: { id: 'operations-route-owner' },
  visibleBusinessIds: ['b-1'],
  ownedBusinessIds: ['b-1'],
  visibleDomains: ['growth'],
})

function request(url, { method = 'GET', body } = {}) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
  listMarketingOperations.mockResolvedValue({ readModel: 'MARKETING_OPERATIONS', businessId: 'b-1', sections: {} })
  createMarketingOperationsIntake.mockResolvedValue({ intake: { id: 'intake-1', businessId: 'b-1' } })
  getMarketingOperationsIntake.mockResolvedValue({ intake: { id: 'intake-1', businessId: 'b-1' } })
  updateMarketingOperationsIntake.mockResolvedValue({ intake: { id: 'intake-1', businessId: 'b-1' } })
  getMarketingOperationsHandoff.mockResolvedValue({ handoff: { id: 'handoff-1' }, businessId: 'b-1' })
})

describe('Marketing Operations API routes', () => {
  it('passes the resolved viewer and Business query to the aggregate reader', async () => {
    const response = await listRoute(request('http://local/api/growth/operations?businessId=b-1'))
    expect(listMarketingOperations).toHaveBeenCalledWith({ viewer, businessId: 'b-1' })
    expect(response.status).toBe(200)
  })

  it('passes the create body to the Marketing owner service', async () => {
    const body = { businessId: 'b-1', title: 'Request', capability: 'SEO', objective: 'Objective' }
    const response = await createRoute(request('http://local/api/growth/operations', { method: 'POST', body }))
    expect(createMarketingOperationsIntake).toHaveBeenCalledWith(body, { viewer }, { db: prismaClient })
    expect(response.status).toBe(200)
  })

  it('revalidates intake and handoff identities through detail services', async () => {
    await intakeRoute(request('http://local/api/growth/operations/intake/intake-1?businessId=b-1'), { params: { intakeId: 'intake-1' } })
    expect(getMarketingOperationsIntake).toHaveBeenCalledWith('intake-1', { businessId: 'b-1', viewer }, { db: prismaClient })
    const action = { action: 'archive', businessId: 'b-1', expectedVersion: 1 }
    await intakePatchRoute(request('http://local/api/growth/operations/intake/intake-1', { method: 'PATCH', body: action }), { params: { intakeId: 'intake-1' } })
    expect(updateMarketingOperationsIntake).toHaveBeenCalledWith('intake-1', action, { viewer }, { db: prismaClient })
    await handoffRoute(request('http://local/api/growth/operations/handoffs/handoff-1?businessId=b-1'), { params: { handoffId: 'handoff-1' } })
    expect(getMarketingOperationsHandoff).toHaveBeenCalledWith('handoff-1', { businessId: 'b-1', viewer }, { db: prismaClient })
  })

  it('does not pass unknown JSON keys through the route', async () => {
    const response = await intakePatchRoute(request('http://local/api/growth/operations/intake/intake-1', { method: 'PATCH', body: { action: 'archive', businessId: 'b-1', expectedVersion: 1, actorId: 'forged' } }), { params: { intakeId: 'intake-1' } })
    expect(response.status).toBe(400)
    expect(updateMarketingOperationsIntake).not.toHaveBeenCalled()
  })
})
