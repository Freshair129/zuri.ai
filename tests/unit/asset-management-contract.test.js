// @req FR-134, FR-135 — every intake surface converges on one strict envelope
// with payment/PR/PO/lot/scope and temporal validation before Asset truth.
// @spec SDD-079, SDD-080, BR-023, BR-024, SEC-023, ADR-055
// @tested tests/unit/asset-management-contract.test.js
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const modulePath = path.resolve(process.cwd(), 'src/modules/asset-management/domain/asset-intake.js')

async function loadContract() {
  if (!fs.existsSync(modulePath)) return null
  return import(pathToFileURL(modulePath).href)
}

function validProcurementIntake(overrides = {}) {
  return {
    schemaVersion: '1.0',
    source: { channel: 'WEB', correlationId: 'draft-001' },
    businessId: 'business-a',
    origin: 'PROCUREMENT_PURCHASE',
    item: {
      name: 'Notebook',
      categoryCode: 'IT-NOTEBOOK',
      quantity: 1,
      expiryControlled: false,
    },
    evidence: [{ fileAssetId: 'file-payment', role: 'PAYMENT_PROOF' }],
    procurementRefs: [
      { type: 'PR', system: 'ERP', value: 'PR-0001' },
      { type: 'PO', system: 'ERP', value: 'PO-0001', lineValue: '10' },
    ],
    lot: null,
    responsibilities: [],
    location: null,
    projectAllocation: null,
    depreciation: null,
    ...overrides,
  }
}

async function requireContract() {
  const contract = await loadContract()
  expect(contract, 'Asset intake contract must exist before this behavior can pass').not.toBeNull()
  return contract
}

describe('AssetIntakeEnvelope', () => {
  it('accepts one strict procurement envelope with payment evidence plus PR and PO', async () => {
    const contract = await requireContract()
    if (!contract) return
    const result = contract.validateAssetIntake(validProcurementIntake(), {
      trustedTenantId: 'tenant-a',
      trustedBusinessId: 'business-a',
    })
    expect(result).toMatchObject({ ok: true, issues: [], conflicts: [] })
  })

  it('rejects an unknown field instead of letting a surface widen the contract', async () => {
    const contract = await requireContract()
    if (!contract) return
    const result = contract.validateAssetIntake(validProcurementIntake({ clientRole: 'OWNER' }), {
      trustedTenantId: 'tenant-a', trustedBusinessId: 'business-a',
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_ENVELOPE' }),
    ]))
  })

  it.each([
    ['payment proof', { evidence: [] }, 'PAYMENT_PROOF_REQUIRED'],
    ['PR reference', { procurementRefs: [{ type: 'PO', system: 'ERP', value: 'PO-0001' }] }, 'PR_REQUIRED'],
    ['PO reference', { procurementRefs: [{ type: 'PR', system: 'ERP', value: 'PR-0001' }] }, 'PO_REQUIRED'],
  ])('fails a procurement Submit without %s', async (_label, overrides, expectedCode) => {
    const contract = await requireContract()
    if (!contract) return
    const result = contract.validateAssetIntake(validProcurementIntake(overrides), {
      trustedTenantId: 'tenant-a', trustedBusinessId: 'business-a',
    })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain(expectedCode)
  })

  it('requires lotId and expiry only for an expiry-controlled category', async () => {
    const contract = await requireContract()
    if (!contract) return
    const controlled = validProcurementIntake({
      item: { name: 'Filter cartridge', categoryCode: 'FILTER', quantity: 1, expiryControlled: true },
    })
    const result = contract.validateAssetIntake(controlled, {
      trustedTenantId: 'tenant-a', trustedBusinessId: 'business-a',
    })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'LOT_REQUIRED', 'EXPIRY_REQUIRED',
    ]))

    const ordinary = contract.validateAssetIntake(validProcurementIntake(), {
      trustedTenantId: 'tenant-a', trustedBusinessId: 'business-a',
    })
    expect(ordinary.issues.map((issue) => issue.code)).not.toContain('LOT_REQUIRED')
  })

  it('refuses a client-selected Business outside trusted viewer scope', async () => {
    const contract = await requireContract()
    if (!contract) return
    const result = contract.validateAssetIntake(validProcurementIntake(), {
      trustedTenantId: 'tenant-a', trustedBusinessId: 'business-b',
    })
    expect(result).toMatchObject({ ok: false })
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BUSINESS_SCOPE_MISMATCH' }),
    ]))
  })

  it('keeps OCR/Vision output as a human-review candidate even at high confidence', async () => {
    const contract = await requireContract()
    if (!contract) return
    const result = contract.validateAssetIntake(validProcurementIntake({
      extraction: {
        provider: 'vision-provider', model: 'model-v1', status: 'CANDIDATE',
        fields: [{ field: 'amount', value: '120000.00', confidence: 0.99, evidenceFileAssetId: 'file-payment' }],
      },
    }), { trustedTenantId: 'tenant-a', trustedBusinessId: 'business-a' })
    expect(result.ok).toBe(true)
    expect(result.requiresHumanReview).toBe(true)
    expect(result.value.extraction.status).toBe('CANDIDATE')
  })
})

describe('temporal Asset records', () => {
  it('detects overlapping active exclusive Project allocations', async () => {
    const contract = await requireContract()
    if (!contract) return
    const overlaps = contract.findTemporalOverlaps([
      { id: 'a', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-03-01T00:00:00.000Z' },
      { id: 'b', effectiveFrom: '2026-02-01T00:00:00.000Z', effectiveTo: null },
    ])
    expect(overlaps).toEqual([{ leftId: 'a', rightId: 'b' }])
  })

  it('treats touching intervals as adjacent, not overlapping', async () => {
    const contract = await requireContract()
    if (!contract) return
    expect(contract.findTemporalOverlaps([
      { id: 'a', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-02-01T00:00:00.000Z' },
      { id: 'b', effectiveFrom: '2026-02-01T00:00:00.000Z', effectiveTo: null },
    ])).toEqual([])
  })
})
