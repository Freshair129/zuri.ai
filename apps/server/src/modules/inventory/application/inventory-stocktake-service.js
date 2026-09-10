import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { appendMovement, acquireLedgerFence } from './inventory-stock-service'
import { loadBusiness } from './inventory-authority'
import {
  assertInt32,
  hashStocktake,
  INVENTORY_STOCKTAKE_ENTITY,
  normalizeStocktakeLines,
  newStocktakePreviewId,
  zStocktakeCommitInput,
  zStocktakePreviewInput,
} from '../domain/inventory-stocktake'

// @req FR-184 — preview and commit of a physical stocktake. A preview is
// durable evidence without a stock movement; commit validates the same
// normalized observation under the Business fence and appends signed
// ADJUSTMENT rows through the FR-155 writer in one transaction.
// @spec ADR-074 D1, D2; BR-002, BR-008, BR-012, BR-026; SEC-001
// @tested tests/integration/fr184-inventory-stocktake.test.js,
//   tests/integration/fr184-inventory-stocktake-backup.test.js

const failure = (status, message, details) => Object.assign(new Error(message), { status, ...(details ? { details } : {}) })
const actor = (viewer) => viewer?.principal?.id ?? null

const PRODUCT_SELECT = {
  id: true, code: true, businessId: true, trackingMode: true, stockPolicy: true,
  status: true, unit: true,
}
const LOCATION_SELECT = { id: true, code: true, name: true, businessId: true, status: true }
const LOT_SELECT = { id: true, code: true, productId: true, businessId: true, status: true }
const MOVEMENT_SELECT = { productId: true, lotId: true, quantity: true, sourceLocationId: true, targetLocationId: true }

const bucketKey = (productId, locationId, lotId) => [productId, locationId ?? 'UNLOCATED', lotId ?? 'NO_LOT'].join('|')

function parseStoredSnapshot(row) {
  try {
    const snapshot = JSON.parse(row.normalizedLinesJson)
    if (!snapshot || !Array.isArray(snapshot.requestLines) || !Array.isArray(snapshot.lines)) throw new Error('bad snapshot')
    return snapshot
  } catch {
    throw failure(500, 'INVENTORY_STOCKTAKE_SNAPSHOT_CORRUPT')
  }
}

function lineIdentity(line, products, locations, lots) {
  const product = products.get(line.productId)
  const location = line.locationId ? locations.get(line.locationId) : null
  const lot = line.lotId ? lots.get(line.lotId) : null
  return {
    ...line,
    productCode: product.code,
    productName: product.name ?? null,
    locationCode: location?.code ?? null,
    locationName: location?.name ?? null,
    lotCode: lot?.code ?? null,
  }
}

async function loadAndValidateReferences(tx, business, lines) {
  const productIds = [...new Set(lines.map((line) => line.productId))]
  const products = await tx.product.findMany({ where: { businessId: business.id, id: { in: productIds } }, select: { ...PRODUCT_SELECT, name: true } })
  const productsById = new Map(products.map((product) => [product.id, product]))
  for (const productId of productIds) {
    const product = productsById.get(productId)
    if (!product) throw failure(422, 'INVENTORY_STOCKTAKE_PRODUCT_NOT_FOUND')
    if (product.status === 'ARCHIVED') throw failure(409, 'INVENTORY_STOCKTAKE_PRODUCT_ARCHIVED')
    if (product.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_STOCKTAKE_PRODUCT_NOT_TRACKED')
    if (product.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_STOCKTAKE_SERIAL_UNSUPPORTED')
    if (!['NONE', 'LOT'].includes(product.trackingMode)) throw failure(422, 'INVENTORY_STOCKTAKE_TRACKING_UNSUPPORTED')
  }

  const locationIds = [...new Set(lines.flatMap((line) => line.locationId ? [line.locationId] : []))]
  const locations = await tx.warehouseLocation.findMany({ where: { businessId: business.id, id: { in: locationIds }, status: { not: 'ARCHIVED' } }, select: LOCATION_SELECT })
  const locationsById = new Map(locations.map((location) => [location.id, location]))
  for (const locationId of locationIds) if (!locationsById.has(locationId)) throw failure(422, 'INVENTORY_STOCKTAKE_LOCATION_NOT_FOUND')

  const lotIds = [...new Set(lines.flatMap((line) => line.lotId ? [line.lotId] : []))]
  const lots = await tx.productLot.findMany({ where: { businessId: business.id, id: { in: lotIds } }, select: LOT_SELECT })
  const lotsById = new Map(lots.map((lot) => [lot.id, lot]))
  for (const line of lines) {
    const product = productsById.get(line.productId)
    if (product.trackingMode === 'LOT' && !line.lotId) throw failure(422, 'INVENTORY_STOCKTAKE_LOT_REQUIRED')
    if (product.trackingMode === 'NONE' && line.lotId) throw failure(422, 'INVENTORY_STOCKTAKE_LOT_NOT_ALLOWED')
    if (line.lotId) {
      const lot = lotsById.get(line.lotId)
      if (!lot || lot.productId !== line.productId) throw failure(422, 'INVENTORY_STOCKTAKE_LOT_NOT_FOUND')
    }
  }
  return { products: productsById, locations: locationsById, lots: lotsById }
}

function addExpected(map, key, quantity) {
  const next = (map.get(key) ?? 0) + quantity
  assertInt32(next)
  map.set(key, next)
}

async function buildSnapshot(tx, business, lines, fence) {
  const references = await loadAndValidateReferences(tx, business, lines)
  const movements = await tx.stockMovement.findMany({
    where: { businessId: business.id, productId: { in: [...references.products.keys()] } },
    select: MOVEMENT_SELECT,
  })
  const expectedByBucket = new Map()
  for (const movement of movements) {
    const locationId = movement.quantity > 0 ? movement.targetLocationId : movement.sourceLocationId
    addExpected(expectedByBucket, bucketKey(movement.productId, locationId, movement.lotId), movement.quantity)
  }

  const snapshotLines = lines.map((line) => {
    const expectedQuantity = expectedByBucket.get(bucketKey(line.productId, line.locationId, line.lotId)) ?? 0
    const variance = assertInt32(line.countedQuantity - expectedQuantity)
    return { ...lineIdentity(line, references.products, references.locations, references.lots), expectedQuantity, variance }
  })
  const lineKeys = new Set(snapshotLines.map((line) => bucketKey(line.productId, line.locationId, line.lotId)))
  // A request may intentionally cover one configured location while another
  // location remains outside this operation. The one bucket that cannot be
  // silently omitted is unlocated stock: there is no configured location to
  // explain where it went. For selected locations, every positive bucket at
  // that location must still be represented (including each LOT).
  const selectedLocations = new Set(lines.map((line) => line.locationId))
  const missingBuckets = [...expectedByBucket.entries()]
    .filter(([key, quantity]) => {
      if (quantity === 0 || lineKeys.has(key)) return false
      const [, locationValue] = key.split('|')
      const locationId = locationValue === 'UNLOCATED' ? null : locationValue
      return locationId === null || selectedLocations.has(locationId)
    })
    .map(([key, expectedQuantity]) => {
      const [productId, locationValue, lotValue] = key.split('|')
      return {
        productId,
        locationId: locationValue === 'UNLOCATED' ? null : locationValue,
        lotId: lotValue === 'NO_LOT' ? null : lotValue,
        expectedQuantity,
      }
    })
  const complete = missingBuckets.length === 0
  const requestLines = lines.map(({ productId, locationId, lotId, countedQuantity }) => ({ productId, locationId, lotId, countedQuantity }))
  const snapshot = { requestLines, lines: snapshotLines, complete, missingBuckets }
  return {
    ...snapshot,
    snapshotVersion: fence.mutationRevision,
    snapshotHash: hashStocktake({ businessId: business.id, snapshotVersion: fence.mutationRevision, ...snapshot }),
  }
}

function publicSnapshot(row, snapshot, extra = {}) {
  return {
    previewId: row.id,
    businessId: row.businessId,
    status: row.status,
    generatedAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    snapshotToken: row.snapshotHash,
    snapshotVersion: row.snapshotVersion,
    lines: snapshot.lines,
    complete: snapshot.complete,
    missingBuckets: snapshot.missingBuckets,
    ...(extra.result ? { result: extra.result } : {}),
  }
}

function resultFromRow(row) {
  const snapshot = parseStoredSnapshot(row)
  const result = row.resultJson ? JSON.parse(row.resultJson) : null
  return publicSnapshot(row, snapshot, { result })
}

export async function previewStocktake(input, { viewer, db = prisma } = {}) {
  const data = zStocktakePreviewInput.parse(input)
  const lines = normalizeStocktakeLines(data.lines)
  return db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    const fence = await acquireLedgerFence(tx, { tenantId: business.tenantId, businessId: business.id })
    const snapshot = await buildSnapshot(tx, business, lines, fence)
    const previewId = newStocktakePreviewId()
    const row = await tx.inventoryStocktake.create({
      data: {
        id: previewId,
        tenantId: business.tenantId,
        businessId: business.id,
        idempotencyKey: `PREVIEW:${previewId}`,
        payloadHash: hashStocktake({ businessId: business.id, requestLines: snapshot.requestLines }),
        normalizedLinesJson: JSON.stringify(snapshot),
        snapshotVersion: snapshot.snapshotVersion,
        snapshotHash: snapshot.snapshotHash,
        status: 'PREVIEWED',
      },
    })
    return publicSnapshot(row, snapshot)
  })
}

function movementForVariance(data, previewId, line) {
  if (line.variance === 0) return null
  return {
    businessId: data.businessId,
    productId: line.productId,
    kind: 'ADJUSTMENT',
    quantity: line.variance,
    ...(line.lotId ? { lotId: line.lotId } : {}),
    ...(line.variance < 0 && line.locationId ? { sourceLocationId: line.locationId } : {}),
    ...(line.variance > 0 && line.locationId ? { targetLocationId: line.locationId } : {}),
    reason: 'INVENTORY_STOCKTAKE',
    reference: `STOCKTAKE:${previewId}`,
  }
}

export async function commitStocktake(input, { viewer, db = prisma } = {}) {
  const data = zStocktakeCommitInput.parse(input)
  const lines = normalizeStocktakeLines(data.lines)
  const requestHash = hashStocktake({ businessId: data.businessId, previewId: data.previewId, snapshotToken: data.snapshotToken, requestLines: lines })
  return db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    // Acquire before reading the operation row. A concurrent same-preview
    // request therefore waits, then observes COMMITTED and returns its stored
    // result instead of racing through a second zero-variance audit or append.
    const fence = await acquireLedgerFence(tx, { tenantId: business.tenantId, businessId: business.id })
    const existing = await tx.inventoryStocktake.findUnique({ where: { tenantId_businessId_idempotencyKey: { tenantId: business.tenantId, businessId: business.id, idempotencyKey: data.idempotencyKey } } })
    if (existing) {
      if (existing.status === 'COMMITTED' && existing.payloadHash === requestHash) return resultFromRow(existing)
      throw failure(409, 'INVENTORY_STOCKTAKE_IDEMPOTENCY_CONFLICT')
    }

    const row = await tx.inventoryStocktake.findUnique({ where: { id: data.previewId } })
    if (!row || row.businessId !== business.id) throw failure(404, 'Inventory stocktake not found')
    if (row.status !== 'PREVIEWED') throw failure(409, 'INVENTORY_STOCKTAKE_ALREADY_COMMITTED')
    const snapshot = parseStoredSnapshot(row)
    if (data.snapshotToken !== row.snapshotHash) throw failure(409, 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE')
    if (JSON.stringify(snapshot.requestLines) !== JSON.stringify(lines)) throw failure(409, 'INVENTORY_STOCKTAKE_SNAPSHOT_MISMATCH')
    if (!snapshot.complete) throw failure(409, 'INVENTORY_STOCKTAKE_INCOMPLETE', snapshot.missingBuckets)

    // The fence was acquired before the operation and snapshot reads above.
    // Re-read the fence-backed snapshot after waiting so the persisted token,
    // rather than a pre-lock read, decides whether this commit is current.
    if (fence.mutationRevision !== row.snapshotVersion) throw failure(409, 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE')
    const current = await buildSnapshot(tx, business, lines, fence)
    if (current.snapshotHash !== row.snapshotHash) throw failure(409, 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE')
    if (!current.complete) throw failure(409, 'INVENTORY_STOCKTAKE_INCOMPLETE', current.missingBuckets)

    const movements = []
    for (const line of current.lines) {
      const movement = movementForVariance(data, row.id, line)
      if (!movement) continue
      movements.push(await appendMovement(tx, movement, { viewer }))
    }

    const committedAt = new Date()
    const result = {
      movementIds: movements.flatMap((entry) => entry.movements.map((movement) => movement.id)),
      movementCount: movements.reduce((count, entry) => count + entry.movements.length, 0),
      varianceTotal: current.lines.reduce((sum, line) => sum + line.variance, 0),
      lineBalances: current.lines.map((line) => ({
        productId: line.productId,
        locationId: line.locationId,
        lotId: line.lotId,
        expectedQuantity: line.expectedQuantity,
        countedQuantity: line.countedQuantity,
        variance: line.variance,
        postCommitQuantity: line.countedQuantity,
      })),
      committedAt: committedAt.toISOString(),
      fenceRevision: fence.mutationRevision + movements.length,
    }
    const updated = await tx.inventoryStocktake.update({
      where: { id: row.id },
      data: { idempotencyKey: data.idempotencyKey, payloadHash: requestHash, status: 'COMMITTED', resultJson: JSON.stringify(result), committedAt, version: { increment: 1 } },
    })
    await recordAudit(tx, {
      entityType: INVENTORY_STOCKTAKE_ENTITY,
      entityId: row.id,
      action: 'INVENTORY_STOCKTAKE_COMMITTED',
      actorId: actor(viewer),
      payload: { businessId: business.id, previewId: row.id, movementCount: result.movementCount, varianceTotal: result.varianceTotal, fenceRevision: result.fenceRevision },
    })
    return publicSnapshot(updated, current, { result })
  })
}

export async function getStocktake(id, { businessId, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const row = await db.inventoryStocktake.findUnique({ where: { id } })
  if (!row || row.businessId !== business.id) throw failure(404, 'Inventory stocktake not found')
  return resultFromRow(row)
}
