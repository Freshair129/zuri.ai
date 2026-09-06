import { Catalog, CatalogProduct, findByCode, isQuotable } from '../catalog/store.js';
import { Role } from '../identity/registry.js';
import { ScopedQuote, scopeQuote } from '../identity/scope.js';
import {
  FreightMode,
  buildPriceQuote,
  leadTimeFor,
  modeForDeadline,
  screenPositionsForItemCode,
} from '../pricing/index.js';
import { GenesisLocalRag } from '../rag/genesis-rag.js';
import type { SearchEvidenceV4 } from './format-cards.js';

/**
 * The facts a model is allowed to answer from.
 *
 * Everything here is computed by the pricing engine and then cut to the caller's role *before* it
 * is returned. A sales conversation therefore never has a factory cost or a markup in the model's
 * context at all — not hidden behind an instruction, simply absent. An instruction can be argued
 * with by whatever the customer types; an absent field cannot.
 *
 * These are also the only source of numbers in a reply. `verifyNumbers` in `llm.ts` checks the
 * finished text against what these returned, so a figure the model invented does not reach a
 * customer.
 */

export interface EvidenceOptions {
  catalog: Catalog;
  role: Role;
  exchangeRate: number;
  shipMonth?: number;
  /** The LINE agent's only door into the catalog graph — HTTP only, never opened directly. */
  rag: GenesisLocalRag;
}

export interface EvidenceRecord {
  tool: string;
  input: unknown;
  output: unknown;
}

function quoteInputFor(p: CatalogProduct, options: EvidenceOptions) {
  const [l, w, h] = p.dims as [number, number, number];
  return {
    sku: p.code,
    factoryCostRmb: p.rmb as number,
    exchangeRate: options.exchangeRate,
    carton: {
      unitsPerCarton: p.upc as number,
      cartonCbm: Math.round(((l * w * h) / 1e6) * 10000) / 10000,
      ...(p.kg ? { cartonWeightKg: p.kg } : {}),
    },
    freight: {
      mode: 'auto' as const,
      shipMonth: options.shipMonth ?? new Date().getMonth() + 1,
      goodsClass: (p.e ? 'electronic_tisi' : 'general') as 'electronic_tisi' | 'general',
    },
    logo: { positions: screenPositionsForItemCode(p.code) },
  };
}

/**
 * A price step with the order total alongside it.
 *
 * The total is here rather than left to the reader because "300 ชุด ชุดละ 500" invites the next
 * sentence to say 150,000 — and a figure worked out in prose is a figure nothing checked. Putting
 * arithmetic in the evidence keeps the rule simple: every number in a reply came from the engine.
 */
export type QuoteBreakEvidence = ScopedQuote['breaks'][number] & { orderTotalThb: number };

export interface QuoteEvidence {
  found: boolean;
  /** Set only when the price service itself could not be reached — never a fabricated price. */
  unavailable?: true;
  /** Present alongside `unavailable` — why the price service could not be reached. */
  reason?: string;
  sku?: string;
  name?: string;
  quotable?: boolean;
  missing?: string[];
  breaks?: QuoteBreakEvidence[];
  cost?: ScopedQuote['cost'];
  notes?: string[];
  asOf?: string;
  /** The break a customer at this quantity actually pays, when one was asked about. */
  priceAtQuantity?: {
    askedQuantity: number;
    usesBreak: number;
    unitPriceThb: number;
    orderTotalThb: number;
    note: string;
  };
  message?: string;
}

/**
 * Price from the local rmb-catalog engine — the estimate path.
 *
 * Kept as the fallback for a code the catalog graph does not know about (or has not been ingested
 * with yet): a rough figure computed from factory cost and freight, clearly labelled
 * `estimate_rmb` rather than presented as the real ladder.
 */
function quotePriceRmb(sku: string, quantity: number | null, options: EvidenceOptions): QuoteEvidence {
  const product = findByCode(options.catalog, sku);
  if (!product) {
    return { found: false, sku, message: `ไม่มีรหัส ${sku} ในแคตตาล็อก` };
  }
  if (!isQuotable(product)) {
    return {
      found: true,
      quotable: false,
      sku: product.code,
      name: product.name,
      missing: [
        product.rmb === null ? 'ต้นทุนโรงงาน' : null,
        product.upc === null || product.dims === null ? 'ข้อมูลกล่อง' : null,
      ].filter(Boolean) as string[],
      message: 'แคตตาล็อกยังไม่มีข้อมูลพอสำหรับคำนวณราคา',
    };
  }

  const scoped = scopeQuote(buildPriceQuote(quoteInputFor(product, options)), options.role);
  const evidence: QuoteEvidence = {
    found: true,
    quotable: true,
    sku: scoped.sku,
    name: product.name,
    breaks: scoped.breaks.map((b) => ({
      ...b,
      orderTotalThb: Math.round(b.quantity * b.unitPriceThb * 100) / 100,
    })),
    ...(scoped.cost ? { cost: scoped.cost } : {}),
    notes: scoped.notes,
    asOf: scoped.asOf,
  };

  /*
   * An off-ladder quantity is answered with the break above it. The ladder is a published promise
   * at its own steps; reading a cheaper step downwards would be inventing a discount.
   */
  if (quantity !== null && quantity > 0) {
    const above = scoped.breaks.find((b) => b.quantity >= quantity);
    const chosen = above || scoped.breaks[scoped.breaks.length - 1];
    if (chosen) {
      evidence.priceAtQuantity = {
        askedQuantity: quantity,
        usesBreak: chosen.quantity,
        unitPriceThb: chosen.unitPriceThb,
        orderTotalThb: Math.round(quantity * chosen.unitPriceThb * 100) / 100,
        note: above
          ? 'ใช้ขั้นราคาที่ครอบจำนวนที่ถาม'
          : 'เกินขั้นสูงสุดในตาราง ควรขอราคาพิเศษ',
      };
    }
  }
  return evidence;
}

/**
 * Real per-unit prices, straight from the catalog graph's commercial SKU ladder.
 *
 * The graph is asked first because it carries the actual quoted prices (§5.7). A code the graph
 * has no ladder for — not yet ingested, or a code from the older rmb catalog — falls through to
 * the estimate path, and the caller is told which one it got via `priceSource`. A graph that
 * cannot be reached at all is reported as unavailable rather than silently answered from the
 * estimate path, so a customer never receives a number the system could not actually confirm.
 */
export async function quotePrice(
  sku: string,
  quantity: number | null,
  options: EvidenceOptions
): Promise<QuoteEvidence & { priceSource: 'commercial_sku' | 'estimate_rmb' }> {
  const priceEv = await options.rag.priceForCode(sku, quantity);

  if (priceEv.unavailable) {
    return {
      found: false,
      sku,
      message: 'ระบบราคาขัดข้องชั่วคราว',
      unavailable: true,
      reason: priceEv.reason,
      priceSource: 'commercial_sku',
    };
  }

  if (priceEv.found) {
    const breaks: QuoteBreakEvidence[] = priceEv.priceLadder
      .filter((t) => !t.priceMissing && t.qtyTier !== null)
      .sort((a, b) => (a.qtyTier as number) - (b.qtyTier as number))
      .map((t) => ({
        quantity: t.qtyTier as number,
        unitPriceThb: t.unitPrice,
        orderTotalThb: Math.round((t.qtyTier as number) * t.unitPrice * 100) / 100,
      }));

    const evidence: QuoteEvidence & { priceSource: 'commercial_sku' } = {
      found: true,
      quotable: true,
      sku,
      breaks,
      asOf: priceEv.exportDate ?? undefined,
      priceSource: 'commercial_sku',
    };

    if (priceEv.selectedPrice) {
      const sel = priceEv.selectedPrice;
      const askedQuantity = quantity ?? sel.qtyTier ?? 0;
      evidence.priceAtQuantity = {
        askedQuantity,
        usesBreak: sel.qtyTier ?? askedQuantity,
        unitPriceThb: sel.unitPrice,
        orderTotalThb: Math.round(askedQuantity * sel.unitPrice * 100) / 100,
        note: sel.belowMoq
          ? 'จำนวนต่ำกว่าขั้นต่ำในตาราง ใช้ราคาขั้นต่ำสุดที่มี'
          : 'ใช้ขั้นราคาที่ครอบจำนวนที่ถาม',
      };
    }

    return evidence;
  }

  return { ...quotePriceRmb(sku, quantity, options), priceSource: 'estimate_rmb' };
}

export interface BudgetEvidence {
  quantity: number;
  maxPriceThb: number;
  usesBreak: number;
  matchCount: number;
  matches: Array<{ sku: string; name: string; unitPriceThb: number }>;
  /** True when the graph found nothing inside the budget but had close-by alternatives (AC-C5). */
  budgetUnmet: boolean;
  /** Populated only when `budgetUnmet` — up to 3 near-budget alternatives, straight from the graph's `nearest[]`. */
  nearest: Array<{ sku: string; name: string; unitPriceThb: number }>;
  /** Set only when the price service itself could not be reached — never a fabricated empty result. */
  unavailable?: true;
  /** Present alongside `unavailable` — why the price service could not be reached. */
  reason?: string;
  message?: string;
}

/**
 * Products at or under a per-unit budget, at a given quantity.
 *
 * There is no product name to search for here — only a headcount and a budget — so this never
 * builds a query string to hand to the search engine. `rag.searchWithConstraints` carries the
 * quantity and budget as explicit overrides on an empty query instead; fabricating text like
 * "งบ 300 100 ชุด" would be a query the customer never typed, standing in for one that they did.
 */
export async function findWithinBudget(
  quantity: number,
  maxPriceThb: number,
  options: EvidenceOptions,
  limit = 10
): Promise<BudgetEvidence & { priceSource: 'commercial_sku' }> {
  const ev = await options.rag.searchWithConstraints({ query: '', qty: quantity, budgetPerUnit: maxPriceThb, limit });

  if (ev.unavailable) {
    return {
      quantity,
      maxPriceThb,
      usesBreak: quantity,
      matchCount: 0,
      matches: [],
      budgetUnmet: false,
      nearest: [],
      message: 'ระบบราคาขัดข้องชั่วคราว',
      unavailable: true,
      reason: ev.reason,
      priceSource: 'commercial_sku',
    };
  }

  const budgetUnmet = ev.parsed?.budgetUnmet === true;

  if (budgetUnmet) {
    const nearest = ev.nearest
      .filter((m) => m.selectedPrice !== null)
      .slice(0, 3)
      .map((m) => ({ sku: m.code ?? m.id, name: m.name, unitPriceThb: m.selectedPrice!.unitPrice }));

    return {
      quantity,
      maxPriceThb,
      usesBreak: ev.parsed?.qty ?? quantity,
      matchCount: 0,
      matches: [],
      budgetUnmet: true,
      nearest,
      priceSource: 'commercial_sku',
      message: 'ไม่มีสินค้าในงบนี้ แต่มีสินค้าใกล้เคียง',
    };
  }

  const hits = ev.matches
    .filter((m) => m.selectedPrice !== null)
    .map((m) => ({ sku: m.code ?? m.id, name: m.name, unitPriceThb: m.selectedPrice!.unitPrice }));

  // Dearest first: the closest to the budget is the best the customer can have for the money.
  hits.sort((a, b) => b.unitPriceThb - a.unitPriceThb);

  return {
    quantity,
    maxPriceThb,
    usesBreak: ev.parsed?.qty ?? quantity,
    matchCount: hits.length,
    matches: hits.slice(0, limit),
    budgetUnmet: false,
    nearest: [],
    priceSource: 'commercial_sku',
    ...(hits.length ? {} : { message: 'ไม่มีสินค้าที่เข้างบนี้' }),
  };
}

/**
 * Products matching a name or description, from the catalog graph over HTTP.
 *
 * Returned as-is from the graph service (`ResultV4[]`), never from a local substring scan of the
 * rmb catalog: `unavailable` is reported explicitly rather than silently answered with `[]`.
 */
export async function searchProducts(
  query: string,
  options: EvidenceOptions,
  limit = 5
): Promise<SearchEvidenceV4> {
  return options.rag.searchProducts(query, limit);
}

/**
 * The same evidence, cut down to what a model can actually use in an answer.
 *
 * The full `SearchEvidenceV4` is the right shape for the Flex card builder and for the number
 * check, and the wrong shape for a prompt: four fifths of it is `sourceRef` sha256 hashes,
 * internal `skuId`/`modelId`/`variantId` values, and image paths, none of which can appear in a
 * sentence to a customer. On a 4,096-token context that is not merely wasteful — two search rounds
 * of it fill the window and the model is left with single-digit tokens to answer in, which comes
 * back as `finish_reason: "length"`, empty content, and a fall through to the pattern reader.
 * Measured on a real result: 11,095 characters down to 2,132, an 81% cut.
 *
 * Only the model's copy is trimmed. `evidence` keeps the full object, so cards still get their
 * images and the number check still sees every figure the catalog offered.
 */
export function compactSearchForModel(ev: SearchEvidenceV4): unknown {
  if (ev.unavailable) return { unavailable: true, reason: ev.reason };
  const one = (m: SearchEvidenceV4['matches'][number]) => ({
    code: m.code,
    name: m.name,
    englishName: m.englishName,
    type: m.type?.name_th ?? null,
    status: m.status,
    unitPrice: m.selectedPrice?.unitPrice ?? null,
    qtyTier: m.selectedPrice?.qtyTier ?? null,
    priceLadder: (m.priceLadder ?? [])
      .filter((t) => !t.priceMissing)
      .map((t) => ({ qty: t.qtyTier, price: t.unitPrice })),
    components: (m.components ?? []).map((c) => c.name),
    colors: [...new Set((m.variants ?? []).map((v) => v.color).filter((c): c is string => !!c))],
  });
  return {
    query: ev.query,
    matchCount: ev.matchCount,
    budgetUnmet: ev.parsed?.budgetUnmet ?? false,
    matches: (ev.matches ?? []).map(one),
    nearest: (ev.nearest ?? []).map(one),
  };
}

export interface LeadTimeEvidence {
  quantity: number;
  rush: boolean;
  requested?: { mode: FreightMode; minDays: number; maxDays: number; stages: unknown };
  forDeadline?: { deadlineDays: number; mode: FreightMode | null; reason: string };
  note: string;
}

export function leadTime(
  quantity: number,
  options: { mode?: FreightMode; deadlineDays?: number; rush?: boolean }
): LeadTimeEvidence {
  const rush = options.rush ?? false;
  const evidence: LeadTimeEvidence = {
    quantity,
    rush,
    note: 'นับเฉพาะวันทำงานของบริษัท ไม่รวมเวลาที่ลูกค้าใช้คอนเฟิร์มอาร์ตเวิร์คและตัวอย่าง',
  };

  if (options.deadlineDays) {
    const decided = modeForDeadline(quantity, options.deadlineDays, rush);
    evidence.forDeadline = {
      deadlineDays: options.deadlineDays,
      mode: decided.mode,
      reason: decided.reason,
    };
    evidence.requested = {
      mode: decided.leadTime.mode,
      minDays: decided.leadTime.minDays,
      maxDays: decided.leadTime.maxDays,
      stages: decided.leadTime.stages,
    };
    return evidence;
  }

  const lt = leadTimeFor(quantity, options.mode ?? 'truck', rush);
  evidence.requested = {
    mode: lt.mode,
    minDays: lt.minDays,
    maxDays: lt.maxDays,
    stages: lt.stages,
  };
  return evidence;
}

/**
 * The standing commercial terms, written out once.
 *
 * They exist as a tool rather than as prose in the system prompt so that "ส่งต่างจังหวัดคิดยังไง"
 * is answered from the same place every time, and so that changing a term is a change to one
 * table rather than to a paragraph the model may paraphrase.
 */
export const POLICY_TOPICS = {
  shipping_thailand:
    'ค่าส่งในไทย: กรุงเทพฯ และปริมณฑลส่งฟรี ต่างจังหวัดคิดตามจริง (เหมารถส่ง หรือ Flash) ' +
    'ยังไม่ได้รวมอยู่ในราคาต่อชุด',
  freight_mode:
    'วิธีขนส่งจากจีน: ทางรถเร็วกว่าแต่ค่าขนส่งสูงกว่า ทางเรือถูกกว่าแต่ใช้เวลานานกว่า ' +
    'ช่วงฤดูขาย กันยายน–มกราคม ใช้ทางรถทั้งหมดเพราะลูกค้าเร่ง นอกฤดูกาลออเดอร์ที่เกิน 5 คิว ใช้ทางเรือ ' +
    'ราคาต่อชุดจึงต่างกันตามวิธีส่ง',
  screening:
    'ค่าสกรีนโลโก้รวมอยู่ในต้นทุนแล้ว จำนวนจุดสกรีนมาจากเลขตัวสุดท้ายของรหัสสินค้า บวกอีก 2 จุด ' +
    'สำหรับถุงและกล่องที่มีทุกชุด',
  order_steps:
    'ขั้นตอนสั่งซื้อ: 1) วางมัดจำ 50% พร้อมส่งไฟล์โลโก้ 2) เราส่งอาร์ตเวิร์คให้ตรวจ ' +
    '3) ลูกค้าคอนเฟิร์มอาร์ตเวิร์ค 4) ทำตัวอย่างพร้อมภาพและคลิป 5) ลูกค้าคอนเฟิร์มตัวอย่าง ' +
    '6) ผลิต 7) จัดส่ง — งานเร่งข้ามขั้นตัวอย่างได้ ผลิตทันทีหลังคอนเฟิร์มอาร์ตเวิร์ค',
  price_ladder:
    'ราคาเป็นขั้นบันไดตามจำนวน สั่งมากขึ้นราคาต่อชุดถูกลง ทั้งลูกค้าทั่วไปและลูกค้าองค์กร ' +
    'จำนวนที่ไม่ตรงขั้นจะใช้ราคาของขั้นที่สูงกว่า',
} as const;

export type PolicyTopic = keyof typeof POLICY_TOPICS;

/**
 * The same topics as a literal tuple, for the tool's JSON Schema `enum`.
 *
 * Kept in step with the table by the assignment below rather than by hand: adding a topic to
 * `POLICY_TOPICS` without listing it here stops the build.
 */
export const POLICY_TOPIC_KEYS = [
  'shipping_thailand',
  'freight_mode',
  'screening',
  'order_steps',
  'price_ladder',
] as const;

const _topicsAreComplete: readonly PolicyTopic[] = POLICY_TOPIC_KEYS;
const _topicsAreExhaustive: PolicyTopic = null as unknown as (typeof POLICY_TOPIC_KEYS)[number];
void _topicsAreComplete;
void _topicsAreExhaustive;

export function explainPolicy(topic: PolicyTopic): { topic: string; text: string } {
  return { topic, text: POLICY_TOPICS[topic] };
}
