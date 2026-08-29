import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { latestAnalysesForDate, zAnalyzedDate } from '@/modules/crm/conversation-analysis-service'

// @req FR-128 — the Daily Sales Brief: one aggregate row per (Business, briefDate).
// @spec BR-001, BR-011, SEC-009 — ADR-054 D2/D3/D6
// @tested tests/integration/crm-conversation-intelligence.test.js, tests/unit/conversation-intelligence.test.js
//
// The row is recomputed WHOLE from FR-127 rows on every call — never incremented
// in place — because it is a delivery record over derived data, not a second
// source of truth (the progressCache rule, applied here). Running compute twice
// is the test for that: the second run must overwrite, not add.
//
// Scope: the brief covers the conversations FR-091's inbox would show that
// Business — the Tenant's conversations whose businessId is null (tenant-shared,
// the common case for an unbound LINE binding) or equal to this Business. That is
// BR-001's read scope, restated over analysis rows.
//
// Delivery (SENT/FAILED) is a future slice: sending belongs to the LINE transport
// owner (BR-011), so this module computes and records, and never pushes.

const TOP_N = 5

/** Pure aggregation over the latest analysis rows of one date. Exported for unit tests. */
export function aggregateAnalyses(rows) {
  const stateCounts = {}
  const ctaCounts = new Map()
  const tagCounts = new Map()
  for (const row of rows) {
    stateCounts[row.state] = (stateCounts[row.state] || 0) + 1
    if (row.cta) ctaCounts.set(row.cta, (ctaCounts.get(row.cta) || 0) + 1)
    for (const tag of JSON.parse(row.tagsJson || '[]')) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
    }
  }
  const top = (counts) => [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_N)
    .map(([value, count]) => ({ value, count }))
  return { stateCounts, topCtas: top(ctaCounts), topTags: top(tagCounts) }
}

const zComputeInput = z.object({
  tenantId: z.string().min(1),
  businessId: z.string().min(1),
  briefDate: zAnalyzedDate,
  correlationId: z.string().min(1).optional(),
}).strict()

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Recompute (and upsert) the brief for one Business and one calendar date.
 *
 * @param {{tenantId: string, businessId: string, briefDate: string, correlationId?: string}} input
 * @returns {Promise<{briefId: string, status: string, totalConversations: number, totalAnalyzed: number}>}
 */
export async function computeDailyBrief(input) {
  const { tenantId, businessId, briefDate, correlationId } = zComputeInput.parse(input)

  // Scope check and lookup are the same query: a business outside this tenant
  // does not resolve, so a cross-tenant brief is unsayable.
  const business = await prisma.business.findFirst({
    where: { id: businessId, tenantId },
    select: { id: true, tenantId: true },
  })
  if (!business) throw failure(404, 'BUSINESS_NOT_FOUND')

  const conversations = await prisma.conversation.findMany({
    where: { tenantId, OR: [{ businessId: null }, { businessId: business.id }] },
    select: { id: true },
  })
  const conversationIds = conversations.map((c) => c.id)
  const latest = await latestAnalysesForDate({ conversationIds, analyzedDate: briefDate })
  const { stateCounts, topCtas, topTags } = aggregateAnalyses(latest)

  const aggregate = {
    totalConversations: conversationIds.length,
    totalAnalyzed: latest.length,
    stateCountsJson: JSON.stringify(stateCounts),
    topCtasJson: JSON.stringify(topCtas),
    topTagsJson: JSON.stringify(topTags),
    status: 'PROCESSED',
    processedAt: new Date(),
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.dailyBrief.upsert({
      where: { businessId_briefDate: { businessId: business.id, briefDate } },
      create: { tenantId, businessId: business.id, briefDate, ...aggregate },
      update: { ...aggregate, version: { increment: 1 } },
    })

    await recordAudit(tx, {
      entityType: 'BUSINESS',
      entityId: business.id,
      action: 'DAILY_BRIEF_COMPUTED',
      actorType: 'AGENT',
      payload: {
        tenantId,
        businessId: business.id,
        briefId: row.id,
        briefDate,
        totalConversations: row.totalConversations,
        totalAnalyzed: row.totalAnalyzed,
        ...(correlationId ? { correlationId } : {}),
      },
    })

    return {
      briefId: row.id,
      status: row.status,
      totalConversations: row.totalConversations,
      totalAnalyzed: row.totalAnalyzed,
    }
  })
}
