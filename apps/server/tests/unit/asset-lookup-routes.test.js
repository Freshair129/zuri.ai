// @req FR-133, FR-135 — QR lookup and physical verification routes unit tests.
// @spec SDD-078, SDD-080, SEC-023, ADR-055
// @tested tests/unit/asset-lookup-routes.test.js
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET as lookupRoute } from '@/app/api/assets/lookup/route'
import { POST as verifyRoute } from '@/app/api/assets/register/[id]/verify/route'

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: vi.fn().mockResolvedValue({
    personId: 'p-auditor',
    ownedBusinessIds: ['biz-1'],
  }),
}))

vi.mock('@/modules/asset-management/application/asset-request-scope', () => ({
  resolveAssetRequestScope: vi.fn().mockImplementation((request, businessId) => {
    return Promise.resolve({
      viewer: { personId: 'p-auditor' },
      business: { id: businessId || 'biz-1', tenantId: 'tenant-1', name: 'Biz Alpha' },
    })
  }),
}))

vi.mock('@/modules/asset-management/application/asset-lookup-service', () => ({
  lookupAssetByQrOrCode: vi.fn().mockImplementation(({ businessId, codeOrToken }) => {
    if (codeOrToken === 'AST-404') {
      const err = new Error('Asset not found for identifier: AST-404')
      err.status = 404
      throw err
    }
    return Promise.resolve({
      id: 'ast-1',
      assetCode: 'AST-2026-00001',
      name: 'MacBook Pro',
      businessId,
    })
  }),
  verifyAssetObservation: vi.fn().mockResolvedValue({
    registeredAssetId: 'ast-1',
    assetCode: 'AST-2026-00001',
    scannedByPersonId: 'p-auditor',
    locationMatches: true,
    condition: 'GOOD',
  }),
}))

describe('Asset Lookup & Verification API Routes', () => {
  describe('GET /api/assets/lookup', () => {
    it('returns 400 when code, token, or id parameter is missing', async () => {
      const request = new Request('http://localhost:3000/api/assets/lookup?businessId=biz-1')
      const response = await lookupRoute(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Asset code, QR payload, or ID is required')
    })

    it('returns 200 with asset data when code is valid', async () => {
      const request = new Request('http://localhost:3000/api/assets/lookup?code=AST-2026-00001&businessId=biz-1')
      const response = await lookupRoute(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.assetCode).toBe('AST-2026-00001')
      expect(data.name).toBe('MacBook Pro')
    })

    it('returns 404 when asset does not exist', async () => {
      const request = new Request('http://localhost:3000/api/assets/lookup?code=AST-404&businessId=biz-1')
      const response = await lookupRoute(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toContain('Asset not found')
    })
  })

  describe('POST /api/assets/register/[id]/verify', () => {
    it('returns 200 and audit observation result on verification', async () => {
      const request = new Request('http://localhost:3000/api/assets/register/ast-1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          observedLocationName: 'HQ Floor 3',
          condition: 'GOOD',
          notes: 'Regular check',
        }),
      })

      const response = await verifyRoute(request, { params: Promise.resolve({ id: 'ast-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toMatchObject({
        registeredAssetId: 'ast-1',
        assetCode: 'AST-2026-00001',
        scannedByPersonId: 'p-auditor',
        locationMatches: true,
      })
    })
  })
})
