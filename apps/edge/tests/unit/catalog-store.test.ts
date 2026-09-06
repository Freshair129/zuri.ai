// Contract for the extracted factory-catalog loader that the pricing and answer layers read.
//
// Everything downstream — a quote, a card, an answer about a product — resolves through this store,
// so the properties that matter are the boring ones: a missing directory must not throw, a code
// must resolve regardless of how it was typed, and a product with an unreadable price must be
// visibly unquotable rather than quietly priced at zero.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadCatalog, findByCode, searchByName, isQuotable } from '../../src/catalog/store.js';

// @tested SDD-016 — the catalog store the pricing and answer layers read.

const product = (over: Record<string, unknown> = {}) => ({
  code: 'A-100',
  name: 'ร่มพับ 3 ตอน',
  rmb: 12.5,
  upc: 60,
  dims: [50, 40, 30],
  kg: 12,
  e: false,
  ...over,
});

function withCatalog(books: Record<string, unknown>, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
  try {
    for (const [file, body] of Object.entries(books)) {
      fs.writeFileSync(path.join(root, file), JSON.stringify(body));
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('catalog store', () => {
  it('loads every book and stamps each product with the book it came from', () => {
    withCatalog(
      {
        'book-a.json': { label: 'Book A', products: [product()] },
        'book-b.json': { label: 'Book B', products: [product({ code: 'B-200' })] },
      },
      (root) => {
        const catalog = loadCatalog(root);
        assert.strictEqual(catalog.products.length, 2);
        const a = findByCode(catalog, 'A-100');
        assert.strictEqual(a?.book, 'Book A');
        // bookKey is what the thumbnail path is built from, so it follows the filename, not the label.
        assert.strictEqual(a?.bookKey, 'book-a');
      }
    );
  });

  it('falls back to the filename when a book states no label', () => {
    withCatalog({ 'unlabelled.json': { products: [product()] } }, (root) => {
      assert.strictEqual(findByCode(loadCatalog(root), 'A-100')?.book, 'unlabelled');
    });
  });

  it('resolves a code regardless of case or surrounding whitespace', () => {
    withCatalog({ 'b.json': { label: 'B', products: [product()] } }, (root) => {
      const catalog = loadCatalog(root);
      for (const typed of ['A-100', 'a-100', '  a-100  ']) {
        assert.ok(findByCode(catalog, typed), `${JSON.stringify(typed)} did not resolve`);
      }
      assert.strictEqual(findByCode(catalog, 'A-999'), null);
    });
  });

  it('returns an empty catalog for a directory that is not there, rather than throwing', () => {
    const catalog = loadCatalog(path.join(os.tmpdir(), 'catalog-does-not-exist-' + Date.now()));
    assert.deepStrictEqual(catalog.products, []);
    assert.strictEqual(catalog.byCode.size, 0);
  });

  it('ignores files that are not books', () => {
    withCatalog({ 'b.json': { label: 'B', products: [product()] } }, (root) => {
      fs.writeFileSync(path.join(root, 'notes.txt'), 'not a catalog');
      assert.strictEqual(loadCatalog(root).products.length, 1);
    });
  });

  it('narrows as terms are added, which is what a person typing a second word expects', () => {
    withCatalog(
      {
        'b.json': {
          label: 'B',
          products: [
            product({ code: 'A-100', name: 'ร่มพับ สีดำ' }),
            product({ code: 'A-101', name: 'ร่มยาว สีดำ' }),
          ],
        },
      },
      (root) => {
        const catalog = loadCatalog(root);
        assert.strictEqual(searchByName(catalog, 'สีดำ').length, 2);
        assert.strictEqual(searchByName(catalog, 'ร่มพับ สีดำ').length, 1);
        // A term shorter than two characters carries no signal and must not widen the result.
        assert.deepStrictEqual(searchByName(catalog, 'ก'), []);
      }
    );
  });

  it('honours the result limit', () => {
    withCatalog(
      {
        'b.json': {
          label: 'B',
          products: Array.from({ length: 12 }, (_, i) =>
            product({ code: `A-${100 + i}`, name: 'umbrella black' })
          ),
        },
      },
      (root) => {
        assert.strictEqual(searchByName(loadCatalog(root), 'umbrella').length, 8);
        assert.strictEqual(searchByName(loadCatalog(root), 'umbrella', 3).length, 3);
      }
    );
  });

  it('calls a product unquotable when cost or packing is unknown, rather than pricing a guess', () => {
    assert.ok(isQuotable(product() as never));
    for (const missing of [{ rmb: null }, { upc: null }, { dims: null }]) {
      assert.ok(!isQuotable(product(missing) as never), JSON.stringify(missing));
    }
  });
});
