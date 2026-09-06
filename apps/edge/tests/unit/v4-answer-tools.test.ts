import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { Catalog, CatalogProduct } from '../../src/catalog/store.js';
import { EvidenceOptions, compactSearchForModel, findWithinBudget, quotePrice, searchProducts } from '../../src/answer/tools.js';
import { GenesisLocalRag } from '../../src/rag/genesis-rag.js';
import { RagUnavailableError } from '../../src/rag/v4/http-client.js';
import { call } from '../../src/mcp/pricing-server.js';
import { fakeRag, stubResult } from '../helpers/fake-rag.js';

// @tested RAG-FR-004 — the retrieval door has no write path and no substring fallback.
// @tested RAG-FR-005 — results carry priceSource and provenance.
// @tested RAG-NFR-002 — an unreachable, slow or failing service reports unavailable instead of an unprovenanced answer.
// @tested RAG-SEC-001 — the door exposes typed calls only; there is no arbitrary query path to reach.

function catalogOf(products: Omit<CatalogProduct, 'book'>[]): Catalog {
  const withBook = products.map((p) => ({ ...p, book: 'test' }));
  return { products: withBook, byCode: new Map(withBook.map((p) => [p.code.toUpperCase(), p])) };
}

const FAN: Omit<CatalogProduct, 'book'> = {
  code: 'TJS23-2',
  name: 'Turbo Handheld Fan + Umbrella',
  rmb: 32,
  upc: 20,
  dims: [47.5, 45.5, 51],
  kg: null,
  e: true,
};

const catalog = catalogOf([FAN]);
const baseOptions = { catalog, role: 'sales' as const, exchangeRate: 5, shipMonth: 11 };

describe('v4 answer tools: searchProducts', () => {
  it('returns matches with variants/priceLadder/selectedPrice/components/customizations from a fake fetch', async () => {
    const rag = fakeRag({
      search: () => ({
        results: [
          stubResult({
            id: 'MODEL_1',
            code: 'TBY01',
            name: 'เครื่องนวดคอ',
            variants: [{ skuId: 'SKU_1', displayCode: 'SKU-1', color: 'ขาว', size: null, material: null }],
            priceLadder: [
              { qtyTier: 100, unitPrice: 490, commercialSku: 'TBY01(P-14)-100', priceMissing: false, exportDate: '2026-06-21', offerCode: 'TBY01' },
            ],
            selectedPrice: { qtyTier: 100, unitPrice: 490, belowMoq: false, source: 'offer' },
            components: [{ modelId: 'MODEL_1', name: 'ตัวเครื่อง', typeId: 'neck_massager', qty: 1 }],
            customizations: [{ id: 'CUSTOM_logo', name_th: 'สกรีนโลโก้' }],
          }),
        ],
      }),
    });

    const evidence = await searchProducts('เครื่องนวดคอ', { ...baseOptions, rag });
    assert.equal(evidence.matchCount, 1);
    const [match] = evidence.matches;
    assert.deepEqual(match.variants, [{ skuId: 'SKU_1', displayCode: 'SKU-1', color: 'ขาว', size: null, material: null }]);
    assert.equal(match.priceLadder[0].unitPrice, 490);
    assert.equal(match.selectedPrice?.unitPrice, 490);
    assert.equal(match.components[0].typeId, 'neck_massager');
    assert.equal(match.customizations[0].id, 'CUSTOM_logo');
    assert.equal(evidence.priceSource, 'commercial_sku');
  });

  it('never falls back to a substring search: an unreachable service returns unavailable, not []', async () => {
    const rag = fakeRag({ down: true });
    const evidence = await searchProducts('แก้ว', { ...baseOptions, rag });
    assert.equal(evidence.unavailable, true);
    assert.ok(evidence.reason);
    assert.deepEqual(evidence.matches, []);
  });

  it('a 500 from the service is reported as unavailable, not an empty result', async () => {
    const rag = new GenesisLocalRag({
      fetchImpl: (async () => new Response('', { status: 500 })) as typeof fetch,
    });
    const evidence = await searchProducts('แก้ว', { ...baseOptions, rag });
    assert.equal(evidence.unavailable, true);
    assert.deepEqual(evidence.matches, []);
  });

  it('a timeout is reported as unavailable, not an empty result', async () => {
    const rag = new GenesisLocalRag({
      timeoutMs: 20,
      fetchImpl: ((_u: string, i: RequestInit) =>
        new Promise((_resolve, reject) => {
          i.signal!.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })) as unknown as typeof fetch,
    });
    const evidence = await searchProducts('แก้ว', { ...baseOptions, rag });
    assert.equal(evidence.unavailable, true);
    assert.deepEqual(evidence.matches, []);
  });
});

describe('v4 answer tools: quotePrice', () => {
  it("quotePrice('TBY01', 100) uses the graph ladder and reports commercial_sku", async () => {
    const rag = fakeRag({
      price: () => ({
        found: true,
        code: 'TBY01',
        priceLadder: [
          { qtyTier: 10, unitPrice: 690, commercialSku: 'TBY01(P-14)-10', priceMissing: false, exportDate: '2026-06-21', offerCode: 'TBY01' },
          { qtyTier: 100, unitPrice: 490, commercialSku: 'TBY01(P-14)-100', priceMissing: false, exportDate: '2026-06-21', offerCode: 'TBY01' },
        ],
        selectedPrice: { qtyTier: 100, unitPrice: 490, belowMoq: false, source: 'offer' },
        exportDate: '2026-06-21',
      }),
    });

    const evidence = await quotePrice('TBY01', 100, { ...baseOptions, rag });
    assert.equal(evidence.priceSource, 'commercial_sku');
    assert.equal(evidence.priceAtQuantity?.unitPriceThb, 490);
  });

  it('an unknown code falls through to the rmb catalog path with priceSource estimate_rmb', async () => {
    const rag = fakeRag(); // priceForCode default: not found, not unavailable
    const evidence = await quotePrice('TJS23-2', 500, { ...baseOptions, rag });
    assert.equal(evidence.priceSource, 'estimate_rmb');
    assert.equal(evidence.found, true);
  });

  it('an unavailable price service reports found:false with a Thai message, never a fabricated price', async () => {
    const rag = fakeRag({ down: true });
    const evidence = await quotePrice('TBY01', 100, { ...baseOptions, rag });
    assert.equal(evidence.found, false);
    assert.equal((evidence as { unavailable?: true }).unavailable, true);
    assert.equal(evidence.message, 'ระบบราคาขัดข้องชั่วคราว');
  });
});

describe('v4 answer tools: findWithinBudget', () => {
  it('never fabricates query text: calls searchWithConstraints with an empty query', async () => {
    let seenBody: Record<string, unknown> | null = null;
    const rag = fakeRag({
      search: (body) => {
        seenBody = body;
        return {
          results: [
            stubResult({ id: 'm1', code: 'A1', name: 'Cheap', selectedPrice: { qtyTier: 100, unitPrice: 100, belowMoq: false, source: 'offer' } }),
            stubResult({ id: 'm2', code: 'A2', name: 'Pricey', selectedPrice: { qtyTier: 100, unitPrice: 900, belowMoq: false, source: 'offer' } }),
          ],
        };
      },
    });

    const evidence = await findWithinBudget(100, 1000, { ...baseOptions, rag });
    assert.equal(seenBody?.query, '');
    assert.equal(seenBody?.qty, 100);
    assert.equal(seenBody?.budgetPerUnit, 1000);
    assert.equal(evidence.priceSource, 'commercial_sku');

    const prices = evidence.matches.map((m) => m.unitPriceThb);
    assert.deepEqual(prices, [...prices].sort((a, b) => b - a));
  });

  it('an unreachable service reports zero matches with a message, never a silent []', async () => {
    const rag = fakeRag({ down: true });
    const evidence = await findWithinBudget(100, 1000, { ...baseOptions, rag });
    assert.equal(evidence.matchCount, 0);
    assert.ok(evidence.message);
  });

  it('always sends browseAll: true (gate defect 3)', async () => {
    let seenBody: Record<string, unknown> | null = null;
    const rag = fakeRag({ search: (body) => { seenBody = body; return { results: [] }; } });
    await findWithinBudget(100, 1000, { ...baseOptions, rag });
    assert.equal(seenBody?.browseAll, true);
  });

  it('sends limit in the request body and can return up to limit matches from more candidates (gate defect 1)', async () => {
    let seenBody: Record<string, unknown> | null = null;
    const rag = fakeRag({
      search: (body) => {
        seenBody = body;
        const results = Array.from({ length: 12 }, (_, i) =>
          stubResult({
            id: `m${i}`,
            code: `A${i}`,
            name: `Item ${i}`,
            selectedPrice: { qtyTier: 100, unitPrice: 100 + i, belowMoq: false, source: 'offer' },
          }));
        return { results };
      },
    });

    const evidence = await findWithinBudget(100, 1000, { ...baseOptions, rag });
    assert.equal(seenBody?.limit, 10);
    assert.equal(evidence.matches.length, 10);
  });

  it('budgetUnmet: matches empty, nearest from ev.nearest, and the near-miss Thai message (gate defect 2)', async () => {
    const rag = fakeRag({
      search: () => ({
        parsed: { cleanText: '', excludeTypes: [], qty: 100, budgetPerUnit: 50, budgetTotal: null, budgetUnmet: true },
        results: [],
        nearest: [
          stubResult({ id: 'n1', code: 'N1', name: 'Near 1', selectedPrice: { qtyTier: 100, unitPrice: 60, belowMoq: false, source: 'offer' } }),
          stubResult({ id: 'n2', code: 'N2', name: 'Near 2', selectedPrice: { qtyTier: 100, unitPrice: 70, belowMoq: false, source: 'offer' } }),
        ],
      }),
    });

    const evidence = await findWithinBudget(100, 50, { ...baseOptions, rag });
    assert.equal(evidence.budgetUnmet, true);
    assert.deepEqual(evidence.matches, []);
    assert.equal(evidence.matchCount, 0);
    assert.deepEqual(evidence.nearest, [
      { sku: 'N1', name: 'Near 1', unitPriceThb: 60 },
      { sku: 'N2', name: 'Near 2', unitPriceThb: 70 },
    ]);
    assert.equal(evidence.message, 'ไม่มีสินค้าในงบนี้ แต่มีสินค้าใกล้เคียง');
  });

  it('not unmet and no matches: keeps the original message, nearest stays empty', async () => {
    const rag = fakeRag({ search: () => ({ results: [] }) });
    const evidence = await findWithinBudget(100, 50, { ...baseOptions, rag });
    assert.equal(evidence.budgetUnmet, false);
    assert.deepEqual(evidence.nearest, []);
    assert.equal(evidence.message, 'ไม่มีสินค้าที่เข้างบนี้');
  });
});

describe('http-client contract used by the rag client', () => {
  it('re-exports RagUnavailableError semantics unchanged', () => {
    const err = new RagUnavailableError('econnrefused');
    assert.equal(err.reason, 'econnrefused');
  });
});

describe('GenesisLocalRag construction', () => {
  it('constructing the client performs no filesystem or native-store access', (t) => {
    // The old class opened a store synchronously in its constructor path (via init()). The new
    // client is HTTP-only: constructing it must not throw, block, or touch the filesystem — spy on
    // `fs` so a regression that reads a store path back in would actually fail this test.
    const readFileSyncSpy = t.mock.method(fs, 'readFileSync');
    const existsSyncSpy = t.mock.method(fs, 'existsSync');
    const readdirSyncSpy = t.mock.method(fs, 'readdirSync');

    assert.doesNotThrow(() => new GenesisLocalRag({ apiUrl: 'http://127.0.0.1:1' }));

    assert.equal(readFileSyncSpy.mock.callCount(), 0);
    assert.equal(existsSyncSpy.mock.callCount(), 0);
    assert.equal(readdirSyncSpy.mock.callCount(), 0);
  });
});

describe('GenesisLocalRag.health() (gate defect 9)', () => {
  it('reads the real service health shape from the body', async () => {
    const rag = new GenesisLocalRag({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ ok: true, dbReady: true, embedReady: true, storePath: '/store/RUN1', runId: 'RUN1', currentRunId: 'RUN1', staleRun: false }),
          { status: 200 },
        )) as typeof fetch,
    });
    const h = await rag.health();
    assert.deepEqual(h, { ok: true, dbReady: true, embedReady: true, runId: 'RUN1', staleRun: false });
  });

  it('surfaces staleRun: true from the body', async () => {
    const rag = new GenesisLocalRag({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ ok: false, dbReady: true, embedReady: true, storePath: '/store/RUN1', runId: 'RUN1', currentRunId: 'RUN2', staleRun: true }),
          { status: 200 },
        )) as typeof fetch,
    });
    const h = await rag.health();
    assert.equal(h.ok, false);
    assert.equal(h.staleRun, true);
    assert.equal(h.runId, 'RUN1');
  });

  it('ok:false on any error (network down), never a thrown exception', async () => {
    const rag = new GenesisLocalRag({ fetchImpl: (async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); }) as unknown as typeof fetch });
    const h = await rag.health();
    assert.deepEqual(h, { ok: false });
  });

  it('the shared fake-rag helper answers /health with the real shape', async () => {
    const rag = fakeRag();
    const h = await rag.health();
    assert.equal(h.ok, true);
    assert.equal(typeof h.dbReady, 'boolean');
    assert.equal(typeof h.embedReady, 'boolean');
    assert.equal(h.staleRun, false);
  });
});

describe('MCP pricing-server call()', () => {
  it("call('search_products') awaits and returns the same shape as searchProducts", async () => {
    const rag = fakeRag({
      search: () => ({
        results: [
          stubResult({
            id: 'MODEL_1',
            code: 'TBY01',
            name: 'เครื่องนวดคอ',
            selectedPrice: { qtyTier: 100, unitPrice: 490, belowMoq: false, source: 'offer' },
          }),
        ],
      }),
    });
    const options: EvidenceOptions = { ...baseOptions, rag };

    const direct = await searchProducts('เครื่องนวดคอ', options);
    const viaCall = await call('search_products', { query: 'เครื่องนวดคอ' }, options);

    assert.deepEqual(viaCall, direct);
  });
});

describe('what the model is shown, versus what the system keeps', () => {
  /**
   * The full evidence is the right shape for the Flex cards and for the number check, and the
   * wrong shape for a prompt. Four fifths of it is sourceRef hashes, internal ids and image paths
   * — none of which can appear in a sentence to a customer. On a 4,096-token context that is not
   * merely wasteful: two search rounds of it filled the window, the model was left with single
   * digit tokens to answer in, and the turn came back `finish_reason: "length"` with no text.
   */
  const evidence = {
    query: 'กระบอกน้ำ',
    parsed: { budgetUnmet: false } as never,
    matchCount: 1,
    priceSource: 'commercial_sku' as const,
    nearest: [],
    matches: [
      stubResult({
        id: 'OFFER_TBS02-2',
        code: 'TBS02-2',
        name: 'Crystal กระบอกน้ำแก้ว พร้อม สมุดโน้ต',
        englishName: 'Crystal glass bottle + notebook',
        type: { id: 'drinkware', name_th: 'แก้วน้ำ' },
        image: '/assets/products/catalog-2026/tbs02-2.webp',
        sourceRef: { file: 'identity-review.json', sha256: 'a'.repeat(64), rowKey: 'OFFER_TBS02-2' } as never,
        variants: [
          { skuId: 'SKU_985b15988b65a0bbfbee', displayCode: 'SKU-NOTEBOOK-BLK-MC-12', color: 'Black', size: null, material: null },
          { skuId: 'SKU_835403a2d019474316a9', displayCode: 'SKU-DRINKWARE-BLK-MC', color: 'Black', size: null, material: null },
        ],
        priceLadder: [
          { qtyTier: 10, unitPrice: 790, commercialSku: 'TBS02-2-10', priceMissing: false, exportDate: '2026-06-21', offerCode: 'TBS02-2' },
          { qtyTier: 100, unitPrice: 630, commercialSku: 'TBS02-2-100', priceMissing: false, exportDate: '2026-06-21', offerCode: 'TBS02-2' },
          { qtyTier: 500, unitPrice: 0, commercialSku: null, priceMissing: true, exportDate: null, offerCode: 'TBS02-2' },
        ],
        selectedPrice: { qtyTier: 100, unitPrice: 630, belowMoq: false, source: 'offer' },
        components: [
          { modelId: 'PRODUCT_F76032113B5DAAD40843', name: 'Notebook', typeId: 'notebook', qty: 1 },
          { modelId: 'PRODUCT_52CFD2DE66610BA43F7F', name: 'Crystal Bottle', typeId: 'drinkware', qty: 1 },
        ],
      }),
    ],
  };

  it('keeps everything a sentence to a customer could need', () => {
    const compact = compactSearchForModel(evidence as never) as any;
    const m = compact.matches[0];
    assert.equal(m.code, 'TBS02-2');
    assert.equal(m.name, 'Crystal กระบอกน้ำแก้ว พร้อม สมุดโน้ต');
    assert.equal(m.type, 'แก้วน้ำ');
    assert.equal(m.unitPrice, 630);
    assert.equal(m.qtyTier, 100);
    assert.deepEqual(m.components, ['Notebook', 'Crystal Bottle']);
    assert.deepEqual(m.colors, ['Black'], 'deduplicated across variants');
  });

  it('drops the identifiers and paths that cannot appear in an answer', () => {
    const text = JSON.stringify(compactSearchForModel(evidence as never));
    for (const noise of ['sourceRef', 'sha256', 'skuId', 'displayCode', 'modelId', '.webp', 'OFFER_TBS02-2']) {
      assert.ok(!text.includes(noise), `${noise} must not reach the prompt`);
    }
  });

  it('is materially smaller than what it replaces — the whole point', () => {
    const before = JSON.stringify(evidence).length;
    const after = JSON.stringify(compactSearchForModel(evidence as never)).length;
    assert.ok(after * 2 < before, `expected a big cut, got ${before} -> ${after}`);
  });

  it('omits a price tier the catalog does not actually have', () => {
    const compact = compactSearchForModel(evidence as never) as any;
    const tiers = compact.matches[0].priceLadder.map((t: any) => t.qty);
    assert.deepEqual(tiers, [10, 100], 'the priceMissing tier is not a price');
  });

  it('passes an unavailable catalog through as unavailable, not as an empty result', () => {
    const compact = compactSearchForModel({ unavailable: true, reason: 'rag down' } as never) as any;
    assert.equal(compact.unavailable, true);
    assert.equal(compact.reason, 'rag down');
    assert.ok(!('matches' in compact), 'no empty matches list to read as "nothing exists"');
  });
});
