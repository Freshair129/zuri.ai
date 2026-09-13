// @req FR-201 — the nature is declared at the master and inherited: a SERVICE
//   master's SKU is a service with no stock fields, a GOOD master refuses a
//   service, and the summary counts services apart from uncounted goods.
// @req FR-202 — one physical variant is one SKU: the variant key is unique per
//   master, the legacy colour column feeds a same-named axis, and the
//   lookalike guard refuses an exact duplicate unless the caller says so.
// @req FR-203 — identifiers are attributes of one SKU, unique per Tenant, the
//   GTIN check digit is validated, the two scannable kinds share one value
//   space, and `resolveProduct` finds a SKU by code, FlowAccount code or
//   identifier and follows a merge.
// @req FR-204 — a pack size is a unit conversion: a movement in BOX12 lands in
//   base units, an unknown unit is refused, a serial product takes none.
// @req FR-205 — PHASE_OUT refuses receipts, ARCHIVE refuses a SKU with stock
//   or a live reservation, REACTIVATE restores, MERGE moves stock through the
//   ledger and re-points references, and nothing is deleted.
// @req FR-206 — the hygiene report over a real catalogue names every finding.
// @req FR-207 — replenishment suggests below the reorder point.
// @spec ADR-083 D1..D6; BR-002, BR-037, BR-038, BR-039, BR-040; SEC-001; FR-072
// @tested tests/integration/fr201-inventory-sku-governance.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import {
  applyProductAction, createBundle, createCategory, createProduct, createProductMaster, getProduct, listBundles, listProductMasters, listProducts, setFlowAccountSku,
} from '@/modules/inventory/application/inventory-catalog-service'
import { listMovements, recordMovement, stockSummary } from '@/modules/inventory/application/inventory-stock-service'
import {
  addIdentifier, addUnitConversion, applyIdentifierAction, applyUnitConversionAction, listIdentifiers, listUnitConversions, resolveProduct,
} from '@/modules/inventory/application/inventory-identity-service'
import { catalogHygiene, replenishment } from '@/modules/inventory/application/inventory-hygiene-service'
import { applyReservationAction, createReservation } from '@/modules/inventory/application/inventory-atp-service'

const DOMAINS = ['projects', 'platform', 'inventory']
let tenant, business, owner, manager, member, category, goodMaster, serviceMaster, axesMaster
const b = () => business.id
const master = (code, over = {}) => createProductMaster({ businessId: b(), code, categoryId: category.id, nameTh: code, nameEn: code, ...over }, { viewer: owner })
const sku = (code, over = {}) => createProduct({ businessId: b(), code, productMasterId: goodMaster.id, ...over }, { viewer: owner })
const receive = (productId, quantity, over = {}) => recordMovement({ businessId: b(), productId, kind: 'RECEIPT', quantity, ...over }, { viewer: owner })

describe('FR-201..FR-207 SKU governance (ADR-083)', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-SKUGOV', name: 'SKU governance' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-SKUGOV', name: 'SKU governance tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-SKUGOV', name: 'Governed business' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })
    category = await createCategory({ businessId: b(), code: 'gov-cat', nameTh: 'หมวด', nameEn: 'Category' }, { viewer: owner })
    goodMaster = await master('PM-GOOD')
    serviceMaster = await master('PM-SVC', { nature: 'SERVICE' })
    axesMaster = await master('PM-AXES', { variantAxes: ['color', 'size'], defaultStockPolicy: 'UNTRACKED' })
  })

  it('AC-201.1 — a SERVICE master yields service SKUs with no stock fields; a GOOD master refuses a service; the summary counts them apart', async () => {
    expect(serviceMaster).toMatchObject({ nature: 'SERVICE', defaultStockPolicy: 'SERVICE', variantAxes: [] })
    expect(goodMaster).toMatchObject({ nature: 'GOOD', defaultStockPolicy: 'TRACKED', variantAxes: [] })
    const engraving = await createProduct({ businessId: b(), code: 'SVC-ENGRAVE', productMasterId: serviceMaster.id, name: 'Engraving', safetyStock: 9, trackingMode: 'NONE' }, { viewer: manager })
    expect(engraving).toMatchObject({ stockPolicy: 'SERVICE', trackingMode: 'NONE', safetyStock: 0, reorderPoint: null, variant: {}, variantKey: null })
    await expect(createProduct({ businessId: b(), code: 'SVC-X', productMasterId: serviceMaster.id, stockPolicy: 'TRACKED' }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_NATURE_MISMATCH' })
    await expect(sku('GOOD-X', { stockPolicy: 'SERVICE' })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_NATURE_MISMATCH', details: { masterNature: 'GOOD', stockPolicy: 'SERVICE' } })
    const defaulted = await createProduct({ businessId: b(), code: 'AX-DEFAULT', productMasterId: axesMaster.id, variant: { color: 'white', size: 'L' } }, { viewer: owner })
    expect(defaulted.stockPolicy).toBe('UNTRACKED')
    await expect(recordMovement({ businessId: b(), productId: engraving.id, kind: 'RECEIPT', quantity: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_PRODUCT_IS_A_SERVICE' })

    const services = await listProducts({ businessId: b(), nature: 'SERVICE', viewer: member })
    expect(services.map((p) => p.code)).toEqual(['SVC-ENGRAVE'])
    expect((await listProducts({ businessId: b(), stockPolicy: 'UNTRACKED', viewer: member })).map((p) => p.code)).toEqual(['AX-DEFAULT'])
    expect((await listProductMasters({ businessId: b(), nature: 'SERVICE', viewer: member })).map((m) => m.code)).toEqual(['PM-SVC'])
    const summary = await stockSummary({ businessId: b(), viewer: member })
    expect(summary.counts).toMatchObject({ services: 1, untracked: 1 })
    await expect(applyProductAction(engraving.id, { action: 'UPDATE', version: 1, fields: { reorderPoint: 5 } }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_PRODUCT_IS_A_SERVICE' })
  })

  it('AC-202.1 — one physical variant is one SKU: the key is unique per master, values cover every axis, the legacy colour column stands in', async () => {
    const black = await createProduct({ businessId: b(), code: 'AX-BLK-M', productMasterId: axesMaster.id, name: 'Tee', variant: { color: 'Black', size: 'M' } }, { viewer: manager })
    expect(black).toMatchObject({ variant: { color: 'Black', size: 'M' }, variantKey: 'color=black|size=m' })
    await expect(createProduct({ businessId: b(), code: 'AX-BLK-M-2', productMasterId: axesMaster.id, name: 'Tee again', variant: { color: ' black', size: 'm ' } }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_PRODUCT_VARIANT_EXISTS', details: { existingProductId: black.id, existingCode: 'AX-BLK-M', existingStatus: 'ACTIVE', variantKey: 'color=black|size=m' } })
    await expect(createProduct({ businessId: b(), code: 'AX-NO-SIZE', productMasterId: axesMaster.id, variant: { color: 'red' } }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_VARIANT_AXES_INCOMPLETE', details: { missing: ['size'] } })
    await expect(createProduct({ businessId: b(), code: 'AX-EXTRA', productMasterId: axesMaster.id, variant: { color: 'red', size: 'S', fabric: 'wool' } }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_VARIANT_AXIS_UNKNOWN', details: { unknown: ['fabric'] } })
    // The legacy column feeds a same-named axis when the variant is silent on it.
    const red = await createProduct({ businessId: b(), code: 'AX-RED-S', productMasterId: axesMaster.id, color: 'Red', variant: { size: 'S' } }, { viewer: owner })
    expect(red).toMatchObject({ variantKey: 'color=red|size=s', variant: { color: 'Red', size: 'S' } })
    // A corrected variant is re-keyed and re-checked.
    await expect(applyProductAction(red.id, { action: 'UPDATE', version: 1, fields: { variant: { color: 'black', size: 'M' } } }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_PRODUCT_VARIANT_EXISTS' })
    const corrected = await applyProductAction(red.id, { action: 'UPDATE', version: 1, fields: { variant: { color: 'Crimson', size: 'S' } } }, { viewer: owner })
    expect(corrected).toMatchObject({ variantKey: 'color=crimson|size=s', version: 2 })
    // A master that declares no axes has no key: two SKUs with different descriptions coexist.
    expect((await sku('G-A', { name: 'Widget A' })).variantKey).toBeNull()
    expect((await sku('G-B', { name: 'Widget B' })).variantKey).toBeNull()
  })

  it('AC-202.2 — the lookalike guard refuses an exact duplicate under a master without axes, and records the override when a caller insists', async () => {
    const first = await sku('LK-1', { name: 'Tumbler black', color: 'Black' })
    await expect(sku('LK-2', { name: 'tumbler-black', color: 'black' })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_PRODUCT_LOOKALIKE', details: { existingProductId: first.id, existingCode: 'LK-1' } })
    const second = await sku('LK-2', { name: 'tumbler-black', color: 'black', allowLookalike: true })
    expect(second.code).toBe('LK-2')
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'PRODUCT', entityId: second.id, action: 'PRODUCT_CREATED' } })
    expect(audit.payload ?? JSON.parse(audit.payloadJson ?? '{}')).toMatchObject({ allowLookalike: true, lookalikeOf: first.id })
    // A different colour is a different thing; no name at all says nothing.
    await expect(sku('LK-3', { name: 'Tumbler black', color: 'Red' })).resolves.toMatchObject({ code: 'LK-3' })
    await expect(sku('LK-4')).resolves.toMatchObject({ code: 'LK-4' })
    await expect(sku('LK-5')).resolves.toMatchObject({ code: 'LK-5' })
  })

  it('AC-203.1 — identifiers: valid GTIN, unique per Tenant, one value space for the scannable kinds, retire keeps the row, and resolve finds the SKU', async () => {
    const a = await sku('ID-A', { name: 'Identified A' })
    const c = await sku('ID-C', { name: 'Identified C' })
    const gtin = await addIdentifier(a.id, { businessId: b(), kind: 'GTIN', value: '4006381333931', issuer: 'GS1' }, { viewer: manager })
    expect(gtin).toMatchObject({ kind: 'GTIN', value: '4006381333931', status: 'ACTIVE', version: 1, productId: a.id })
    await expect(addIdentifier(a.id, { businessId: b(), kind: 'GTIN', value: '4006381333932' }, { viewer: owner })).rejects.toThrow(/check digit/)
    await expect(addIdentifier(c.id, { businessId: b(), kind: 'GTIN', value: '4006381333931' }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_IDENTIFIER_TAKEN', details: { productId: a.id, code: 'ID-A' } })
    await expect(addIdentifier(c.id, { businessId: b(), kind: 'BARCODE', value: '4006381333931' }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_IDENTIFIER_TAKEN' })
    // A supplier's code for our item is a different value space from a barcode.
    const supplier = await addIdentifier(c.id, { businessId: b(), kind: 'SUPPLIER_CODE', value: '4006381333931', issuer: 'ACME' }, { viewer: owner })
    expect(supplier.kind).toBe('SUPPLIER_CODE')
    await expect(addIdentifier(a.id, { businessId: b(), kind: 'BARCODE', value: 'CASE-A', unit: 'BOX12' }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_UNIT_UNKNOWN' })
    await expect(addIdentifier(a.id, { businessId: b(), kind: 'BARCODE', value: 'X' }, { viewer: member })).rejects.toMatchObject({ status: 404 })
    expect(await listIdentifiers(a.id, { viewer: member })).toHaveLength(1)

    const byIdentifier = await resolveProduct({ businessId: b(), identifier: '4006381333931' }, { viewer: member })
    expect(byIdentifier).toMatchObject({ matchedBy: 'IDENTIFIER', product: { id: a.id, code: 'ID-A' }, matchedIdentifier: { kind: 'GTIN', factor: 1 }, redirectedFrom: [] })
    expect(await resolveProduct({ businessId: b(), identifier: 'ID-C' }, { viewer: member })).toMatchObject({ matchedBy: 'CODE', product: { id: c.id } })
    await setFlowAccountSku({ businessId: b(), productId: c.id, flowAccountSku: 'GOV01-2(P-1)' }, { viewer: owner })
    expect(await resolveProduct({ businessId: b(), identifier: 'GOV01-2(P-1)' }, { viewer: member })).toMatchObject({ matchedBy: 'FLOWACCOUNT_SKU', product: { id: c.id } })
    expect(await resolveProduct({ businessId: b(), identifier: 'nobody-knows-this' }, { viewer: member })).toMatchObject({ matchedBy: null, product: null })
    await expect(resolveProduct({ businessId: b(), identifier: 'ID-A' }, { viewer: makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: ['projects'] }) })).rejects.toMatchObject({ status: 404 })

    const retired = await applyIdentifierAction(a.id, { identifierId: gtin.id, action: 'RETIRE', version: 1 }, { viewer: owner })
    expect(retired).toMatchObject({ status: 'RETIRED', version: 2 })
    await expect(applyIdentifierAction(a.id, { identifierId: gtin.id, action: 'RETIRE', version: 2 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_IDENTIFIER_RETIRED' })
    expect(await listIdentifiers(a.id, { viewer: member })).toHaveLength(0)
    expect(await listIdentifiers(a.id, { includeRetired: true, viewer: member })).toHaveLength(1)
    // The retired GTIN no longer resolves to A; the supplier's code with the same digits still names C.
    expect(await resolveProduct({ businessId: b(), identifier: '4006381333931' }, { viewer: member })).toMatchObject({ matchedBy: 'IDENTIFIER', product: { id: c.id }, matchedIdentifier: { kind: 'SUPPLIER_CODE' } })
    // GS1 never reuses a GTIN, and neither does the catalogue: the retired value still blocks.
    await expect(addIdentifier(c.id, { businessId: b(), kind: 'GTIN', value: '4006381333931' }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_IDENTIFIER_TAKEN' })
  })

  it('AC-204.1 — a pack size is a conversion: a movement in BOX12 lands in base units, the base unit and an unknown unit are refused, a serial product takes none', async () => {
    const bottle = await sku('UOM-BOTTLE', { name: 'Bottle', unit: 'EA' })
    const box = await addUnitConversion(bottle.id, { businessId: b(), unit: 'BOX12', name: 'Box of 12', factor: 12, usage: 'PURCHASE' }, { viewer: manager })
    expect(box).toMatchObject({ unit: 'BOX12', factor: 12, usage: 'PURCHASE', status: 'ACTIVE', version: 1 })
    await expect(addUnitConversion(bottle.id, { businessId: b(), unit: 'EA', factor: 1 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_UNIT_IS_BASE' })
    await expect(addUnitConversion(bottle.id, { businessId: b(), unit: 'BOX12', factor: 24 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_UNIT_TAKEN' })
    expect(await listUnitConversions(bottle.id, { viewer: member })).toMatchObject({ baseUnit: 'EA', conversions: [{ unit: 'BOX12' }] })

    const moved = await receive(bottle.id, 2, { unit: 'BOX12', reference: 'PO:1' })
    expect(moved).toMatchObject({ quantity: 24, onHandAfter: 24, unitConversion: { unit: 'BOX12', factor: 12, quantityInUnit: 2 } })
    expect((await getProduct(bottle.id, { viewer: member })).onHand).toBe(24)
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'STOCK_MOVEMENT', entityId: moved.movements[0].id } })
    expect(audit.payload ?? JSON.parse(audit.payloadJson ?? '{}')).toMatchObject({ quantity: 24, unitConversion: { unit: 'BOX12', factor: 12, quantityInUnit: 2 } })
    expect((await receive(bottle.id, 3, { unit: 'EA' })).onHandAfter).toBe(27)
    await expect(receive(bottle.id, 1, { unit: 'PALLET' })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_UNIT_UNKNOWN' })
    // A pack has its own barcode, and a scan of it resolves to the SKU with the factor.
    await addIdentifier(bottle.id, { businessId: b(), kind: 'BARCODE', value: 'CASE-BOTTLE', unit: 'BOX12' }, { viewer: owner })
    expect(await resolveProduct({ businessId: b(), identifier: 'CASE-BOTTLE' }, { viewer: member })).toMatchObject({ matchedBy: 'IDENTIFIER', product: { id: bottle.id }, matchedIdentifier: { unit: 'BOX12', factor: 12 } })

    const updated = await applyUnitConversionAction(bottle.id, { conversionId: box.id, action: 'UPDATE', version: 1, fields: { factor: 10 } }, { viewer: owner })
    expect(updated).toMatchObject({ factor: 10, version: 2 })
    const retired = await applyUnitConversionAction(bottle.id, { conversionId: box.id, action: 'RETIRE', version: 2 }, { viewer: owner })
    expect(retired.status).toBe('RETIRED')
    await expect(receive(bottle.id, 1, { unit: 'BOX12' })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_UNIT_UNKNOWN' })

    const serial = await sku('UOM-SERIAL', { name: 'Serial thing', trackingMode: 'SERIAL' })
    await expect(addUnitConversion(serial.id, { businessId: b(), unit: 'PAIR', factor: 2 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_UNIT_NOT_FOR_SERIAL' })
    const service = await createProduct({ businessId: b(), code: 'UOM-SVC', productMasterId: serviceMaster.id }, { viewer: owner })
    await expect(addUnitConversion(service.id, { businessId: b(), unit: 'DAY', factor: 8 }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_PRODUCT_IS_A_SERVICE' })
  })

  it('AC-205.1 — PHASE_OUT refuses receipts and keeps issuing; ARCHIVE refuses stock or a live promise; REACTIVATE restores', async () => {
    const p = await sku('LC-1', { name: 'Lifecycle', safetyStock: 0 })
    await receive(p.id, 5)
    const phased = await applyProductAction(p.id, { action: 'PHASE_OUT', version: 1, reason: 'discontinued by supplier' }, { viewer: manager })
    expect(phased).toMatchObject({ status: 'PHASE_OUT', version: 2 })
    await expect(receive(p.id, 1)).rejects.toMatchObject({ status: 409, message: 'INVENTORY_PRODUCT_PHASED_OUT' })
    expect((await recordMovement({ businessId: b(), productId: p.id, kind: 'ISSUE', quantity: 2 }, { viewer: owner })).onHandAfter).toBe(3)
    await expect(applyProductAction(p.id, { action: 'PHASE_OUT', version: 2 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_PRODUCT_PHASED_OUT' })
    await expect(applyProductAction(p.id, { action: 'ARCHIVE', version: 2 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_PRODUCT_HAS_STOCK', details: { onHand: 3 } })
    expect((await stockSummary({ businessId: b(), viewer: member })).products.find((r) => r.code === 'LC-1')).toMatchObject({ status: 'PHASE_OUT', belowReorderPoint: false })
    expect((await replenishment({ businessId: b(), viewer: member })).rows.map((r) => r.code)).not.toContain('LC-1')

    const back = await applyProductAction(p.id, { action: 'REACTIVATE', version: 2 }, { viewer: owner })
    expect(back).toMatchObject({ status: 'ACTIVE', version: 3, archivedAt: null })
    await expect(applyProductAction(p.id, { action: 'REACTIVATE', version: 3 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_PRODUCT_ALREADY_ACTIVE' })
    // A quote is promised while the 3 are still on hand; the units then leave, and the promise alone still holds the SKU.
    const hold = await createReservation({ businessId: b(), productId: p.id, quantity: 1, purpose: 'QUOTE' }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: p.id, kind: 'ISSUE', quantity: 3 }, { viewer: owner })
    await expect(applyProductAction(p.id, { action: 'ARCHIVE', version: 3 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_PRODUCT_HAS_RESERVATIONS' })
    await applyReservationAction(hold.id, { businessId: b(), action: 'RELEASE', version: hold.version }, { viewer: owner })
    const archived = await applyProductAction(p.id, { action: 'ARCHIVE', version: 3 }, { viewer: owner })
    expect(archived).toMatchObject({ status: 'ARCHIVED', version: 4 })
    const revived = await applyProductAction(p.id, { action: 'REACTIVATE', version: 4 }, { viewer: owner })
    expect(revived).toMatchObject({ status: 'ACTIVE', archivedAt: null })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PRODUCT', entityId: p.id }, orderBy: { occurredAt: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['PRODUCT_CREATED', 'PRODUCT_PHASED_OUT', 'PRODUCT_REACTIVATED', 'PRODUCT_ARCHIVED', 'PRODUCT_REACTIVATED'])
  })

  it('AC-205.2 — MERGE moves stock through the ledger, re-points identifiers, conversions, bundle items and recipe lines, archives the duplicate pointing at its survivor, and never deletes', async () => {
    const keep = await sku('MG-KEEP', { name: 'Keeper', unit: 'EA', safetyStock: 0 })
    const dup = await sku('MG-DUP', { name: 'Duplicate', unit: 'EA', safetyStock: 0 })
    await receive(keep.id, 10)
    await receive(dup.id, 5)
    await addIdentifier(dup.id, { businessId: b(), kind: 'BARCODE', value: 'DUP-BAR' }, { viewer: owner })
    await addUnitConversion(dup.id, { businessId: b(), unit: 'BOX6', factor: 6 }, { viewer: owner })
    await addUnitConversion(keep.id, { businessId: b(), unit: 'BOX6', factor: 6 }, { viewer: owner })
    await addUnitConversion(dup.id, { businessId: b(), unit: 'CTN', factor: 36 }, { viewer: owner })
    const bundle = await createBundle({ businessId: b(), code: 'MG-BND', name: 'Bundle', items: [{ productId: dup.id, qty: 2 }] }, { viewer: owner })
    const clash = await createBundle({ businessId: b(), code: 'MG-BND-BOTH', name: 'Both', items: [{ productId: dup.id, qty: 1 }, { productId: keep.id, qty: 1 }] }, { viewer: owner })

    await expect(applyProductAction(dup.id, { action: 'MERGE', version: 1, into: keep.id }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_MERGE_BLOCKED_BY_REFERENCES', details: [{ kind: 'BUNDLE_HOLDS_BOTH', code: 'MG-BND-BOTH' }] })
    await prisma.productBundleItem.deleteMany({ where: { bundleId: clash.id, productId: dup.id } })
    await expect(applyProductAction(dup.id, { action: 'MERGE', version: 1, into: dup.id }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_MERGE_INTO_SELF' })
    await expect(applyProductAction(dup.id, { action: 'MERGE', version: 1, into: 'no-such' }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_MERGE_TARGET_NOT_FOUND' })
    await expect(applyProductAction(dup.id, { action: 'MERGE', version: 1, into: keep.id }, { viewer: member })).rejects.toMatchObject({ status: 404 })

    const merged = await applyProductAction(dup.id, { action: 'MERGE', version: 1, into: keep.id, reason: 'same tumbler entered twice' }, { viewer: manager })
    expect(merged).toMatchObject({ status: 'ARCHIVED', mergedIntoProductId: keep.id, version: 2 })
    expect(merged.archivedAt).toBeTruthy()
    expect((await getProduct(dup.id, { viewer: member })).onHand).toBe(0)
    expect((await getProduct(keep.id, { viewer: member })).onHand).toBe(15)
    const pair = (await listMovements({ businessId: b(), viewer: member })).filter((m) => m.reference === 'MERGE:MG-DUP')
    expect(pair.map((m) => [m.productId, m.kind, m.quantity]).sort()).toEqual([[dup.id, 'ISSUE', -5], [keep.id, 'RECEIPT', 5]].sort())
    expect((await listIdentifiers(keep.id, { viewer: member })).map((i) => i.value)).toEqual(['DUP-BAR'])
    expect((await listUnitConversions(keep.id, { viewer: member })).conversions.map((c) => c.unit).sort()).toEqual(['BOX6', 'CTN'])
    expect((await listUnitConversions(dup.id, { includeRetired: true, viewer: member })).conversions).toMatchObject([{ unit: 'BOX6', status: 'RETIRED' }])
    expect((await listBundles({ businessId: b(), viewer: member })).find((x) => x.id === bundle.id).items).toMatchObject([{ productId: keep.id, qty: 2 }])
    expect(await resolveProduct({ businessId: b(), identifier: 'MG-DUP' }, { viewer: member })).toMatchObject({ matchedBy: 'CODE', product: { id: keep.id }, redirectedFrom: ['MG-DUP'] })
    expect(await resolveProduct({ businessId: b(), identifier: 'DUP-BAR' }, { viewer: member })).toMatchObject({ product: { id: keep.id } })
    await expect(applyProductAction(dup.id, { action: 'REACTIVATE', version: 2 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_PRODUCT_MERGED' })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PRODUCT', entityId: { in: [dup.id, keep.id] }, action: { in: ['PRODUCT_MERGED', 'PRODUCT_ABSORBED_MERGE'] } } })
    expect(audits.map((a) => a.action).sort()).toEqual(['PRODUCT_ABSORBED_MERGE', 'PRODUCT_MERGED'])
    expect(await prisma.product.count({ where: { id: dup.id } })).toBe(1)

    // Stock that is lot-tracked cannot be moved by a merge: a person empties it first.
    const lotDup = await sku('MG-LOT', { name: 'Lot dup', trackingMode: 'LOT', safetyStock: 0 })
    await receive(lotDup.id, 2, { lotCode: 'L-1' })
    await expect(applyProductAction(lotDup.id, { action: 'MERGE', version: 1, into: keep.id }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_MERGE_REQUIRES_EMPTY_STOCK' })
    const svc = await createProduct({ businessId: b(), code: 'MG-SVC', productMasterId: serviceMaster.id }, { viewer: owner })
    await expect(applyProductAction(svc.id, { action: 'MERGE', version: 1, into: keep.id }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_MERGE_NATURE_MISMATCH' })
  })

  it('AC-206.1 — the hygiene report over the real catalogue names the lookalikes, the undeclared axes, a legacy nature mismatch, a dormant SKU and the missing identifiers; it writes nothing', async () => {
    // A legacy service filed under a good master, exactly as the migration backfill leaves one.
    await prisma.product.create({ data: { tenantId: tenant.id, businessId: b(), code: 'LEGACY-SVC', productMasterId: goodMaster.id, stockPolicy: 'SERVICE', trackingMode: 'NONE', safetyStock: 10 } })
    const auditsBefore = await prisma.auditEvent.count({ where: { entityType: { in: ['PRODUCT', 'PRODUCT_MASTER'] } } })
    const report = await catalogHygiene({ businessId: b(), viewer: member, now: new Date(Date.now() + 200 * 86_400_000) })
    const codesOf = (kind) => report.findings.filter((f) => f.kind === kind).flatMap((f) => f.codes)
    expect(codesOf('LOOKALIKE_SKUS')).toEqual(['LK-1', 'LK-2'])
    expect(codesOf('NATURE_MISMATCH')).toEqual(['LEGACY-SVC'])
    expect(codesOf('SERVICE_WITH_STOCK_FIELDS')).toEqual(['LEGACY-SVC'])
    expect(report.findings.filter((f) => f.kind === 'MASTER_WITHOUT_AXES').map((f) => f.masterId)).toEqual([goodMaster.id])
    expect(codesOf('DORMANT_SKU')).toContain('LC-1')
    expect(codesOf('DORMANT_SKU')).not.toContain('UOM-BOTTLE')
    expect(codesOf('SKU_WITHOUT_IDENTIFIER')).toContain('ID-A')
    expect(codesOf('SKU_WITHOUT_IDENTIFIER')).not.toContain('MG-KEEP')
    expect(report.findings.flatMap((f) => f.codes)).not.toContain('MG-DUP')
    expect(report).toMatchObject({ businessId: b(), dormantDays: 180, total: report.findings.length })
    expect(report.catalogue.masters).toBe(3)
    expect(await prisma.auditEvent.count({ where: { entityType: { in: ['PRODUCT', 'PRODUCT_MASTER'] } } })).toBe(auditsBefore)
    expect((await catalogHygiene({ businessId: b(), dormantDays: '5000', viewer: member })).dormantDays).toBe(3650)
    await expect(catalogHygiene({ businessId: b(), viewer: makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: ['projects'] }) })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-207.1 — replenishment suggests every counted ACTIVE SKU below its reorder point with the declared quantity or the gap', async () => {
    const declared = await sku('RP-DECLARED', { name: 'Declared', safetyStock: 2, reorderPoint: 20, reorderQty: 50, leadTimeDays: 14 })
    await receive(declared.id, 5)
    const bySafety = await sku('RP-SAFETY', { name: 'By safety', safetyStock: 4 })
    await receive(bySafety.id, 3)
    const fine = await sku('RP-FINE', { name: 'Fine', safetyStock: 4 })
    await receive(fine.id, 4)
    const rows = (await replenishment({ businessId: b(), viewer: member })).rows
    expect(rows.find((r) => r.code === 'RP-DECLARED')).toMatchObject({ onHand: 5, threshold: 20, suggestedQty: 50, leadTimeDays: 14 })
    expect(rows.find((r) => r.code === 'RP-SAFETY')).toMatchObject({ onHand: 3, threshold: 4, suggestedQty: 1, reorderPoint: null })
    expect(rows.map((r) => r.code)).not.toContain('RP-FINE')
    const summary = await stockSummary({ businessId: b(), viewer: member })
    expect(summary.products.find((r) => r.code === 'RP-DECLARED')).toMatchObject({ belowSafetyStock: false, belowReorderPoint: true, reorderPoint: 20 })
    const updated = await applyProductAction(declared.id, { action: 'UPDATE', version: 1, fields: { reorderPoint: 4, reorderQty: null } }, { viewer: owner })
    expect(updated).toMatchObject({ reorderPoint: 4, reorderQty: null, version: 2 })
    expect((await replenishment({ businessId: b(), viewer: member })).rows.map((r) => r.code)).not.toContain('RP-DECLARED')
  })
})
