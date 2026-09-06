// T9 (build-graph.ts) is not present in this worktree yet (developed in parallel).
// This fixture hand-writes a small GraphBatch literal matching T9's plan Interfaces
// (node label/prop shapes from spec §5.2/§5.3) instead of importing buildGraphV4.
// See T10 questions: once T9 lands, this fixture should switch to buildGraphV4(...)
// over a committed identity-mini.json, per the plan's original Step 1 instruction.
import type { EmbedClient } from '../../../src/rag/v4/embed-client.js';
import type { GraphDb } from '../../../src/rag/v4/search.js';

export interface GraphNode { id: string; labels: string[]; props: Record<string, unknown> }
export interface GraphEdge { id: string; from: string; to: string; rel: string; props?: Record<string, unknown> }
export interface GraphBatch { nodes: GraphNode[]; edges: GraphEdge[]; stats: Record<string, number> }

const sourceRef = (rowKey: string) => ({ file: 'identity-review.json', sha256: 'deadbeef', rowKey });

// --- Price tiers (Wave-4 A.1: denormalized directly onto Offer/Model node props, matching what
// buildGraphV4 now computes — search.ts's Phase 1 reads props.priceTiers/priceSource, it no
// longer traverses PRICED_AS/SINGLE_OF/CONTAINS at query time) --------------------------------
const tier = (qtyTier: number, unitPrice: number, commercialSku: string, offerCode: string) =>
  ({ qtyTier, unitPrice, commercialSku, priceMissing: false, exportDate: '2026-06-21', offerCode });

const TIERS_TSP07_2 = [tier(10, 2110, 'TSP07-2(P-06)-10', 'TSP07-2')];
const TIERS_TBY01 = [tier(10, 690, 'TBY01(P-14)-10', 'TBY01'), tier(20, 550, 'TBY01(P-14)-20', 'TBY01'), tier(100, 490, 'TBY01(P-14)-100', 'TBY01')];
const TIERS_TDRINK01 = [tier(10, 470, 'TDRINK01(P-01)-10', 'TDRINK01')];
const TIERS_TTOY01 = [tier(10, 300, 'TTOY01(P-02)-10', 'TTOY01')];

// --- Models -----------------------------------------------------------
// PRODUCT_M1: no SINGLE_OF, only CONTAINS from OFFER_TSP07-2 -> priceSource "via_offer".
const PRODUCT_M1: GraphNode = {
  id: 'PRODUCT_M1', labels: ['ProductModel'],
  props: {
    displayName: 'สมุดโน้ต พาวเวอร์แบงค์', englishName: 'Notebook Powerbank', typeId: 'notebook', groupId: 'office',
    status: 'auto', baseSignature: 'notebook-powerbank', colors: ['Black', 'Blue'], sourceRef: sourceRef('PRODUCT_M1'),
    priceTiers: TIERS_TSP07_2, priceSource: 'via_offer', offerCodes: ['TSP07-2'],
  },
};
// PRODUCT_M2: SINGLE_OF OFFER_TBY01 (wins over the CONTAINS link from OFFER_TSP07-2) -> "offer".
const PRODUCT_M2: GraphNode = {
  id: 'PRODUCT_M2', labels: ['ProductModel'],
  props: {
    displayName: 'เครื่องนวดคอ', englishName: 'Neck massager', typeId: 'neck_massager', groupId: 'care_wellness',
    status: 'auto', baseSignature: 'neck-massager', colors: ['White'], sourceRef: sourceRef('PRODUCT_M2'),
    priceTiers: TIERS_TBY01, priceSource: 'offer', offerCodes: ['TBY01', 'TSP07-2'],
  },
};
// PRODUCT_M3: no SINGLE_OF and no CONTAINS link in this fixture -> priceless.
const PRODUCT_M3: GraphNode = {
  id: 'PRODUCT_M3', labels: ['ProductModel'],
  props: {
    displayName: 'แก้วน้ำ', englishName: 'Water bottle', typeId: 'drinkware', groupId: 'home_travel',
    status: 'review_required', baseSignature: 'water-bottle', colors: ['White', 'Red'], sourceRef: sourceRef('PRODUCT_M3'),
    priceTiers: [], priceSource: null, offerCodes: [],
  },
};

// --- Variants + SKUs ----------------------------------------------------
const VARIANT_M1_BLACK: GraphNode = { id: 'VARIANT_M1_BLACK', labels: ['PhysicalVariant'], props: { colors: ['Black'], sizes: ['A5'], materials: [], status: 'auto', productId: 'PRODUCT_M1', sourceRef: sourceRef('VARIANT_M1_BLACK') } };
const VARIANT_M1_BLUE: GraphNode = { id: 'VARIANT_M1_BLUE', labels: ['PhysicalVariant'], props: { colors: ['Blue'], sizes: ['A5'], materials: [], status: 'auto', productId: 'PRODUCT_M1', sourceRef: sourceRef('VARIANT_M1_BLUE') } };
const VARIANT_M2_WHITE: GraphNode = { id: 'VARIANT_M2_WHITE', labels: ['PhysicalVariant'], props: { colors: ['White'], sizes: [], materials: [], status: 'auto', productId: 'PRODUCT_M2', sourceRef: sourceRef('VARIANT_M2_WHITE') } };
const VARIANT_M3_WHITE: GraphNode = { id: 'VARIANT_M3_WHITE', labels: ['PhysicalVariant'], props: { colors: ['White'], sizes: ['500ml'], materials: ['SUS304'], status: 'review_required', productId: 'PRODUCT_M3', sourceRef: sourceRef('VARIANT_M3_WHITE') } };

const SKU_M1_BLACK: GraphNode = { id: 'SKU_M1_BLACK', labels: ['PhysicalSKU'], props: { displayCode: 'SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5', modelId: 'PRODUCT_M1', variantId: 'VARIANT_M1_BLACK', kind: 'sku', sourceRef: sourceRef('SKU_M1_BLACK') } };
const SKU_M1_BLUE: GraphNode = { id: 'SKU_M1_BLUE', labels: ['PhysicalSKU'], props: { displayCode: 'SKU-NOTEBOOK-NOTEBOOK-POW-BLU-A5', modelId: 'PRODUCT_M1', variantId: 'VARIANT_M1_BLUE', kind: 'sku', sourceRef: sourceRef('SKU_M1_BLUE') } };
const SKU_M2_WHITE: GraphNode = { id: 'SKU_M2_WHITE', labels: ['PhysicalSKU'], props: { displayCode: 'SKU-NECKMASSAGER-NECK-MASS-WHT', modelId: 'PRODUCT_M2', variantId: 'VARIANT_M2_WHITE', kind: 'sku', sourceRef: sourceRef('SKU_M2_WHITE') } };
const SKU_M3_WHITE: GraphNode = { id: 'SKU_M3_WHITE', labels: ['PhysicalSKU'], props: { displayCode: 'SKU-DRINKWARE-WATER-BOTTLE-WHT-500-S304', modelId: 'PRODUCT_M3', variantId: 'VARIANT_M3_WHITE', kind: 'sku', sourceRef: sourceRef('SKU_M3_WHITE') } };

// --- Offers ---------------------------------------------------------
// Office gift set: contains M1 (notebook) + M2 (neck_massager); M1 has no SINGLE_OF,
// so its price ladder comes from this offer via CONTAINS ("via_offer").
const OFFER_TSP07_2: GraphNode = {
  id: 'OFFER_TSP07-2', labels: ['CatalogOffer'],
  props: {
    code: 'TSP07-2', name_th: 'ชุดของขวัญออฟฟิศ', name_en: 'Office gift set', description: 'สมุดโน้ตพาวเวอร์แบงค์คู่เครื่องนวดคอ',
    image: null, offerKind: 'set', rmb: null, branding: [], status: 'auto', origin: 'catalog',
    componentTypeIds: ['notebook', 'neck_massager'], sourceRef: sourceRef('OFFER_TSP07-2'),
    priceTiers: TIERS_TSP07_2,
  },
};
// Single-model offer for M2; M2 has SINGLE_OF so its price ladder is tagged "offer".
const OFFER_TBY01: GraphNode = {
  id: 'OFFER_TBY01', labels: ['CatalogOffer'],
  props: {
    code: 'TBY01', name_th: 'เครื่องนวดคอ', name_en: 'Neck massager', description: 'เครื่องนวดคอไฟฟ้า',
    image: null, offerKind: 'single', rmb: null, branding: ['สกรีนโลโก้'], status: 'auto', origin: 'catalog',
    componentTypeIds: ['neck_massager'], sourceRef: sourceRef('OFFER_TBY01'),
    priceTiers: TIERS_TBY01,
  },
};
// Drinkware offer used for exclude tests and for the budget test (priced at 470).
const OFFER_TDRINK01: GraphNode = {
  id: 'OFFER_TDRINK01', labels: ['CatalogOffer'],
  props: {
    code: 'TDRINK01', name_th: 'แก้วน้ำของขวัญ', name_en: 'Gift water bottle', description: 'แก้วน้ำสแตนเลส',
    image: null, offerKind: 'single', rmb: null, branding: [], status: 'auto', origin: 'catalog',
    componentTypeIds: ['drinkware'], sourceRef: sourceRef('OFFER_TDRINK01'),
    priceTiers: TIERS_TDRINK01,
  },
};

// Cheapest offer of all (300) but deliberately given the LOWEST engine score whenever it
// appears alongside the other 3 priced offers below, so nearest[] tests can distinguish
// "top-3 by semantic score, then price-sorted" (correct, AC-C5) from "3 globally cheapest
// by price" (bug): a pure-price sort would place this offer in nearest[], the correct
// semantic-rank-then-price behaviour excludes it (rank 4).
const OFFER_TTOY01: GraphNode = {
  id: 'OFFER_TTOY01', labels: ['CatalogOffer'],
  props: {
    code: 'TTOY01', name_th: 'ของเล่นคลายเครียด', name_en: 'Stress toy', description: 'ของเล่นบีบคลายเครียด',
    image: null, offerKind: 'single', rmb: null, branding: [], status: 'auto', origin: 'catalog',
    componentTypeIds: ['stress_toy'], sourceRef: sourceRef('OFFER_TTOY01'),
    priceTiers: TIERS_TTOY01,
  },
};

// Set offer with no PRICED_AS edge at all (real data has these — a FlowAccount export row was
// never matched for this offer code). Used to test that the budget filter drops an unpriced
// *Offer* while an unpriced *Model* (PRODUCT_M3 above, when nothing excludes it) is kept.
const OFFER_TSET_UNPRICED: GraphNode = {
  id: 'OFFER_TSET99', labels: ['CatalogOffer'],
  props: {
    code: 'TSET99', name_th: 'ชุดของขวัญไม่มีราคา', name_en: 'Unpriced gift set', description: 'ชุดของขวัญที่ยังไม่มีราคาบัญชี',
    image: null, offerKind: 'set', rmb: null, branding: [], status: 'auto', origin: 'catalog',
    componentTypeIds: ['notebook'], sourceRef: sourceRef('OFFER_TSET99'),
    priceTiers: [],
  },
};

const CUSTOM_SCREEN: GraphNode = { id: 'CUSTOM_screen_logo', labels: ['CustomizationOption'], props: { name_th: 'สกรีนโลโก้' } };

// --- CommercialSKU price lines ----------------------------------------
const CSKU_TSP07_2: GraphNode = { id: 'CSKU_TSP07_2', labels: ['CommercialSKU'], props: { flowAccountCode: 'TSP07-2(P-06)-10', offerCode: 'TSP07-2', priceListGroup: 'P-06', qtyTier: 10, unitPrice: 2110, unitPriceWithVat: 2257.7, priceMissing: false, flowAccountName: 'ชุดของขวัญออฟฟิศ TSP07-2(P-06)-10', exportDate: '2026-06-21', sourceRef: sourceRef('CSKU_TSP07_2') } };
const CSKU_TBY01_10: GraphNode = { id: 'CSKU_TBY01_10', labels: ['CommercialSKU'], props: { flowAccountCode: 'TBY01(P-14)-10', offerCode: 'TBY01', priceListGroup: 'P-14', qtyTier: 10, unitPrice: 690, unitPriceWithVat: 738.3, priceMissing: false, flowAccountName: 'เครื่องนวดคอ TBY01(P-14)-10', exportDate: '2026-06-21', sourceRef: sourceRef('CSKU_TBY01_10') } };
const CSKU_TBY01_100: GraphNode = { id: 'CSKU_TBY01_100', labels: ['CommercialSKU'], props: { flowAccountCode: 'TBY01(P-14)-100', offerCode: 'TBY01', priceListGroup: 'P-14', qtyTier: 100, unitPrice: 490, unitPriceWithVat: 524.3, priceMissing: false, flowAccountName: 'เครื่องนวดคอ TBY01(P-14)-100', exportDate: '2026-06-21', sourceRef: sourceRef('CSKU_TBY01_100') } };
const CSKU_TBY01_20: GraphNode = { id: 'CSKU_TBY01_20', labels: ['CommercialSKU'], props: { flowAccountCode: 'TBY01(P-14)-20', offerCode: 'TBY01', priceListGroup: 'P-14', qtyTier: 20, unitPrice: 550, unitPriceWithVat: 588.5, priceMissing: false, flowAccountName: 'เครื่องนวดคอ TBY01(P-14)-20', exportDate: '2026-06-21', sourceRef: sourceRef('CSKU_TBY01_20') } };
const CSKU_TDRINK01_10: GraphNode = { id: 'CSKU_TDRINK01_10', labels: ['CommercialSKU'], props: { flowAccountCode: 'TDRINK01(P-01)-10', offerCode: 'TDRINK01', priceListGroup: 'P-01', qtyTier: 10, unitPrice: 470, unitPriceWithVat: 502.9, priceMissing: false, flowAccountName: 'แก้วน้ำของขวัญ TDRINK01(P-01)-10', exportDate: '2026-06-21', sourceRef: sourceRef('CSKU_TDRINK01_10') } };
const CSKU_TTOY01_10: GraphNode = { id: 'CSKU_TTOY01_10', labels: ['CommercialSKU'], props: { flowAccountCode: 'TTOY01(P-02)-10', offerCode: 'TTOY01', priceListGroup: 'P-02', qtyTier: 10, unitPrice: 300, unitPriceWithVat: 321, priceMissing: false, flowAccountName: 'ของเล่นคลายเครียด TTOY01(P-02)-10', exportDate: '2026-06-21', sourceRef: sourceRef('CSKU_TTOY01_10') } };

function edge(rel: string, from: string, to: string, props: Record<string, unknown> = {}): GraphEdge {
  return { id: `EDGE_${rel}_${from}_${to}`, from, to, rel, props };
}

export const FIXTURE_BATCH: GraphBatch = {
  nodes: [
    PRODUCT_M1, PRODUCT_M2, PRODUCT_M3,
    VARIANT_M1_BLACK, VARIANT_M1_BLUE, VARIANT_M2_WHITE, VARIANT_M3_WHITE,
    SKU_M1_BLACK, SKU_M1_BLUE, SKU_M2_WHITE, SKU_M3_WHITE,
    OFFER_TSP07_2, OFFER_TBY01, OFFER_TDRINK01, OFFER_TTOY01, OFFER_TSET_UNPRICED, CUSTOM_SCREEN,
    CSKU_TSP07_2, CSKU_TBY01_10, CSKU_TBY01_100, CSKU_TBY01_20, CSKU_TDRINK01_10, CSKU_TTOY01_10,
  ],
  edges: [
    edge('HAS_VARIANT', 'PRODUCT_M1', 'VARIANT_M1_BLACK'),
    edge('HAS_VARIANT', 'PRODUCT_M1', 'VARIANT_M1_BLUE'),
    edge('HAS_VARIANT', 'PRODUCT_M2', 'VARIANT_M2_WHITE'),
    edge('HAS_VARIANT', 'PRODUCT_M3', 'VARIANT_M3_WHITE'),
    edge('HAS_SKU', 'VARIANT_M1_BLACK', 'SKU_M1_BLACK'),
    edge('HAS_SKU', 'VARIANT_M1_BLUE', 'SKU_M1_BLUE'),
    edge('HAS_SKU', 'VARIANT_M2_WHITE', 'SKU_M2_WHITE'),
    edge('HAS_SKU', 'VARIANT_M3_WHITE', 'SKU_M3_WHITE'),
    edge('CONTAINS', 'OFFER_TSP07-2', 'SKU_M1_BLACK', { qty: 1, position: 1, role: 'notebook', componentLinkId: 'CL1' }),
    edge('CONTAINS', 'OFFER_TSP07-2', 'SKU_M2_WHITE', { qty: 1, position: 2, role: 'neck_massager', componentLinkId: 'CL2' }),
    edge('SINGLE_OF', 'OFFER_TBY01', 'PRODUCT_M2'),
    edge('PRICED_AS', 'OFFER_TSP07-2', 'CSKU_TSP07_2'),
    edge('PRICED_AS', 'OFFER_TBY01', 'CSKU_TBY01_10'),
    edge('PRICED_AS', 'OFFER_TBY01', 'CSKU_TBY01_20'),
    edge('PRICED_AS', 'OFFER_TBY01', 'CSKU_TBY01_100'),
    edge('PRICED_AS', 'OFFER_TDRINK01', 'CSKU_TDRINK01_10'),
    edge('PRICED_AS', 'OFFER_TTOY01', 'CSKU_TTOY01_10'),
    edge('CUSTOMIZABLE_WITH', 'OFFER_TBY01', 'CUSTOM_screen_logo'),
  ],
  stats: {},
};

function byId(batch: GraphBatch): Map<string, GraphNode> {
  return new Map(batch.nodes.map((n) => [n.id, n]));
}

export interface NeighborsCall { seed: string; a: { rels?: string[]; rel?: string; direction?: 'out' | 'in' | 'both'; depth?: number; limit?: number } }
export interface HybridSearchCall { queryVector: number[]; k: number; alpha?: number; collection?: string }

export interface FakeDb extends GraphDb {
  calls: { hybridSearch: HybridSearchCall[]; neighbors: NeighborsCall[] };
}

/**
 * `script` is a queue of hit lists: the first hybridSearch call consumes script[0],
 * the second consumes script[1] (or repeats the last entry if the script is shorter
 * than the number of calls made).
 */
export function buildFakeDb(
  batch: GraphBatch,
  script: Array<Array<{ id: string; score: number }>>,
  opts: { throwOnSearch?: boolean } = {},
): FakeDb {
  const nodes = byId(batch);
  const calls: FakeDb['calls'] = { hybridSearch: [], neighbors: [] };
  let callIndex = 0;

  return {
    calls,
    async hybridSearch(a) {
      calls.hybridSearch.push(a);
      if (opts.throwOnSearch) throw new Error('engine down');
      const spec = script[Math.min(callIndex, script.length - 1)] ?? [];
      callIndex++;
      return spec.map(({ id, score }) => {
        const node = nodes.get(id);
        if (!node) throw new Error(`fixture missing node ${id}`);
        return { node, score };
      });
    },
    async neighbors(seed, a) {
      calls.neighbors.push({ seed, a });
      const direction = a.direction ?? 'out';
      const rels = a.rels ?? (a.rel ? [a.rel] : undefined);
      const out: Array<{ node: GraphNode; path: Array<{ rel: string; from: string; to: string; props: any }> }> = [];
      for (const e of batch.edges) {
        if (rels && !rels.includes(e.rel)) continue;
        const matchesOut = direction !== 'in' && e.from === seed;
        const matchesIn = direction !== 'out' && e.to === seed;
        if (!matchesOut && !matchesIn) continue;
        const otherId = matchesOut ? e.to : e.from;
        const node = nodes.get(otherId);
        if (!node) continue;
        out.push({ node, path: [{ rel: e.rel, from: e.from, to: e.to, props: e.props ?? {} }] });
      }
      return out;
    },
  };
}

export function buildFakeEmbedClient(): EmbedClient {
  return {
    async embed(texts: string[]) {
      return texts.map(() => [1, 0, 0]);
    },
    async health() {
      return { ok: true, model: 'fake', revision: 'fake' };
    },
  };
}

export const TYPE_NAMES = new Map<string, string>([
  ['notebook', 'สมุดโน้ต'],
  ['neck_massager', 'เครื่องนวดคอ'],
  ['drinkware', 'แก้วน้ำ'],
]);
export const TYPE_GROUPS = new Map<string, string>([
  ['notebook', 'office'],
  ['neck_massager', 'care_wellness'],
  ['drinkware', 'home_travel'],
]);
export const ALIASES = new Map<string, string>([
  ['แก้วน้ำ', 'drinkware'],
  ['แก้ว', 'drinkware'],
  ['เครื่องนวดคอ', 'neck_massager'],
  ['สมุดโน้ต', 'notebook'],
]);
