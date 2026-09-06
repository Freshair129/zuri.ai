import {
  CUSTOMER_REVIEW_DECIDE_PERMISSION,
  CUSTOMER_REVIEW_READ_PERMISSION,
  hasPermission,
} from '@/modules/identity/rbac'
import {
  SMARTGIFT_REVIEW_SCOPE,
  createDefaultCustomerReviewStore,
  mapCase,
  storeError,
  validateDecisionInput,
} from './customer-import-review-store'

// @req FR-078 — expose only a redacted, Business-scoped duplicate review queue
// and append explicit decisions without publishing Customer rows.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-service.test.js

const REVIEW_STATUSES = new Set(['OPEN', 'PARTIALLY_DECIDED', 'DECIDED', 'DEFERRED'])

function assertPermission(viewer, businessId, permission) {
  if (!hasPermission(viewer, businessId, permission)) {
    const error = new Error('Customer data review permission is required')
    error.status = 403
    throw error
  }
}

function assertSmartGiftBusiness(businessId) {
  if (businessId !== SMARTGIFT_REVIEW_SCOPE.businessId) throw storeError('Customer review scope is not available', 404)
}

function parseStatus(status) {
  if (status == null || status === '') return null
  if (!REVIEW_STATUSES.has(status)) throw storeError('Invalid review status')
  return status
}

function parseLimit(limit) {
  if (limit == null || limit === '') return 25
  const parsed = Number(limit)
  if (!Number.isInteger(parsed) || parsed < 1) throw storeError('Invalid review target limit')
  return Math.min(parsed, 50)
}

function maskDisplayName(value) {
  const source = String(value || '').trim()
  if (!source) return 'ไม่ระบุชื่อ'
  return source.split(/\s+/u).map((part) => {
    const chars = [...part]
    if (chars.length <= 1) return '•'
    return `${chars[0]}${'•'.repeat(Math.min(chars.length - 1, 6))}`
  }).join(' ')
}

function publicCase(row) {
  const mapped = row?.reviewCaseId ? row : mapCase(row)
  return mapped
}

export async function listCustomerImportReviewQueue({
  businessId,
  batchId = null,
  status = null,
  viewer,
  store = createDefaultCustomerReviewStore(),
} = {}) {
  assertSmartGiftBusiness(businessId)
  const scope = await store.resolveScope(businessId)
  assertPermission(viewer, scope.businessId, CUSTOMER_REVIEW_READ_PERMISSION)
  const rows = await store.listCases({ businessId: scope.businessId, batchId, status: parseStatus(status) })
  const cases = rows.map(publicCase)
  return {
    contractId: 'CDC-SG-CUSTOMER-DATA-001',
    versionId: 'VER-SG-CUSTOMER-DATA-CONTRACT-0.3.0B',
    missionId: 'MIS-SG-CUSTOMER-DATA-BACKFILL-001',
    scope,
    privacy: { rawPii: false, response: 'REDACTED_IDENTIFIERS_AND_FLAGS_ONLY' },
    cases,
    counts: {
      cases: cases.length,
      items: cases.reduce((total, item) => total + item.items.length, 0),
      openCases: cases.filter((item) => item.status === 'OPEN').length,
    },
  }
}

export async function listCustomerImportReviewTargets({
  businessId,
  query = '',
  limit = 25,
  viewer,
  store = createDefaultCustomerReviewStore(),
} = {}) {
  assertSmartGiftBusiness(businessId)
  const scope = await store.resolveScope(businessId)
  assertPermission(viewer, scope.businessId, CUSTOMER_REVIEW_READ_PERMISSION)
  const rows = await store.listTargetCustomers({
    businessId: scope.businessId,
    query: typeof query === 'string' ? query.trim().slice(0, 80) : '',
    limit: parseLimit(limit),
  })
  return {
    scope,
    privacy: { rawPii: false, response: 'MASKED_CUSTOMER_LABELS_ONLY' },
    customers: rows.map((row) => ({ id: row.id, displayNameMasked: maskDisplayName(row.displayName) })),
  }
}

export async function appendCustomerImportReviewDecisions({
  businessId,
  caseId,
  expectedVersion,
  decisions,
  viewer,
  store = createDefaultCustomerReviewStore(),
} = {}) {
  assertSmartGiftBusiness(businessId)
  const scope = await store.resolveScope(businessId)
  assertPermission(viewer, scope.businessId, CUSTOMER_REVIEW_DECIDE_PERMISSION)
  const actorId = viewer?.principal?.id
  if (!actorId) throw storeError('Authenticated review actor is required', 401)
  const current = await store.getCase({ businessId: scope.businessId, caseId })
  if (!current) throw storeError('Review case not found', 404)
  validateDecisionInput(decisions)
  const updated = await store.appendDecisions({
    businessId: scope.businessId,
    caseId,
    expectedVersion,
    decisions,
    actorId,
  })
  return {
    contractId: 'CDC-SG-CUSTOMER-DATA-001',
    versionId: 'VER-SG-CUSTOMER-DATA-CONTRACT-0.3.0B',
    missionId: 'MIS-SG-CUSTOMER-DATA-BACKFILL-001',
    scope,
    decisionRecorded: true,
    applyRequired: true,
    publishesCustomers: false,
    lineReplay: false,
    reviewCase: publicCase(updated),
  }
}

export { SMARTGIFT_REVIEW_SCOPE, assertPermission, maskDisplayName }
