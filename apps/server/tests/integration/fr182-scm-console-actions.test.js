// @req FR-182 — the two action dispatchers against a real database: one PATCH
//   vocabulary drives a work order from DRAFT to COMPLETED (or CANCELLED), the
//   version travels with every step, and the verbs a surface may not use are
//   refused by the contract rather than by a handler remembering to check.
// @spec ADR-074 D4, D5; BR-028; BR-029; SEC-001; FR-072
// @tested tests/integration/fr182-scm-console-actions.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster, setFlowAccountSku } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { createRecipe } from '@/modules/inventory/application/inventory-recipe-service'
import { createLocation } from '@/modules/inventory/application/warehouse-location-service'
import { applyCustomizationWorkOrderAction, openCustomizationWorkOrder } from '@/modules/inventory/application/customization-work-order-service'
import { applyKittingWorkOrderAction, openKittingWorkOrder } from '@/modules/inventory/application/kitting-work-order-service'

const DOMAINS = ['projects', 'platform', 'inventory']
let business, owner, manager, member, tumbler, box, giftSet, recipe, rawLoc, wipLoc, asmLoc, fgLoc
const b = () => business.id
const onHand = async (productId) => (await prisma.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? 0

describe('FR-182 work-order action dispatchers', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-CONSOLE', name: 'Console Group' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-CONSOLE', name: 'Console Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-CONSOLE', name: 'Console Business' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: b(), code: 'giftset', nameTh: 'ชุด', nameEn: 'Set' }, { viewer: owner })
    const master = await createProductMaster({ businessId: b(), code: 'PM-CONSOLE', categoryId: category.id, nameTh: 'ชุด', nameEn: 'Set' }, { viewer: owner })
    const sku = (code, over = {}) => createProduct({ businessId: b(), code, productMasterId: master.id, name: code, ...over }, { viewer: owner })

    tumbler = await sku('COMP-TUMBLER')
    box = await sku('PKG-BOX', { itemKind: 'PACKAGING_MATERIAL' })
    giftSet = await sku('SET-TMS06-2-P06', { itemKind: 'FINISHED_SET' })
    await setFlowAccountSku({ businessId: b(), productId: giftSet.id, flowAccountSku: 'TMS06-2(P-06)' }, { viewer: owner })

    rawLoc = await createLocation({ businessId: b(), code: 'CON-RAW', name: 'วัตถุดิบ', type: 'TH_CENTRAL_RAW' }, { viewer: owner })
    wipLoc = await createLocation({ businessId: b(), code: 'CON-LASER', name: 'เลเซอร์', type: 'TH_WIP_CUSTOMIZATION' }, { viewer: owner })
    asmLoc = await createLocation({ businessId: b(), code: 'CON-ASM', name: 'ประกอบ', type: 'TH_WIP_ASSEMBLY' }, { viewer: owner })
    fgLoc = await createLocation({ businessId: b(), code: 'CON-FG', name: 'สำเร็จรูป', type: 'TH_FINISHED_GOODS' }, { viewer: owner })

    await recordMovement({ businessId: b(), productId: tumbler.id, kind: 'RECEIPT', quantity: 400, targetLocationId: rawLoc.id, costSatang: 11346 }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: box.id, kind: 'RECEIPT', quantity: 400, targetLocationId: rawLoc.id, costSatang: 4500 }, { viewer: owner })

    recipe = await createRecipe({
      businessId: b(), code: 'RCP-CONSOLE', productId: giftSet.id, name: 'Console set × 10', batchSize: 10, scrapAllowanceFactor: 0.02,
      lines: [{ componentProductId: tumbler.id, qty: 10 }, { componentProductId: box.id, qty: 10 }],
    }, { viewer: owner })
  })

  it('AC-182.1 — one vocabulary drives a customization run DRAFT → IN_PROGRESS → COMPLETED, versioned at every step', async () => {
    const opened = await openCustomizationWorkOrder({
      businessId: b(), rawProductId: tumbler.id, technique: 'LASER_ENGRAVING', netQuantity: 100,
      customerId: 'cust-a', salesOrderId: 'so-a', sourceLocationId: rawLoc.id, wipLocationId: wipLoc.id,
    }, { viewer: manager })
    expect(opened).toMatchObject({ status: 'DRAFT', grossIssueQty: 102 })

    const released = await applyCustomizationWorkOrderAction(opened.id, { businessId: b(), action: 'RELEASE', version: opened.version }, { viewer: manager })
    expect(released).toMatchObject({ status: 'IN_PROGRESS', issuedQty: 102 })

    // A stale version is refused at the same point a page's second click would hit it.
    await expect(applyCustomizationWorkOrderAction(opened.id, { businessId: b(), action: 'RELEASE', version: opened.version }, { viewer: manager }))
      .rejects.toMatchObject({ status: 409, message: 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT' })

    const blanksBefore = await onHand(tumbler.id)
    const done = await applyCustomizationWorkOrderAction(opened.id, { businessId: b(), action: 'COMPLETE', version: released.version, completedQty: 100, scrapQty: 2 }, { viewer: manager })
    expect(done.order).toMatchObject({ status: 'COMPLETED', completedQty: 100, scrapQty: 2 })
    expect(await onHand(tumbler.id)).toBe(blanksBefore - 102)
    expect(await onHand(done.order.outputProductId)).toBe(100)
  })

  it('AC-182.2 — the same vocabulary drives a kitting run, and CANCEL puts the staged components back', async () => {
    const opened = await openKittingWorkOrder({
      businessId: b(), recipeId: recipe.id, plannedQty: 20,
      sourceLocationId: rawLoc.id, wipLocationId: asmLoc.id, targetLocationId: fgLoc.id,
    }, { viewer: manager })
    const released = await applyKittingWorkOrderAction(opened.id, { businessId: b(), action: 'RELEASE', version: opened.version }, { viewer: manager })
    expect(released.status).toBe('IN_PROGRESS')

    const done = await applyKittingWorkOrderAction(opened.id, { businessId: b(), action: 'COMPLETE', version: released.version, assembledQty: 20, scrapQty: 0 }, { viewer: manager })
    expect(done.order).toMatchObject({ status: 'COMPLETED', assembledQty: 20 })
    expect(await onHand(giftSet.id)).toBe(20)

    const doomed = await openKittingWorkOrder({ businessId: b(), recipeId: recipe.id, plannedQty: 10, sourceLocationId: rawLoc.id, wipLocationId: asmLoc.id, targetLocationId: fgLoc.id }, { viewer: manager })
    const doomedReleased = await applyKittingWorkOrderAction(doomed.id, { businessId: b(), action: 'RELEASE', version: doomed.version }, { viewer: manager })
    const boxesBefore = await onHand(box.id)
    const cancelled = await applyKittingWorkOrderAction(doomed.id, { businessId: b(), action: 'CANCEL', version: doomedReleased.version, reason: 'ลูกค้าเลื่อน' }, { viewer: manager })
    expect(cancelled.order.status).toBe('CANCELLED')
    // Cancelling moves stock back between locations; it never destroys any.
    expect(await onHand(box.id)).toBe(boxesBefore)
  })

  it('AC-182.3 — the contract refuses a verb that is not in the vocabulary, and quantities on a verb that has none', async () => {
    const opened = await openCustomizationWorkOrder({ businessId: b(), rawProductId: tumbler.id, technique: 'SILK_SCREEN', netQuantity: 10 }, { viewer: manager })
    await expect(applyCustomizationWorkOrderAction(opened.id, { businessId: b(), action: 'DELETE', version: opened.version }, { viewer: manager })).rejects.toThrow()
    await expect(applyCustomizationWorkOrderAction(opened.id, { businessId: b(), action: 'RELEASE', version: opened.version, completedQty: 5 }, { viewer: manager })).rejects.toThrow()
    await expect(applyKittingWorkOrderAction(opened.id, { businessId: b(), action: 'CANCEL', version: opened.version, assembledQty: 1 }, { viewer: manager })).rejects.toThrow()
  })

  it('AC-182.4 — the dispatcher carries the authority ladder, not around it', async () => {
    const opened = await openCustomizationWorkOrder({ businessId: b(), rawProductId: tumbler.id, technique: 'UV_DIGITAL_PRINT', netQuantity: 5 }, { viewer: owner })
    // A member may see the domain and still may not drive a work order; the
    // refusal is the same 404 an unknown Business gets (FR-072).
    await expect(applyCustomizationWorkOrderAction(opened.id, { businessId: b(), action: 'RELEASE', version: opened.version }, { viewer: member }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(applyKittingWorkOrderAction('nope', { businessId: b(), action: 'RELEASE', version: 1 }, { viewer: manager }))
      .rejects.toMatchObject({ status: 404 })
  })
})
