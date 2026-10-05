// Marketing Insights — the query service the /api/insights routes read through.
//
// @req FR-275 — no persistent reporting repository exists before I2 (the B2 review deferred
// persistence), so this release has no service and every Insights route answers 503
// INSIGHTS_NOT_CONFIGURED. Synthetic fixtures stay in tests; they are never served.
// @spec docs/migrations/service-extraction/INSIGHTS-PERSISTENCE-PROPOSAL.md (Integrator review)
// @tested tests/unit/marketing/insights/insights-routes.test.js

export function getInsightsQueryService() {
  return null
}
