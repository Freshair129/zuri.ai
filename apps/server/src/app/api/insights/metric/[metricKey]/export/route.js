import { insightsGet, csvResponse } from '@/app/api/insights/_insights-http'

// @req FR-275 — the same series as CSV, read from the same snapshot as the chart.
// @spec SEC-001, SEC-008
// @tested tests/unit/marketing/insights/insights-routes.test.js

export const dynamic = 'force-dynamic'

export const GET = insightsGet(async ({ service, query, canRead, params }) => csvResponse(await service.exportMetricCsv({ metricKey: params.metricKey, query, canRead })))
