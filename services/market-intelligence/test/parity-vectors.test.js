import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  extractGenericMarketCandidate,
  toFeedRow,
  translateRawRecordToMarketObservation,
} from '../src/index.js'

// The service half of the parity pair. apps/server's
// tests/unit/market-intelligence/service-core-parity.test.js replays the same file
// through the legacy module; both must pass for the two copies to be called equal.

const vectors = JSON.parse(await readFile(new URL('../contracts/v1/translation-vectors.json', import.meta.url), 'utf8'))

function revive(raw) {
  return { ...raw, receivedAt: raw.receivedAt ? new Date(raw.receivedAt) : raw.receivedAt }
}

test('vector file is the v1 contract and is not empty', () => {
  assert.equal(vectors.contract, 'market-intelligence.translation-vectors')
  assert.equal(vectors.version, 1)
  assert.ok(vectors.translations.length >= 8)
  assert.ok(vectors.feedRows.length >= 5)
})

for (const vector of vectors.translations) {
  test(`translation vector: ${vector.name}`, async () => {
    const run = translateRawRecordToMarketObservation(revive(vector.raw), {
      extractCandidate: extractGenericMarketCandidate,
      knowledgeResolver: vector.resolution ? async () => vector.resolution : undefined,
      now: () => new Date(vectors.now),
    })
    if (vector.expectedErrorIncludes) {
      await assert.rejects(run, (error) => error.message.includes(vector.expectedErrorIncludes))
      return
    }
    const draft = await run
    assert.deepEqual(
      { ...draft, observedAt: draft.observedAt.toISOString(), translatedAt: draft.translatedAt.toISOString() },
      vector.expected,
    )
  })
}

for (const vector of vectors.feedRows) {
  test(`feed row vector: ${vector.name}`, () => {
    assert.deepEqual(toFeedRow(vector.row), vector.expected)
  })
}
