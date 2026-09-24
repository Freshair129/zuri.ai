import { PRODUCT_ENTITY, zProductCartonAttributesInput } from '../../../kernel/inventory/inventory.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import * as repo from '../adapters/inventory-repo.js'

// Inventory-owned contract used by Procurement after a person confirms a
// supplier-sheet mapping — port of apps/server
// inventory-catalog-service.setProductCartonAttributes. The caller already
// holds Procurement authority; this still requires Inventory's own write
// ladder (a buyer's binding never widens a Product fact) and refuses with the
// same 404. It runs INSIDE the caller's unit of work, so a refusal here rolls
// the whole cost-sheet commit back.

const failure = (status, code) => Object.assign(new Error(code), { status, code, retryable: false })
const CARTON_KEYS = ['unitsPerCarton', 'cartonCbm', 'cartonKg', 'freightGoodsType', 'leadTimeDays']

export function setProductCartonAttributes(sql, scope, id, input, { now, requestId }) {
  const productId = typeof id === 'string' ? id.trim() : ''
  if (!productId) throw denied()
  const data = zProductCartonAttributesInput.parse(input)
  const row = repo.productCartonRow(sql, productId)
  if (!row || row.businessId !== data.businessId || row.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, row.businessId, { write: true })
  if (row.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  const change = {}
  for (const key of CARTON_KEYS) if (data[key] !== undefined) change[key] = data[key]
  if (!Object.keys(change).length) return row
  if (repo.casUpdateProductCarton(sql, { id: row.id, version: row.version, change, now }) !== 1) throw failure(409, 'PRODUCT_VERSION_CONFLICT')
  const fresh = repo.productCartonRow(sql, row.id)
  recordAudit(sql, { entityType: PRODUCT_ENTITY, entityId: row.id, action: 'PRODUCT_CARTON_ATTRIBUTES_SET', actorId: scope.actorId, tenantId: row.tenantId, businessId: row.businessId, requestId, now, payload: { businessId: row.businessId, code: row.code, fields: Object.keys(change), version: fresh.version } })
  enqueueOutbox(sql, { topic: 'scm.inventory.product.carton-set', aggregateType: PRODUCT_ENTITY, aggregateId: row.id, aggregateVersion: fresh.version, now, payload: { businessId: row.businessId, code: row.code, fields: Object.keys(change) } })
  return fresh
}

/** Read port for SKU matching: non-archived SKUs of a Business with ACTIVE identifiers. */
export const productCandidates = (sql, businessId) => repo.productCandidates(sql, businessId)
/** Minimal product facts (id, code, businessId, status) for a mapping check. */
export const productFacts = (sql, ids) => ids.map((id) => repo.productCartonRow(sql, id)).filter(Boolean).map(({ id, code, businessId, tenantId, status }) => ({ id, code, businessId, tenantId, status }))
