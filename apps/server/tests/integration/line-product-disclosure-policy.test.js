import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { createIntegrationConnection, registerIntegrationProvider, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { disclosureLookupHash } from '@/modules/knowledge/line-product-disclosure-contract'
import {
  SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_PROVIDER,
  smartGiftSourceKey,
} from '@/modules/knowledge/smartgift-catalog-adapter'
import {
  listLineProductDisclosure,
  previewLineProductDisclosure,
  setLineProductDisclosure,
  withdrawLineProductDisclosure,
} from '@/modules/knowledge/line-product-disclosure-service'

const sourceMock = vi.hoisted(() => ({ resolve: vi.fn(), readManifest: vi.fn() }))
vi.mock('@/modules/knowledge/line-product-disclosure-source', () => ({
  resolveLineProductDisclosureSource: sourceMock.resolve,
}))
vi.mock('@/modules/knowledge/knowledge-corpus-service', () => ({
  readAuthorizedKnowledgeManifest: sourceMock.readManifest,
}))

const DOMAINS = ['line-oa', 'inventory']
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const IS_POSTGRES = /^(postgres|postgresql):/i.test(process.env.DATABASE_URL ?? '')
const SEND_SEAL_KEY = '6e'.repeat(32)

let portfolio, tenant, business, otherBusiness, account, category, master, product, source
let owner, publisher, member, ownerElsewhere
let generation = 1
let sourceAvailable = true
let sendingJobIds = []

function input(over = {}) {
  return {
    businessId: business.id,
    accountId: account.id,
    productId: product.id,
    sourceId: source.id,
    fields: ['sku', 'nameTh'],
    ...over,
  }
}

function mockResolvedSource({ db = prisma, fields, sourceId, productId }) {
  const valuesByField = {
    sku: product.code,
    nameTh: master.nameTh,
    nameEn: master.nameEn,
    unit: product.unit,
    category: 'ตัวอย่าง',
    productFamily: null,
    dimensionsCm: null,
    unitWeightKg: null,
  }
  const values = fields.flatMap((field) => valuesByField[field] == null ? [] : [{ field, value: valuesByField[field] }])
  const binding = {
    schema: 'zuri.line-product-disclosure.binding.test.v1',
    sourceId,
    productId,
    manifestGeneration: generation,
    recordIndex: 0,
    recordCount: 1,
    assetSha256: 'a'.repeat(64),
  }
  return {
    values,
    binding,
    projectionSha256: sha256(JSON.stringify({ binding, values })),
    retrievalRef: { sourceId, ingestionId: `ing-${generation}` },
  }
}

async function admitExpiredSendingJob() {
  const suffix = randomUUID()
  const now = new Date()
  const currentAccount = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const admitted = await admitLineConversation({ db: prisma, account: currentAccount,
    env: { ZURI_LINE_REPLY_SEAL_KEY: SEND_SEAL_KEY }, correlationId: `lpd-${suffix}`, now, ingressReceivedAt: now,
    event: { type: 'message', webhookEventId: `event-${suffix}`, replyToken: `reply-${suffix}`, timestamp: now.getTime(),
      source: { type: 'user', userId: `user-${suffix}` },
      message: { type: 'text', id: `message-${suffix}`, text: 'Hello' } } })
  if (!admitted.jobId) throw new Error('LINE_DISCLOSURE_SENDING_JOB_NOT_ADMITTED')
  const job = await prisma.lineConversationJob.update({ where: { id: admitted.jobId }, data: {
    status: 'SENDING', sendMethod: 'REPLY', firstSendAt: new Date(now.getTime() - 1000),
    claimantId: `claim-${suffix}`, leaseExpiresAt: new Date(0), version: { increment: 1 },
  } })
  sendingJobIds.push(job.id)
  return job
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function signalAccountFence(db, signal) {
  const instrumentTransaction = (tx) => new Proxy(tx, { get(target, property) {
    if (property === 'lineOaAccount') {
      const delegate = target.lineOaAccount
      return new Proxy(delegate, { get(accountDelegate, method) {
        const value = Reflect.get(accountDelegate, method, accountDelegate)
        if (method === 'updateMany') return (...args) => {
          signal.resolve()
          return value.apply(accountDelegate, args)
        }
        return typeof value === 'function' ? value.bind(accountDelegate) : value
      } })
    }
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return new Proxy(db, { get(target, property) {
    if (property === '$transaction') return (callback, ...args) => target.$transaction(
      (tx) => callback(instrumentTransaction(tx)), ...args)
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  portfolio = await createPortfolio({ code: `PF-LPD-${suffix}`, name: 'LINE product disclosure' })
  tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-LPD-${suffix}`, name: 'LINE disclosure tenant' })
  business = await createBusiness({ tenantId: tenant.id, code: `BUS-LPD-${suffix}`, name: 'LINE disclosure business' })
  otherBusiness = await createBusiness({ tenantId: tenant.id, code: `BUS-LPD-X-${suffix}`, name: 'Other LINE business' })

  owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS,
    principal: { id: `per-lpd-owner-${suffix}`, code: `PER-LPD-OWNER-${suffix}`, displayName: 'Disclosure Owner' } })
  publisher = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS,
    principal: { id: `per-lpd-publisher-${suffix}`, code: `PER-LPD-PUBLISHER-${suffix}`, displayName: 'LINE Publisher' } })
  member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS,
    principal: { id: `per-lpd-member-${suffix}`, code: `PER-LPD-MEMBER-${suffix}`, displayName: 'Business Member' } })
  ownerElsewhere = ownsElsewhere({ owns: otherBusiness.id, sees: business.id, seesDomains: DOMAINS, visibleDomains: DOMAINS,
    principal: { id: `per-lpd-foreign-${suffix}`, code: `PER-LPD-FOREIGN-${suffix}`, displayName: 'Other Business Owner' } })

  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `LINE disclosure ${suffix}`, externalAccountId: `U-LPD-${suffix}`, status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: `LINE-LPD-${suffix}`, bindingCode: `LINE-LPD-${suffix}`,
    displayName: 'Disclosure account', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD' } })
  category = await createCategory({ businessId: business.id, code: `LPD-CAT-${suffix}`, nameTh: 'ตัวอย่าง', nameEn: 'Example' }, { viewer: owner })
  master = await createProductMaster({ businessId: business.id, code: `LPD-M-${suffix}`, categoryId: category.id,
    nameTh: 'ชื่อสินค้าสำหรับทดสอบ', nameEn: 'Disclosure test product' }, { viewer: owner })
  product = await createProduct({ businessId: business.id, productMasterId: master.id,
    code: `LPD-SKU-${suffix}`, name: 'ชื่อสินค้าสำหรับทดสอบ', unit: 'EA' }, { viewer: owner })

  const corpus = await prisma.knowledgeCorpus.create({ data: { corpusKey: `lpd-${suffix}`, portfolioId: portfolio.id,
    tenantId: tenant.id, businessId: business.id, workspaceId: '',
    scopeJson: JSON.stringify({ portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id,
      workspaceId: '', agentId: '', visibility: 'private' }),
    policyJson: '{"allowEmbedding":true,"allowPublication":true}', status: 'ACTIVE' } })
  source = await prisma.knowledgeSource.create({ data: { corpusId: corpus.id, sourceKey: `lpd-${suffix}`,
    kind: 'FILE', title: 'Published product master', activeIngestionId: `ing-${suffix}` } })
})

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY' } })
  await prisma.lineProductDisclosurePolicy.deleteMany({ where: { businessId: business.id } })
  generation = 1
  sourceAvailable = true
  sourceMock.resolve.mockImplementation(async (request, options = {}) => {
    if (!sourceAvailable) throw Object.assign(new Error('Current source is unavailable'), { status: 409, code: 'LINE_PRODUCT_DISCLOSURE_SOURCE_STALE' })
    return mockResolvedSource({ db: options.db, fields: request.fields, sourceId: request.sourceId, productId: request.productId })
  })
  sourceMock.readManifest.mockResolvedValue({
    corpusId: 'empty-corpus',
    scope: { tenantId: tenant.id, businessId: business.id },
    entries: [],
  })
})

afterEach(async () => {
  if (sendingJobIds.length) {
    await prisma.lineConversationJob.updateMany({ where: { id: { in: [...sendingJobIds] }, status: { in: ['SENDING', 'UNKNOWN', 'READY'] } },
      data: { status: 'CANCELLED', errorCode: 'TEST_DISCLOSURE_DONE', claimantId: null, leaseExpiresAt: null,
        sealedReplyToken: null, version: { increment: 1 } } })
    sendingJobIds = []
  }
  generation = 1
  sourceAvailable = true
})

describe('LINE customer product disclosure policy', () => {
  it('requires Business ownership and current line-oa domain visibility for preview and approval', async () => {
    await expect(previewLineProductDisclosure(input(), { viewer: publisher, db: prisma })).rejects.toMatchObject({ status: 404 })
    await expect(previewLineProductDisclosure(input(), { viewer: member, db: prisma })).rejects.toMatchObject({ status: 404 })
    await expect(previewLineProductDisclosure(input(), { viewer: ownerElsewhere, db: prisma })).rejects.toMatchObject({ status: 404 })
    const noLineDomain = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
      visibleDomains: ['inventory'], principal: owner.principal })
    await expect(previewLineProductDisclosure(input(), { viewer: noLineDomain, db: prisma })).rejects.toMatchObject({ status: 404 })
  })

  it('previews exact selected values and atomically stores the scoped approval, hashes, and audit', async () => {
    const preview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    expect(preview).toMatchObject({ expectedVersion: 0, values: [
      { field: 'sku', value: product.code }, { field: 'nameTh', value: master.nameTh },
    ] })
    expect(preview.exampleText).toContain(product.code)
    expect(preview.exampleText).toContain(master.nameTh)

    const row = await setLineProductDisclosure({ ...input(), expectedVersion: preview.expectedVersion,
      previewHash: preview.previewHash, reason: 'Owner approved the selected public product facts' }, { viewer: owner, db: prisma })
    expect(row).toMatchObject({ tenantId: tenant.id, businessId: business.id, lineOaAccountId: account.id,
      productId: product.id, sourceId: source.id, enabled: true, version: 1, approvedByPersonId: owner.principal.id,
      skuLookupSha256: expect.stringMatching(/^[0-9a-f]{64}$/), nameThLookupSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      nameEnLookupSha256: null })
    expect(row.skuLookupSha256).toBe(disclosureLookupHash(product.code))
    expect(row.nameThLookupSha256).toBe(disclosureLookupHash(master.nameTh))
    expect(JSON.parse(row.fieldsJson)).toEqual(['sku', 'nameTh'])
    expect(JSON.parse(row.sourceBindingJson)).toMatchObject({ sourceId: source.id, productId: product.id })
    expect(row.sourceBindingJson).not.toContain(master.nameTh)
    expect(await prisma.lineProductDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: tenant.id, businessId: business.id, lineOaAccountId: account.id, productId: product.id,
    } } })).toMatchObject({ id: row.id, version: 1 })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY', entityId: row.id } })
    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe('LINE_PRODUCT_DISCLOSURE_APPROVED')
    expect(audits[0].payloadJson).not.toContain(master.nameTh)
    expect(audits[0].payloadJson).not.toContain(product.code)
  })

  it('reports a selected optional field with a null value as unavailable', async () => {
    sourceMock.resolve.mockImplementationOnce(async (request, options = {}) => {
      const resolved = mockResolvedSource({ db: options.db, fields: request.fields, sourceId: request.sourceId,
        productId: request.productId })
      resolved.values.push({ field: 'productFamily', value: null })
      return resolved
    })
    await expect(previewLineProductDisclosure(input({ fields: ['sku', 'productFamily'] }), { viewer: owner, db: prisma }))
      .rejects.toMatchObject({ status: 422, code: 'LINE_PRODUCT_DISCLOSURE_FIELD_UNAVAILABLE' })
    expect(await prisma.lineProductDisclosurePolicy.count({ where: { businessId: business.id } })).toBe(0)
  })

  it('rolls the policy back if its atomic audit write fails', async () => {
    const preview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    try {
      if (IS_POSTGRES) {
        await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION reject_line_product_disclosure_audit_fn() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN
            IF NEW."action" = 'LINE_PRODUCT_DISCLOSURE_APPROVED' THEN
              RAISE EXCEPTION 'forced audit failure';
            END IF;
            RETURN NEW;
          END; $$`)
        await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_line_product_disclosure_audit
          BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_line_product_disclosure_audit_fn()`)
      } else {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_line_product_disclosure_audit
          BEFORE INSERT ON "AuditEvent"
          WHEN NEW."action" = 'LINE_PRODUCT_DISCLOSURE_APPROVED'
          BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;`)
      }
      await expect(setLineProductDisclosure({ ...input(), expectedVersion: preview.expectedVersion,
        previewHash: preview.previewHash, reason: 'Owner approved the selected public product facts' },
      { viewer: owner, db: prisma })).rejects.toThrow()
      expect(await prisma.lineProductDisclosurePolicy.count({ where: { businessId: business.id } })).toBe(0)
      expect(await prisma.auditEvent.count({ where: { entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY' } })).toBe(0)
    } finally {
      if (IS_POSTGRES) {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_line_product_disclosure_audit ON "AuditEvent"')
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_line_product_disclosure_audit_fn()')
      } else {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_line_product_disclosure_audit')
      }
    }
  })

  it('rejects a changed source projection after preview without writing a policy or audit', async () => {
    const preview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    const before = await prisma.auditEvent.count({ where: { entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY' } })
    generation += 1
    await expect(setLineProductDisclosure({ ...input(), expectedVersion: preview.expectedVersion,
      previewHash: preview.previewHash, reason: 'Approve preview' }, { viewer: owner, db: prisma })).rejects.toMatchObject({ status: 409 })
    expect(await prisma.lineProductDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: tenant.id, businessId: business.id, lineOaAccountId: account.id, productId: product.id,
    } } })).toBeNull()
    expect(await prisma.auditEvent.count({ where: { entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY' } })).toBe(before)
  })

  it('allows exactly one approval when two owners submit the same preview version concurrently', async () => {
    const preview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    const approve = () => setLineProductDisclosure({ ...input(), expectedVersion: preview.expectedVersion,
      previewHash: preview.previewHash, reason: 'Owner approved the same preview' }, { viewer: owner, db: prisma })
    const results = await Promise.allSettled([approve(), approve()])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected').reason).toMatchObject({ status: 409 })
    const row = await prisma.lineProductDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: tenant.id, businessId: business.id, lineOaAccountId: account.id, productId: product.id,
    } } })
    expect(row).toMatchObject({ enabled: true, version: 1 })
    expect(await prisma.auditEvent.count({ where: { entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY', entityId: row.id } })).toBe(1)
  })

  it('withdraws by version even after the source disappears and retains the row while clearing aliases', async () => {
    const preview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    const approved = await setLineProductDisclosure({ ...input(), expectedVersion: 0, previewHash: preview.previewHash,
      reason: 'Owner approved the selected public product facts' }, { viewer: owner, db: prisma })
    sourceAvailable = false
    await prisma.knowledgeSource.delete({ where: { id: source.id } })
    const withdrawn = await withdrawLineProductDisclosure({ businessId: business.id, accountId: account.id,
      productId: product.id, expectedVersion: approved.version, reason: 'Owner withdrew product disclosure' }, { viewer: owner, db: prisma })
    expect(withdrawn).toMatchObject({ id: approved.id, enabled: false, version: approved.version + 1,
      skuLookupSha256: null, nameThLookupSha256: null, nameEnLookupSha256: null })
    expect(await prisma.lineProductDisclosurePolicy.findUnique({ where: { id: approved.id } })).toMatchObject({ enabled: false, version: 2 })
    expect(await prisma.auditEvent.count({ where: { entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY', entityId: approved.id } })).toBe(2)
  })

  it('blocks policy approval and withdrawal while an expired send remains SENDING', async () => {
    const firstPreview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    const approved = await setLineProductDisclosure({ ...input(), expectedVersion: firstPreview.expectedVersion,
      previewHash: firstPreview.previewHash, reason: 'Owner approval' }, { viewer: owner, db: prisma })
    const updatePreview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    const job = await admitExpiredSendingJob()
    expect(job.leaseExpiresAt.getTime()).toBeLessThan(Date.now())
    const accountVersion = (await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).version

    await expect(setLineProductDisclosure({ ...input(), expectedVersion: updatePreview.expectedVersion,
      previewHash: updatePreview.previewHash, reason: 'Refresh approved facts' }, { viewer: owner, db: prisma }))
      .rejects.toMatchObject({ status: 409, code: 'LINE_PRODUCT_DISCLOSURE_SEND_IN_PROGRESS' })
    await expect(withdrawLineProductDisclosure({ businessId: business.id, accountId: account.id,
      productId: product.id, expectedVersion: approved.version, reason: 'Owner withdrew disclosure' }, { viewer: owner, db: prisma }))
      .rejects.toMatchObject({ status: 409, code: 'LINE_PRODUCT_DISCLOSURE_SEND_IN_PROGRESS' })
    for (const status of ['UNKNOWN', 'READY']) {
      await prisma.lineConversationJob.update({ where: { id: job.id }, data: { status, firstSendAt: new Date(),
        version: { increment: 1 } } })
      await expect(withdrawLineProductDisclosure({ businessId: business.id, accountId: account.id,
        productId: product.id, expectedVersion: approved.version, reason: 'Owner withdrew disclosure' }, { viewer: owner, db: prisma }))
        .rejects.toMatchObject({ status: 409, code: 'LINE_PRODUCT_DISCLOSURE_SEND_IN_PROGRESS' })
    }

    expect(await prisma.lineProductDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: tenant.id, businessId: business.id, lineOaAccountId: account.id, productId: product.id,
    } } })).toMatchObject({ id: approved.id, enabled: true, version: approved.version })
    expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).version).toBe(accountVersion)
    expect(await prisma.auditEvent.count({ where: { entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY', entityId: approved.id } })).toBe(1)
  })

  it.skipIf(!IS_POSTGRES)('serializes policy changes against the PostgreSQL send-claim account fence', async () => {
    const firstPreview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    const approved = await setLineProductDisclosure({ ...input(), expectedVersion: firstPreview.expectedVersion,
      previewHash: firstPreview.previewHash, reason: 'Owner approval' }, { viewer: owner, db: prisma })
    const updatePreview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    const job = await admitExpiredSendingJob()
    await prisma.lineConversationJob.update({ where: { id: job.id }, data: { status: 'READY', firstSendAt: null,
      sendMethod: null, claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })

    const sendFenceHeld = deferred()
    const releaseSendFence = deferred()
    const sender = prisma.$transaction(async (tx) => {
      const current = await tx.lineOaAccount.findUnique({ where: { id: account.id }, select: { version: true } })
      const fence = await tx.lineOaAccount.updateMany({ where: { id: account.id, version: current.version },
        data: { version: { increment: 1 } } })
      if (fence.count !== 1) throw new Error('TEST_SEND_ACCOUNT_FENCE_LOST')
      const claimed = await tx.lineConversationJob.updateMany({ where: { id: job.id, status: 'READY' }, data: {
        status: 'SENDING', sendMethod: 'REPLY', firstSendAt: new Date(), leaseExpiresAt: new Date(0),
        claimantId: 'test-send-claim', version: { increment: 1 },
      } })
      if (claimed.count !== 1) throw new Error('TEST_SEND_JOB_CLAIM_LOST')
      sendFenceHeld.resolve()
      await releaseSendFence.promise
    }, { timeout: 15000, maxWait: 5000 })
    const fenceAttempted = deferred()
    let policyMutation
    let policyMutationSettled = false
    try {
      await sendFenceHeld.promise
      policyMutation = setLineProductDisclosure({ ...input(), expectedVersion: updatePreview.expectedVersion,
        previewHash: updatePreview.previewHash, reason: 'Refresh approved facts' },
      { viewer: owner, db: signalAccountFence(prisma, fenceAttempted) })
      policyMutation.then(() => { policyMutationSettled = true }, () => { policyMutationSettled = true })
      await fenceAttempted.promise
      expect(policyMutationSettled).toBe(false)
      releaseSendFence.resolve()
      await sender
      await expect(policyMutation).rejects.toMatchObject({ status: 409, code: 'LINE_PRODUCT_DISCLOSURE_SEND_IN_PROGRESS' })
    } finally {
      releaseSendFence.resolve()
      await Promise.allSettled([sender, policyMutation].filter(Boolean))
    }
    expect(await prisma.lineProductDisclosurePolicy.findUnique({ where: { id: approved.id } }))
      .toMatchObject({ enabled: true, version: approved.version })
  })

  it('lists only bounded scoped candidates and exposes policy fields without source contents', async () => {
    const preview = await previewLineProductDisclosure(input(), { viewer: owner, db: prisma })
    await setLineProductDisclosure({ ...input(), expectedVersion: preview.expectedVersion,
      previewHash: preview.previewHash, reason: 'Owner approval' }, { viewer: owner, db: prisma })
    const result = await listLineProductDisclosure({ businessId: business.id, accountId: account.id, q: product.code }, { viewer: owner, db: prisma })
    expect(result).toMatchObject({ products: [{ id: product.id, code: product.code }], sources: [],
      policies: [{ productId: product.id, sourceId: source.id, fields: ['sku', 'nameTh'], enabled: true, version: 1, stale: false }] })
    expect(result.fields).toEqual(['sku', 'nameTh', 'nameEn', 'unit', 'category', 'productFamily', 'dimensionsCm', 'unitWeightKg'])
    expect(JSON.stringify(result)).not.toContain('sourceBindingJson')
    expect(JSON.stringify(result)).not.toContain('retrievalRef')
  })

  it('finds an old policy after filtering the policy query to searched products', async () => {
    const target = {
      tenantId: tenant.id,
      businessId: business.id,
      lineOaAccountId: account.id,
      productId: product.id,
      sourceId: source.id,
      fieldsJson: '["sku"]',
      sourceBindingJson: '{}',
      projectionSha256: 'a'.repeat(64),
      enabled: true,
      version: 1,
      updatedAt: new Date(0),
    }
    const unrelatedPolicies = Array.from({ length: 100 }, (_, index) => ({
      ...target,
      productId: `unrelated-product-${index}`,
      sourceId: `unrelated-source-${index}`,
      updatedAt: new Date(1000 + index),
    }))
    const allPolicies = [...unrelatedPolicies, target]
    const fakeDb = {
      business: { findUnique: vi.fn().mockResolvedValue({ id: business.id, tenantId: tenant.id, status: 'ACTIVE' }) },
      lineOaAccount: { findFirst: vi.fn().mockResolvedValue({ id: account.id, tenantId: tenant.id, businessId: business.id }) },
      product: { findMany: vi.fn().mockResolvedValue([{ id: product.id, code: product.code, name: product.name,
        productMaster: { nameTh: master.nameTh } }]) },
      lineProductDisclosurePolicy: { findMany: vi.fn(async ({ where, take }) => allPolicies
        .filter((policy) => policy.tenantId === where.tenantId && policy.businessId === where.businessId
          && policy.lineOaAccountId === where.lineOaAccountId
          && (!where.productId?.in || where.productId.in.includes(policy.productId)))
        .sort((left, right) => right.updatedAt - left.updatedAt).slice(0, take)) },
    }

    const result = await listLineProductDisclosure({ businessId: business.id, accountId: account.id, q: product.code },
      { viewer: owner, db: fakeDb })

    expect(fakeDb.lineProductDisclosurePolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ productId: { in: [product.id] } }),
    }))
    expect(result.policies).toHaveLength(1)
    expect(result.policies[0].productId).toBe(product.id)
  })

  it.skipIf(!IS_POSTGRES)('applies the complete private PostgreSQL migration twice with RLS and grants', async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuri_app_runtime') THEN CREATE ROLE zuri_app_runtime NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuri_web_login') THEN CREATE ROLE zuri_web_login NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $$`)
      const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261024120000_line_product_disclosure_policy.sql'), 'utf8')
      // This file runs only against global-setup-postgres's disposable cluster.
      // Prove fresh DDL and a retry, rather than applying only the security tail
      // to a table that Prisma had already created for the fixture.
      await client.query('DROP TABLE public."LineProductDisclosurePolicy"')
      await client.query(migration)
      await client.query(migration)

      const { rows: [table] } = await client.query(`SELECT relrowsecurity, relforcerowsecurity
        FROM pg_class WHERE oid = 'public."LineProductDisclosurePolicy"'::regclass`)
      expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
      const { rows: [policy] } = await client.query(`SELECT policyname, roles::text[] AS roles, qual, with_check
        FROM pg_policies WHERE schemaname = 'public' AND tablename = 'LineProductDisclosurePolicy'`)
      expect(policy.policyname).toBe('zuri_app_runtime_all')
      expect(policy.roles.map(String).sort()).toEqual(['zuri_app_runtime', 'zuri_web_login'])
      expect(policy.qual).toBe('true')
      expect(policy.with_check).toBe('true')
      const { rows: grants } = await client.query(`SELECT role_name,
        has_table_privilege(role_name, 'public."LineProductDisclosurePolicy"', 'SELECT') AS can_select
        FROM unnest(ARRAY['zuri_app_runtime','zuri_web_login','anon','authenticated','service_role']::text[]) AS role_name`)
      expect(Object.fromEntries(grants.map(({ role_name, can_select }) => [role_name, can_select]))).toEqual({
        zuri_app_runtime: true, zuri_web_login: true, anon: false, authenticated: false, service_role: false,
      })
    } finally {
      await client.end()
    }
  })

  it('returns distinct authorized source titles and pages through more than 100 catalogs', async () => {
    const count = 205
    const corpusId = 'candidate-corpus'
    const fixtures = Array.from({ length: count }, (_, index) => {
      const suffix = String(index).padStart(3, '0')
      const sourceId = `src-${suffix}`
      const ingestionId = `ing-${suffix}`
      const assetId = `asset-${suffix}`
      const externalId = `Catalog-${suffix}`
      const title = `ProductMaster ${externalId}`
      const sha = sha256(`asset:${suffix}`)
      const asset = {
        id: assetId, code: `PCAT-${sha}`, tenantId: tenant.id, businessId: business.id, projectId: null,
        workItemId: null, storageKind: 'MANAGED_BLOB', name: `catalog-${suffix}.json`, mime: SMARTGIFT_CATALOG_CONTENT_TYPE,
        size: 4096, sha256: sha, status: 'ACTIVE', version: 1, deletedAt: null,
      }
      const source = {
        id: sourceId, corpusId, sourceKey: smartGiftSourceKey({ fileName: asset.name, recordCode: externalId }),
        kind: 'FILE', title, fileAssetId: assetId, desiredRevision: 1, activeIngestionId: ingestionId, version: 1,
        revokedAt: null, deletedAt: null,
      }
      const contentHash = sha256(`content:${suffix}`)
      const entry = {
        sourceId, ingestionId, revision: 1, fileAssetId: assetId, sourceVersion: sha, contentHash,
        executionRunId: `run-${suffix}`, snapshotId: `snapshot-${suffix}`, generation: 1,
        receiptHash: sha256(`receipt:${suffix}`), rawArtifactId: `raw-${suffix}`, parsedArtifactId: `parsed-${suffix}`,
        title, scope: { tenantId: tenant.id, businessId: business.id },
      }
      const ingestion = {
        id: ingestionId, corpusId, sourceId, revision: 1, sourceVersion: sha, contentHash, status: 'PUBLISHED',
        executionRunId: entry.executionRunId, snapshotId: entry.snapshotId, snapshotGeneration: 1,
        receiptHash: entry.receiptHash, rawArtifactId: entry.rawArtifactId, parsedArtifactId: entry.parsedArtifactId,
        sourceMetaJson: JSON.stringify({
          kind: 'FILE', title, sourceKey: source.sourceKey, fileAssetId: assetId, fileAssetVersion: 1,
          mime: asset.mime, storageKind: asset.storageKind, size: 1024, sourceVersion: sha, contentHash,
          structured: {
            format: SMARTGIFT_CATALOG_FORMAT, provider: SMARTGIFT_CATALOG_PROVIDER,
            entityType: 'ProductMaster', contentType: SMARTGIFT_CATALOG_CONTENT_TYPE,
            externalId, recordIndex: 0, recordCount: 1, fileSha256: sha,
          },
        }),
      }
      return { source, ingestion, asset, entry }
    })
    sourceMock.readManifest.mockResolvedValue({
      corpusId,
      scope: { tenantId: tenant.id, businessId: business.id },
      entries: fixtures.map(({ entry }) => entry),
    })
    const rows = fixtures.map(({ source }) => source)
    const ingestions = fixtures.map(({ ingestion }) => ingestion)
    const assets = fixtures.map(({ asset }) => asset)
    const fakeDb = {
      business: { findUnique: vi.fn().mockResolvedValue({ id: business.id, tenantId: tenant.id, status: 'ACTIVE' }) },
      lineOaAccount: { findFirst: vi.fn().mockResolvedValue({ id: account.id, tenantId: tenant.id, businessId: business.id }) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      lineProductDisclosurePolicy: { findMany: vi.fn().mockResolvedValue([]) },
      knowledgeSource: { findMany: vi.fn(async ({ where, take }) => rows
        .filter((row) => where.id.in.includes(row.id) && (!where.id.gt || row.id > where.id.gt)
          && row.corpusId === where.corpusId && row.kind === where.kind && row.revokedAt === null && row.deletedAt === null)
        .sort((left, right) => left.id.localeCompare(right.id)).slice(0, take)) },
      knowledgeIngestion: { findMany: vi.fn(async ({ where }) => ingestions
        .filter((row) => where.id.in.includes(row.id) && row.status === where.status)) },
      fileAsset: { findMany: vi.fn(async ({ where }) => assets
        .filter((row) => where.id.in.includes(row.id) && row.tenantId === where.tenantId && row.businessId === where.businessId
          && row.projectId === null && row.workItemId === null && row.storageKind === where.storageKind
          && row.status === where.status && row.deletedAt === null)) },
    }

    const first = await listLineProductDisclosure({ businessId: business.id, accountId: account.id }, { viewer: owner, db: fakeDb })
    expect(first.sources).toHaveLength(100)
    expect(first.sources[0]).toEqual({ id: 'src-000', title: 'ProductMaster Catalog-000' })
    expect(first.sources[0].title).not.toBe('ProductMaster source')
    expect(first.sourcesNextCursor).toBe('src-099')

    const second = await listLineProductDisclosure({ businessId: business.id, accountId: account.id,
      sourceCursor: first.sourcesNextCursor }, { viewer: owner, db: fakeDb })
    expect(second.sources).toHaveLength(100)
    expect(second.sources[0].id).toBe('src-100')
    expect(second.sourcesNextCursor).toBe('src-199')

    const third = await listLineProductDisclosure({ businessId: business.id, accountId: account.id,
      sourceCursor: second.sourcesNextCursor }, { viewer: owner, db: fakeDb })
    expect(third.sources).toHaveLength(5)
    expect(third.sources.at(-1).id).toBe('src-204')
    expect(third.sourcesNextCursor).toBeNull()

    const searchedFirst = await listLineProductDisclosure({ businessId: business.id, accountId: account.id,
      sourceQuery: 'cAtAlOg-204' }, { viewer: owner, db: fakeDb })
    expect(searchedFirst.sources).toEqual([])
    expect(searchedFirst.sourcesNextCursor).toBe('src-199')
    const searchedSecond = await listLineProductDisclosure({ businessId: business.id, accountId: account.id,
      sourceQuery: 'cAtAlOg-204', sourceCursor: searchedFirst.sourcesNextCursor }, { viewer: owner, db: fakeDb })
    expect(searchedSecond.sources).toEqual([{ id: 'src-204', title: 'ProductMaster Catalog-204' }])
    expect(searchedSecond.sourcesNextCursor).toBeNull()
  })

  it('limits concurrent source-byte checks while computing policy staleness', async () => {
    const policies = Array.from({ length: 9 }, (_, index) => ({
      tenantId: tenant.id,
      businessId: business.id,
      lineOaAccountId: account.id,
      productId: `product-${index}`,
      sourceId: `source-${index}`,
      fieldsJson: '["sku"]',
      sourceBindingJson: '{}',
      projectionSha256: 'a'.repeat(64),
      enabled: index % 2 === 0,
      version: index + 1,
      updatedAt: new Date(index),
    }))
    let inFlight = 0
    let maxInFlight = 0
    sourceMock.resolve.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 10))
        throw new Error('source unavailable in bounded-concurrency test')
      } finally {
        inFlight -= 1
      }
    })
    const fakeDb = {
      business: { findUnique: vi.fn().mockResolvedValue({ id: business.id, tenantId: tenant.id, status: 'ACTIVE' }) },
      lineOaAccount: { findFirst: vi.fn().mockResolvedValue({ id: account.id, tenantId: tenant.id, businessId: business.id }) },
      product: { findMany: vi.fn().mockResolvedValue(policies.map(({ productId }) => ({ id: productId, code: productId,
        name: productId, productMaster: null }))) },
      lineProductDisclosurePolicy: { findMany: vi.fn().mockResolvedValue(policies) },
    }

    const result = await listLineProductDisclosure({ businessId: business.id, accountId: account.id },
      { viewer: owner, db: fakeDb })
    expect(result.policies).toHaveLength(9)
    expect(result.policies.every((policy) => policy.stale)).toBe(true)
    expect(maxInFlight).toBe(4)
  })
})
