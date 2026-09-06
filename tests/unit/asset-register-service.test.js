// @req FR-133, FR-135 — Asset register service contract and sequential code generation.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-register-service.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  generateNextAssetCode,
  listRegisteredAssets,
  getRegisteredAssetById,
  registerAssetFromIntake,
} from '@/modules/asset-management/application/asset-register-service'

describe('Asset Register Service', () => {
  describe('generateNextAssetCode', () => {
    it('generates AST-YYYY-00001 when no assets exist', async () => {
      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }
      const code = await generateNextAssetCode('biz-1', { db: mockDb, year: 2026 })
      expect(code).toBe('AST-2026-00001')
    })

    it('increments sequence based on highest existing asset code', async () => {
      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({ assetCode: 'AST-2026-00042' }),
        },
      }
      const code = await generateNextAssetCode('biz-1', { db: mockDb, year: 2026 })
      expect(code).toBe('AST-2026-00043')
    })
  })

  describe('listRegisteredAssets', () => {
    it('throws when businessId is missing', async () => {
      await expect(listRegisteredAssets({})).rejects.toThrow('Business ID is required')
    })

    it('queries registered assets with active responsibilities and primary location', async () => {
      const mockAssets = [
        {
          id: 'ast-1',
          assetCode: 'AST-2026-00001',
          name: 'Dell XPS 15',
          categoryCode: 'IT_EQUIPMENT',
          status: 'ACTIVE',
          condition: 'GOOD',
          responsibilities: [
            { role: 'ACCOUNTABLE', person: { id: 'p-1', displayName: 'Alice' } },
          ],
          locations: [
            { isPrimary: true, locationCode: 'L-1', locationName: 'HQ Room 101', branch: { id: 'b-1', name: 'Main' } },
          ],
          projectAllocations: [],
          lot: null,
          _count: { evidence: 2, procurementRefs: 1, depreciationCandidates: 0 },
        },
      ]

      const mockDb = {
        registeredAsset: {
          findMany: vi.fn().mockResolvedValue(mockAssets),
          count: vi.fn().mockResolvedValue(1),
        },
      }

      const result = await listRegisteredAssets({ businessId: 'biz-1', db: mockDb })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].assetCode).toBe('AST-2026-00001')
      expect(result.items[0].accountablePerson?.displayName).toBe('Alice')
      expect(result.items[0].currentLocation?.locationName).toBe('HQ Room 101')
      expect(result.stats.total).toBe(1)
    })
  })

  describe('getRegisteredAssetById', () => {
    it('fetches full asset detail with evidence and temporal history', async () => {
      const mockAsset = {
        id: 'ast-1',
        assetCode: 'AST-2026-00001',
        name: 'MacBook Pro',
        evidence: [{ id: 'ev-1', role: 'ASSET_PHOTO' }],
        responsibilities: [{ id: 'resp-1', role: 'ACCOUNTABLE', effectiveFrom: new Date() }],
        locations: [{ id: 'loc-1', locationCode: 'HQ-1', effectiveFrom: new Date() }],
      }

      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue(mockAsset),
        },
      }

      const asset = await getRegisteredAssetById({ businessId: 'biz-1', id: 'ast-1', db: mockDb })
      expect(asset.assetCode).toBe('AST-2026-00001')
      expect(asset.evidence).toHaveLength(1)
    })

    it('throws 404 when asset does not exist', async () => {
      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }

      await expect(getRegisteredAssetById({ businessId: 'biz-1', id: 'ast-999', db: mockDb })).rejects.toMatchObject({
        status: 404,
      })
    })
  })

  describe('registerAssetFromIntake', () => {
    it('rejects an intake that is not READY_FOR_REGISTRATION', async () => {
      const mockDb = {
        assetIntake: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'intake-1',
            status: 'NEEDS_REVIEW',
            evidence: [],
            procurementRefs: [],
          }),
        },
      }

      const viewer = { ownedBusinessIds: ['biz-1'], principal: { id: 'user-admin' } }
      await expect(
        registerAssetFromIntake({
          businessId: 'biz-1',
          intakeId: 'intake-1',
          viewer,
          db: mockDb,
        })
      ).rejects.toThrow('Asset intake is not ready for registration')
    })

    it('promotes READY_FOR_REGISTRATION intake into RegisteredAsset transactionally', async () => {
      const intake = {
        id: 'intake-1',
        tenantId: 'tenant-1',
        businessId: 'biz-1',
        status: 'READY_FOR_REGISTRATION',
        normalizedEnvelopeJson: JSON.stringify({
          item: { name: 'ThinkPad X1', categoryCode: 'IT_EQUIPMENT', brand: 'Lenovo', model: 'Gen 11' },
          location: { locationCode: 'BKK-01', locationName: 'Bangkok Office' },
          responsibility: { accountablePersonId: 'p-1', custodianPersonId: 'p-2' },
          financial: { acquisitionAmount: '55000.00', currency: 'THB' },
        }),
        evidence: [{ id: 'ev-1' }],
        procurementRefs: [{ id: 'pr-1' }],
      }

      const mockTx = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }) => ({ id: 'ast-created-1', ...data })),
        },
        assetEvidence: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        assetProcurementRef: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        assetLocationHistory: { create: vi.fn().mockResolvedValue({ id: 'loc-1' }) },
        assetResponsibility: { create: vi.fn().mockResolvedValue({ id: 'resp-1' }) },
        assetIntake: { update: vi.fn().mockResolvedValue({ id: 'intake-1', status: 'REGISTERED' }) },
        auditEvent: { create: vi.fn().mockResolvedValue({ id: 'aud-1' }) },
      }

      const mockDb = {
        assetIntake: { findFirst: vi.fn().mockResolvedValue(intake) },
        $transaction: vi.fn().mockImplementation((callback) => callback(mockTx)),
      }

      const viewer = { ownedBusinessIds: ['biz-1'], principal: { id: 'user-admin' } }
      const registered = await registerAssetFromIntake({
        businessId: 'biz-1',
        intakeId: 'intake-1',
        viewer,
        db: mockDb,
      })

      expect(registered.assetCode).toBe('AST-' + new Date().getFullYear() + '-00001')
      expect(registered.name).toBe('ThinkPad X1')
      expect(mockTx.registeredAsset.create).toHaveBeenCalled()
      expect(mockTx.assetIntake.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'intake-1' },
          data: expect.objectContaining({ status: 'REGISTERED' }),
        })
      )
    })
  })
})
