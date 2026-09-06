// @req FR-133, FR-135, FR-136 — Asset maintenance ticketing, service history, and depreciation schedule service tests.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-maintenance-service.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  createMaintenanceLog,
  completeMaintenanceLog,
  listAssetMaintenanceLogs,
} from '@/modules/asset-management/application/asset-maintenance-service'
import {
  getOrCreateAssetDepreciationCandidate,
} from '@/modules/asset-management/application/asset-depreciation-service'

describe('Asset Maintenance & Depreciation Services', () => {
  describe('createMaintenanceLog', () => {
    it('throws error when required fields are missing', async () => {
      await expect(createMaintenanceLog({ businessId: '', registeredAssetId: '', title: '' })).rejects.toThrow(
        /Business ID is required/
      )
      await expect(createMaintenanceLog({ businessId: 'biz-1', registeredAssetId: '', title: '' })).rejects.toThrow(
        /Registered Asset ID is required/
      )
      await expect(createMaintenanceLog({ businessId: 'biz-1', registeredAssetId: 'ast-1', title: '' })).rejects.toThrow(
        /Maintenance title\/reason is required/
      )
    })

    it('creates maintenance ticket, updates asset status to MAINTENANCE, and records audit', async () => {
      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            assetCode: 'AST-2026-00001',
            status: 'ACTIVE',
          }),
          update: vi.fn().mockResolvedValue({
            id: 'ast-1',
            status: 'MAINTENANCE',
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
        },
      }

      const res = await createMaintenanceLog({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        title: 'Battery replacement',
        issueDescription: 'Battery swelling detected',
        priority: 'HIGH',
        serviceProvider: 'Apple Care',
        estimatedCost: '4500.00',
        viewer: { personId: 'user-1' },
        db: mockDb,
      })

      expect(mockDb.registeredAsset.update).toHaveBeenCalledWith({
        where: { id: 'ast-1' },
        data: expect.objectContaining({
          status: 'MAINTENANCE',
        }),
      })
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'REGISTERED_ASSET',
          entityId: 'ast-1',
          action: 'ASSET_MAINTENANCE_LOGGED',
        }),
      })
      expect(res.title).toBe('Battery replacement')
      expect(res.status).toBe('OPEN')
    })
  })

  describe('completeMaintenanceLog', () => {
    it('completes maintenance, updates status back to ACTIVE, and logs completion audit', async () => {
      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            assetCode: 'AST-2026-00001',
            status: 'MAINTENANCE',
            projectAllocations: [],
          }),
          update: vi.fn().mockResolvedValue({
            id: 'ast-1',
            status: 'ACTIVE',
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: 'audit-2' }),
        },
      }

      const res = await completeMaintenanceLog({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        resolutionNotes: 'Battery replaced and tested OK',
        actualCost: '4200.00',
        newCondition: 'GOOD',
        invoiceRef: 'INV-2026-99',
        viewer: { personId: 'user-1' },
        db: mockDb,
      })

      expect(mockDb.registeredAsset.update).toHaveBeenCalledWith({
        where: { id: 'ast-1' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          condition: 'GOOD',
        }),
      })
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'REGISTERED_ASSET',
          entityId: 'ast-1',
          action: 'ASSET_MAINTENANCE_COMPLETED',
        }),
      })
      expect(res.revertedStatus).toBe('ACTIVE')
      expect(res.actualCost).toBe('4200.00')
    })

    it('reverts status to IN_USE if an active project allocation exists', async () => {
      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            assetCode: 'AST-2026-00001',
            status: 'MAINTENANCE',
            projectAllocations: [{ id: 'alloc-1', status: 'ACTIVE' }],
          }),
          update: vi.fn().mockResolvedValue({
            id: 'ast-1',
            status: 'IN_USE',
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: 'audit-3' }),
        },
      }

      const res = await completeMaintenanceLog({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        resolutionNotes: 'Repaired',
        viewer: { personId: 'user-1' },
        db: mockDb,
      })

      expect(res.revertedStatus).toBe('IN_USE')
    })
  })

  describe('listAssetMaintenanceLogs', () => {
    it('retrieves and parses maintenance audit events for registered asset', async () => {
      const mockDb = {
        auditEvent: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'audit-1',
              entityId: 'ast-1',
              action: 'ASSET_MAINTENANCE_LOGGED',
              occurredAt: new Date('2026-09-01'),
              actorId: 'user-1',
              payloadJson: JSON.stringify({
                title: 'Screen glitch',
                priority: 'NORMAL',
              }),
            },
          ]),
        },
      }

      const logs = await listAssetMaintenanceLogs({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        db: mockDb,
      })

      expect(logs).toHaveLength(1)
      expect(logs[0].title).toBe('Screen glitch')
      expect(logs[0].action).toBe('ASSET_MAINTENANCE_LOGGED')
    })
  })

  describe('getOrCreateAssetDepreciationCandidate', () => {
    it('calculates deterministic straight-line depreciation schedule and saves candidate preview', async () => {
      const mockDb = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ast-1',
            tenantId: 'tenant-1',
            businessId: 'biz-1',
            acquisitionAmount: '36000.00',
            currency: 'THB',
            receivedOn: new Date('2026-01-01'),
          }),
        },
        assetDepreciationCandidate: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 'dep-1',
            registeredAssetId: 'ast-1',
            method: 'STRAIGHT_LINE',
            acquisitionAmount: '36000.00',
            residualValue: '0.00',
            currency: 'THB',
            usefulLifeMonths: 36,
            calculationVersion: 1,
            status: 'PREVIEW',
          }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: 'audit-dep-1' }),
        },
      }

      const res = await getOrCreateAssetDepreciationCandidate({
        businessId: 'biz-1',
        registeredAssetId: 'ast-1',
        usefulLifeMonths: 36,
        residualValue: '0.00',
        viewer: { personId: 'user-1' },
        db: mockDb,
      })

      expect(res.method).toBe('STRAIGHT_LINE')
      expect(res.usefulLifeMonths).toBe(36)
      expect(res.schedule).toHaveLength(36)
      expect(res.schedule[0].depreciation).toBe('1000.00')
      expect(res.accountingAuthority).toBe(false)
      expect(mockDb.assetDepreciationCandidate.create).toHaveBeenCalled()
      expect(mockDb.auditEvent.create).toHaveBeenCalled()
    })
  })
})
