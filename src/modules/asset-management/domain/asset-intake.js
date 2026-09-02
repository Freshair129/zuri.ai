// @req FR-134, FR-135 — one strict Asset intake contract with evidence,
// procurement, expiry, scope and temporal validation across every surface.
// @spec SDD-079, SDD-080, BR-023, BR-024, SEC-023, ADR-055
// @tested tests/unit/asset-management-contract.test.js
import { z } from 'zod'
import {
  zAssetDepreciationMethod,
  zAssetEvidenceRole,
  zAssetIntakeChannel,
  zAssetProcurementRefType,
  zAssetResponsibilityRole,
} from '../../../lib/validation/enums.js'

export const ASSET_INTAKE_SCHEMA_VERSION = '1.0'

const zSource = z.object({
  channel: zAssetIntakeChannel,
  correlationId: z.string().min(1).max(200),
}).strict()

const zItem = z.object({
  name: z.string().min(1).max(300),
  categoryCode: z.string().min(1).max(100),
  quantity: z.number().positive(),
  expiryControlled: z.boolean().default(false),
  description: z.string().max(2_000).nullish(),
  brand: z.string().max(200).nullish(),
  model: z.string().max(200).nullish(),
  serialNumber: z.string().max(200).nullish(),
}).strict()

const zEvidence = z.object({
  fileAssetId: z.string().min(1),
  role: zAssetEvidenceRole,
  paymentReference: z.string().max(200).nullish(),
}).strict()

const zProcurementRef = z.object({
  type: zAssetProcurementRefType,
  system: z.string().min(1).max(100),
  value: z.string().min(1).max(200),
  lineValue: z.string().max(100).nullish(),
}).strict()

const zLot = z.object({
  lotId: z.string().min(1).max(200),
  manufacturedOn: z.string().date().nullish(),
  expiresOn: z.string().date(),
}).strict()

const zResponsibility = z.object({
  role: zAssetResponsibilityRole,
  personId: z.string().min(1),
  orgUnitSystem: z.string().max(100).nullish(),
  orgUnitRef: z.string().max(200).nullish(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullish(),
}).strict()

const zLocation = z.object({
  branchId: z.string().min(1).nullish(),
  locationCode: z.string().min(1).max(100),
  locationName: z.string().min(1).max(300),
  effectiveFrom: z.string().datetime().nullish(),
}).strict()

const zProjectAllocation = z.object({
  projectId: z.string().min(1),
  workstreamId: z.string().min(1).nullish(),
  projectBusinessId: z.string().min(1),
  exclusive: z.boolean().default(true),
  quantity: z.number().positive().default(1),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullish(),
}).strict()

const zDepreciation = z.object({
  method: zAssetDepreciationMethod,
  acquisitionAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  residualValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
  usefulLifeMonths: z.number().int().positive().max(1_200),
  startDate: z.string().date(),
  currency: z.string().length(3),
}).strict()

const zExtraction = z.object({
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  status: z.literal('CANDIDATE'),
  fields: z.array(z.object({
    field: z.string().min(1).max(100),
    value: z.unknown(),
    confidence: z.number().min(0).max(1),
    evidenceFileAssetId: z.string().min(1),
  }).strict()),
}).strict()

export const zAssetIntakeEnvelope = z.object({
  schemaVersion: z.literal(ASSET_INTAKE_SCHEMA_VERSION),
  source: zSource,
  businessId: z.string().min(1),
  origin: z.enum(['PROCUREMENT_PURCHASE', 'DONATION', 'TRANSFER_IN', 'OPENING_BALANCE', 'OTHER']),
  item: zItem,
  evidence: z.array(zEvidence),
  procurementRefs: z.array(zProcurementRef),
  lot: zLot.nullable(),
  responsibilities: z.array(zResponsibility),
  location: zLocation.nullable(),
  projectAllocation: zProjectAllocation.nullable(),
  depreciation: zDepreciation.nullable(),
  extraction: zExtraction.optional(),
}).strict()

function issue(code, path, message) {
  return { code, path, message }
}

/**
 * Validate a preview only. It derives no authority from input and performs no
 * upload, OCR, external lookup, approval or persistence side effect.
 */
export function validateAssetIntake(input, { trustedTenantId, trustedBusinessId } = {}) {
  const parsed = zAssetIntakeEnvelope.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      value: null,
      conflicts: [],
      requiresHumanReview: false,
      issues: parsed.error.issues.map((entry) => issue(
        'INVALID_ENVELOPE', entry.path.join('.'), entry.message,
      )),
    }
  }

  const value = parsed.data
  const issues = []
  if (!trustedTenantId || !trustedBusinessId || value.businessId !== trustedBusinessId) {
    issues.push(issue('BUSINESS_SCOPE_MISMATCH', 'businessId', 'Business must match trusted viewer scope'))
  }

  if (value.origin === 'PROCUREMENT_PURCHASE') {
    if (!value.evidence.some((entry) => entry.role === 'PAYMENT_PROOF')) {
      issues.push(issue('PAYMENT_PROOF_REQUIRED', 'evidence', 'Payment proof is required'))
    }
    if (!value.procurementRefs.some((entry) => entry.type === 'PR')) {
      issues.push(issue('PR_REQUIRED', 'procurementRefs', 'A PR reference is required'))
    }
    if (!value.procurementRefs.some((entry) => entry.type === 'PO')) {
      issues.push(issue('PO_REQUIRED', 'procurementRefs', 'A PO reference is required'))
    }
  }

  if (value.item.expiryControlled) {
    if (!value.lot?.lotId) issues.push(issue('LOT_REQUIRED', 'lot.lotId', 'Lot is required'))
    if (!value.lot?.expiresOn) issues.push(issue('EXPIRY_REQUIRED', 'lot.expiresOn', 'Expiry date is required'))
  }
  if (value.lot?.manufacturedOn && value.lot.expiresOn < value.lot.manufacturedOn) {
    issues.push(issue('INVALID_EXPIRY_RANGE', 'lot.expiresOn', 'Expiry must not precede manufacture'))
  }
  if (value.projectAllocation?.projectBusinessId !== undefined &&
      value.projectAllocation.projectBusinessId !== trustedBusinessId) {
    issues.push(issue('PROJECT_SCOPE_MISMATCH', 'projectAllocation.projectId', 'Project must belong to the same Business'))
  }

  return {
    ok: issues.length === 0,
    value: { ...value, tenantId: trustedTenantId },
    issues,
    conflicts: [],
    requiresHumanReview: Boolean(value.extraction),
  }
}

/** Half-open intervals `[from, to)` allow a next assignment to start exactly
 * when the previous one ends without reporting an overlap. */
export function findTemporalOverlaps(intervals = []) {
  const normalized = intervals.map((entry) => ({
    id: entry.id,
    from: new Date(entry.effectiveFrom).getTime(),
    to: entry.effectiveTo ? new Date(entry.effectiveTo).getTime() : Number.POSITIVE_INFINITY,
  })).sort((left, right) => left.from - right.from || String(left.id).localeCompare(String(right.id)))

  const overlaps = []
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      if (normalized[right].from >= normalized[left].to) break
      if (normalized[left].from < normalized[right].to) {
        overlaps.push({ leftId: normalized[left].id, rightId: normalized[right].id })
      }
    }
  }
  return overlaps
}
