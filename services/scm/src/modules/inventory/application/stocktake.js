import {
  INVENTORY_STOCKTAKE_ENTITY, assertInt32, hashStocktake, newStocktakePreviewId, normalizeStocktakeLines, zStocktakeCommitInput, zStocktakePreviewInput,
} from '../../../kernel/inventory/inventory-stocktake.js'
import { inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import { appendMovement } from './stock-ledger.js'
import * as catalogRepo from '../adapters/catalog-repo.js'
import * as repo from '../adapters/inventory-repo.js'
import * as stocktakeRepo from '../adapters/stocktake-repo.js'

// Physical stocktake (FR-184) inside SCM — port of apps/server
// inventory-stocktake-service with the same codes, order of refusals and audit:
//   preview — under the Business ledger fence, validates NONE / LOT lines (SERIAL
//             refused), compares counted with the located ledger per
//             (product, location, lot) bucket, and stores a durable snapshot with
//             the fence revision and a hash. No movement, no audit.
//   commit  — takes the fence FIRST, then: the caller's body key replays a
//             committed result (or 409 on a different payload); the snapshot token,
//             the request lines, completeness and the fence revision must all still
//             hold, and the recomputed snapshot must hash the same; then one signed
//             ADJUSTMENT per non-zero variance through the ledger writer, all in one
//             unit of work, and one INVENTORY_STOCKTAKE_COMMITTED audit.
// The SCM Idempotency-Key header is required as for every mutation; the legacy
// body key keeps its own replay semantics inside it (as D-14 for cost sheets).

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
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

function loadAndValidateReferences(sql, business, lines) {
  const products = new Map()
  for (const productId of [...new Set(lines.map((line) => line.productId))]) {
    const product = catalogRepo.byId(sql, 'product', productId)
    if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_STOCKTAKE_PRODUCT_NOT_FOUND')
    if (product.status === 'ARCHIVED') throw failure(409, 'INVENTORY_STOCKTAKE_PRODUCT_ARCHIVED')
    if (product.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_STOCKTAKE_PRODUCT_NOT_TRACKED')
    if (product.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_STOCKTAKE_SERIAL_UNSUPPORTED')
    if (!['NONE', 'LOT'].includes(product.trackingMode)) throw failure(422, 'INVENTORY_STOCKTAKE_TRACKING_UNSUPPORTED')
    products.set(productId, product)
  }
  const locations = new Map()
  for (const locationId of [...new Set(lines.flatMap((line) => (line.locationId ? [line.locationId] : [])))]) {
    const location = repo.locationRow(sql, locationId)
    if (!location || location.businessId !== business.id || location.status === 'ARCHIVED') throw failure(422, 'INVENTORY_STOCKTAKE_LOCATION_NOT_FOUND')
    locations.set(locationId, location)
  }
  const lots = new Map()
  for (const lotId of [...new Set(lines.flatMap((line) => (line.lotId ? [line.lotId] : [])))]) {
    const lot = repo.lotById(sql, lotId)
    if (lot && lot.businessId === business.id) lots.set(lotId, lot)
  }
  for (const line of lines) {
    const product = products.get(line.productId)
    if (product.trackingMode === 'LOT' && !line.lotId) throw failure(422, 'INVENTORY_STOCKTAKE_LOT_REQUIRED')
    if (product.trackingMode === 'NONE' && line.lotId) throw failure(422, 'INVENTORY_STOCKTAKE_LOT_NOT_ALLOWED')
    if (line.lotId) {
      const lot = lots.get(line.lotId)
      if (!lot || lot.productId !== line.productId) throw failure(422, 'INVENTORY_STOCKTAKE_LOT_NOT_FOUND')
    }
  }
  return { products, locations, lots }
}

function lineIdentity(line, { products, locations, lots }) {
  const product = products.get(line.productId)
  const location = line.locationId ? locations.get(line.locationId) : null
  const lot = line.lotId ? lots.get(line.lotId) : null
  return { ...line, productCode: product.code, productName: product.name ?? null, locationCode: location?.code ?? null, locationName: location?.name ?? null, lotCode: lot?.code ?? null }
}

function buildSnapshot(sql, business, lines, fenceRevision) {
  const references = loadAndValidateReferences(sql, business, lines)
  const expected = new Map()
  for (const movement of repo.locatedMovements(sql, business.id, [...references.products.keys()])) {
    const locationId = movement.quantity > 0 ? movement.targetLocationId : movement.sourceLocationId
    const key = bucketKey(movement.productId, locationId, movement.lotId)
    expected.set(key, assertInt32((expected.get(key) ?? 0) + movement.quantity))
  }
  const snapshotLines = lines.map((line) => {
    const expectedQuantity = expected.get(bucketKey(line.productId, line.locationId, line.lotId)) ?? 0
    return { ...lineIdentity(line, references), expectedQuantity, variance: assertInt32(line.countedQuantity - expectedQuantity) }
  })
  const lineKeys = new Set(snapshotLines.map((line) => bucketKey(line.productId, line.locationId, line.lotId)))
  // A request may cover one location and leave another outside the operation; the
  // one bucket never silently omitted is unlocated stock, and at a selected
  // location every positive bucket (each LOT too) must be represented.
  const selectedLocations = new Set(lines.map((line) => line.locationId))
  const missingBuckets = [...expected.entries()]
    .filter(([key, quantity]) => {
      if (quantity === 0 || lineKeys.has(key)) return false
      const [, locationValue] = key.split('|')
      const locationId = locationValue === 'UNLOCATED' ? null : locationValue
      return locationId === null || selectedLocations.has(locationId)
    })
    .map(([key, expectedQuantity]) => {
      const [productId, locationValue, lotValue] = key.split('|')
      return { productId, locationId: locationValue === 'UNLOCATED' ? null : locationValue, lotId: lotValue === 'NO_LOT' ? null : lotValue, expectedQuantity }
    })
  const complete = missingBuckets.length === 0
  const requestLines = lines.map(({ productId, locationId, lotId, countedQuantity }) => ({ productId, locationId, lotId, countedQuantity }))
  const snapshot = { requestLines, lines: snapshotLines, complete, missingBuckets }
  return { ...snapshot, snapshotVersion: fenceRevision, snapshotHash: hashStocktake({ businessId: business.id, snapshotVersion: fenceRevision, ...snapshot }) }
}

function publicSnapshot(row, snapshot, result = null) {
  return {
    previewId: row.id, businessId: row.businessId, status: row.status, generatedAt: row.createdAt, snapshotToken: row.snapshotHash, snapshotVersion: row.snapshotVersion,
    lines: snapshot.lines, complete: snapshot.complete, missingBuckets: snapshot.missingBuckets, ...(result ? { result } : {}),
  }
}
const resultFromRow = (row) => publicSnapshot(row, parseStoredSnapshot(row), row.resultJson ? JSON.parse(row.resultJson) : null)

const businessOf = (scope, businessId) => inventoryAuthority.require(scope, businessId, { write: true })
export const previewerOf = (scope, body) => businessOf(scope, zStocktakePreviewInput.parse(body).businessId).id
export const committerOf = (scope, body) => businessOf(scope, zStocktakeCommitInput.parse(body).businessId).id

export function previewStocktake(sql, scope, input, ctx) {
  const data = zStocktakePreviewInput.parse(input)
  const lines = normalizeStocktakeLines(data.lines)
  const business = businessOf(scope, data.businessId)
  const fenceRevision = Number(repo.acquireFence(sql, { tenantId: business.tenantId, businessId: business.id, now: ctx.now }))
  const snapshot = buildSnapshot(sql, business, lines, fenceRevision)
  const previewId = newStocktakePreviewId()
  const row = stocktakeRepo.insertPreview(sql, {
    id: previewId, tenantId: business.tenantId, businessId: business.id, idempotencyKey: `PREVIEW:${previewId}`,
    payloadHash: hashStocktake({ businessId: business.id, requestLines: snapshot.requestLines }), normalizedLinesJson: JSON.stringify(snapshot),
    snapshotVersion: snapshot.snapshotVersion, snapshotHash: snapshot.snapshotHash, now: ctx.now,
  })
  return { response: { stocktake: publicSnapshot(row, snapshot) }, affected: { previewId } }
}

function movementForVariance(data, previewId, line) {
  if (line.variance === 0) return null
  return {
    businessId: data.businessId, productId: line.productId, kind: 'ADJUSTMENT', quantity: line.variance,
    ...(line.lotId ? { lotId: line.lotId } : {}),
    ...(line.variance < 0 && line.locationId ? { sourceLocationId: line.locationId } : {}),
    ...(line.variance > 0 && line.locationId ? { targetLocationId: line.locationId } : {}),
    reason: 'INVENTORY_STOCKTAKE', reference: `STOCKTAKE:${previewId}`,
  }
}

export function commitStocktake(sql, scope, input, ctx) {
  const data = zStocktakeCommitInput.parse(input)
  const lines = normalizeStocktakeLines(data.lines)
  const requestHash = hashStocktake({ businessId: data.businessId, previewId: data.previewId, snapshotToken: data.snapshotToken, requestLines: lines })
  const business = businessOf(scope, data.businessId)
  // The fence comes before the operation read: a concurrent same-key commit waits,
  // then observes COMMITTED and returns the stored result.
  const fenceRevision = Number(repo.acquireFence(sql, { tenantId: business.tenantId, businessId: business.id, now: ctx.now }))
  const existing = stocktakeRepo.stocktakeByKey(sql, business.tenantId, business.id, data.idempotencyKey)
  if (existing) {
    if (existing.status === 'COMMITTED' && existing.payloadHash === requestHash) return { response: { stocktake: resultFromRow(existing), replayed: true }, affected: { previewId: existing.id, replayed: true } }
    throw failure(409, 'INVENTORY_STOCKTAKE_IDEMPOTENCY_CONFLICT')
  }
  const row = stocktakeRepo.stocktakeById(sql, data.previewId)
  if (!row || row.businessId !== business.id) throw failure(404, 'INVENTORY_STOCKTAKE_NOT_FOUND')
  if (row.status !== 'PREVIEWED') throw failure(409, 'INVENTORY_STOCKTAKE_ALREADY_COMMITTED')
  const snapshot = parseStoredSnapshot(row)
  if (data.snapshotToken !== row.snapshotHash) throw failure(409, 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE')
  if (JSON.stringify(snapshot.requestLines) !== JSON.stringify(lines)) throw failure(409, 'INVENTORY_STOCKTAKE_SNAPSHOT_MISMATCH')
  if (!snapshot.complete) throw failure(409, 'INVENTORY_STOCKTAKE_INCOMPLETE', snapshot.missingBuckets)
  if (fenceRevision !== row.snapshotVersion) throw failure(409, 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE')
  const current = buildSnapshot(sql, business, lines, fenceRevision)
  if (current.snapshotHash !== row.snapshotHash) throw failure(409, 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE')
  if (!current.complete) throw failure(409, 'INVENTORY_STOCKTAKE_INCOMPLETE', current.missingBuckets)

  const movements = []
  for (const line of current.lines) {
    const movement = movementForVariance(data, row.id, line)
    if (movement) movements.push(appendMovement(sql, scope, { ...movement, requestId: ctx.requestId }, { now: ctx.now }))
  }
  const result = {
    movementIds: movements.flatMap((entry) => entry.movements.map((m) => m.id)),
    movementCount: movements.reduce((count, entry) => count + entry.movements.length, 0),
    varianceTotal: current.lines.reduce((sum, line) => sum + line.variance, 0),
    lineBalances: current.lines.map((line) => ({ productId: line.productId, locationId: line.locationId, lotId: line.lotId, expectedQuantity: line.expectedQuantity, countedQuantity: line.countedQuantity, variance: line.variance, postCommitQuantity: line.countedQuantity })),
    committedAt: ctx.now,
    fenceRevision: fenceRevision + movements.length,
  }
  if (stocktakeRepo.commitPreview(sql, { id: row.id, version: row.version, idempotencyKey: data.idempotencyKey, payloadHash: requestHash, resultJson: JSON.stringify(result), committedAt: ctx.now, now: ctx.now }) !== 1) throw failure(409, 'INVENTORY_STOCKTAKE_ALREADY_COMMITTED')
  recordAudit(sql, { entityType: INVENTORY_STOCKTAKE_ENTITY, entityId: row.id, action: 'INVENTORY_STOCKTAKE_COMMITTED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now, payload: { businessId: business.id, previewId: row.id, movementCount: result.movementCount, varianceTotal: result.varianceTotal, fenceRevision: result.fenceRevision } })
  enqueueOutbox(sql, { topic: 'scm.inventory.inventory-stocktake-committed', aggregateType: INVENTORY_STOCKTAKE_ENTITY, aggregateId: row.id, aggregateVersion: row.version + 1, now: ctx.now, payload: { businessId: business.id, previewId: row.id } })
  const fresh = stocktakeRepo.stocktakeById(sql, row.id)
  return { response: { stocktake: publicSnapshot(fresh, current, result) }, affected: { previewId: row.id, movementCount: result.movementCount } }
}

export function getStocktake(sql, scope, id, { businessId }) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  const row = typeof id === 'string' && id.trim() ? stocktakeRepo.stocktakeById(sql, id.trim()) : null
  if (!row || row.businessId !== business.id) throw failure(404, 'INVENTORY_STOCKTAKE_NOT_FOUND')
  return resultFromRow(row)
}
