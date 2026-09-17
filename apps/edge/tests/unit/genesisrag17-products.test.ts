import assert from 'node:assert/strict';
import test from 'node:test';
import { zEdgePublishedCorpusContext } from '../../src/rag/genesisrag17/corpus-context.js';
import { parsePublishedProducts, createPublishedProductRag } from '../../src/rag/genesisrag17/product-rag.js';
import { createPublishedGenerationClient, wrapAnswerRag, type GenesisRag17Runtime } from '../../src/rag/genesisrag17/published-rag.js';
import { emptyFakeRag } from '../helpers/fake-rag.js';
import { quotePrice, findWithinBudget, compactSearchForModel, type EvidenceOptions } from '../../src/answer/tools.js';
import { answerWithModel } from '../../src/answer/llm.js';

// @req FR-189 — typed product evidence, no price guesses or unscoped legacy fallbacks.
// @spec ADR-075, ADR-090, SEC-001
const scope = { portfolioId: 'p', tenantId: 't', businessId: 'b', workspaceId: '', agentId: '', visibility: 'private' as const };
const context = () => ({ schemaVersion: 'edge-published-corpus.v1' as const, scope, corpusId: 'corpus', corpusGeneration: 1, manifestHash: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 60000).toISOString(), entries: [{ sourceId: 's', snapshotId: 'snap', generation: 'g', receiptHash: 'b'.repeat(64), rawArtifactId: 'raw', parsedArtifactId: 'parsed' }] });
const citation = { sourceId: 's', snapshotId: 'snap', generation: 'g', rawArtifactId: 'raw', parsedArtifactId: 'parsed', chunkId: 'chunk', contentHash: 'c'.repeat(64) };
const graph = { predicate: 'PRICED_AT', entityId: 'product', targetEntityId: 'tier', targetCode: 'PM-A:qty100:10025', factId: 'fact',
  path: [{ id: 'path', from: 'product', to: 'tier', rel: 'PRICED_AT' }], citation };
const tier = { minQty: 100, amountMinor: 10025, currency: 'THB', asOf: '2026-09-01', unit: null, validFrom: null, validUntil: null, taxBasis: null,
  shippingBasis: null, status: 'CATALOG_SNAPSHOT', source: 'approved-export', citation, graph };
function response(operation = 'price', quantity: number | null = 100) {
  const price = { code: 'PM-A', tiers: [tier], selected: quantity !== null && quantity >= 100 ? tier : null,
    status: quantity !== null && quantity < 100 ? 'BELOW_MOQ' : 'CATALOG_SNAPSHOT' };
  return { schemaVersion: 'genesisrag17.v1', productSchemaVersion: 'published-products.v1', scope, corpusId: 'corpus', corpusGeneration: 1, manifestHash: 'a'.repeat(64), operation,
    results: [{ code: 'PM-A', kind: 'PRODUCT', name: 'แก้ว', score: 0.9, citation, graph: [graph], price }],
    ...(operation === 'price' ? { price } : {}), lanes: { vectorCalls: operation === 'search' ? 1 : 0, graphCalls: 1 }, priceBasis: 'PUBLISHED_CATALOG_SNAPSHOT_NOT_LIVE_QUOTE' };
}
function runtime(fn = async (_context: unknown, request: any) => response(request.operation, request.quantity ?? null)): GenesisRag17Runtime {
  return { settings: { scope }, client: { productQuery: fn } } as unknown as GenesisRag17Runtime;
}
const options = (rag: EvidenceOptions['rag']) => ({ rag, catalog: { products: [] }, role: 'sales', exchangeRate: 5 }) as EvidenceOptions;

test('corpus context refuses additional scope, duplicate source identities and oversized refs', () => {
  assert.ok(zEdgePublishedCorpusContext.safeParse(context()).success);
  assert.equal(zEdgePublishedCorpusContext.safeParse({ ...context(), scope: { ...scope, owner: true } }).success, false);
  assert.equal(zEdgePublishedCorpusContext.safeParse({ ...context(), entries: [context().entries[0], context().entries[0]] }).success, false);
  assert.equal(zEdgePublishedCorpusContext.safeParse({ ...context(), corpusId: 'x'.repeat(257) }).success, false);
});

test('typed response validates full manifest citations, scope, exact code and deterministic tier', () => {
  const request = { operation: 'price' as const, code: 'PM-A', quantity: 100 };
  assert.equal(parsePublishedProducts(response(), context(), request).price?.selected?.amountMinor, 10025);
  for (const mutate of [
    (r: any) => { r.scope = { ...scope, tenantId: 'other' }; },
    (r: any) => { r.manifestHash = 'd'.repeat(64); },
    (r: any) => { r.price.code = 'other'; },
    (r: any) => { r.price.selected = { ...r.price.selected, amountMinor: 10026 }; },
    (r: any) => { r.price.tiers[0].citation.snapshotId = 'candidate'; },
    (r: any) => { r.price.selected = null; },
    (r: any) => { r.lanes.graphCalls = 0; },
  ]) {
    const candidate = structuredClone(response()); mutate(candidate);
    assert.throws(() => parsePublishedProducts(candidate, context(), request));
  }
});

test('published quotes carry source evidence and never create totals or RMB estimates', async () => {
  const rag = createPublishedProductRag(context(), runtime());
  const quote = await quotePrice('PM-A', 100, options(rag));
  assert.equal(quote.quotable, false);
  assert.equal(quote.catalogPrices?.[0].unitPriceThb, 100.25);
  assert.equal(quote.priceAtQuantity, undefined);
  assert.equal(quote.breaks, undefined);
  assert.equal(quote.publishedProducts?.price?.selected?.citation.chunkId, 'chunk');
  const empty = runtime(async () => ({ ...response(), results: [], price: { code: 'PM-A', tiers: [], selected: null, status: 'PRICE_MISSING' } }));
  const missing = await quotePrice('PM-A', 100, options(createPublishedProductRag(context(), empty)));
  assert.equal(missing.priceSource, 'commercial_sku');
  assert.equal(missing.found, false);
});

test('budget and recommendation tools retain typed citations and explicit unknown price conditions', async () => {
  const rag = createPublishedProductRag(context(), runtime());
  const budget = await findWithinBudget(100, 101, options(rag));
  assert.equal(budget.matches[0].unitPriceThb, 100.25);
  assert.equal(budget.publishedProducts?.priceBasis, 'PUBLISHED_CATALOG_SNAPSHOT_NOT_LIVE_QUOTE');
  const compact = compactSearchForModel(await rag.searchProducts('แก้ว')) as any;
  assert.equal(compact.matches[0].prices[0].unitPriceThb, 100.25);
  assert.equal(compact.matches[0].citation.sourceId, 's');
  assert.equal(compact.matches[0].priceLimitations.taxBasis, null);
});

test('missing runtime, scope mismatch, expiration or transport errors are unavailable without legacy retrieval', async () => {
  for (const r of [null, runtime(async () => { throw new Error('provider'); }),
    { ...runtime(), settings: { scope: { ...scope, businessId: 'other' } } } as unknown as GenesisRag17Runtime]) {
    assert.equal((await createPublishedProductRag(context(), r).priceForCode('PM-A', 100)).unavailable, true);
  }
  const expired = { ...context(), expiresAt: '2000-01-01T00:00:00Z' };
  assert.equal((await createPublishedProductRag(expired, runtime()).searchProducts('แก้ว')).unavailable, true);
});

test('published catalog final answer replaces model tax/shipping/live-price claims and computed totals with exact evidence', async () => {
  const rag = createPublishedProductRag(context(), runtime());
  const answer = await answerWithModel('ราคา PM-A จำนวน 100', [], 'sales', options(rag), {
    timeoutMs: 5000, maxIterations: 2, port: { id: 'fixture', model: 'fixture', async generate(request) {
      await request.tools.find(tool => tool.name === 'quote_price')!.run({ sku: 'PM-A', quantity: 100 } as never);
      return { text: '100.25 THB รวมภาษีและส่งฟรี ราคาใช้ได้วันนี้ ยอดชำระ 10025 THB', toolCalls: ['quote_price'] };
    } },
  }, 'legacy fallback');
  assert.equal(answer.source, 'rules');
  assert.equal(answer.reason, 'PUBLISHED_CATALOG_EVIDENCE');
  assert.match(answer.text, /100\.25 THB/);
  assert.match(answer.text, /2026-09-01/);
  assert.match(answer.text, /แก้ว \(PM-A\)/);
  assert.match(answer.text, /แหล่งข้อมูล: approved-export/);
  assert.doesNotMatch(answer.text, /corpus|generation|source "s"|chunk/);
  assert.match(answer.text, /ยังไม่ยืนยันหน่วยสินค้า ภาษี ค่าจัดส่ง และช่วงเวลาที่ราคาใช้ได้/);
  assert.match(answer.text, /ยังไม่ใช่ใบเสนอราคาหรือยอดชำระ/);
  assert.doesNotMatch(answer.text, /รวมภาษี|ส่งฟรี|ใช้ได้วันนี้|10025|legacy fallback/);
});

test('budget and recommendations use deterministic snapshot text even when model returns no text', async () => {
  for (const [toolName, input] of [['find_within_budget', { quantity: 100, maxPriceThb: 101 }], ['search_products', { query: 'แก้ว' }]] as const) {
    const rag = createPublishedProductRag(context(), runtime());
    const answer = await answerWithModel('หารายการสินค้า', [], 'sales', options(rag), {
      timeoutMs: 5000, maxIterations: 2, port: { id: 'fixture', model: 'fixture', async generate(request) {
        await request.tools.find(tool => tool.name === toolName)!.run(input as never);
        return { text: '', toolCalls: [toolName] };
      } },
    }, 'legacy fallback');
    assert.equal(answer.reason, 'PUBLISHED_CATALOG_EVIDENCE');
    assert.match(answer.text, /PM-A/);
    assert.match(answer.text, /100\.25 THB/);
    assert.match(answer.text, /snapshot/);
  }
});

test('provider errors after successful product read preserve deterministic evidence without suppressing work guards', async () => {
  for (const userText of ['ราคา PM-A', 'สถานะโครงการล่าสุด']) {
    const rag = createPublishedProductRag(context(), runtime());
    const answer = await answerWithModel(userText, [], 'sales', options(rag), {
      timeoutMs: 5000, maxIterations: 2, port: { id: 'fixture', model: 'fixture', async generate(request) {
        await request.tools.find(tool => tool.name === 'quote_price')!.run({ sku: 'PM-A', quantity: 100 } as never);
        throw new Error('synthetic provider failure');
      } },
    }, 'legacy fallback');
    if (userText.includes('โครงการ')) {
      assert.match(answer.text, /Project\/Work/);
      assert.doesNotMatch(answer.text, /100\.25/);
    } else assert.equal(answer.reason, 'PUBLISHED_CATALOG_EVIDENCE');
  }
});

test('long catalog lists remain bounded and explicitly disclose omitted items', async () => {
  const r = response('search', null);
  r.results = Array.from({ length: 5 }, (_, index) => {
    const code = String(index) + 'A'.repeat(255);
    return { ...r.results[0], code, name: 'ชื่อสินค้ายาว'.repeat(70), price: { ...r.results[0].price, code,
      tiers: [100, 200, 300].map(minQty => ({ ...tier, minQty, source: 'แหล่งข้อมูลที่ตรวจแล้ว'.repeat(20) })) } };
  });
  const answer = await answerWithModel('หาสินค้า', [], 'sales', options(createPublishedProductRag(context(), runtime(async () => r))), {
    timeoutMs: 5000, maxIterations: 2, port: { id: 'fixture', model: 'fixture', async generate(request) {
      await request.tools.find(tool => tool.name === 'search_products')!.run({ query: 'สินค้า' } as never);
      return { text: 'ignored model prose' };
    } },
  }, 'legacy fallback');
  assert.equal(answer.reason, 'PUBLISHED_CATALOG_EVIDENCE');
  assert.match(answer.text, /มีรายการเพิ่มเติม/);
  assert.ok(answer.text.length < 4500);
  assert.match(answer.text, /100\.25 THB/);
});

test('published product wrapper forwards each turn signal through its client and does not swallow cancellation', { timeout: 5000 }, async () => {
 const first = new AbortController(), next = new AbortController();
 const signals: (AbortSignal | undefined)[] = [];
 const client = createPublishedGenerationClient({ credential: 'test', scope, call: async (name, input, signal) => {
  assert.equal(name, 'msp_pipeline_product_query'); signals.push(signal);
  if (signal === first.signal) return new Promise((_resolve, reject) => {
   signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  return response(String(input.operation), Number(input.quantity) || null);
 } });
 const shared = { settings: { scope }, client } as unknown as GenesisRag17Runtime;
 const expiredRag = wrapAnswerRag(emptyFakeRag(), shared, context(), first.signal);
 const pending = assert.rejects(expiredRag.searchProducts('แก้ว'), /expired turn/);
 first.abort(new Error('expired turn'));
 await pending;
 await assert.rejects(expiredRag.priceForCode('PM-A', 100), /expired turn/);
 const nextRag = wrapAnswerRag(emptyFakeRag(), shared, context(), next.signal);
 assert.equal((await nextRag.priceForCode('PM-A', 100)).publishedProducts?.price?.selected?.amountMinor, 10025);
 assert.deepEqual(signals, [first.signal, next.signal]);
});
