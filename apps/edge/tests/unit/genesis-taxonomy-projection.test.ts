import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  CanonicalCatalog,
  CatalogManifest,
} from '../../src/rag/catalog-manifest.js';
import {
  buildTaxonomyProjection,
  TAXONOMY_PROJECTION_VERSION,
} from '../../src/rag/taxonomy-projection.js';

// @tested TAX-FR-005 — the versioned side-by-side projection.
// @tested RAG-GR-004 — offer, category, node and edge counts are exposed and verifiable.

function fixtureCatalog(): CanonicalCatalog {
  const manifest: CatalogManifest = {
    schemaVersion: 2,
    snapshotId: 'snapshot-projection-test',
    generatedAt: '2026-08-23T00:00:00.000Z',
    sources: [
      {
        role: 'pricing',
        path: 'D:/fixtures/giftset.json',
        sha256: 'source-sha',
        recordCount: 4,
        uniqueCodeCount: 4,
        duplicateCodes: [],
        exactDuplicateCodes: [],
        conflictingDuplicateCodes: [],
        duplicateRowCount: 0,
      },
    ],
    productCount: 3,
    familyCount: 3,
    variantCount: 4,
    offerCount: 4,
    duplicateSourceRowCount: 0,
    conflictingSourceCodeCount: 0,
    reviewFamilyCount: 1,
    graph: {
      productNodeCount: 3,
      familyNodeCount: 3,
      variantNodeCount: 4,
      offerNodeCount: 4,
      categoryNodeCount: 0,
      edgeCount: 8,
    },
    vector: {
      status: 'not_built',
      dimension: null,
      count: 0,
    },
  };

  return {
    products: [
      {
        offerId: 'OFFER_P-1',
        code: 'P-1',
        name: 'Coffee Mug',
        englishName: null,
        description: null,
        category: null,
        branding: [],
        mode: 'quote',
        moq: null,
        tiers: null,
        visual: null,
        rmb: 1,
        upc: 1,
        dims: null,
        kg: null,
        e: false,
        img: null,
        sourceRowCount: 1,
        duplicateSourceRows: 0,
        sourceRefs: ['pricing'],
        sourceNames: { semantic: null, pricing: 'Coffee Mug' },
      },
      {
        offerId: 'OFFER_P-2',
        code: 'P-2',
        name: 'World Cup Series: Power bank + Fan',
        englishName: null,
        description: null,
        category: null,
        branding: [],
        mode: 'quote',
        moq: null,
        tiers: null,
        visual: null,
        rmb: 1,
        upc: 1,
        dims: null,
        kg: null,
        e: false,
        img: null,
        sourceRowCount: 1,
        duplicateSourceRows: 0,
        sourceRefs: ['pricing'],
        sourceNames: { semantic: null, pricing: 'World Cup Series: Power bank + Fan' },
      },
      {
        offerId: 'OFFER_P-3',
        code: 'P-3',
        name: 'World Cup Series: Power bank + Fan',
        englishName: null,
        description: null,
        category: null,
        branding: [],
        mode: 'quote',
        moq: null,
        tiers: null,
        visual: null,
        rmb: 1,
        upc: 1,
        dims: null,
        kg: null,
        e: false,
        img: null,
        sourceRowCount: 1,
        duplicateSourceRows: 0,
        sourceRefs: ['pricing'],
        sourceNames: { semantic: null, pricing: 'World Cup Series: Power bank + Fan' },
      },
      {
        offerId: 'OFFER_P-4',
        code: 'P-4',
        name: 'Mystery item',
        englishName: null,
        description: null,
        category: null,
        branding: [],
        mode: 'quote',
        moq: null,
        tiers: null,
        visual: null,
        rmb: 1,
        upc: 1,
        dims: null,
        kg: null,
        e: false,
        img: null,
        sourceRowCount: 1,
        duplicateSourceRows: 0,
        sourceRefs: ['pricing'],
        sourceNames: { semantic: null, pricing: 'Mystery item' },
      },
    ],
    families: [
      {
        familyId: 'FAMILY_A',
        normalizedName: 'coffee mug',
        name: 'Coffee Mug',
        englishName: null,
        category: null,
        branding: [],
        mergeStatus: 'auto_merged',
        sourceRefs: ['pricing'],
        sourceCodes: ['P-1'],
        offerIds: ['OFFER_P-1'],
        variantIds: ['VARIANT_P-1'],
      },
      {
        familyId: 'FAMILY_B',
        normalizedName: 'world cup series: power bank + fan',
        name: 'World Cup Series: Power bank + Fan',
        englishName: null,
        category: null,
        branding: [],
        mergeStatus: 'review_required',
        sourceRefs: ['pricing'],
        sourceCodes: ['P-2', 'P-3'],
        offerIds: ['OFFER_P-2', 'OFFER_P-3'],
        variantIds: ['VARIANT_P-2', 'VARIANT_P-3'],
      },
      {
        familyId: 'FAMILY_C',
        normalizedName: 'mystery item',
        name: 'Mystery item',
        englishName: null,
        category: null,
        branding: [],
        mergeStatus: 'auto_merged',
        sourceRefs: ['pricing'],
        sourceCodes: ['P-4'],
        offerIds: ['OFFER_P-4'],
        variantIds: ['VARIANT_P-4'],
      },
    ],
    variants: [
      ...['P-1', 'P-2', 'P-3', 'P-4'].map((code) => ({
        variantId: `VARIANT_${code}`,
        familyId: code === 'P-1' ? 'FAMILY_A' : code === 'P-4' ? 'FAMILY_C' : 'FAMILY_B',
        status: code === 'P-2' || code === 'P-3' ? ('review_required' as const) : ('candidate' as const),
        offerIds: [`OFFER_${code}`],
        sourceCodes: [code],
        attributes: { color: null, size: null, material: null, packaging: null },
      })),
    ],
    offers: ['P-1', 'P-2', 'P-3', 'P-4'].map((code) => ({
      offerId: `OFFER_${code}`,
      sourceCode: code,
      sourceRefs: ['pricing' as const],
      sourceRowCount: 1,
      duplicateSourceRows: 0,
    })),
    manifest,
  };
}

describe('Genesis taxonomy projection', () => {
  it('builds deterministic candidate graph evidence without authoritative category edges', () => {
    const first = buildTaxonomyProjection(fixtureCatalog());
    const second = buildTaxonomyProjection(fixtureCatalog());

    assert.deepEqual(second, first);
    assert.equal(first.manifest.projectionVersion, TAXONOMY_PROJECTION_VERSION);
    assert.equal(first.manifest.status, 'proposed');
    assert.equal(first.manifest.activated, false);
    assert.equal(first.manifest.catalogSnapshotId, 'snapshot-projection-test');
    assert.deepEqual(first.manifest.counts, {
      candidateCategoryCount: 3,
      approvedBaseCategoryCount: 0,
      familyCount: 3,
      variantCount: 4,
      offerCount: 4,
      candidateCategoryEdgeCount: 3,
      approvedCategoryEdgeCount: 0,
      nodeCount: 14,
      edgeCount: 11,
    });
    assert.equal(first.nodes.filter((node) => node.labels.includes('Category')).length, 3);
    assert.equal(first.nodes.filter((node) => node.labels.includes('ProductFamily')).length, 3);
    assert.equal(first.edges.filter((edge) => edge.rel === 'CANDIDATE_CATEGORY').length, 3);
    assert.equal(first.edges.filter((edge) => edge.rel === 'BELONGS_TO_CATEGORY').length, 0);
    assert.equal(first.edges.some((edge) => edge.from === 'FAMILY_C' && edge.rel === 'CANDIDATE_CATEGORY'), false);

    const candidateEdge = first.edges.find((edge) => edge.rel === 'CANDIDATE_CATEGORY');
    assert.deepEqual(candidateEdge?.props, {
      taxonomyStatus: 'auto',
      ruleVersion: 'taxonomy-p0-v1',
      reportVersion: 'taxonomy-review-v1',
      snapshotId: 'snapshot-projection-test',
    });
  });
});
