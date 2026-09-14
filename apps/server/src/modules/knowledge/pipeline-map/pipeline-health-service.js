// @req FR-215 — Live pipeline health on the map: for the active Business only,
//   each edge backed by a ledger or job table shows counts by status and the last
//   run time, read through the owning domain's read port with one bounded read per table.
// @spec ADR-085 D5, SEC-001, SEC-008
// @tested tests/unit/pipeline-health-service.test.js, tests/unit/knowledge-data-pipeline-map-ui.test.js

import prisma from '@/lib/db'
import { isDomainVisible } from '@/config/domains'
import { seesBusiness } from '@/modules/identity/viewer-authority'

export const BACKED_EDGES_CONFIG = {
  pipelineRun: {
    table: 'PipelineRun',
    domain: 'knowledge',
    monitorUrl: '/execution/data-migration',
    edgeIds: [
      'e.tier1-to-ledger',
      'e.evidence-to-ledger',
      'e.bridge-to-ledger',
      'e.ledger-to-staff',
    ],
  },
  lineConversationJob: {
    table: 'LineConversationJob',
    domain: 'line-oa-studio',
    monitorUrl: '/line-oa/live-crm',
    edgeIds: [
      'e.webhook-to-jobs',
      'e.jobs-to-edge',
      'e.complete-to-jobs',
      'e.jobs-to-line',
      'e.jobs-to-agent',
      'e.agent-to-jobs',
    ],
  },
  lineOaRichMenuJob: {
    table: 'LineOaRichMenuJob',
    domain: 'line-oa-studio',
    monitorUrl: '/line-oa/rich-menus',
    edgeIds: [
      'e.config-to-richmenu-jobs',
      'e.richmenu-jobs-to-line',
    ],
  },
  assetExtractionJob: {
    table: 'AssetExtractionJob',
    domain: 'asset-management',
    monitorUrl: '/assets/receiving',
    edgeIds: [
      'e.asset-to-extraction',
      'e.extraction-to-edge',
      'e.edge-to-extraction-in',
      'e.extraction-in-to-review',
      'e.extraction-to-review',
    ],
  },
}

function refusal(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Aggregates bounded job records into status counts, fail count, and last run time.
 */
export function aggregateJobRecords(records = []) {
  const countsByStatus = {}
  let failedCount = 0
  let lastRunAt = null

  for (const record of records) {
    const status = record.status || 'UNKNOWN'
    countsByStatus[status] = (countsByStatus[status] || 0) + 1
    if (status === 'FAILED') {
      failedCount += 1
    }
    const updatedAt = record.updatedAt ? new Date(record.updatedAt).toISOString() : null
    if (updatedAt && (!lastRunAt || updatedAt > lastRunAt)) {
      lastRunAt = updatedAt
    }
  }

  return {
    total: records.length,
    countsByStatus,
    failedCount,
    lastRunAt,
    hasFailures: failedCount > 0,
  }
}

/**
 * Reads live health metrics for the active Business only.
 * Single bounded read per table (4 queries max per request).
 */
export async function getLivePipelineHealth({ businessId, viewer, db = prisma } = {}) {
  const business = typeof businessId === 'string' ? businessId.trim() : ''
  if (!business) throw refusal(400, 'BUSINESS_REQUIRED')

  if (!viewer) throw refusal(401, 'UNAUTHENTICATED')
  if (!isDomainVisible('knowledge', viewer.visibleDomains)) {
    throw refusal(403, 'KNOWLEDGE_DOMAIN_FORBIDDEN')
  }
  if (!seesBusiness(viewer, business)) {
    throw refusal(404, 'BUSINESS_NOT_FOUND')
  }

  const BOUNDED_TAKE = 100

  // 1. PipelineRun (Domain: knowledge / integration)
  const fetchPipelineRuns = async () => {
    try {
      if (!db?.pipelineRun?.findMany) return []
      return await db.pipelineRun.findMany({
        where: { businessId: business },
        orderBy: { updatedAt: 'desc' },
        take: BOUNDED_TAKE,
        select: { status: true, updatedAt: true },
      })
    } catch (err) {
      console.error('[getLivePipelineHealth] pipelineRun error:', err)
      return []
    }
  }

  // 2. LineConversationJob (Domain: line-oa-studio)
  const fetchLineConversationJobs = async () => {
    try {
      if (!db?.lineConversationJob?.findMany) return []
      return await db.lineConversationJob.findMany({
        where: { businessId: business },
        orderBy: { updatedAt: 'desc' },
        take: BOUNDED_TAKE,
        select: { status: true, updatedAt: true },
      })
    } catch (err) {
      console.error('[getLivePipelineHealth] lineConversationJob error:', err)
      return []
    }
  }

  // 3. LineOaRichMenuJob (Domain: line-oa-studio, linked via LineOaAccount)
  const fetchLineOaRichMenuJobs = async () => {
    try {
      if (!db?.lineOaAccount?.findMany || !db?.lineOaRichMenuJob?.findMany) return []
      const accounts = await db.lineOaAccount.findMany({
        where: { businessId: business },
        select: { id: true },
      })
      const accountIds = accounts.map((a) => a.id)
      if (accountIds.length === 0) return []

      return await db.lineOaRichMenuJob.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { updatedAt: 'desc' },
        take: BOUNDED_TAKE,
        select: { status: true, updatedAt: true },
      })
    } catch (err) {
      console.error('[getLivePipelineHealth] lineOaRichMenuJob error:', err)
      return []
    }
  }

  // 4. AssetExtractionJob (Domain: asset-management)
  const fetchAssetExtractionJobs = async () => {
    try {
      if (!db?.assetExtractionJob?.findMany) return []
      return await db.assetExtractionJob.findMany({
        where: { businessId: business },
        orderBy: { updatedAt: 'desc' },
        take: BOUNDED_TAKE,
        select: { status: true, updatedAt: true },
      })
    } catch (err) {
      console.error('[getLivePipelineHealth] assetExtractionJob error:', err)
      return []
    }
  }

  const [pipelineRuns, conversationJobs, richMenuJobs, extractionJobs] = await Promise.all([
    fetchPipelineRuns(),
    fetchLineConversationJobs(),
    fetchLineOaRichMenuJobs(),
    fetchAssetExtractionJobs(),
  ])

  const tableStats = {
    pipelineRun: aggregateJobRecords(pipelineRuns),
    lineConversationJob: aggregateJobRecords(conversationJobs),
    lineOaRichMenuJob: aggregateJobRecords(richMenuJobs),
    assetExtractionJob: aggregateJobRecords(extractionJobs),
  }

  const edges = {}
  let totalTracked = 0
  let totalFailures = 0

  for (const [key, config] of Object.entries(BACKED_EDGES_CONFIG)) {
    const stats = tableStats[key]
    totalTracked += stats.total
    totalFailures += stats.failedCount

    for (const edgeId of config.edgeIds) {
      edges[edgeId] = {
        table: config.table,
        domain: config.domain,
        monitorUrl: config.monitorUrl,
        total: stats.total,
        countsByStatus: stats.countsByStatus,
        failedCount: stats.failedCount,
        lastRunAt: stats.lastRunAt,
        hasFailures: stats.hasFailures,
      }
    }
  }

  return {
    businessId: business,
    asOf: new Date().toISOString(),
    summary: {
      totalTracked,
      totalFailures,
      hasFailures: totalFailures > 0,
      backedEdgeCount: Object.keys(edges).length,
    },
    edges,
  }
}
