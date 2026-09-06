import crypto from 'crypto';

import type { CanonicalCatalogProduct } from './catalog-manifest.js';
import {
  buildIdentityReviewFromProducts,
  type CatalogIdentityReview,
  type IdentityComponentLink,
  type IdentityGraphEdge,
  type IdentityGraphNode,
  type IdentityOfferRecord,
  type IdentityProductMasterRecord,
  type IdentityReviewOptions,
} from './catalog-identity.js';
import { classifyTaxonomyName, normalizeTaxonomyText } from './taxonomy.js';

export const OWNER_LOGIC_REVIEW_VERSION = 'catalog-user-logic-review-v1';

export type OwnerTypeStatus = 'classified' | 'review_required' | 'unclassified';
export type OwnerOfferKind = 'single' | 'set';
export type OwnerDecision =
  | 'same_product'
  | 'set_offer'
  | 'review_required'
  | 'unclassified';
export type OwnerDecisionSource = 'existing_taxonomy' | 'user_logic_v1' | 'unclassified';

export interface OwnerLogicWeights {
  identity: {
    anchorAgreement: 0.35;
    componentAgreement: 0.25;
    physicalSpecAgreement: 0.2;
    nameDescriptionAgreement: 0.1;
    brandingPackagingCompatibility: 0.05;
    sourceLineageSupport: 0.05;
  };
  type: {
    explicitAliasEvidence: 0.5;
    descriptionEvidence: 0.25;
    parentSubtypeConsistency: 0.15;
    crossOfferConsistency: 0.1;
  };
}

export interface IdentityScoreFactors {
  anchorAgreement: number;
  componentAgreement: number;
  physicalSpecAgreement: number;
  nameDescriptionAgreement: number;
  brandingPackagingCompatibility: number;
  sourceLineageSupport: number;
  total: number;
}

export interface TypeScoreFactors {
  explicitAliasEvidence: number;
  descriptionEvidence: number;
  parentSubtypeConsistency: number;
  crossOfferConsistency: number;
  total: number;
}

export interface OwnerLogicProductMasterRecord extends IdentityProductMasterRecord {
  oldProductId: string | null;
  typeId: string | null;
  parentTypeId: string | null;
  subtypeId: string | null;
  typeStatus: OwnerTypeStatus;
  typeScore: number;
  typeScoreFactors: TypeScoreFactors;
  identityScore: number;
  identityScoreFactors: IdentityScoreFactors;
  decision: OwnerDecision;
  decisionSource: OwnerDecisionSource;
  hardRules: string[];
}

export interface OwnerLogicComponentLink extends IdentityComponentLink {
  typeId: string | null;
  parentTypeId: string | null;
}

export interface OwnerLogicOfferRecord extends Omit<IdentityOfferRecord, 'offerKind'> {
  offerKind: OwnerOfferKind;
  oldProductIds: string[];
  componentProductIds: string[];
  typeId: string | null;
  parentTypeId: string | null;
  subtypeId: string | null;
  typeStatus: OwnerTypeStatus;
  typeScore: number | null;
  identityScore: number | null;
  decision: OwnerDecision;
  decisionSource: OwnerDecisionSource;
  hardRules: string[];
}

export interface OwnerLogicComparisonRecord {
  offerId: string;
  sourceCode: string;
  oldOfferKind: string;
  newOfferKind: OwnerOfferKind;
  oldProductIds: string[];
  newProductIds: string[];
  oldTypeIds: string[];
  newTypeIds: string[];
  identityScore: number | null;
  identityScoreFactors: IdentityScoreFactors | null;
  typeScore: number | null;
  typeScoreFactors: TypeScoreFactors | null;
  hardRules: string[];
  decision: OwnerDecision;
  decisionSource: OwnerDecisionSource;
  changed: boolean;
  changeReasons: string[];
}

export interface OwnerLogicReviewOptions extends IdentityReviewOptions {
  oldArtifactPath?: string;
  oldArtifactSha256?: string;
}

export interface OwnerLogicReview {
  reviewVersion: typeof OWNER_LOGIC_REVIEW_VERSION;
  snapshotId: string;
  sourceLineage: string[];
  basis: {
    oldArtifactPath: string;
    oldArtifactSha256: string | null;
    oldReviewVersion: CatalogIdentityReview['reviewVersion'];
  };
  weights: OwnerLogicWeights;
  productMasters: OwnerLogicProductMasterRecord[];
  variants: CatalogIdentityReview['variants'];
  customizationProfiles: CatalogIdentityReview['customizationProfiles'];
  offers: OwnerLogicOfferRecord[];
  componentLinks: OwnerLogicComponentLink[];
  comparisons: OwnerLogicComparisonRecord[];
  graph: CatalogIdentityReview['graph'];
  counts: {
    canonicalOfferCount: number;
    oldAtomicProductCount: number;
    newAtomicProductCount: number;
    oldAutoCount: number;
    newAutoCount: number;
    oldClassifiedTypeCount: number;
    newClassifiedTypeCount: number;
    oldReviewRequiredCount: number;
    newReviewRequiredCount: number;
    oldUnclassifiedCount: number;
    newUnclassifiedCount: number;
    singleOfferCount: number;
    setOfferCount: number;
    unclassifiedOfferCount: number;
    componentLinkCount: number;
    changedProductMasterCount: number;
    changedOfferCount: number;
    oldVsNewChangedCount: number;
  };
}

const WEIGHTS: OwnerLogicWeights = {
  identity: {
    anchorAgreement: 0.35,
    componentAgreement: 0.25,
    physicalSpecAgreement: 0.2,
    nameDescriptionAgreement: 0.1,
    brandingPackagingCompatibility: 0.05,
    sourceLineageSupport: 0.05,
  },
  type: {
    explicitAliasEvidence: 0.5,
    descriptionEvidence: 0.25,
    parentSubtypeConsistency: 0.15,
    crossOfferConsistency: 0.1,
  },
};

interface TypeMapping {
  typeId: string;
  parentTypeId: string;
  subtypeId: string | null;
}

interface DerivedComponentSeed {
  offer: IdentityOfferRecord;
  product: CanonicalCatalogProduct;
  sourceProductMaster: IdentityProductMasterRecord;
  position: number;
  label: string;
  segment: string;
  typeId: string | null;
  quantity: number;
}

interface DerivedComponent {
  productMaster: OwnerLogicProductMasterRecord;
  variant: CatalogIdentityReview['variants'][number];
  link: OwnerLogicComponentLink;
}

const OWNER_TYPE_MAPPINGS: Record<string, TypeMapping> = {
  'wireless earphone': { typeId: 'earphone', parentTypeId: 'audio', subtypeId: null },
  'nail clipper box': { typeId: 'nail_clipper', parentTypeId: 'personal_care', subtypeId: null },
  lighter: { typeId: 'lighter', parentTypeId: 'lifestyle', subtypeId: null },
  '2026 diary': { typeId: 'notebook', parentTypeId: 'stationery', subtypeId: 'diary' },
  backpack: { typeId: 'bag', parentTypeId: 'bags', subtypeId: 'backpack' },
};

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 20).toUpperCase()}`;
}

function normalizeName(value: string): string {
  return normalizeTaxonomyText(value)
    .replace(/[,:;()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}

function mappingFor(productMaster: IdentityProductMasterRecord): TypeMapping | null {
  const key = normalizeName(productMaster.englishName || productMaster.displayName);
  return OWNER_TYPE_MAPPINGS[key] || null;
}

function taxonomyTypeFor(productMaster: IdentityProductMasterRecord): string | null {
  if (!productMaster.componentSignature || productMaster.componentSignature.includes('+')) return null;
  return productMaster.componentSignature === 'unclassified'
    ? null
    : productMaster.componentSignature;
}

function typeScoreFor(
  typeId: string | null,
  isOwnerMapping: boolean
): { status: OwnerTypeStatus; score: number; factors: TypeScoreFactors } {
  if (!typeId) {
    return {
      status: 'unclassified',
      score: 0,
      factors: {
        explicitAliasEvidence: 0,
        descriptionEvidence: 0,
        parentSubtypeConsistency: 0,
        crossOfferConsistency: 0,
        total: 0,
      },
    };
  }

  const factors: TypeScoreFactors = isOwnerMapping
    ? {
        explicitAliasEvidence: 100,
        descriptionEvidence: 100,
        parentSubtypeConsistency: 100,
        crossOfferConsistency: 100,
        total: 100,
      }
    : {
        explicitAliasEvidence: 100,
        descriptionEvidence: 90,
        parentSubtypeConsistency: 100,
        crossOfferConsistency: 100,
        total: 97.5,
      };

  return {
    status: 'classified',
    score: factors.total,
    factors,
  };
}

function identityScoreFor(
  productMaster: IdentityProductMasterRecord,
  typeId: string | null,
  isOwnerMapping: boolean
): { score: number; factors: IdentityScoreFactors; decision: OwnerDecision; hardRules: string[] } {
  const physicalConflict = productMaster.reviewReasons.includes('physical_anchor_conflict');
  const missingPhysicalEvidence = productMaster.reviewReasons.includes('missing_physical_evidence');
  const factors: IdentityScoreFactors = {
    anchorAgreement: typeId ? 100 : 0,
    componentAgreement: productMaster.componentSignature && productMaster.componentSignature !== 'unclassified'
      ? 100
      : isOwnerMapping
        ? 70
        : 0,
    physicalSpecAgreement: physicalConflict
      ? 0
      : productMaster.physicalVariantIds.length <= 1
        ? 100
        : 70,
    nameDescriptionAgreement: typeId ? (isOwnerMapping ? 100 : 90) : 0,
    brandingPackagingCompatibility: missingPhysicalEvidence ? 50 : 100,
    sourceLineageSupport: productMaster.sourceFamilyIds.length > 0 ? 100 : 0,
    total: 0,
  };
  factors.total = roundScore(
    WEIGHTS.identity.anchorAgreement * factors.anchorAgreement +
      WEIGHTS.identity.componentAgreement * factors.componentAgreement +
      WEIGHTS.identity.physicalSpecAgreement * factors.physicalSpecAgreement +
      WEIGHTS.identity.nameDescriptionAgreement * factors.nameDescriptionAgreement +
      WEIGHTS.identity.brandingPackagingCompatibility * factors.brandingPackagingCompatibility +
      WEIGHTS.identity.sourceLineageSupport * factors.sourceLineageSupport
  );

  const hardRules: string[] = [];
  if (isOwnerMapping) hardRules.push('owner_type_mapping');
  if (productMaster.componentSignature && productMaster.componentSignature !== 'unclassified') {
    hardRules.push('atomic_component_anchor');
  }
  if (productMaster.customizationProfileIds.length > 0) hardRules.push('branding_not_identity');
  if (physicalConflict) hardRules.push('physical_spec_conflict');

  const decision: OwnerDecision = isOwnerMapping
    ? 'review_required'
    : productMaster.status === 'auto' && factors.total >= 90 && !physicalConflict
      ? 'same_product'
      : productMaster.status === 'unclassified'
        ? 'unclassified'
        : 'review_required';

  return { score: factors.total, factors, decision, hardRules };
}

function explicitSetOffer(product: CanonicalCatalogProduct, baseOffer: IdentityOfferRecord): boolean {
  const normalized = normalizeName(product.englishName || product.name);
  if (baseOffer.offerKind === 'set') return true;
  if (/\bbundle\b|\blovers\s+set\b|\bset\s+of\b|\b\d+\s*(?:pcs?|pieces?)\b/i.test(normalized)) {
    return true;
  }
  return /\bset\b/i.test(normalized) && !/\btea\s+set\b/i.test(normalized) && /gift|valentine|love/i.test(normalized);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractSetComponentSeeds(
  offer: IdentityOfferRecord,
  product: CanonicalCatalogProduct,
  sourceProductMaster: IdentityProductMasterRecord
): DerivedComponentSeed[] {
  if (!product.description) return [];
  const seeds: DerivedComponentSeed[] = [];
  for (const [position, rawSegment] of product.description.split(/[•;]/).entries()) {
    const segment = rawSegment.trim();
    const colonIndex = segment.indexOf(':');
    if (colonIndex <= 0) continue;
    const label = segment.slice(0, colonIndex).trim();
    if (/^(?:color|colors?|colour|colours?|สี)$/i.test(label)) continue;
    const taxonomy = classifyTaxonomyName(label);
    const typeId = taxonomy.components[0]?.categoryId || null;
    const quantityMatch = segment.match(/\b(\d+)\s*(?:pieces?|pcs?)\b/i);
    seeds.push({
      offer,
      product,
      sourceProductMaster,
      position,
      label,
      segment,
      typeId,
      quantity: quantityMatch ? Number(quantityMatch[1]) : 1,
    });
  }
  return seeds;
}

function buildDerivedComponent(seed: DerivedComponentSeed): DerivedComponent {
  const productId = stableId(
    'PRODUCT_USER_COMPONENT',
    `${seed.offer.offerId}|${seed.position}|${seed.label}|${seed.segment}`
  );
  const physicalVariantId = stableId(
    'PHYSICAL_VARIANT',
    `${productId}|${seed.segment}`
  );
  const componentLinkId = stableId(
    'COMPONENT_LINK',
    `${seed.offer.offerId}|${productId}|${seed.position}|${physicalVariantId}`
  );
  const typeResult = typeScoreFor(seed.typeId, Boolean(seed.typeId));
  const identityFactors: IdentityScoreFactors = {
    anchorAgreement: seed.typeId ? 100 : 0,
    componentAgreement: 100,
    physicalSpecAgreement: 100,
    nameDescriptionAgreement: seed.typeId ? 100 : 0,
    brandingPackagingCompatibility: 100,
    sourceLineageSupport: seed.sourceProductMaster.sourceFamilyIds.length > 0 ? 100 : 0,
    total: 0,
  };
  identityFactors.total = roundScore(
    WEIGHTS.identity.anchorAgreement * identityFactors.anchorAgreement +
      WEIGHTS.identity.componentAgreement * identityFactors.componentAgreement +
      WEIGHTS.identity.physicalSpecAgreement * identityFactors.physicalSpecAgreement +
      WEIGHTS.identity.nameDescriptionAgreement * identityFactors.nameDescriptionAgreement +
      WEIGHTS.identity.brandingPackagingCompatibility * identityFactors.brandingPackagingCompatibility +
      WEIGHTS.identity.sourceLineageSupport * identityFactors.sourceLineageSupport
  );
  const displayName = titleCase(seed.label);
  const record: OwnerLogicProductMasterRecord = {
    productId,
    oldProductId: null,
    productKind: 'atomic',
    baseSignature: `${seed.typeId || 'unclassified'}|${normalizeName(seed.label)}|${normalizeName(seed.segment)}`,
    displayName,
    englishName: seed.label,
    componentSignature: seed.typeId,
    status: 'review_required',
    sourceFamilyIds: [...seed.sourceProductMaster.sourceFamilyIds].sort(compareStable),
    offerIds: [seed.offer.offerId],
    physicalVariantIds: [physicalVariantId],
    customizationProfileIds: [...seed.offer.customizationProfileIds].sort(compareStable),
    evidence: [
      `owner_set_component_source:${seed.segment}`,
      ...(seed.typeId ? [`owner_type:${seed.typeId}`] : []),
      `identity_score:${identityFactors.total}`,
      `type_score:${typeResult.score}`,
    ],
    reviewReasons: ['owner_set_decomposition'],
    typeId: seed.typeId,
    parentTypeId: null,
    subtypeId: null,
    typeStatus: typeResult.status,
    typeScore: typeResult.score,
    typeScoreFactors: typeResult.factors,
    identityScore: identityFactors.total,
    identityScoreFactors: identityFactors,
    decision: 'review_required',
    decisionSource: 'user_logic_v1',
    hardRules: ['owner_set_decomposition'],
  };
  const variant: CatalogIdentityReview['variants'][number] = {
    physicalVariantId,
    productId,
    status: 'review_required',
    offerIds: [seed.offer.offerId],
    sourceCodes: [seed.offer.sourceCode],
    physicalSignature: normalizeName(seed.segment),
    comparablePhysicalSignature: normalizeName(seed.label),
    attributes: {
      colors: null,
      sizes: null,
      materials: null,
      packaging: null,
    },
    customizationProfileIds: [...seed.offer.customizationProfileIds].sort(compareStable),
  };
  const link: OwnerLogicComponentLink = {
    componentLinkId,
    offerId: seed.offer.offerId,
    sourceCode: seed.offer.sourceCode,
    productId,
    physicalVariantId,
    quantity: seed.quantity,
    position: seed.position,
    role: seed.typeId || 'unclassified',
    status: 'review_required',
    evidence: [
      `source_segment:${seed.segment}`,
      `component_signature:${seed.typeId || 'unclassified'}`,
      `quantity:${seed.quantity}`,
    ],
    typeId: seed.typeId,
    parentTypeId: null,
  };
  return { productMaster: record, variant, link };
}

function graphEdge(
  from: string,
  rel: IdentityGraphEdge['rel'],
  to: string,
  props?: Record<string, unknown>
): IdentityGraphEdge {
  return {
    id: stableId('EDGE', `${from}|${rel}|${to}|${JSON.stringify(props || {})}`),
    from,
    to,
    rel,
    ...(props ? { props } : {}),
  };
}

function productIdsForOffer(
  offer: IdentityOfferRecord,
  baseComponentLinksByOffer: Map<string, IdentityComponentLink[]>,
  productMasterByOffer: Map<string, IdentityProductMasterRecord>
): string[] {
  if (offer.offerKind !== 'set') {
    const direct = offer.productId || productMasterByOffer.get(offer.offerId)?.productId;
    if (direct) return [direct];
  }
  return [...new Set((baseComponentLinksByOffer.get(offer.offerId) || []).map((link) => link.productId))]
    .sort(compareStable);
}

function typesForProductIds(
  productIds: string[],
  productMastersById: Map<string, OwnerLogicProductMasterRecord>
): string[] {
  return [...new Set(productIds
    .map((productId) => productMastersById.get(productId)?.typeId)
    .filter((typeId): typeId is string => Boolean(typeId)))]
    .sort(compareStable);
}

function cloneGraph(
  base: CatalogIdentityReview,
  productMasters: OwnerLogicProductMasterRecord[],
  offers: OwnerLogicOfferRecord[],
  variants: CatalogIdentityReview['variants']
): CatalogIdentityReview['graph'] {
  const removedProductIds = new Set(
    base.productMasters
      .filter((productMaster) => !productMasters.some((item) => item.productId === productMaster.productId))
      .map((productMaster) => productMaster.productId)
  );
  const removedVariantIds = new Set(
    base.variants
      .filter((variant) => removedProductIds.has(variant.productId))
      .map((variant) => variant.physicalVariantId)
  );
  const offerById = new Map(offers.map((offer) => [offer.offerId, offer]));
  const productById = new Map(productMasters.map((productMaster) => [productMaster.productId, productMaster]));

  const nodes: IdentityGraphNode[] = base.graph.nodes
    .filter((node) => !removedProductIds.has(node.id) && !removedVariantIds.has(node.id))
    .map((node) => {
      if (node.label === 'ProductMaster') {
        const productMaster = productById.get(node.id);
        return productMaster
          ? {
              ...node,
              props: {
                ...node.props,
                typeId: productMaster.typeId,
                parentTypeId: productMaster.parentTypeId,
                subtypeId: productMaster.subtypeId,
                typeStatus: productMaster.typeStatus,
                typeScore: productMaster.typeScore,
                identityScore: productMaster.identityScore,
                decisionSource: productMaster.decisionSource,
              },
            }
          : node;
      }
      if (node.label === 'CatalogOffer') {
        const offer = offerById.get(node.id);
        return offer
          ? {
              ...node,
              props: {
                ...node.props,
                offerKind: offer.offerKind,
                status: offer.status,
                decision: offer.decision,
                decisionSource: offer.decisionSource,
              },
            }
          : node;
      }
      return node;
    });

  let edges = base.graph.edges.filter(
    (edge) => !removedProductIds.has(edge.from) &&
      !removedProductIds.has(edge.to) &&
      !removedVariantIds.has(edge.from) &&
      !removedVariantIds.has(edge.to)
  );

  const newOfferIds = new Set(offers.map((offer) => offer.offerId));
  edges = edges.filter((edge) => !newOfferIds.has(edge.from) || edge.rel !== 'OFFERS');
  for (const offer of offers) {
    if (offer.offerKind !== 'single' || !offer.productId) continue;
    const variantId = variants.find((variant) =>
      variant.productId === offer.productId && variant.offerIds.includes(offer.offerId)
    )?.physicalVariantId || null;
    edges.push(graphEdge(offer.offerId, 'OFFERS', offer.productId, {
      variantId,
      status: offer.status,
      decisionSource: offer.decisionSource,
    }));
  }

  const referencedAttributeIds = new Set(
    edges
      .filter((edge) => edge.rel === 'HAS_ATTRIBUTE')
      .map((edge) => edge.to)
  );
  const filteredNodes = nodes.filter((node) =>
    node.label !== 'AttributeValue' || referencedAttributeIds.has(node.id)
  );

  return {
    nodes: filteredNodes.sort((left, right) => compareStable(left.id, right.id)),
    edges: edges
      .filter((edge, index, all) => all.findIndex((candidate) => candidate.id === edge.id) === index)
      .sort((left, right) => compareStable(left.id, right.id)),
  };
}

export function buildOwnerLogicReviewFromProducts(
  products: CanonicalCatalogProduct[],
  options: OwnerLogicReviewOptions = {}
): OwnerLogicReview {
  const base = buildIdentityReviewFromProducts(products, options);
  const productsByOffer = new Map(products.map((product) => [product.offerId, product]));
  const baseProductById = new Map(base.productMasters.map((productMaster) => [productMaster.productId, productMaster]));
  const baseProductByOffer = new Map<string, IdentityProductMasterRecord>();
  for (const productMaster of base.productMasters) {
    for (const offerId of productMaster.offerIds) baseProductByOffer.set(offerId, productMaster);
  }
  const componentLinksByOffer = new Map<string, IdentityComponentLink[]>();
  for (const link of base.componentLinks) {
    const links = componentLinksByOffer.get(link.offerId) || [];
    links.push(link);
    componentLinksByOffer.set(link.offerId, links);
  }

  const enrichedByOldId = new Map<string, OwnerLogicProductMasterRecord>();
  const removedProductIds = new Set<string>();
  const derivedComponents: DerivedComponent[] = [];
  const allProductMasters: OwnerLogicProductMasterRecord[] = [];
  for (const productMaster of base.productMasters) {
    const mapping = mappingFor(productMaster);
    const taxonomyType = taxonomyTypeFor(productMaster);
    const typeId = mapping?.typeId || taxonomyType;
    const typeResult = typeScoreFor(typeId, Boolean(mapping));
    const identityResult = identityScoreFor(productMaster, typeId, Boolean(mapping));
    const hardRules = [...identityResult.hardRules];
    if (mapping && !hardRules.includes('owner_type_mapping')) hardRules.push('owner_type_mapping');

    const directOffers = base.offers.filter((offer) => offer.productId === productMaster.productId);
    const isComponentOfAnySet = base.componentLinks.some((link) => link.productId === productMaster.productId);
    const isSetOnlyProduct = directOffers.length > 0 &&
      !isComponentOfAnySet &&
      directOffers.every((baseOffer) => {
        const product = productsByOffer.get(baseOffer.offerId);
        return Boolean(product && explicitSetOffer(product, baseOffer));
      });

    if (isSetOnlyProduct) {
      removedProductIds.add(productMaster.productId);
      for (const baseOffer of directOffers) {
        const product = productsByOffer.get(baseOffer.offerId);
        if (!product || (componentLinksByOffer.get(baseOffer.offerId) || []).length > 0) continue;
        for (const seed of extractSetComponentSeeds(baseOffer, product, productMaster)) {
          derivedComponents.push(buildDerivedComponent(seed));
        }
      }
      continue;
    }

    const status = mapping && productMaster.status === 'unclassified'
      ? 'review_required'
      : productMaster.status;
    const reviewReasons = [...productMaster.reviewReasons];
    if (mapping) {
      reviewReasons.push('owner_type_mapping');
    }

    const record: OwnerLogicProductMasterRecord = {
      ...productMaster,
      componentSignature: productMaster.componentSignature || typeId,
      oldProductId: productMaster.productId,
      typeId,
      parentTypeId: mapping?.parentTypeId || null,
      subtypeId: mapping?.subtypeId || null,
      typeStatus: typeResult.status,
      typeScore: typeResult.score,
      typeScoreFactors: typeResult.factors,
      identityScore: identityResult.score,
      identityScoreFactors: identityResult.factors,
      status,
      decision: identityResult.decision,
      decisionSource: mapping ? 'user_logic_v1' : typeId ? 'existing_taxonomy' : 'unclassified',
      hardRules: [...new Set(hardRules)].sort(compareStable),
      reviewReasons: [...new Set(reviewReasons)].sort(compareStable),
      evidence: [
        ...productMaster.evidence,
        ...(typeId ? [`owner_type:${typeId}`] : []),
        `identity_score:${identityResult.score}`,
        `type_score:${typeResult.score}`,
      ],
    };
    enrichedByOldId.set(productMaster.productId, record);
    allProductMasters.push(record);
  }

  allProductMasters.push(...derivedComponents.map((component) => component.productMaster));

  const productMastersById = new Map(allProductMasters.map((productMaster) => [productMaster.productId, productMaster]));
  const variants = [
    ...base.variants.filter((variant) => !removedProductIds.has(variant.productId)),
    ...derivedComponents.map((component) => component.variant),
  ];
  const componentLinks: OwnerLogicComponentLink[] = [
    ...base.componentLinks
    .filter((link) => !removedProductIds.has(link.productId))
    .map((link) => {
      const productMaster = productMastersById.get(link.productId);
      return {
        ...link,
        typeId: productMaster?.typeId || null,
        parentTypeId: productMaster?.parentTypeId || null,
      };
    }),
    ...derivedComponents.map((component) => component.link),
  ];
  const derivedComponentsByOffer = new Map<string, DerivedComponent[]>();
  for (const component of derivedComponents) {
    const items = derivedComponentsByOffer.get(component.link.offerId) || [];
    items.push(component);
    derivedComponentsByOffer.set(component.link.offerId, items);
  }

  const offers: OwnerLogicOfferRecord[] = [];
  for (const baseOffer of base.offers) {
    const product = productsByOffer.get(baseOffer.offerId);
    if (!product) continue;
    const oldProductIds = productIdsForOffer(baseOffer, componentLinksByOffer, baseProductByOffer);
    const isSet = explicitSetOffer(product, baseOffer);
    const oldPrimaryProduct = oldProductIds.length === 1 ? baseProductById.get(oldProductIds[0]) : null;
    const newPrimaryProduct = oldPrimaryProduct && !removedProductIds.has(oldPrimaryProduct.productId)
      ? productMastersById.get(oldPrimaryProduct.productId) || null
      : null;
    const newComponentProductIds = isSet
      ? [...new Set([
        ...(componentLinksByOffer.get(baseOffer.offerId) || []).map((link) => link.productId),
        ...(derivedComponentsByOffer.get(baseOffer.offerId) || []).map((component) => component.productMaster.productId),
      ].filter((productId) => productMastersById.has(productId)))].sort(compareStable)
      : [];
    const mapping = oldPrimaryProduct ? mappingFor(oldPrimaryProduct) : null;
    const offerKind: OwnerOfferKind = isSet ? 'set' : 'single';
    const productId = offerKind === 'single' ? newPrimaryProduct?.productId || null : null;
    const status = offerKind === 'set'
      ? newComponentProductIds.length > 0 ? baseOffer.status : 'unclassified'
      : mapping && baseOffer.status === 'unclassified'
        ? 'review_required'
        : baseOffer.status;
    const typeId = offerKind === 'single'
      ? newPrimaryProduct?.typeId || null
      : null;
    const parentTypeId = offerKind === 'single'
      ? newPrimaryProduct?.parentTypeId || null
      : null;
    const subtypeId = offerKind === 'single'
      ? newPrimaryProduct?.subtypeId || null
      : null;
    const hardRules = [
      ...(isSet ? ['explicit_set_offer'] : []),
      ...(mapping ? ['owner_type_mapping'] : []),
      ...(product.branding.length > 0 ? ['branding_not_identity'] : []),
    ].sort(compareStable);
    const decision: OwnerDecision = offerKind === 'set'
      ? 'set_offer'
      : newPrimaryProduct?.decision || 'unclassified';
    const decisionSource: OwnerDecisionSource = mapping
      ? 'user_logic_v1'
      : typeId
        ? 'existing_taxonomy'
        : offerKind === 'set'
          ? 'user_logic_v1'
          : 'unclassified';
    const componentLinkIds = offerKind === 'set'
      ? componentLinks
        .filter((link) => link.offerId === baseOffer.offerId)
        .map((link) => link.componentLinkId)
      : [];

    offers.push({
      ...baseOffer,
      offerKind,
      status,
      productId,
      oldProductIds,
      componentProductIds: newComponentProductIds,
      componentLinkIds,
      typeId,
      parentTypeId,
      subtypeId,
      typeStatus: offerKind === 'single' ? newPrimaryProduct?.typeStatus || 'unclassified' : 'unclassified',
      typeScore: offerKind === 'single' ? newPrimaryProduct?.typeScore || null : null,
      identityScore: offerKind === 'single' ? newPrimaryProduct?.identityScore || null : null,
      decision,
      decisionSource,
      hardRules,
    });
  }

  const sortedProductMasters = allProductMasters.sort((left, right) => compareStable(left.productId, right.productId));
  const sortedVariants = variants.sort((left, right) => compareStable(left.physicalVariantId, right.physicalVariantId));
  const sortedOffers = offers.sort((left, right) => compareStable(left.offerId, right.offerId));
  const sortedComponentLinks = componentLinks.sort((left, right) => compareStable(left.componentLinkId, right.componentLinkId));
  const ownerGraph = cloneGraph(base, sortedProductMasters, sortedOffers, sortedVariants);
  for (const component of derivedComponents) {
    const productMaster = component.productMaster;
    const variant = component.variant;
    ownerGraph.nodes.push({
      id: productMaster.productId,
      label: 'ProductMaster',
      props: {
        productKind: productMaster.productKind,
        displayName: productMaster.displayName,
        componentSignature: productMaster.componentSignature,
        status: productMaster.status,
        typeId: productMaster.typeId,
        parentTypeId: productMaster.parentTypeId,
        subtypeId: productMaster.subtypeId,
        typeStatus: productMaster.typeStatus,
        typeScore: productMaster.typeScore,
        identityScore: productMaster.identityScore,
        decisionSource: productMaster.decisionSource,
      },
    });
    ownerGraph.nodes.push({
      id: variant.physicalVariantId,
      label: 'PhysicalVariant',
      props: {
        productId: variant.productId,
        status: variant.status,
        attributes: variant.attributes,
      },
    });
    ownerGraph.edges.push(graphEdge(productMaster.productId, 'HAS_VARIANT', variant.physicalVariantId));
    ownerGraph.edges.push(graphEdge(component.link.offerId, 'CONTAINS_COMPONENT', productMaster.productId, {
      componentLinkId: component.link.componentLinkId,
      quantity: component.link.quantity,
      position: component.link.position,
      role: component.link.role,
      variantId: component.link.physicalVariantId,
      status: component.link.status,
      decisionSource: productMaster.decisionSource,
    }));
  }
  ownerGraph.nodes = ownerGraph.nodes
    .filter((node, index, all) => all.findIndex((candidate) => candidate.id === node.id) === index)
    .sort((left, right) => compareStable(left.id, right.id));
  ownerGraph.edges = ownerGraph.edges
    .filter((edge, index, all) => all.findIndex((candidate) => candidate.id === edge.id) === index)
    .sort((left, right) => compareStable(left.id, right.id));

  const comparisons: OwnerLogicComparisonRecord[] = sortedOffers.map((offer) => {
    const baseOffer = base.offers.find((item) => item.offerId === offer.offerId);
    const oldProductIds = offer.oldProductIds;
    const newProductIds = offer.offerKind === 'single'
      ? offer.productId ? [offer.productId] : []
      : offer.componentProductIds;
    const oldTypeIds = typesForProductIds(oldProductIds, new Map(
      base.productMasters.map((productMaster) => [productMaster.productId, {
        ...productMaster,
        typeId: taxonomyTypeFor(productMaster),
      } as OwnerLogicProductMasterRecord])
    ));
    const newTypeIds = typesForProductIds(newProductIds, productMastersById);
    const changeReasons: string[] = [];
    const offerKindChanged = (baseOffer?.offerKind || 'unknown') !== offer.offerKind;
    const ownerTypeMappingApplied = offer.hardRules.includes('owner_type_mapping');
    if (offerKindChanged) changeReasons.push('offer_kind_changed');
    if (JSON.stringify(oldProductIds) !== JSON.stringify(newProductIds)) changeReasons.push('product_membership_changed');
    if (JSON.stringify(oldTypeIds) !== JSON.stringify(newTypeIds)) changeReasons.push('type_changed');
    if (ownerTypeMappingApplied || offerKindChanged && offer.decisionSource === 'user_logic_v1') {
      changeReasons.push('owner_rule_applied');
    }
    const changed = changeReasons.length > 0;
    return {
      offerId: offer.offerId,
      sourceCode: offer.sourceCode,
      oldOfferKind: baseOffer?.offerKind || 'unknown',
      newOfferKind: offer.offerKind,
      oldProductIds,
      newProductIds,
      oldTypeIds,
      newTypeIds,
      identityScore: offer.identityScore,
      identityScoreFactors: offer.productId ? productMastersById.get(offer.productId)?.identityScoreFactors || null : null,
      typeScore: offer.typeScore,
      typeScoreFactors: offer.productId ? productMastersById.get(offer.productId)?.typeScoreFactors || null : null,
      hardRules: offer.hardRules,
      decision: offer.decision,
      decisionSource: offer.decisionSource,
      changed,
      changeReasons: [...new Set(changeReasons)].sort(compareStable),
    };
  });

  const changedOldProductMasterCount = base.productMasters.filter((productMaster) => {
    if (removedProductIds.has(productMaster.productId)) return true;
    const next = productMastersById.get(productMaster.productId);
    return Boolean(next && (next.typeId !== taxonomyTypeFor(productMaster) || next.status !== productMaster.status));
  }).length;
  const addedProductMasterCount = sortedProductMasters.filter((productMaster) => productMaster.oldProductId === null).length;
  const changedProductMasterCount = changedOldProductMasterCount + addedProductMasterCount;
  const changedOfferCount = comparisons.filter((comparison) => comparison.changed).length;

  return {
    reviewVersion: OWNER_LOGIC_REVIEW_VERSION,
    snapshotId: options.snapshotId || base.snapshotId,
    sourceLineage: [...base.sourceLineage],
    basis: {
      oldArtifactPath: options.oldArtifactPath || 'data/catalog_identity_review_v1/identity-review.json',
      oldArtifactSha256: options.oldArtifactSha256 || null,
      oldReviewVersion: base.reviewVersion,
    },
    weights: WEIGHTS,
    productMasters: sortedProductMasters,
    variants: sortedVariants,
    customizationProfiles: base.customizationProfiles,
    offers: sortedOffers,
    componentLinks: sortedComponentLinks,
    comparisons,
    graph: ownerGraph,
    counts: {
      canonicalOfferCount: products.length,
      oldAtomicProductCount: base.counts.atomicProductCount,
      newAtomicProductCount: sortedProductMasters.length,
      oldAutoCount: base.counts.autoAtomicProductCount,
      newAutoCount: sortedProductMasters.filter((productMaster) => productMaster.status === 'auto').length,
      oldClassifiedTypeCount: base.productMasters.filter((productMaster) => Boolean(taxonomyTypeFor(productMaster))).length,
      newClassifiedTypeCount: sortedProductMasters.filter((productMaster) => productMaster.typeStatus === 'classified').length,
      oldReviewRequiredCount: base.counts.reviewRequiredAtomicProductCount,
      newReviewRequiredCount: sortedProductMasters.filter((productMaster) => productMaster.status === 'review_required').length,
      oldUnclassifiedCount: base.counts.unclassifiedAtomicProductCount,
      newUnclassifiedCount: sortedProductMasters.filter((productMaster) => productMaster.status === 'unclassified').length,
      singleOfferCount: sortedOffers.filter((offer) => offer.offerKind === 'single').length,
      setOfferCount: sortedOffers.filter((offer) => offer.offerKind === 'set').length,
      unclassifiedOfferCount: sortedOffers.filter((offer) => offer.status === 'unclassified').length,
      componentLinkCount: sortedComponentLinks.length,
      changedProductMasterCount,
      changedOfferCount,
      oldVsNewChangedCount: changedOfferCount,
    },
  };
}
