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

    it('returns every asset across cursor pages without duplicating or omitting the page boundary', async () => {
      const allAssets = ['ast-1', 'ast-2', 'ast-3', 'ast-4'].map((id) => ({
        id,
        assetCode: id.toUpperCase(),
        name: id,
        status: 'ACTIVE',
        condition: 'GOOD',
        responsibilities: [],
        locations: [],
        projectAllocations: [],
        lot: null,
        _count: { evidence: 0, procurementRefs: 0, depreciationCandidates: 0 },
      }))

      const findMany = vi.fn(async (args) => {
        const cursorIndex = args.cursor
          ? allAssets.findIndex((asset) => asset.id === args.cursor.id)
          : -1
        const startIndex = cursorIndex >= 0 ? cursorIndex + (args.skip || 0) : 0
        return allAssets.slice(startIndex, startIndex + args.take)
      })
      const mockDb = {
        registeredAsset: {
          findMany,
          count: vi.fn().mockResolvedValue(allAssets.length),
        },
      }

      const seenIds = []
      const queryCursors = []
      let cursor = null
      do {
        const page = await listRegisteredAssets({ businessId: 'biz-1', db: mockDb, limit: 2, cursor })
        seenIds.push(...page.items.map((asset) => asset.id))
        queryCursors.push(findMany.mock.calls.at(-1)[0])
        cursor = page.nextCursor
      } while (cursor)

      expect(seenIds).toEqual(['ast-1', 'ast-2', 'ast-3', 'ast-4'])
      expect(new Set(seenIds).size).toBe(seenIds.length)
      expect(queryCursors).toHaveLength(2)
      expect(queryCursors.every((query) => query.where.businessId === 'biz-1')).toBe(true)
      expect(queryCursors.every((query) => query.where.deletedAt === null)).toBe(true)
      expect(queryCursors[1].cursor).toEqual({ id: 'ast-2' })
      expect(queryCursors[1].skip).toBe(1)
    })

    it('does not emit a cursor when the result count is exactly the requested limit', async () => {
      const mockAssets = ['ast-1', 'ast-2'].map((id) => ({
        id,
        assetCode: id.toUpperCase(),
        name: id,
        status: 'ACTIVE',
        condition: 'GOOD',
        responsibilities: [],
        locations: [],
        projectAllocations: [],
        lot: null,
        _count: { evidence: 0, procurementRefs: 0, depreciationCandidates: 0 },
      }))
      const mockDb = {
        registeredAsset: {
          findMany: vi.fn().mockResolvedValue(mockAssets),
          count: vi.fn().mockResolvedValue(mockAssets.length),
        },
      }

      const result = await listRegisteredAssets({ businessId: 'biz-1', db: mockDb, limit: 2 })

      expect(result.items.map((asset) => asset.id)).toEqual(['ast-1', 'ast-2'])
      expect(result.nextCursor).toBeNull()
      expect(mockDb.registeredAsset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 })
      )
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
        membership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
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

    it('rejects initial responsibility people without an active direct membership in the intake Business', async () => {
      const intake = {
        id: 'intake-1',
        tenantId: 'tenant-1',
        businessId: 'biz-1',
        status: 'READY_FOR_REGISTRATION',
        normalizedEnvelopeJson: JSON.stringify({
          item: { name: 'ThinkPad X1', categoryCode: 'IT_EQUIPMENT' },
          responsibility: { accountablePersonId: 'p-1', custodianPersonId: 'p-foreign' },
        }),
        evidence: [],
        procurementRefs: [],
      }

      const mockTx = {
        membership: {
          findFirst: vi.fn(({ where }) => Promise.resolve(
            where.personId === 'p-1' ? { id: 'membership-1' } : null
          )),
        },
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }) => ({ id: 'ast-created-1', ...data })),
        },
        assetEvidence: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        assetProcurementRef: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        assetLocationHistory: { create: vi.fn() },
        assetResponsibility: { create: vi.fn() },
        assetIntake: { update: vi.fn() },
        auditEvent: { create: vi.fn() },
      }
      const mockDb = {
        assetIntake: { findFirst: vi.fn().mockResolvedValue(intake) },
        $transaction: vi.fn().mockImplementation((callback) => callback(mockTx)),
      }

      await expect(registerAssetFromIntake({
        businessId: 'biz-1',
        intakeId: 'intake-1',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-admin' } },
        db: mockDb,
      })).rejects.toMatchObject({ status: 404, message: 'Person not found in current business' })

      expect(mockTx.membership.findFirst).toHaveBeenCalledTimes(2)
      expect(mockTx.registeredAsset.create).not.toHaveBeenCalled()
      expect(mockTx.assetResponsibility.create).not.toHaveBeenCalled()
      expect(mockTx.assetIntake.update).not.toHaveBeenCalled()
      expect(mockTx.auditEvent.create).not.toHaveBeenCalled()
    })
  })
})
