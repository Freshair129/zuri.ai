import prisma from '@/lib/db'
import { zConversationAnalysisInput } from '@/lib/validation/entities'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'

// @req FR-127 — persist and read consent-gated, recomputable ConversationAnalysis
// rows behind the CRM's existing Business ownership/read visibility boundaries.
// @spec ADR-054 D3-D6, BR-001, SEC-001, SEC-005
// RCA: .brain/rca/2026-08-31-conversation-analysis-tenant-binding.md
// @tested tests/integration/crm-conversation-analysis.test.js,
//   tests/unit/conversation-analysis-inbox-reader.test.js

export const CONVERSATION_ANALYSIS_VERSION = '1.0'

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function dayStart(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function parseTags(value) {
  try {
    const tags = JSON.parse(value || '[]')
    return Array.isArray(tags) ? tags : []
  } catch {
    return []
  }
}

function analysisDto(row) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    analyzedDate: row.analyzedDate.toISOString(),
    analyzedAt: row.analyzedAt.toISOString(),
    contactType: row.contactType,
    state: row.state,
    cta: row.cta,
    tags: parseTags(row.tags),
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Resolve the same selected-Business-plus-tenant-shared scope as the current
 * CRM inbox. FR-091 prose mentions all visible tenant Businesses, but the
 * inbox query currently selects only this Business and null; this reader must
 * not disclose a sibling Business the Inbox does not list. CRM-domain access
 * is required in addition to Business visibility (FR-061).
 */
async function resolveScope(db, viewer, businessId) {
  if (!seesBusiness(viewer, businessId)) throw failure(403, 'Business access denied')
  assertDomainVisible(viewer, businessId, 'customer')

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, tenantId: true, name: true },
  })
  if (!business) throw failure(404, 'BUSINESS_NOT_FOUND')

  return {
    business,
    tenantId: business.tenantId,
    where: {
      tenantId: business.tenantId,
      OR: [{ businessId: null }, { businessId: business.id }],
    },
  }
}

const consentedCustomer = (tenantId) => ({
  tenantId,
  deletedAt: null,
  consentStatus: 'GRANTED',
})

async function findConsentedConversation(db, where, conversationId, customerTenantId = where.tenantId) {
  const conversation = await db.conversation.findFirst({
    where: {
      ...where,
      id: conversationId,
      customer: consentedCustomer(customerTenantId),
    },
    select: {
      id: true,
      tenantId: true,
      businessId: true,
      customer: { select: { tenantId: true } },
    },
  })

  // Keep this explicit check even though the relation predicate above should
  // filter it: Conversation and Customer have independent tenant columns in
  // the legacy schema, so inconsistent rows must fail closed.
  if (!conversation || conversation.tenantId !== conversation.customer.tenantId) return null
  return conversation
}

async function findWriterConversation(db, viewer, conversationId) {
  const ownedBusinessIds = Array.isArray(viewer?.ownedBusinessIds)
    ? viewer.ownedBusinessIds.filter((businessId) => ownsBusiness(viewer, businessId))
    : []
  if (!ownedBusinessIds.length) return null

  const ownedBusinesses = await db.business.findMany({
    where: { id: { in: ownedBusinessIds } },
    select: { id: true, tenantId: true },
  })
  const tenantIds = [...new Set(ownedBusinesses.map((business) => business.tenantId))]
  if (!tenantIds.length) return null

  return findConsentedConversation(db, {
    // Correlate every owned Business id with the tenant row it came from. A
    // broad tenant IN plus Business IN would accept a malformed cross-tenant
    // pair when one viewer owns Businesses in both tenants.
    OR: [
      { tenantId: { in: tenantIds }, businessId: null },
      ...ownedBusinesses.map(({ id, tenantId }) => ({ tenantId, businessId: id })),
    ],
  }, conversationId, { in: tenantIds })
}

function analysisData(data, analyzedDate, analyzedAt) {
  return {
    analyzedDate,
    analyzedAt,
    contactType: data.contactType,
    state: data.state,
    cta: data.cta || null,
    tags: JSON.stringify(data.tags),
    summary: data.summary,
    rawOutputJson: data.rawOutputJson,
  }
}

/**
 * Persist one run for an internal Conversation and UTC analysis day. Every run
 * receives its own generated id, so same-day reruns remain independently
 * addressable while the day stays available for grouping.
 * The source lookup and consent check occur inside the same transaction as the
 * create, so the consent check is part of the same transaction as the write.
 */
export async function recordConversationAnalysis(
  conversationId,
  input,
  { viewer, db = prisma, correlationId } = {},
) {
  if (!conversationId || typeof conversationId !== 'string') throw failure(400, 'CONVERSATION_ID_REQUIRED')
  const data = zConversationAnalysisInput.parse(input)
  const analyzedDate = dayStart(data.analyzedDate)
  const analyzedAt = data.analyzedAt || new Date()

  return db.$transaction(async (tx) => {
    const conversation = await findWriterConversation(tx, viewer, conversationId)
    if (!conversation) throw failure(404, 'CONVERSATION_NOT_FOUND')

    const analysis = await tx.conversationAnalysis.create({
      data: {
        conversationId: conversation.id,
        ...analysisData(data, analyzedDate, analyzedAt),
      },
    })

    const audit = await recordAudit(tx, {
      entityType: 'CONVERSATION_ANALYSIS',
      entityId: analysis.id,
      action: 'CONVERSATION_ANALYSIS_RECORDED',
      actorId: viewer?.principal?.id ?? null,
      // Raw model output, summary, CTA and tags may contain personal data. The
      // audit stream carries only stable identifiers and classification metadata.
      payload: {
        conversationId: conversation.id,
        analyzedDate: analyzedDate.toISOString(),
        contactType: data.contactType,
        state: data.state,
        ...(correlationId ? { correlationId } : {}),
      },
    })

    return { ...analysisDto(analysis), auditEventId: audit.id }
  })
}

/**
 * Read the projected analyses for a scoped Conversation. Business and CRM
 * domain visibility are checked before any lookup. The conversation must be
 * tenant-shared or belong to the selected Business, and its Customer's current
 * consent and erasure state are checked in the same transaction before derived
 * rows are selected. rawOutputJson is intentionally absent from the DTO.
 */
export async function getConversationAnalyses({ viewer, businessId, conversationId, db = prisma } = {}) {
  if (!conversationId || typeof conversationId !== 'string') throw failure(400, 'CONVERSATION_ID_REQUIRED')
  if (!businessId || typeof businessId !== 'string') throw failure(400, 'BUSINESS_ID_REQUIRED')

  return db.$transaction(async (tx) => {
    const scope = await resolveScope(tx, viewer, businessId)
    const conversation = await findConsentedConversation(tx, scope.where, conversationId)
    if (!conversation) throw failure(404, 'CONVERSATION_NOT_FOUND')

    const analyses = await tx.conversationAnalysis.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ analyzedDate: 'asc' }, { analyzedAt: 'asc' }],
    })

    return {
      version: CONVERSATION_ANALYSIS_VERSION,
      scope: { businessId: scope.business.id, businessName: scope.business.name, tenantId: scope.tenantId },
      conversationId: conversation.id,
      analyses: analyses.map(analysisDto),
    }
  })
}
