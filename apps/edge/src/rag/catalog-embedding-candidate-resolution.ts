import crypto from 'crypto';

import type {
  IdentityPhysicalVariant,
  IdentityProductMasterRecord,
} from './catalog-identity.js';
import type { OwnerLogicProductMasterRecord } from './catalog-user-logic-review.js';

export const CATALOG_EMBEDDING_RESOLUTION_VERSION = 'catalog-embedding-candidate-resolution-v1';

export type CandidateResolutionDecision =
  | 'same_product'
  | 'variant_of'
  | 'kept_separate'
  | 'review_required'
  | 'unclassified';

export interface ProductVectorRecord {
  productId: string;
  embedding: readonly number[];
  embeddingId?: string;
}

export interface ProductMasterCandidatePair {
  candidatePairId: string;
  leftProductId: string;
  rightProductId: string;
  cosineScore: number;
  leftRank: number | null;
  rightRank: number | null;
}

export interface CandidatePairBuildOptions {
  topK?: number;
  minCosine?: number;
}

export interface CandidateResolutionScoreFactors {
  anchorAgreement: number;
  componentAgreement: number;
  physicalSpecAgreement: number;
  nameDescriptionAgreement: number;
  brandingPackagingCompatibility: number;
  sourceLineageSupport: number;
  total: number;
}

export interface ProductMasterCandidateResolution {
  resolutionId: string;
  candidatePairId: string;
  leftProductId: string;
  rightProductId: string;
  cosineScore: number;
  leftRank: number | null;
  rightRank: number | null;
  decision: CandidateResolutionDecision;
  identityScore: number;
  scoreFactors: CandidateResolutionScoreFactors;
  hardRules: string[];
  consolidationEligible: boolean;
  autoMergeAllowed: false;
  evidence: {
    leftDisplayName: string;
    rightDisplayName: string;
    leftAnchor: string;
    rightAnchor: string;
    leftComponentSignature: string | null;
    rightComponentSignature: string | null;
    sharedSourceFamilyIds: string[];
    variantDifferences: string[];
    physicalConflictDimensions: string[];
  };
}

export interface CandidateMergeGroup {
  mergeGroupId: string;
  representativeProductId: string;
  productIds: string[];
  candidatePairIds: string[];
  resolutionIds: string[];
  decisions: Array<'same_product' | 'variant_of'>;
  proposedCountReduction: number;
  autoMergeAllowed: false;
}

export interface CandidateResolutionMetrics {
  authoritativeAtomicProductCount: number;
  proposedAtomicProductCount: number;
  proposedCountReduction: number;
  candidatePairCount: number;
  decisionCounts: Record<CandidateResolutionDecision, number>;
  consolidationEdgeCount: number;
  proposedMergeGroupCount: number;
  proposedMergedProductMasterCount: number;
  reviewQueueCount: number;
  hardRuleRejectionCount: number;
}

export interface ProductMasterCandidateResolutionResult {
  resolutionVersion: typeof CATALOG_EMBEDDING_RESOLUTION_VERSION;
  weights: {
    anchorAgreement: 0.35;
    componentAgreement: 0.25;
    physicalSpecAgreement: 0.2;
    nameDescriptionAgreement: 0.1;
    brandingPackagingCompatibility: 0.05;
    sourceLineageSupport: 0.05;
  };
  resolutions: ProductMasterCandidateResolution[];
  mergeGroups: CandidateMergeGroup[];
  reviewQueue: ProductMasterCandidateResolution[];
  metrics: CandidateResolutionMetrics;
}

export interface ResolveProductMasterCandidatesInput {
  productMasters: IdentityProductMasterRecord[];
  variants: IdentityPhysicalVariant[];
  ownerProductMasters?: OwnerLogicProductMasterRecord[];
  candidatePairs: ProductMasterCandidatePair[];
  sameProductMinCosine?: number;
  sameProductMinScore?: number;
  reviewMinCosine?: number;
}

const WEIGHTS = {
  anchorAgreement: 0.35,
  componentAgreement: 0.25,
  physicalSpecAgreement: 0.20,
  nameDescriptionAgreement: 0.10,
  brandingPackagingCompatibility: 0.05,
  sourceLineageSupport: 0.05,
} as const;

const DECISIONS: CandidateResolutionDecision[] = [
  'same_product',
  'variant_of',
  'kept_separate',
  'review_required',
  'unclassified',
];

function stableId(prefix: string, value: string): string {
  return `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 20).toUpperCase()}`;
}

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}

function normalizeText(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function anchorFor(product: IdentityProductMasterRecord): string {
  const parts = product.baseSignature.split('|');
  return normalizeText(parts[1] || product.englishName || product.displayName);
}

function knownComponent(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  return normalized && normalized !== 'unclassified' ? normalized : null;
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error('all product embeddings must be non-empty and use the same dimension');
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      throw new Error('product embeddings must contain finite numbers');
    }
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) throw new Error('product embeddings cannot be zero vectors');
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function canonicalPair(leftProductId: string, rightProductId: string): [string, string] {
  return leftProductId < rightProductId
    ? [leftProductId, rightProductId]
    : [rightProductId, leftProductId];
}

export function buildProductMasterCandidatePairs(
  vectors: ProductVectorRecord[],
  options: CandidatePairBuildOptions = {}
): ProductMasterCandidatePair[] {
  const topK = options.topK ?? 10;
  const minCosine = options.minCosine ?? -1;
  if (!Number.isInteger(topK) || topK < 1) throw new Error('topK must be a positive integer');
  if (new Set(vectors.map((record) => record.productId)).size !== vectors.length) {
    throw new Error('product vector IDs must be unique');
  }
  const dimension = vectors[0]?.embedding.length || 0;
  if (vectors.some((record) => record.embedding.length !== dimension)) {
    throw new Error('all product embeddings must use the same dimension');
  }

  const pairs = new Map<string, ProductMasterCandidatePair>();
  for (const source of vectors) {
    const ranked = vectors
      .filter((candidate) => candidate.productId !== source.productId)
      .map((candidate) => ({
        productId: candidate.productId,
        score: cosine(source.embedding, candidate.embedding),
      }))
      .filter((candidate) => candidate.score >= minCosine)
      .sort((left, right) => right.score - left.score || left.productId.localeCompare(right.productId))
      .slice(0, topK);

    for (const [offset, candidate] of ranked.entries()) {
      const [leftProductId, rightProductId] = canonicalPair(source.productId, candidate.productId);
      const key = `${leftProductId}|${rightProductId}`;
      const existing = pairs.get(key);
      const rank = offset + 1;
      const next: ProductMasterCandidatePair = existing || {
        candidatePairId: stableId('PAIR_RES', key),
        leftProductId,
        rightProductId,
        cosineScore: candidate.score,
        leftRank: null,
        rightRank: null,
      };
      next.cosineScore = Math.max(next.cosineScore, candidate.score);
      if (source.productId === leftProductId) next.leftRank = Math.min(next.leftRank ?? rank, rank);
      else next.rightRank = Math.min(next.rightRank ?? rank, rank);
      pairs.set(key, next);
    }
  }

  return [...pairs.values()]
    .map((pair) => ({ ...pair, cosineScore: Number(pair.cosineScore.toFixed(8)) }))
    .sort((left, right) => right.cosineScore - left.cosineScore || left.candidatePairId.localeCompare(right.candidatePairId));
}

function valuesFor(
  productId: string,
  variantsByProduct: Map<string, IdentityPhysicalVariant[]>,
  attribute: keyof IdentityPhysicalVariant['attributes']
): string[] {
  return [...new Set(
    (variantsByProduct.get(productId) || [])
      .flatMap((variant) => variant.attributes[attribute] || [])
      .map(normalizeText)
      .filter(Boolean)
  )].sort();
}

function setsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function disjointWhenBothKnown(left: string[], right: string[]): boolean {
  return left.length > 0 && right.length > 0 && !left.some((value) => right.includes(value));
}

function tokenJaccard(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function canonicalizeCandidates(candidatePairs: ProductMasterCandidatePair[]): ProductMasterCandidatePair[] {
  const pairs = new Map<string, ProductMasterCandidatePair>();
  for (const pair of candidatePairs) {
    if (pair.leftProductId === pair.rightProductId) continue;
    const [leftProductId, rightProductId] = canonicalPair(pair.leftProductId, pair.rightProductId);
    const key = `${leftProductId}|${rightProductId}`;
    const sourceLeftIsCanonicalLeft = pair.leftProductId === leftProductId;
    const normalized: ProductMasterCandidatePair = {
      candidatePairId: pair.candidatePairId || stableId('PAIR_RES', key),
      leftProductId,
      rightProductId,
      cosineScore: pair.cosineScore,
      leftRank: sourceLeftIsCanonicalLeft ? pair.leftRank : pair.rightRank,
      rightRank: sourceLeftIsCanonicalLeft ? pair.rightRank : pair.leftRank,
    };
    const existing = pairs.get(key);
    if (!existing || normalized.cosineScore > existing.cosineScore) pairs.set(key, normalized);
  }
  return [...pairs.values()].sort((left, right) => left.candidatePairId.localeCompare(right.candidatePairId));
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    const parent = this.parent.get(value);
    if (!parent) throw new Error(`missing disjoint-set value: ${value}`);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string): void {
    this.add(left);
    this.add(right);
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [root, child] = leftRoot < rightRoot ? [leftRoot, rightRoot] : [rightRoot, leftRoot];
    this.parent.set(child, root);
  }

  groups(): string[][] {
    const grouped = new Map<string, string[]>();
    for (const value of [...this.parent.keys()].sort()) {
      const root = this.find(value);
      const values = grouped.get(root) || [];
      values.push(value);
      grouped.set(root, values);
    }
    return [...grouped.values()].filter((values) => values.length > 1);
  }
}

export function resolveProductMasterCandidates(
  input: ResolveProductMasterCandidatesInput
): ProductMasterCandidateResolutionResult {
  if (input.productMasters.some((product) => product.productKind !== 'atomic')) {
    throw new Error('embedding candidate resolution accepts only atomic ProductMasters');
  }
  const sameProductMinCosine = input.sameProductMinCosine ?? 0.90;
  const sameProductMinScore = input.sameProductMinScore ?? 90;
  const reviewMinCosine = input.reviewMinCosine ?? 0.75;
  const products = new Map(input.productMasters.map((product) => [product.productId, product]));
  if (products.size !== input.productMasters.length) throw new Error('ProductMaster IDs must be unique');
  const ownerProducts = new Map((input.ownerProductMasters || []).map((product) => [product.productId, product]));
  const variantsByProduct = new Map<string, IdentityPhysicalVariant[]>();
  for (const variant of input.variants) {
    const variants = variantsByProduct.get(variant.productId) || [];
    variants.push(variant);
    variantsByProduct.set(variant.productId, variants);
  }

  const resolutions = canonicalizeCandidates(input.candidatePairs).map((pair): ProductMasterCandidateResolution => {
    const left = products.get(pair.leftProductId);
    const right = products.get(pair.rightProductId);
    if (!left || !right) throw new Error(`candidate pair references missing ProductMaster: ${pair.candidatePairId}`);

    const leftOwner = ownerProducts.get(left.productId);
    const rightOwner = ownerProducts.get(right.productId);
    const leftComponent = knownComponent(leftOwner?.typeId || left.componentSignature);
    const rightComponent = knownComponent(rightOwner?.typeId || right.componentSignature);
    const leftAnchor = anchorFor(left);
    const rightAnchor = anchorFor(right);
    const sameAnchor = Boolean(leftAnchor && leftAnchor === rightAnchor);
    const componentConflict = Boolean(leftComponent && rightComponent && leftComponent !== rightComponent);
    const sameComponent = Boolean(leftComponent && leftComponent === rightComponent);
    const unclassified = !leftComponent || !rightComponent;

    const leftMaterials = valuesFor(left.productId, variantsByProduct, 'materials');
    const rightMaterials = valuesFor(right.productId, variantsByProduct, 'materials');
    const leftSizes = valuesFor(left.productId, variantsByProduct, 'sizes');
    const rightSizes = valuesFor(right.productId, variantsByProduct, 'sizes');
    const leftColors = valuesFor(left.productId, variantsByProduct, 'colors');
    const rightColors = valuesFor(right.productId, variantsByProduct, 'colors');
    const leftPackaging = valuesFor(left.productId, variantsByProduct, 'packaging');
    const rightPackaging = valuesFor(right.productId, variantsByProduct, 'packaging');
    const physicalConflictDimensions: string[] = [];
    if (disjointWhenBothKnown(leftMaterials, rightMaterials)) physicalConflictDimensions.push('materials');
    if (disjointWhenBothKnown(leftSizes, rightSizes)) physicalConflictDimensions.push('sizes');
    if (left.reviewReasons.includes('physical_anchor_conflict') || right.reviewReasons.includes('physical_anchor_conflict')) {
      physicalConflictDimensions.push('physical_anchor');
    }
    const physicalConflict = physicalConflictDimensions.length > 0;
    const sharedSourceFamilyIds = left.sourceFamilyIds.filter((id) => right.sourceFamilyIds.includes(id)).sort();
    const variantDifferences: string[] = [];
    if (!setsEqual(leftColors, rightColors) && (leftColors.length > 0 || rightColors.length > 0)) variantDifferences.push('colors');
    if (!setsEqual(leftPackaging, rightPackaging) && (leftPackaging.length > 0 || rightPackaging.length > 0)) variantDifferences.push('packaging');
    if (!setsEqual([...left.customizationProfileIds].sort(), [...right.customizationProfileIds].sort())) {
      variantDifferences.push('customization');
    }

    const factors: CandidateResolutionScoreFactors = {
      anchorAgreement: sameAnchor
        ? 100
        : sameComponent
          ? roundScore(Math.max(50, tokenJaccard(leftAnchor, rightAnchor) * 100))
          : 0,
      componentAgreement: componentConflict ? 0 : sameComponent ? 100 : 50,
      physicalSpecAgreement: physicalConflict ? 0 : 100,
      nameDescriptionAgreement: roundScore(Math.max(0, Math.min(100, pair.cosineScore * 100))),
      brandingPackagingCompatibility: 100,
      sourceLineageSupport: sharedSourceFamilyIds.length > 0 ? 100 : 70,
      total: 0,
    };
    factors.total = roundScore(
      WEIGHTS.anchorAgreement * factors.anchorAgreement +
      WEIGHTS.componentAgreement * factors.componentAgreement +
      WEIGHTS.physicalSpecAgreement * factors.physicalSpecAgreement +
      WEIGHTS.nameDescriptionAgreement * factors.nameDescriptionAgreement +
      WEIGHTS.brandingPackagingCompatibility * factors.brandingPackagingCompatibility +
      WEIGHTS.sourceLineageSupport * factors.sourceLineageSupport
    );

    const hardRules: string[] = [];
    if (unclassified) hardRules.push('unclassified_component');
    if (componentConflict) hardRules.push('component_signature_conflict');
    if (physicalConflict) hardRules.push('physical_spec_conflict');
    if (sameAnchor) hardRules.push('same_physical_anchor');
    if (variantDifferences.length > 0) hardRules.push('color_or_packaging_variant');
    if (left.customizationProfileIds.length > 0 || right.customizationProfileIds.length > 0) {
      hardRules.push('branding_not_identity');
    }

    let decision: CandidateResolutionDecision;
    if (unclassified) decision = 'unclassified';
    else if (componentConflict || physicalConflict) decision = 'kept_separate';
    else if (
      sameAnchor &&
      sameComponent &&
      factors.total >= sameProductMinScore &&
      pair.cosineScore >= sameProductMinCosine
    ) {
      decision = variantDifferences.length > 0 ? 'variant_of' : 'same_product';
    } else if (factors.total >= 75 || pair.cosineScore >= reviewMinCosine) {
      decision = 'review_required';
      hardRules.push('semantic_similarity_requires_review');
    } else {
      decision = 'kept_separate';
      hardRules.push('insufficient_identity_evidence');
    }

    return {
      resolutionId: stableId('RESOLUTION', `${pair.candidatePairId}|${decision}|${factors.total}`),
      ...pair,
      cosineScore: Number(pair.cosineScore.toFixed(8)),
      decision,
      identityScore: factors.total,
      scoreFactors: factors,
      hardRules: [...new Set(hardRules)].sort(),
      consolidationEligible: decision === 'same_product' || decision === 'variant_of',
      autoMergeAllowed: false,
      evidence: {
        leftDisplayName: left.displayName,
        rightDisplayName: right.displayName,
        leftAnchor,
        rightAnchor,
        leftComponentSignature: leftComponent,
        rightComponentSignature: rightComponent,
        sharedSourceFamilyIds,
        variantDifferences,
        physicalConflictDimensions,
      },
    };
  });

  const disjointSet = new DisjointSet();
  for (const resolution of resolutions.filter((row) => row.consolidationEligible)) {
    disjointSet.union(resolution.leftProductId, resolution.rightProductId);
  }
  const mergeGroups = disjointSet.groups()
    .map((productIds): CandidateMergeGroup => {
      const productIdSet = new Set(productIds);
      const groupResolutions = resolutions.filter((resolution) =>
        resolution.consolidationEligible &&
        productIdSet.has(resolution.leftProductId) &&
        productIdSet.has(resolution.rightProductId)
      );
      const decisions = [...new Set(groupResolutions.map((resolution) => resolution.decision))]
        .filter((decision): decision is 'same_product' | 'variant_of' =>
          decision === 'same_product' || decision === 'variant_of'
        )
        .sort();
      return {
        mergeGroupId: stableId('MERGE_GROUP', productIds.join('|')),
        representativeProductId: productIds[0],
        productIds,
        candidatePairIds: groupResolutions.map((resolution) => resolution.candidatePairId).sort(),
        resolutionIds: groupResolutions.map((resolution) => resolution.resolutionId).sort(),
        decisions,
        proposedCountReduction: productIds.length - 1,
        autoMergeAllowed: false,
      };
    })
    .sort((left, right) => left.mergeGroupId.localeCompare(right.mergeGroupId));

  const decisionCounts = Object.fromEntries(DECISIONS.map((decision) => [decision, 0])) as Record<CandidateResolutionDecision, number>;
  for (const resolution of resolutions) decisionCounts[resolution.decision] += 1;
  const proposedCountReduction = mergeGroups.reduce((sum, group) => sum + group.proposedCountReduction, 0);
  const reviewQueue = resolutions
    .filter((resolution) => resolution.decision === 'review_required' || resolution.decision === 'unclassified')
    .sort((left, right) => right.identityScore - left.identityScore || right.cosineScore - left.cosineScore || left.resolutionId.localeCompare(right.resolutionId));

  return {
    resolutionVersion: CATALOG_EMBEDDING_RESOLUTION_VERSION,
    weights: WEIGHTS,
    resolutions,
    mergeGroups,
    reviewQueue,
    metrics: {
      authoritativeAtomicProductCount: input.productMasters.length,
      proposedAtomicProductCount: input.productMasters.length - proposedCountReduction,
      proposedCountReduction,
      candidatePairCount: resolutions.length,
      decisionCounts,
      consolidationEdgeCount: resolutions.filter((resolution) => resolution.consolidationEligible).length,
      proposedMergeGroupCount: mergeGroups.length,
      proposedMergedProductMasterCount: mergeGroups.reduce((sum, group) => sum + group.productIds.length, 0),
      reviewQueueCount: reviewQueue.length,
      hardRuleRejectionCount: resolutions.filter((resolution) =>
        resolution.decision === 'kept_separate' &&
        (resolution.hardRules.includes('component_signature_conflict') || resolution.hardRules.includes('physical_spec_conflict'))
      ).length,
    },
  };
}
