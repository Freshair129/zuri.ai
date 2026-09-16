import { offerNodeId } from './schema.js';
import type { EmbedClient } from './embed-client.js';
import { RagUnavailableError } from './http-client.js';
import { parseQuery, type ParsedQuery } from './query-parser.js';
import { ladderFromCsku, selectTier } from './price.js';

export { selectTier } from './price.js';

export interface GraphDb {
  hybridSearch(a: { queryVector: number[]; k: number; alpha?: number; collection?: string }): Promise<Array<{ node: { id: string; labels: string[]; props: any }; score?: number }>>;
  neighbors(seed: string, a: { rels?: string[]; rel?: string; direction?: 'out' | 'in' | 'both'; depth?: number; limit?: number }): Promise<Array<{ node: { id: string; labels: string[]; props: any }; path: Array<{ rel: string; from: string; to: string; props: any }> }>>;
}

export interface PriceTier { qtyTier: number | null; unitPrice: number; commercialSku: string | null; priceMissing: boolean; exportDate: string | null; offerCode: string | null }
export interface SelectedPrice { qtyTier: number | null; unitPrice: number; belowMoq: boolean; source: 'offer' | 'via_offer' }

export interface ResultV4 {
  kind: 'model' | 'offer'; id: string; code: string | null; name: string; englishName: string | null;
  type: { id: string; name_th: string } | null; group: { id: string } | null; score: number; status: string; image: string | null;
  variants: Array<{ skuId: string; displayCode: string; color: string | null; size: string | null; material: string | null }>;
  priceLadder: PriceTier[]; selectedPrice: SelectedPrice | null;
  components: Array<{ modelId: string; name: string; typeId: string | null; qty: number }>;
  customizations: Array<{ id: string; name_th: string }>; sourceRef: unknown;
}

export interface SearchResponseV4 {
  success: true; query: string; parsed: ParsedQuery & { budgetUnmet: boolean };
  results: ResultV4[]; nearest: ResultV4[]; timing: { embedMs: number; searchMs: number; expandMs: number; k: number };
}

export interface SearchDeps { db: GraphDb; embed: EmbedClient; aliases: Map<string, string>; typeNames: Map<string, string>; typeGroups: Map<string, string> }

const RESULT_LABELS = new Set(['ProductModel', 'CatalogOffer']);
const LABEL_FILTER_TO_NODE_LABEL: Record<'model' | 'offer', string> = { model: 'ProductModel', offer: 'CatalogOffer' };

type Hit = { node: { id: string; labels: string[]; props: any }; score?: number };

export function cosineFromEngineScore(s: number): number {
  const d = 1 - s;
  return 1 - (d * d) / 2;
}

async function safeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RagUnavailableError) throw err;
    throw new RagUnavailableError('engine', err instanceof Error ? err.message : String(err));
  }
}

function filterByLabel(hits: Hit[], labelFilter: Array<'model' | 'offer'> | undefined): Hit[] {
  if (!labelFilter || !labelFilter.length) return hits;
  const allowed = new Set(labelFilter.map((l) => LABEL_FILTER_TO_NODE_LABEL[l]));
  return hits.filter((h) => h.node.labels.some((l) => allowed.has(l)));
}

function filterHits(hits: Hit[], exclude: string[]): Hit[] {
  return hits.filter((h) => {
    if (!h.node.labels.some((l) => RESULT_LABELS.has(l))) return false;
    if (!exclude.length) return true;
    const typeId = h.node.props?.typeId as string | null | undefined;
    if (typeId && exclude.includes(typeId)) return false;
    const componentTypeIds: string[] = h.node.props?.componentTypeIds ?? [];
    if (componentTypeIds.some((t) => exclude.includes(t))) return false;
    return true;
  });
}

function dedupe(hits: Hit[]): Hit[] {
  const seen = new Map<string, Hit>();
  for (const h of hits) if (!seen.has(h.node.id)) seen.set(h.node.id, h);
  return [...seen.values()];
}

function typeAndGroup(deps: SearchDeps, typeId: string | null): { type: ResultV4['type']; group: ResultV4['group'] } {
  if (!typeId) return { type: null, group: null };
  const name_th = deps.typeNames.get(typeId);
  const groupId = deps.typeGroups.get(typeId);
  return {
    type: name_th ? { id: typeId, name_th } : null,
    group: groupId ? { id: groupId } : null,
  };
}

/** Phase 1 requires every result-eligible node to already carry a denormalized `priceTiers`
 * array (build-graph.ts §Wave-4 A.1). A node lacking that prop entirely (not merely empty) means
 * the store predates that ingest — there is no safe partial answer, so this is a hard failure
 * rather than a silent fallback to the old (slow) traversal. */
function requirePriceTiers(node: Hit['node']): PriceTier[] {
  const tiers = (node.props as { priceTiers?: PriceTier[] } | undefined)?.priceTiers;
  if (tiers === undefined) throw new RagUnavailableError('store_schema_outdated');
  return tiers;
}

/** Phase 1 (props only, no neighbors calls): build a full-shaped `ResultV4` from the hit's own
 * node props — variants/components/customizations start empty and are filled in later, in Phase 2,
 * for only the final sliced results (+ nearest). See §5.7 / Wave-4 A.2. */
function buildLiteModelResult(deps: SearchDeps, hit: Hit, qty: number | null): ResultV4 {
  const node = hit.node;
  const props = node.props as {
    displayName?: string; englishName?: string | null; typeId?: string | null; status?: string;
    sourceRef?: unknown; priceSource?: 'offer' | 'via_offer' | null;
  };
  const priceLadder = requirePriceTiers(node);
  const source: 'offer' | 'via_offer' = props.priceSource === 'offer' ? 'offer' : 'via_offer';

  let selectedPrice: SelectedPrice | null = priceLadder.length ? selectTier(priceLadder, qty) : null;
  if (selectedPrice) selectedPrice = { ...selectedPrice, source };

  // Orderable code for a Model card: the offer whose tier was selected (or the first priced offer).
  const selectedTier = selectedPrice
    ? priceLadder.find((t) => t.qtyTier === selectedPrice!.qtyTier && t.unitPrice === selectedPrice!.unitPrice)
    : undefined;
  const code = selectedTier?.offerCode ?? priceLadder.find((t) => t.offerCode)?.offerCode ?? null;

  const typeId = (props.typeId as string | null) ?? null;
  const { type, group } = typeAndGroup(deps, typeId);

  return {
    kind: 'model', id: node.id, code,
    name: String(props.displayName ?? ''), englishName: (props.englishName as string | null) ?? null,
    type, group, score: cosineFromEngineScore(hit.score ?? 0), status: String(props.status ?? ''), image: null,
    variants: [], priceLadder, selectedPrice,
    components: [], customizations: [], sourceRef: props.sourceRef ?? null,
  };
}

function buildLiteOfferResult(deps: SearchDeps, hit: Hit, qty: number | null): ResultV4 {
  const node = hit.node;
  const props = node.props as {
    code?: string | null; name_th?: string | null; name_en?: string | null; status?: string; image?: string | null;
    componentTypeIds?: string[]; sourceRef?: unknown;
  };
  const priceLadder = requirePriceTiers(node);
  const selectedPrice = priceLadder.length ? selectTier(priceLadder, qty) : null;

  const componentTypeIds = props.componentTypeIds ?? [];
  const typeId = componentTypeIds.length === 1 ? componentTypeIds[0] : null;
  const { type, group } = typeAndGroup(deps, typeId);

  return {
    kind: 'offer', id: node.id, code: (props.code as string | null) ?? null,
    name: String(props.name_th ?? props.name_en ?? props.code ?? ''), englishName: (props.name_en as string | null) ?? null,
    type, group, score: cosineFromEngineScore(hit.score ?? 0), status: String(props.status ?? ''), image: (props.image as string | null) ?? null,
    variants: [], priceLadder, selectedPrice,
    components: [], customizations: [], sourceRef: props.sourceRef ?? null,
  };
}

function buildLiteResult(deps: SearchDeps, hit: Hit, qty: number | null): ResultV4 {
  return hit.node.labels.includes('ProductModel')
    ? buildLiteModelResult(deps, hit, qty)
    : buildLiteOfferResult(deps, hit, qty);
}

/** Phase 2: neighbors() expansion, called ONLY for the final `results` + `nearest` (never for
 * every hit) — variants[] for a Model (HAS_VARIANT out -> HAS_SKU out). */
async function expandModel(deps: SearchDeps, lite: ResultV4): Promise<ResultV4> {
  const variantHits = await safeCall(() => deps.db.neighbors(lite.id, { rels: ['HAS_VARIANT'], direction: 'out' }));
  const variants: ResultV4['variants'] = [];
  for (const vh of variantHits) {
    const vProps = vh.node.props as { colors?: string[]; sizes?: string[]; materials?: string[] };
    const skuHits = await safeCall(() => deps.db.neighbors(vh.node.id, { rels: ['HAS_SKU'], direction: 'out' }));
    for (const sh of skuHits) {
      const sProps = sh.node.props as { displayCode?: string };
      variants.push({
        skuId: sh.node.id,
        displayCode: String(sProps.displayCode ?? ''),
        color: (vProps.colors ?? [])[0] ?? null,
        size: (vProps.sizes ?? [])[0] ?? null,
        material: (vProps.materials ?? [])[0] ?? null,
      });
    }
  }
  return { ...lite, variants };
}

/** Phase 2 for an Offer: components[]/variants[] (CONTAINS out -> HAS_SKU in -> HAS_VARIANT in)
 * and customizations[] (CUSTOMIZABLE_WITH out). */
async function expandOffer(deps: SearchDeps, lite: ResultV4): Promise<ResultV4> {
  const variants: ResultV4['variants'] = [];
  const components: ResultV4['components'] = [];
  const containHits = await safeCall(() => deps.db.neighbors(lite.id, { rels: ['CONTAINS'], direction: 'out' }));
  for (const ch of containHits) {
    const skuProps = ch.node.props as { displayCode?: string };
    const qtyOnLink = Number((ch.path.find((p) => p.rel === 'CONTAINS')?.props?.qty) ?? 1);
    const variantHits = await safeCall(() => deps.db.neighbors(ch.node.id, { rels: ['HAS_SKU'], direction: 'in' }));
    for (const vh of variantHits) {
      const vProps = vh.node.props as { colors?: string[]; sizes?: string[]; materials?: string[] };
      variants.push({
        skuId: ch.node.id, displayCode: String(skuProps.displayCode ?? ''),
        color: (vProps.colors ?? [])[0] ?? null, size: (vProps.sizes ?? [])[0] ?? null, material: (vProps.materials ?? [])[0] ?? null,
      });
      const modelHits = await safeCall(() => deps.db.neighbors(vh.node.id, { rels: ['HAS_VARIANT'], direction: 'in' }));
      for (const mh of modelHits) {
        const mProps = mh.node.props as { displayName?: string; typeId?: string | null };
        components.push({ modelId: mh.node.id, name: String(mProps.displayName ?? ''), typeId: (mProps.typeId as string | null) ?? null, qty: qtyOnLink });
      }
    }
  }

  const custHits = await safeCall(() => deps.db.neighbors(lite.id, { rels: ['CUSTOMIZABLE_WITH'], direction: 'out' }));
  const customizations = custHits.map((h) => ({ id: h.node.id, name_th: String((h.node.props as { name_th?: string }).name_th ?? '') }));

  return { ...lite, variants, components, customizations };
}

async function expandResult(deps: SearchDeps, lite: ResultV4): Promise<ResultV4> {
  return lite.kind === 'model' ? expandModel(deps, lite) : expandOffer(deps, lite);
}

/** Fixed seed text embedded instead of an empty query when browsing the whole catalog for a
 * budget (§ browseAll): a neutral "corporate gift" phrase, not a fabricated product query. */
const BROWSE_ALL_SEED_TEXT = 'ของขวัญองค์กร';
/** k covers the whole ~1,534-vector v4 collection; browseAll never re-queries at a larger k. */
const BROWSE_ALL_K = 2000;
/** labelFilter (Wave-4 B): the first query must be broad enough that filtering hits down to one
 * label still leaves `limit` candidates, without relying on the re-query rule below. */
const LABEL_FILTER_MIN_K = 400;

export async function searchV4(
  deps: SearchDeps,
  query: string,
  opts: {
    limit?: number; k?: number; alpha?: number; overrides?: { qty?: number; budgetPerUnit?: number };
    browseAll?: boolean; labelFilter?: Array<'model' | 'offer'>;
  } = {},
): Promise<SearchResponseV4> {
  const limit = opts.limit ?? 5;
  const baseK = opts.k ?? 40;
  const alpha = opts.alpha ?? 0;
  const labelFilter = opts.labelFilter;

  const parsedRaw = parseQuery(query, deps.aliases);
  const qty = opts.overrides?.qty ?? parsedRaw.qty;
  const budgetPerUnit = opts.overrides?.budgetPerUnit ?? parsedRaw.budgetPerUnit;

  const hasBudget = budgetPerUnit !== null && budgetPerUnit !== undefined;
  const browseAll = opts.browseAll === true || (parsedRaw.cleanText === '' && hasBudget);

  const embedText = browseAll ? BROWSE_ALL_SEED_TEXT : parsedRaw.cleanText;

  const tEmbedStart = Date.now();
  const vectors = await safeCall(() => deps.embed.embed([`query: ${embedText}`], 'query'));
  const queryVector = vectors[0] ?? [];
  const embedMs = Date.now() - tEmbedStart;

  const tSearchStart = Date.now();
  const firstK = browseAll ? BROWSE_ALL_K : labelFilter && labelFilter.length ? Math.max(baseK, LABEL_FILTER_MIN_K) : baseK;
  let hits: Hit[] = await safeCall(() => deps.db.hybridSearch({ queryVector, k: firstK, alpha, collection: 'e5_v4' }));
  hits = filterByLabel(hits, labelFilter);
  let filtered = filterHits(hits, parsedRaw.excludeTypes);
  let usedK = firstK;
  const requeryK = baseK * 4;
  if (!browseAll && filtered.length < limit && usedK < requeryK) {
    hits = await safeCall(() => deps.db.hybridSearch({ queryVector, k: requeryK, alpha, collection: 'e5_v4' }));
    hits = filterByLabel(hits, labelFilter);
    filtered = filterHits(hits, parsedRaw.excludeTypes);
    usedK = requeryK;
  }
  const searchMs = Date.now() - tSearchStart;

  const deduped = dedupe(filtered);
  let liteResults: ResultV4[] = deduped.map((hit) => buildLiteResult(deps, hit, qty ?? null));

  // Ordering, in two layers. The reported `score` stays the raw cosine (AC-C1); only the
  // ordering key changes.
  //
  // 1. Unorderable results sink, in every mode. A result with no code and no price is a
  //    ProductModel the projection could not tie to any offer (427 masters from
  //    pricelist_master.json, many with `code: null` and an empty ladder): nothing to quote,
  //    nothing to order, no image. Measured on the 2026-09-13 store, "แก้วน้ำ" returned seven of
  //    them ("Mug", "Bottle", all 0.88–0.89) above the one priced item, and "ขอราคา แก้วน้ำมีจอ LED"
  //    was answered "ยังไม่มีข้อมูลราคา" while TBH01-3 sat at rank 8 with a full ladder and an
  //    image. Semantic order is kept *among* orderable results, so browsing recall is unchanged
  //    for anything a customer could actually be shown.
  // 2. Priced-first nudge, only under commercial intent (a quantity or budget in the query):
  //    e5 scores over this catalog cluster within a few hundredths of each other, so a priced
  //    item routinely loses the cut to an unpriced near-tie — bad when the customer asked for a
  //    price, irrelevant when they are just browsing. 0.005 was too small: the live gap between
  //    the unpriced near-ties and the priced offer was 0.02; 0.03 covers the measured cluster
  //    while a clear semantic winner (≥ 0.03 ahead) still keeps its rank.
  const commercialIntent = (qty ?? null) !== null || budgetPerUnit !== null;
  const hasPrice = (r: ResultV4) => r.priceLadder.some((t) => !t.priceMissing);
  const unorderable = (r: ResultV4) => r.code === null && !hasPrice(r);
  const PRICED_TIEBREAK = commercialIntent ? 0.03 : 0;
  const orderKey = (r: ResultV4) => r.score + (hasPrice(r) ? PRICED_TIEBREAK : 0);
  liteResults = [...liteResults].sort((a, b) => {
    const ua = unorderable(a) ? 1 : 0;
    const ub = unorderable(b) ? 1 : 0;
    if (ua !== ub) return ua - ub;
    return orderKey(b) - orderKey(a);
  });

  let finalResults = liteResults;
  let nearestLite: ResultV4[] = [];
  let budgetUnmet = false;

  if (hasBudget) {
    // AC-C4: only a priceless *Model* is kept when its price is unknown (we can't rule out that
    // it fits the budget). A priceless Offer has no such exemption — an Offer's whole purpose is
    // to be priced, so one with no PRICED_AS edge is dropped rather than silently assumed in-budget.
    finalResults = liteResults.filter((r) => {
      if (r.selectedPrice === null) return r.kind === 'model';
      return r.selectedPrice.unitPrice <= budgetPerUnit!;
    });
    if (browseAll) {
      // Dearest-first: same "closest to budget" semantics as the legacy findWithinBudget sort.
      // Unpriced Models (kept per §5.7 step 6) sort after every priced result.
      finalResults = [...finalResults].sort((a, b) => {
        const av = a.selectedPrice ? a.selectedPrice.unitPrice : -Infinity;
        const bv = b.selectedPrice ? b.selectedPrice.unitPrice : -Infinity;
        return bv - av;
      });
    }
    if (finalResults.length === 0) {
      budgetUnmet = true;
      const pickNearest = (pool: ResultV4[]) => pool
        .filter((r) => r.selectedPrice !== null)
        .slice(0, 3)
        .sort((a, b) => a.selectedPrice!.unitPrice - b.selectedPrice!.unitPrice);
      nearestLite = pickNearest(liteResults);
      if (nearestLite.length === 0 && usedK < BROWSE_ALL_K) {
        // AC-C5: the first k hits held nothing priced outside the excluded types (e.g. "ไม่ใช่แก้ว"
        // removes most gift sets). Widen once to the whole collection so `nearest` is never vacuous
        // when any priced, non-excluded item exists.
        const wide = await safeCall(() => deps.db.hybridSearch({ queryVector, k: BROWSE_ALL_K, alpha, collection: 'e5_v4' }));
        const wideLite = dedupe(filterHits(filterByLabel(wide, labelFilter), parsedRaw.excludeTypes))
          .map((hit) => buildLiteResult(deps, hit, qty ?? null));
        nearestLite = pickNearest(wideLite);
        usedK = BROWSE_ALL_K;
      }
    }
  }

  const slicedLite = finalResults.slice(0, limit);

  // Phase 2: neighbors() expansion for ONLY the final results + nearest (never every hit).
  const tExpandStart = Date.now();
  const results = await Promise.all(slicedLite.map((r) => expandResult(deps, r)));
  const nearest = await Promise.all(nearestLite.map((r) => expandResult(deps, r)));
  const expandMs = Date.now() - tExpandStart;

  return {
    success: true,
    query,
    parsed: { ...parsedRaw, qty: qty ?? null, budgetPerUnit: budgetPerUnit ?? null, budgetUnmet },
    results,
    nearest,
    timing: { embedMs, searchMs, expandMs, k: usedK },
  };
}

export async function priceV4(
  deps: SearchDeps,
  code: string,
  qty: number | null,
): Promise<{ found: boolean; code: string; priceLadder: PriceTier[]; selectedPrice: SelectedPrice | null; exportDate: string | null }> {
  const offerId = offerNodeId(code);
  const priceHits = await safeCall(() => deps.db.neighbors(offerId, { rels: ['PRICED_AS'], direction: 'out' }));
  const priceLadder = ladderFromCsku(priceHits.map((h) => ({ props: h.node.props })));
  const selectedPrice = priceLadder.length ? selectTier(priceLadder, qty) : null;
  const exportDate = (priceHits[0]?.node.props as { exportDate?: string })?.exportDate ?? null;
  return { found: priceLadder.length > 0, code, priceLadder, selectedPrice, exportDate };
}
