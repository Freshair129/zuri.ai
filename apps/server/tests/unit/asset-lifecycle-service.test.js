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
    $executeRawUnsafe:vi.fn(async()=>0),
    registeredAsset: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ast-1',
        tenantId: 'tenant-1',
        businessId: 'biz-1',
        assetCode: 'AST-2026-00001',
        name: 'MacBook Pro 16',
        status: 'ACTIVE',
        condition: 'GOOD',
        version: 1,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({
        id: 'ast-1',
        status: 'IN_USE',
      }),
    },
    membership: {
      findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }),
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
    workstream: {
      findFirst: vi.fn().mockResolvedValue({ id: 'workstream-1', projectId: 'proj-1' }),
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
      findMany: vi.fn().mockResolvedValue([]),
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
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        version: 1,
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: 'alloc-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        status: 'RETURNED',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date(),
        version: 2,
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

    it('fails closed when the person has no active direct membership in the asset Business', async () => {
      const tx = makeMockTx({
        membership: { findFirst: vi.fn().mockResolvedValue(null) },
      })
      const db = makeMockDb(tx)

      await expect(transferAssetResponsibility({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        personId: 'p-foreign',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db,
      })).rejects.toMatchObject({ status: 404, message: 'Person not found in current business' })

      expect(tx.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          personId: 'p-foreign',
          tenantId: 'tenant-1',
          businessId: 'biz-1',
          scopeType: 'BUSINESS',
          status: 'ACTIVE',
        }),
      }))
      expect(tx.assetResponsibility.updateMany).not.toHaveBeenCalled()
      expect(tx.assetResponsibility.create).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
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

    it('rejects allocation of a DISPOSED asset before project or interval work', async () => {
      const tx = makeMockTx({
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1', tenantId: 'tenant-1', businessId: 'biz-1', assetCode: 'AST-2026-00001',
            status: 'DISPOSED', version: 2,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn(),
        },
      })

      await expect(allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })).rejects.toMatchObject({ status: 409, message: 'Disposed asset cannot be allocated' })

      expect(tx.project.findFirst).not.toHaveBeenCalled()
      expect(tx.registeredAsset.updateMany).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.findMany).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.create).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
    })

    it('does not add an allocation status restriction for MAINTENANCE assets', async () => {
      const tx = makeMockTx({
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1', tenantId: 'tenant-1', businessId: 'biz-1', assetCode: 'AST-2026-00001',
            status: 'MAINTENANCE', version: 1,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn(),
        },
      })

      await expect(allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })).resolves.toMatchObject({ id: 'alloc-1' })

      expect(tx.assetProjectAllocation.create).toHaveBeenCalled()
    })

    it('rejects a Workstream outside the selected Project before claiming or writing the asset', async () => {
      const tx = makeMockTx({
        workstream: { findFirst: vi.fn().mockResolvedValue(null) },
      })

      await expect(allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        workstreamId: 'workstream-foreign',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })).rejects.toMatchObject({ status: 404, message: 'Workstream not found in current project' })

      expect(tx.workstream.findFirst).toHaveBeenCalledWith({
        where: { id: 'workstream-foreign', projectId: 'proj-1' },
        select: { id: true },
      })
      expect(tx.registeredAsset.updateMany).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.findMany).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.create).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
    })

    it.each([
      ['zero quantity', { quantity: 0 }],
      ['negative quantity', { quantity: -1 }],
      ['non-finite quantity', { quantity: Number.POSITIVE_INFINITY }],
      ['non-number quantity', { quantity: '2' }],
      ['non-boolean exclusivity', { exclusive: 'true' }],
    ])('rejects %s before opening a transaction', async (_label, invalidInput) => {
      const tx = makeMockTx()
      const db = makeMockDb(tx)
      const transaction = vi.spyOn(db, '$transaction')

      await expect(allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        ...invalidInput,
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db,
      })).rejects.toMatchObject({ status: 400 })

      expect(transaction).not.toHaveBeenCalled()
      expect(tx.registeredAsset.updateMany).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.create).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
    })

    it('rejects a backdated allocation that overlaps a closed historical interval', async () => {
      const tx = makeMockTx({
        assetProjectAllocation: {
          findMany: vi.fn().mockResolvedValue([{
            id: 'alloc-closed',
            exclusive: true,
            status: 'RETURNED',
            effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
            effectiveTo: new Date('2026-10-15T00:00:00.000Z'),
          }]),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: 'alloc-new' }),
        },
      })

      await expect(allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        effectiveFrom: '2026-10-01T00:00:00.000Z',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })).rejects.toMatchObject({ status: 409 })

      expect(tx.assetProjectAllocation.updateMany).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.create).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
    })

    it('allows an exclusive allocation to start exactly at the prior half-open interval end', async () => {
      const effectiveFrom = new Date('2026-10-15T00:00:00.000Z')
      const tx = makeMockTx({
        assetProjectAllocation: {
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: 'alloc-adjacent', status: 'ACTIVE' }),
        },
      })

      const result = await allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        effectiveFrom,
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })

      expect(tx.assetProjectAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        }),
      }))
      expect(tx.assetProjectAllocation.create).toHaveBeenCalled()
      expect(result.id).toBe('alloc-adjacent')
    })

    it('fails closed if another allocation changed the asset version before its interval check', async () => {
      const tx = makeMockTx({
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            tenantId: 'tenant-1',
            businessId: 'biz-1',
            assetCode: 'AST-2026-00001',
            status: 'ACTIVE',
            version: 2,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          update: vi.fn().mockResolvedValue({ id: 'ast-1', status: 'IN_USE' }),
        },
      })

      await expect(allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })).rejects.toMatchObject({ status: 409 })

      expect(tx.registeredAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ast-1', businessId: 'biz-1', deletedAt: null, version: 2 },
        data: { version: { increment: 1 } },
      }))
      expect(tx.assetProjectAllocation.findMany).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.create).not.toHaveBeenCalled()
    })

    it('rejects a backdated allocation that would overlap a later active interval', async () => {
      const tx = makeMockTx({
        assetProjectAllocation: {
          findMany: vi.fn().mockResolvedValue([{
            id: 'alloc-future',
            exclusive: true,
            status: 'ACTIVE',
            effectiveFrom: new Date('2026-10-15T00:00:00.000Z'),
            effectiveTo: null,
          }]),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: 'alloc-new' }),
        },
      })

      await expect(allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        effectiveFrom: '2026-10-01T00:00:00.000Z',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })).rejects.toMatchObject({ status: 409 })

      expect(tx.assetProjectAllocation.updateMany).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.create).not.toHaveBeenCalled()
    })

    it('allows overlapping non-exclusive allocations when no exclusive interval is involved', async () => {
      const tx = makeMockTx({
        assetProjectAllocation: {
          findMany: vi.fn().mockResolvedValue([{
            id: 'alloc-shared',
            exclusive: false,
            status: 'ACTIVE',
            effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
            effectiveTo: null,
          }]),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockResolvedValue({ id: 'alloc-new', status: 'ACTIVE' }),
        },
      })

      const result = await allocateAssetToProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        projectId: 'proj-1',
        exclusive: false,
        effectiveFrom: '2026-10-01T00:00:00.000Z',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })

      expect(result.id).toBe('alloc-new')
      expect(tx.assetProjectAllocation.updateMany).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.create).toHaveBeenCalled()
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
            version: 1,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

      expect(tx.assetProjectAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: 'alloc-1',
          registeredAssetId: 'ast-1',
          businessId: 'biz-1',
          status: 'ACTIVE',
          effectiveTo: null,
          version: 1,
        }),
        data: { status: 'RETURNED', effectiveTo: expect.any(Date), version: { increment: 1 } },
      }))
      expect(tx.assetProjectAllocation.findUnique).toHaveBeenCalledWith({ where: { id: 'alloc-1' } })
      expect(tx.registeredAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { condition: 'GOOD', status: 'ACTIVE' },
        })
      )
      expect(res.id).toBe('alloc-1')
    })

    it('fails closed on a stale RegisteredAsset version before reading the allocation', async () => {
      const tx = makeMockTx({
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1', tenantId: 'tenant-1', businessId: 'biz-1', assetCode: 'AST-2026-00001',
            status: 'IN_USE', condition: 'GOOD', version: 3,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          update: vi.fn(),
        },
      })

      await expect(returnAssetFromProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })).rejects.toMatchObject({ status: 409 })

      expect(tx.registeredAsset.updateMany).toHaveBeenCalledWith({
        where: { id: 'ast-1', businessId: 'biz-1', deletedAt: null, version: 3 },
        data: { version: { increment: 1 } },
      })
      expect(tx.assetProjectAllocation.findFirst).not.toHaveBeenCalled()
      expect(tx.assetProjectAllocation.updateMany).not.toHaveBeenCalled()
      expect(tx.registeredAsset.update).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
    })

    it('rejects a return date before the observed allocation start without mutation or audit', async () => {
      const tx = makeMockTx({
        assetProjectAllocation: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'alloc-1', registeredAssetId: 'ast-1', projectId: 'proj-1', status: 'ACTIVE',
            effectiveFrom: new Date('2026-10-15T00:00:00.000Z'), effectiveTo: null, version: 1,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      })

      await expect(returnAssetFromProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        effectiveTo: '2026-10-14T23:59:59.999Z',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })).rejects.toMatchObject({ status: 400, message: 'effectiveTo cannot be before allocation effectiveFrom' })

      expect(tx.assetProjectAllocation.updateMany).not.toHaveBeenCalled()
      expect(tx.registeredAsset.update).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
    })

    it('does not overwrite a concurrently replaced allocation when the allocation CAS misses', async () => {
      const tx = makeMockTx({
        assetProjectAllocation: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'alloc-1', registeredAssetId: 'ast-1', projectId: 'proj-1', status: 'ACTIVE',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null, version: 2,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      })

      await expect(returnAssetFromProject({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        viewer: { ownedBusinessIds: ['biz-1'], principal: { id: 'user-1' } },
        db: makeMockDb(tx),
      })).rejects.toMatchObject({ status: 409 })

      expect(tx.assetProjectAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: 'alloc-1', status: 'ACTIVE', effectiveTo: null, version: 2,
        }),
      }))
      expect(tx.registeredAsset.update).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
    })
  })
})
