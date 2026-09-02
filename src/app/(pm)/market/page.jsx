import MarketDashboard from '@/modules/market-intelligence/components/MarketDashboard'

// @req FR-092 — the Market Intelligence console route. The dashboard reads
//   `GET /api/market/observations` for the Business the shell has open; this file
//   stays a mount point so the Business scope comes from the shell context rather
//   than from a route param a caller could name.
// @spec SDD-049, BR-001, ADR-038
// @tested tests/unit/market-intelligence/market-observations-route.test.js,
//   tests/integration/market-intelligence-observation-feed.test.js
//
// The previous annotation cited `price-observation-domain.test.js`, which proves a
// pure domain calculator and never touches this page — an @req/@tested pair that
// pointed a reader at regression coverage this route did not have.

export default function MarketPage() {
  return <MarketDashboard />
}
