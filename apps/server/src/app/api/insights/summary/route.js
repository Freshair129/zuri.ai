import { insightsGet } from '@/app/api/insights/_insights-http'

// @req FR-275 — one brand's metric summary for the window, from one snapshot.
// @spec SEC-001, SEC-008
// @tested tests/unit/marketing/insights/insights-routes.test.js

export const dynamic = 'force-dynamic'

export const GET = insightsGet(({ service, query, canRead }) => service.getSummary({ query, canRead }))
