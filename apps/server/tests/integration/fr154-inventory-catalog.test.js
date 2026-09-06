// @req FR-154 — the Inventory catalogue against a real database: category,
//   family, factory, product master, product (SKU) and bundle; Tenant-scoped
//   codes, same-Business references, the authority ladder, the versioned
//   product actions, audit — and bundle availability derived from the ledger.
// @spec BR-002; SEC-001; FR-072
// @tested tests/integration/fr154-inventory-catalog.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import {
  applyProductAction, createBundle, createCategory, createFactory, createFamily, createProduct, createProductMaster,
  getProduct, listBundles, listCategories, listProductMasters, listProducts,
} from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'

const DOMAINS = ['projects', 'platform', 'inventory']
let tenant, business, otherBusiness, owner, manager, member, foreignOwner, category, master, seq = 0
const next = (prefix) => `${prefix}-${++seq}`

describe('FR-154 Inventory catalogue', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-INV-CAT', name: 'Inventory Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-INV-CAT', name: 'Inventory Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-INV-CAT', name: 'Gift Business' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-INV-CAT-2', name: 'Other' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    foreignOwner = ownsElsewhere({ owns: otherBusiness.id, sees: business.id, seesDomains: DOMAINS, visibleDomains: DOMAINS })
  })

  it('AC-154.1 — a category, a family and a factory are created with Tenant-scoped codes and one audit row each', async () => {
    category = await createCategory({ businessId: business.id, code: 'eco-friendly', nameTh: 'รักษ์โลก', nameEn: 'Eco-friendly', slug: 'eco-friendly', vibe: 'calm', targetRecipient: 'Operations' }, { viewer: manager })
    expect(category).toMatchObject({ code: 'eco-friendly', tenantId: tenant.id, businessId: business.id, slug: 'eco-friendly', status: 'ACTIVE', version: 1 })
    await expect(createCategory({ businessId: business.id, code: 'eco-friendly', nameTh: 'ซ้ำ', nameEn: 'Dup' }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_CATEGORY_CODE_TAKEN' })
    await expect(createCategory({ businessId: business.id, code: 'eco-2', nameTh: 'ซ้ำ', nameEn: 'Dup', slug: 'eco-friendly' }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_CATEGORY_SLUG_TAKEN' })

    const family = await createFamily({ businessId: business.id, code: 'drinkware', name: 'Drinkware' }, { viewer: owner })
    const factory = await createFactory({ businessId: business.id, code: 'FAC-CM', name: 'Chiang Mai Ceramics', country: 'TH' }, { viewer: owner })
    expect(family).toMatchObject({ code: 'drinkware', businessId: business.id })
    expect(factory).toMatchObject({ code: 'FAC-CM', country: 'TH' })

    const audits = await prisma.auditEvent.findMany({ where: { entityId: { in: [category.id, family.id, factory.id] } }, orderBy: { occurredAt: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['INVENTORY_CATEGORY_CREATED', 'PRODUCT_FAMILY_CREATED', 'FACTORY_CREATED'])
    expect(await listCategories({ businessId: business.id, viewer: member })).toHaveLength(1)
  })

  it('AC-154.2 — a product master references a category, family and factory of the same Business only', async () => {
    const family = await createFamily({ businessId: business.id, code: next('fam'), name: 'Family' }, { viewer: owner })
    const foreignCategory = await createCategory({ businessId: otherBusiness.id, code: 'foreign-cat', nameTh: 'อื่น', nameEn: 'Other' }, { viewer: makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: DOMAINS }) })
    await expect(createProductMaster({ businessId: business.id, code: 'PM-X', categoryId: foreignCategory.id, nameTh: 'x', nameEn: 'x' }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_CATEGORY_NOT_FOUND' })
    await expect(createProductMaster({ businessId: business.id, code: 'PM-X', categoryId: category.id, familyId: 'no-such-family', nameTh: 'x', nameEn: 'x' }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'PRODUCT_FAMILY_NOT_FOUND' })

    master = await createProductMaster({ businessId: business.id, code: 'PM-TUMBLER', categoryId: category.id, familyId: family.id, nameTh: 'แก้วเก็บอุณหภูมิ', nameEn: 'Tumbler', baseCost: 120.5, specs: { capacityMl: 450 } }, { viewer: manager })
    expect(master).toMatchObject({ code: 'PM-TUMBLER', categoryId: category.id, familyId: family.id, baseCost: 120.5, specs: { capacityMl: 450 } })
    expect(master.specsJson).toBeUndefined()
    const listed = await listProductMasters({ businessId: business.id, categoryId: category.id, viewer: member })
    expect(listed.map((m) => m.code)).toContain('PM-TUMBLER')
  })

  it('AC-154.3 — a SKU fixes its stock policy and tracking mode at creation; an UNTRACKED one has no ledger', async () => {
    const counted = await createProduct({ businessId: business.id, code: 'SKU-TUMBLER-BLK', productMasterId: master.id, name: 'Tumbler black', color: 'black', stockPolicy: 'TRACKED', trackingMode: 'LOT', safetyStock: 5 }, { viewer: manager })
    expect(counted).toMatchObject({ stockPolicy: 'TRACKED', trackingMode: 'LOT', safetyStock: 5, unit: 'EA', status: 'ACTIVE', version: 1 })
    const service = await createProduct({ businessId: business.id, code: 'SKU-ENGRAVING', productMasterId: master.id, name: 'Engraving service', stockPolicy: 'UNTRACKED' }, { viewer: owner })
    expect(service).toMatchObject({ stockPolicy: 'UNTRACKED', trackingMode: 'NONE' })
    await expect(createProduct({ businessId: business.id, code: 'SKU-TUMBLER-BLK', productMasterId: master.id }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_CODE_TAKEN' })
    await expect(createProduct({ businessId: business.id, code: 'SKU-NOPE', productMasterId: 'no-such-master' }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'PRODUCT_MASTER_NOT_FOUND' })

    await expect(recordMovement({ businessId: business.id, productId: service.id, kind: 'RECEIPT', quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_PRODUCT_UNTRACKED' })
    expect(await getProduct(service.id, { viewer: member })).toMatchObject({ id: service.id, onHand: null })
    expect(await getProduct(counted.id, { viewer: member })).toMatchObject({ id: counted.id, onHand: 0 })
  })

  it('AC-154.4 — the authority ladder: members read, only OWNER or INVENTORY_MANAGER write, everything else is one 404', async () => {
    await expect(listProducts({ businessId: business.id, viewer: member })).resolves.toBeInstanceOf(Array)
    await expect(createCategory({ businessId: business.id, code: next('cat'), nameTh: 'x', nameEn: 'x' }, { viewer: member })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(createCategory({ businessId: business.id, code: next('cat'), nameTh: 'x', nameEn: 'x' }, { viewer: foreignOwner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    const noDomain = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['projects'] })
    await expect(listCategories({ businessId: business.id, viewer: noDomain })).rejects.toMatchObject({ status: 404 })
    await expect(listCategories({ businessId: 'no-such-business', viewer: owner })).rejects.toMatchObject({ status: 404 })
    await expect(getProduct('no-such-product', { viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    const products = await listProducts({ businessId: business.id, viewer: owner })
    await expect(applyProductAction(products[0].id, { action: 'ARCHIVE', version: products[0].version }, { viewer: member })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-154.5 — versioned product actions: UPDATE edits fields, ARCHIVE keeps the row, a stale version conflicts', async () => {
    const product = await createProduct({ businessId: business.id, code: next('SKU'), productMasterId: master.id, name: 'Before' }, { viewer: owner })
    const updated = await applyProductAction(product.id, { action: 'UPDATE', version: 1, fields: { name: 'After', safetyStock: 2, color: 'red' } }, { viewer: manager })
    expect(updated).toMatchObject({ name: 'After', safetyStock: 2, color: 'red', version: 2, stockPolicy: 'TRACKED' })
    await expect(applyProductAction(product.id, { action: 'ARCHIVE', version: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_VERSION_CONFLICT' })
    const archived = await applyProductAction(product.id, { action: 'ARCHIVE', version: 2 }, { viewer: owner })
    expect(archived).toMatchObject({ status: 'ARCHIVED', version: 3 })
    expect(archived.archivedAt).toBeTruthy()
    await expect(applyProductAction(product.id, { action: 'UPDATE', version: 3, fields: { name: 'x' } }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_ARCHIVED' })
    expect((await listProducts({ businessId: business.id, viewer: owner })).map((p) => p.id)).not.toContain(product.id)
    expect((await listProducts({ businessId: business.id, includeArchived: true, viewer: owner })).map((p) => p.id)).toContain(product.id)
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PRODUCT', entityId: product.id }, orderBy: { occurredAt: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_ARCHIVED'])
  })

  it('AC-154.6 — a bundle packs same-Business SKUs with quantities and reports the complete sets the ledger allows', async () => {
    const a = await createProduct({ businessId: business.id, code: next('SKU-A'), productMasterId: master.id, name: 'A' }, { viewer: owner })
    const b = await createProduct({ businessId: business.id, code: next('SKU-B'), productMasterId: master.id, name: 'B' }, { viewer: owner })
    const card = await createProduct({ businessId: business.id, code: next('SKU-CARD'), productMasterId: master.id, name: 'Greeting card', stockPolicy: 'UNTRACKED' }, { viewer: owner })
    await expect(createBundle({ businessId: business.id, code: 'BND-X', name: 'x', items: [{ productId: 'no-such', qty: 1 }] }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'PRODUCT_NOT_FOUND' })

    const bundle = await createBundle({ businessId: business.id, code: 'BND-EXEC', name: 'Executive box', targetRecipients: 50, totalPrice: 1490, items: [{ productId: a.id, qty: 2 }, { productId: b.id, qty: 1 }, { productId: card.id, qty: 1 }] }, { viewer: manager })
    expect(bundle.items).toHaveLength(3)
    expect((await listBundles({ businessId: business.id, viewer: member })).find((x) => x.id === bundle.id).availableSets).toBe(0)

    await recordMovement({ businessId: business.id, productId: a.id, kind: 'RECEIPT', quantity: 10 }, { viewer: owner })
    await recordMovement({ businessId: business.id, productId: b.id, kind: 'RECEIPT', quantity: 3 }, { viewer: owner })
    expect((await listBundles({ businessId: business.id, viewer: member })).find((x) => x.id === bundle.id).availableSets).toBe(3)
    await expect(createBundle({ businessId: business.id, code: 'BND-EXEC', name: 'dup', items: [{ productId: a.id, qty: 1 }] }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_BUNDLE_CODE_TAKEN' })
  })
})
