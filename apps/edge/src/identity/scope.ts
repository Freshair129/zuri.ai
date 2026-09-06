import { PriceQuote } from '../pricing/index.js';
import { Role } from './registry.js';

/**
 * What each role is allowed to be told about a price.
 *
 * The sales team needs the number they quote a customer. They do not need the factory cost, the
 * markup multiple, or the margin — that is the whole commercial position of the business, and a
 * chat message is forwardable. Cutting it here, on the way out, means a formatting mistake
 * downstream cannot leak it: the fields are gone, not hidden.
 *
 * This mirrors how the dashboard enforces tab access — the HTML is stripped server-side rather
 * than covered with CSS.
 */

export interface ScopedBreak {
  quantity: number;
  unitPriceThb: number;
  /** Owner only. */
  landedUnitCostThb?: number;
  orderGrossProfitThb?: number;
  grossMarginPct?: number;
  basis?: string;
}

export interface ScopedQuote {
  sku: string;
  asOf: string;
  role: Role;
  breaks: ScopedBreak[];
  /** Owner only: the cost stack behind the price. */
  cost?: {
    factoryCostThb: number;
    inlandChinaCostThb: number;
    freightPerUnitThb: number;
    logoPerUnitThb: number;
    totalThb: number;
    markupFactor: number;
  };
  /** Conditions a salesperson still has to know about — never the commercial ones. */
  notes: string[];
}

/**
 * Which engine warnings a salesperson may see.
 *
 * An allow-list, not a block-list. The engine's warnings are written for whoever is tuning the
 * pricing model — they name freight legs, premiums and figures in THB per set — and a block-list
 * of forbidden words lets any newly-worded warning through. One did: "Inland China freight is
 * included at 10 THB per set" contains none of the obvious keywords and stated a cost outright.
 *
 * So nothing reaches sales unless it is added here deliberately. Empty today: every warning the
 * engine currently produces is about the cost model, and none of them is a fact a customer-facing
 * quote needs.
 */
const SALES_VISIBLE_NOTES: RegExp[] = [];

export function scopeQuote(quote: PriceQuote, role: Role): ScopedQuote {
  const owner = role === 'owner';

  return {
    sku: quote.sku,
    asOf: quote.asOf,
    role,
    breaks: quote.breaks.map((b) => ({
      quantity: b.quantity,
      unitPriceThb: b.unitPriceThb,
      ...(owner
        ? {
            landedUnitCostThb: b.landedUnitCostThb,
            orderGrossProfitThb: b.orderGrossProfitThb,
            grossMarginPct: b.grossMarginPct,
            basis: b.basis,
          }
        : {}),
    })),
    ...(owner
      ? {
          cost: {
            factoryCostThb: quote.anchorLandedUnitCost.factoryCostThb,
            inlandChinaCostThb: quote.anchorLandedUnitCost.inlandChinaCostThb,
            freightPerUnitThb: quote.anchorLandedUnitCost.freightPerUnitThb,
            logoPerUnitThb: quote.anchorLandedUnitCost.logoPerUnitThb,
            totalThb: quote.anchorLandedUnitCost.totalThb,
            markupFactor: quote.breaks[0]?.markupFactor ?? 0,
          },
        }
      : {}),
    notes: owner
      ? quote.warnings
      : quote.warnings.filter((w) => SALES_VISIBLE_NOTES.some((allowed) => allowed.test(w))),
  };
}

/** Render a scoped quote as the plain text a LINE reply carries. */
export function formatQuoteForLine(scoped: ScopedQuote, productName?: string): string {
  const head = productName ? `${scoped.sku} — ${productName}` : scoped.sku;
  const rows = scoped.breaks
    .map((b) => `${b.quantity} ชุด  ${b.unitPriceThb.toLocaleString('en-US')} บาท`)
    .join('\n');

  const lines = [head, '', 'ราคาต่อชุด', rows];

  if (scoped.cost) {
    lines.push(
      '',
      `ต้นทุนรวม ${scoped.cost.totalThb.toFixed(2)} บาท/ชุด`,
      `(โรงงาน ${scoped.cost.factoryCostThb.toFixed(2)} + ในจีน ${scoped.cost.inlandChinaCostThb} ` +
        `+ ขนส่ง ${scoped.cost.freightPerUnitThb.toFixed(2)} + สกรีน ${scoped.cost.logoPerUnitThb.toFixed(2)})`,
      `ตัวคูณ ${scoped.cost.markupFactor}`
    );
    const margins = scoped.breaks
      .filter((b) => b.grossMarginPct !== undefined)
      .map((b) => `${b.quantity} ชุด ${b.grossMarginPct}%`)
      .join(' · ');
    if (margins) lines.push(`margin ${margins}`);
  }

  if (scoped.notes.length) {
    lines.push('', 'ข้อควรทราบ', ...scoped.notes.map((n) => `• ${n}`));
  }

  lines.push('', `ที่มา SmartGift pricing engine · ${scoped.asOf.slice(0, 10)}`);
  return lines.join('\n');
}
