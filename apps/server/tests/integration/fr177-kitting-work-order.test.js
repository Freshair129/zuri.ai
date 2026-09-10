// @req FR-177 — the kitting work order against a real database: the FlowAccount
//   finished-set SKU it insists on, the frozen bill of materials, the scrap
//   buffer issued up front, ATP-based availability, the blended landed unit
//   cost of an assembled set, and the buffer returned at completion.
// @req FR-175 — the cost the finished set carries when it lands in stock.
// @spec ADR-074 D5; BR-029; BR-032; BR-027; SEC-001; FR-072
// @tested tests/integration/fr177-kitting-work-order.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster, setFlowAccountSku } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { createRecipe } from '@/modules/inventory/application/inventory-recipe-service'
import { flowAccountSkuOf } from '@/modules/inventory/application/inventory-catalog-service'
import { createLocation, locationStock } from '@/modules/inventory/application/warehouse-location-service'
import { createReservation } from '@/modules/inventory/application/inventory-atp-service'
import {
  cancelKittingWorkOrder,
  completeKittingWorkOrder,
  listKittingWorkOrders,
  openKittingWorkOrder,
  releaseKittingWorkOrder,
} from '@/modules/inventory/application/kitting-work-order-service'

const DOMAINS = ['projects', 'platform', 'inventory']
let business, owner, manager, member, master
let tumbler, powerbank, box, foam, giftSet, badlyNamedSet
let recipe, badRecipe, rawLoc, asmLoc, fgLoc
const b = () => business.id
const onHand = async (productId) => (await prisma.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? 0

describe('FR-177 Kitting work orders', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-KWO', name: 'KWO Group' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-KWO', name: 'KWO Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-KWO', name: 'Gift assembler' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: b(), code: 'giftset', nameTh: 'ชุดของขวัญ', nameEn: 'Gift set' }, { viewer: owner })
    master = await createProductMaster({ businessId: b(), code: 'PM-TMS06', categoryId: category.id, nameTh: 'ชุดของขวัญ', nameEn: 'Gift set' }, { viewer: owner })
    const sku = (code, over = {}) => createProduct({ businessId: b(), code, productMasterId: master.id, name: code, ...over }, { viewer: owner })

    tumbler = await sku('COMP-TUMBLER-SUS304-500ML')
    powerbank = await sku('COMP-PB-10000MAH-MAGSAFE')
    box = await sku('PKG-BOX-P-16-RIGID', { itemKind: 'PACKAGING_MATERIAL' })
    foam = await sku('PKG-FOAM-EVA-P16-4SLOT', { itemKind: 'PACKAGING_MATERIAL' })
    // Our own code carries no parentheses (FR-154); FlowAccount's does, and
    // lives on ExternalRef where BR-002 says an external system's id belongs.
    giftSet = await sku('SET-TMS06-4-P16', { itemKind: 'FINISHED_SET' })
    await setFlowAccountSku({ businessId: b(), productId: giftSet.id, flowAccountSku: 'TMS06-4(P-16)' }, { viewer: owner })
    badlyNamedSet = await sku('SET-DELUXE-UNREGISTERED', { itemKind: 'FINISHED_SET' })

    rawLoc = await createLocation({ businessId: b(), code: 'KWO-RAW', name: 'คลังวัตถุดิบ', type: 'TH_CENTRAL_RAW' }, { viewer: owner })
    asmLoc = await createLocation({ businessId: b(), code: 'KWO-ASM', name: 'ไลน์ประกอบ', type: 'TH_WIP_ASSEMBLY' }, { viewer: owner })
    fgLoc = await createLocation({ businessId: b(), code: 'KWO-FG', name: 'คลังสินค้าสำเร็จรูป', type: 'TH_FINISHED_GOODS' }, { viewer: owner })

    // Landed costs: tumbler 113.46 ฿, power bank 240.00 ฿, box 45.00 ฿, foam 12.00 ฿.
    const stock = async (product, qty, costSatang) =>
      recordMovement({ businessId: b(), productId: product.id, kind: 'RECEIPT', quantity: qty, targetLocationId: rawLoc.id, costSatang, reference: 'GRN:CN-2026-02' }, { viewer: owner })
    await stock(tumbler, 1000, 11346)
    await stock(powerbank, 1000, 24000)
    await stock(box, 1000, 4500)
    await stock(foam, 1000, 1200)

    recipe = await createRecipe({
      businessId: b(), code: 'RCP-TMS06-4-100', productId: giftSet.id, name: 'TMS06-4(P-16) × 100', batchSize: 100,
      scrapAllowanceFactor: 0.02,
      lines: [
        { componentProductId: tumbler.id, qty: 100 },
        { componentProductId: powerbank.id, qty: 100 },
        { componentProductId: box.id, qty: 100 },
        { componentProductId: foam.id, qty: 100 },
      ],
    }, { viewer: owner })
    badRecipe = await createRecipe({
      businessId: b(), code: 'RCP-BAD-10', productId: badlyNamedSet.id, name: 'Badly named × 10', batchSize: 10,
      lines: [{ componentProductId: box.id, qty: 10 }],
    }, { viewer: owner })
  })

  it('AC-177.1 — a recipe carries its declared scrap allowance, and a run refuses an output with no valid FlowAccount code (BR-032, BR-002)', async () => {
    expect(recipe.scrapAllowanceFactor).toBe(0.02)
    expect(badRecipe.scrapAllowanceFactor).toBe(0)

    // The set's own code is ours; FlowAccount's code for it is an ExternalRef.
    expect(giftSet.code).toBe('SET-TMS06-4-P16')
    expect(await flowAccountSkuOf(prisma, giftSet.id)).toBe('TMS06-4(P-16)')
    // A code FlowAccount would reject can never reach the ref in the first place.
    await expect(setFlowAccountSku({ businessId: b(), productId: badlyNamedSet.id, flowAccountSku: 'GIFTSET-DELUXE' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_FINISHED_SET_SKU_INVALID' })

    await expect(openKittingWorkOrder({ businessId: b(), recipeId: badRecipe.id, plannedQty: 10 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_FINISHED_SET_SKU_MISSING' })
    await expect(openKittingWorkOrder({ businessId: b(), recipeId: recipe.id, plannedQty: 10 }, { viewer: member }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })
  })

  it('AC-177.1b — the FlowAccount code is unique per Tenant, not per installation: two Tenants may sell the same factory model', async () => {
    // Within one Tenant the code names exactly one product.
    await expect(setFlowAccountSku({ businessId: b(), productId: badlyNamedSet.id, flowAccountSku: 'TMS06-4(P-16)' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_FLOWACCOUNT_SKU_TAKEN' })

    // Across Tenants it does not. Two importers buying from the same Chinese
    // factory both call their four-item set TMS06-4(P-16), and neither is
    // wrong — which is why this is a column unique per Tenant and not an
    // `ExternalRef` row (that table is unique on (system, value) installation-
    // wide and carries no tenantId at all).
    const otherPortfolio = await createPortfolio({ code: 'PF-KWO-2', name: 'Rival Group' })
    const otherTenant = await createTenant({ portfolioId: otherPortfolio.id, code: 'TNT-KWO-2', name: 'Rival Tenant' })
    const otherBusiness = await createBusiness({ tenantId: otherTenant.id, code: 'BUS-KWO-2', name: 'Rival assembler' })
    const otherOwner = makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: DOMAINS })
    const otherCategory = await createCategory({ businessId: otherBusiness.id, code: 'giftset', nameTh: 'ชุด', nameEn: 'Set' }, { viewer: otherOwner })
    const otherMaster = await createProductMaster({ businessId: otherBusiness.id, code: 'PM-TMS06', categoryId: otherCategory.id, nameTh: 'ชุด', nameEn: 'Set' }, { viewer: otherOwner })
    const rivalSet = await createProduct({ businessId: otherBusiness.id, code: 'SET-TMS06-4-P16', productMasterId: otherMaster.id, name: 'Rival set', itemKind: 'FINISHED_SET' }, { viewer: otherOwner })
    const bound = await setFlowAccountSku({ businessId: otherBusiness.id, productId: rivalSet.id, flowAccountSku: 'TMS06-4(P-16)' }, { viewer: otherOwner })
    expect(bound.flowAccountSku).toBe('TMS06-4(P-16)')
    expect(await flowAccountSkuOf(prisma, giftSet.id)).toBe('TMS06-4(P-16)')
  })

  it('AC-177.2 — opening a run freezes the exploded bill of materials with the buffer already in it (BR-029)', async () => {
    const order = await openKittingWorkOrder({
      businessId: b(), recipeId: recipe.id, plannedQty: 500, laborCostSatang: 500000,
      sourceLocationId: rawLoc.id, wipLocationId: asmLoc.id, targetLocationId: fgLoc.id,
    }, { viewer: manager })

    expect(order).toMatchObject({ status: 'DRAFT', plannedQty: 500 })
    expect(order.code).toMatch(/^KWO-\d{8}-\d{3}$/)
    const line = (id) => order.plannedLines.find((l) => l.componentProductId === id)
    // 500 sets need 500 of each, plus a 2% buffer the line takes with it.
    expect(line(tumbler.id)).toMatchObject({ netQty: 500, grossQty: 510, qtyPerBatch: 100, batchSize: 100 })
    expect(line(box.id)).toMatchObject({ netQty: 500, grossQty: 510 })
  })

  it('AC-177.3 — availability is ATP, so components another quote already promised do not count as free (FR-180)', async () => {
    // 1,000 tumblers on hand, 510 already staged by the run above, and now a
    // quote holds 400 more: not enough left for another 200-set run.
    await createReservation({ businessId: b(), productId: tumbler.id, quantity: 400, purpose: 'QUOTE', quoteReference: 'QT-SCG-1' }, { viewer: owner })
    await expect(openKittingWorkOrder({ businessId: b(), recipeId: recipe.id, plannedQty: 700 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_KITTING_SHORTAGE' })
  })

  it('AC-177.4 — releasing stages the gross quantities at the line without changing Business-wide on-hand', async () => {
    const [order] = await listKittingWorkOrders({ businessId: b(), status: 'DRAFT', viewer: manager })
    const before = await onHand(tumbler.id)
    const released = await releaseKittingWorkOrder(order.id, { businessId: b(), version: order.version }, { viewer: manager })

    expect(released.status).toBe('IN_PROGRESS')
    expect(await onHand(tumbler.id)).toBe(before)
    const staged = await prisma.stockMovement.aggregate({ where: { productId: tumbler.id, targetLocationId: asmLoc.id }, _sum: { quantity: true } })
    expect(staged._sum.quantity).toBe(510)
  })

  it('AC-177.5 — completing consumes what the attempts used, produces the sets at their blended landed cost, and returns the buffer (FR-175)', async () => {
    const [order] = await listKittingWorkOrders({ businessId: b(), status: 'IN_PROGRESS', viewer: manager })
    const tumblersBefore = await onHand(tumbler.id)

    const result = await completeKittingWorkOrder(order.id, { businessId: b(), version: order.version, assembledQty: 500, scrapQty: 4 }, { viewer: manager })

    expect(result.order).toMatchObject({ status: 'COMPLETED', assembledQty: 500, scrapQty: 4 })
    // 504 attempts each ate one of every component; the remaining 6 went back.
    expect(await onHand(tumbler.id)).toBe(tumblersBefore - 504)
    expect(await onHand(giftSet.id)).toBe(500)
    expect(result.returned.find((r) => r.componentProductId === tumbler.id)).toMatchObject({ quantity: 6 })

    // 113.46 + 240.00 + 45.00 + 12.00 = 410.46 ฿ of components, plus 5,000 ฿ of
    // labour over 500 sets = 10.00 ฿ each.
    expect(result.unitCost).toMatchObject({ componentsSatang: 41046, laborPerUnitSatang: 1000, unitCostSatang: 42046, complete: true })
    const receipt = await prisma.stockMovement.findFirst({ where: { productId: giftSet.id, kind: 'RECEIPT' } })
    expect(receipt).toMatchObject({ costSatang: 42046, targetLocationId: fgLoc.id, workOrderId: order.id })
    expect(result.order.unitCostSatang).toBe(42046)
  })

  it('AC-177.6 — a run cannot assemble more than it planned, be completed twice, or be completed before it is released', async () => {
    const order = await openKittingWorkOrder({ businessId: b(), recipeId: recipe.id, plannedQty: 50, sourceLocationId: rawLoc.id, wipLocationId: asmLoc.id, targetLocationId: fgLoc.id }, { viewer: owner })
    await expect(completeKittingWorkOrder(order.id, { businessId: b(), version: order.version, assembledQty: 10 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'KITTING_WORK_ORDER_NOT_RELEASED' })

    const released = await releaseKittingWorkOrder(order.id, { businessId: b(), version: order.version }, { viewer: owner })
    await expect(completeKittingWorkOrder(released.id, { businessId: b(), version: released.version, assembledQty: 60 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'KITTING_WORK_ORDER_OVER_ASSEMBLED' })

    const done = await completeKittingWorkOrder(released.id, { businessId: b(), version: released.version, assembledQty: 50 }, { viewer: owner })
    expect(done.order.status).toBe('COMPLETED')
    await expect(completeKittingWorkOrder(released.id, { businessId: b(), version: done.order.version, assembledQty: 1 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'KITTING_WORK_ORDER_COMPLETED' })
  })

  it('AC-177.7 — a run that assembled fewer than it planned lands BLOCKED_SHORTAGE, and a cancelled one puts everything back', async () => {
    const short = await openKittingWorkOrder({ businessId: b(), recipeId: recipe.id, plannedQty: 40, sourceLocationId: rawLoc.id, wipLocationId: asmLoc.id, targetLocationId: fgLoc.id }, { viewer: owner })
    const shortReleased = await releaseKittingWorkOrder(short.id, { businessId: b(), version: short.version }, { viewer: owner })
    const shortDone = await completeKittingWorkOrder(shortReleased.id, { businessId: b(), version: shortReleased.version, assembledQty: 30, scrapQty: 2 }, { viewer: owner })
    expect(shortDone.order).toMatchObject({ status: 'BLOCKED_SHORTAGE', assembledQty: 30, completedAt: null })

    const doomed = await openKittingWorkOrder({ businessId: b(), recipeId: recipe.id, plannedQty: 10, sourceLocationId: rawLoc.id, wipLocationId: asmLoc.id, targetLocationId: fgLoc.id }, { viewer: owner })
    const doomedReleased = await releaseKittingWorkOrder(doomed.id, { businessId: b(), version: doomed.version }, { viewer: owner })
    const atLine = async () => (await locationStock({ businessId: b(), productId: box.id, viewer: owner })).located.find((r) => r.locationId === asmLoc.id)?.onHand ?? 0
    const stagedBefore = await atLine()
    const cancelled = await cancelKittingWorkOrder(doomedReleased.id, { businessId: b(), version: doomedReleased.version, reason: 'client postponed' }, { viewer: owner })
    expect(cancelled.order.status).toBe('CANCELLED')
    expect(cancelled.returned.find((r) => r.componentProductId === box.id)).toMatchObject({ quantity: 11 })
    expect(await atLine()).toBe(stagedBefore - 11)
  })
})
