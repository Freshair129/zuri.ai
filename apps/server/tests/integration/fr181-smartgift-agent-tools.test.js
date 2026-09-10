// @req FR-181 — the six agent tools against a real database: the registries
//   they land in and the sensitivity they declare, the SKU a customer says
//   resolved through the FlowAccount ExternalRef, the quote that never shows a
//   freight line, the hold that lands on components, the two dispatches that
//   really move stock, and the authority a tool cannot widen.
// @spec ADR-074 D9; SDD-091; ADR-007 §P6, §P7; BR-027; BR-031; BR-032
// @tested tests/integration/fr181-smartgift-agent-tools.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_INVENTORY_MANAGER } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster, setFlowAccountSku } from '@/modules/inventory/application/inventory-catalog-service'
import { createLot, recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { createRecipe } from '@/modules/inventory/application/inventory-recipe-service'
import { createLocation } from '@/modules/inventory/application/warehouse-location-service'
import { DEFAULT_SINGLE_DROP_FREIGHT_SATANG } from '@/modules/inventory'
import {
  smartgiftReadTools,
  smartgiftToolDefinitions,
  smartgiftWriteTools,
  tierForQuantity,
} from '@/modules/agent/tools/smartgift-inventory-tools'

const DOMAINS = ['projects', 'platform', 'inventory']
const DAY = 86400000
const NOW = new Date(Date.UTC(2026, 8, 10))

let business, manager, member, master
let tumbler, powerbank, box, foam, giftSet, recipe, rawLoc, wipLoc, asmLoc, fgLoc
const b = () => business.id
const ctx = (viewer) => ({ viewer, businessId: b(), db: prisma, now: () => NOW })

describe('FR-181 SmartGift agent tools', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-AGT', name: 'Agent Group' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-AGT', name: 'Agent Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-AGT', name: 'SmartGift-like' })
    const owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    manager = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_INVENTORY_MANAGER] } })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: b(), code: 'giftset', nameTh: 'ชุดของขวัญ', nameEn: 'Gift set' }, { viewer: owner })
    master = await createProductMaster({ businessId: b(), code: 'PM-TMS06', categoryId: category.id, nameTh: 'ชุด', nameEn: 'Set' }, { viewer: owner })
    const sku = (code, over = {}) => createProduct({ businessId: b(), code, productMasterId: master.id, name: code, ...over }, { viewer: owner })

    tumbler = await sku('COMP-TUMBLER-SUS304-500ML')
    powerbank = await sku('COMP-PB-10000MAH-MAGSAFE', { trackingMode: 'LOT', maintenanceIntervalDays: 180, maxStorageDays: 240 })
    box = await sku('PKG-BOX-P-16-RIGID', { itemKind: 'PACKAGING_MATERIAL' })
    foam = await sku('PKG-FOAM-EVA-P16-4SLOT', { itemKind: 'PACKAGING_MATERIAL' })
    giftSet = await sku('SET-TMS06-4-P16', { itemKind: 'FINISHED_SET' })
    // What the customer says on LINE is FlowAccount's code, not ours (BR-002).
    await setFlowAccountSku({ businessId: b(), productId: giftSet.id, flowAccountSku: 'TMS06-4(P-16)' }, { viewer: owner })

    rawLoc = await createLocation({ businessId: b(), code: 'AGT-RAW', name: 'วัตถุดิบ', type: 'TH_CENTRAL_RAW' }, { viewer: owner })
    wipLoc = await createLocation({ businessId: b(), code: 'AGT-LASER', name: 'ห้องเลเซอร์', type: 'TH_WIP_CUSTOMIZATION' }, { viewer: owner })
    asmLoc = await createLocation({ businessId: b(), code: 'AGT-ASM', name: 'ไลน์ประกอบ', type: 'TH_WIP_ASSEMBLY' }, { viewer: owner })
    fgLoc = await createLocation({ businessId: b(), code: 'AGT-FG', name: 'สินค้าสำเร็จรูป', type: 'TH_FINISHED_GOODS' }, { viewer: owner })

    await recordMovement({ businessId: b(), productId: tumbler.id, kind: 'RECEIPT', quantity: 1200, targetLocationId: rawLoc.id, costSatang: 11346, occurredAt: NOW }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: box.id, kind: 'RECEIPT', quantity: 1200, targetLocationId: rawLoc.id, costSatang: 4500, occurredAt: NOW }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: foam.id, kind: 'RECEIPT', quantity: 1200, targetLocationId: rawLoc.id, costSatang: 1200, occurredAt: NOW }, { viewer: owner })
    const freshLot = await createLot({ businessId: b(), productId: powerbank.id, code: 'LOT-PB-FRESH', manufacturedAt: new Date(NOW.getTime() - 30 * DAY) }, { viewer: owner })
    const oldLot = await createLot({ businessId: b(), productId: powerbank.id, code: 'LOT-PB-OLD', manufacturedAt: new Date(NOW.getTime() - 200 * DAY) }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: powerbank.id, kind: 'RECEIPT', quantity: 900, lotId: freshLot.id, targetLocationId: rawLoc.id, costSatang: 24000, occurredAt: NOW }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: powerbank.id, kind: 'RECEIPT', quantity: 300, lotId: oldLot.id, targetLocationId: rawLoc.id, costSatang: 24000, occurredAt: NOW }, { viewer: owner })

    recipe = await createRecipe({
      businessId: b(), code: 'RCP-TMS06-4-100', productId: giftSet.id, name: 'TMS06-4(P-16) × 100', batchSize: 100, scrapAllowanceFactor: 0.02,
      lines: [
        { componentProductId: tumbler.id, qty: 100 },
        { componentProductId: powerbank.id, qty: 100 },
        { componentProductId: box.id, qty: 100 },
        { componentProductId: foam.id, qty: 100 },
      ],
    }, { viewer: owner })
  })

  it('AC-181.1 — reads land in the Gate E registry and writes in Gate F, with the two irreversible dispatches marked HIGH', () => {
    const read = smartgiftReadTools(ctx(manager))
    expect(read.list().map((t) => t.name).sort()).toEqual(['audit_battery_lots', 'calculate_smartgift_quote', 'check_inventory_atp'])

    const write = smartgiftWriteTools({ viewer: manager, businessId: b(), now: () => NOW })
    expect(write.list()).toEqual([
      { name: 'create_quote_stock_reservation', sensitivity: 'LOW', description: expect.any(String) },
      { name: 'dispatch_customization_work_order', sensitivity: 'HIGH', description: expect.any(String) },
      { name: 'dispatch_kitting_work_order', sensitivity: 'HIGH', description: expect.any(String) },
    ])
    // Gate E's registry physically cannot hold a write tool, which is the whole
    // point of there being two registries rather than one with a flag.
    expect(() => read.register({ name: 'sneaky_write', readOnly: false })).toThrow(/Gate E forbids write tools/)

    const definitions = smartgiftToolDefinitions()
    expect(definitions.map((d) => d.effect)).toEqual(['READ', 'READ', 'READ', 'WRITE', 'WRITE', 'WRITE'])
    // The advertised shape comes from the same Zod contract the service parses.
    expect(definitions.find((d) => d.name === 'check_inventory_atp').parameters.required).toEqual(['skuCode'])
    expect(definitions.find((d) => d.name === 'dispatch_kitting_work_order').parameters.required).toEqual(['finishedSkuCode', 'quantity'])
  })

  it('AC-181.2 — check_inventory_atp answers the code a customer actually says, through the FlowAccount ref', async () => {
    const read = smartgiftReadTools(ctx(member))
    const result = await read.get('check_inventory_atp').handler({ skuCode: 'TMS06-4(P-16)', targetQuantity: 500 })

    expect(result).toMatchObject({ productId: giftSet.id, canPromise: true })
    // 1,200 tumblers, 1,200 power banks, 1,200 boxes and foams → 1,200 sets.
    expect(result.maxBuildable).toBe(1200)
    expect(result.components.map((c) => c.code).sort()).toEqual(['COMP-PB-10000MAH-MAGSAFE', 'COMP-TUMBLER-SUS304-500ML', 'PKG-BOX-P-16-RIGID', 'PKG-FOAM-EVA-P16-4SLOT'])
    // Our own internal code still resolves, which is what an operator types.
    expect((await read.get('check_inventory_atp').handler({ skuCode: 'SET-TMS06-4-P16' })).productId).toBe(giftSet.id)
    await expect(read.get('check_inventory_atp').handler({ skuCode: 'NOPE-1(P-01)' })).rejects.toMatchObject({ status: 404, message: 'INVENTORY_SKU_NOT_FOUND' })
  })

  it('AC-181.3 — calculate_smartgift_quote absorbs the truck into the unit price and never returns a freight line (BR-027)', async () => {
    const read = smartgiftReadTools(ctx(member))
    const quote = await read.get('calculate_smartgift_quote').handler({
      skuCode: 'TMS06-4(P-16)', quantity: 500,
      customization: { technique: 'LASER_ENGRAVING', locationsCount: 1 },
      deliveryDestination: 'Bangkok',
    })

    expect(quote.tier).toBe('500')
    expect(tierForQuantity(500).grossMargin).toBe(0.25)
    // Components 410.46 ฿ + truck 5.00 ฿ (2,500 / 500) + laser (800/500 + 12.00).
    expect(quote.breakdown).toMatchObject({ base: 41046, freightPerUnit: 500, customizationPerUnit: 1360 })
    expect(quote.unitCostSatang).toBe(41046 + 500 + 1360)
    expect(quote.unitPriceSatang).toBe(Math.ceil(quote.unitCostSatang / 0.75))
    expect(quote.totalPriceSatang).toBe(quote.unitPriceSatang * 500)

    // The one thing a quote must always say, and the figure that makes it auditable.
    expect(quote.freightSatang).toBe(0)
    expect(quote.freightAbsorbedSatang).toBe(DEFAULT_SINGLE_DROP_FREIGHT_SATANG)
    expect(quote.freightNote).toContain('ฟรีค่าจัดส่ง')
    expect(quote.remoteSurchargeRequired).toBe(false)
    // Every default it leaned on is declared rather than presented as fact.
    expect(quote.assumptions.some((a) => a.startsWith('TIER_MARGIN_DEFAULT'))).toBe(true)
    expect(quote.assumptions.some((a) => a.startsWith('CUSTOMIZATION_DEFAULT_RATE'))).toBe(true)

    const island = await read.get('calculate_smartgift_quote').handler({ skuCode: 'TMS06-4(P-16)', quantity: 100, deliveryDestination: 'เกาะสมุย' })
    expect(island.remoteSurchargeRequired).toBe(true)
    expect(island.freightSatang).toBe(0)
    expect(island.tier).toBe('100')
  })

  it('AC-181.4 — audit_battery_lots reports the lots a warehouse must charge before dispatch', async () => {
    const read = smartgiftReadTools(ctx(member))
    const audit = await read.get('audit_battery_lots').handler({ thresholdDays: 180 })
    expect(audit.rows.map((r) => r.lotCode)).toEqual(['LOT-PB-OLD'])
    expect(audit.rows[0]).toMatchObject({ state: 'DUE', ageDays: 200, onHand: 300 })
  })

  it('AC-181.5 — create_quote_stock_reservation holds the COMPONENTS a quoted set needs, and ATP drops accordingly', async () => {
    const write = smartgiftWriteTools({ viewer: manager, businessId: b(), now: () => NOW })
    const result = await write.get('create_quote_stock_reservation').execute({
      tx: prisma, target: { businessId: b() },
      payload: { skuCode: 'TMS06-4(P-16)', quantity: 500, customerName: 'คุณสมชาย', customerCompany: 'PTT PLC', contactPhoneOrLine: '@somchai' },
    })

    expect(result.holdsOn).toBe('COMPONENTS')
    expect(result.reservations).toHaveLength(4)
    expect(result.expiresAt.toISOString()).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString())
    expect(result.reservations.every((r) => r.quantity === 500 && r.customerCompany === 'PTT PLC')).toBe(true)

    const read = smartgiftReadTools(ctx(member))
    const after = await read.get('check_inventory_atp').handler({ skuCode: 'TMS06-4(P-16)', targetQuantity: 800 })
    expect(after.maxBuildable).toBe(700)
    expect(after.canPromise).toBe(false)
  })

  it('AC-181.6 — dispatch_customization_work_order really issues stock, with the buffer, to the workshop', async () => {
    const write = smartgiftWriteTools({ viewer: manager, businessId: b(), now: () => NOW })
    const result = await write.get('dispatch_customization_work_order').execute({
      tx: prisma, target: { businessId: b() },
      payload: {
        rawComponentSku: 'COMP-TUMBLER-SUS304-500ML', technique: 'LASER_ENGRAVING', netQuantity: 500,
        customerId: 'cust-ptt', salesOrderId: 'so-ptt-1', scrapAllowancePercent: 0.02,
        logoArtworkUrl: 'https://files.example/ptt.ai',
        sourceLocationCode: 'AGT-RAW', wipLocationCode: 'AGT-LASER',
      },
    })

    expect(result).toMatchObject({ rawSkuCode: 'COMP-TUMBLER-SUS304-500ML', grossIssueQty: 510, scrapBufferQty: 10 })
    expect(result.workOrder.status).toBe('IN_PROGRESS')
    const staged = await prisma.stockMovement.aggregate({ where: { productId: tumbler.id, targetLocationId: wipLoc.id }, _sum: { quantity: true } })
    expect(staged._sum.quantity).toBe(510)

    await expect(write.get('dispatch_customization_work_order').execute({
      tx: prisma, target: { businessId: b() },
      payload: { rawComponentSku: 'NOPE', technique: 'SILK_SCREEN', netQuantity: 10 },
    })).rejects.toMatchObject({ status: 404, message: 'INVENTORY_SKU_NOT_FOUND' })
  })

  it('AC-181.7 — dispatch_kitting_work_order explodes the BOM and stages the line', async () => {
    const write = smartgiftWriteTools({ viewer: manager, businessId: b(), now: () => NOW })
    const result = await write.get('dispatch_kitting_work_order').execute({
      tx: prisma, target: { businessId: b() },
      payload: {
        finishedSkuCode: 'TMS06-4(P-16)', quantity: 100, salesOrderId: 'so-ptt-1',
        laborCostSatang: 100000, sourceLocationCode: 'AGT-RAW', wipLocationCode: 'AGT-ASM', targetLocationCode: 'AGT-FG',
      },
    })

    expect(result.finishedSkuCode).toBe('SET-TMS06-4-P16')
    expect(result.workOrder.status).toBe('IN_PROGRESS')
    expect(result.plannedLines.find((l) => l.code === 'PKG-BOX-P-16-RIGID')).toMatchObject({ netQty: 100, grossQty: 102 })
    const stagedBoxes = await prisma.stockMovement.aggregate({ where: { productId: box.id, targetLocationId: asmLoc.id }, _sum: { quantity: true } })
    expect(stagedBoxes._sum.quantity).toBe(102)
  })

  it('AC-181.8 — a tool carries the caller\'s authority and cannot widen it (SDD-091)', async () => {
    // A member may look; the same tool bound to the same Business refuses a write.
    const readOnlyMember = smartgiftWriteTools({ viewer: member, businessId: b(), now: () => NOW })
    await expect(readOnlyMember.get('create_quote_stock_reservation').execute({
      tx: prisma, target: { businessId: b() }, payload: { skuCode: 'COMP-TUMBLER-SUS304-500ML', quantity: 1 },
    })).rejects.toMatchObject({ status: 404, message: 'Business not found' })

    // Naming another Business in the target does not reach it either: the
    // viewer, not the argument, is what the service checks.
    const otherWrite = smartgiftWriteTools({ viewer: manager, businessId: b(), now: () => NOW })
    await expect(otherWrite.get('create_quote_stock_reservation').execute({
      tx: prisma, target: { businessId: 'some-other-business' }, payload: { skuCode: 'COMP-TUMBLER-SUS304-500ML', quantity: 1 },
    })).rejects.toMatchObject({ status: 404 })
  })
})
