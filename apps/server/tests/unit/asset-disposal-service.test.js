// @req FR-133, FR-135 — Decommissioning & Disposal service tests (AM-RQ-070..AM-RQ-073).
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-disposal-service.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  finalizeAssetDisposal,
  listAssetDisposalLogs,
} from '@/modules/asset-management/application/asset-disposal-service'

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
      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            status: 'IN_USE',
            projectAllocations: [{ id: 'alloc-1', status: 'ACTIVE' }],
          }),
        },
      }

      await expect(
        finalizeAssetDisposal({
          businessId: 'biz-1',
          registeredAssetId: 'ast-1',
          method: 'SCRAP',
          reason: 'End of life',
          db: mockDb,
        })
      ).rejects.toThrow(/Cannot dispose asset while it is actively allocated to a project/)
    })

    it('disposes asset, closes responsibilities, and records audit event', async () => {
      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            assetCode: 'AST-2026-00001',
            name: 'MacBook Pro 16',
            status: 'ACTIVE',
            condition: 'POOR',
            projectAllocations: [],
          }),
          update: vi.fn().mockResolvedValue({
            id: 'ast-1',
            status: 'DISPOSED',
          }),
        },
        assetResponsibility: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
        },
      }

      const res = await finalizeAssetDisposal({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        method: 'SELL',
        reason: 'Upgraded to M4 workstation',
        salePrice: '25000.00',
        buyerOrRecipient: 'Second-hand buyer Ltd.',
        documentRef: 'INV-SALE-2026-001',
        viewer: { personId: 'user-1' },
        db: mockDb,
      })

      expect(mockDb.registeredAsset.update).toHaveBeenCalledWith({
        where: { id: 'ast-1' },
        data: expect.objectContaining({
          status: 'DISPOSED',
        }),
      })
      expect(mockDb.assetResponsibility.updateMany).toHaveBeenCalled()
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'REGISTERED_ASSET',
          entityId: 'ast-1',
          action: 'ASSET_DISPOSED',
        }),
      })
      expect(res.method).toBe('SELL')
      expect(res.salePrice).toBe('25000.00')
      expect(res.buyerOrRecipient).toBe('Second-hand buyer Ltd.')
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
