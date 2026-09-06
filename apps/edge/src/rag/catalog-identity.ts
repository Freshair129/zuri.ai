import crypto from 'crypto';

import type { CanonicalCatalogProduct } from './catalog-manifest.js';
import {
  classifyTaxonomyName,
  normalizeTaxonomyText,
  type TaxonomyClassification,
} from './taxonomy.js';

export const CATALOG_IDENTITY_REVIEW_VERSION = 'catalog-identity-review-v2';

export type IdentityReviewStatus = 'auto' | 'review_required' | 'unclassified';
export type IdentityOfferKind = 'single' | 'set' | 'unclassified';

export interface IdentityReviewOptions {
  snapshotId?: string;
  sourceLineage?: string[];
  currentFamilyByOffer?: Map<string, string>;
}

export interface IdentityAttributes {
  colors: string[] | null;
  sizes: string[] | null;
  materials: string[] | null;
  packaging: string[] | null;
}

export interface IdentityPhysicalVariant {
  physicalVariantId: string;
  productId: string;
  status: 'candidate' | 'review_required';
  offerIds: string[];
  sourceCodes: string[];
  physicalSignature: string;
  comparablePhysicalSignature: string;
  attributes: IdentityAttributes;
  customizationProfileIds: string[];
}

export interface IdentityCustomizationProfile {
  customizationProfileId: string;
  optionIds: string[];
  offerIds: string[];
  sourceCodes: string[];
}

export interface IdentityProductMasterRecord {
  productId: string;
  productKind: 'atomic';
  baseSignature: string;
  displayName: string;
  englishName: string | null;
  componentSignature: string | null;
  status: IdentityReviewStatus;
  sourceFamilyIds: string[];
  offerIds: string[];
  physicalVariantIds: string[];
  customizationProfileIds: string[];
  evidence: string[];
  reviewReasons: string[];
}

export interface IdentityOfferRecord {
  offerId: string;
  sourceCode: string;
  offerKind: IdentityOfferKind;
  status: IdentityReviewStatus;
  productId: string | null;
  componentLinkIds: string[];
  customizationProfileIds: string[];
  sourceFamilyIds: string[];
}

export interface IdentityComponentLink {
  componentLinkId: string;
  offerId: string;
  sourceCode: string;
  productId: string;
  physicalVariantId: string | null;
  quantity: number;
  position: number;
  role: string;
  status: IdentityReviewStatus;
  evidence: string[];
}

export type IdentityGraphNodeLabel =
  | 'ProductMaster'
  | 'PhysicalVariant'
  | 'CatalogOffer'
  | 'CustomizationProfile'
  | 'AttributeValue';

export interface IdentityGraphNode {
  id: string;
  label: IdentityGraphNodeLabel;
  props: Record<string, unknown>;
}

export interface IdentityGraphEdge {
  id: string;
  from: string;
  to: string;
  rel:
    | 'OFFERS'
    | 'CONTAINS_COMPONENT'
    | 'HAS_VARIANT'
    | 'HAS_ATTRIBUTE'
    | 'SUPPORTS_CUSTOMIZATION';
  props?: Record<string, unknown>;
}

export interface CatalogIdentityReview {
  reviewVersion: typeof CATALOG_IDENTITY_REVIEW_VERSION;
  snapshotId: string;
  sourceLineage: string[];
  productMasters: IdentityProductMasterRecord[];
  variants: IdentityPhysicalVariant[];
  customizationProfiles: IdentityCustomizationProfile[];
  offers: IdentityOfferRecord[];
  componentLinks: IdentityComponentLink[];
  graph: {
    nodes: IdentityGraphNode[];
    edges: IdentityGraphEdge[];
  };
  counts: {
    atomicProductCount: number;
    autoAtomicProductCount: number;
    reviewRequiredAtomicProductCount: number;
    unclassifiedAtomicProductCount: number;
    physicalVariantCount: number;
    customizationProfileCount: number;
    offerCount: number;
    singleOfferCount: number;
    setOfferCount: number;
    unclassifiedOfferCount: number;
    componentLinkCount: number;
    sourceFamilyCount: number;
  };
}

interface ComponentCandidate {
  evidenceId: string;
  categoryId: string | null;
  matchedAlias: string | null;
  segment: string;
  position: number;
  taxonomyStatus: IdentityReviewStatus;
}

interface AtomicComponentEvidence {
  evidenceId: string;
  product: CanonicalCatalogProduct;
  taxonomy: TaxonomyClassification;
  categoryId: string | null;
  matchedAlias: string | null;
  segment: string;
  displayName: string;
  nameCore: string;
  physicalSignature: string;
  comparablePhysicalSignature: string;
  attributes: IdentityAttributes;
  customizationOptionIds: string[];
  currentFamilyId: string | null;
  position: number;
  reviewReasons: string[];
}

interface OfferEvidence {
  product: CanonicalCatalogProduct;
  taxonomy: TaxonomyClassification;
  components: AtomicComponentEvidence[];
  offerKind: IdentityOfferKind;
  customizationOptionIds: string[];
  currentFamilyId: string | null;
  reviewReasons: string[];
}

const COLOR_WORDS = [
  'dark blue',
  'light blue',
  'rose gold',
  'black',
  'white',
  'red',
  'blue',
  'green',
  'yellow',
  'pink',
  'purple',
  'orange',
  'silver',
  'gold',
  'grey',
  'gray',
  'brown',
  'beige',
  'transparent',
] as const;

const MATERIAL_WORDS = [
  'stainless steel',
  'polyester',
  'silicone',
  'aluminum',
  'plastic',
  'rubber',
  'leather',
  'cotton',
  'nylon',
  'titanium',
  'ceramic',
  'bamboo',
  'glass',
  'metal',
  'wood',
  'pu',
  'abs',
  'pp',
] as const;

const SIZE_PATTERN = /\b(?:a[3-6]|\d+(?:\.\d+)?\s*(?:ml|l|cm|mm|g|kg|inch|in))\b/gi;
const COMMERCIAL_PATTERN = /\bmoq\s+\d+\s+sets?\b|\(\s*moq[^)]*\)/gi;
const PACKAGING_PATTERN =
  /\b(?:packing(?:\s+(?:box|bag))?|gift\s+(?:box|bag|pack|set)|drawer\s+box\s+packing|simple\s+gift\s+bag\s+packing)\b/gi;

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 20).toUpperCase()}`;
}

function addUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.push(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIdentityText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[•·]/g, ' ')
    .replace(/[,:;()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function removeTokens(value: string, tokens: readonly string[]): string {
  let result = value;
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    result = result.replace(
      new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}($|[^a-z0-9])`, 'gi'),
      '$1 $2'
    );
  }
  return normalizeIdentityText(result);
}

function extractColorOptions(value: string): { colors: string[]; withoutColorClauses: string } {
  const colors: string[] = [];
  let withoutColorClauses = value;
  const clausePattern = /(?:colors?|colours?|สี)\s*:\s*([^•;]+)/gi;
  withoutColorClauses = withoutColorClauses.replace(clausePattern, (_match, raw: string) => {
    for (const item of raw.split(/,|\/|\band\b/gi)) {
      const color = item.trim();
      if (color && !color.includes(':') && color.toLowerCase() !== 'item') {
        addUnique(colors, titleCase(color));
      }
    }
    return ' ';
  });

  const knownColors = COLOR_WORDS.map((item) => item.toLowerCase());
  for (const color of knownColors) {
    const expression = new RegExp(`(^|[^a-z0-9])${escapeRegExp(color)}($|[^a-z0-9])`, 'gi');
    if (expression.test(withoutColorClauses)) addUnique(colors, titleCase(color));
  }

  return {
    colors: colors.sort(compareStable),
    withoutColorClauses: removeTokens(withoutColorClauses, COLOR_WORDS),
  };
}

function extractAttributesFromText(raw: string): {
  attributes: IdentityAttributes;
  cleanedDescription: string;
} {
  const colorResult = extractColorOptions(raw);
  const packaging: string[] = [];
  let cleaned = colorResult.withoutColorClauses.replace(PACKAGING_PATTERN, (match) => {
    addUnique(packaging, normalizeIdentityText(match));
    return ' ';
  });
  cleaned = cleaned.replace(COMMERCIAL_PATTERN, ' ');

  const sizes = [...new Set((cleaned.match(SIZE_PATTERN) || []).map((item) => normalizeIdentityText(item)))]
    .sort(compareStable);
  const materials = MATERIAL_WORDS.filter((item) =>
    new RegExp(`(^|[^a-z0-9])${escapeRegExp(item)}($|[^a-z0-9])`, 'i').test(cleaned)
  );

  return {
    attributes: {
      colors: colorResult.colors.length > 0 ? colorResult.colors : null,
      sizes: sizes.length > 0 ? sizes : null,
      materials: materials.length > 0 ? [...materials] : null,
      packaging: packaging.length > 0 ? packaging.sort(compareStable) : null,
    },
    cleanedDescription: normalizeIdentityText(cleaned),
  };
}

function canonicalNameCore(name: string, taxonomy: TaxonomyClassification): string {
  let working = normalizeTaxonomyText(name).split(' · ')[0] || normalizeTaxonomyText(name);
  working = working.replace(COMMERCIAL_PATTERN, ' ').replace(PACKAGING_PATTERN, ' ');
  working = removeTokens(working, [...COLOR_WORDS, ...MATERIAL_WORDS]);
  working = working.replace(SIZE_PATTERN, ' ');

  for (const component of [...taxonomy.components].sort(
    (left, right) => right.matchedAlias.length - left.matchedAlias.length
  )) {
    const expression = new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(component.matchedAlias)}($|[^a-z0-9])`,
      'gi'
    );
    working = working.replace(expression, `$1 ${component.categoryId} $2`);
  }

  const segments = working
    .split(/\s*(?:\+|&)\s*/)
    .map((segment) => normalizeIdentityText(segment))
    .filter(Boolean)
    .sort(compareStable);
  return segments.join('+') || taxonomy.componentSignature || 'unclassified';
}

function unknownNameCore(value: string): string {
  const cleaned = removeTokens(
    value,
    [...COLOR_WORDS, ...MATERIAL_WORDS]
  ).replace(SIZE_PATTERN, ' ');
  return normalizeIdentityText(cleaned) || 'unclassified';
}

function displayNameFromSegment(value: string): string {
  const cleaned = normalizeIdentityText(
    removeTokens(value, [...COLOR_WORDS, ...MATERIAL_WORDS]).replace(SIZE_PATTERN, ' ')
  );
  return titleCase(cleaned || value);
}

function normalizeNameForSegments(value: string): string {
  let normalized = normalizeTaxonomyText(value).split(' · ')[0] || normalizeTaxonomyText(value);
  normalized = normalized.replace(COMMERCIAL_PATTERN, ' ').replace(PACKAGING_PATTERN, ' ');
  const colonIndex = normalized.indexOf(':');
  if (colonIndex >= 0) normalized = normalized.slice(colonIndex + 1);
  return normalized.trim();
}

function splitDescriptionSegments(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[•;]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function descriptionLabel(segment: string): string {
  const colonIndex = segment.indexOf(':');
  return colonIndex >= 0 ? segment.slice(0, colonIndex).trim() : segment;
}

function colorClauses(value: string | null): string[] {
  if (!value) return [];
  return [...value.matchAll(/(?:colors?|colours?|สี)\s*:\s*([^•;]+)/gi)].map(
    (match) => match[0]
  );
}

function normalizeBrandingOption(value: string): string {
  const normalized = normalizeIdentityText(value);
  if (normalized.includes('สกรีน') || normalized.includes('screen')) return 'screen_logo';
  if (normalized.includes('เลเซอร์') || normalized.includes('laser')) return 'laser_logo';
  if (normalized.includes('การ์ด') || normalized.includes('message card')) return 'message_card';
  return `customization:${normalized}`;
}

function candidateStatus(
  categoryId: string | null,
  taxonomyStatus: IdentityReviewStatus
): IdentityReviewStatus {
  if (!categoryId || taxonomyStatus === 'unclassified') return 'unclassified';
  return taxonomyStatus === 'review_required' ? 'review_required' : 'auto';
}

function buildCandidates(product: CanonicalCatalogProduct, taxonomy: TaxonomyClassification): ComponentCandidate[] {
  const normalizedName = normalizeNameForSegments(product.englishName || product.name);
  const segments = normalizedName
    .split(/\s*(?:\+|&)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const candidates: ComponentCandidate[] = [];

  for (const [position, segment] of segments.entries()) {
    const segmentTaxonomy = classifyTaxonomyName(segment);
    if (segmentTaxonomy.components.length === 0) {
      candidates.push({
        evidenceId: stableId('COMPONENT_EVIDENCE', `${product.offerId}|${position}|unclassified|${segment}`),
        categoryId: null,
        matchedAlias: null,
        segment,
        position,
        taxonomyStatus: 'unclassified',
      });
      continue;
    }

    for (const [componentIndex, component] of segmentTaxonomy.components.entries()) {
      candidates.push({
        evidenceId: stableId(
          'COMPONENT_EVIDENCE',
          `${product.offerId}|${position}|${componentIndex}|${component.categoryId}|${segment}`
        ),
        categoryId: component.categoryId,
        matchedAlias: component.matchedAlias,
        segment,
        position,
        taxonomyStatus: candidateStatus(component.categoryId, segmentTaxonomy.status),
      });
    }
  }

  if (candidates.length === 0 && taxonomy.components.length > 0) {
    for (const [position, component] of taxonomy.components.entries()) {
      candidates.push({
        evidenceId: stableId(
          'COMPONENT_EVIDENCE',
          `${product.offerId}|implicit|${position}|${component.categoryId}|${component.matchedAlias}`
        ),
        categoryId: component.categoryId,
        matchedAlias: component.matchedAlias,
        segment: component.matchedAlias,
        position,
        taxonomyStatus: 'review_required',
      });
    }
  }

  if (candidates.length === 0) {
    candidates.push({
      evidenceId: stableId('COMPONENT_EVIDENCE', `${product.offerId}|unclassified`),
      categoryId: null,
      matchedAlias: null,
      segment: normalizedName || product.name,
      position: 0,
      taxonomyStatus: 'unclassified',
    });
  }

  return candidates;
}

function buildOfferEvidence(
  product: CanonicalCatalogProduct,
  currentFamilyId: string | null
): OfferEvidence {
  const taxonomy = classifyTaxonomyName(product.englishName || product.name);
  const candidates = buildCandidates(product, taxonomy);
  const descriptionSegments = splitDescriptionSegments(product.description);
  const sharedColors = colorClauses(product.description);
  const usedDescriptionIndexes = new Set<number>();
  const components: AtomicComponentEvidence[] = [];

  for (const candidate of candidates) {
    let matchedDescription: string | null = null;
    let matchedIndex = -1;
    if (candidate.categoryId) {
      for (const [index, descriptionSegment] of descriptionSegments.entries()) {
        if (usedDescriptionIndexes.has(index) || /(?:colors?|colours?|สี)\s*:/i.test(descriptionSegment)) {
          continue;
        }
        const labelTaxonomy = classifyTaxonomyName(descriptionLabel(descriptionSegment));
        if (labelTaxonomy.categoryIds.includes(candidate.categoryId)) {
          matchedDescription = descriptionSegment;
          matchedIndex = index;
          break;
        }
      }
    }
    if (matchedIndex >= 0) usedDescriptionIndexes.add(matchedIndex);

    const physicalText = [matchedDescription || candidate.segment, ...sharedColors].join(' • ');
    const attributesResult = extractAttributesFromText(physicalText);
    const componentTaxonomy = candidate.categoryId
      ? classifyTaxonomyName(candidate.segment)
      : taxonomy;
    const nameCore = candidate.categoryId
      ? canonicalNameCore(candidate.segment, componentTaxonomy)
      : unknownNameCore(candidate.segment);
    const physicalSignature = attributesResult.cleanedDescription || nameCore;
    const comparablePhysicalSignature = normalizeIdentityText(
      removeTokens(physicalSignature, [...COLOR_WORDS, ...MATERIAL_WORDS]).replace(SIZE_PATTERN, ' ')
    );
    const reviewReasons: string[] = [];

    if (taxonomy.status === 'review_required') addUnique(reviewReasons, 'taxonomy_review_required');
    if (candidate.taxonomyStatus === 'review_required') addUnique(reviewReasons, 'taxonomy_review_required');
    if (!candidate.categoryId) addUnique(reviewReasons, 'unclassified_component');
    if (!matchedDescription && candidates.length > 1) addUnique(reviewReasons, 'missing_component_evidence');
    if (!product.description && candidates.length > 1) addUnique(reviewReasons, 'missing_physical_evidence');

    components.push({
      evidenceId: candidate.evidenceId,
      product,
      taxonomy: componentTaxonomy,
      categoryId: candidate.categoryId,
      matchedAlias: candidate.matchedAlias,
      segment: candidate.segment,
      displayName: displayNameFromSegment(candidate.segment),
      nameCore,
      physicalSignature: normalizeIdentityText(physicalSignature),
      comparablePhysicalSignature,
      attributes: attributesResult.attributes,
      customizationOptionIds: [...new Set(product.branding.map(normalizeBrandingOption))].sort(compareStable),
      currentFamilyId,
      position: candidate.position,
      reviewReasons,
    });
  }

  const reviewReasons = [...new Set(components.flatMap((component) => component.reviewReasons))];
  if (taxonomy.status === 'unclassified') addUnique(reviewReasons, 'unclassified_component');
  const normalizedName = normalizeNameForSegments(product.englishName || product.name);
  const isSet = candidates.length > 1 || /[+&]/.test(normalizedName);
  const offerKind: IdentityOfferKind = isSet
    ? components.length > 0
      ? 'set'
      : 'unclassified'
    : components[0]?.categoryId
      ? 'single'
      : 'unclassified';

  return {
    product,
    taxonomy,
    components,
    offerKind,
    customizationOptionIds: [...new Set(product.branding.map(normalizeBrandingOption))].sort(compareStable),
    currentFamilyId,
    reviewReasons,
  };
}

function graphNode(
  id: string,
  label: IdentityGraphNodeLabel,
  props: Record<string, unknown>
): IdentityGraphNode {
  return { id, label, props };
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

export function buildIdentityReviewFromProducts(
  products: CanonicalCatalogProduct[],
  options: IdentityReviewOptions = {}
): CatalogIdentityReview {
  const currentFamilyByOffer = options.currentFamilyByOffer || new Map<string, string>();
  const offerEvidence = [...products]
    .sort((left, right) => compareStable(left.offerId, right.offerId))
    .map((product) => buildOfferEvidence(product, currentFamilyByOffer.get(product.offerId) || null));
  const componentEvidence = offerEvidence.flatMap((offer) => offer.components);

  const anchorComparable = new Map<string, Set<string>>();
  for (const component of componentEvidence) {
    const anchor = `${component.categoryId || 'unclassified'}|${component.nameCore}`;
    const values = anchorComparable.get(anchor) || new Set<string>();
    values.add(component.comparablePhysicalSignature || component.nameCore);
    anchorComparable.set(anchor, values);
  }

  const groups = new Map<string, AtomicComponentEvidence[]>();
  for (const component of componentEvidence) {
    const baseSignature = [
      component.categoryId || 'unclassified',
      component.nameCore,
      component.comparablePhysicalSignature || component.nameCore,
    ].join('|');
    const group = groups.get(baseSignature) || [];
    group.push(component);
    groups.set(baseSignature, group);
  }

  const productIdByEvidence = new Map<string, string>();
  const productMasters: IdentityProductMasterRecord[] = [];
  const variants: IdentityPhysicalVariant[] = [];
  const variantIdByEvidence = new Map<string, string>();
  const customizationProfiles = new Map<string, IdentityCustomizationProfile>();

  for (const [baseSignature, group] of [...groups.entries()].sort(([left], [right]) => compareStable(left, right))) {
    const first = group[0];
    const productId = stableId('PRODUCT', baseSignature);
    const anchor = `${first.categoryId || 'unclassified'}|${first.nameCore}`;
    const reviewReasons = new Set(group.flatMap((component) => component.reviewReasons));
    const anchorReasons = [...reviewReasons];
    if ((anchorComparable.get(anchor)?.size || 0) > 1 && !anchorReasons.includes('physical_anchor_conflict')) {
      anchorReasons.push('physical_anchor_conflict');
    }
    const status: IdentityReviewStatus = !first.categoryId
      ? 'unclassified'
      : anchorReasons.length > 0
        ? 'review_required'
        : 'auto';
    const variantGroups = new Map<string, AtomicComponentEvidence[]>();
    for (const component of group) {
      const variantKey = [
        component.physicalSignature,
        `colors=${component.attributes.colors?.join(',') || ''}`,
        `sizes=${component.attributes.sizes?.join(',') || ''}`,
        `materials=${component.attributes.materials?.join(',') || ''}`,
        `packaging=${component.attributes.packaging?.join(',') || ''}`,
      ].join('|');
      const variantGroup = variantGroups.get(variantKey) || [];
      variantGroup.push(component);
      variantGroups.set(variantKey, variantGroup);
    }

    const variantIds: string[] = [];
    const customizationProfileIds: string[] = [];
    for (const [variantKey, variantGroup] of [...variantGroups.entries()].sort(([left], [right]) => compareStable(left, right))) {
      const variantId = stableId('PHYSICAL_VARIANT', `${productId}|${variantKey}`);
      variantIds.push(variantId);
      variants.push({
        physicalVariantId: variantId,
        productId,
        status: status === 'auto' ? 'candidate' : 'review_required',
        offerIds: [...new Set(variantGroup.map((item) => item.product.offerId))].sort(compareStable),
        sourceCodes: [...new Set(variantGroup.map((item) => item.product.code))].sort(compareStable),
        physicalSignature: variantGroup[0].physicalSignature,
        comparablePhysicalSignature: variantGroup[0].comparablePhysicalSignature,
        attributes: variantGroup[0].attributes,
        customizationProfileIds: [...new Set(
          variantGroup.flatMap((item) => item.customizationOptionIds.length === 0
            ? []
            : [stableId('CUSTOMIZATION', item.customizationOptionIds.join('+'))])
        )].sort(compareStable),
      });
      for (const component of variantGroup) variantIdByEvidence.set(component.evidenceId, variantId);
    }

    for (const component of group) {
      productIdByEvidence.set(component.evidenceId, productId);
      const profileIds = component.customizationOptionIds.length === 0
        ? []
        : [stableId('CUSTOMIZATION', component.customizationOptionIds.join('+'))];
      for (const profileId of profileIds) addUnique(customizationProfileIds, profileId);
      for (const profileId of profileIds) {
        const profile = customizationProfiles.get(profileId) || {
          customizationProfileId: profileId,
          optionIds: component.customizationOptionIds,
          offerIds: [],
          sourceCodes: [],
        };
        profile.offerIds.push(component.product.offerId);
        profile.sourceCodes.push(component.product.code);
        customizationProfiles.set(profileId, profile);
      }
    }

    const record: IdentityProductMasterRecord = {
      productId,
      productKind: 'atomic',
      baseSignature,
      displayName: first.displayName,
      englishName: first.displayName || first.product.englishName,
      componentSignature: first.categoryId,
      status,
      sourceFamilyIds: [...new Set(group.map((item) => item.currentFamilyId).filter((id): id is string => Boolean(id)))].sort(compareStable),
      offerIds: [...new Set(group.map((item) => item.product.offerId))].sort(compareStable),
      physicalVariantIds: variantIds.sort(compareStable),
      customizationProfileIds: customizationProfileIds.sort(compareStable),
      evidence: [
        `component_signature:${first.categoryId || 'unclassified'}`,
        `atomic_name_signature:${first.nameCore}`,
        `physical_variant_count:${variantGroups.size}`,
      ],
      reviewReasons: anchorReasons.sort(compareStable),
    };
    productMasters.push(record);
  }

  const sortedProductMasters = productMasters.sort((left, right) => compareStable(left.productId, right.productId));
  const sortedVariants = variants.sort((left, right) => compareStable(left.physicalVariantId, right.physicalVariantId));
  const sortedProfiles = [...customizationProfiles.values()]
    .map((profile) => ({
      ...profile,
      offerIds: [...new Set(profile.offerIds)].sort(compareStable),
      sourceCodes: [...new Set(profile.sourceCodes)].sort(compareStable),
    }))
    .sort((left, right) => compareStable(left.customizationProfileId, right.customizationProfileId));

  const componentLinks: IdentityComponentLink[] = [];
  const offers: IdentityOfferRecord[] = [];
  const graphNodes: IdentityGraphNode[] = [];
  const graphEdges: IdentityGraphEdge[] = [];

  for (const record of sortedProductMasters) {
    graphNodes.push(graphNode(record.productId, 'ProductMaster', {
      productKind: record.productKind,
      displayName: record.displayName,
      componentSignature: record.componentSignature,
      status: record.status,
    }));
  }
  for (const variant of sortedVariants) {
    graphNodes.push(graphNode(variant.physicalVariantId, 'PhysicalVariant', {
      productId: variant.productId,
      status: variant.status,
      attributes: variant.attributes,
    }));
    graphEdges.push(graphEdge(variant.productId, 'HAS_VARIANT', variant.physicalVariantId));
    for (const [attributeType, values] of Object.entries(variant.attributes)) {
      for (const value of values || []) {
        const attributeId = stableId('ATTRIBUTE', `${attributeType}|${value}`);
        if (!graphNodes.some((node) => node.id === attributeId)) {
          graphNodes.push(graphNode(attributeId, 'AttributeValue', { attributeType, value }));
        }
        graphEdges.push(graphEdge(variant.physicalVariantId, 'HAS_ATTRIBUTE', attributeId, {
          attributeType,
          value,
        }));
      }
    }
  }
  for (const profile of sortedProfiles) {
    graphNodes.push(graphNode(profile.customizationProfileId, 'CustomizationProfile', {
      optionIds: profile.optionIds,
    }));
  }

  for (const offer of offerEvidence.sort((left, right) => compareStable(left.product.offerId, right.product.offerId))) {
    const componentInfos = offer.components.map((component) => ({
      component,
      productId: productIdByEvidence.get(component.evidenceId),
      variantId: variantIdByEvidence.get(component.evidenceId) || null,
    })).filter((item): item is {
      component: AtomicComponentEvidence;
      productId: string;
      variantId: string | null;
    } => Boolean(item.productId));
    const status: IdentityReviewStatus = offer.components.some((component) => !component.categoryId)
      ? 'unclassified'
      : [...offer.reviewReasons, ...componentInfos.flatMap((item) => item.component.reviewReasons)].length > 0
        ? 'review_required'
        : 'auto';
    const sourceFamilyIds = offer.currentFamilyId ? [offer.currentFamilyId] : [];
    const customizationProfileIds = offer.customizationOptionIds.length === 0
      ? []
      : [stableId('CUSTOMIZATION', offer.customizationOptionIds.join('+'))];
    graphNodes.push(graphNode(offer.product.offerId, 'CatalogOffer', {
      sourceCode: offer.product.code,
      offerKind: offer.offerKind,
      status,
      sourceRefs: offer.product.sourceRefs,
    }));

    const componentLinkIds: string[] = [];
    const hasDirectOfferTarget = offer.offerKind !== 'set' && componentInfos.length === 1;
    if (hasDirectOfferTarget) {
      graphEdges.push(graphEdge(offer.product.offerId, 'OFFERS', componentInfos[0].productId, {
        variantId: componentInfos[0].variantId,
        status,
      }));
    } else if (offer.offerKind === 'set') {
      for (const [index, item] of componentInfos.entries()) {
        const componentLinkId = stableId(
          'COMPONENT_LINK',
          `${offer.product.offerId}|${item.productId}|${index}|${item.variantId || ''}`
        );
        componentLinkIds.push(componentLinkId);
        const link: IdentityComponentLink = {
          componentLinkId,
          offerId: offer.product.offerId,
          sourceCode: offer.product.code,
          productId: item.productId,
          physicalVariantId: item.variantId,
          quantity: 1,
          position: index,
          role: item.component.categoryId || 'unclassified',
          status,
          evidence: [
            `source_segment:${item.component.segment}`,
            `component_signature:${item.component.categoryId || 'unclassified'}`,
          ],
        };
        componentLinks.push(link);
        graphEdges.push(graphEdge(offer.product.offerId, 'CONTAINS_COMPONENT', item.productId, {
          componentLinkId,
          quantity: link.quantity,
          position: link.position,
          role: link.role,
          variantId: link.physicalVariantId,
          status: link.status,
        }));
      }
    }

    for (const profileId of customizationProfileIds) {
      graphEdges.push(graphEdge(offer.product.offerId, 'SUPPORTS_CUSTOMIZATION', profileId));
    }
    offers.push({
      offerId: offer.product.offerId,
      sourceCode: offer.product.code,
      offerKind: offer.offerKind,
      status,
      productId: hasDirectOfferTarget
        ? componentInfos[0].productId
        : null,
      componentLinkIds,
      customizationProfileIds,
      sourceFamilyIds,
    });
  }

  const sortedOffers = offers.sort((left, right) => compareStable(left.offerId, right.offerId));
  const sortedComponentLinks = componentLinks.sort((left, right) => compareStable(left.componentLinkId, right.componentLinkId));
  const sourceFamilyCount = new Set(sortedProductMasters.flatMap((record) => record.sourceFamilyIds)).size;

  return {
    reviewVersion: CATALOG_IDENTITY_REVIEW_VERSION,
    snapshotId: options.snapshotId || 'unknown',
    sourceLineage: [...(options.sourceLineage || [])].sort(compareStable),
    productMasters: sortedProductMasters,
    variants: sortedVariants,
    customizationProfiles: sortedProfiles,
    offers: sortedOffers,
    componentLinks: sortedComponentLinks,
    graph: {
      nodes: graphNodes.sort((left, right) => compareStable(left.id, right.id)),
      edges: graphEdges.sort((left, right) => compareStable(left.id, right.id)),
    },
    counts: {
      atomicProductCount: sortedProductMasters.length,
      autoAtomicProductCount: sortedProductMasters.filter((record) => record.status === 'auto').length,
      reviewRequiredAtomicProductCount: sortedProductMasters.filter((record) => record.status === 'review_required').length,
      unclassifiedAtomicProductCount: sortedProductMasters.filter((record) => record.status === 'unclassified').length,
      physicalVariantCount: sortedVariants.length,
      customizationProfileCount: sortedProfiles.length,
      offerCount: products.length,
      singleOfferCount: sortedOffers.filter((offer) => offer.offerKind === 'single').length,
      setOfferCount: sortedOffers.filter((offer) => offer.offerKind === 'set').length,
      unclassifiedOfferCount: sortedOffers.filter((offer) => offer.offerKind === 'unclassified').length,
      componentLinkCount: sortedComponentLinks.length,
      sourceFamilyCount,
    },
  };
}
