// @req FR-133, FR-135 — Asset lifecycle routes unit tests.
// @spec SDD-078, SDD-080, SEC-023, SEC-024, ADR-055
// @tested tests/unit/asset-lifecycle-routes.test.js
import { describe, expect, it, vi } from 'vitest'
import { POST as responsibilityRoute } from '@/app/api/assets/register/[id]/responsibility/route'
import { POST as relocateRoute } from '@/app/api/assets/register/[id]/relocate/route'
import { POST as allocateRoute } from '@/app/api/assets/register/[id]/allocate/route'
import { POST as returnRoute } from '@/app/api/assets/register/[id]/return/route'

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: vi.fn().mockResolvedValue({
    principal: { id: 'p-1' },
    ownedBusinessIds: ['biz-1'],
  }),
}))

vi.mock('@/modules/asset-management/application/asset-request-scope', () => ({
  resolveAssetRequestScope: vi.fn().mockImplementation((request, businessId) => {
    if (businessId === 'biz-forbidden') {
      const error = new Error('Business not found')
      error.status = 404
      throw error
    }
    return {
      viewer: { principal: { id: 'p-1' } },
      business: { id: businessId, tenantId: 'tenant-1' },
    }
  }),
}))

vi.mock('@/modules/asset-management/application/asset-lifecycle-service', () => ({
  transferAssetResponsibility: vi.fn().mockResolvedValue({
    id: 'resp-1',
    role: 'CUSTODIAN',
    personId: 'p-2',
  }),
  relocateAsset: vi.fn().mockResolvedValue({
    id: 'loc-1',
    locationCode: 'ROOM-101',
    locationName: 'Warehouse A',
  }),
  allocateAssetToProject: vi.fn().mockResolvedValue({
    id: 'alloc-1',
    projectId: 'proj-1',
    status: 'ACTIVE',
  }),
  returnAssetFromProject: vi.fn().mockResolvedValue({
    id: 'alloc-1',
    status: 'RETURNED',
  }),
}))

describe('Asset Lifecycle API Routes', () => {
  describe('POST /api/assets/register/[id]/responsibility', () => {
    it('returns 400 when personId or businessId is missing', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/responsibility', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: 'biz-1' }),
      })
      const res = await responsibilityRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      expect(res.status).toBe(400)
    })

    it('transfers responsibility and returns 201', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/responsibility', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: 'biz-1', personId: 'p-2', role: 'CUSTODIAN' }),
      })
      const res = await responsibilityRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.responsibility.id).toBe('resp-1')
    })
  })

  describe('POST /api/assets/register/[id]/relocate', () => {
    it('relocates asset and returns 201', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/relocate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: 'biz-1', locationCode: 'ROOM-101', locationName: 'Warehouse A' }),
      })
      const res = await relocateRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.location.id).toBe('loc-1')
    })
  })

  describe('POST /api/assets/register/[id]/allocate', () => {
    it('allocates asset to project and returns 201', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/allocate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: 'biz-1', projectId: 'proj-1' }),
      })
      const res = await allocateRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.allocation.id).toBe('alloc-1')
    })
  })

  describe('POST /api/assets/register/[id]/return', () => {
    it('returns asset from project and returns 200', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/return', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: 'biz-1', returnCondition: 'GOOD' }),
      })
      const res = await returnRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.allocation.id).toBe('alloc-1')
    })
  })
})
