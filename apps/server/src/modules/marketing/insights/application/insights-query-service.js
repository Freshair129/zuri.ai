// Marketing Insights (S6) — query composition for Overview / Results / Content.
// Reads the reporting read model through an injected InsightsRepository only.
// No provider client is reachable from here, so no report request can become
// a live Graph API call (contract §6, §8; acceptance "no direct Graph calls").
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-10 read DTOs, R-12 refresh, R-13 CSV consistency), SEC-001
// @tested tests/unit/marketing/insights/insights-query-service.test.js
//
// Every method returns `{ data, meta }`. `data` keeps the contract §6 shape
// (arrays / object) with additive fields and nullable numbers; `meta` carries
// window, asset, snapshot and cohort semantics. How `meta` reaches the client
// (header or envelope) is proposed delta D-API-1 and is decided at the route.

import { z } from 'zod'
import { DAILY_METRICS, DAILY_METRIC_KEYS, getMetricDefinition, AGGREGATION } from '../domain/metric-catalog'
import { resolveReportWindow, enumerateDays, ReportWindowError } from '../domain/report-window'
import { buildDailySeries, summarizeSeries, periodChange } from '../domain/metric-series'
import { resolveInsightScope, listReadableBrands } from '../domain/brand-scope'
import {
  CONTENT_TYPE_FILTERS, CONTENT_COHORT, CONTENT_METRIC_PERIOD, TOP_CONTENT_DEFAULT_LIMIT, TOP_CONTENT_MAX_LIMIT,
  filterByType, inPublishWindow, summarizeContent, rankTopContent, formatBreakdown,
} from '../domain/content-report'
import { metricSeriesCsv, exportFilename } from '../domain/csv'
import {
  PORT_VERSION, insightsErrors, parseDailyReadResult, parseContentReadResult,
  assertInsightsRepository, assertBindingReadPort, zAssetBinding,
} from '../ports/insights-ports'

export const INSIGHTS_SCHEMA_VERSION = 'insights/1.0-candidate'

const zReportQuery = z.object({
  brand: z.string().min(1).max(32),
  asset: z.string().min(1).max(128).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  type: z.enum(CONTENT_TYPE_FILTERS).optional(),
  limit: z.coerce.number().int().min(1).max(TOP_CONTENT_MAX_LIMIT).optional(),
  snapshot: z.string().min(1).max(128).optional(),
}).strict()

function parseQuery(query) {
  const cleaned = Object.fromEntries(Object.entries(query ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  const result = zReportQuery.safeParse(cleaned)
  if (!result.success) {
    throw insightsErrors.invalidQuery(result.error.issues.map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`).join('; '))
  }
  return result.data
}

function windowFor(query, now) {
  try {
    return resolveReportWindow({ from: query.from ?? null, to: query.to ?? null }, { now })
  } catch (error) {
    if (error instanceof ReportWindowError) throw insightsErrors.invalidQuery(error.message)
    throw error
  }
}

function requireMetric(metricKey) {
  const definition = getMetricDefinition(metricKey)
  if (!definition) throw insightsErrors.invalidQuery(`unknown metric: ${String(metricKey).slice(0, 40)}`)
  return definition
}

function sliceByDays(points, days) {
  const wanted = new Set(days)
  return points.filter((point) => wanted.has(point.date))
}

export function createInsightsQueryService({ repository, bindingPort, now = () => new Date() } = {}) {
  assertInsightsRepository(repository)
  assertBindingReadPort(bindingPort)

  async function scopeFor(query, canRead) {
    const bindings = z.array(zAssetBinding).parse(await bindingPort.listBindings())
    return resolveInsightScope({ brand: query.brand, assetId: query.asset ?? null, bindings, canRead })
  }

  function baseMeta(scope, window, snapshot, extra = {}) {
    return {
      schemaVersion: INSIGHTS_SCHEMA_VERSION,
      portVersion: PORT_VERSION,
      brand: scope.brand,
      asset: { assetId: scope.asset.bindingId, assetKind: scope.asset.assetKind, displayName: scope.asset.displayName },
      assets: scope.assets,
      window: { from: window.from, to: window.to, days: window.days, timezone: window.timezone, inclusive: window.inclusive, includesPartialDay: window.includesPartialDay },
      previous: window.previous,
      snapshot,
      source: 'REPORTING_READ_MODEL',
      ...extra,
    }
  }

  async function readSeries(query, canRead, metricKeys) {
    const window = windowFor(query, now())
    const scope = await scopeFor(query, canRead)
    const assetId = scope.asset.bindingId
    const raw = await repository.readDailyObservations({
      tenantId: scope.asset.tenantId,
      businessId: scope.asset.businessId,
      assetId,
      metricKeys,
      from: window.previous.from,
      to: window.to,
      snapshotId: query.snapshot ?? null,
    })
    const read = parseDailyReadResult(raw, { assetId })
    if (query.snapshot && read.snapshot.snapshotId !== query.snapshot) throw insightsErrors.snapshotExpired()

    const allDays = enumerateDays(window.previous.from, window.to)
    const partialDates = window.includesPartialDay ? [window.today] : []
    const series = {}
    const ordered = DAILY_METRICS.filter((definition) => metricKeys.includes(definition.metricKey))
      .sort((a, b) => Number(a.aggregation === AGGREGATION.DERIVED_DIFFERENCE) - Number(b.aggregation === AGGREGATION.DERIVED_DIFFERENCE))
    for (const definition of ordered) {
      series[definition.metricKey] = buildDailySeries(definition, read.observations, allDays, { partialDates, inputs: series })
    }
    return { window, scope, read, series }
  }

  function metricSummary(definition, window, allPoints, windowAggregates) {
    const current = sliceByDays(allPoints, enumerateDays(window.from, window.to))
    const previous = sliceByDays(allPoints, enumerateDays(window.previous.from, window.previous.to))
    const aggregateFor = (from, to) => windowAggregates.find((row) => row.metricKey === definition.metricKey && row.from === from && row.to === to) ?? null
    const now = summarizeSeries(definition, current, { windowAggregate: aggregateFor(window.from, window.to) })
    const before = summarizeSeries(definition, previous, { windowAggregate: aggregateFor(window.previous.from, window.previous.to) })
    const change = periodChange(now, before)
    return { current, now, before, change }
  }

  return Object.freeze({
    /** Brands the viewer can open. Denied brands are absent, not flagged. */
    async listBrands({ canRead }) {
      const bindings = z.array(zAssetBinding).parse(await bindingPort.listBindings())
      return { data: listReadableBrands({ bindings, canRead }), meta: { schemaVersion: INSIGHTS_SCHEMA_VERSION } }
    },

    /** GET /api/insights/summary — contract §6 array, one item per metric. */
    async getSummary({ query, canRead }) {
      const parsed = parseQuery(query)
      const { window, scope, read, series } = await readSeries(parsed, canRead, DAILY_METRIC_KEYS)
      const data = DAILY_METRICS.map((definition) => {
        const { current, now: summary, before, change } = metricSummary(definition, window, series[definition.metricKey], read.windowAggregates)
        return {
          metricKey: definition.metricKey,
          total: summary.total,
          changePct: change.changePct,
          series: current.map((point) => ({ date: point.date, value: point.value })),
          // additive fields (proposed delta D-API-1)
          label: definition.label,
          labelTh: definition.labelTh,
          unit: summary.unit ?? (definition.unit === 'duration' ? null : definition.unit),
          aggregation: definition.aggregation,
          state: summary.state,
          reasonCode: summary.reasonCode,
          changeReasonCode: change.changeReasonCode,
          previousTotal: before.total,
          coverage: summary.coverage,
          seriesQuality: current.map((point) => point.quality),
        }
      })
      return { data, meta: baseMeta(scope, window, read.snapshot) }
    },

    /** GET /api/insights/metric/:metricKey — contract §6 `{date, organic, paid}[]`. */
    async getMetricSeries({ metricKey, query, canRead }) {
      const definition = requireMetric(metricKey)
      const parsed = parseQuery(query)
      const keys = definition.derivedFrom ? [...definition.derivedFrom, definition.metricKey] : [definition.metricKey]
      const { window, scope, read, series } = await readSeries(parsed, canRead, keys)
      const { current, now: summary, change } = metricSummary(definition, window, series[definition.metricKey], read.windowAggregates)
      const data = current.map((point) => ({
        date: point.date,
        organic: point.organic,
        paid: point.paid,
        value: point.value,
        quality: point.quality,
        unit: point.unit,
      }))
      return {
        data,
        meta: baseMeta(scope, window, read.snapshot, {
          metricKey: definition.metricKey,
          total: summary.total,
          state: summary.state,
          reasonCode: summary.reasonCode,
          changePct: change.changePct,
          changeReasonCode: change.changeReasonCode,
          aggregation: definition.aggregation,
          distributions: definition.distributions,
        }),
      }
    },

    /**
     * GET /api/insights/metric/:metricKey/export — the same points as the
     * chart. With `snapshot`, a snapshot that is no longer readable refuses
     * (409) instead of silently exporting newer numbers.
     */
    async exportMetricCsv({ metricKey, query, canRead }) {
      const { data, meta } = await this.getMetricSeries({ metricKey, query, canRead })
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: exportFilename({ brand: meta.brand, metricKey: meta.metricKey, from: meta.window.from, to: meta.window.to }),
        body: metricSeriesCsv(data),
        meta,
      }
    },

    /** GET /api/insights/content — contract §6 object. */
    async getContent({ query, canRead }) {
      const parsed = parseQuery(query)
      const type = parsed.type ?? 'all'
      const window = windowFor(parsed, now())
      const scope = await scopeFor(parsed, canRead)
      const assetId = scope.asset.bindingId
      const raw = await repository.readContentItems({
        tenantId: scope.asset.tenantId,
        businessId: scope.asset.businessId,
        assetId,
        publishedFrom: window.previous.from,
        publishedTo: window.to,
        snapshotId: parsed.snapshot ?? null,
      })
      const read = parseContentReadResult(raw, { assetId })
      if (parsed.snapshot && read.snapshot.snapshotId !== parsed.snapshot) throw insightsErrors.snapshotExpired()

      const filtered = filterByType(read.items, type)
      const current = inPublishWindow(filtered, window)
      const previous = inPublishWindow(filtered, window.previous)
      const { summary, quality } = summarizeContent(current)
      return {
        data: {
          summary,
          topContent: rankTopContent(current, { limit: parsed.limit ?? TOP_CONTENT_DEFAULT_LIMIT }),
          byFormat: formatBreakdown(current, previous),
        },
        meta: baseMeta(scope, window, read.snapshot, {
          type,
          cohort: CONTENT_COHORT,
          metricPeriod: CONTENT_METRIC_PERIOD,
          summaryQuality: quality,
          itemCount: current.length,
          previousItemCount: previous.length,
        }),
      }
    },
  })
}
