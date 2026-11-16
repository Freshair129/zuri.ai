import type { Catalog } from '../catalog/store.js';
import { Role } from '../identity/registry.js';
import type { AnswerRag } from '../rag/genesis-rag.js';
import type { SearchEvidenceV4 } from './format-cards.js';
import type { PublishedProductQueryResult } from '../rag/genesisrag17/product-rag.js';

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
  rag: AnswerRag;
}

export interface EvidenceRecord {
  tool: string;
  input: unknown;
  output: unknown;
}

/**
 * A price step with the order total alongside it.
 *
 * The total is here rather than left to the reader because "300 ชุด ชุดละ 500" invites the next
 * sentence to say 150,000 — and a figure worked out in prose is a figure nothing checked. Putting
 * arithmetic in the evidence keeps the rule simple: every number in a reply came from the engine.
 */
export interface QuoteBreakEvidence {
  quantity: number;
  unitPriceThb: number;
  orderTotalThb: number;
}

export interface QuoteEvidence {
  publishedProducts?: PublishedProductQueryResult;
  catalogPrices?: Array<{ minQty: number; unitPriceThb: number; asOf: string | null }>;
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
): Promise<QuoteEvidence & { priceSource: 'commercial_sku' }> {
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

  if (priceEv.publishedProducts) {
    // A published catalog amount has no live tax/shipping/validity authority.
    // Preserve evidence, prohibit an invented quote total and never fall into RMB estimates.
    return { found: priceEv.found, quotable: false, sku, priceSource: 'commercial_sku',
      publishedProducts: priceEv.publishedProducts,
      catalogPrices: (priceEv.publishedProducts.price?.tiers ?? []).map((t) => ({ minQty: t.minQty, unitPriceThb: t.amountMinor / 100, asOf: t.asOf })),
      notes: ['ราคาจากแคตตาล็อกที่เผยแพร่ ยังไม่ใช่ใบเสนอราคา; หน่วย ภาษี ค่าส่ง และวันหมดอายุยังไม่ยืนยัน'],
      message: priceEv.found ? 'โปรดระบุวันที่ข้อมูลและข้อจำกัดของราคา' : 'ยังไม่มีราคาที่เผยแพร่สำหรับรหัสนี้' };
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

  // ADR-119: the local RMB cost-to-price estimate was removed with the Edge pricing engine, so a
  // code the published catalog does not know is reported as not found, never as an estimate.
  return { found: false, sku, message: `ไม่มีราคาที่ยืนยันได้สำหรับรหัส ${sku}`, priceSource: 'commercial_sku' };
}

export interface BudgetEvidence {
  publishedProducts?: PublishedProductQueryResult;
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

  if (ev.publishedProducts) {
    const matches = ev.publishedProducts.results.filter((p) => p.price.selected)
      .map((p) => ({ sku: p.code, name: p.name, unitPriceThb: p.price.selected!.amountMinor / 100 }));
    return { quantity, maxPriceThb, usesBreak: quantity, matchCount: matches.length, matches, budgetUnmet: !matches.length,
      nearest: [], priceSource: 'commercial_sku', publishedProducts: ev.publishedProducts,
      message: 'เทียบงบจากราคาแคตตาล็อกที่เผยแพร่เท่านั้น ยังไม่รวมเงื่อนไขภาษี ค่าส่ง และอายุราคาที่ไม่ทราบ' };
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
  if (ev.publishedProducts) {
    const result = ev.publishedProducts;
    return { query: ev.query, matchCount: ev.matchCount, priceBasis: result.priceBasis,
      corpus: { corpusId: result.corpusId, corpusGeneration: result.corpusGeneration, manifestHash: result.manifestHash },
      matches: result.results.map((p) => ({ code: p.code, name: p.name, kind: p.kind, citation: p.citation,
        relations: p.graph.map((g) => ({ predicate: g.predicate, code: g.targetCode, factId: g.factId, citation: g.citation })),
        prices: p.price.tiers.map((t) => ({ minQty: t.minQty, unitPriceThb: t.amountMinor / 100, asOf: t.asOf, citation: t.citation })),
        priceLimitations: { currency: 'THB', unit: null, validUntil: null, taxBasis: null, shippingBasis: null } })) };
  }
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
    // FR-189 primary mode: cited passages from one published generation. Absent in off and shadow.
    ...(ev.passages ? {
      published: ev.published ? { snapshotId: ev.published.snapshotId, generation: ev.published.generation } : null,
      passages: ev.passages.map((p) => ({ text: p.text, score: p.score, chunkId: p.citation.chunkId })),
    } : {}),
  };
}
