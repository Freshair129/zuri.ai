// @req FR-286 — pin a versioned Business catalogue snapshot without creating grants.
// @spec FR-169, FR-191, FR-192 — catalogues, capabilities and authority remain separate.
// @tested tests/unit/business-provisioning-template.test.js,
// tests/integration/business-provisioning-template.test.js
import { createHash } from 'node:crypto'
import { z } from 'zod'

export const STANDARD_BUSINESS_SCHEMA_VERSION = 'standard-business/v1'
export const STANDARD_BUSINESS_TEMPLATE_ID = 'standard-business'
export const STANDARD_BUSINESS_TEMPLATE_VERSION = '1.0.0'
export const STANDARD_BUSINESS_SPACE_KEY = 'STANDARD_DEFAULT'

// Immutable v1 definitions. Keep independent of live catalogues so a later
// catalog change cannot relabel or invalidate an already stored v1 snapshot.
export const STANDARD_BUSINESS_DOMAINS = Object.freeze([
  'business-home', 'commerce', 'customer', 'market', 'growth', 'people',
  'projects', 'assets', 'line-oa', 'inventory', 'procurement', 'knowledge',
])

const ROLE_PERMISSIONS_V1 = Object.freeze({
  PRODUCT_OWNER: Object.freeze([
    'product.read', 'product.plan.write', 'product.decision.write', 'product.work.write',
  ]),
  CUSTOMER_DATA_REVIEWER: Object.freeze([
    'customer.import.review.read', 'customer.import.review.decide',
  ]),
  ASSET_RECEIVER: Object.freeze(['asset.read', 'asset.intake.write']),
  ASSET_REVIEWER: Object.freeze(['asset.read', 'asset.evidence.review']),
  LINE_OA_PUBLISHER: Object.freeze(['line-oa.read', 'line-oa.account.publish']),
  INVENTORY_MANAGER: Object.freeze(['inventory.read', 'inventory.catalog.write']),
  SALES_REP: Object.freeze([
    'crm.read', 'crm.sales-task.write', 'crm.retention-consent.write',
    'commerce.read', 'commerce.order.write',
  ]),
  PAYMENT_VERIFIER: Object.freeze(['commerce.read', 'commerce.payment.verify']),
  PROCUREMENT_BUYER: Object.freeze(['procurement.read', 'procurement.po.write']),
  GOODS_RECEIVER: Object.freeze(['procurement.read', 'procurement.receipt.post']),
})

export const STANDARD_BUSINESS_APPLICATION_ROLES = ROLE_PERMISSIONS_V1
export const STANDARD_BUSINESS_ROLE_CONFLICTS = Object.freeze([
  Object.freeze(['SALES_REP', 'PAYMENT_VERIFIER']),
  Object.freeze(['PROCUREMENT_BUYER', 'GOODS_RECEIVER']),
])

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

deepFreeze(STANDARD_BUSINESS_DOMAINS)
deepFreeze(STANDARD_BUSINESS_APPLICATION_ROLES)
deepFreeze(STANDARD_BUSINESS_ROLE_CONFLICTS)

export function canonicalBusinessJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalBusinessJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalBusinessJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function standardBusinessSnapshotDigest(snapshot) {
  return createHash('sha256').update(canonicalBusinessJson(snapshot), 'utf8').digest('hex')
}

const snapshotSchema = z.object({
  schemaVersion: z.literal(STANDARD_BUSINESS_SCHEMA_VERSION),
  templateId: z.literal(STANDARD_BUSINESS_TEMPLATE_ID),
  templateVersion: z.literal(STANDARD_BUSINESS_TEMPLATE_VERSION),
  scope: z.object({ businessId: z.string().min(1), tenantId: z.string().min(1), portfolioId: z.string().min(1) }).strict(),
  domains: z.array(z.string().min(1)),
  applicationRoles: z.record(z.array(z.string().min(1))),
  roleConflicts: z.array(z.tuple([z.string().min(1), z.string().min(1)])),
}).strict()

export class BusinessProvisioningError extends Error {
  constructor(code, status = 409) {
    super(code)
    this.name = 'BusinessProvisioningError'
    this.code = code
    this.status = status
  }
}

function scopeInput({ businessId, tenantId, portfolioId } = {}) {
  if (![businessId, tenantId, portfolioId].every((id) => typeof id === 'string' && id.trim())) {
    throw new BusinessProvisioningError('BUSINESS_PROVISIONING_SCOPE_INVALID', 400)
  }
  return { businessId, tenantId, portfolioId }
}

export function buildStandardBusinessTemplate(scope) {
  const { businessId, tenantId, portfolioId } = scopeInput(scope)
  return snapshotSchema.parse({
    schemaVersion: STANDARD_BUSINESS_SCHEMA_VERSION,
    templateId: STANDARD_BUSINESS_TEMPLATE_ID,
    templateVersion: STANDARD_BUSINESS_TEMPLATE_VERSION,
    scope: { businessId, tenantId, portfolioId },
    domains: [...STANDARD_BUSINESS_DOMAINS],
    applicationRoles: Object.fromEntries(
      Object.entries(STANDARD_BUSINESS_APPLICATION_ROLES).map(([role, permissions]) => [role, [...permissions]]),
    ),
    roleConflicts: STANDARD_BUSINESS_ROLE_CONFLICTS.map((pair) => [...pair]),
  })
}

function invalidSnapshot(code = 'BUSINESS_PROVISIONING_CORRUPT', status = 500) {
  throw new BusinessProvisioningError(code, status)
}

/** Pure backup validator: no database reads, writes, or live catalog lookup. */
export function validateStoredBusinessProvisioning(business, workspace) {
  if (!business || typeof business !== 'object') invalidSnapshot()
  const markerNames = [
    'provisioningTemplateId', 'provisioningTemplateVersion',
    'provisioningTemplateDigest', 'provisioningSnapshotJson',
  ]
  const markers = markerNames.map((key) => business?.[key] ?? null)
  const allNull = markers.every((value) => value === null)
  const allPopulated = markers.every((value) => typeof value === 'string' && value.length > 0)

  if (allNull) {
    if (workspace && workspace.provisioningKey != null) invalidSnapshot()
    return { status: 'UNMARKED' }
  }
  if (!allPopulated) invalidSnapshot()

  if (business.provisioningTemplateId !== STANDARD_BUSINESS_TEMPLATE_ID ||
      business.provisioningTemplateVersion !== STANDARD_BUSINESS_TEMPLATE_VERSION) {
    invalidSnapshot('BUSINESS_PROVISIONING_VERSION_CONFLICT', 409)
  }

  const tenantId = business.tenant?.id
  const portfolioId = business.tenant?.portfolioId
  if (!business.id || !business.tenantId || business.tenantId !== tenantId || !portfolioId) invalidSnapshot()

  let snapshot
  try {
    snapshot = snapshotSchema.parse(JSON.parse(business.provisioningSnapshotJson))
  } catch {
    invalidSnapshot()
  }
  const expected = buildStandardBusinessTemplate({ businessId: business.id, tenantId, portfolioId })
  const digest = standardBusinessSnapshotDigest(snapshot)
  if (canonicalBusinessJson(snapshot) !== canonicalBusinessJson(expected) ||
      digest !== business.provisioningTemplateDigest) invalidSnapshot()

  if (!workspace || workspace.provisioningKey !== STANDARD_BUSINESS_SPACE_KEY ||
      workspace.scopeType !== 'BUSINESS' || workspace.businessId !== business.id ||
      workspace.tenantId !== tenantId || workspace.portfolioId !== portfolioId) {
    invalidSnapshot()
  }

  return {
    status: 'VALID',
    snapshot,
    templateId: business.provisioningTemplateId,
    templateVersion: business.provisioningTemplateVersion,
    digest,
  }
}
