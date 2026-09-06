// @req FR-140 — trusted LINE transport sends opaque FileAsset references only.
// @spec SDD-084, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-intake-adapters-contract.test.js
import { z } from 'zod'
import { ASSET_EVIDENCE_ROLES, ASSET_PROCUREMENT_REF_TYPES } from '@/lib/validation/enums'

export const zLineAssetHandoff = z.object({
  bindingId: z.string().uuid().optional(),
  destination: z.string().min(1).max(300).optional(),
  correlationId: z.string().min(1).max(200),
  messageGroupId: z.string().min(1).max(200).optional(),
  fileAssetIds: z.array(z.string().min(1)).min(1).max(20),
  evidenceRoles: z.record(z.enum(ASSET_EVIDENCE_ROLES)).optional(),
  origin: z.enum(['PROCUREMENT_PURCHASE', 'DONATION', 'TRANSFER_IN', 'OPENING_BALANCE', 'OTHER']).optional(),
  itemName: z.string().min(1).max(300).optional(),
  categoryCode: z.string().min(1).max(100).optional(),
  procurementRefs: z.array(z.object({
    type: z.enum(ASSET_PROCUREMENT_REF_TYPES),
    system: z.string().min(1).max(100), value: z.string().min(1).max(200), lineValue: z.string().max(100).nullish(),
  }).strict()).max(50).optional(),
}).strict()

export function lineAssetHandoffToEnvelope(input, businessId) {
  const value = zLineAssetHandoff.parse(input)
  return {
    schemaVersion: '1.0',
    source: { channel: 'LINE_OA', correlationId: value.correlationId },
    businessId,
    origin: value.origin || 'OTHER',
    item: { name: value.itemName || 'LINE evidence draft', categoryCode: value.categoryCode || 'UNCLASSIFIED', quantity: 1, expiryControlled: false },
    evidence: value.fileAssetIds.map((fileAssetId) => ({ fileAssetId, role: value.evidenceRoles?.[fileAssetId] || 'OTHER' })),
    procurementRefs: value.procurementRefs || [], lot: null, responsibilities: [], location: null,
    projectAllocation: null, depreciation: null,
  }
}
