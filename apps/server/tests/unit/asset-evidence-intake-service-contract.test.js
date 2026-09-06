// @req FR-137, FR-138 — one idempotent draft writer and separate review gate.
// @spec SDD-081, SDD-082, BR-025, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-intake-service-contract.test.js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeViewer } from '../factories/viewer'

async function optionalModule(relativePath) {
  try { return await import(pathToFileURL(path.resolve(relativePath)).href) } catch { return null }
}

function envelope(overrides = {}) {
  return {
    schemaVersion: '1.0', source: { channel: 'WEB', correlationId: 'receipt-001' },
    businessId: 'business-a', origin: 'PROCUREMENT_PURCHASE',
    item: { name: 'Notebook', categoryCode: 'IT', quantity: 1, expiryControlled: false },
    evidence: [{ fileAssetId: 'file-payment', role: 'PAYMENT_PROOF' }],
    procurementRefs: [{ type: 'PR', system: 'ERP', value: 'PR-1' }, { type: 'PO', system: 'ERP', value: 'PO-1' }],
    lot: null, responsibilities: [], location: null, projectAllocation: null, depreciation: null,
    ...overrides,
  }
}

describe('FR-137/138 Asset intake writer and review gate', () => {
  it('hashes normalized payload deterministically and derives readiness only from reviewed evidence', async () => {
    const service = await optionalModule('src/modules/asset-management/application/asset-intake-service.js')
    expect(service, 'Asset intake application service must exist').not.toBeNull()
    if (!service) return

    expect(service.canonicalAssetIntakeHash(envelope())).toMatch(/^[a-f0-9]{64}$/)
    expect(service.canonicalAssetIntakeHash(envelope())).toBe(service.canonicalAssetIntakeHash(envelope()))
    expect(service.deriveAssetIntakeStatus({ validation: { ok: true }, evidence: [{ status: 'EXTRACTED' }] })).toBe('NEEDS_REVIEW')
    expect(service.deriveAssetIntakeStatus({ validation: { ok: true }, evidence: [{ status: 'REVIEWED' }] })).toBe('READY_FOR_REGISTRATION')
    expect(service.deriveAssetIntakeStatus({ validation: { ok: false }, evidence: [{ status: 'REVIEWED' }] })).toBe('DRAFT')
  })

  it('grants receiver and reviewer permissions only at the exact Business while owners retain both', async () => {
    const rbac = await optionalModule('src/modules/identity/rbac.js')
    const access = await optionalModule('src/modules/asset-management/application/asset-authority.js')
    expect(rbac, 'Asset RBAC roles must exist').not.toBeNull()
    expect(access, 'Asset authority predicates must exist').not.toBeNull()
    if (!rbac || !access) return

    expect(rbac.ROLE_PERMISSIONS.ASSET_RECEIVER).toContain('asset.intake.write')
    expect(rbac.ROLE_PERMISSIONS.ASSET_REVIEWER).toContain('asset.evidence.review')
    const receiver = makeViewer({ visibleBusinessIds: ['business-a'], rolesByBusinessId: { 'business-a': ['ASSET_RECEIVER'] } })
    const reviewer = makeViewer({ visibleBusinessIds: ['business-a'], rolesByBusinessId: { 'business-a': ['ASSET_REVIEWER'] } })
    const owner = makeViewer({ visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })
    expect(access.canWriteAssetIntake(receiver, 'business-a')).toBe(true)
    expect(access.canReviewAssetEvidence(receiver, 'business-a')).toBe(false)
    expect(access.canReviewAssetEvidence(reviewer, 'business-a')).toBe(true)
    expect(access.canWriteAssetIntake(owner, 'business-a')).toBe(true)
    expect(access.canReviewAssetEvidence(owner, 'business-a')).toBe(true)
    expect(access.canWriteAssetIntake(receiver, 'business-b')).toBe(false)
  })

  it('binds one source correlation to one payload hash instead of overwriting a replay', async () => {
    const service = await optionalModule('src/modules/asset-management/application/asset-intake-service.js')
    expect(service, 'Asset intake application service must exist').not.toBeNull()
    if (!service) return

    const existing = { id: 'intake-a', payloadSha256: service.canonicalAssetIntakeHash(envelope()) }
    expect(service.decideAssetIntakeReplay(existing, envelope())).toEqual({ kind: 'REPLAY', intake: existing })
    expect(() => service.decideAssetIntakeReplay(existing, envelope({ item: { name: 'Changed', categoryCode: 'IT', quantity: 1, expiryControlled: false } })))
      .toThrow(/different payload/i)
  })
})
