import prisma from '@/lib/db'
import { getRevenueSummary } from '@/modules/commerce/application/revenue-read-model'
import { listPhase1Integrations } from '@/modules/integration/application/integration-management-service'
import { assertMarketingReadAccess } from './marketing-authority'
import { listMarketingCampaigns } from './marketing-campaign-service'
import { listMarketingOperations } from './marketing-operations-service'
import { classifyMarketingQuestion, zMarketingAskInput } from '../domain/marketing-broadcast-contract'

// @req FR-185 — Marketing read projections use real owner DTOs and preserve
// unavailable/unknown provider evidence without fixture metrics or actions.
// @spec SDD-086, ADR-065, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-insights-service.test.js,
//   tests/integration/marketing-p5-owner-reads.test.js

const PAID_UNAVAILABLE = 'PAID_MEDIA_METRICS_SOURCE_UNAVAILABLE'
const OVERVIEW_UNAVAILABLE = 'MARKETING_OVERVIEW_SOURCE_UNAVAILABLE'

function nowIso(now = () => new Date()) {
  const value = typeof now === 'function' ? now() : now
  return new Date(value).toISOString()
}

function source(owner, source, state, { ref = null, sourceVersion = null, window = null, reasonCode = null } = {}) {
  return { owner, source, sourceVersion, ref, window, state, ...(reasonCode ? { reasonCode } : {}) }
}

function settledSource(result, owner, sourceName, { ref = null, sourceVersion = null, window = null } = {}) {
  if (result.status === 'fulfilled') {
    const value = result.value
    const sectionStates = value && typeof value === 'object' && value.sections
      ? Object.values(value.sections).map((section) => section?.state).filter(Boolean)
      : []
    const rows = Array.isArray(value) ? value : value?.campaigns || value?.intake || value?.accounts || null
    const state = sectionStates.includes('UNKNOWN')
      ? (sectionStates.some((item) => item === 'READY' || item === 'EMPTY') ? 'PARTIAL' : 'UNKNOWN')
      : sectionStates.includes('UNAVAILABLE') || sectionStates.includes('PARTIAL')
        ? (sectionStates.some((item) => item === 'READY' || item === 'EMPTY') ? 'PARTIAL' : 'UNAVAILABLE')
        : rows && rows.length === 0 ? 'EMPTY' : 'READY'
    return {
      value,
      source: source(owner, sourceName, state, { ref, sourceVersion, window: sourceName === 'VERIFIED_REVENUE' ? { from: value?.from ?? null, to: value?.to ?? null } : window }),
    }
  }
  const error = result.reason
  const isForbidden = Number(error?.status) === 403 || Number(error?.status) === 404
  return {
    value: null,
    source: source(owner, sourceName, isForbidden ? 'UNAVAILABLE' : 'UNKNOWN', {
      ref, sourceVersion, window,
      reasonCode: isForbidden ? `${sourceName}_UNAVAILABLE` : `${sourceName}_READ_UNKNOWN`,
    }),
  }
}

function aggregateState(sources) {
  const states = sources.map((item) => item.state)
  if (states.some((state) => state === 'UNKNOWN')) return states.some((state) => state === 'READY' || state === 'EMPTY' || state === 'PARTIAL') ? 'PARTIAL' : 'UNKNOWN'
  if (states.some((state) => state === 'PARTIAL')) return 'PARTIAL'
  if (states.some((state) => state === 'READY' || state === 'EMPTY')) return states.some((state) => state === 'UNAVAILABLE') ? 'PARTIAL' : 'READY'
  return 'UNAVAILABLE'
}

function unavailableMetric(key) {
  return { key, value: null, state: 'UNAVAILABLE', reasonCode: PAID_UNAVAILABLE }
}

export async function getMarketingPaidMedia({ businessId, viewer } = {}, {
  db = prisma,
  now = () => new Date(),
  from = null,
  to = null,
} = {}) {
  await assertMarketingReadAccess({ db, viewer, businessId })
  const window = { from, to }
  const results = await Promise.allSettled([
    listMarketingCampaigns({ viewer, businessId }, { db }),
    listMarketingOperations({ viewer, businessId }, { db }),
    listPhase1Integrations({ db, businessId, resolve: async () => viewer, now: typeof now === 'function' ? now() : now }),
    getRevenueSummary({ businessId, ...(from ? { from } : {}), ...(to ? { to } : {}) }, { viewer, db }),
  ])
  const campaigns = settledSource(results[0], 'MARKETING', 'MARKETING_CAMPAIGNS')
  const operations = settledSource(results[1], 'MARKETING', 'MARKETING_OPERATIONS')
  const integrations = settledSource(results[2], 'INTEGRATION', 'PHASE1_INTEGRATIONS')
  const revenue = settledSource(results[3], 'COMMERCE', 'VERIFIED_REVENUE', { window })
  const paidMetrics = source('INTEGRATION', 'PAID_MEDIA_METRICS', 'UNAVAILABLE', { reasonCode: PAID_UNAVAILABLE })
  const sources = [campaigns.source, operations.source, integrations.source, revenue.source, paidMetrics]
  return {
    readModel: 'MARKETING_PAID_MEDIA',
    schemaVersion: '1.0',
    businessId,
    generatedAt: nowIso(now),
    state: aggregateState(sources),
    metrics: ['spend', 'impressions', 'clicks', 'platformRevenue', 'frequency', 'roas'].map(unavailableMetric),
    verifiedRevenue: revenue.source.state === 'READY' ? revenue.value : null,
    sources,
    unavailable: [{ source: 'PAID_MEDIA_METRICS', reasonCode: PAID_UNAVAILABLE }],
    projections: {
      campaigns: campaigns.value?.campaigns || [],
      operations: operations.value || null,
      integrations: integrations.value || [],
    },
  }
}

export async function askMarketing({ businessId, question } = {}, {
  viewer,
  db = prisma,
  now = () => new Date(),
} = {}) {
  const input = zMarketingAskInput.parse({ businessId, question })
  await assertMarketingReadAccess({ db, viewer, businessId: input.businessId })
  const intentType = classifyMarketingQuestion(input.question)
  if (intentType === 'UNSUPPORTED') {
    return {
      readModel: 'MARKETING_ASK', schemaVersion: '1.0', businessId: input.businessId,
      question: input.question, intentType, state: 'UNAVAILABLE', answer: null, sources: [],
      unavailable: [{ source: 'ASK_MARKETING', reasonCode: 'QUESTION_UNSUPPORTED' }], generatedAt: nowIso(now),
    }
  }

  if (intentType === 'ANALYZE_ROAS' || intentType === 'DETECT_FATIGUE') {
    const paid = await getMarketingPaidMedia({ businessId: input.businessId, viewer }, { db, now })
    return {
      readModel: 'MARKETING_ASK', schemaVersion: '1.0', businessId: input.businessId,
      question: input.question, intentType, state: paid.state === 'UNKNOWN' ? 'UNKNOWN' : 'UNAVAILABLE',
      answer: null, sources: paid.sources, unavailable: [{ source: 'PAID_MEDIA_METRICS', reasonCode: PAID_UNAVAILABLE }],
      generatedAt: nowIso(now),
    }
  }

  const results = await Promise.allSettled([
    listMarketingCampaigns({ viewer, businessId: input.businessId }, { db }),
    listMarketingOperations({ viewer, businessId: input.businessId }, { db }),
    getRevenueSummary({ businessId: input.businessId }, { viewer, db }),
  ])
  const campaigns = settledSource(results[0], 'MARKETING', 'MARKETING_CAMPAIGNS')
  const operations = settledSource(results[1], 'MARKETING', 'MARKETING_OPERATIONS')
  const revenue = settledSource(results[2], 'COMMERCE', 'VERIFIED_REVENUE')
  const sources = [campaigns.source, operations.source, revenue.source]
  const state = aggregateState(sources)
  const sections = []
  if (campaigns.value) sections.push({ key: 'campaigns', title: 'Campaigns', count: campaigns.value.campaigns?.length ?? 0 })
  if (operations.value) {
    const intakeState = operations.value.sections?.intake?.state || 'UNKNOWN'
    sections.push({
      key: 'operations',
      title: 'Operations',
      count: intakeState === 'READY' || intakeState === 'EMPTY' ? (operations.value.intake?.length ?? 0) : null,
      state: intakeState,
    })
  }
  if (revenue.value) sections.push({ key: 'verifiedRevenue', title: 'Verified revenue', value: revenue.value.verifiedNet, window: { from: revenue.value.from, to: revenue.value.to } })
  return {
    readModel: 'MARKETING_ASK', schemaVersion: '1.0', businessId: input.businessId,
    question: input.question, intentType, state,
    answer: { sections, recommendations: [] }, sources,
    unavailable: sources.filter((item) => item.state === 'UNAVAILABLE' || item.state === 'UNKNOWN').map((item) => ({ source: item.source, reasonCode: item.reasonCode })),
    generatedAt: nowIso(now),
  }
}
