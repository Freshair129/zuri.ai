import prisma from '@/lib/db'
import { EVALUATOR_VERSION, pricingHash } from '../domain/pricing-engine'
import { assertPricingCatalogCurrent } from '../pricing-publication'
import { hashGenesisRag17Json } from '@/modules/knowledge/genesisrag17-contract'

// @req FR-291 — LINE receives an exact price only when the current Knowledge
// publication and its frozen FR-253 calculation agree on the same record.
// @spec ADR-098, ADR-090, SEC-001
// @tested tests/integration/line-published-price-reader.test.js

const SHA256 = /^[a-f0-9]{64}$/
const UNAVAILABLE = Object.freeze({ state: 'UNAVAILABLE' })

function parseJson(value) {
  if (typeof value !== 'string') return null
  try { return JSON.parse(value) } catch { return null }
}

function exactThbMinorUnits(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const text = String(value)
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return null
  try {
    const minor = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0')
    return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null
  } catch {
    return null
  }
}

function validObservedInterval(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return false
  const start = Date.parse(from)
  const end = Date.parse(to)
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
}

function hasExactInventoryProvenance(input, { productId, quantity }) {
  if (!input || input.costBasis !== 'landed' || input.profile !== 'corporate'
    || input.quantity !== quantity || input.orderCostThb !== '0'
    || !['single', 'set'].includes(input.kind) || !Array.isArray(input.sourceRefs)
    || input.sourceRefs.length !== 1) return false
  const [ref] = input.sourceRefs
  return Boolean(ref && ref.kind === 'INVENTORY_LEDGER' && ref.productId === productId
    && Number.isSafeInteger(ref.receiptCount) && ref.receiptCount > 0
    && SHA256.test(ref.sha256 || ''))
}

function samePublishedPriceProjection(left, right) {
  if (!left || typeof left !== 'object' || !right || typeof right !== 'object') return false
  return ['entityType', 'externalId', 'productExternalId', 'qty', 'srpUnitPriceThb', 'srpSource']
    .every((key) => left[key] === right[key])
}

/**
 * Internal read port used after the LINE job has already been reloaded and
 * scoped. It intentionally accepts a fixed Business-scoped Knowledge reader,
 * not a viewer or a caller-selected file/asset. No output is returned unless
 * the exact published record, live PCAT asset and frozen calculation agree.
 */
export async function readPublishedExactPriceForLine(
  { tenantId, businessId, productId, quantity, unit } = {},
  { db = prisma, now, knowledgeReader } = {},
) {
  const observedFrom = new Date().toISOString()
  try {
    if (typeof tenantId !== 'string' || !tenantId.trim()
      || typeof businessId !== 'string' || !businessId.trim()
      || typeof productId !== 'string' || !productId.trim()
      || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000
      || typeof unit !== 'string' || !unit.trim() || unit.length > 100
      || (now !== undefined && typeof now !== 'function' && !(now instanceof Date))
      || typeof knowledgeReader?.readPublishedCatalogRecord !== 'function') return UNAVAILABLE

    const product = await db.product.findFirst({
      where: { id: productId, tenantId, businessId, status: 'ACTIVE' },
      select: { id: true, tenantId: true, businessId: true, status: true, unit: true, itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true },
    })
    if (!product || product.id !== productId || product.tenantId !== tenantId || product.businessId !== businessId
      || product.status !== 'ACTIVE' || product.unit !== unit || product.itemKind === 'CUSTOM_COMPONENT'
      || product.dedicatedCustomerId || product.dedicatedSalesOrderId) return UNAVAILABLE

    const publication = await knowledgeReader.readPublishedCatalogRecord({ productId, quantity })
    const record = publication?.record
    if (!record || record.entityType !== 'PriceListEntry'
      || record.externalId !== `commerce-price:${productId}:${quantity}`
      || record.productExternalId !== `commerce-sku:${productId}`
      || record.qty !== quantity || record.srpSource !== 'COMMERCE_APPROVED_COMPUTED'
      || !SHA256.test(publication.publicationDigest || '')
      || !validObservedInterval(publication.observedFrom, publication.observedTo)
      || typeof publication.assetId !== 'string' || !publication.assetId
      || typeof publication.assetCode !== 'string' || typeof publication.assetSha256 !== 'string'
      || !SHA256.test(publication.assetSha256)) return UNAVAILABLE

    const codeMatch = /^PCAT-([a-f0-9]{64})$/.exec(publication.assetCode)
    if (!codeMatch) return UNAVAILABLE
    const asset = await db.fileAsset.findUnique({ where: { id: publication.assetId } })
    if (!asset || asset.id !== publication.assetId || asset.tenantId !== tenantId || asset.businessId !== businessId
      || asset.projectId !== null || asset.code !== publication.assetCode || asset.sha256 !== publication.assetSha256
      || asset.name !== `commerce-price-${productId}.json` || asset.mime !== 'application/json'
      || asset.storageKind !== 'MANAGED_BLOB' || asset.status !== 'ACTIVE' || asset.deletedAt !== null) return UNAVAILABLE

    // FR-253 is the current-policy gate for this managed catalog. It rejects a
    // stale rule set even when an old publication and calculation still exist.
    const policyNow = now === undefined ? new Date() : (typeof now === 'function' ? now() : now)
    if (!(policyNow instanceof Date) || !Number.isFinite(policyNow.getTime())) return UNAVAILABLE
    await assertPricingCatalogCurrent(asset, { db, now: policyNow })

    const calculation = await db.pricingCalculation.findFirst({
      where: {
        tenantId,
        businessId,
        idempotencyKey: `catalog:${codeMatch[1]}:${quantity}`,
      },
    })
    if (!calculation || calculation.tenantId !== tenantId || calculation.businessId !== businessId
      || calculation.inputProvenance !== 'INVENTORY_LEDGER' || calculation.idempotencyKey !== `catalog:${codeMatch[1]}:${quantity}`
      || !SHA256.test(calculation.requestHash || '') || !SHA256.test(calculation.rulesHash || '') || !SHA256.test(calculation.inputHash || '')
      || !Number.isSafeInteger(calculation.ruleVersion) || calculation.ruleVersion < 1
      || typeof calculation.ruleSetId !== 'string' || !calculation.ruleSetId
      || calculation.evaluatorVersion !== EVALUATOR_VERSION) return UNAVAILABLE

    const input = parseJson(calculation.inputJson)
    const result = parseJson(calculation.resultJson)
    if (!hasExactInventoryProvenance(input, { productId, quantity })
      || pricingHash(input) !== calculation.inputHash
      || !result || result.evaluatorVersion !== EVALUATOR_VERSION
      || result.inputHash !== calculation.inputHash || result.ruleHash !== calculation.rulesHash
      || result.quantity !== quantity || result.currency !== 'THB'
      || !Number.isSafeInteger(result.unitPriceSatang) || result.unitPriceSatang < 0) return UNAVAILABLE

    const projection = result.catalogProjection
    if (!projection || projection.fileName !== asset.name
      || projection.baseUnit !== unit || projection.baseUnit !== product.unit
      || projection.productRecord?.externalId !== `commerce-sku:${productId}`
      || projection.priceRecord?.externalId !== record.externalId
      || !samePublishedPriceProjection(projection.priceRecord, record)) return UNAVAILABLE

    const unitAmountMinor = exactThbMinorUnits(record.srpUnitPriceThb)
    if (unitAmountMinor === null || unitAmountMinor !== result.unitPriceSatang) return UNAVAILABLE

    const publicationDigest = hashGenesisRag17Json({
      schema: 'zuri.line-exact-published-price.v1',
      tenantId,
      businessId,
      productId,
      quantity,
      unit,
      knowledgePublicationDigest: publication.publicationDigest,
      asset: { id: asset.id, code: asset.code, sha256: asset.sha256 },
      producer: {
        calculationId: calculation.id,
        requestHash: calculation.requestHash,
        inputHash: calculation.inputHash,
        rulesHash: calculation.rulesHash,
        evaluatorVersion: calculation.evaluatorVersion,
        baseUnit: projection.baseUnit,
        unitPriceSatang: result.unitPriceSatang,
      },
    })

    return {
      state: 'PUBLISHED',
      unitAmountMinor,
      currency: 'THB',
      quantity,
      unit,
      taxTreatment: 'UNKNOWN',
      observedFrom,
      observedTo: new Date().toISOString(),
      publicationDigest,
    }
  } catch {
    // Denials, stale policy and malformed or mismatched evidence all share the
    // one public result. Source details remain inside the scoped capability.
    return UNAVAILABLE
  }
}
