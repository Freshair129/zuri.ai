// @req FR-137, FR-138 — private evidence → persisted intake → human review readiness.
// @spec SDD-081, SDD-082, BR-025, NFR-022, SEC-024, ADR-056
// @tested tests/integration/asset-evidence-intake-execution.test.js
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { uploadAssetEvidence, reviewAssetEvidence } from '@/modules/asset-management/application/asset-evidence-service'
import { upsertAssetIntake } from '@/modules/asset-management/application/asset-intake-service'

let business, otherBusiness, owner, attacker

const objectStoragePort = {
  put: vi.fn(async ({ key }) => ({ ref: `memory://asset-evidence/${key}` })),
  get: vi.fn(async () => Buffer.from('%PDF-1.7\nreceipt')),
  remove: vi.fn(async () => undefined),
}

describe('FR-137/138 Asset evidence intake execution', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-ASSET-EVIDENCE', name: 'Asset Evidence Group' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-ASSET-EVIDENCE', name: 'Asset Evidence Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-ASSET-EVIDENCE', name: 'Asset Evidence Business' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-ASSET-EVIDENCE-OTHER', name: 'Other Asset Business' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['assets'] })
    attacker = ownsElsewhere({ owns: otherBusiness.id, sees: business.id, visibleDomains: ['assets'] })
  })

  it('persists Asset photo and payment evidence, then advances only after every human review', async () => {
    const file = await uploadAssetEvidence({
      businessId: business.id,
      name: 'receipt.pdf',
      mime: 'application/pdf',
      content: Buffer.from('%PDF-1.7\nreceipt'),
    }, { viewer: owner, objectStoragePort })
    expect(file).toMatchObject({ mime: 'application/pdf', status: 'ACTIVE', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const duplicate = await uploadAssetEvidence({
      businessId: business.id,
      name: 'same-content-again.pdf',
      mime: 'application/pdf',
      content: Buffer.from('%PDF-1.7\nreceipt'),
    }, { viewer: owner, objectStoragePort })
    expect(duplicate.id).toBe(file.id)
    expect(objectStoragePort.put).toHaveBeenCalledTimes(1)
    const photo = await uploadAssetEvidence({
      businessId: business.id,
      name: 'asset-photo.jpg',
      mime: 'image/jpeg',
      content: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    }, { viewer: owner, objectStoragePort })
    expect(photo).toMatchObject({ mime: 'image/jpeg', status: 'ACTIVE' })
    expect(objectStoragePort.put).toHaveBeenCalledTimes(2)

    const envelope = {
      schemaVersion: '1.0', source: { channel: 'WEB', correlationId: 'integration-receipt-1' },
      businessId: business.id, origin: 'PROCUREMENT_PURCHASE',
      item: { name: 'Notebook', categoryCode: 'IT', quantity: 1, expiryControlled: false },
      evidence: [
        { fileAssetId: photo.id, role: 'ASSET_PHOTO' },
        { fileAssetId: file.id, role: 'PAYMENT_PROOF' },
      ],
      procurementRefs: [{ type: 'PR', system: 'ERP', value: 'PR-E-1' }, { type: 'PO', system: 'ERP', value: 'PO-E-1' }],
      lot: null, responsibilities: [], location: null, projectAllocation: null, depreciation: null,
    }
    const created = await upsertAssetIntake(envelope, { viewer: owner })
    expect(created).toMatchObject({ replayed: false, validation: { ok: true }, intake: { status: 'NEEDS_REVIEW' } })
    expect(created.intake.evidence).toHaveLength(2)
    expect(created.intake.procurementRefs).toHaveLength(2)

    const replay = await upsertAssetIntake(envelope, { viewer: owner })
    expect(replay).toMatchObject({ replayed: true, intake: { id: created.intake.id } })
    expect(await prisma.assetIntake.count({ where: { sourceCorrelationId: 'integration-receipt-1' } })).toBe(1)

    const photoEvidence = created.intake.evidence.find((item) => item.role === 'ASSET_PHOTO')
    const paymentEvidence = created.intake.evidence.find((item) => item.role === 'PAYMENT_PROOF')
    const photoReviewed = await reviewAssetEvidence(photoEvidence.id, {
      decision: 'ACCEPT', corrections: [], note: 'Matched physical Asset',
    }, { viewer: owner })
    expect(photoReviewed).toMatchObject({ evidence: { status: 'REVIEWED' }, intakeStatus: 'NEEDS_REVIEW' })

    const reviewed = await reviewAssetEvidence(paymentEvidence.id, {
      decision: 'ACCEPT', corrections: [], note: 'Matched source document',
    }, { viewer: owner })
    expect(reviewed).toMatchObject({ evidence: { status: 'REVIEWED' }, intakeStatus: 'READY_FOR_REGISTRATION' })
    expect(await prisma.auditEvent.count({ where: { entityId: created.intake.id } })).toBeGreaterThan(0)
  })

  it('refuses a visible but unowned Business without creating an intake', async () => {
    const before = await prisma.assetIntake.count({ where: { businessId: business.id } })
    await expect(upsertAssetIntake({ businessId: business.id }, { viewer: attacker })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.assetIntake.count({ where: { businessId: business.id } })).toBe(before)
  })
})
