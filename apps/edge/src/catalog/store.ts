import fs from 'fs';
import path from 'path';

// @req SDD-016 — the catalog store: the extracted factory-catalog loader the pricing and answer layers read.

/**
 * The factory catalogs, as the agent sees them: item code, cost, carton, and whether the box has
 * anything electrical in it. Extracted once from the workbooks — the books themselves are hundreds
 * of megabytes of embedded photographs and have no business being read at question time.
 *
 * The files live under `state/`, which is git-ignored, because they carry factory costs for the
 * whole range.
 */

export interface CatalogProduct {
  code: string;
  name: string;
  /** Factory price in RMB per set. Null when the catalog row had no readable formula. */
  rmb: number | null;
  /** Sets per outer carton. Null for the older blocks, which state no packing at all. */
  upc: number | null;
  /** Carton dimensions in cm. */
  dims: [number, number, number] | null;
  kg: number | null;
  /** Electrical contents, which decides the freight class. */
  e: boolean;
  img?: string;
  /** Which catalog it came from — the human label. */
  book: string;
  /**
   * The catalog file's own name, without the extension. Thumbnails are filed under it
   * (`img/<bookKey>/<img>`), so a caller that only has the label cannot find the picture.
   */
  bookKey: string;
}

export interface Catalog {
  products: CatalogProduct[];
  byCode: Map<string, CatalogProduct>;
}

/** A product can only be priced when cost and carton are both known. */
export function isQuotable(p: CatalogProduct): boolean {
  return p.rmb !== null && p.upc !== null && p.dims !== null;
}

export function loadCatalog(root: string): Catalog {
  const products: CatalogProduct[] = [];
  if (fs.existsSync(root)) {
    for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.json'))) {
      const parsed = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as {
        label?: string;
        products?: Omit<CatalogProduct, 'book' | 'bookKey'>[];
      };
      const bookKey = file.replace(/\.json$/, '');
      const book = parsed.label || bookKey;
      for (const p of parsed.products || []) products.push({ ...p, book, bookKey });
    }
  }

  const byCode = new Map<string, CatalogProduct>();
  for (const p of products) byCode.set(p.code.toUpperCase(), p);
  return { products, byCode };
}

export function findByCode(catalog: Catalog, code: string): CatalogProduct | null {
  return catalog.byCode.get(code.trim().toUpperCase()) || null;
}

/**
 * Loose name search, for when someone types "ร่ม" rather than a code. Every term has to appear
 * somewhere in the code or the name, so adding words narrows rather than widens — which is what a
 * person expects when their first search returns too much.
 */
export function searchByName(catalog: Catalog, query: string, limit = 8): CatalogProduct[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  if (!terms.length) return [];
  return catalog.products
    .filter((p) => {
      const hay = `${p.code} ${p.name}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .slice(0, limit);
}
