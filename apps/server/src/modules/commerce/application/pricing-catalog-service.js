import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { assertMayView } from '@/modules/inventory'
import { weightedAverageUnitCostSatang } from '@/modules/inventory/domain/inventory-costing'
import { createManagedBlobFileAsset, resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { createConfiguredAssetObjectStoragePort } from '@/platform/storage/supabase-object-storage'
import { assertKnowledgeBusinessWritable } from '@/modules/knowledge/knowledge-authorization'
import { resolveKnowledgeRuntimeBinding } from '@/modules/knowledge/knowledge-runtime'
import { admitKnowledge } from '@/modules/knowledge/knowledge-admission-service'
import { parseSmartGiftCatalogFile, SMARTGIFT_CATALOG_FORMAT } from '@/modules/knowledge/smartgift-catalog-adapter'
import { normalizePricingInput, pricingHash } from '../domain/pricing-engine'
import { buildPricingCatalogProjection } from '../domain/pricing-catalog-projection'
import { getActivePricingRuleSet } from './pricing-rules-service'
import { priceLandedInventoryQuote } from './pricing-inventory-service'

// @req FR-253 — explicit OWNER-approved, ledger-backed sell-side projection
// enters the existing FR-187 pre-Stage-1 admission queue. Frozen snapshots and
// managed file identity make retries stable; no calculation/publication claim
// from the client can promote a trial input into verified source data.
// @spec ADR-098; ADR-075; SEC-001; BR-002
// @tested tests/integration/fr252-pricing-catalog.test.js

const schema = z.object({
  businessId: z.string().trim().min(1).max(200),
  productId: z.string().trim().min(1).max(200),
  expectedRuleSetId: z.string().trim().min(1).max(200),
  expectedRuleVersion: z.number().int().positive(),
  quantities: z.array(z.number().int().positive().max(1000000)).min(1).max(20),
  reason: z.string().trim().min(1).max(2000),
  idempotencyKey: z.string().trim().min(1).max(150),
  previewOnly: z.boolean().optional(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((value, context) => {
  if (!value.previewOnly && !value.previewHash) context.addIssue({ code: z.ZodIssueCode.custom, path: ['previewHash'], message: 'Review the server-calculated sell prices before approval' })
})
const fail = (status, message) => Object.assign(new Error(message), { status })
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function requireCurrentRule(businessId, snapshots, options) {
  const active = await getActivePricingRuleSet(businessId, options)
  if (snapshots.some((row) => row.ruleSetId !== active.id || row.rulesHash !== active.rulesHash || row.ruleVersion !== active.version)) {
    throw fail(409, 'PRICING_CATALOG_POLICY_CHANGED')
  }
  return active
}

/** Pure database reads plus the shared evaluator; preview and freeze use the
 * same complete ledger manifest and byte-level sell-side projection. */
async function buildLedgerPlan(data, { db, viewer, now }) {
  const active = await getActivePricingRuleSet(data.businessId, { db, viewer, now })
  if (active.id !== data.expectedRuleSetId || active.version !== data.expectedRuleVersion) throw fail(409, 'PRICING_CATALOG_POLICY_CHANGED')
  const product = await db.product.findFirst({ where: { id: data.productId, businessId: data.businessId, tenantId: active.tenantId, status: 'ACTIVE' }, include: { productMaster: true } })
  if (!product) throw fail(404, 'Product not found')
  if (product.itemKind === 'CUSTOM_COMPONENT' || product.dedicatedCustomerId || product.dedicatedSalesOrderId) throw fail(422, 'PRICING_CATALOG_DEDICATED_PRODUCT')
  const receipts = await db.stockMovement.findMany({ where: { productId: product.id, businessId: data.businessId, tenantId: active.tenantId, kind: 'RECEIPT', quantity: { gt: 0 } }, orderBy: { id: 'asc' } })
  if (!receipts.length || receipts.some((row) => !Number.isSafeInteger(row.costSatang) || row.costSatang < 0)) throw fail(422, 'PRICING_CATALOG_COMPLETE_LEDGER_COST_REQUIRED')
  const totalValue = receipts.reduce((total, row) => total + BigInt(row.quantity) * BigInt(row.costSatang), 0n)
  if (totalValue > BigInt(Number.MAX_SAFE_INTEGER)) throw fail(422, 'PRICING_CATALOG_COST_OVERFLOW')
  const costSatang = weightedAverageUnitCostSatang(receipts)
  const receiptManifest = receipts.map((row) => ({ id: row.id, quantity: row.quantity, costSatang: row.costSatang, occurredAt: row.occurredAt.toISOString() }))
  // The full append-only ledger is not a user-authored rules/input array.
  // Rows are id-sorted above and each manifest row has this fixed key order.
  const receiptManifestHash = sha256(JSON.stringify(receiptManifest))
  const sourceRefs = [{ kind: 'INVENTORY_LEDGER', productId: product.id, receiptCount: receipts.length, sha256: receiptManifestHash }]
  const quotes = []
  for (const quantity of data.quantities) {
    const quote = await priceLandedInventoryQuote({ businessId: data.businessId, productId: product.id, quantity, baseCostSatang: costSatang, kind: product.itemKind === 'FINISHED_SET' ? 'set' : 'single', sourceRefs }, { viewer, db, now })
    if (quote.ruleSetId !== active.id || quote.rulesHash !== active.rulesHash || quote.ruleRevision !== active.version) throw fail(409, 'PRICING_CATALOG_POLICY_CHANGED')
    quotes.push({ quote, quantity, catalogProjection: buildPricingCatalogProjection(product, quantity, quote.result.unitPriceSatang, now) })
  }
  const previewHash = pricingHash({ request: data, policy: { id: active.id, version: active.version, hash: active.rulesHash }, receiptManifestHash, receiptCount: receipts.length, quotes: quotes.map(({ quote, quantity, catalogProjection }) => ({ quantity, inputHash: quote.result.inputHash, result: quote.result, catalogProjection })) })
  return { active, quotes, receiptManifest, previewHash }
}

async function freezeLedgerCalculations(data, { db, viewer, now, previewHash }) {
  const requestHash = pricingHash({ ...data, previewHash })
  const requestKey = pricingHash({ businessId: data.businessId, idempotencyKey: data.idempotencyKey })
  const prefix = `catalog:${requestKey}:`
  return db.$transaction(async (tx) => {
    const existing = await tx.pricingCalculation.findMany({ where: { businessId: data.businessId, idempotencyKey: { startsWith: prefix } }, orderBy: { idempotencyKey: 'asc' } })
    if (existing.length) {
      if (existing.length !== data.quantities.length || existing.some((row) => row.requestHash !== requestHash || row.inputProvenance !== 'INVENTORY_LEDGER')) throw fail(409, 'PRICING_CATALOG_IDEMPOTENCY_CONFLICT')
      await requireCurrentRule(data.businessId, existing, { db: tx, viewer, now })
      return { rows: existing, requestKey }
    }
    const plan = await buildLedgerPlan(data, { db: tx, viewer, now })
    if (plan.previewHash !== previewHash) throw fail(409, 'PRICING_CATALOG_PREVIEW_CHANGED')
    const { active } = plan
    const rows = []
    for (const { quantity, quote, catalogProjection } of plan.quotes) {
      const row = await tx.pricingCalculation.create({ data: {
        tenantId: active.tenantId, businessId: data.businessId, ruleSetId: quote.ruleSetId,
        ruleVersion: quote.ruleRevision, rulesHash: quote.rulesHash, rulesJson: quote.rulesJson,
        evaluatorVersion: quote.result.evaluatorVersion, inputHash: quote.result.inputHash,
        inputJson: JSON.stringify(normalizePricingInput(quote.input)),
        resultJson: JSON.stringify({ ...quote.result, catalogProjection }),
        inputProvenance: 'INVENTORY_LEDGER', requestHash, idempotencyKey: `${prefix}${quantity}`,
        createdByPersonId: viewer.principal?.id ?? null, createdAt: now,
      } })
      await recordAudit(tx, { entityType: 'PRICING_CALCULATION', entityId: row.id, action: 'PRICING_CATALOG_PRICE_APPROVED', tenantId: active.tenantId, businessId: data.businessId, actorId: viewer.principal?.id ?? null, reason: data.reason, payload: { productId: data.productId, quantity, ruleSetId: active.id, rulesHash: active.rulesHash, inputHash: row.inputHash, previewHash, receiptIds: plan.receiptManifest.map((receipt) => receipt.id) } })
      rows.push(row)
    }
    return { rows, requestKey }
  })
}

export async function admitPricingCatalog(input, { viewer, db = prisma, now = new Date(), env = process.env, objectStoragePort = null } = {}) {
  const { previewOnly, previewHash, ...value } = schema.parse(input)
  const data = { ...value, quantities: [...new Set(value.quantities)].sort((a, b) => a - b) }
  // All preconditions precede freezing a price or uploading a managed source.
  const active = await getActivePricingRuleSet(data.businessId, { viewer, db, now })
  if (active.id !== data.expectedRuleSetId || active.version !== data.expectedRuleVersion) throw fail(409, 'PRICING_CATALOG_POLICY_CHANGED')
  assertMayView(viewer, data.businessId)
  await assertKnowledgeBusinessWritable(viewer, data.businessId, { db, env })
  if (previewOnly) {
    const plan = await db.$transaction((tx) => buildLedgerPlan(data, { db: tx, viewer, now }))
    return { previewOnly: true, previewHash: plan.previewHash, businessId: data.businessId, productId: data.productId, ruleSetId: plan.active.id, ruleVersion: plan.active.version, prices: plan.quotes.map(({ quantity, quote }) => ({ quantity, currency: quote.result.currency, unitPriceSatang: quote.result.unitPriceSatang, totalPriceSatang: quote.result.totalPriceSatang })), publicationStatus: 'NOT_SUBMITTED' }
  }
  await resolveKnowledgeRuntimeBinding({ businessId: data.businessId }, { db, env })
  const storage = objectStoragePort || createConfiguredAssetObjectStoragePort(env)
  let frozen
  try { frozen = await freezeLedgerCalculations(data, { db, viewer, now, previewHash }) } catch (error) {
    if (error.code !== 'P2002') throw error
    frozen = await freezeLedgerCalculations(data, { db, viewer, now, previewHash })
  }
  const projections = frozen.rows.map((row) => JSON.parse(row.resultJson).catalogProjection).sort((a, b) => a.priceRecord.qty - b.priceRecord.qty)
  const records = parseSmartGiftCatalogFile(JSON.stringify([projections[0].productRecord, ...projections.map((item) => item.priceRecord)]))
  const content = Buffer.from(JSON.stringify(records), 'utf8')
  const contentHash = sha256(content)
  const code = `PCAT-${frozen.requestKey}`
  let asset = await db.fileAsset.findUnique({ where: { code } })
  if (asset && (asset.businessId !== data.businessId || asset.sha256 !== contentHash || asset.deletedAt || asset.status !== 'ACTIVE')) throw fail(409, 'PRICING_CATALOG_ASSET_CONFLICT')
  if (!asset) {
    const stored = await storage.put({ key: `commerce-pricing/${data.businessId}/${randomUUID()}.json`, content, mime: 'application/json' })
    try {
      asset = await createManagedBlobFileAsset({ code, businessId: data.businessId, name: projections[0].fileName, mime: 'application/json', size: content.length, sha256: contentHash, blobRef: stored.ref, uploadedBy: viewer.principal?.id ?? null }, { db, viewer })
    } catch (error) {
      await storage.remove({ ref: stored.ref }).catch(() => {})
      if (error.code !== 'P2002') throw error
      asset = await db.fileAsset.findUnique({ where: { code } })
      if (!asset || asset.businessId !== data.businessId || asset.sha256 !== contentHash || asset.deletedAt || asset.status !== 'ACTIVE') throw fail(409, 'PRICING_CATALOG_ASSET_CONFLICT')
    }
  }
  await requireCurrentRule(data.businessId, frozen.rows, { viewer, db, now })
  const admission = await admitKnowledge({ businessId: data.businessId, idempotencyKey: `pricing-catalog:${frozen.requestKey}`, source: { kind: 'FILE', fileAssetId: asset.id, format: SMARTGIFT_CATALOG_FORMAT } }, { viewer, db, env, now, fileContentResolver: (fileId, options) => resolveFileAssetContent(fileId, { ...options, db, objectStoragePort: storage }) })
  return { fileAssetId: asset.id, contentHash, calculationIds: frozen.rows.map((row) => row.id), ruleSetId: frozen.rows[0].ruleSetId, status: 'ADMITTED', publicationStatus: 'NOT_VERIFIED', admission }
}
