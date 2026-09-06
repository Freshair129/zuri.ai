import path from 'node:path';

import { buildCanonicalCatalog } from '../src/rag/catalog-manifest.js';
import { materializeTaxonomyProjection } from '../src/rag/taxonomy-projection-store.js';

const pricingPath =
  process.env.SMARTGIFT_PRICING_CATALOG_JSON_PATH ||
  path.resolve('../smartgift-pricing/public/catalog/giftset.json');
const storePath =
  process.env.GENESIS_TAXONOMY_PROJECTION_STORE_PATH ||
  path.resolve('data/genesis_smartgift_store_taxonomy_v3');

async function main(): Promise<void> {
  const catalog = buildCanonicalCatalog({ pricingPath });
  const result = await materializeTaxonomyProjection({ catalog, storePath });
  console.log(
    JSON.stringify(
      {
        decision: result.decision,
        storePath,
        snapshotId: result.manifest.catalogSnapshotId,
        projectionVersion: result.manifest.projectionVersion,
        status: result.manifest.status,
        activated: result.manifest.activated,
        counts: result.manifest.counts,
        taxonomyStatusCounts: result.manifest.taxonomyStatusCounts,
        mergeReviewByTaxonomyStatus: result.manifest.mergeReviewByTaxonomyStatus,
        vector: result.manifest.vector,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Taxonomy projection failed');
  process.exitCode = 1;
});
