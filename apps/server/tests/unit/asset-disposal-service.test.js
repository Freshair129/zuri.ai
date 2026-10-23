// @req FR-133, FR-135 — Decommissioning & Disposal service tests (AM-RQ-070..AM-RQ-073).
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-disposal-service.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  finalizeAssetDisposal,
  listAssetDisposalLogs,
} from '@/modules/asset-management/application/asset-disposal-service'

function makeMockDb(tx) {
  return {
    ...tx,
    $transaction: vi.fn(async (callback) => callback(tx)),
  }
}

describe('Asset Disposal Service', () => {
  describe('finalizeAssetDisposal', () => {
    it('throws error when required fields are missing', async () => {
      await expect(finalizeAssetDisposal({ businessId: '', registeredAssetId: '', reason: '' })).rejects.toThrow(
        /Business ID is required/
      )
      await expect(finalizeAssetDisposal({ businessId: 'biz-1', registeredAssetId: '', reason: '' })).rejects.toThrow(
        /Registered Asset ID is required/
      )
      await expect(finalizeAssetDisposal({ businessId: 'biz-1', registeredAssetId: 'ast-1', reason: '' })).rejects.toThrow(
        /Disposal reason is required/
      )
    })

    it('throws error for invalid disposal method', async () => {
      await expect(
        finalizeAssetDisposal({
          businessId: 'biz-1',
          registeredAssetId: 'ast-1',
          method: 'INVALID_METHOD',
          reason: 'Broken',
        })
      ).rejects.toThrow(/Invalid disposal method/)
    })

    it('refuses to dispose an asset actively allocated to a project', async () => {
      const tx = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            status: 'IN_USE',
            version: 1,
            projectAllocations: [{ id: 'alloc-1', status: 'ACTIVE' }],
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn(),
        },
        assetProjectAllocation: { count: vi.fn().mockResolvedValue(1) },
        assetResponsibility: { updateMany: vi.fn() },
        auditEvent: { create: vi.fn() },
      }
      const mockDb = makeMockDb(tx)

      await expect(
        finalizeAssetDisposal({
          businessId: 'biz-1',
          registeredAssetId: 'ast-1',
          method: 'SCRAP',
          reason: 'End of life',
          db: mockDb,
        })
      ).rejects.toThrow(/Cannot dispose asset while it is actively allocated to a project/)
      expect(tx.assetProjectAllocation.count).toHaveBeenCalled()
      expect(tx.registeredAsset.update).not.toHaveBeenCalled()
      expect(tx.assetResponsibility.updateMany).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
    })

    it('disposes asset, closes responsibilities, and records audit event', async () => {
      const tx = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            assetCode: 'AST-2026-00001',
            name: 'MacBook Pro 16',
            status: 'ACTIVE',
            condition: 'POOR',
            version: 4,
            projectAllocations: [],
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue({
            id: 'ast-1',
            status: 'DISPOSED',
          }),
        },
        assetProjectAllocation: { count: vi.fn().mockResolvedValue(0) },
        assetResponsibility: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
        },
      }
      const mockDb = makeMockDb(tx)

      const res = await finalizeAssetDisposal({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        method: 'SELL',
        reason: 'Upgraded to M4 workstation',
        salePrice: '25000.00',
        buyerOrRecipient: 'Second-hand buyer Ltd.',
        documentRef: 'INV-SALE-2026-001',
        evidenceFileAssetId: 'evidence-file-1',
        viewer: { personId: 'user-1' },
        db: mockDb,
      })

      expect(mockDb.$transaction).toHaveBeenCalledOnce()
      expect(tx.registeredAsset.updateMany).toHaveBeenCalledWith({
        where: { id: 'ast-1', businessId: 'biz-1', deletedAt: null, version: 4 },
        data: { version: { increment: 1 } },
      })
      expect(tx.assetProjectAllocation.count).toHaveBeenCalledWith({
        where: { registeredAssetId: 'ast-1', businessId: 'biz-1', effectiveTo: null, status: 'ACTIVE' },
      })
      expect(tx.registeredAsset.update).toHaveBeenCalledWith({
        where: { id: 'ast-1' },
        data: expect.objectContaining({
          status: 'DISPOSED',
        }),
      })
      expect(tx.assetResponsibility.updateMany).toHaveBeenCalled()
      expect(tx.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'REGISTERED_ASSET',
          entityId: 'ast-1',
          action: 'ASSET_DISPOSED',
        }),
      })
      const persistedPayloadJson = tx.auditEvent.create.mock.calls[0][0].data.payloadJson
      expect(JSON.parse(persistedPayloadJson)).toMatchObject({
        registeredAssetId: 'ast-1',
        assetCode: 'AST-2026-00001',
        method: 'SELL',
        reason: 'Upgraded to M4 workstation',
        salePrice: '25000.00',
        buyerOrRecipient: 'Second-hand buyer Ltd.',
        documentRef: 'INV-SALE-2026-001',
        evidenceFileAssetId: 'evidence-file-1',
      })

      const disposalLogs = await listAssetDisposalLogs({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        db: {
          auditEvent: {
            findMany: vi.fn().mockResolvedValue([{
              id: 'audit-1',
              entityId: 'ast-1',
              action: 'ASSET_DISPOSED',
              occurredAt: new Date('2026-10-23T00:00:00.000Z'),
              actorId: 'user-1',
              payloadJson: persistedPayloadJson,
            }]),
          },
        },
      })
      expect(disposalLogs[0]).toMatchObject({
        method: 'SELL',
        reason: 'Upgraded to M4 workstation',
        documentRef: 'INV-SALE-2026-001',
        evidenceFileAssetId: 'evidence-file-1',
      })
      expect(res.method).toBe('SELL')
      expect(res.salePrice).toBe('25000.00')
      expect(res.buyerOrRecipient).toBe('Second-hand buyer Ltd.')
    })

    it('fails disposal on a stale RegisteredAsset version before checking allocations or writing side effects', async () => {
      const tx = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1', assetCode: 'AST-2026-00001', name: 'MacBook Pro 16',
            status: 'ACTIVE', condition: 'GOOD', version: 8,
            projectAllocations: [],
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          update: vi.fn(),
        },
        assetProjectAllocation: { count: vi.fn() },
        assetResponsibility: { updateMany: vi.fn() },
        auditEvent: { create: vi.fn() },
      }
      const db = makeMockDb(tx)

      await expect(finalizeAssetDisposal({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        method: 'SCRAP',
        reason: 'End of life',
        db,
      })).rejects.toMatchObject({ status: 409 })

      expect(db.$transaction).toHaveBeenCalledOnce()
      expect(tx.registeredAsset.updateMany).toHaveBeenCalledWith({
        where: { id: 'ast-1', businessId: 'biz-1', deletedAt: null, version: 8 },
        data: { version: { increment: 1 } },
      })
      expect(tx.assetProjectAllocation.count).not.toHaveBeenCalled()
      expect(tx.registeredAsset.update).not.toHaveBeenCalled()
      expect(tx.assetResponsibility.updateMany).not.toHaveBeenCalled()
      expect(tx.auditEvent.create).not.toHaveBeenCalled()
    })
  })

  describe('listAssetDisposalLogs', () => {
    it('retrieves and parses disposal audit events for registered asset', async () => {
      const mockDb = {
        auditEvent: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'audit-disp-1',
              entityId: 'ast-1',
              action: 'ASSET_DISPOSED',
              occurredAt: new Date('2026-09-06'),
              actorId: 'user-1',
              payloadJson: JSON.stringify({
                method: 'SCRAP',
                reason: 'Water damaged beyond repair',
              }),
            },
          ]),
        },
      }

      const logs = await listAssetDisposalLogs({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        db: mockDb,
      })

      expect(logs).toHaveLength(1)
      expect(logs[0].method).toBe('SCRAP')
      expect(logs[0].action).toBe('ASSET_DISPOSED')
    })
  })
})
