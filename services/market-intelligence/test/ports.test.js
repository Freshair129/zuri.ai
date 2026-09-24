import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as market from '../src/index.js'

test('the public surface exposes the core and the port contracts', () => {
  for (const name of [
    'translateRawRecordToMarketObservation',
    'buildMarketObservationLineageKey',
    'extractGenericMarketCandidate',
    'createKnowledgeIdentityResolver',
    'getMarketObservationFeed',
    'runMarketTranslationForBusiness',
    'authorizeScope',
    'MarketRefusal',
  ]) {
    assert.equal(typeof market[name], 'function', name)
  }
  assert.deepEqual(market.MARKET_ACTIONS, { FEED_READ: 'market.feed.read', TRANSLATION_RUN: 'market.translation.run' })
})

test('authorizeScope only accepts well-formed allow or 403/404 refusals', async () => {
  const run = (decision) => market.authorizeScope({ authorize: async () => decision }, { actor: {}, businessId: 'b', action: 'market.feed.read' })
  assert.deepEqual(await run({ allowed: true, scope: { tenantId: 't', businessId: 'b' } }), { tenantId: 't', businessId: 'b' })
  await assert.rejects(run({ allowed: false, status: 404, message: 'Business not found' }), market.MarketRefusal)
  await assert.rejects(run({ allowed: false, status: 500, message: 'x' }), /invalid decision/)
  await assert.rejects(run({ allowed: true, scope: { businessId: 'b' } }), /does not match/)
  await assert.rejects(run(undefined), /invalid decision/)
})

test('port shape checks name the missing method', () => {
  assert.throws(() => market.assertScopeAuthorityPort({}), /ScopeAuthorityPort.authorize/)
  assert.throws(() => market.assertRawEvidenceReadPort({}), /RawEvidenceReadPort.listMarketCandidates/)
  assert.throws(() => market.assertAuditPort(null), /AuditPort.record/)
  assert.throws(() => market.assertObservationStore({}, ['listRecent']), /ObservationStore.listRecent/)
})
