// @req FR-184, FR-045 — the physical stocktake fence and durable preview/result
// survive the existing installation-wide snapshot replacement transaction.
// @spec ADR-074 D1, D2; BR-008; SEC-001
// @tested tests/integration/fr184-inventory-stocktake-backup.test.js
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
})
