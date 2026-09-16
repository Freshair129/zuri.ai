// @req FR-178 — disassembly against a real database: the set is issued, its
//   surviving components come back, the ones the caller names as destroyed are
//   written off rather than optimistically returned, and a branded component
//   can never come back into generic raw stock.
// @spec ADR-074 D6; BR-028; SEC-001; FR-072
// @tested tests/integration/fr178-de-kitting.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createCategory, createProduct, createProductMaster, setFlowAccountSku } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { createRecipe } from '@/modules/inventory/application/inventory-recipe-service'
import { createLocation } from '@/modules/inventory/application/warehouse-location-service'
import { deKitFinishedSets } from '@/modules/inventory/application/de-kitting-service'

const DOMAINS = ['projects', 'platform', 'inventory']
const PTT = 'cust-ptt'
const SO = 'so-ptt-1'
let business, owner, member, master
let tumbler, brandedTumbler, box, foam, plainSet, brandedSet
let plainRecipe, brandedRecipe, rawLoc, fgLoc, scrapLoc, wipLoc
const b = () => business.id
const onHand = async (productId) => (await prisma.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? 0

describe('FR-178 De-kitting', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-DEKIT', name: 'De-kit Group' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-DEKIT', name: 'De-kit Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-DEKIT', name: 'Gift disassembler' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: b(), code: 'giftset', nameTh: 'ชุดของขวัญ', nameEn: 'Gift set' }, { viewer: owner })
    master = await createProductMaster({ businessId: b(), code: 'PM-SET', categoryId: category.id, nameTh: 'ชุด', nameEn: 'Set' }, { viewer: owner })
    const sku = (code, over = {}) => createProduct({ businessId: b(), code, productMasterId: master.id, name: code, ...over }, { viewer: owner })

    tumbler = await sku('COMP-TUMBLER')
    brandedTumbler = await sku('BRANDED-TUMBLER-PTT', { itemKind: 'CUSTOM_COMPONENT', dedicatedCustomerId: PTT, dedicatedSalesOrderId: SO })
    box = await sku('PKG-BOX-P-06', { itemKind: 'PACKAGING_MATERIAL' })
    foam = await sku('PKG-FOAM-EVA', { itemKind: 'PACKAGING_MATERIAL' })
    plainSet = await sku('SET-TMS06-3-P06', { itemKind: 'FINISHED_SET' })
    brandedSet = await sku('SET-TMS06-3-P06-PTT', { itemKind: 'FINISHED_SET' })
    await setFlowAccountSku({ businessId: b(), productId: plainSet.id, flowAccountSku: 'TMS06-3(P-06)' }, { viewer: owner })

    rawLoc = await createLocation({ businessId: b(), code: 'DK-RAW', name: 'วัตถุดิบ', type: 'TH_CENTRAL_RAW' }, { viewer: owner })
    fgLoc = await createLocation({ businessId: b(), code: 'DK-FG', name: 'สินค้าสำเร็จรูป', type: 'TH_FINISHED_GOODS' }, { viewer: owner })
    scrapLoc = await createLocation({ businessId: b(), code: 'DK-SCRAP', name: 'ของเสีย', type: 'TH_QUARANTINE_SCRAP' }, { viewer: owner })
    wipLoc = await createLocation({ businessId: b(), code: 'DK-WIP', name: 'ไลน์ประกอบ', type: 'TH_WIP_ASSEMBLY' }, { viewer: owner })

    plainRecipe = await createRecipe({
      businessId: b(), code: 'RCP-PLAIN-10', productId: plainSet.id, name: 'Plain × 10', batchSize: 10,
      lines: [{ componentProductId: tumbler.id, qty: 10 }, { componentProductId: box.id, qty: 10 }, { componentProductId: foam.id, qty: 10 }],
    }, { viewer: owner })
    brandedRecipe = await createRecipe({
      businessId: b(), code: 'RCP-PTT-10', productId: brandedSet.id, name: 'PTT × 10', batchSize: 10,
      lines: [{ componentProductId: brandedTumbler.id, qty: 10 }, { componentProductId: box.id, qty: 10 }],
    }, { viewer: owner })

    // Finished sets on the shelf, and the branded set too.
    await recordMovement({ businessId: b(), productId: plainSet.id, kind: 'RECEIPT', quantity: 50, targetLocationId: fgLoc.id, costSatang: 42046 }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: brandedSet.id, kind: 'RECEIPT', quantity: 20, targetLocationId: fgLoc.id }, { viewer: owner })
    // Component costs, so what comes back is valued rather than free.
    await recordMovement({ businessId: b(), productId: tumbler.id, kind: 'RECEIPT', quantity: 5, targetLocationId: rawLoc.id, costSatang: 11346 }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: box.id, kind: 'RECEIPT', quantity: 5, targetLocationId: rawLoc.id, costSatang: 4500 }, { viewer: owner })
  })

  it('AC-178.1 — the sets are issued and their surviving components come back at the stated location', async () => {
    const before = { set: await onHand(plainSet.id), tumbler: await onHand(tumbler.id), box: await onHand(box.id), foam: await onHand(foam.id) }
    const result = await deKitFinishedSets({
      businessId: b(), recipeId: plainRecipe.id, quantity: 10,
      sourceLocationId: fgLoc.id, targetLocationId: rawLoc.id,
    }, { viewer: owner })

    expect(result.quantity).toBe(10)
    expect(await onHand(plainSet.id)).toBe(before.set - 10)
    expect(await onHand(tumbler.id)).toBe(before.tumbler + 10)
    expect(await onHand(box.id)).toBe(before.box + 10)
    expect(await onHand(foam.id)).toBe(before.foam + 10)

    // What comes back is valued at what it cost, not at zero.
    const tumblerBack = await prisma.stockMovement.findFirst({ where: { productId: tumbler.id, reason: 'DE_KITTING' } })
    expect(tumblerBack).toMatchObject({ costSatang: 11346, targetLocationId: rawLoc.id })
    // A component that never had a cost comes back with none rather than free.
    const foamBack = await prisma.stockMovement.findFirst({ where: { productId: foam.id, reason: 'DE_KITTING' } })
    expect(foamBack.costSatang).toBeNull()

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'STOCK_MOVEMENT', action: 'STOCK_DE_KITTED' } })
    expect(audits).toHaveLength(1)
  })

  it('AC-178.2 — packaging the disassembly destroyed is written off, not put back on the shelf', async () => {
    const before = { box: await onHand(box.id), foam: await onHand(foam.id), tumbler: await onHand(tumbler.id) }
    const result = await deKitFinishedSets({
      businessId: b(), recipeId: plainRecipe.id, quantity: 10,
      sourceLocationId: fgLoc.id, targetLocationId: rawLoc.id,
      destroyedComponentProductIds: [box.id, foam.id],
    }, { viewer: owner })

    expect(result.writtenOff.map((w) => w.code).sort()).toEqual(['PKG-BOX-P-06', 'PKG-FOAM-EVA'])
    expect(result.returned.map((r) => r.code)).toEqual(['COMP-TUMBLER'])
    // The tumbler survived; the crushed box and torn foam did not come back.
    expect(await onHand(tumbler.id)).toBe(before.tumbler + 10)
    expect(await onHand(box.id)).toBe(before.box)
    expect(await onHand(foam.id)).toBe(before.foam)
  })

  it('AC-178.3 — a branded component can never come back into generic raw stock (BR-028)', async () => {
    await expect(deKitFinishedSets({
      businessId: b(), recipeId: brandedRecipe.id, quantity: 10,
      sourceLocationId: fgLoc.id, targetLocationId: rawLoc.id,
    }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE' })

    // The assembly line is not the free pool, so the same disassembly is fine there…
    const toWip = await deKitFinishedSets({
      businessId: b(), recipeId: brandedRecipe.id, quantity: 10,
      sourceLocationId: fgLoc.id, targetLocationId: wipLoc.id,
    }, { viewer: owner })
    expect(await onHand(brandedTumbler.id)).toBe(10)
    // …and the units come back still locked to the customer they were branded for.
    const back = await prisma.stockMovement.findFirst({ where: { productId: brandedTumbler.id, kind: 'RECEIPT' } })
    expect(back).toMatchObject({ customerId: PTT, salesOrderId: SO, targetLocationId: wipLoc.id })
    expect(toWip.returned.map((r) => r.code)).toContain('BRANDED-TUMBLER-PTT')

    // …and quarantine is the other honest destination.
    await deKitFinishedSets({ businessId: b(), recipeId: brandedRecipe.id, quantity: 10, sourceLocationId: fgLoc.id, targetLocationId: scrapLoc.id }, { viewer: owner })
    expect(await onHand(brandedSet.id)).toBe(0)
  })

  it('AC-178.4 — de-kitting refuses more sets than exist, an unknown recipe, and a viewer without write authority', async () => {
    await expect(deKitFinishedSets({ businessId: b(), recipeId: plainRecipe.id, quantity: 9999, sourceLocationId: fgLoc.id, targetLocationId: rawLoc.id }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_INSUFFICIENT_STOCK' })
    await expect(deKitFinishedSets({ businessId: b(), recipeId: 'nope', quantity: 1 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'PRODUCT_RECIPE_NOT_FOUND' })
    await expect(deKitFinishedSets({ businessId: b(), recipeId: plainRecipe.id, quantity: 10 }, { viewer: member }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })
  })
})
