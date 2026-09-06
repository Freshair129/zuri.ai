// @req FR-133, FR-135 — Asset register route contract and scope enforcement.
// @spec SDD-078, SDD-080, SEC-023, SEC-024, ADR-055
// @tested tests/unit/asset-register-routes.test.js
import { describe, expect, it, vi } from 'vitest'
import { GET as listRoute, POST as registerRoute } from '@/app/api/assets/register/route'
import { GET as detailRoute } from '@/app/api/assets/register/[id]/route'

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

vi.mock('@/modules/asset-management/application/asset-register-service', () => ({
  listRegisteredAssets: vi.fn().mockResolvedValue({
    items: [{ id: 'ast-1', assetCode: 'AST-2026-00001', name: 'MacBook' }],
    stats: { total: 1, active: 1, inUse: 0, maintenance: 0 },
  }),
  getRegisteredAssetById: vi.fn().mockImplementation(({ id }) => {
    if (id === 'ast-missing') {
      const error = new Error('Registered asset not found')
      error.status = 404
      throw error
    }
    return { id, assetCode: 'AST-2026-00001', name: 'MacBook' }
  }),
  registerAssetFromIntake: vi.fn().mockResolvedValue({
    id: 'ast-created-1',
    assetCode: 'AST-2026-00001',
    name: 'ThinkPad',
  }),
}))

describe('Asset Register API Routes', () => {
  describe('GET /api/assets/register', () => {
    it('returns 400 when businessId is missing', async () => {
      const request = new Request('http://localhost:3000/api/assets/register')
      const res = await listRoute(request)
      expect(res.status).toBe(400)
    })

    it('returns registered asset list when authorized', async () => {
      const request = new Request('http://localhost:3000/api/assets/register?businessId=biz-1')
      const res = await listRoute(request)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.items).toHaveLength(1)
      expect(data.items[0].assetCode).toBe('AST-2026-00001')
    })

    it('returns 404 when viewer has no scope for the Business', async () => {
      const request = new Request('http://localhost:3000/api/assets/register?businessId=biz-forbidden')
      const res = await listRoute(request)
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/assets/register', () => {
    it('returns 400 when required payload fields are missing', async () => {
      const request = new Request('http://localhost:3000/api/assets/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: 'biz-1' }),
      })
      const res = await registerRoute(request)
      expect(res.status).toBe(400)
    })

    it('registers asset and returns 201 on valid intake', async () => {
      const request = new Request('http://localhost:3000/api/assets/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: 'biz-1', intakeId: 'intake-1' }),
      })
      const res = await registerRoute(request)
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.asset.assetCode).toBe('AST-2026-00001')
    })
  })

  describe('GET /api/assets/register/[id]', () => {
    it('returns 400 when businessId or id is missing', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1')
      const res = await detailRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      expect(res.status).toBe(400)
    })

    it('returns asset detail with 200', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1?businessId=biz-1')
      const res = await detailRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.asset.id).toBe('ast-1')
    })

    it('returns 404 when asset does not exist', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-missing?businessId=biz-1')
      const res = await detailRoute(request, { params: Promise.resolve({ id: 'ast-missing' }) })
      expect(res.status).toBe(404)
    })
  })
})
