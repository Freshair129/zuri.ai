import { z } from 'zod';
import type { AnswerRag, PriceEvidenceV4 } from '../genesis-rag.js';
import type { SearchEvidenceV4 } from '../../answer/format-cards.js';
import { zEdgePublishedCorpusContext, type EdgePublishedCorpusContext } from './corpus-context.js';
import type { GenesisRag17Runtime } from './published-rag.js';

// @req FR-189 — scoped published product tools use a single authorized corpus, typed prices and native graph evidence.
// @spec ADR-075, ADR-090, SEC-001
// @tested tests/unit/genesisrag17-products.test.ts
const id = z.string().min(1).max(256);
const citation = z.object({ sourceId: id, rawArtifactId: id, parsedArtifactId: id, chunkId: id,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), snapshotId: id, generation: id }).strict();
const graph = z.object({ predicate: z.enum(['PRICED_AT', 'HAS_COMPONENT', 'IN_CATEGORY']), entityId: id, targetEntityId: id,
  targetCode: id, factId: id, path: z.array(z.object({ id, from: id, to: id, rel: z.enum(['PRICED_AT', 'HAS_COMPONENT', 'IN_CATEGORY']) }).strict()).length(1), citation }).strict();
const tier = z.object({ minQty: z.number().int().positive().safe(), amountMinor: z.number().int().nonnegative().safe(), currency: z.literal('THB'),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), unit: z.null(), validFrom: z.null(), validUntil: z.null(), taxBasis: z.null(), shippingBasis: z.null(),
  status: z.literal('CATALOG_SNAPSHOT'), source: z.string().max(1000).nullable(), citation, graph }).strict();
const price = z.object({ code: id, tiers: z.array(tier).max(128), selected: tier.nullable(), status: z.enum(['PRICE_MISSING', 'BELOW_MOQ', 'CATALOG_SNAPSHOT']) }).strict();
const resultSchema = z.object({ schemaVersion: z.literal('genesisrag17.v1'), productSchemaVersion: z.literal('published-products.v1'),
  scope: zEdgePublishedCorpusContext.innerType().shape.scope, corpusId: id, corpusGeneration: z.number().int().nonnegative().safe(),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/), operation: z.enum(['search', 'price', 'budget']),
  results: z.array(z.object({ code: id, kind: z.enum(['PRODUCT', 'PACKAGE']), name: z.string().max(1000), score: z.number().finite(), citation,
    graph: z.array(graph).max(128), price }).strict()).max(20), price: price.optional(),
  lanes: z.object({ vectorCalls: z.number().int().nonnegative(), graphCalls: z.number().int().nonnegative() }).strict(),
  priceBasis: z.literal('PUBLISHED_CATALOG_SNAPSHOT_NOT_LIVE_QUOTE'),
}).strict();
export type PublishedProductQueryResult = z.infer<typeof resultSchema>;
export type PublishedProductPrice = z.infer<typeof price>;
export type PublishedProductRequest = { operation: 'search' | 'price' | 'budget'; query?: string; code?: string; quantity?: number | null; maxPriceThb?: number; topK?: number };

export function parsePublishedProducts(value: unknown, context: EdgePublishedCorpusContext, request: PublishedProductRequest): PublishedProductQueryResult {
  const result = resultSchema.parse(value);
  const fail = () => { throw new Error('PUBLISHED_PRODUCT_INTEGRITY'); };
  if (result.corpusId !== context.corpusId || result.corpusGeneration !== context.corpusGeneration || result.manifestHash !== context.manifestHash ||
      result.operation !== request.operation || result.results.length > (request.topK ?? 5) ||
      Object.keys(context.scope).some((key) => result.scope[key as keyof typeof result.scope] !== context.scope[key as keyof typeof context.scope])) fail();
  const sources = new Map(context.entries.map((e) => [e.sourceId, e]));
  const checkCitation = (c: z.infer<typeof citation>) => {
    const entry = sources.get(c.sourceId);
    if (!entry || ['snapshotId', 'generation', 'rawArtifactId', 'parsedArtifactId'].some((k) => c[k as keyof typeof c] !== entry[k as keyof typeof entry])) fail();
  };
  const checkGraph = (g: z.infer<typeof graph>) => { checkCitation(g.citation); if (g.path[0].rel !== g.predicate) fail(); };
  const checkPrice = (p: PublishedProductPrice) => {
    const seen = new Set<number>();
    for (const t of p.tiers) {
      if (seen.has(t.minQty)) fail(); seen.add(t.minQty);
      checkCitation(t.citation); checkGraph(t.graph);
      if (t.graph.predicate !== 'PRICED_AT') fail();
    }
    const eligible = p.tiers.filter((t) => request.quantity && t.minQty <= request.quantity).sort((a, b) => a.minQty - b.minQty);
    if (JSON.stringify(p.selected) !== JSON.stringify(eligible.at(-1) ?? null)) fail();
    const status = !p.tiers.length ? 'PRICE_MISSING' : request.quantity && !eligible.length ? 'BELOW_MOQ' : 'CATALOG_SNAPSHOT';
    if (p.status !== status) fail();
  };
  const codes = new Set();
  for (const p of result.results) {
    if (codes.has(p.code) || p.price.code !== p.code) fail(); codes.add(p.code);
    checkCitation(p.citation); p.graph.forEach(checkGraph); checkPrice(p.price);
    if (request.operation === 'budget' && (!p.price.selected || p.price.selected.amountMinor > Math.floor((request.maxPriceThb ?? -1) * 100))) fail();
  }
  if (request.operation === 'price') {
    if (!result.price || result.price.code !== request.code) fail();
    checkPrice(result.price!);
  }
  if (request.operation === 'search' && context.entries.length && result.lanes.vectorCalls < 1) fail();
  if ((result.results.length || result.price?.tiers.length) && result.lanes.graphCalls < 1) fail();
  return result;
}

export function createPublishedProductRag(rawContext: EdgePublishedCorpusContext, runtime: GenesisRag17Runtime | null, signal?: AbortSignal): AnswerRag {
  const context = zEdgePublishedCorpusContext.parse(rawContext);
  const unavailableSearch = (query: string): SearchEvidenceV4 => ({ query, parsed: null, matchCount: 0, matches: [], nearest: [],
    priceSource: 'commercial_sku', unavailable: true, reason: 'PUBLISHED_PRODUCT_UNAVAILABLE' });
  const query = async (request: PublishedProductRequest) => {
    signal?.throwIfAborted();
    if (!runtime?.client.productQuery || Date.parse(context.expiresAt) <= Date.now() ||
        Object.keys(context.scope).some((k) => context.scope[k as keyof typeof context.scope] !== runtime.settings.scope[k as keyof typeof context.scope])) throw new Error('PUBLISHED_PRODUCT_UNAVAILABLE');
    const result = await runtime.client.productQuery(context, request, signal);
    signal?.throwIfAborted();
    return parsePublishedProducts(result, context, request);
  };
  const search = async (request: PublishedProductRequest): Promise<SearchEvidenceV4> => {
    try {
      const products = await query(request);
      return { query: request.query ?? '', parsed: null, matchCount: products.results.length, matches: [], nearest: [], priceSource: 'commercial_sku', publishedProducts: products };
    } catch { signal?.throwIfAborted(); return unavailableSearch(request.query ?? ''); }
  };
  return {
    searchProducts: (text, limit = 5) => search({ operation: 'search', query: text, topK: Math.max(1, Math.min(20, limit)) }),
    searchWithConstraints: (params) => search({ operation: 'budget', quantity: params.qty, maxPriceThb: params.budgetPerUnit ?? undefined, topK: Math.max(1, Math.min(20, params.limit ?? 5)) }),
    async priceForCode(code, quantity): Promise<PriceEvidenceV4> {
      try {
        const products = await query({ operation: 'price', code, quantity });
        return { found: Boolean(products.price?.tiers.length), code, priceLadder: [], selectedPrice: null, exportDate: products.price?.selected?.asOf ?? null,
          priceSource: products.price?.tiers.length ? 'commercial_sku' : 'none', publishedProducts: products };
      } catch { signal?.throwIfAborted(); return { found: false, code, priceLadder: [], selectedPrice: null, exportDate: null, priceSource: 'none', unavailable: true, reason: 'PUBLISHED_PRODUCT_UNAVAILABLE' }; }
    },
    async health() { return { ok: Boolean(runtime?.client.productQuery) && Date.parse(context.expiresAt) > Date.now() }; },
  };
}
