import fs from 'fs';
import path from 'path';

import {
  buildCanonicalCatalog,
} from '../src/rag/catalog-manifest.js';
import {
  buildIdentityReviewFromProducts,
} from '../src/rag/catalog-identity.js';

const pricingPath = path.resolve(
  process.env.SMARTGIFT_PRICING_CATALOG_JSON_PATH ||
    '../smartgift-pricing/public/catalog/giftset.json'
);
const configuredSemanticPath =
  process.env.SMARTGIFT_SEMANTIC_CATALOG_JSON_PATH ||
  'C:/Users/freshair/Downloads/catalog-2026.json';
const semanticPath = fs.existsSync(configuredSemanticPath)
  ? path.resolve(configuredSemanticPath)
  : undefined;
const outputPath = path.resolve(
  process.env.GENESIS_IDENTITY_REVIEW_PATH ||
    './data/catalog_identity_review_v1/identity-review.json'
);

const catalog = buildCanonicalCatalog({
  semanticPath,
  pricingPath,
});
const currentFamilyByOffer = new Map(
  catalog.families.flatMap((family) => family.offerIds.map((offerId) => [offerId, family.familyId] as const))
);
const review = buildIdentityReviewFromProducts(catalog.products, {
  snapshotId: catalog.manifest.snapshotId,
  sourceLineage: catalog.manifest.sources.map(
    (source) => `${source.role}:${source.sha256}`
  ),
  currentFamilyByOffer,
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
fs.renameSync(temporaryPath, outputPath);

console.log(
  JSON.stringify(
    {
      decision: 'review_only',
      outputPath,
      snapshotId: review.snapshotId,
      sourceRoles: catalog.manifest.sources.map((source) => source.role),
      counts: review.counts,
      statusCounts: {
        auto: review.counts.autoAtomicProductCount,
        review_required: review.counts.reviewRequiredAtomicProductCount,
        unclassified: review.counts.unclassifiedAtomicProductCount,
      },
      graph: {
        nodeCount: review.graph.nodes.length,
        edgeCount: review.graph.edges.length,
      },
      activeRuntimeChanged: false,
      familyV2Changed: false,
    },
    null,
    2
  )
);
