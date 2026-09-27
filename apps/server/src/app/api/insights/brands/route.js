import { insightsGet } from '@/app/api/insights/_insights-http'

// @req FR-275 — brands the viewer may open; a denied brand is absent, not flagged.
// @spec SEC-001, SEC-008
// @tested tests/unit/marketing/insights/insights-routes.test.js

export const dynamic = 'force-dynamic'

export const GET = insightsGet(({ service, canRead }) => service.listBrands({ canRead }))
