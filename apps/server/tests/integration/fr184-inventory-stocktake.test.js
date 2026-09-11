// @req FR-184 — real SQLite proof for strict NONE/LOT physical stocktake:
// Business authorization, explicit location/lot joins, durable preview,
// stale refusal, atomic adjustments, idempotency and the shared fence.
// @spec ADR-074 D1, D2; BR-002; BR-008; BR-012; BR-026; SEC-001
// @tested tests/integration/fr184-inventory-stocktake.test.js
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { createLocation } from '@/modules/inventory/application/warehouse-location-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { commitStocktake, previewStocktake } from '@/modules/inventory/application/inventory-stocktake-service'

const DOMAINS = ['projects', 'platform', 'inventory']
let tenant, business, otherBusiness, owner, member
let locationA, locationB, category, master, noneProduct, lotProduct, serialProduct, otherProduct, lot
let independentDb

const line = (productId, locationId, countedQuantity, lotId = null) => ({ productId, locationId, lotId, countedQuantity })

describe('FR-184 Inventory physical stocktake', () => {
  beforeAll(async () => {
    independentDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
    const portfolio = await createPortfolio({ code: 'PF-STOCKTAKE', name: 'Stocktake Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-STOCKTAKE', name: 'Stocktake Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-STOCKTAKE', name: 'Stocktake Business' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-STOCKTAKE-B', name: 'Other Stocktake Business' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS })

    locationA = await createLocation({ businessId: business.id, code: 'ST-LOC-A', name: 'Shelf A', type: 'TH_FINISHED_GOODS' }, { viewer: owner })
    locationB = await createLocation({ businessId: business.id, code: 'ST-LOC-B', name: 'Shelf B', type: 'TH_CENTRAL_RAW' }, { viewer: owner })
    const otherLocation = await createLocation({ businessId: otherBusiness.id, code: 'ST-LOC-B-OTHER', name: 'Other shelf', type: 'TH_FINISHED_GOODS' }, { viewer: makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: DOMAINS }) })
    expect(otherLocation.businessId).toBe(otherBusiness.id)
    category = await createCategory({ businessId: business.id, code: 'ST-CAT', nameTh: 'ทดสอบ', nameEn: 'Test' }, { viewer: owner })
    master = await createProductMaster({ businessId: business.id, code: 'ST-PM', categoryId: category.id, nameTh: 'สินค้าตรวจนับ', nameEn: 'Stocktake item' }, { viewer: owner })
    noneProduct = await createProduct({ businessId: business.id, code: 'ST-NONE', productMasterId: master.id, name: 'Counted item', trackingMode: 'NONE' }, { viewer: owner })
    lotProduct = await createProduct({ businessId: business.id, code: 'ST-LOT', productMasterId: master.id, name: 'Lot item', trackingMode: 'LOT' }, { viewer: owner })
    serialProduct = await createProduct({ businessId: business.id, code: 'ST-SERIAL', productMasterId: master.id, name: 'Serial item', trackingMode: 'SERIAL' }, { viewer: owner })
    const otherViewer = makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: DOMAINS })
    const otherCategory = await createCategory({ businessId: otherBusiness.id, code: 'ST-CAT-OTHER', nameTh: 'อื่น', nameEn: 'Other' }, { viewer: otherViewer })
    const otherMaster = await createProductMaster({ businessId: otherBusiness.id, code: 'ST-PM-OTHER', categoryId: otherCategory.id, nameTh: 'อื่น', nameEn: 'Other' }, { viewer: otherViewer })
    otherProduct = await createProduct({ businessId: otherBusiness.id, code: 'ST-OTHER', productMasterId: otherMaster.id, trackingMode: 'NONE' }, { viewer: otherViewer })
    lot = await (await import('@/modules/inventory/application/inventory-stock-service')).createLot({ businessId: business.id, productId: lotProduct.id, code: 'ST-LOT-1' }, { viewer: owner })

    await recordMovement({ businessId: business.id, productId: noneProduct.id, kind: 'RECEIPT', quantity: 10, targetLocationId: locationA.id }, { viewer: owner })
    await recordMovement({ businessId: business.id, productId: noneProduct.id, kind: 'RECEIPT', quantity: 2 }, { viewer: owner })
    await recordMovement({ businessId: business.id, productId: lotProduct.id, kind: 'RECEIPT', quantity: 5, lotId: lot.id, targetLocationId: locationA.id }, { viewer: owner })
    await recordMovement({ businessId: business.id, productId: noneProduct.id, kind: 'RECEIPT', quantity: 4, targetLocationId: locationB.id }, { viewer: owner })
  })

  afterAll(async () => {
    await independentDb?.$disconnect()
  })

  it('refuses unauthorized, cross-Business, SERIAL and invalid NONE/LOT inputs', async () => {
    await expect(previewStocktake({ businessId: business.id, lines: [line(noneProduct.id, locationA.id, 10)] }, { viewer: member }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(previewStocktake({ businessId: business.id, lines: [line(otherProduct.id, locationA.id, 0)] }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_STOCKTAKE_PRODUCT_NOT_FOUND' })
    await expect(previewStocktake({ businessId: business.id, lines: [line(serialProduct.id, locationA.id, 0)] }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_STOCKTAKE_SERIAL_UNSUPPORTED' })
    await expect(previewStocktake({ businessId: business.id, lines: [line(lotProduct.id, locationA.id, 5)] }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_STOCKTAKE_LOT_REQUIRED' })
    await expect(previewStocktake({ businessId: business.id, lines: [line(noneProduct.id, locationA.id, 1.5)] }, { viewer: owner })).rejects.toThrow()
    await expect(previewStocktake({ businessId: business.id, lines: [line(noneProduct.id, locationA.id, 10, lot.id)] }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_STOCKTAKE_LOT_NOT_ALLOWED' })
  })

  it('persists a preview without movement/audit and refuses an omitted unlocated bucket', async () => {
    const beforeMovements = await prisma.stockMovement.count({ where: { businessId: business.id } })
    const beforeAudits = await prisma.auditEvent.count({ where: { entityType: 'INVENTORY_STOCKTAKE', entityId: { not: '' } } })
    const preview = await previewStocktake({ businessId: business.id, lines: [line(noneProduct.id, locationA.id, 8)] }, { viewer: owner })
    expect(preview).toMatchObject({ status: 'PREVIEWED', complete: false, snapshotVersion: expect.any(Number), generatedAt: expect.any(String) })
    expect(preview.missingBuckets).toEqual(expect.arrayContaining([expect.objectContaining({ productId: noneProduct.id, locationId: null, expectedQuantity: 2 })]))
    expect(await prisma.stockMovement.count({ where: { businessId: business.id } })).toBe(beforeMovements)
    expect(await prisma.auditEvent.count({ where: { entityType: 'INVENTORY_STOCKTAKE', entityId: { not: '' } } })).toBe(beforeAudits)
    await expect(commitStocktake({ businessId: business.id, previewId: preview.previewId, snapshotToken: preview.snapshotToken, idempotencyKey: 'st-incomplete', lines: [line(noneProduct.id, locationA.id, 8)] }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_STOCKTAKE_INCOMPLETE' })
    expect((await prisma.inventoryStocktake.findUnique({ where: { id: preview.previewId } })).status).toBe('PREVIEWED')
  })

  it('allows a selected location while leaving another location outside the operation', async () => {
    // locationB is deliberately outside this request; only the chosen bucket
    // and any unlocated bucket are required to complete.
    const preview = await previewStocktake({ businessId: business.id, lines: [line(noneProduct.id, locationA.id, 10), line(noneProduct.id, null, 2)] }, { viewer: owner })
    expect(preview.complete).toBe(true)
    expect(preview.missingBuckets).toEqual([])
  })

  it('commits NONE and LOT variances atomically, advances the fence once per movement, and retries deterministically', async () => {
    const beforeFence = await prisma.inventoryLedgerFence.findUnique({ where: { tenantId_businessId: { tenantId: tenant.id, businessId: business.id } } })
    const preview = await previewStocktake({ businessId: business.id, lines: [line(noneProduct.id, locationA.id, 8), line(noneProduct.id, null, 2), line(lotProduct.id, locationA.id, 7, lot.id)] }, { viewer: owner })
    expect(preview.complete).toBe(true)
    const request = { businessId: business.id, previewId: preview.previewId, snapshotToken: preview.snapshotToken, idempotencyKey: 'st-success', lines: preview.lines.map(({ productId, locationId, lotId, countedQuantity }) => ({ productId, locationId, lotId, countedQuantity })) }
    const committed = await commitStocktake(request, { viewer: owner })
    expect(committed).toMatchObject({ status: 'COMMITTED', generatedAt: expect.any(String), result: { movementCount: 2, lineBalances: expect.any(Array) } })
    expect(committed.result.lineBalances).toEqual(expect.arrayContaining([expect.objectContaining({ productId: noneProduct.id, locationId: locationA.id, postCommitQuantity: 8, variance: -2 }), expect.objectContaining({ productId: lotProduct.id, locationId: locationA.id, lotId: lot.id, postCommitQuantity: 7, variance: 2 })]))
    const movements = await prisma.stockMovement.findMany({ where: { businessId: business.id, reference: `STOCKTAKE:${preview.previewId}` }, orderBy: { createdAt: 'asc' } })
    expect(movements.map((movement) => movement.quantity)).toEqual(expect.arrayContaining([-2, 2]))
    const committedFence = await prisma.inventoryLedgerFence.findUnique({ where: { tenantId_businessId: { tenantId: tenant.id, businessId: business.id } } })
    expect(committedFence.mutationRevision).toBe(beforeFence.mutationRevision + 2)
    const auditCount = await prisma.auditEvent.count({ where: { entityType: 'INVENTORY_STOCKTAKE', entityId: preview.previewId, action: 'INVENTORY_STOCKTAKE_COMMITTED' } })
    expect(auditCount).toBe(1)
    const retried = await commitStocktake(request, { viewer: owner })
    expect(retried.result).toEqual(committed.result)
    expect(await prisma.stockMovement.count({ where: { businessId: business.id, reference: `STOCKTAKE:${preview.previewId}` } })).toBe(2)
    await expect(commitStocktake({ ...request, lines: request.lines.map((entry) => entry.productId === noneProduct.id && entry.locationId === locationA.id ? { ...entry, countedQuantity: 9 } : entry) }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_STOCKTAKE_IDEMPOTENCY_CONFLICT' })
  })

  it('returns a strict stale refusal after a movement and writes no partial adjustment', async () => {
    const preview = await previewStocktake({ businessId: business.id, lines: [line(noneProduct.id, locationA.id, 8), line(noneProduct.id, null, 2)] }, { viewer: owner })
    await recordMovement({ businessId: business.id, productId: noneProduct.id, kind: 'RECEIPT', quantity: 1, targetLocationId: locationA.id }, { viewer: owner })
    await expect(commitStocktake({ businessId: business.id, previewId: preview.previewId, snapshotToken: preview.snapshotToken, idempotencyKey: 'st-stale', lines: preview.lines.map(({ productId, locationId, lotId, countedQuantity }) => ({ productId, locationId, lotId, countedQuantity })) }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE' })
    expect((await prisma.inventoryStocktake.findUnique({ where: { id: preview.previewId } })).status).toBe('PREVIEWED')
    expect(await prisma.stockMovement.count({ where: { businessId: business.id, reference: `STOCKTAKE:${preview.previewId}` } })).toBe(0)
  })

  it('keeps same-key zero-variance retries as one durable no-op under real concurrent requests', async () => {
    const expected = (await prisma.stockMovement.aggregate({ where: { businessId: business.id, productId: lotProduct.id }, _sum: { quantity: true } }))._sum.quantity
    const preview = await previewStocktake({ businessId: business.id, lines: [line(lotProduct.id, locationA.id, expected, lot.id)] }, { viewer: owner })
    expect(preview.complete).toBe(true)
    const request = { businessId: business.id, previewId: preview.previewId, snapshotToken: preview.snapshotToken, idempotencyKey: 'st-concurrent-noop', lines: [line(lotProduct.id, locationA.id, expected, lot.id)] }
    const results = await Promise.all([
      commitStocktake(request, { viewer: owner, db: prisma }),
      commitStocktake(request, { viewer: owner, db: independentDb }),
    ])
    expect(results[0].result).toEqual(results[1].result)
    expect(results[0].result.movementCount).toBe(0)
    expect(await prisma.auditEvent.count({ where: { entityType: 'INVENTORY_STOCKTAKE', entityId: preview.previewId, action: 'INVENTORY_STOCKTAKE_COMMITTED' } })).toBe(1)
  })

  it('serializes different-key concurrent mutations and leaves the loser stale without a partial adjustment', async () => {
    const existingMovements = await prisma.stockMovement.findMany({ where: { businessId: business.id, productId: noneProduct.id }, select: { quantity: true, sourceLocationId: true, targetLocationId: true } })
    const expected = existingMovements.reduce((sum, movement) => {
      if (movement.targetLocationId === locationA.id || movement.sourceLocationId === locationA.id) return sum + movement.quantity
      return sum
    }, 0)
    const expectedUnlocated = existingMovements.reduce((sum, movement) => {
      if (movement.targetLocationId === null && movement.sourceLocationId === null) return sum + movement.quantity
      return sum
    }, 0)
    const countedQuantity = expected + 1
    const requestLines = [line(noneProduct.id, locationA.id, countedQuantity), line(noneProduct.id, null, expectedUnlocated)]
    const [previewA, previewB] = await Promise.all([
      previewStocktake({ businessId: business.id, lines: requestLines }, { viewer: owner, db: prisma }),
      previewStocktake({ businessId: business.id, lines: requestLines }, { viewer: owner, db: independentDb }),
    ])
    expect(previewA.snapshotVersion).toBe(previewB.snapshotVersion)
    const requests = [previewA, previewB].map((preview, index) => ({
      businessId: business.id,
      previewId: preview.previewId,
      snapshotToken: preview.snapshotToken,
      idempotencyKey: `st-concurrent-mutation-${index}`,
      lines: requestLines,
    }))
    const outcomes = await Promise.allSettled([
      commitStocktake(requests[0], { viewer: owner, db: prisma }),
      commitStocktake(requests[1], { viewer: owner, db: independentDb }),
    ])
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatchObject({ status: 409, message: 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE' })
    expect(fulfilled[0].value.result.movementCount).toBe(1)
    const movementCount = await prisma.stockMovement.count({ where: { businessId: business.id, reference: { in: requests.map((request) => `STOCKTAKE:${request.previewId}`) } } })
    expect(movementCount).toBe(1)
  })
})
