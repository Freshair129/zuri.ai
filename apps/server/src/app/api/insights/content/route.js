import { insightsGet } from '@/app/api/insights/_insights-http'

// @req FR-275 — content performance: summary, top content and format breakdown.
// @spec SEC-001, SEC-008
// @tested tests/unit/marketing/insights/insights-routes.test.js

export const dynamic = 'force-dynamic'

export const GET = insightsGet(({ service, query, canRead }) => service.getContent({ query, canRead }))
