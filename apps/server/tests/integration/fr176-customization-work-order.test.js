// @req FR-176 — the customization work order against a real database: the
//   branded output SKU it creates, the gross issue with its scrap buffer, the
//   irreversible dedication of the output, the scrap that leaves stock rather
//   than joining quarantine as sellable goods, and the BLOCKED_SHORTAGE a
//   scrap overrun produces.
// @spec ADR-074 D4; BR-028; BR-029; BR-027; SEC-001; FR-072
// @tested tests/integration/fr176-customization-work-order.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { createLocation } from '@/modules/inventory/application/warehouse-location-service'
import {
  cancelCustomizationWorkOrder,
  completeCustomizationWorkOrder,
  listCustomizationWorkOrders,
  openCustomizationWorkOrder,
  releaseCustomizationWorkOrder,
} from '@/modules/inventory/application/customization-work-order-service'

const DOMAINS = ['projects', 'platform', 'inventory']
const PTT = 'cust-ptt'
const SO = 'so-ptt-2026q4'
let business, owner, manager, member, master, tumbler, serialGadget, raw, wip, scrapLoc
const b = () => business.id
const onHand = async (productId) => (await prisma.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? 0

describe('FR-176 Customization work orders', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-CWO', name: 'CWO Group' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-CWO', name: 'CWO Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-CWO', name: 'Gift maker' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: b(), code: 'drinkware', nameTh: 'แก้วน้ำ', nameEn: 'Drinkware' }, { viewer: owner })
    master = await createProductMaster({ businessId: b(), code: 'PM-TUMBLER', categoryId: category.id, nameTh: 'กระบอกน้ำ', nameEn: 'Tumbler' }, { viewer: owner })
    tumbler = await createProduct({ businessId: b(), code: 'COMP-TUMBLER-SUS304-500ML', productMasterId: master.id, name: 'SUS304 500ml matte' }, { viewer: owner })
    serialGadget = await createProduct({ businessId: b(), code: 'COMP-SPEAKER-BT', productMasterId: master.id, name: 'Speaker', trackingMode: 'SERIAL' }, { viewer: owner })

    raw = await createLocation({ businessId: b(), code: 'CWO-RAW', name: 'คลังวัตถุดิบ', type: 'TH_CENTRAL_RAW' }, { viewer: owner })
    wip = await createLocation({ businessId: b(), code: 'CWO-LASER', name: 'ห้องเลเซอร์', type: 'TH_WIP_CUSTOMIZATION' }, { viewer: owner })
    scrapLoc = await createLocation({ businessId: b(), code: 'CWO-SCRAP', name: 'ของเสีย', type: 'TH_QUARANTINE_SCRAP' }, { viewer: owner })

    // 1,000 blanks at 113.46 ฿ landed.
    await recordMovement({ businessId: b(), productId: tumbler.id, kind: 'RECEIPT', quantity: 1000, targetLocationId: raw.id, costSatang: 11346, reference: 'GRN:CN-2026-01' }, { viewer: owner })
  })

  it('AC-176.1 — opening a run creates the branded SKU it will produce, dedicated to one customer and one order', async () => {
    const order = await openCustomizationWorkOrder({
      businessId: b(), rawProductId: tumbler.id, technique: 'LASER_ENGRAVING', netQuantity: 500,
      customerId: PTT, salesOrderId: SO, logoArtworkUrl: 'https://files.example/ptt.ai',
      pantoneColors: ['PANTONE 355 C'], setupCostSatang: 80000, runCostSatang: 1200,
      sourceLocationId: raw.id, wipLocationId: wip.id, scrapLocationId: scrapLoc.id,
    }, { viewer: manager })

    expect(order).toMatchObject({ status: 'DRAFT', plannedQty: 500, scrapAllowanceFactor: 0.02, grossIssueQty: 510, technique: 'LASER_ENGRAVING' })
    expect(order.code).toMatch(/^CWO-\d{8}-\d{3}$/)
    expect(order.pantoneColors).toEqual(['PANTONE 355 C'])

    const output = await prisma.product.findUnique({ where: { id: order.outputProductId } })
    expect(output).toMatchObject({ itemKind: 'CUSTOM_COMPONENT', dedicatedCustomerId: PTT, dedicatedSalesOrderId: SO, stockPolicy: 'TRACKED' })
    expect(output.code).toBe(`${tumbler.code}-${order.code}`)
    // The blank itself is untouched: branding produces a different row, never a flag.
    expect((await prisma.product.findUnique({ where: { id: tumbler.id } })).itemKind).toBe('RAW_COMPONENT')

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'CUSTOMIZATION_WORK_ORDER', entityId: order.id } })
    expect(audits.map((a) => a.action)).toEqual(['CUSTOMIZATION_WORK_ORDER_OPENED'])
  })

  it('AC-176.2 — a run refuses a serial blank, an already-branded blank, and a member with no write authority', async () => {
    await expect(openCustomizationWorkOrder({ businessId: b(), rawProductId: serialGadget.id, technique: 'SILK_SCREEN', netQuantity: 10 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_CUSTOMIZATION_SERIAL_UNSUPPORTED' })
    await expect(openCustomizationWorkOrder({ businessId: b(), rawProductId: tumbler.id, technique: 'SILK_SCREEN', netQuantity: 10 }, { viewer: member }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })

    const first = (await listCustomizationWorkOrders({ businessId: b(), viewer: member }))[0]
    await expect(openCustomizationWorkOrder({ businessId: b(), rawProductId: first.outputProductId, technique: 'SILK_SCREEN', netQuantity: 10 }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_CUSTOM_COMPONENT_ALREADY_BRANDED' })
  })

  it('AC-176.3 — releasing moves the gross quantity (net + buffer) to the workshop without changing Business-wide on-hand', async () => {
    const [order] = await listCustomizationWorkOrders({ businessId: b(), status: 'DRAFT', viewer: manager })
    const before = await onHand(tumbler.id)
    const released = await releaseCustomizationWorkOrder(order.id, { businessId: b(), version: order.version }, { viewer: manager })

    expect(released).toMatchObject({ status: 'IN_PROGRESS', issuedQty: 510 })
    expect(await onHand(tumbler.id)).toBe(before)

    const atWip = await prisma.stockMovement.aggregate({ where: { productId: tumbler.id, targetLocationId: wip.id }, _sum: { quantity: true } })
    expect(atWip._sum.quantity).toBe(510)
    await expect(releaseCustomizationWorkOrder(order.id, { businessId: b(), version: order.version }, { viewer: manager }))
      .rejects.toMatchObject({ status: 409, message: 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT' })
  })

  it('AC-176.4 — completing consumes the worked units, issues the ruined ones OUT of stock, produces branded stock at its landed cost, and returns the unused buffer', async () => {
    const [order] = await listCustomizationWorkOrders({ businessId: b(), status: 'IN_PROGRESS', viewer: manager })
    const blanksBefore = await onHand(tumbler.id)

    const result = await completeCustomizationWorkOrder(order.id, { businessId: b(), version: order.version, completedQty: 502, scrapQty: 8 }, { viewer: manager })

    expect(result.order).toMatchObject({ status: 'COMPLETED', completedQty: 502, scrapQty: 8 })
    // 510 issued, 502 branded, 8 ruined, 0 buffer left.
    expect(result.order.run).toMatchObject({ unusedBufferQty: 0 })
    expect(await onHand(tumbler.id)).toBe(blanksBefore - 510)
    expect(await onHand(order.outputProductId)).toBe(502)

    // FR-175 — the branded unit carries the blank's landed cost plus the run's
    // amortised setup (800 ฿ / 500) and its per-piece rate (12 ฿).
    expect(result.unitCostSatang).toBe(11346 + 160 + 1200)
    const receipt = await prisma.stockMovement.findFirst({ where: { productId: order.outputProductId, kind: 'RECEIPT' } })
    expect(receipt).toMatchObject({ costSatang: 12706, targetLocationId: wip.id, customerId: PTT, salesOrderId: SO, workOrderId: order.id })

    // The 8 ruined blanks LEFT stock; they were not received into quarantine as
    // though a misprinted tumbler were still sellable.
    expect(result.scrapped.quantity).toBe(-8)
    const quarantined = await prisma.stockMovement.aggregate({ where: { productId: tumbler.id, targetLocationId: scrapLoc.id }, _sum: { quantity: true } })
    expect(quarantined._sum.quantity ?? 0).toBe(0)
  })

  it('AC-176.5 — branded stock cannot be issued for another customer or another order (BR-028)', async () => {
    const [order] = await listCustomizationWorkOrders({ businessId: b(), status: 'COMPLETED', viewer: manager })
    const branded = order.outputProductId

    await expect(recordMovement({ businessId: b(), productId: branded, kind: 'ISSUE', quantity: 1, customerId: 'cust-scg', salesOrderId: 'so-scg-1' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_CUSTOM_COMPONENT_WRONG_CUSTOMER' })
    await expect(recordMovement({ businessId: b(), productId: branded, kind: 'ISSUE', quantity: 1, customerId: PTT, salesOrderId: 'so-other' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_CUSTOM_COMPONENT_WRONG_SALES_ORDER' })

    // The order it was branded for goes through…
    const issued = await recordMovement({ businessId: b(), productId: branded, kind: 'ISSUE', quantity: 2, customerId: PTT, salesOrderId: SO }, { viewer: owner })
    expect(issued.onHandAfter).toBe(500)
    // …and so does the one exit BR-028 leaves open: a stated write-off.
    const writeOff = await recordMovement({ businessId: b(), productId: branded, kind: 'ADJUSTMENT', quantity: -1, reason: 'ORPHANED_CLIENT_CANCEL' }, { viewer: owner })
    expect(writeOff.onHandAfter).toBe(499)
  })

  it('AC-176.6 — a scrap overrun leaves the order BLOCKED_SHORTAGE with the shortfall named, not quietly COMPLETED', async () => {
    const order = await openCustomizationWorkOrder({
      businessId: b(), rawProductId: tumbler.id, technique: 'SILK_SCREEN', netQuantity: 100,
      customerId: 'cust-scg', salesOrderId: 'so-scg-1', sourceLocationId: raw.id, wipLocationId: wip.id, scrapLocationId: scrapLoc.id,
    }, { viewer: owner })
    const released = await releaseCustomizationWorkOrder(order.id, { businessId: b(), version: order.version }, { viewer: owner })
    expect(released.issuedQty).toBe(102)

    const result = await completeCustomizationWorkOrder(released.id, { businessId: b(), version: released.version, completedQty: 90, scrapQty: 12 }, { viewer: owner })
    expect(result.order.status).toBe('BLOCKED_SHORTAGE')
    expect(result.shortfall).toBe(10)
    expect(result.scrapThresholdExceeded).toBe(true)
    expect(result.order.completedAt).toBeNull()

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'CUSTOMIZATION_WORK_ORDER', entityId: order.id } })
    expect(audits.map((a) => a.action)).toEqual(['CUSTOMIZATION_WORK_ORDER_OPENED', 'CUSTOMIZATION_WORK_ORDER_RELEASED', 'CUSTOMIZATION_WORK_ORDER_BLOCKED'])
  })

  it('AC-176.7 — cancelling returns the blanks nobody worked on, and a completed order can never be cancelled', async () => {
    const order = await openCustomizationWorkOrder({
      businessId: b(), rawProductId: tumbler.id, technique: 'UV_DIGITAL_PRINT', netQuantity: 50,
      customerId: 'cust-x', salesOrderId: 'so-x', sourceLocationId: raw.id, wipLocationId: wip.id,
    }, { viewer: owner })
    const released = await releaseCustomizationWorkOrder(order.id, { businessId: b(), version: order.version }, { viewer: owner })
    const atRawBefore = (await prisma.stockMovement.aggregate({ where: { productId: tumbler.id, targetLocationId: raw.id }, _sum: { quantity: true } }))._sum.quantity

    const cancelled = await cancelCustomizationWorkOrder(released.id, { businessId: b(), version: released.version, reason: 'client cancelled before the run' }, { viewer: owner })
    expect(cancelled.order.status).toBe('CANCELLED')
    expect(cancelled.returned.quantity).toBe(51)
    const atRawAfter = (await prisma.stockMovement.aggregate({ where: { productId: tumbler.id, targetLocationId: raw.id }, _sum: { quantity: true } }))._sum.quantity
    expect(atRawAfter).toBe(atRawBefore + 51)

    const [done] = await listCustomizationWorkOrders({ businessId: b(), status: 'COMPLETED', viewer: manager })
    await expect(cancelCustomizationWorkOrder(done.id, { businessId: b(), version: done.version }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'CUSTOMIZATION_WORK_ORDER_COMPLETED' })
  })
})
