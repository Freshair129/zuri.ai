// @req FR-133, FR-135 — Asset lifecycle service tests for responsibility, location, and project allocation.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-lifecycle-service.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  transferAssetResponsibility,
  relocateAsset,
  allocateAssetToProject,
  returnAssetFromProject,
} from '@/modules/asset-management/application/asset-lifecycle-service'

function makeMockTx(overrides = {}) {
  return {
    registeredAsset: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ast-1',
        tenantId: 'tenant-1',
        businessId: 'biz-1',
        assetCode: 'AST-2026-00001',
        name: 'MacBook Pro 16',
        status: 'ACTIVE',
        condition: 'GOOD',
      }),
      update: vi.fn().mockResolvedValue({
        id: 'ast-1',
        status: 'IN_USE',
      }),
    },
    person: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'p-1',
        name: 'Somchai Prasert',
        email: 'somchai@example.com',
      }),
    },
    branch: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'br-1',
        code: 'HQ',
        name: 'Headquarters',
      }),
    },
    project: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'proj-1',
        title: 'ERP Migration',
      }),
    },
    assetResponsibility: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({
        id: 'resp-1',
        registeredAssetId: 'ast-1',
        role: 'CUSTODIAN',
        personId: 'p-1',
        person: { id: 'p-1', name: 'Somchai Prasert' },
      }),
    },
    assetLocationHistory: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({
        id: 'loc-1',
        registeredAssetId: 'ast-1',
        locationCode: 'ROOM-402',
        locationName: 'Engineering Lab',
        isPrimary: true,
      }),
    },
    assetProjectAllocation: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({
        id: 'alloc-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        status: 'ACTIVE',
      }),
      findFirst: vi.fn().mockResolvedValue({
        id: 'alloc-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        status: 'ACTIVE',
      }),
      update: vi.fn().mockResolvedValue({
        id: 'alloc-1',
        status: 'RETURNED',
      }),
      count: vi.fn().mockResolvedValue(0),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    ...overrides,
  }
}

function makeMockDb(tx) {
  return {
    $transaction: async (fn) => fn(tx),
  }
}

describe('Asset Lifecycle Service', () => {
  describe('transferAssetResponsibility', () => {
    it('throws error when businessId or registeredAssetId is missing', async () => {
      await expect(transferAssetResponsibility({ businessId: '', registeredAssetId: '' })).rejects.toThrow(
        /businessId and registeredAssetId are required/
      )
    })

    it('throws error when personId is missing', async () => {
      await expect(
        transferAssetResponsibility({ businessId: 'biz-1', registeredAssetId: 'ast-1', personId: '' })
      ).rejects.toThrow(/personId is required/)
    })

    it('throws error for invalid responsibility role', async () => {
      await expect(
        transferAssetResponsibility({
          businessId: 'biz-1',
          registeredAssetId: 'ast-1',
          personId: 'p-1',
          role: 'SUPERVISOR',
        })
      ).rejects.toThrow(/Invalid responsibility role/)
    })

    it('transfers custody and closes previous active interval', async () => {
      const tx = makeMockTx()
      const db = makeMockDb(tx)
      const res = await transferAssetResponsibility({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        personId: 'p-1',
        role: 'CUSTODIAN',
        note: 'Handover to new engineer',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db,
      })

      expect(tx.assetResponsibility.updateMany).toHaveBeenCalled()
      expect(tx.assetResponsibility.create).toHaveBeenCalled()
      expect(tx.auditEvent.create).toHaveBeenCalled()
      expect(res.id).toBe('resp-1')
    })
  })

  describe('relocateAsset', () => {
    it('throws error when locationCode or locationName is missing', async () => {
      await expect(
        relocateAsset({ businessId: 'biz-1', registeredAssetId: 'ast-1', locationCode: '', locationName: '' })
      ).rejects.toThrow(/locationCode and locationName are required/)
    })

    it('relocates asset, closes prior primary location and records audit', async () => {
      const tx = makeMockTx()
      const db = makeMockDb(tx)
      const res = await relocateAsset({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        branchId: 'br-1',
        locationCode: 'ROOM-402',
        locationName: 'Engineering Lab',
        isPrimary: true,
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db,
      })

      expect(tx.assetLocationHistory.updateMany).toHaveBeenCalled()
      expect(tx.assetLocationHistory.create).toHaveBeenCalled()
      expect(tx.auditEvent.create).toHaveBeenCalled()
      expect(res.id).toBe('loc-1')
    })
  })

  describe('allocateAssetToProject', () => {
    it('allocates asset to project and updates asset status to IN_USE', async () => {
      const tx = makeMockTx()
      const db = makeMockDb(tx)
      const res = await allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        purpose: 'Development workstation',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db,
      })

      expect(tx.assetProjectAllocation.create).toHaveBeenCalled()
      expect(tx.registeredAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'IN_USE' },
        })
      )
      expect(res.id).toBe('alloc-1')
    })
  })

  describe('returnAssetFromProject', () => {
    it('returns asset from project and reverts status to ACTIVE if no active allocations remain', async () => {
      const tx = makeMockTx({
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            tenantId: 'tenant-1',
            businessId: 'biz-1',
            assetCode: 'AST-2026-00001',
            name: 'MacBook Pro 16',
            status: 'IN_USE',
            condition: 'GOOD',
          }),
          update: vi.fn().mockResolvedValue({
            id: 'ast-1',
            status: 'ACTIVE',
          }),
        },
      })
      const db = makeMockDb(tx)
      const res = await returnAssetFromProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        returnCondition: 'GOOD',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db,
      })

      expect(tx.assetProjectAllocation.update).toHaveBeenCalled()
      expect(tx.registeredAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { condition: 'GOOD', status: 'ACTIVE' },
        })
      )
      expect(res.id).toBe('alloc-1')
    })
  })
})
