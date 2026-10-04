import { z } from 'zod'
import prisma from '@/lib/db'
import { getRevenueSummary } from '@/modules/commerce/application/revenue-read-model'
import { getSalesTaskHealthSummary } from '@/modules/crm/sales-task-service'
import { assertMarketingReadAccess } from './marketing-authority'

// @req FR-278 — read-only weekly executive view, using only Commerce and CRM
//   owner reads and preserving unavailable sources without fabricated values.
// @spec FR-161; FR-163; SEC-001; SDD-086
// @tested tests/unit/marketing/line-sales-dashboard-service.test.js

const TIME_ZONE = 'Asia/Bangkok'
const zDashboardQuery = z.object({
  businessId: z.string().trim().min(1).max(200),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict()

function dayKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDays(key, days) {
  const value = new Date(`${key}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function weekWindow(now, weekOf) {
  const today = dayKey(now)
  const todayUtc = new Date(`${today}T00:00:00.000Z`)
  const mondayOffset = (todayUtc.getUTCDay() + 6) % 7
  const thisMonday = addDays(today, -mondayOffset)
  const from = weekOf ?? addDays(thisMonday, -7)
  const parsed = new Date(`${from}T00:00:00.000Z`)
  if (parsed.toISOString().slice(0, 10) !== from || parsed.getUTCDay() !== 1) {
    throw new Error('weekOf must be a valid Monday in Asia/Bangkok')
  }
  const toExclusive = addDays(from, 7)
  return { from, to: addDays(toExclusive, -1), toExclusive, timeZone: TIME_ZONE }
}

function settledOwnerRead(result, owner, source, observedAt, window = null) {
  if (result.status === 'fulfilled') {
    return {
      value: result.value,
      source: { owner, source, state: 'READY', reasonCode: null, observedAt: result.value?.observedAt ?? observedAt, window },
    }
  }
  const unavailable = result.reason?.status === 403 || result.reason?.status === 404
  return {
    value: null,
    source: {
      owner, source, state: unavailable ? 'UNAVAILABLE' : 'UNKNOWN',
      reasonCode: `${source}_${unavailable ? 'UNAVAILABLE' : 'READ_UNKNOWN'}`,
      observedAt, window,
    },
  }
}

function aggregateState(sources) {
  const states = sources.map((item) => item.state)
  const available = states.some((state) => state === 'READY' || state === 'EMPTY' || state === 'PARTIAL')
  if (states.includes('UNKNOWN')) return available ? 'PARTIAL' : 'UNKNOWN'
  if (states.includes('PARTIAL')) return 'PARTIAL'
  if (states.includes('UNAVAILABLE')) return available ? 'PARTIAL' : 'UNAVAILABLE'
  return 'READY'
}

const unavailableSection = (owner, source, reasonCode, metrics) => ({
  owner, source, state: 'UNAVAILABLE', reasonCode, metrics,
})

export async function getLineSalesExecutiveDashboard(query, {
  viewer,
  db = prisma,
  now = () => new Date(),
} = {}) {
  const input = zDashboardQuery.parse(query)
  const requestedAt = typeof now === 'function' ? now() : now
  const window = weekWindow(requestedAt, input.weekOf)
  await assertMarketingReadAccess({ db, viewer, businessId: input.businessId })

  const results = await Promise.allSettled([
    getRevenueSummary({ businessId: input.businessId, from: window.from, to: window.to }, { viewer, db }),
    getSalesTaskHealthSummary({ businessId: input.businessId }, { viewer, db, now: requestedAt }),
  ])
  const generatedAt = requestedAt.toISOString()
  const commerce = settledOwnerRead(results[0], 'COMMERCE', 'VERIFIED_REVENUE', generatedAt, {
    from: window.from, to: window.to, toExclusive: window.toExclusive, timeZone: TIME_ZONE,
  })
  const crm = settledOwnerRead(results[1], 'CRM', 'SALES_TASK_HEALTH', generatedAt)
  const sources = [
    commerce.source,
    crm.source,
    { owner: 'INTEGRATION', source: 'PAID_MEDIA_METRICS', state: 'UNAVAILABLE', reasonCode: 'PAID_MEDIA_METRICS_SOURCE_UNAVAILABLE', observedAt: null, window },
    { owner: 'CRM', source: 'LEAD_ATTRIBUTION', state: 'UNAVAILABLE', reasonCode: 'LEAD_ATTRIBUTION_SOURCE_UNAVAILABLE', observedAt: null, window },
    { owner: 'CRM', source: 'CALL_OUTCOMES', state: 'UNAVAILABLE', reasonCode: 'CALL_OUTCOMES_SOURCE_UNAVAILABLE', observedAt: null, window },
  ]
  const revenue = commerce.value
  const tasks = crm.value

  return {
    readModel: 'LINE_OA_SALES_EXECUTIVE_DASHBOARD',
    schemaVersion: '1.0',
    businessId: input.businessId,
    generatedAt,
    state: aggregateState(sources),
    window,
    sections: {
      commerce: {
        state: commerce.source.state,
        verifiedNet: revenue?.verifiedNet ?? null,
        refunded: revenue?.refunded ?? null,
        pending: revenue ? revenue.pending : null,
        orders: revenue ? revenue.orders : null,
        source: commerce.source,
      },
      followUp: {
        state: crm.source.state,
        summary: tasks?.summary ?? null,
        observedAt: tasks?.observedAt ?? null,
        source: crm.source,
      },
      paidMedia: unavailableSection('INTEGRATION', 'PAID_MEDIA_METRICS', 'PAID_MEDIA_METRICS_SOURCE_UNAVAILABLE', {
        spend: null, impressions: null, clicks: null, abTestResults: null, attributedRevenue: null, roas: null,
      }),
      leadAttribution: unavailableSection('CRM', 'LEAD_ATTRIBUTION', 'LEAD_ATTRIBUTION_SOURCE_UNAVAILABLE', {
        aiReplies: null, answeredConversations: null, leadHandoffs: null,
        leads: null, readiness: null, permissionToCall: null,
      }),
      callOutcomes: unavailableSection('CRM', 'CALL_OUTCOMES', 'CALL_OUTCOMES_SOURCE_UNAVAILABLE', {
        attempts: null, outcomes: null,
      }),
    },
    sources,
  }
}
