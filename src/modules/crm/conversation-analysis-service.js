import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { zContactType, zEngagementState } from '@/lib/validation/enums'

// @req FR-127 — a per-Conversation, per-analysis-run classification becomes a row.
// @spec BR-002, SEC-001, SEC-009 — ADR-054 D2/D3/D4/D6
// @tested tests/integration/crm-conversation-intelligence.test.js, tests/unit/conversation-intelligence.test.js
//
// The producer is the agent runtime (which owns no models — its charter), so this
// writer is the storage seam: scope is a tenantId the caller already resolved
// server-side (the same trust shape as `recordLineReply`), never a viewer, and the
// conversation is resolved *within* that tenant in one query — an analysis naming
// another tenant's conversation is not found rather than found-and-refused.
//
// Append-only: analysis runs are evidence, not state. Re-analysis appends a new
// row; readers and FR-128 take the latest run per conversation per date. Deleting
// every row and re-running is always safe (ADR-054 D6) — the truth is the
// Message rows, never this table.

/** A calendar date label (ICT business day), the FR-128 aggregation key. */
export const zAnalyzedDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ANALYZED_DATE_FORMAT')

export const zConversationAnalysisInput = z.object({
  analyzedDate: zAnalyzedDate,
  contactType: zContactType,
  state: zEngagementState,
  cta: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).default([]),
  summary: z.string().min(1).max(4000).optional(),
  /** The raw model output, retained for audit. Evidence, not contract. */
  rawOutput: z.unknown().optional(),
}).strict()

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Record one analysis run for a conversation.
 *
 * @param {{tenantId: string, conversationId: string, analysis: object, correlationId?: string}} input
 * @returns {Promise<{analysisId: string, conversationId: string}>}
 */
export async function recordConversationAnalysis({ tenantId, conversationId, analysis, correlationId }) {
  if (!tenantId) throw failure(400, 'TENANT_REQUIRED')
  const data = zConversationAnalysisInput.parse(analysis)

  // Scope check and lookup are the same query (the reply-record pattern): a
  // conversation outside this tenant simply does not resolve.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true, businessId: true },
  })
  if (!conversation) throw failure(404, 'CONVERSATION_NOT_FOUND')

  return prisma.$transaction(async (tx) => {
    const row = await tx.conversationAnalysis.create({
      data: {
        conversationId: conversation.id,
        analyzedDate: data.analyzedDate,
        contactType: data.contactType,
        state: data.state,
        cta: data.cta ?? null,
        tagsJson: JSON.stringify(data.tags),
        summary: data.summary ?? null,
        rawOutputJson: data.rawOutput === undefined ? null : JSON.stringify(data.rawOutput),
      },
    })

    await recordAudit(tx, {
      entityType: 'CONVERSATION',
      entityId: conversation.id,
      action: 'ANALYSIS_RECORDED',
      actorType: 'AGENT',
      // No summary and no tags here: the row above holds them, and the audit
      // payload is read by tooling with no business seeing derived customer
      // content (SEC-009) — same rule as the reply receipt's audit event.
      payload: {
        tenantId,
        conversationId: conversation.id,
        analysisId: row.id,
        analyzedDate: data.analyzedDate,
        contactType: data.contactType,
        state: data.state,
        ...(correlationId ? { correlationId } : {}),
      },
    })

    return { analysisId: row.id, conversationId: conversation.id }
  })
}

/**
 * The latest analysis run per conversation for one calendar date, within a set of
 * conversations the caller has already scoped. Pure read used by FR-128.
 */
export async function latestAnalysesForDate({ conversationIds, analyzedDate }) {
  if (!conversationIds.length) return []
  const rows = await prisma.conversationAnalysis.findMany({
    where: { conversationId: { in: conversationIds }, analyzedDate },
    orderBy: { analyzedAt: 'asc' },
  })
  // Last write per conversation wins — ascending order makes the reduce keep it.
  const latest = new Map()
  for (const row of rows) latest.set(row.conversationId, row)
  return [...latest.values()]
}
