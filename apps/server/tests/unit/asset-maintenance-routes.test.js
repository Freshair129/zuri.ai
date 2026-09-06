// @req FR-133, FR-135, FR-136 — Asset maintenance and depreciation routes unit tests.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-maintenance-routes.test.js
import { describe, expect, it, vi } from 'vitest'
import { GET as getDepreciationRoute } from '@/app/api/assets/register/[id]/depreciation/route'
import { GET as getMaintenanceRoute, POST as postMaintenanceRoute } from '@/app/api/assets/register/[id]/maintenance/route'

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

vi.mock('@/modules/asset-management/application/asset-depreciation-service', () => ({
  getOrCreateAssetDepreciationCandidate: vi.fn().mockResolvedValue({
    id: 'cand-1',
    registeredAssetId: 'ast-1',
    method: 'STRAIGHT_LINE',
    usefulLifeMonths: 36,
    acquisitionAmount: '36000.00',
    residualValue: '0.00',
    currency: 'THB',
    schedule: [{ period: 1, depreciationAmount: '1000.00', bookValue: '35000.00' }],
    accountingAuthority: false,
  }),
}))

vi.mock('@/modules/asset-management/application/asset-maintenance-service', () => ({
  listAssetMaintenanceLogs: vi.fn().mockResolvedValue([
    {
      id: 'm-1',
      registeredAssetId: 'ast-1',
      action: 'ASSET_MAINTENANCE_LOGGED',
      title: 'Fan replacement',
      priority: 'NORMAL',
    },
  ]),
  createMaintenanceLog: vi.fn().mockResolvedValue({
    registeredAssetId: 'ast-1',
    title: 'Fan replacement',
    status: 'OPEN',
  }),
  completeMaintenanceLog: vi.fn().mockResolvedValue({
    registeredAssetId: 'ast-1',
    resolutionNotes: 'Fan replaced successfully',
    newCondition: 'GOOD',
    revertedStatus: 'ACTIVE',
  }),
}))

describe('Asset Maintenance & Depreciation API Routes', () => {
  describe('GET /api/assets/register/[id]/depreciation', () => {
    it('returns 200 with depreciation schedule preview', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/depreciation?businessId=biz-1')
      const response = await getDepreciationRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.method).toBe('STRAIGHT_LINE')
      expect(data.schedule).toHaveLength(1)
      expect(data.accountingAuthority).toBe(false)
    })
  })

  describe('GET /api/assets/register/[id]/maintenance', () => {
    it('returns 200 with maintenance history logs', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/maintenance?businessId=biz-1')
      const response = await getMaintenanceRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.items).toHaveLength(1)
      expect(data.items[0].title).toBe('Fan replacement')
    })
  })

  describe('POST /api/assets/register/[id]/maintenance', () => {
    it('creates maintenance ticket with action CREATE', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz-1',
          action: 'CREATE',
          title: 'Fan replacement',
        }),
      })

      const response = await postMaintenanceRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.title).toBe('Fan replacement')
      expect(data.status).toBe('OPEN')
    })

    it('completes maintenance ticket with action COMPLETE', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz-1',
          action: 'COMPLETE',
          resolutionNotes: 'Fan replaced successfully',
          newCondition: 'GOOD',
        }),
      })

      const response = await postMaintenanceRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.resolutionNotes).toBe('Fan replaced successfully')
      expect(data.revertedStatus).toBe('ACTIVE')
    })
  })
})
