import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { makeViewer } from '../../factories/viewer'
import { translateRawRecordToMarketObservation } from '@/modules/market-intelligence/application/translate-raw-record'
import { extractGenericMarketCandidate } from '@/modules/market-intelligence/application/generic-candidate-extractor'
import { getMarketObservationFeed } from '@/modules/market-intelligence/application/market-observation-service'

// The legacy half of the Market parity pair (service extraction M1). The Market
// Intelligence service keeps its own copy of the translation core under
// services/market-intelligence; its contracts/v1 vectors are replayed here through
// the module that still executes in production. If either copy changes behaviour,
// one of the two parity tests fails, so the copies cannot drift silently before M3
// routes callers to the service and deletes one of them.
// Only the JSON file crosses the app boundary; no service code is imported, so the
// server image and its build context are unaffected.

const vectors = JSON.parse(readFileSync(
  new URL('../../../../../services/market-intelligence/contracts/v1/translation-vectors.json', import.meta.url),
  'utf8',
))

function revive(raw) {
  return { ...raw, receivedAt: raw.receivedAt ? new Date(raw.receivedAt) : raw.receivedAt }
}

describe('Market service-core parity vectors (legacy module)', () => {
  it('reads the v1 vector contract', () => {
    expect(vectors.contract).toBe('market-intelligence.translation-vectors')
    expect(vectors.version).toBe(1)
    expect(vectors.translations.length).toBeGreaterThanOrEqual(8)
  })

  for (const vector of vectors.translations) {
    it(`translation: ${vector.name}`, async () => {
      const run = translateRawRecordToMarketObservation(revive(vector.raw), {
        extractCandidate: extractGenericMarketCandidate,
        knowledgeResolver: vector.resolution ? async () => vector.resolution : undefined,
        now: () => new Date(vectors.now),
      })
      if (vector.expectedErrorIncludes) {
        await expect(run).rejects.toThrow(vector.expectedErrorIncludes)
        return
      }
      const draft = await run
      expect({
        ...draft,
        observedAt: draft.observedAt.toISOString(),
        translatedAt: draft.translatedAt.toISOString(),
      }).toEqual(vector.expected)
    })
  }

  it('feed rows: every vector row presents identically', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], visibleDomains: ['market', 'projects', 'people', 'platform'] })
    const db = { business: { findUnique: async () => ({ id: 'b-1', tenantId: 't-1', name: 'B1' }) } }
    const rows = vectors.feedRows.map((vector) => vector.row)
    const feed = await getMarketObservationFeed(
      { viewer, businessId: 'b-1', limit: 200 },
      { db, createRepository: () => ({ listRecent: async () => rows }) },
    )
    expect(feed.observations).toEqual(vectors.feedRows.map((vector) => vector.expected))
  })
})
