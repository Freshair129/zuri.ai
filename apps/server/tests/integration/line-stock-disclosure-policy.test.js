import { beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { setLineStockDisclosurePolicy } from '@/modules/inventory/application/line-stock-disclosure-policy-service'

const { resolveRequestViewer } = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
const { POST: postDisclosurePolicy } = await import('@/app/api/inventory/line-stock-disclosure/route')

// @req FR-291 — stock disclosure is default-off, Business/account/SKU scoped,
// owner-only and changed with an audited expected-version CAS.
// @tested tests/integration/line-stock-disclosure-policy.test.js

let business, account, product, owner, member, category

beforeAll(async () => {
  const portfolio = await createPortfolio({ code: `PF-LSD-${Date.now()}`, name: 'LINE stock policy' })
  const tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-LSD-${Date.now()}`, name: 'LINE stock policy' })
  business = await createBusiness({ tenantId: tenant.id, code: `BUS-LSD-${Date.now()}`, name: 'LINE stock policy' })
  owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['inventory'] })
  member = makeViewer({ role: 'MEMBER', visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['inventory'] })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'LINE stock policy', externalAccountId: `line-lsd-${Date.now()}`, status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `LINE-LSD-${Date.now()}`, bindingCode: `LINE-LSD-${Date.now()}`, displayName: 'LINE stock policy', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD' } })
  category = await createCategory({ businessId: business.id, code: 'line-stock-policy', nameTh: 'สินค้า', nameEn: 'Products' }, { viewer: owner })
  const master = await createProductMaster({ businessId: business.id, code: `LSD-M-${Date.now()}`, categoryId: category.id, nameTh: 'สินค้า', nameEn: 'Products' }, { viewer: owner })
  product = await createProduct({ businessId: business.id, productMasterId: master.id, code: 'LSD-SKU', name: 'Fixture product', unit: 'piece' }, { viewer: owner })
})

describe('LINE stock disclosure policy', () => {
  it('starts absent and requires Business OWNER plus version 0 to create the explicit grant', async () => {
    const key = { tenantId: business.tenantId, businessId: business.id, lineOaAccountId: account.id, productId: product.id }
    expect(await prisma.lineStockDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: key } })).toBeNull()
    const input = { businessId: business.id, lineOaAccountId: account.id, productId: product.id, enabled: true, expectedVersion: 0, reason: 'Owner approved stock availability disclosures' }
    await expect(setLineStockDisclosurePolicy(input, { viewer: member })).rejects.toMatchObject({ status: 404 })
    const created = await setLineStockDisclosurePolicy(input, { viewer: owner })
    expect(created).toMatchObject({ ...key, enabled: true, version: 1, reason: input.reason })
    expect(await prisma.auditEvent.findFirst({ where: { entityType: 'LINE_STOCK_DISCLOSURE_POLICY', entityId: created.id, action: 'LINE_STOCK_DISCLOSURE_ENABLED', businessId: business.id } })).toMatchObject({ reason: input.reason })
  })

  it('rejects stale versions without changing the current grant, and records explicit disable', async () => {
    const key = { tenantId: business.tenantId, businessId: business.id, lineOaAccountId: account.id, productId: product.id }
    const first = await prisma.lineStockDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: key } })
    const body = { businessId: business.id, lineOaAccountId: account.id, productId: product.id, enabled: false, reason: 'Owner withdrew stock disclosure' }
    await expect(setLineStockDisclosurePolicy({ ...body, expectedVersion: 0 }, { viewer: owner })).rejects.toMatchObject({ status: 409, code: 'LINE_STOCK_POLICY_VERSION_CONFLICT' })
    const disabled = await setLineStockDisclosurePolicy({ ...body, expectedVersion: first.version }, { viewer: owner })
    expect(disabled).toMatchObject({ id: first.id, enabled: false, version: first.version + 1 })
    expect(await prisma.auditEvent.count({ where: { entityType: 'LINE_STOCK_DISCLOSURE_POLICY', entityId: first.id, action: 'LINE_STOCK_DISCLOSURE_DISABLED' } })).toBe(1)
  })

  it('cannot bind an account from another Business to this Business policy', async () => {
    const other = await createBusiness({ tenantId: business.tenantId, code: `BUS-LSD-X-${Date.now()}`, name: 'Other LINE stock policy' })
    const input = { businessId: business.id, lineOaAccountId: `foreign-${other.id}`, productId: product.id, enabled: true, expectedVersion: 0, reason: 'Must be denied' }
    await expect(setLineStockDisclosurePolicy(input, { viewer: owner })).rejects.toMatchObject({ status: 404 })
  })

  it('enforces the compound account and Product Business scope with real same-Tenant foreign rows', async () => {
    const other = await createBusiness({ tenantId: business.tenantId, code: `BUS-LSD-REAL-${Date.now()}`, name: 'Foreign LINE stock policy' })
    const otherOwner = makeViewer({ visibleBusinessIds: [other.id], ownedBusinessIds: [other.id], visibleDomains: ['inventory'] })
    const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
    const connection = await createIntegrationConnection({ tenantId: business.tenantId, businessId: other.id, providerId: provider.id,
      name: 'Foreign LINE stock policy', externalAccountId: `line-lsd-real-${Date.now()}`, status: 'ACTIVE' })
    const foreignAccount = await prisma.lineOaAccount.create({ data: { tenantId: business.tenantId, businessId: other.id,
      integrationConnectionId: connection.id, code: `LINE-LSD-REAL-${Date.now()}`, bindingCode: `LINE-LSD-REAL-${Date.now()}`,
      displayName: 'Foreign account', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD' } })
    const category = await createCategory({ businessId: other.id, code: `line-stock-policy-${Date.now()}`, nameTh: 'สินค้า', nameEn: 'Products' }, { viewer: otherOwner })
    const master = await createProductMaster({ businessId: other.id, code: `LSD-M-X-${Date.now()}`, categoryId: category.id,
      nameTh: 'สินค้าอื่น', nameEn: 'Other products' }, { viewer: otherOwner })
    const foreignProduct = await createProduct({ businessId: other.id, productMasterId: master.id,
      code: `LSD-X-${Date.now()}`, name: 'Foreign product', unit: 'piece' }, { viewer: otherOwner })
    const base = { tenantId: business.tenantId, businessId: business.id, enabled: false, version: 1,
      reason: 'Cross-business compound foreign key test', createdByPersonId: owner.principal.id,
      updatedByPersonId: owner.principal.id }
    await expect(prisma.lineStockDisclosurePolicy.create({ data: { ...base, lineOaAccountId: foreignAccount.id,
      productId: product.id } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.lineStockDisclosurePolicy.create({ data: { ...base, lineOaAccountId: account.id,
      productId: foreignProduct.id } })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('uses the authenticated request viewer at the owner policy route', async () => {
    const current = await prisma.lineStockDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: business.tenantId, businessId: business.id, lineOaAccountId: account.id, productId: product.id,
    } } })
    const post = (body) => postDisclosurePolicy(new Request('http://local/api/inventory/line-stock-disclosure', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    const base = { businessId: business.id, lineOaAccountId: account.id, productId: product.id,
      reason: 'Owner verified the authenticated stock-disclosure route' }
    resolveRequestViewer.mockResolvedValue(owner)
    const accepted = await post({ ...base, enabled: true, expectedVersion: current.version })
    expect(accepted.status).toBe(200)
    const enabled = await accepted.json()
    expect(enabled).toMatchObject({ enabled: true, version: current.version + 1 })
    expect(resolveRequestViewer).toHaveBeenCalledTimes(1)

    resolveRequestViewer.mockResolvedValue(member)
    const denied = await post({ ...base, enabled: false, expectedVersion: enabled.version })
    expect(denied.status).toBe(404)

    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const unauthenticated = await post({ ...base, enabled: false, expectedVersion: enabled.version })
    expect(unauthenticated.status).toBe(401)
  })

  it.skipIf(!/^(postgres|postgresql):/i.test(process.env.DATABASE_URL ?? ''))('maps concurrent first-grant unique races to one version conflict and keeps one audit', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const master = await createProductMaster({ businessId: business.id, code: `LSD-RACE-M-${suffix}`,
      categoryId: category.id, nameTh: `สินค้าแข่ง ${suffix}`, nameEn: `Race product ${suffix}` }, { viewer: owner })
    const raceProduct = await createProduct({ businessId: business.id, productMasterId: master.id,
      code: `LSD-RACE-${suffix}`, name: `Concurrent policy ${suffix}`, unit: 'piece' }, { viewer: owner })

    let arrivals = 0
    let releaseBarrier
    const barrier = new Promise((resolve) => { releaseBarrier = resolve })
    const release = () => releaseBarrier()
    const wrapDelegate = (delegate, policyDelegate = false) => new Proxy(delegate, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (policyDelegate && property === 'findUnique') {
          return async (...args) => {
            const row = await value.apply(target, args)
            if (row === null) {
              arrivals += 1
              if (arrivals === 2) release()
              await barrier
            }
            return row
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const concurrentDb = {
      $transaction(callback, options) {
        const transaction = prisma.$transaction(async (tx) => {
          const wrappedTx = new Proxy(tx, {
            get(target, property, receiver) {
              const value = Reflect.get(target, property, receiver)
              if (property === 'lineStockDisclosurePolicy') return wrapDelegate(value, true)
              return value
            },
          })
          try { return await callback(wrappedTx) } catch (error) { release(); throw error }
        }, options)
        return transaction.catch((error) => { release(); throw error })
      },
    }
    const common = { businessId: business.id, lineOaAccountId: account.id,
      productId: raceProduct.id, enabled: true, expectedVersion: 0 }
    const attempts = await Promise.allSettled([
      setLineStockDisclosurePolicy({ ...common, reason: 'Concurrent first grant A' }, { viewer: owner, db: concurrentDb }),
      setLineStockDisclosurePolicy({ ...common, reason: 'Concurrent first grant B' }, { viewer: owner, db: concurrentDb }),
    ])

    expect(arrivals).toBe(2)
    const winners = attempts.filter((attempt) => attempt.status === 'fulfilled')
    const losers = attempts.filter((attempt) => attempt.status === 'rejected')
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].reason).toMatchObject({ status: 409, code: 'LINE_STOCK_POLICY_VERSION_CONFLICT' })
    const stored = await prisma.lineStockDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
      tenantId: business.tenantId, businessId: business.id, lineOaAccountId: account.id, productId: raceProduct.id,
    } } })
    expect(stored).toMatchObject({ enabled: true, version: 1, reason: winners[0].value.reason })
    expect(await prisma.auditEvent.count({ where: { entityType: 'LINE_STOCK_DISCLOSURE_POLICY', entityId: stored.id } })).toBe(1)
  })
})
