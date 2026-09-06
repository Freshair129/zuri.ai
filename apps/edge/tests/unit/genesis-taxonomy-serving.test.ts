import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildCanonicalCatalog } from '../../src/rag/catalog-manifest.js';
import { buildTaxonomyProjection } from '../../src/rag/taxonomy-projection.js';
import { buildTaxonomyReviewReport } from '../../src/rag/taxonomy-report.js';
import {
  serveTaxonomyPreview,
  type TaxonomyServingQueryInput,
} from '../../src/rag/taxonomy-serving.js';

// @tested RAG-GR-003 — the served projection declares its status and never implies an approved graph.
// @tested TAX-NFR-003 — snapshot and taxonomy provenance travel with the served counts.

function fixtureRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-taxonomy-serving-'));
}

function fixtureCatalog() {
  const root = fixtureRoot();
  const semanticPath = path.join(root, 'semantic.json');
  const pricingPath = path.join(root, 'pricing.json');
  fs.writeFileSync(
    semanticPath,
    JSON.stringify([
      { code: 'MUG-1', name: 'Mug + Pen', englishName: 'Mug + Pen' },
      { code: 'USB-1', name: 'USB Flash Drive', englishName: 'USB Flash Drive' },
      { code: 'UMB-1', name: 'Umbrella', englishName: 'Umbrella' },
      { code: 'AMB-1', name: 'Mug & Pen', englishName: 'Mug & Pen' },
      { code: 'UNK-1', name: 'Special Gift', englishName: 'Special Gift' },
    ])
  );
  fs.writeFileSync(
    pricingPath,
    JSON.stringify({
      products: [
        { code: 'MUG-1', name: 'Mug + Pen', rmb: 1 },
        { code: 'USB-1', name: 'USB Flash Drive', rmb: 2 },
        { code: 'UMB-1', name: 'Umbrella', rmb: 3 },
        { code: 'AMB-1', name: 'Mug & Pen', rmb: 4 },
        { code: 'UNK-1', name: 'Special Gift', rmb: 5 },
      ],
    })
  );
  return {
    root,
    catalog: buildCanonicalCatalog({ semanticPath, pricingPath }),
  };
}

function preview(
  input: TaxonomyServingQueryInput,
  options: { includeReview?: boolean } = {}
) {
  const fixture = fixtureCatalog();
  try {
    const report = buildTaxonomyReviewReport(fixture.catalog);
    const projection = buildTaxonomyProjection(fixture.catalog, report);
    return serveTaxonomyPreview(fixture.catalog, report, projection.manifest, {
      includeReview: options.includeReview,
      ...input,
    });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

describe('Genesis taxonomy read-only serving', () => {
  it('returns a bounded preview with separate projection and match counts', () => {
    const result = preview({ categoryId: 'drinkware', limit: 10 });

    assert.equal(result.servingVersion, 'taxonomy-serving-v1');
    assert.equal(result.mode, 'preview');
    assert.equal(result.authority, 'non_authoritative');
    assert.equal(result.projectionStatus, 'proposed');
    assert.equal(result.activated, false);
    assert.equal(result.projectionCounts.approvedCategoryCount, 0);
    assert.equal(result.projectionCounts.familyCount, 5);
    assert.equal(result.projectionCounts.variantCount, 5);
    assert.equal(result.projectionCounts.offerCount, 5);
    assert.equal(result.matchCounts.matchedFamilyCount, 2);
    assert.equal(result.matchCounts.matchedBundleFamilyCount, 2);
    assert.equal(result.results[0].sourceCodes.includes('AMB-1'), true);
    assert.equal('rmb' in result.results[0], false);
    assert.equal('path' in result.sourceLineage[0], false);
  });

  it('prioritizes exact offer/code lookup and preserves provenance', () => {
    const result = preview({ query: 'usb-1', limit: 5 });

    assert.equal(result.results[0].matchType, 'exact_code');
    assert.equal(result.results[0].sourceCodes[0], 'USB-1');
    assert.equal(result.results[0].offers[0].offerId, 'OFFER_USB-1');
    assert.deepEqual(result.results[0].offers[0].sourceRefs, ['semantic', 'pricing']);
  });

  it('supports explicit Thai query aliases without changing canonical evidence', () => {
    const drinkware = preview({ query: 'แก้ว', limit: 5 }, { includeReview: false });
    const umbrella = preview({ query: 'ร่ม', limit: 5 }, { includeReview: false });

    assert.equal(drinkware.results.length > 0, true);
    assert.equal(drinkware.results.every((item) => item.candidateCategoryIds.includes('drinkware')), true);
    assert.equal(umbrella.results.length > 0, true);
    assert.equal(umbrella.results.every((item) => item.candidateCategoryIds.includes('umbrella')), true);
    assert.equal(drinkware.queryAliasVersion, 'taxonomy-query-alias-v1');
    assert.equal(drinkware.taxonomyRuleVersion, 'taxonomy-p0-v1');
    assert.equal(drinkware.projectionCounts.approvedCategoryCount, 0);
  });

  it('keeps review and unclassified rows visible by default and supports safe exclusion', () => {
    const result = preview({ query: 'gift', limit: 10 });
    assert.equal(result.results.some((item) => item.taxonomyStatus === 'unclassified'), true);

    const classifiedOnly = preview({ query: 'gift', limit: 10 }, { includeReview: false });
    assert.equal(classifiedOnly.results.every((item) => item.taxonomyStatus === 'auto'), true);
  });

  it('rejects unbounded or empty retrieval input', () => {
    assert.throws(
      () => preview({ limit: 5 }),
      /TAXONOMY_QUERY_INVALID/
    );
    assert.throws(
      () => preview({ query: 'mug', limit: 51 }),
      /TAXONOMY_QUERY_INVALID/
    );
  });

  it('refuses a projection manifest that drifts from the canonical snapshot', () => {
    const fixture = fixtureCatalog();
    try {
      const report = buildTaxonomyReviewReport(fixture.catalog);
      const projection = buildTaxonomyProjection(fixture.catalog, report);
      assert.throws(
        () =>
          serveTaxonomyPreview(
            fixture.catalog,
            report,
            { ...projection.manifest, catalogSnapshotId: 'different-snapshot' },
            { query: 'mug' }
          ),
        /TAXONOMY_PROJECTION_UNAVAILABLE/
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
