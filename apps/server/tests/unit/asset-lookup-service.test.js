// @req FR-133, FR-135 — fast QR lookup, physical verification, and stocktake service test.
// @spec SDD-078, SDD-080, BR-023, SEC-023, ADR-055
// @tested tests/unit/asset-lookup-service.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseAssetCodeOrId,
  lookupAssetByQrOrCode,
  verifyAssetObservation,
} from '@/modules/asset-management/application/asset-lookup-service'

describe('asset-lookup-service', () => {
  describe('parseAssetCodeOrId', () => {
    it('parses direct asset codes', () => {
      expect(parseAssetCodeOrId('AST-2026-00042')).toBe('AST-2026-00042')
      expect(parseAssetCodeOrId('  ast-2026-00001  ')).toBe('AST-2026-00001')
    })

    it('extracts asset code from zuri:// URI scheme', () => {
      expect(
        parseAssetCodeOrId('zuri://assets/biz-alpha/AST-2026-00123?v=1')
      ).toBe('AST-2026-00123')
    })

    it('extracts asset code from web lookup URL query parameter', () => {
      expect(
        parseAssetCodeOrId('https://app.zuri.ai/assets/lookup?b=biz-1&code=AST-2026-00999')
      ).toBe('AST-2026-00999')
    })

    it('falls back to raw trimmed identifier for UUIDs or serials', () => {
      expect(parseAssetCodeOrId('sn-987654321')).toBe('sn-987654321')
      expect(parseAssetCodeOrId('')).toBe('')
      expect(parseAssetCodeOrId(null)).toBe('')
    })
  })

  describe('lookupAssetByQrOrCode', () => {
    it('requires businessId and codeOrToken', async () => {
      await expect(lookupAssetByQrOrCode({})).rejects.toThrow('Business ID is required')
      await expect(
        lookupAssetByQrOrCode({ businessId: 'biz-1' })
      ).rejects.toThrow('Asset code or QR token is required')
    })

    it('resolves asset with active custodian, location, project allocation, and lot', async () => {
      const mockAsset = {
        id: 'asset-1',
        assetCode: 'AST-2026-00001',
        name: 'MacBook Pro M3 Max',
        categoryCode: 'IT_EQUIPMENT',
        brand: 'Apple',
        model: 'MacBook Pro 16"',
        serialNumber: 'C02G1234XYZ',
        status: 'ACTIVE',
        condition: 'GOOD',
        acquisitionAmount: '119000.00',
        currency: 'THB',
        receivedOn: new Date('2026-01-15'),
        registeredAt: new Date('2026-01-16'),
        lot: { id: 'lot-1', lotCode: 'LOT-2026-01', expiresOn: new Date('2029-01-01'), status: 'ACTIVE' },
        responsibilities: [
          {
            role: 'ACCOUNTABLE',
            personId: 'p-mgr',
            effectiveFrom: new Date('2026-01-16'),
            person: { id: 'p-mgr', displayName: 'Tech Lead Somchai', email: 'somchai@biz.test' },
          },
          {
            role: 'CUSTODIAN',
            personId: 'p-admin',
            effectiveFrom: new Date('2026-01-16'),
            person: { id: 'p-admin', displayName: 'Admin Suda', email: 'suda@biz.test' },
          },
        ],
        locations: [
          {
            id: 'loc-1',
            branchId: 'br-hq',
            locationCode: 'HQ-FL3-L01',
            locationName: 'HQ Floor 3 Dev Lab',
            isPrimary: true,
            effectiveFrom: new Date('2026-01-16'),
            branch: { id: 'br-hq', name: 'Headquarters Bangkok', code: 'HQ' },
          },
        ],
        projectAllocations: [
          {
            id: 'alloc-1',
            projectId: 'prj-alpha',
            workstreamId: 'ws-core',
            effectiveFrom: new Date('2026-02-01'),
            project: { id: 'prj-alpha', name: 'Zuri Mobile Core', code: 'PRJ-MOB' },
            workstream: { id: 'ws-core', name: 'Core Engine' },
          },
        ],
        evidence: [
          {
            id: 'ev-photo',
            role: 'ASSET_PHOTO',
            fileAssetId: 'fil-1',
            fileAsset: { id: 'fil-1', name: 'macbook_unboxing.jpg', mimeType: 'image/jpeg', sizeBytes: 2048576 },
          },
        ],
      }

      const db = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue(mockAsset),
        },
      }

      const result = await lookupAssetByQrOrCode({
        businessId: 'biz-1',
        codeOrToken: 'zuri://assets/biz-1/AST-2026-00001?v=1',
        db,
      })

      expect(db.registeredAsset.findFirst).toHaveBeenCalledWith({
        where: {
          businessId: 'biz-1',
          deletedAt: null,
          OR: [
            { assetCode: 'AST-2026-00001' },
            { id: 'AST-2026-00001' },
            { serialNumber: 'AST-2026-00001' },
          ],
        },
        include: expect.any(Object),
      })

      expect(result).toMatchObject({
        id: 'asset-1',
        assetCode: 'AST-2026-00001',
        name: 'MacBook Pro M3 Max',
        activeAccountable: {
          id: 'p-mgr',
          name: 'Tech Lead Somchai',
        },
        activeCustodian: {
          id: 'p-admin',
          name: 'Admin Suda',
        },
        currentLocation: {
          branchName: 'Headquarters Bangkok',
          locationName: 'HQ Floor 3 Dev Lab',
        },
        activeAllocation: {
          projectId: 'prj-alpha',
          projectName: 'Zuri Mobile Core',
        },
        lot: {
          lotCode: 'LOT-2026-01',
        },
        photoEvidence: {
          fileAssetId: 'fil-1',
        },
      })
    })

    it('throws 404 when asset does not exist', async () => {
      const db = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }

      await expect(
        lookupAssetByQrOrCode({ businessId: 'biz-1', codeOrToken: 'AST-2026-99999', db })
      ).rejects.toThrow('Asset not found for identifier: AST-2026-99999')
    })
  })

  describe('verifyAssetObservation', () => {
    it('records audit event and updates condition when observed', async () => {
      const mockAsset = {
        id: 'asset-1',
        assetCode: 'AST-2026-00001',
        condition: 'GOOD',
        locations: [
          {
            id: 'loc-1',
            branchId: 'br-hq',
            locationName: 'HQ Floor 3 Dev Lab',
            isPrimary: true,
          },
        ],
      }

      const db = {
        registeredAsset: {
          findFirst: vi.fn().mockResolvedValue(mockAsset),
          update: vi.fn().mockResolvedValue({ ...mockAsset, condition: 'FAIR' }),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
        },
      }

      const viewer = { personId: 'auditor-1' }

      const result = await verifyAssetObservation({
        businessId: 'biz-1',
        registeredAssetId: 'asset-1',
        observedBranchId: 'br-hq',
        observedLocationName: 'HQ Floor 3 Dev Lab',
        condition: 'FAIR',
        notes: 'Minor scratch on top lid',
        relocateIfMismatch: false,
        viewer,
        db,
      })

      expect(result).toMatchObject({
        registeredAssetId: 'asset-1',
        assetCode: 'AST-2026-00001',
        scannedByPersonId: 'auditor-1',
        locationMatches: true,
        relocated: false,
        condition: 'FAIR',
      })

      expect(db.registeredAsset.update).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
        data: {
          condition: 'FAIR',
          updatedAt: expect.any(Date),
        },
      })
    })
  })
})
