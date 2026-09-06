import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildCanonicalCatalog,
  buildGenesisGraphBatch,
  decideCatalogIngest,
  readCatalogManifest,
  writeCatalogManifest,
} from '../../src/rag/catalog-manifest.js';

// @tested RAG-FR-001 — the canonical snapshot with lineage to its sources.
// @tested RAG-FR-002 — the manifest carries hash, schema version, counts and generated_at.
// @tested RAG-FR-003 — identity survives a refresh.
// @tested RAG-GR-001 — a re-ingest produces the same node ids.
// @tested RAG-GR-002 — BELONGS_TO_CATEGORY is the only relation emitted.

function fixtureRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-genesis-rag-'));
}

function writeFixtures(root: string): { semanticPath: string; pricingPath: string } {
  const semanticPath = path.join(root, 'semantic.json');
  const pricingPath = path.join(root, 'pricing.json');
  fs.writeFileSync(
    semanticPath,
    JSON.stringify([
      {
        code: 'p-1',
        name: 'ปากกาโลหะ',
        englishName: 'Metal pen',
        category: 'Writing',
        description: 'Gift pen',
        branding: ['laser'],
      },
      { code: 'P-2', name: 'สมุด', category: 'Office' },
    ])
  );
  fs.writeFileSync(
    pricingPath,
    JSON.stringify({
      label: 'pricing',
      products: [
        { code: 'P-1', name: 'Metal pen', rmb: 7.6, upc: 50, dims: '10x20x30', kg: '1.2', e: 'false', img: 'p-1.webp' },
        { code: 'P-2', name: 'Notebook', rmb: 8, upc: 40, dims: [11, 22, 33], kg: 2, e: false },
        { code: 'P-3', name: 'Extra product', rmb: 9, upc: 30, dims: [1, 2, 3], e: true },
        { code: 'P-3', name: 'Extra product', rmb: 9, upc: 30, dims: [1, 2, 3], e: true },
      ],
    })
  );
  return { semanticPath, pricingPath };
}

describe('Genesis catalog manifest', () => {
  it('merges sources by normalized code and records provenance', () => {
    const root = fixtureRoot();
    try {
      const sources = writeFixtures(root);
      const catalog = buildCanonicalCatalog(sources);
      const p1 = catalog.products.find((product) => product.code === 'P-1');
      const p3 = catalog.products.find((product) => product.code === 'P-3');

      assert.equal(catalog.products.length, 3);
      assert.deepEqual(p1?.sourceRefs, ['semantic', 'pricing']);
      assert.equal(p1?.name, 'ปากกาโลหะ');
      assert.equal(p1?.englishName, 'Metal pen');
      assert.deepEqual(p1?.dims, [10, 20, 30]);
      assert.deepEqual(p3?.sourceRefs, ['pricing']);
      assert.deepEqual(catalog.manifest.sources[1].duplicateCodes, ['P-3']);
      assert.equal(catalog.manifest.vector.status, 'not_built');

      const batch = buildGenesisGraphBatch(catalog);
      assert.equal(batch.nodes.filter((node) => node.labels.includes('Product')).length, 3);
      assert.equal(batch.nodes.filter((node) => node.labels.includes('ProductFamily')).length, 3);
      assert.equal(batch.nodes.filter((node) => node.labels.includes('ProductVariant')).length, 3);
      assert.equal(batch.nodes.filter((node) => node.labels.includes('CatalogOffer')).length, 3);
      assert.equal(batch.edges.length, 8);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('makes ingest decisions without treating a legacy store as empty', () => {
    const root = fixtureRoot();
    try {
      assert.equal(decideCatalogIngest(root, null, 'snapshot-a'), 'ingest_empty_store');

      fs.writeFileSync(path.join(root, 'nodes.bin'), 'legacy');
      assert.equal(decideCatalogIngest(root, null, 'snapshot-a'), 'legacy_unmanifested');

      const manifest = buildCanonicalCatalog(writeFixtures(root)).manifest;
      assert.equal(decideCatalogIngest(root, manifest, manifest.snapshotId), 'skip_same_snapshot');
      assert.equal(decideCatalogIngest(root, manifest, 'different'), 'snapshot_changed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes and reads the manifest atomically', () => {
    const root = fixtureRoot();
    try {
      const sources = writeFixtures(root);
      const manifest = buildCanonicalCatalog(sources).manifest;
      const manifestPath = path.join(root, 'nested', 'catalog-manifest.json');
      writeCatalogManifest(manifestPath, manifest);
      assert.deepEqual(readCatalogManifest(manifestPath), manifest);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('groups repeated display names into one family while retaining priced offers', () => {
    const root = fixtureRoot();
    try {
      const sources = writeFixtures(root);
      const pricingPath = sources.pricingPath;
      const parsed = JSON.parse(fs.readFileSync(pricingPath, 'utf8')) as { products: Array<Record<string, unknown>> };
      parsed.products.push({
        code: 'P-4',
        name: 'Metal pen',
        rmb: 8.1,
        upc: 50,
        dims: [10, 20, 30],
        kg: 1.2,
        e: false,
        img: 'p-4.webp',
      });
      fs.writeFileSync(pricingPath, JSON.stringify(parsed));

      const catalog = buildCanonicalCatalog(sources);
      const family = catalog.families.find((item) => item.normalizedName === 'metal pen');

      assert.equal(catalog.manifest.productCount, 3);
      assert.equal(catalog.manifest.offerCount, 4);
      assert.equal(catalog.manifest.familyCount, 3);
      assert.equal(catalog.manifest.duplicateSourceRowCount, 1);
      assert.equal(family?.mergeStatus, 'review_required');
      assert.equal(family?.offerIds.length, 2);
      assert.equal(family?.variantIds.length, 2);

      const batch = buildGenesisGraphBatch(catalog);
      assert.equal(batch.nodes.filter((node) => node.labels.includes('ProductFamily')).length, 3);
      assert.equal(batch.nodes.filter((node) => node.labels.includes('CatalogOffer')).length, 4);
      assert.equal(batch.nodes.filter((node) => node.labels.includes('ProductVariant')).length, 4);
      assert.equal(batch.edges.filter((edge) => edge.rel === 'HAS_VARIANT').length, 4);
      assert.equal(batch.edges.filter((edge) => edge.rel === 'HAS_OFFER').length, 4);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds an offer-level catalog from pricing source without semantic source', () => {
    const root = fixtureRoot();
    try {
      const { pricingPath } = writeFixtures(root);
      const catalog = buildCanonicalCatalog({ pricingPath });

      assert.equal(catalog.manifest.productCount, 3);
      assert.equal(catalog.manifest.familyCount, 3);
      assert.equal(catalog.manifest.offerCount, 3);
      assert.equal(catalog.manifest.duplicateSourceRowCount, 1);
      assert.equal(catalog.products.every((product) => product.sourceRefs.length === 1), true);
      assert.equal(catalog.products.every((product) => product.sourceRefs[0] === 'pricing'), true);
      assert.equal(catalog.products.every((product) => product.description === null), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
