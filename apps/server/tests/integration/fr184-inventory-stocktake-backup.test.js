// @req FR-184, FR-045 — the physical stocktake fence and durable preview/result
// survive the existing installation-wide snapshot replacement transaction.
// @spec ADR-074 D1, D2; BR-008; SEC-001
// @tested tests/integration/fr184-inventory-stocktake-backup.test.js
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import {
  exportSnapshot,
  importSnapshot,
  INVENTORY_STOCKTAKE_RECOVERY_MANIFEST_VERSION,
  previewImport,
} from '@/modules/project-manager/application/backup-service'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { createLocation } from '@/modules/inventory/application/warehouse-location-service'
import { commitStocktake, previewStocktake } from '@/modules/inventory/application/inventory-stocktake-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { hashStocktake, INT32_MAX } from '@/modules/inventory/domain/inventory-stocktake'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'

const DOMAINS = ['projects', 'platform', 'inventory']
const line = (productId, locationId, countedQuantity) => ({ productId, locationId, lotId: null, countedQuantity })

let business, tenant, owner, product, location, committedPreview, pendingPreview, snapshot, originalFence, originalRows

function rowEvidence(row) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash,
    normalizedLinesJson: row.normalizedLinesJson,
    snapshotVersion: row.snapshotVersion,
    snapshotHash: row.snapshotHash,
    status: row.status,
    resultJson: row.resultJson,
    committedAt: row.committedAt,
    version: row.version,
  }
}

describe('FR-184 stocktake snapshot recovery', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-STOCKTAKE-BACKUP', name: 'Stocktake backup group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-STOCKTAKE-BACKUP', name: 'Stocktake backup tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-STOCKTAKE-BACKUP', name: 'Stocktake backup business' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    const category = await createCategory({ businessId: business.id, code: 'ST-BACKUP-CAT', nameTh: 'สำรอง', nameEn: 'Backup' }, { viewer: owner })
    const master = await createProductMaster({ businessId: business.id, code: 'ST-BACKUP-PM', categoryId: category.id, nameTh: 'สินค้า', nameEn: 'Product' }, { viewer: owner })
    product = await createProduct({ businessId: business.id, code: 'ST-BACKUP-SKU', productMasterId: master.id, name: 'Backup stocktake item', trackingMode: 'NONE' }, { viewer: owner })
    location = await createLocation({ businessId: business.id, code: 'ST-BACKUP-LOC', name: 'Backup shelf', type: 'TH_FINISHED_GOODS' }, { viewer: owner })

    await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 5, targetLocationId: location.id }, { viewer: owner })
    committedPreview = await previewStocktake({ businessId: business.id, lines: [line(product.id, location.id, 6)] }, { viewer: owner })
    await commitStocktake({
      businessId: business.id,
      previewId: committedPreview.previewId,
      snapshotToken: committedPreview.snapshotToken,
      idempotencyKey: 'backup-committed',
      lines: [line(product.id, location.id, 6)],
    }, { viewer: owner })
    pendingPreview = await previewStocktake({ businessId: business.id, lines: [line(product.id, location.id, 6)] }, { viewer: owner })
    // This movement intentionally follows both stocktake rows. The committed
    // result remains valid historical evidence while the pending preview is
    // stale; recovery must preserve both without requiring equal fence values.
    await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 1, targetLocationId: location.id }, { viewer: owner })
    snapshot = await exportSnapshot()
    originalFence = await prisma.inventoryLedgerFence.findUnique({ where: { tenantId_businessId: { tenantId: tenant.id, businessId: business.id } } })
    originalRows = await prisma.inventoryStocktake.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } })
  })

  it('exports both rows and restores exact evidence twice, then continues the fence', async () => {
    expect(snapshot.inventoryStocktakeRecovery).toEqual({
      schemaVersion: INVENTORY_STOCKTAKE_RECOVERY_MANIFEST_VERSION,
      requiredTables: ['inventoryLedgerFence', 'inventoryStocktake'],
    })
    expect(snapshot.tables.inventoryLedgerFence.filter((row) => row.businessId === business.id)).toHaveLength(1)
    expect(snapshot.tables.inventoryStocktake.filter((row) => row.businessId === business.id)).toHaveLength(2)
    expect(originalFence.mutationRevision).toBeGreaterThan(0)
    expect(originalRows.map((row) => row.status)).toEqual(expect.arrayContaining(['COMMITTED', 'PREVIEWED']))

    await prisma.inventoryStocktake.deleteMany({ where: { businessId: business.id } })
    await prisma.inventoryLedgerFence.update({ where: { id: originalFence.id }, data: { mutationRevision: 0 } })
    expect(await prisma.inventoryStocktake.count({ where: { businessId: business.id } })).toBe(0)

    const first = await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })
    expect(first.restored).toBe(true)
    expect(first.inventoryStocktakeRecovery).toMatchObject({ status: 'AVAILABLE', manifestVersion: INVENTORY_STOCKTAKE_RECOVERY_MANIFEST_VERSION })
    expect(await prisma.inventoryLedgerFence.findUnique({ where: { id: originalFence.id } })).toMatchObject({ mutationRevision: originalFence.mutationRevision })
    expect((await prisma.inventoryStocktake.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } })).map(rowEvidence)).toEqual(originalRows.map(rowEvidence))

    const second = await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })
    expect(second.restored).toBe(true)
    expect(await prisma.inventoryStocktake.count({ where: { businessId: business.id } })).toBe(2)
    expect((await prisma.inventoryStocktake.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } })).map(rowEvidence)).toEqual(originalRows.map(rowEvidence))

    await recordMovement({ businessId: business.id, productId: product.id, kind: 'RECEIPT', quantity: 1, targetLocationId: location.id }, { viewer: owner })
    const continuedFence = await prisma.inventoryLedgerFence.findUnique({ where: { id: originalFence.id } })
    expect(continuedFence.mutationRevision).toBe(originalFence.mutationRevision + 1)
    await expect(commitStocktake({
      businessId: business.id,
      previewId: pendingPreview.previewId,
      snapshotToken: pendingPreview.snapshotToken,
      idempotencyKey: 'backup-pending-after-restore',
      lines: [line(product.id, location.id, 6)],
    }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE' })
    expect(await prisma.stockMovement.count({ where: { businessId: business.id, reference: `STOCKTAKE:${pendingPreview.previewId}` } })).toBe(0)
  })

  it('rejects a declared manifest with missing arrays even on an empty target', async () => {
    const db = new Proxy({}, { get: () => ({ count: vi.fn().mockResolvedValue(0) }) })
    const invalid = {
      schemaVersion: '1.0',
      inventoryStocktakeRecovery: {
        schemaVersion: INVENTORY_STOCKTAKE_RECOVERY_MANIFEST_VERSION,
        requiredTables: ['inventoryLedgerFence', 'inventoryStocktake'],
      },
      tables: { inventoryLedgerFence: [] },
    }
    const result = await previewImport(invalid, { db, viewer: makeOperatorViewer() })
    expect(result).toMatchObject({ valid: false, inventoryStocktakeRecovery: { status: 'INVALID' } })
    expect(result.errors).toContain('Inventory stocktake recovery snapshot is missing required table: inventoryStocktake')
  })

  it('reports legacy stocktake recovery as unavailable and refuses to erase current evidence', async () => {
    const db = new Proxy({}, {
      get: (_target, model) => ({ count: vi.fn().mockResolvedValue(['inventoryLedgerFence', 'inventoryStocktake'].includes(model) ? 1 : 0) }),
    })
    const legacy = { schemaVersion: '1.0', tables: { inventoryLedgerFence: [], inventoryStocktake: [] } }
    const result = await previewImport(legacy, { db, viewer: makeOperatorViewer() })
    expect(result).toMatchObject({ valid: false, inventoryStocktakeRecovery: { status: 'UNAVAILABLE' } })
    expect(result.errors).toContain('Inventory stocktake recovery is unavailable while the installation contains stocktake rows; refusing a restore that would erase evidence')
  })

  it('rejects malformed normalized line fields without throwing', async () => {
    for (const [label, requestLines, lines, expected] of [
      ['null line entries', [null], [null], 'has a malformed request line'],
      ['non-array line fields', {}, {}, 'has an invalid normalized snapshot shape'],
    ]) {
      const corrupt = structuredClone(snapshot)
      const row = corrupt.tables.inventoryStocktake.find((item) => item.id === pendingPreview.previewId)
      const normalized = JSON.parse(row.normalizedLinesJson)
      normalized.requestLines = requestLines
      normalized.lines = lines
      row.normalizedLinesJson = JSON.stringify(normalized)
      const result = await previewImport(corrupt, { viewer: makeOperatorViewer() })
      expect(result.valid, label).toBe(false)
      expect(result.inventoryStocktakeRecovery.errors.join(' '), label).toContain(expected)
    }
  })

  it('rejects committed results that cannot reconcile their movement evidence', async () => {
    const committed = snapshot.tables.inventoryStocktake.find((item) => item.id === committedPreview.previewId)
    const committedResult = JSON.parse(committed.resultJson)
    const movementId = committedResult.movementIds[0]
    const cases = [
      ['missing movement', (corrupt) => {
        corrupt.tables.stockMovement = corrupt.tables.stockMovement.filter((movement) => movement.id !== movementId)
      }, `references missing StockMovement ${movementId}`],
      ['wrong scope', (corrupt) => {
        corrupt.tables.stockMovement.find((movement) => movement.id === movementId).businessId = 'foreign-business'
      }, 'outside its Tenant/Business scope'],
      ['wrong kind', (corrupt) => {
        corrupt.tables.stockMovement.find((movement) => movement.id === movementId).kind = 'RECEIPT'
      }, 'non-ADJUSTMENT StockMovement'],
      ['wrong reference', (corrupt) => {
        corrupt.tables.stockMovement.find((movement) => movement.id === movementId).reference = 'OTHER-STOCKTAKE'
      }, 'inconsistent reference'],
      ['duplicate movement id', (corrupt) => {
        const row = corrupt.tables.inventoryStocktake.find((item) => item.id === committedPreview.previewId)
        const result = JSON.parse(row.resultJson)
        result.movementIds = [movementId, movementId]
        result.movementCount = 2
        row.resultJson = JSON.stringify(result)
      }, 'duplicate StockMovement id'],
      ['inconsistent movement count', (corrupt) => {
        const row = corrupt.tables.inventoryStocktake.find((item) => item.id === committedPreview.previewId)
        const result = JSON.parse(row.resultJson)
        result.movementCount = 2
        row.resultJson = JSON.stringify(result)
      }, 'movementCount inconsistent with movementIds'],
    ]

    for (const [label, mutate, expected] of cases) {
      const corrupt = structuredClone(snapshot)
      mutate(corrupt)
      const result = await previewImport(corrupt, { viewer: makeOperatorViewer() })
      expect(result.valid, label).toBe(false)
      expect(result.inventoryStocktakeRecovery.errors.join(' '), label).toContain(expected)
    }
  })

  it('requires result lines to preserve the committed post-count balance', async () => {
    const corrupt = structuredClone(snapshot)
    const row = corrupt.tables.inventoryStocktake.find((item) => item.id === committedPreview.previewId)
    const resultJson = JSON.parse(row.resultJson)
    resultJson.lineBalances[0].postCommitQuantity += 1
    row.resultJson = JSON.stringify(resultJson)
    const result = await previewImport(corrupt, { viewer: makeOperatorViewer() })
    expect(result.valid).toBe(false)
    expect(result.inventoryStocktakeRecovery.errors).toContain(`Inventory stocktake ${row.id} has an invalid post-commit quantity`)
  })

  it('accepts a valid multi-line aggregate variance above one Int32 value', async () => {
    const corrupt = structuredClone(snapshot)
    const row = corrupt.tables.inventoryStocktake.find((item) => item.id === committedPreview.previewId)
    const normalized = JSON.parse(row.normalizedLinesJson)
    const first = normalized.lines[0]
    const second = { ...first, locationId: null, countedQuantity: 1, expectedQuantity: 0, variance: 1 }
    first.countedQuantity = INT32_MAX
    first.expectedQuantity = 0
    first.variance = INT32_MAX
    normalized.requestLines = [
      { productId: first.productId, locationId: first.locationId, lotId: first.lotId, countedQuantity: INT32_MAX },
      { productId: second.productId, locationId: second.locationId, lotId: second.lotId, countedQuantity: 1 },
    ]
    normalized.lines = [first, second]
    normalized.missingBuckets = []
    normalized.complete = true
    const hashable = { ...normalized }
    delete hashable.snapshotHash
    normalized.snapshotHash = hashStocktake({ businessId: row.businessId, snapshotVersion: row.snapshotVersion, ...hashable })
    row.snapshotHash = normalized.snapshotHash
    row.normalizedLinesJson = JSON.stringify(normalized)

    const originalMovement = corrupt.tables.stockMovement.find((movement) => movement.id === JSON.parse(row.resultJson).movementIds[0])
    originalMovement.quantity = INT32_MAX
    originalMovement.sourceLocationId = null
    originalMovement.targetLocationId = first.locationId
    const additionalMovement = { ...originalMovement, id: randomUUID(), quantity: 1, targetLocationId: null }
    corrupt.tables.stockMovement.push(additionalMovement)
    const resultJson = JSON.parse(row.resultJson)
    resultJson.movementIds = [resultJson.movementIds[0], additionalMovement.id]
    resultJson.movementCount = 2
    resultJson.varianceTotal = INT32_MAX + 1
    resultJson.lineBalances = [
      { ...resultJson.lineBalances[0], countedQuantity: INT32_MAX, expectedQuantity: 0, variance: INT32_MAX, postCommitQuantity: INT32_MAX },
      { productId: second.productId, locationId: null, lotId: null, countedQuantity: 1, expectedQuantity: 0, variance: 1, postCommitQuantity: 1 },
    ]
    row.resultJson = JSON.stringify(resultJson)

    const result = await previewImport(corrupt, { viewer: makeOperatorViewer() })
    expect(result.valid).toBe(true)
    expect(result.inventoryStocktakeRecovery).toMatchObject({ status: 'AVAILABLE', errors: [] })
  })
})
