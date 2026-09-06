import prisma from '@/lib/db'
import { handle, queryParams } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getMarketObservationFeed,
  parseMarketObservationFeedQuery,
} from '@/modules/market-intelligence/application/market-observation-service'
import { createMarketObservationRepository } from '@/modules/market-intelligence/infrastructure/market-observation-repository'

// @req FR-092 — the first surface-reachable endpoint for Market Intelligence: the
//   translated `MarketObservation` state FR-092 has been able to persist since PR #88,
//   read back for the Business the console has open. Until this route existed the
//   domain had no route at all, so `/market` could only show fixtures.
// @spec SDD-049, BR-001, SEC-001, SEC-017, ADR-038
// @tested tests/unit/market-intelligence/market-observations-route.test.js,
//   tests/integration/market-intelligence-observation-feed.test.js
//
// GET only, and that is the boundary rather than an omission. A `MarketObservation` has
// exactly one writer — the FR-092 translation seam over Integration-owned raw evidence
// (ADR-038) — and a POST here would be a second write path into rows whose whole value
// is that they can name the raw record they came from. Nothing on this surface creates
// market state; it reads what translation already recorded.
//
// This handler is the composition root: it owns the Prisma client and the persistence
// adapter, and the application service owns the authorization decision. That split is
// why the service can be exercised with a fake repository and still be the same code
// that answers this request.

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = parseMarketObservationFeedQuery(queryParams(request))
    return getMarketObservationFeed(
      { viewer, ...query },
      { db: prisma, createRepository: createMarketObservationRepository },
    )
  })
}
