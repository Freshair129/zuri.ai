import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideTaxonomyProjectionIngest,
  readTaxonomyProjectionManifest,
  writeTaxonomyProjectionManifest,
  type TaxonomyProjectionManifest,
} from '../../src/rag/taxonomy-projection-store.js';

// @tested TAX-NFR-002 — a changed snapshot is refused rather than overwritten.

function fixtureManifest(snapshotId: string): TaxonomyProjectionManifest {
  return {
    schemaVersion: 1,
    projectionVersion: 'taxonomy-v3-projection-v1',
    catalogSnapshotId: snapshotId,
    taxonomyRuleVersion: 'taxonomy-p0-v1',
    reviewReportVersion: 'taxonomy-review-v1',
    status: 'proposed',
    promotionPolicy: 'visible_no_promotion',
    activated: false,
    sourceLineage: [],
    counts: {
      candidateCategoryCount: 0,
      approvedBaseCategoryCount: 0,
      familyCount: 0,
      variantCount: 0,
      offerCount: 0,
      candidateCategoryEdgeCount: 0,
      approvedCategoryEdgeCount: 0,
      nodeCount: 0,
      edgeCount: 0,
    },
    taxonomyStatusCounts: { auto: 0, review_required: 0, unclassified: 0 },
    mergeReviewByTaxonomyStatus: { auto: 0, review_required: 0, unclassified: 0 },
    vector: { status: 'not_built', dimension: null, count: 0 },
  };
}

describe('Genesis taxonomy projection store lifecycle', () => {
  it('is idempotent and fails closed on snapshot drift or legacy materialized data', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-taxonomy-projection-'));
    const manifestPath = path.join(root, 'taxonomy-manifest.json');
    try {
      assert.equal(
        decideTaxonomyProjectionIngest(root, null, 'snapshot-a'),
        'ingest_empty_store'
      );

      const manifest = fixtureManifest('snapshot-a');
      writeTaxonomyProjectionManifest(manifestPath, manifest);
      assert.deepEqual(readTaxonomyProjectionManifest(manifestPath), manifest);
      assert.equal(
        decideTaxonomyProjectionIngest(root, manifest, 'snapshot-a'),
        'skip_same_snapshot'
      );
      assert.equal(
        decideTaxonomyProjectionIngest(root, manifest, 'snapshot-b'),
        'snapshot_changed'
      );

      const legacyRoot = path.join(root, 'legacy');
      fs.mkdirSync(legacyRoot);
      fs.writeFileSync(path.join(legacyRoot, 'nodes.bin'), 'materialized');
      assert.equal(
        decideTaxonomyProjectionIngest(legacyRoot, null, 'snapshot-a'),
        'legacy_unmanifested'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
