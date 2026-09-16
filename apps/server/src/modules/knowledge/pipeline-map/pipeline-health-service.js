// @req FR-215 — Live pipeline health on the map: for the active Business only,
//   each edge backed by a ledger or job table shows counts by status and the last
//   run time, read through the owning domain's read port with one bounded read per table.
// @spec ADR-085 D5, SEC-001, SEC-008
// @tested tests/unit/pipeline-health-service.test.js, tests/unit/knowledge-data-pipeline-map-ui.test.js

import { seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { listPipelineRunsForHealth } from '@/platform/integrations/core/pipeline-tracking-service'
import { listLineConversationJobsForBusiness } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { listRichMenuJobsForBusiness } from '@/modules/line-oa-studio/application/line-oa-rich-menu-jobs'
import { listAssetExtractionJobsForBusiness } from '@/modules/asset-management/application/asset-extraction-job-service'

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
  if (!Array.isArray(records)) throw new TypeError('Pipeline health records must be an array')
  const countsByStatus = {}
  let failedCount = 0
  let lastRunAt = null

  for (const record of records) {
    const status = record.status || 'UNKNOWN'
    countsByStatus[status] = (countsByStatus[status] || 0) + 1
    if (status === 'FAILED') {
      failedCount += 1
    }
    const timestamp = record.updatedAt ? new Date(record.updatedAt) : null
    const updatedAt = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp.toISOString() : null
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

function unavailableStats() {
  return {
    available: false,
    total: null,
    countsByStatus: {},
    failedCount: null,
    lastRunAt: null,
    hasFailures: null,
  }
}

const DEFAULT_READ_PORTS = Object.freeze({
  pipelineRun: ({ businessId, ...options }) => listPipelineRunsForHealth(businessId, options),
  lineConversationJob: ({ businessId, ...options }) => listLineConversationJobsForBusiness(businessId, options),
  lineOaRichMenuJob: ({ businessId, ...options }) => listRichMenuJobsForBusiness(businessId, options),
  assetExtractionJob: ({ businessId, ...options }) => listAssetExtractionJobsForBusiness(businessId, options),
})

async function readTableHealth(key, readPort, args) {
  if (typeof readPort !== 'function') return unavailableStats()
  try {
    const records = await readPort(args)
    if (!Array.isArray(records)) throw new TypeError(`${key} read port returned a non-array result`)
    return { available: true, ...aggregateJobRecords(records) }
  } catch {
    // A failed or missing owning read is unavailable, never an invented zero.
    return unavailableStats()
  }
}

/**
 * Reads live health metrics for the active Business only.
 * Single bounded read per table (4 queries max per request).
 */
export async function getLivePipelineHealth({ businessId, viewer, db, readPorts = DEFAULT_READ_PORTS } = {}) {
  const business = typeof businessId === 'string' ? businessId.trim() : ''
  if (!business) throw refusal(400, 'BUSINESS_REQUIRED')

  if (!viewer) throw refusal(401, 'UNAUTHENTICATED')
  if (!seesBusiness(viewer, business)) {
    throw refusal(404, 'BUSINESS_NOT_FOUND')
  }
  try {
    assertDomainVisible(viewer, business, 'knowledge')
  } catch {
    throw refusal(404, 'BUSINESS_NOT_FOUND')
  }

  const BOUNDED_TAKE = 100

  const tableEntries = await Promise.all(
    Object.keys(BACKED_EDGES_CONFIG).map(async (key) => [
      key,
      await readTableHealth(key, readPorts?.[key], { businessId: business, viewer, db, limit: BOUNDED_TAKE }),
    ])
  )
  const tableStats = Object.fromEntries(tableEntries)

  const edges = {}

  for (const [key, config] of Object.entries(BACKED_EDGES_CONFIG)) {
    const stats = tableStats[key]

    for (const edgeId of config.edgeIds) {
      edges[edgeId] = {
        table: config.table,
        domain: config.domain,
        available: stats.available,
        monitorUrl: config.monitorUrl,
        total: stats.total,
        countsByStatus: stats.countsByStatus,
        failedCount: stats.failedCount,
        lastRunAt: stats.lastRunAt,
        hasFailures: stats.hasFailures,
      }
    }
  }

  const stats = Object.values(tableStats)
  const unavailableTableCount = stats.filter((item) => !item.available).length
  const healthAvailable = unavailableTableCount === 0
  const totalTracked = healthAvailable
    ? stats.reduce((total, item) => total + item.total, 0)
    : null
  const totalFailures = healthAvailable
    ? stats.reduce((total, item) => total + item.failedCount, 0)
    : null

  return {
    businessId: business,
    asOf: new Date().toISOString(),
    summary: {
      totalTracked,
      totalFailures,
      hasFailures: healthAvailable ? totalFailures > 0 : null,
      backedEdgeCount: Object.keys(edges).length,
      availableTableCount: stats.length - unavailableTableCount,
      unavailableTableCount,
      healthAvailable,
    },
    edges,
  }
}
