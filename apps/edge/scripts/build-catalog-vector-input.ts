import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { buildCanonicalCatalog, type CanonicalCatalogProduct } from '../src/rag/catalog-manifest.js';

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
const ownerPath = path.resolve(
  process.env.GENESIS_USER_LOGIC_REVIEW_PATH ||
    './data/catalog_identity_review_user_logic_v1/identity-review.json'
);
const outputPath = path.resolve(
  process.env.GENESIS_VECTOR_INPUT_PATH ||
    './data/catalog_vector_benchmark_round1_v1/vector-input-round1.json'
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

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, content, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function normalizeText(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .replace(/[|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceRowIds(product: CanonicalCatalogProduct): string[] {
  return product.sourceRefs.flatMap((role) => {
    const count = role === 'semantic' ? 1 : Math.max(1, product.sourceRowCount - (product.sourceRefs.includes('semantic') ? 1 : 0));
    return Array.from({ length: count }, (_, index) =>
      `SRCROW_${role.toUpperCase()}_${hash({ role, index: index + 1, offerId: product.offerId, code: product.code, name: product.name, englishName: product.englishName, description: product.description, category: product.category, branding: product.branding }).slice(0, 20)}`
    );
  });
}

function productText(products: CanonicalCatalogProduct[]): string {
  return products
    .sort((left, right) => left.offerId.localeCompare(right.offerId))
    .map((product) => [
      product.code,
      product.name,
      product.englishName,
      product.category,
      product.description,
      product.branding.join(', '),
    ].map(normalizeText).join(' | '))
    .join('\n');
}

const catalog = buildCanonicalCatalog({ pricingPath, semanticPath });
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as {
  snapshotId: string;
  productMasters: Array<JsonObject & {
    productId: string;
    displayName: string;
    status: string;
    offerIds: string[];
    physicalVariantIds: string[];
    componentSignature: string | null;
    reviewReasons: string[];
  }>;
  offers: Array<JsonObject & {
    offerId: string;
    productId: string | null;
    componentProductIds: string[];
    componentLinkIds: string[];
    decision: string;
  }>;
  componentLinks: Array<JsonObject & {
    componentLinkId: string;
    offerId: string;
    productId: string;
    physicalVariantId: string | null;
    quantity: number | null;
    position: number | null;
  }>;
};
const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as {
  reviewVersion: string;
  snapshotId: string;
  productMasters: Array<JsonObject & {
    productId: string;
    status: string;
    typeId: string | null;
    parentTypeId: string | null;
    subtypeId: string | null;
    typeStatus: string;
    decision: string;
  }>;
  offers: Array<JsonObject & {
    offerId: string;
    productId: string | null;
    componentProductIds: string[];
    componentLinkIds: string[];
  }>;
  componentLinks: Array<JsonObject & {
    componentLinkId: string;
    offerId: string;
    productId: string;
    physicalVariantId: string | null;
    quantity: number | null;
    position: number | null;
  }>;
};
const productByOffer = new Map(catalog.products.map((product) => [product.offerId, product]));
const baselineOfferById = new Map(baseline.offers.map((offer) => [offer.offerId, offer]));
const ownerOfferById = new Map(owner.offers.map((offer) => [offer.offerId, offer]));
const ownerProductById = new Map(owner.productMasters.map((product) => [product.productId, product]));
const ownerLinkByOffer = new Map<string, typeof owner.componentLinks>();
for (const link of owner.componentLinks) {
  const links = ownerLinkByOffer.get(link.offerId) || [];
  links.push(link);
  ownerLinkByOffer.set(link.offerId, links);
}

const productMasters = baseline.productMasters
  .sort((left, right) => left.productId.localeCompare(right.productId))
  .map((product) => {
    const evidenceProducts = product.offerIds
      .map((offerId) => productByOffer.get(offerId))
      .filter((offer): offer is CanonicalCatalogProduct => Boolean(offer));
    const ownerProduct = ownerProductById.get(product.productId);
    const oldUnclassified = product.status === 'unclassified';
    const ownerResolved = Boolean(ownerProduct && ownerProduct.typeStatus === 'classified');
    return {
      documentKind: 'product_master',
      productId: product.productId,
      productKind: product.productKind,
      displayName: product.displayName,
      offerIds: [...product.offerIds].sort(),
      physicalVariantIds: [...product.physicalVariantIds].sort(),
      cohortMembership: [
        ...(oldUnclassified ? ['COHORT_R1_UNCLASSIFIED_55'] : []),
        ...(!oldUnclassified || ownerResolved ? ['COHORT_R1_RESOLVED_375'] : []),
      ],
      sourceRowIds: [...new Set(evidenceProducts.flatMap(sourceRowIds))].sort(),
      reference: {
        baselineStatus: product.status,
        baselineTypeId: null,
        ownerStatus: ownerProduct?.status || null,
        ownerTypeId: ownerProduct?.typeId || null,
        ownerParentTypeId: ownerProduct?.parentTypeId || null,
        ownerSubtypeId: ownerProduct?.subtypeId || null,
        ownerDecision: ownerProduct?.decision || null,
        referenceLabelStatus: ownerProduct ? 'provisional_owner_reference' : 'baseline_only',
      },
      text: productText(evidenceProducts),
    };
  });
const resolvedProductIds = new Set(
  productMasters
    .filter((product) => product.cohortMembership.includes('COHORT_R1_RESOLVED_375'))
    .map((product) => product.productId)
);

const catalogOffers = catalog.products
  .sort((left, right) => left.offerId.localeCompare(right.offerId))
  .map((product) => {
    const oldOffer = baselineOfferById.get(product.offerId);
    const ownerOffer = ownerOfferById.get(product.offerId);
    const ownerLinks = (ownerLinkByOffer.get(product.offerId) || []).sort((left, right) => left.componentLinkId.localeCompare(right.componentLinkId));
    const componentProductIds = [...new Set([
      ...(oldOffer?.componentProductIds || []),
      ...(ownerOffer?.componentProductIds || []),
    ])].sort();
    const targetProductIds = [...new Set([
      ...(oldOffer?.productId ? [oldOffer.productId] : []),
      ...componentProductIds,
    ])].sort();
    const referenceTargetProductIds = targetProductIds.filter((productId) => resolvedProductIds.has(productId));
    const resolvedComponentTargetProductIds = componentProductIds.filter((productId) => resolvedProductIds.has(productId));
    const offerKind = oldOffer?.decision === 'set_offer' || componentProductIds.length > 0 ? 'set' : 'single';
    return {
      documentKind: 'catalog_offer',
      offerId: product.offerId,
      sourceCode: product.code,
      offerKind,
      sourceRowIds: sourceRowIds(product).sort(),
      componentLinkIds: ownerLinks.map((link) => link.componentLinkId),
      targetProductIds,
      referenceTargetProductIds,
      resolvedComponentTargetProductIds,
      componentTargets: ownerLinks.map((link) => ({
        componentLinkId: link.componentLinkId,
        productId: link.productId,
        physicalVariantId: link.physicalVariantId,
        quantity: link.quantity,
        position: link.position,
      })),
      text: [
        product.code,
        product.name,
        product.englishName,
        product.category,
        product.description,
        product.branding.join(', '),
      ].map(normalizeText).join(' | '),
    };
  });

const componentLinks = owner.componentLinks
  .sort((left, right) => left.componentLinkId.localeCompare(right.componentLinkId))
  .map((link) => ({
    componentLinkId: link.componentLinkId,
    offerId: link.offerId,
    productId: link.productId,
    physicalVariantId: link.physicalVariantId,
    quantity: link.quantity,
    position: link.position,
  }));

const sourceManifest = catalog.manifest.sources
  .map((source) => ({
    role: source.role,
    sha256: source.sha256,
    recordCount: source.recordCount,
    uniqueCodeCount: source.uniqueCodeCount,
    duplicateRowCount: source.duplicateRowCount,
  }))
  .sort((left, right) => left.role.localeCompare(right.role));
const datasetFingerprint = hash({
  schemaVersion: 1,
  canonicalizationVersion: 'catalog-family-v1',
  sources: sourceManifest.map(({ role, sha256, recordCount, uniqueCodeCount }) => ({
    role,
    sha256,
    recordCount,
    uniqueCodeCount,
  })),
  canonicalOfferIds: catalog.products.map((product) => product.offerId).sort(),
});
const querySetId = `QUERYSET1_${hash({
  cohortIds: ['COHORT_R1_ALL_OFFERS_1016', 'COHORT_R1_RESOLVED_375', 'COHORT_R1_UNCLASSIFIED_55', 'COHORT_R1_SINGLE_30', 'COHORT_R1_SET_986', 'COHORT_R1_COMPONENTS_3170'],
  queryOrdering: catalogOffers.map((offer) => offer.offerId),
}).slice(0, 20)}`;
const datasetId = `DS1_SMARTGIFT_${datasetFingerprint.slice(0, 20)}`;
const datasetRevisionId = `DSR1_${hashText(`${datasetId}|cohort-definition-r1-v1`).slice(0, 20)}`;
const payload = {
  schemaVersion: 1,
  inputId: `VINPUT1_${hash({ datasetFingerprint, baselineSnapshotId: baseline.snapshotId, ownerSnapshotId: owner.snapshotId }).slice(0, 20)}`,
  datasetId,
  datasetRevisionId,
  querySetId,
  canonicalSnapshotId: catalog.manifest.snapshotId,
  baselineSnapshotId: baseline.snapshotId,
  ownerSnapshotId: owner.snapshotId,
  sourceManifest,
  corpusMode: 'baseline_product_masters_425',
  counts: {
    sourceRows: sourceManifest.reduce((sum, source) => sum + source.recordCount, 0),
    canonicalOffers: catalogOffers.length,
    productMasters: productMasters.length,
    resolvedProductMasters: productMasters.filter((product) => product.cohortMembership.includes('COHORT_R1_RESOLVED_375')).length,
    frozenUnclassifiedProductMasters: productMasters.filter((product) => product.cohortMembership.includes('COHORT_R1_UNCLASSIFIED_55')).length,
    ownerComponentLinks: componentLinks.length,
  },
  productMasters,
  catalogOffers,
  componentLinks,
};

writeAtomic(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  inputId: payload.inputId,
  datasetId: payload.datasetId,
  datasetRevisionId: payload.datasetRevisionId,
  querySetId: payload.querySetId,
  canonicalSnapshotId: payload.canonicalSnapshotId,
  counts: payload.counts,
  sha256: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').toUpperCase(),
}, null, 2));
