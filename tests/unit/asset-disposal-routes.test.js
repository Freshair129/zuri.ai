// @req FR-133, FR-135 — Decommissioning & Disposal routes unit tests (AM-RQ-070..AM-RQ-073).
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-disposal-routes.test.js
import { describe, expect, it, vi } from 'vitest'
import { GET as getDisposalRoute, POST as postDisposalRoute } from '@/app/api/assets/register/[id]/dispose/route'

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: vi.fn().mockResolvedValue({
    personId: 'p-user',
    ownedBusinessIds: ['biz-1'],
  }),
}))

vi.mock('@/modules/asset-management/application/asset-request-scope', () => ({
  resolveAssetRequestScope: vi.fn().mockImplementation((request, businessId) => {
    return Promise.resolve({
      viewer: { personId: 'p-user' },
      business: { id: businessId || 'biz-1', tenantId: 'tenant-1', name: 'Biz Alpha' },
    })
  }),
}))

vi.mock('@/modules/asset-management/application/asset-disposal-service', () => ({
  listAssetDisposalLogs: vi.fn().mockResolvedValue([
    {
      id: 'disp-1',
      registeredAssetId: 'ast-1',
      action: 'ASSET_DISPOSED',
      method: 'SCRAP',
      reason: 'Obsolete equipment',
    },
  ]),
  finalizeAssetDisposal: vi.fn().mockResolvedValue({
    registeredAssetId: 'ast-1',
    method: 'SCRAP',
    reason: 'Obsolete equipment',
  }),
}))

describe('Asset Disposal API Routes', () => {
  describe('GET /api/assets/register/[id]/dispose', () => {
    it('returns 200 with disposal logs', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/dispose?businessId=biz-1')
      const response = await getDisposalRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.items).toHaveLength(1)
      expect(data.items[0].method).toBe('SCRAP')
    })
  })

  describe('POST /api/assets/register/[id]/dispose', () => {
    it('finalizes disposal and returns result', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/dispose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz-1',
          method: 'SCRAP',
          reason: 'Obsolete equipment',
        }),
      })

      const response = await postDisposalRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.method).toBe('SCRAP')
      expect(data.reason).toBe('Obsolete equipment')
    })
  })
})
