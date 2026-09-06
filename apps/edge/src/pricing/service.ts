import { z } from 'zod';

import { findByCode, isQuotable, searchByName, type CatalogProduct } from '../catalog/store.js';
import { scopeQuote } from '../identity/scope.js';
import type { Role } from '../identity/registry.js';
import {
  CostCatalog,
  missingPricingFacts,
  quoteInputForProduct,
} from './cost-catalog.js';
import { buildPriceQuote } from './engine.js';
import { PRICING_PROFILES, type PricingProfile } from './policy.js';
import { leadTimeFor, modeForDeadline } from './lead-time.js';
import { FREIGHT_RATE_PROVENANCE } from './freight-rates.js';
import { FACTORY_TERMS_PROVENANCE } from './factory-terms.js';
import {
  FREIGHT_MODES,
  GOODS_CLASSES,
  type FreightMode,
  MEMBERSHIP_TIERS,
  WAREHOUSES,
  cartonSpecSchema,
  logoSpecSchema,
  type PricingInput,
} from './types.js';

/**
 * The pricing engine behind one HTTP door.
 *
 * Everything the browser calculator, the LINE agent and the team's own lookups need comes from the
 * same `buildPriceQuote` call, so a rule that changes changes once. The router below is a pure
 * function of (method, path, body, role) so it can be tested without a socket; `http-server.ts` is
 * the thin shell that resolves the role from a header and calls it.
 */

export interface RouterResult {
  status: number;
  body: unknown;
}

export interface PricingRouterOptions {
  catalog: CostCatalog;
  /** The one key that buys the owner view. `null`/empty means: nobody gets it (fail closed). */
  ownerKey: string | null;
  now?: () => Date;
}

/**
 * Which view a caller gets.
 *
 * Fail closed on purpose: with no key configured the answer is always `sales`, so a deployment
 * that forgot to set one cannot accidentally serve factory costs to the network. Comparison is a
 * plain equality on a secret that never leaves the server, and the key is never echoed back.
 */
export function roleForKey(presented: string | undefined | null, configured: string | null | undefined): Role {
  if (!configured) return 'sales';
  if (!presented) return 'sales';
  return presented === configured ? 'owner' : 'sales';
}

/*
 * The freight axes as *overrides*: every field optional, because a caller usually pins one thing
 * (the month, or sea instead of auto) and leaves the rest to the catalog-derived defaults. This is
 * declared here rather than derived from `freightSelectionSchema`, which is a refined schema (it
 * cross-checks mode/shipMonth) and therefore has no `.partial()`. The engine still applies that
 * refinement to the merged result, so nothing is skipped — only restated as optional on the way in.
 */
const zFreightOverride = z.object({
  warehouse: z.enum(WAREHOUSES).optional(),
  mode: z.union([z.enum(FREIGHT_MODES), z.literal('auto')]).optional(),
  membershipTier: z.enum(MEMBERSHIP_TIERS).optional(),
  goodsClass: z.enum(GOODS_CLASSES).optional(),
  shipMonth: z.number().int().min(1).max(12).optional(),
}).strict();

const PROFILE_KEYS = Object.keys(PRICING_PROFILES) as [PricingProfile, ...PricingProfile[]];

const zQuoteRequest = z.object({
  sku: z.string().trim().min(1),
  quantity: z.number().int().positive().optional(),
  /** Which published policy prices this — the calculator's ทั่วไป / องค์กร switch. */
  profile: z.enum(PROFILE_KEYS).optional(),
  /** Skip the sample stage when quoting a lead time. */
  rush: z.boolean().optional(),
  /**
   * The customer's deadline in company working days. When given, it decides the freight mode
   * outright — a deadline is the customer's constraint, not a preference — and the decision comes
   * back with its reason so the salesperson can repeat it.
   */
  deadlineDays: z.number().int().positive().optional(),
  exchangeRate: z.number().positive().optional(),
  shipMonth: z.number().int().min(1).max(12).optional(),
  freight: zFreightOverride.optional(),
  logo: logoSpecSchema.partial().optional(),
  additionalUnitCostThb: z.number().nonnegative().optional(),
  additionalOrderCostThb: z.number().nonnegative().optional(),
  inlandChinaCostRmb: z.number().nonnegative().optional(),
}).strict();

const zAdhocRequest = zQuoteRequest.extend({
  factoryCostRmb: z.number().nonnegative(),
  carton: cartonSpecSchema,
  goodsClass: z.enum(GOODS_CLASSES).optional(),
}).strict();

function catalogItem(product: CatalogProduct, role: Role) {
  const base = {
    code: product.code,
    name: product.name,
    book: product.book,
    bookKey: product.bookKey,
    quotable: isQuotable(product),
    hasImage: Boolean(product.img),
  };
  if (role !== 'owner') return base;
  return { ...base, rmb: product.rmb, upc: product.upc, dims: product.dims, kg: product.kg, e: product.e };
}

export function createPricingRouter(options: PricingRouterOptions) {
  const { catalog, ownerKey } = options;
  const now = options.now ?? (() => new Date());
  const provenance = { freightRate: FREIGHT_RATE_PROVENANCE, factoryTerms: FACTORY_TERMS_PROVENANCE };

  function quoteBody(
    input: PricingInput,
    role: Role,
    quantity: number | undefined,
    profile: PricingProfile = 'standard',
    rush = false,
    deadlineDays?: number
  ) {
    /*
     * A deadline overrides the routing rule before anything is priced, because the mode changes
     * the freight cost — deciding it after the quote would price one shipment and promise another.
     */
    let deadline: { mode: FreightMode | null; reason: string } | null = null;
    let effectiveInput = input;
    if (deadlineDays) {
      const judged = modeForDeadline(quantity ?? PRICING_PROFILES[profile].anchorQuantity, deadlineDays, rush);
      deadline = { mode: judged.mode, reason: judged.reason };
      if (judged.mode) {
        effectiveInput = { ...input, freight: { ...(input.freight ?? {}), mode: judged.mode } };
      }
    }
    const quote = buildPriceQuote(effectiveInput, PRICING_PROFILES[profile]);
    const scoped = scopeQuote(quote, role);
    const breaks = scoped.breaks.map((b) => ({
      ...b,
      orderTotalThb: Math.round(b.quantity * b.unitPriceThb * 100) / 100,
    }));

    /*
     * An off-ladder quantity is answered with the break above it — the same rule the LINE agent
     * already applies. Reading a cheaper step downwards would be inventing a discount nobody
     * published.
     */
    let priceAtQuantity;
    if (quantity) {
      const above = scoped.breaks.find((b) => b.quantity >= quantity);
      const chosen = above ?? scoped.breaks[scoped.breaks.length - 1];
      if (chosen) {
        priceAtQuantity = {
          askedQuantity: quantity,
          usesBreak: chosen.quantity,
          unitPriceThb: chosen.unitPriceThb,
          orderTotalThb: Math.round(quantity * chosen.unitPriceThb * 100) / 100,
          note: above ? 'ใช้ขั้นราคาที่ครอบจำนวนที่ถาม' : 'เกินขั้นสูงสุดในตาราง ควรขอราคาพิเศษ',
        };
      }
    }

    /*
     * Lead time is reported for the break the customer would actually be quoted, using the freight
     * mode that break resolved to — `auto` routing can put a small order on a truck and a large one
     * on a ship, and a delivery promise made on the wrong one is the promise that gets missed.
     */
    const leadBreak = quantity
      ? quote.breaks.find((b) => b.quantity >= quantity) ?? quote.breaks[quote.breaks.length - 1]
      : quote.breaks[quote.breaks.length - 1];
    const leadTime = leadBreak ? leadTimeFor(leadBreak.quantity, leadBreak.freightMode, rush) : null;

    return {
      quote: { ...scoped, breaks },
      profile,
      ...(deadline ? { deadline } : {}),
      ...(priceAtQuantity ? { priceAtQuantity } : {}),
      ...(leadTime ? { leadTime } : {}),
      /*
       * Everything the engine computed, for the owner-side calculator: carton counts, the density
       * switch and its flip threshold, per-break freight mode and small-order premium, and the
       * policy that priced it. It is a cost surface, so it follows the same role gate as `cost`.
       */
      ...(role === 'owner'
        ? {
            detail: {
              anchorLandedUnitCost: quote.anchorLandedUnitCost,
              breaks: quote.breaks,
              policy: quote.policy,
              freight: quote.freight,
              warnings: quote.warnings,
            },
          }
        : {}),
      priceSource: 'estimate_rmb' as const,
      catalog: catalog.manifest,
      provenance,
      asOf: now().toISOString(),
    };
  }

  async function handle(
    method: string,
    rawPath: string,
    body: unknown,
    role: Role
  ): Promise<RouterResult> {
    const [pathname, rawQuery] = rawPath.split('?');
    const query = new URLSearchParams(rawQuery ?? '');

    if (method === 'GET' && pathname === '/health') {
      return {
        status: 200,
        body: {
          ok: true,
          catalog: catalog.manifest,
          ownerKeyConfigured: Boolean(ownerKey),
          asOf: now().toISOString(),
        },
      };
    }

    if (method === 'GET' && pathname === '/api/pricing/catalog') {
      const q = (query.get('q') ?? '').trim();
      const book = (query.get('book') ?? '').trim();
      // The rail lists a whole book at once (1,088 products across two today), so the cap is the
      // catalog's own size rather than a page size.
      const limit = Math.min(Number(query.get('limit') ?? 50) || 50, 5000);
      const pool = book ? catalog.products.filter((p) => p.bookKey === book) : catalog.products;
      const found = q
        ? searchByName({ ...catalog, products: pool }, q, limit)
        : pool.slice(0, limit);
      return {
        status: 200,
        body: { items: found.map((p) => catalogItem(p, role)), total: catalog.products.length, role },
      };
    }

    if (method === 'POST' && pathname === '/api/pricing/quote') {
      const parsed = zQuoteRequest.safeParse(body ?? {});
      if (!parsed.success) {
        return { status: 400, body: { error: 'คำขอไม่ถูกต้อง', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } };
      }
      const req = parsed.data;
      const product = findByCode(catalog, req.sku);
      if (!product) return { status: 404, body: { error: `ไม่มีรหัส ${req.sku} ในแคตตาล็อกต้นทุน` } };
      if (!isQuotable(product)) {
        return {
          status: 422,
          body: { error: 'แคตตาล็อกยังไม่มีข้อมูลพอสำหรับคำนวณราคา', sku: product.code, missing: missingPricingFacts(product) },
        };
      }

      const input = quoteInputForProduct(product, {
        exchangeRate: req.exchangeRate,
        shipMonth: req.shipMonth ?? req.freight?.shipMonth ?? now().getMonth() + 1,
        freight: req.freight,
        ...(req.logo ? { logo: { positions: undefined, ...req.logo } as PricingInput['logo'] } : {}),
        additionalUnitCostThb: req.additionalUnitCostThb,
        additionalOrderCostThb: req.additionalOrderCostThb,
        inlandChinaCostRmb: req.inlandChinaCostRmb,
      });
      try {
        return {
          status: 200,
          body: { ...quoteBody(input, role, req.quantity, req.profile ?? 'standard', req.rush ?? false, req.deadlineDays), name: product.name },
        };
      } catch (err) {
        return { status: 400, body: { error: err instanceof Error ? err.message : 'คำนวณราคาไม่สำเร็จ' } };
      }
    }

    if (method === 'POST' && pathname === '/api/pricing/quote/adhoc') {
      /*
       * Ad-hoc pricing takes a cost the caller supplies, so it *is* a cost surface: sales never
       * gets it, regardless of what the body says.
       */
      if (role !== 'owner') return { status: 403, body: { error: 'ต้องใช้สิทธิ์เจ้าของสำหรับคำนวณจากต้นทุนที่กรอกเอง' } };
      const parsed = zAdhocRequest.safeParse(body ?? {});
      if (!parsed.success) {
        return { status: 400, body: { error: 'คำขอไม่ถูกต้อง', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } };
      }
      const req = parsed.data;
      const input: PricingInput = {
        sku: req.sku,
        factoryCostRmb: req.factoryCostRmb,
        exchangeRate: req.exchangeRate ?? 5,
        carton: req.carton,
        freight: {
          mode: 'auto' as const,
          shipMonth: req.shipMonth ?? req.freight?.shipMonth ?? now().getMonth() + 1,
          ...(req.goodsClass ? { goodsClass: req.goodsClass } : {}),
          ...(req.freight ?? {}),
        },
        ...(req.logo ? { logo: req.logo as PricingInput['logo'] } : {}),
        ...(req.additionalUnitCostThb !== undefined ? { additionalUnitCostThb: req.additionalUnitCostThb } : {}),
        ...(req.additionalOrderCostThb !== undefined ? { additionalOrderCostThb: req.additionalOrderCostThb } : {}),
        ...(req.inlandChinaCostRmb !== undefined ? { inlandChinaCostRmb: req.inlandChinaCostRmb } : {}),
      };
      try {
        return { status: 200, body: quoteBody(input, role, req.quantity, req.profile ?? 'standard', req.rush ?? false, req.deadlineDays) };
      } catch (err) {
        return { status: 400, body: { error: err instanceof Error ? err.message : 'คำนวณราคาไม่สำเร็จ' } };
      }
    }

    return { status: 404, body: { error: 'ไม่พบเส้นทางนี้' } };
  }

  return { handle, catalog };
}

export type PricingRouter = ReturnType<typeof createPricingRouter>;
