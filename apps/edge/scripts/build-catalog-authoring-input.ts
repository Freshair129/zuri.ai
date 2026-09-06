import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { buildCanonicalCatalog } from '../src/rag/catalog-manifest.js';

type JsonObject = Record<string, unknown>;

const pricingPath = path.resolve(
  process.env.SMARTGIFT_PRICING_CATALOG_JSON_PATH ||
    '../smartgift-pricing/public/catalog/giftset.json'
);
const semanticPath = path.resolve(
  process.env.SMARTGIFT_SEMANTIC_CATALOG_JSON_PATH ||
    'C:/Users/freshair/Downloads/catalog-2026.json'
);
const baselinePath = path.resolve(
  process.env.GENESIS_IDENTITY_REVIEW_PATH ||
    './data/catalog_identity_review_v1/identity-review.json'
);
const outputPath = path.resolve(
  process.env.GENESIS_AUTHORING_INPUT_PATH ||
    './data/catalog_vector_benchmark_round1_v1/authoring-input-round1.json'
);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as JsonObject;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex').toUpperCase();
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

const catalog = buildCanonicalCatalog({ pricingPath, semanticPath });
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as {
  snapshotId: string;
  productMasters: Array<{
    productId: string;
    displayName: string;
    status: string;
    componentSignature: string | null;
    offerIds: string[];
    reviewReasons: string[];
  }>;
};
const productByOffer = new Map(catalog.products.map((product) => [product.offerId, product]));
const records = baseline.productMasters
  .filter((product) => product.status === 'unclassified')
  .sort((left, right) => left.productId.localeCompare(right.productId))
  .map((product) => ({
    productId: product.productId,
    displayName: product.displayName,
    baselineStatus: product.status,
    componentSignature: product.componentSignature,
    reviewReasons: product.reviewReasons,
    offers: product.offerIds
      .map((offerId) => productByOffer.get(offerId))
      .filter((offer): offer is NonNullable<typeof offer> => Boolean(offer))
      .sort((left, right) => left.offerId.localeCompare(right.offerId))
      .map((offer) => ({
        offerId: offer.offerId,
        sourceCode: offer.code,
        name: offer.name,
        englishName: offer.englishName,
        description: offer.description,
        category: offer.category,
        branding: offer.branding,
        sourceRefs: offer.sourceRefs,
        dims: offer.dims,
        kg: offer.kg,
        electrical: offer.e,
      })),
  }));

const sourceManifest = catalog.manifest.sources
  .map((source) => ({
    role: source.role,
    sha256: source.sha256,
    recordCount: source.recordCount,
    uniqueCodeCount: source.uniqueCodeCount,
  }))
  .sort((left, right) => left.role.localeCompare(right.role));
const datasetFingerprint = hash({
  schemaVersion: 1,
  canonicalizationVersion: 'catalog-family-v1',
  sources: sourceManifest,
  canonicalOfferIds: catalog.products.map((product) => product.offerId).sort(),
});
const payload = {
  schemaVersion: 1,
  inputId: `AINPUT1_${hash({ datasetFingerprint, baselineSnapshotId: baseline.snapshotId, records }).slice(0, 20)}`,
  datasetId: `DS1_SMARTGIFT_${datasetFingerprint.slice(0, 20)}`,
  sourceSnapshotId: baseline.snapshotId,
  sourceManifest,
  scope: 'baseline_unclassified_product_masters',
  count: records.length,
  records,
};

writeAtomic(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  inputId: payload.inputId,
  datasetId: payload.datasetId,
  sourceSnapshotId: payload.sourceSnapshotId,
  count: payload.count,
  sha256: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').toUpperCase(),
}, null, 2));
