import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GenesisLocalRag } from '../../src/rag/genesis-rag.js';

// ADR-119: the canonical catalog manifest and graph-batch tests were removed with their code.

describe('Business-scoped Genesis reads', () => {
  it('fails closed without Business scope and never calls the unscoped SmartGift service', async () => {
    let calls = 0;
    const rag = new GenesisLocalRag({ allowUnscopedReads: false, fetchImpl: (async () => {
      calls += 1;
      throw new Error('unexpected unscoped read');
    }) as unknown as typeof fetch });

    const search = await rag.searchProducts('Business two product lookup');
    const budget = await rag.searchWithConstraints({ query: 'Business two product lookup', qty: 10 });
    const price = await rag.priceForCode('BUSINESS-TWO', 10);

    assert.equal(search.unavailable, true);
    assert.equal(search.reason, 'BUSINESS_SCOPE_REQUIRED');
    assert.deepEqual(search.matches, []);
    assert.equal(budget.unavailable, true);
    assert.equal(price.unavailable, true);
    assert.equal((await rag.health()).ok, false);
    assert.doesNotMatch(JSON.stringify({ search, budget, price }), /SMARTGIFT_PRIVATE_SENTINEL/);
    assert.equal(calls, 0);
  });
});
