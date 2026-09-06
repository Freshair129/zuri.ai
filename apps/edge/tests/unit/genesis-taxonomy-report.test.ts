import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  CanonicalCatalog,
  CatalogManifest,
} from '../../src/rag/catalog-manifest.js';
import {
  buildTaxonomyReviewReport,
  summarizeTaxonomyReviewReport,
} from '../../src/rag/taxonomy-report.js';

// @tested TAX-FR-004 — the review report over current, unmatched and conflicting families.

function fixtureCatalog(): CanonicalCatalog {
  const manifest: CatalogManifest = {
    schemaVersion: 2,
    snapshotId: 'snapshot-test',
    generatedAt: '2026-08-23T00:00:00.000Z',
    sources: [
      {
        role: 'pricing',
        path: 'D:/fixtures/giftset.json',
        sha256: 'source-sha',
        recordCount: 4,
        uniqueCodeCount: 3,
        duplicateCodes: ['P-3'],
        exactDuplicateCodes: ['P-3'],
        conflictingDuplicateCodes: [],
        duplicateRowCount: 1,
      },
    ],
    productCount: 3,
    familyCount: 3,
    variantCount: 4,
    offerCount: 4,
    duplicateSourceRowCount: 1,
    conflictingSourceCodeCount: 0,
    reviewFamilyCount: 1,
    graph: {
      productNodeCount: 3,
      familyNodeCount: 3,
      variantNodeCount: 4,
      offerNodeCount: 4,
      categoryNodeCount: 0,
      edgeCount: 7,
    },
    vector: {
      status: 'not_built',
      dimension: null,
      count: 0,
    },
  };

  return {
    products: [],
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
    variants: [],
    offers: [],
    manifest,
  };
}

describe('Genesis taxonomy review report', () => {
  it('builds deterministic family-level counts, evidence, and unresolved policy', () => {
    const first = buildTaxonomyReviewReport(fixtureCatalog());
    const second = buildTaxonomyReviewReport(fixtureCatalog());

    assert.deepEqual(second, first);
    assert.equal(first.reportVersion, 'taxonomy-review-v1');
    assert.equal(first.status, 'proposed');
    assert.equal(first.unresolvedPolicy, 'visible_no_promotion');
    assert.equal(first.snapshotId, 'snapshot-test');
    assert.deepEqual(first.sourceLineage[0], {
      role: 'pricing',
      path: 'D:/fixtures/giftset.json',
      sha256: 'source-sha',
      recordCount: 4,
      uniqueCodeCount: 3,
    });
    assert.deepEqual(first.counts, {
      candidateBaseCategoryCount: 3,
      approvedBaseCategoryCount: 0,
      productFamilyCount: 3,
      bundleFamilyCount: 1,
      variantCount: 4,
      offerCount: 4,
      mergeReviewFamilyCount: 1,
      mergeReviewByTaxonomyStatus: {
        auto: 0,
        review_required: 1,
        unclassified: 0,
      },
      taxonomyAutoFamilyCount: 1,
      taxonomyReviewRequiredFamilyCount: 1,
      unclassifiedFamilyCount: 1,
      unexplainedAutoAssignmentCount: 0,
    });
    assert.equal(first.families[0]?.familyId, 'FAMILY_A');
    assert.equal(first.families[0]?.assignment.status, 'auto');
    assert.equal(first.families[0]?.assignment.components[0]?.matchedAlias, 'coffee mug');
    assert.equal(first.families[2]?.assignment.status, 'unclassified');
  });

  it('produces an aggregate summary without row-level business names', () => {
    const summary = summarizeTaxonomyReviewReport(
      buildTaxonomyReviewReport(fixtureCatalog())
    );

    assert.deepEqual(summary, {
      reportVersion: 'taxonomy-review-v1',
      status: 'proposed',
      snapshotId: 'snapshot-test',
      ruleVersion: 'taxonomy-p0-v1',
      counts: {
        candidateBaseCategoryCount: 3,
        approvedBaseCategoryCount: 0,
        productFamilyCount: 3,
        bundleFamilyCount: 1,
        variantCount: 4,
        offerCount: 4,
        mergeReviewFamilyCount: 1,
        mergeReviewByTaxonomyStatus: {
          auto: 0,
          review_required: 1,
          unclassified: 0,
        },
        taxonomyAutoFamilyCount: 1,
        taxonomyReviewRequiredFamilyCount: 1,
        unclassifiedFamilyCount: 1,
        unexplainedAutoAssignmentCount: 0,
      },
      categoryCounts: {
        drinkware: 1,
        fan: 1,
        power_bank: 1,
      },
      reviewReasonCounts: {
        unmatched_component: 1,
        series_prefix: 1,
      },
    });
    assert.equal('families' in summary, false);
  });
});
