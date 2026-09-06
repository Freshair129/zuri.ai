import prisma from '@/lib/db'
import { handle } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  parseMarketTranslationRunInput,
  runMarketTranslationForBusiness,
} from '@/modules/market-intelligence/application/market-observation-service'
import { createMarketObservationRepository } from '@/modules/market-intelligence/infrastructure/market-observation-repository'
import { listMarketLaneRawRecordCandidates } from '@/modules/market-intelligence/infrastructure/market-raw-record-repository'
import { extractGenericMarketCandidate } from '@/modules/market-intelligence/application/generic-candidate-extractor'

// @req FR-092 — the production trigger for the FR-092 translation seam. Until this
//   route existed, `loadTranslateAndPersistRawMarketRecord` had no caller outside a
//   test: a raw record ingested through FR-081 into the `MARKET_INTELLIGENCE` lane
//   stayed untranslated forever unless someone ran code by hand. This route is an
//   explicit, owner-initiated run over one Business's untranslated backlog — not a
//   scheduler and not a second acquisition path (that decision, and why the
//   marketplace/retail acquisition adapters stay unwired, is recorded in
//   docs/domains/market-intelligence/features/FR-092-market-translation-core.md,
//   "Decision 2026-09-02").
// @spec SDD-049, BR-001, SEC-001, SEC-017, ADR-038
// @tested tests/unit/market-intelligence/market-translations-route.test.js,
//   tests/integration/market-intelligence-translation-run.test.js
//
// POST only, and gated on ownership rather than visibility: a translation run writes
// `MarketObservation` rows, so `runMarketTranslationForBusiness` authorizes with
// `ownsBusiness`, the same predicate every other Business-scoped write in this
// repository uses, and refuses an existing-but-unowned Business with the identical
// 404 a nonexistent one gets (FR-072 disclosure discipline).
//
// This handler is the composition root: it owns the Prisma client, the persistence
// adapter, the raw-record candidate reader and the default provider-neutral
// `extractCandidate` port. `knowledgeResolver` is deliberately left unconfigured here
// — the translator's own contract already treats an absent resolver as a truthful
// UNRESOLVED for every row (fail-closed by construction), and wiring a production GKS
// reader is Knowledge-domain infrastructure this route does not invent.

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    const input = parseMarketTranslationRunInput(body)
    return runMarketTranslationForBusiness(
      { viewer, ...input },
      {
        db: prisma,
        createRepository: createMarketObservationRepository,
        listCandidates: listMarketLaneRawRecordCandidates,
        extractCandidate: extractGenericMarketCandidate,
      },
    )
  })
}
