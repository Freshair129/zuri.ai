// @req FR-186 — real SQLite coverage for owner billing configuration,
// Business/LegalEntity/Branch seller resolution, explicit buyer snapshots,
// exact VAT, configured PromptPay, non-persistent preview, durable issuance
// and idempotency conflict protection.
// @spec ADR-065; BR-001; BR-002; SEC-001; ZAI:PROPOSAL-COMMERCE-BILLING-POS-20260910
// @tested tests/integration/fr186-billing.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createBranch, createLegalEntity, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createOrder } from '@/modules/commerce/application/sales-order-service'
import { applyPaymentAction, recordPayment } from '@/modules/commerce/application/payment-service'
import { getBillingDocument, getBillingProfile, issueBillingDocument, previewBillingDocument, updateBillingProfile } from '@/modules/commerce/application/billing-invoice-service'
import { exportSnapshot, importSnapshot, previewImport, previewSnapshot } from '@/modules/project-manager/application/backup-service'
import { makeOperatorViewer } from '../factories/viewer'

const NOW = new Date('2026-09-06T03:00:00Z')
const DOMAINS = ['projects', 'platform', 'commerce']
let tenant, business, otherBusiness, legalEntity, taxRegistrationBranch, branch, owner, member, order

describe('FR-186 durable Commerce billing documents', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-FR186', name: 'Billing Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR186', name: 'Billing Tenant' })
    // @req FR-194 — LegalEntity is Tenant-scoped (ADR-078 D1); TaxRegistrationBranch
    // is the legal entity's own VAT branch registration, linked onto the Branch.
    legalEntity = await createLegalEntity({
      tenantId: tenant.id,
      code: 'LE-FR186',
      legalName: 'Billing Fixture Co., Ltd.',
      identifiers: [{ country: 'TH', type: 'TH_TAX_ID', value: '0105560000000' }],
    })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR186', name: 'Billing Fixture', legalEntityId: legalEntity.id })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR186-OTHER', name: 'Other Billing Fixture' })
    branch = await createBranch({ tenantId: tenant.id, businessId: business.id, code: 'BR-FR186', name: 'Head Office' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS, principal: { id: 'per-fr186-owner', code: 'PER-FR186-OWNER', displayName: 'Billing Owner' } })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    await prisma.legalEntity.update({ where: { id: legalEntity.id }, data: { legalAddress: '99 Fixture Road, Bangkok' } })
    await prisma.legalEntityIdentifier.updateMany({ where: { legalEntityId: legalEntity.id }, data: { verifiedAt: new Date('2026-01-02T00:00:00Z') } })
    taxRegistrationBranch = await prisma.taxRegistrationBranch.create({ data: { legalEntityId: legalEntity.id, branchCode: '00000', name: 'Head Office', address: '99 Fixture Road, Bangkok' } })
    await prisma.branch.update({ where: { id: branch.id }, data: { address: '99 Fixture Road, Bangkok', taxRegistrationBranchId: taxRegistrationBranch.id } })
    order = await createOrder({ businessId: business.id, lines: [{ description: 'Fixture item', qty: 1, unitPrice: 107 }] }, { viewer: owner, now: NOW })
  })

  const buyer = () => ({ source: 'ISSUANCE_INPUT', name: 'Buyer Co., Ltd.', taxId: '0105555555555', branchCode: '00000', address: '1 Buyer Road, Bangkok' })

  it('keeps profile unavailable until the owner configures authoritative issuer and tax/recipient values', async () => {
    expect((await getBillingProfile(business.id, { viewer: member })).status).toBe('UNAVAILABLE')
    await expect(updateBillingProfile(business.id, { legalAddress: '99 Fixture Road, Bangkok', branchId: branch.id, branchAddress: '99 Fixture Road, Bangkok', taxRegistrationBranchId: taxRegistrationBranch.id }, { viewer: member })).rejects.toMatchObject({ status: 404 })
    await updateBillingProfile(business.id, { vatRegistered: false, nonVatDocumentPolicy: null, walkInDocumentPolicy: 'ALLOW_ANONYMOUS_RECEIPT' }, { viewer: owner })
    await expect(previewBillingDocument({ orderId: order.id, branchId: branch.id, documentType: 'RECEIPT', buyer: { source: 'ANONYMOUS_WALK_IN' } }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422, message: 'BILLING_NON_VAT_POLICY_NOT_CONFIGURED' })
    const configured = await updateBillingProfile(business.id, {
      legalAddress: '99 Fixture Road, Bangkok',
      branchId: branch.id,
      branchAddress: '99 Fixture Road, Bangkok',
      taxRegistrationBranchId: taxRegistrationBranch.id,
      vatRegistered: true,
      vatRateBps: 700,
      vatTreatment: 'INCLUSIVE',
      taxPolicyVersion: 'TH-VAT-FIXTURE-1',
      taxEffectiveAt: '2026-01-01T00:00:00Z',
      taxVerifiedAt: '2026-01-02T00:00:00Z',
      nonVatDocumentPolicy: 'ALLOW_INVOICE_RECEIPT',
      walkInDocumentPolicy: 'ALLOW_ANONYMOUS_RECEIPT',
      promptPayProvider: 'PROMPTPAY',
      promptPayTargetType: 'MOBILE',
      promptPayTarget: '0812345678',
      promptPayActive: true,
      promptPayVerifiedAt: '2026-01-02T00:00:00Z',
    }, { viewer: owner })
    expect(configured).toMatchObject({ businessId: business.id, status: 'CONFIGURED', profile: { vatRateBps: 700, promptPayTarget: '0066812345678', version: 2 } })
    expect((await getBillingProfile(business.id, { viewer: member })).status).toBe('CONFIGURED')

    await prisma.business.update({ where: { id: otherBusiness.id }, data: { legalEntityId: legalEntity.id } })
    await expect(updateBillingProfile(business.id, { legalAddress: 'A different address' }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'BILLING_SHARED_LEGAL_ENTITY' })
    expect((await prisma.legalEntity.findUnique({ where: { id: legalEntity.id }, select: { legalAddress: true } })).legalAddress).toBe('99 Fixture Road, Bangkok')
    await prisma.business.update({ where: { id: otherBusiness.id }, data: { legalEntityId: null } })
  })

  it('requires a versioned effective VAT policy before issuance', async () => {
    await updateBillingProfile(business.id, { taxPolicyVersion: null, taxEffectiveAt: null }, { viewer: owner })
    expect((await getBillingProfile(business.id, { viewer: member })).status).toBe('UNAVAILABLE')
    await expect(previewBillingDocument({ orderId: order.id, branchId: branch.id, documentType: 'TAX_INVOICE', buyer: buyer() }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422, message: 'BILLING_TAX_NOT_CONFIGURED' })
    await updateBillingProfile(business.id, { taxPolicyVersion: 'TH-VAT-FIXTURE-1', taxEffectiveAt: '2026-01-01T00:00:00Z' }, { viewer: owner })
  })

  it('previews without persistence, then issues an immutable VAT snapshot with configured PromptPay', async () => {
    const beforeDocs = await prisma.commerceDocument.count({ where: { businessId: business.id } })
    const beforeAudit = await prisma.auditEvent.count({ where: { entityType: 'COMMERCE_DOCUMENT', entityId: order.id } })
    const preview = await previewBillingDocument({ orderId: order.id, branchId: branch.id, documentType: 'TAX_INVOICE', buyer: buyer(), includePromptPay: true }, { viewer: owner, now: NOW })
    expect(preview).toMatchObject({ id: null, status: 'PREVIEW', documentNumber: null, issuedAt: null, tax: { netSatang: 10000, vatSatang: 700, grossSatang: 10700 }, promptPay: { provider: 'PROMPTPAY', amountSatang: 10700 } })
    expect(await prisma.commerceDocument.count({ where: { businessId: business.id } })).toBe(beforeDocs)
    expect(await prisma.auditEvent.count({ where: { entityType: 'COMMERCE_DOCUMENT', entityId: order.id } })).toBe(beforeAudit)
    const issued = await issueBillingDocument({ orderId: order.id, branchId: branch.id, documentType: 'TAX_INVOICE', idempotencyKey: 'fr186-doc-1', buyer: buyer(), includePromptPay: true }, { viewer: owner, now: NOW })
    expect(issued).toMatchObject({ businessId: business.id, orderId: order.id, documentType: 'TAX_INVOICE', documentNumber: 'TAX-2026-000001', status: 'ISSUED', snapshot: { tax: { netSatang: 10000, vatSatang: 700, grossSatang: 10700 }, seller: { taxId: '0105560000000', branch: { id: branch.id, taxBranchCode: '00000' } }, buyer: { source: 'ISSUANCE_INPUT', taxId: '0105555555555' } } })
    expect(issued.snapshot.promptPay.payload).toMatch(/[0-9A-F]{4}$/)
    expect((await prisma.commerceDocument.count({ where: { businessId: business.id } }))).toBe(beforeDocs + 1)
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'COMMERCE_DOCUMENT', entityId: issued.id } })
    expect(audits.map((row) => row.action)).toEqual(['COMMERCE_DOCUMENT_ISSUED'])
    expect(await getBillingDocument(issued.id, { viewer: member })).toMatchObject({ id: issued.id, documentNumber: issued.documentNumber, snapshot: { order: { id: order.id } } })
    await expect(prisma.salesOrder.delete({ where: { id: order.id } })).rejects.toMatchObject({ code: 'P2003' })
    expect(await prisma.commerceDocument.findUnique({ where: { id: issued.id }, select: { id: true } })).toEqual({ id: issued.id })
    await expect(prisma.business.delete({ where: { id: business.id } })).rejects.toMatchObject({ code: 'P2003' })
    expect(await prisma.commerceDocument.findUnique({ where: { id: issued.id }, select: { id: true } })).toEqual({ id: issued.id })
  })

  it('returns the same immutable document for an identical retry and rejects a changed request hash', async () => {
    const input = { orderId: order.id, branchId: branch.id, documentType: 'RECEIPT', idempotencyKey: 'fr186-receipt-1', buyer: { source: 'ANONYMOUS_WALK_IN' } }
    const preview = await previewBillingDocument({ ...input, idempotencyKey: undefined }, { viewer: owner, now: NOW })
    expect(preview).toMatchObject({ status: 'PREVIEW', snapshot: { order: { paymentState: 'UNPAID' } } })
    await expect(issueBillingDocument(input, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422, message: 'BILLING_RECEIPT_PAYMENT_NOT_VERIFIED' })
    const payment = await recordPayment(order.id, { method: 'CASH', amount: 107 }, { viewer: owner, now: NOW })
    await applyPaymentAction(payment.id, { action: 'VERIFY', version: payment.version, selfVerifyAttested: true }, { viewer: owner, now: NOW })
    const first = await issueBillingDocument(input, { viewer: owner, now: NOW })
    const second = await issueBillingDocument(input, { viewer: owner, now: new Date('2027-01-01T00:00:00Z') })
    expect(second).toMatchObject({ id: first.id, documentNumber: first.documentNumber, issuedAt: first.issuedAt })
    await expect(issueBillingDocument({ ...input, documentType: 'INVOICE' }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 409, message: 'BILLING_IDEMPOTENCY_CONFLICT' })
    await expect(issueBillingDocument({ ...input, branchId: 'foreign-branch' }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 409, message: 'BILLING_IDEMPOTENCY_CONFLICT' })
  })

  it('uses document gross for exclusive VAT due and PromptPay without changing the order total', async () => {
    const exclusiveOrder = await createOrder({ businessId: business.id, lines: [{ description: 'Exclusive fixture', qty: 1, unitPrice: 100 }] }, { viewer: owner, now: NOW })
    await updateBillingProfile(business.id, { vatTreatment: 'EXCLUSIVE' }, { viewer: owner })
    const preview = await previewBillingDocument({ orderId: exclusiveOrder.id, branchId: branch.id, documentType: 'TAX_INVOICE', buyer: buyer(), includePromptPay: true }, { viewer: owner, now: NOW })
    expect(preview.tax).toMatchObject({ netSatang: 10000, vatSatang: 700, grossSatang: 10700 })
    expect(preview.promptPay).toMatchObject({ amountSatang: 10700 })
    expect(preview.snapshot.order).toMatchObject({ totalSatang: 10000, documentGrossSatang: 10700, balanceDueSatang: 10700, paymentState: 'UNPAID' })
    await updateBillingProfile(business.id, { vatTreatment: 'INCLUSIVE' }, { viewer: owner })

    const partialOrder = await createOrder({ businessId: business.id, lines: [{ description: 'Partial fixture', qty: 1, unitPrice: 107 }] }, { viewer: owner, now: NOW })
    const partialPayment = await recordPayment(partialOrder.id, { method: 'CASH', amount: 50 }, { viewer: owner, now: NOW })
    await applyPaymentAction(partialPayment.id, { action: 'VERIFY', version: partialPayment.version, selfVerifyAttested: true }, { viewer: owner, now: NOW })
    const partial = await previewBillingDocument({ orderId: partialOrder.id, branchId: branch.id, documentType: 'TAX_INVOICE', buyer: buyer(), includePromptPay: true }, { viewer: owner, now: NOW })
    expect(partial).toMatchObject({ promptPay: { amountSatang: 5700 }, snapshot: { order: { paymentState: 'PARTIAL', balanceDueSatang: 5700 } } })
    expect(partial.promptPay.payload).toContain('540557.00')
  })

  it('refuses non-THB source orders without FX conversion or writes', async () => {
    const usdOrder = await createOrder({ businessId: business.id, currency: 'USD', lines: [{ description: 'Unsupported currency fixture', qty: 1, unitPrice: 100 }] }, { viewer: owner, now: NOW })
    await expect(previewBillingDocument({ orderId: usdOrder.id, branchId: branch.id, documentType: 'TAX_INVOICE', buyer: buyer() }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422, message: 'BILLING_CURRENCY_UNSUPPORTED' })
    await expect(issueBillingDocument({ orderId: usdOrder.id, branchId: branch.id, documentType: 'TAX_INVOICE', idempotencyKey: 'fr186-usd-order', buyer: buyer() }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422, message: 'BILLING_CURRENCY_UNSUPPORTED' })
    expect(await prisma.commerceDocument.count({ where: { orderId: usdOrder.id } })).toBe(0)
  })

  it('allocates unique durable numbers under concurrent issuance and converges same-key retries', async () => {
    const issue = (idempotencyKey, documentType = 'TAX_INVOICE') => issueBillingDocument({
      orderId: order.id,
      branchId: branch.id,
      documentType,
      idempotencyKey,
      buyer: buyer(),
    }, { viewer: owner, now: NOW })

    const [first, second] = await Promise.all([
      issue('fr186-concurrent-a'),
      issue('fr186-concurrent-b'),
    ])
    expect(first.id).not.toBe(second.id)
    expect(first.documentNumber).not.toBe(second.documentNumber)
    expect(new Set([first.sequenceNumber, second.sequenceNumber]).size).toBe(2)
    const sequenceRows = await prisma.commerceDocumentSequence.findMany({
      where: { businessId: business.id, documentType: 'TAX_INVOICE', calendarYear: 2026 },
    })
    expect(sequenceRows).toHaveLength(1)
    expect(sequenceRows[0].lastSequence).toBe(Math.max(first.sequenceNumber, second.sequenceNumber))

    const sameInput = {
      orderId: order.id,
      branchId: branch.id,
      documentType: 'ABB_TAX_INVOICE',
      idempotencyKey: 'fr186-concurrent-same',
      buyer: buyer(),
    }
    const same = await Promise.all([
      issueBillingDocument(sameInput, { viewer: owner, now: NOW }),
      issueBillingDocument(sameInput, { viewer: owner, now: NOW }),
    ])
    expect(same[0].id).toBe(same[1].id)
    expect(await prisma.commerceDocument.count({ where: { businessId: business.id, idempotencyKey: sameInput.idempotencyKey } })).toBe(1)
  })

  it('exports and restores billing evidence, then continues the document sequence', async () => {
    const issued = await issueBillingDocument({
      orderId: order.id,
      branchId: branch.id,
      documentType: 'ABB_TAX_INVOICE',
      idempotencyKey: 'fr186-backup-1',
      buyer: buyer(),
    }, { viewer: owner, now: NOW })
    const snapshot = await exportSnapshot()
    const snapshotProfile = snapshot.tables.businessBillingProfile.find((row) => row.businessId === business.id)
    const snapshotSequence = snapshot.tables.commerceDocumentSequence.find((row) => row.businessId === business.id && row.documentType === 'ABB_TAX_INVOICE' && row.calendarYear === 2026)
    const snapshotDocument = snapshot.tables.commerceDocument.find((row) => row.id === issued.id)
    expect(snapshotProfile).toMatchObject({ businessId: business.id, taxPolicyVersion: 'TH-VAT-FIXTURE-1' })
    expect(snapshot.commerceBillingRecovery).toMatchObject({ schemaVersion: 'commerce-billing-recovery.v1', requiredTables: ['businessBillingProfile', 'commerceDocumentSequence', 'commerceDocument'] })
    expect(snapshotSequence).toMatchObject({ lastSequence: issued.sequenceNumber })
    expect(snapshotDocument).toMatchObject({ documentNumber: issued.documentNumber, requestHash: issued.requestHash })

    const legacy = structuredClone(snapshot)
    delete legacy.tables.businessBillingProfile
    delete legacy.commerceBillingRecovery
    expect(previewSnapshot(legacy).valid).toBe(true)
    const unavailable = await previewImport(legacy, { viewer: makeOperatorViewer() })
    expect(unavailable).toMatchObject({ valid: false, billingRecovery: { status: 'UNAVAILABLE' } })
    expect(unavailable.errors).toContain('Commerce billing recovery is unavailable while the installation contains billing rows; refusing a restore that would erase evidence')

    const inconsistent = structuredClone(snapshot)
    inconsistent.tables.commerceDocument.find((row) => row.id === issued.id).businessId = otherBusiness.id
    const inconsistentPreview = await previewImport(inconsistent, { viewer: makeOperatorViewer() })
    expect(inconsistentPreview.valid).toBe(false)
    expect(inconsistentPreview.errors).toContain(`Commerce document ${issued.id} has an inconsistent SalesOrder reference`)

    const behindSequence = structuredClone(snapshot)
    behindSequence.tables.commerceDocumentSequence.find((row) => row.id === snapshotSequence.id).lastSequence = issued.sequenceNumber - 1
    const behindPreview = await previewImport(behindSequence, { viewer: makeOperatorViewer() })
    expect(behindPreview.valid).toBe(false)
    expect(behindPreview.errors).toContain(`Commerce document ${issued.id} exceeds its restored sequence counter`)

    const malformedRows = [
      ['profile version', (candidate) => { candidate.tables.businessBillingProfile[0].version = 0 }, 'Commerce billing profile ' + snapshotProfile.id + ' has an invalid version'],
      ['profile policy enum', (candidate) => { candidate.tables.businessBillingProfile[0].nonVatDocumentPolicy = 'UNSUPPORTED' }, 'Commerce billing profile ' + snapshotProfile.id + ' has an invalid non-VAT policy'],
      ['sequence document type', (candidate) => { candidate.tables.commerceDocumentSequence.find((row) => row.id === snapshotSequence.id).documentType = 'UNSUPPORTED' }, 'Commerce billing sequence ' + snapshotSequence.id + ' has an invalid documentType'],
      ['sequence calendar year', (candidate) => { candidate.tables.commerceDocumentSequence.find((row) => row.id === snapshotSequence.id).calendarYear = 0 }, 'Commerce billing sequence ' + snapshotSequence.id + ' has an invalid calendarYear'],
      ['document status', (candidate) => { candidate.tables.commerceDocument.find((row) => row.id === issued.id).status = 'VOIDED' }, 'Commerce document ' + issued.id + ' has an invalid status'],
      ['document snapshot', (candidate) => { candidate.tables.commerceDocument.find((row) => row.id === issued.id).snapshotJson = '{not-json' }, 'Commerce document ' + issued.id + ' has an invalid snapshotJson'],
    ]
    for (const [label, mutate, expected] of malformedRows) {
      const malformed = structuredClone(snapshot)
      mutate(malformed)
      const malformedPreview = await previewImport(malformed, { viewer: makeOperatorViewer() })
      expect(malformedPreview.valid, label).toBe(false)
      expect(malformedPreview.errors, label).toContain(expected)
    }

    await prisma.businessBillingProfile.update({ where: { businessId: business.id }, data: { taxPolicyVersion: 'MUTATED_BEFORE_RESTORE' } })
    await prisma.commerceDocument.delete({ where: { id: issued.id } })
    await prisma.commerceDocumentSequence.update({ where: { id: snapshotSequence.id }, data: { lastSequence: 0 } })
    await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })

    expect(await prisma.businessBillingProfile.findUnique({ where: { businessId: business.id }, select: { taxPolicyVersion: true } })).toMatchObject({ taxPolicyVersion: 'TH-VAT-FIXTURE-1' })
    const restored = await prisma.commerceDocument.findUnique({ where: { id: issued.id } })
    expect(restored).toMatchObject({ documentNumber: issued.documentNumber, requestHash: issued.requestHash })
    const next = await issueBillingDocument({
      orderId: order.id,
      branchId: branch.id,
      documentType: 'ABB_TAX_INVOICE',
      idempotencyKey: 'fr186-backup-2',
      buyer: buyer(),
    }, { viewer: owner, now: NOW })
    expect(next.sequenceNumber).toBe(issued.sequenceNumber + 1)
  })

  it('enforces explicit buyer, walk-in and cross-scope branch rules without writes', async () => {
    await expect(previewBillingDocument({ orderId: order.id, branchId: branch.id, documentType: 'TAX_INVOICE', buyer: { source: 'ISSUANCE_INPUT', name: 'Missing tax data', branchCode: '00000', address: 'x' } }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422, message: 'BILLING_BUYER_DATA_INVALID' })
    await expect(previewBillingDocument({ orderId: order.id, branchId: branch.id, documentType: 'TAX_INVOICE', buyer: { source: 'ANONYMOUS_WALK_IN' } }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422, message: 'BILLING_WALK_IN_RECEIPT_ONLY' })
    await expect(previewBillingDocument({ orderId: order.id, branchId: 'no-such-branch', documentType: 'RECEIPT', buyer: { source: 'ANONYMOUS_WALK_IN' } }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422, message: 'BILLING_BRANCH_NOT_CONFIGURED' })
    await expect(issueBillingDocument({ orderId: order.id, branchId: branch.id, documentType: 'RECEIPT', idempotencyKey: 'fr186-missing-buyer', buyer: { source: 'ISSUANCE_INPUT', name: 'x', taxId: 'bad', branchCode: '00000', address: 'x' } }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 422 })
    await expect(getBillingDocument('no-such-document', { viewer: owner })).rejects.toMatchObject({ status: 404 })
    expect(otherBusiness.id).toBeTruthy()
  })
})
