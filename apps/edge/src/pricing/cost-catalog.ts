import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { Catalog, CatalogProduct, isQuotable, loadCatalog } from '../catalog/store.js';
import { screenPositionsForItemCode } from './factory-terms.js';
import type { PricingInput } from './types.js';

/**
 * The factory cost catalog as an identified thing, rather than "whatever JSON happened to be in
 * that folder".
 *
 * Two facts have to travel with a quote for it to be checkable later: which catalog produced it
 * and whether that catalog has changed since. A sha256 over the catalog files answers both, and it
 * is cheap enough to compute at start-up for the whole range (1,088 products today).
 *
 * The files themselves stay under `state/`, which is git-ignored, because they carry the factory's
 * cost for every product SmartGift sells.
 */
export interface CostCatalogManifest {
  products: number;
  /** Products with cost *and* carton, i.e. the ones a price can actually be computed for. */
  quotable: number;
  /** sha256 over every catalog file, in name order — a changed cost changes this. */
  sha256: string;
  books: string[];
  root: string;
}

export interface CostCatalog extends Catalog {
  manifest: CostCatalogManifest;
}

function hashCatalogFiles(root: string): { sha256: string; books: string[] } {
  const hash = createHash('sha256');
  const books: string[] = [];
  if (!fs.existsSync(root)) return { sha256: hash.digest('hex'), books };
  for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.json')).sort()) {
    const raw = fs.readFileSync(path.join(root, file));
    hash.update(file).update(raw);
    try {
      const parsed = JSON.parse(raw.toString('utf8')) as { label?: string };
      books.push(parsed.label || file.replace(/\.json$/, ''));
    } catch {
      // A malformed file still contributes to the digest: the point of the hash is "did anything
      // change", and loadCatalog below is what decides whether it is usable.
      books.push(file.replace(/\.json$/, ''));
    }
  }
  return { sha256: hash.digest('hex'), books };
}

export function catalogManifestFor(catalog: CostCatalog): CostCatalogManifest {
  return catalog.manifest;
}

export function loadCostCatalog(root: string): CostCatalog {
  const catalog = loadCatalog(root);
  const { sha256, books } = hashCatalogFiles(root);
  return {
    ...catalog,
    manifest: {
      products: catalog.products.length,
      quotable: catalog.products.filter(isQuotable).length,
      sha256,
      books,
      root,
    },
  };
}

/** Carton volume in m³ from the catalog's centimetre dimensions, at the sheet's 4-decimal rule. */
export function cartonCbmFromDims(dims: [number, number, number]): number {
  const [l, w, h] = dims;
  return Math.round(((l * w * h) / 1e6) * 10000) / 10000;
}

export interface QuoteInputOverrides {
  exchangeRate?: number;
  shipMonth?: number;
  freight?: Partial<NonNullable<PricingInput['freight']>>;
  logo?: PricingInput['logo'];
  additionalUnitCostThb?: number;
  additionalOrderCostThb?: number;
  inlandChinaCostRmb?: number;
}

/**
 * The one mapping from a catalog row to a pricing input.
 *
 * It lives here, not in the LINE agent's tool file or in the HTTP service, because the moment two
 * callers each write their own version they start to disagree — which is exactly what happened
 * between the engine and the browser calculator (two "matching the engine" fixes in that repo's
 * history before this existed). Every caller that prices a *catalog* product goes through here.
 *
 * Defaults reproduce the agent's long-standing behaviour: freight mode `auto`, goods class from
 * the electrical flag, and screening positions derived from the item code.
 */
export function quoteInputForProduct(
  product: CatalogProduct,
  over: QuoteInputOverrides = {}
): PricingInput {
  const dims = product.dims as [number, number, number];
  return {
    sku: product.code,
    factoryCostRmb: product.rmb as number,
    exchangeRate: over.exchangeRate ?? 5,
    carton: {
      unitsPerCarton: product.upc as number,
      cartonCbm: cartonCbmFromDims(dims),
      ...(product.kg ? { cartonWeightKg: product.kg } : {}),
    },
    freight: {
      mode: 'auto' as const,
      shipMonth: over.shipMonth ?? new Date().getMonth() + 1,
      goodsClass: (product.e ? 'electronic_tisi' : 'general') as 'electronic_tisi' | 'general',
      ...(over.freight ?? {}),
    },
    logo: over.logo ?? { positions: screenPositionsForItemCode(product.code) },
    ...(over.additionalUnitCostThb !== undefined ? { additionalUnitCostThb: over.additionalUnitCostThb } : {}),
    ...(over.additionalOrderCostThb !== undefined ? { additionalOrderCostThb: over.additionalOrderCostThb } : {}),
    ...(over.inlandChinaCostRmb !== undefined ? { inlandChinaCostRmb: over.inlandChinaCostRmb } : {}),
  };
}

/** Why a catalog row cannot be priced, in the words the caller should show. */
export function missingPricingFacts(product: CatalogProduct): string[] {
  return [
    product.rmb === null ? 'ต้นทุนโรงงาน' : null,
    product.upc === null || product.dims === null ? 'ข้อมูลกล่อง' : null,
  ].filter(Boolean) as string[];
}
