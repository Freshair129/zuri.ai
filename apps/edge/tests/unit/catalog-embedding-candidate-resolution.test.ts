import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  IdentityPhysicalVariant,
  IdentityProductMasterRecord,
} from '../../src/rag/catalog-identity.js';
import {
  buildProductMasterCandidatePairs,
  resolveProductMasterCandidates,
} from '../../src/rag/catalog-embedding-candidate-resolution.js';

function master(
  productId: string,
  componentSignature: string | null,
  anchor: string,
  overrides: Partial<IdentityProductMasterRecord> = {}
): IdentityProductMasterRecord {
  return {
    productId,
    productKind: 'atomic',
    baseSignature: `${componentSignature || 'unclassified'}|${anchor}|${anchor}`,
    displayName: anchor,
    englishName: anchor,
    componentSignature,
    status: componentSignature ? 'review_required' : 'unclassified',
    sourceFamilyIds: [`FAMILY_${productId}`],
    offerIds: [`OFFER_${productId}`],
    physicalVariantIds: [`VARIANT_${productId}`],
    customizationProfileIds: [],
    evidence: [],
    reviewReasons: [],
    ...overrides,
  };
}

function variant(
  productId: string,
  attributes: IdentityPhysicalVariant['attributes']
): IdentityPhysicalVariant {
  return {
    physicalVariantId: `VARIANT_${productId}`,
    productId,
    status: 'candidate',
    offerIds: [`OFFER_${productId}`],
    sourceCodes: [productId],
    physicalSignature: productId,
    comparablePhysicalSignature: productId,
    attributes,
    customizationProfileIds: [],
  };
}

const emptyAttributes: IdentityPhysicalVariant['attributes'] = {
  colors: null,
  sizes: null,
  materials: null,
  packaging: null,
};

describe('Embedding candidate resolution', () => {
  it('builds deterministic unordered ProductMaster pairs without self-pairs', () => {
    const vectors = [
      { productId: 'PRODUCT_A', embedding: [1, 0] },
      { productId: 'PRODUCT_B', embedding: [0.99, 0.01] },
      { productId: 'PRODUCT_C', embedding: [0, 1] },
    ];

    const first = buildProductMasterCandidatePairs(vectors, { topK: 1 });
    const second = buildProductMasterCandidatePairs(vectors, { topK: 1 });

    assert.deepEqual(first, second);
    assert.equal(first.some((pair) => pair.leftProductId === pair.rightProductId), false);
    assert.equal(new Set(first.map((pair) => pair.candidatePairId)).size, first.length);
    assert.ok(first.every((pair) => pair.leftProductId < pair.rightProductId));
    assert.equal(first.some((pair) => pair.leftProductId === 'PRODUCT_A' && pair.rightProductId === 'PRODUCT_B'), true);
  });

  it('proposes variant consolidation when only color differs under the same anchor', () => {
    const products = [
      master('PRODUCT_RED', 'drinkware', 'travel mug'),
      master('PRODUCT_BLUE', 'drinkware', 'travel mug'),
    ];
    const variants = [
      variant('PRODUCT_RED', { ...emptyAttributes, colors: ['red'] }),
      variant('PRODUCT_BLUE', { ...emptyAttributes, colors: ['blue'] }),
    ];

    const result = resolveProductMasterCandidates({
      productMasters: products,
      variants,
      candidatePairs: [{
        candidatePairId: 'PAIR_COLOR',
        leftProductId: 'PRODUCT_BLUE',
        rightProductId: 'PRODUCT_RED',
        cosineScore: 0.98,
        leftRank: 1,
        rightRank: 1,
      }],
    });

    assert.equal(result.resolutions[0]?.decision, 'variant_of');
    assert.equal(result.resolutions[0]?.consolidationEligible, true);
    assert.equal(result.resolutions[0]?.autoMergeAllowed, false);
    assert.ok(result.resolutions[0]?.hardRules.includes('color_or_packaging_variant'));
    assert.equal(result.metrics.proposedAtomicProductCount, 1);
    assert.equal(result.metrics.authoritativeAtomicProductCount, 2);
  });

  it('keeps different component types separate even when vectors are close', () => {
    const result = resolveProductMasterCandidates({
      productMasters: [
        master('PRODUCT_MUG', 'drinkware', 'gift item'),
        master('PRODUCT_PEN', 'pen', 'gift item'),
      ],
      variants: [],
      candidatePairs: [{
        candidatePairId: 'PAIR_COMPONENT_CONFLICT',
        leftProductId: 'PRODUCT_MUG',
        rightProductId: 'PRODUCT_PEN',
        cosineScore: 0.999,
        leftRank: 1,
        rightRank: 1,
      }],
    });

    assert.equal(result.resolutions[0]?.decision, 'kept_separate');
    assert.equal(result.resolutions[0]?.consolidationEligible, false);
    assert.ok(result.resolutions[0]?.hardRules.includes('component_signature_conflict'));
  });

  it('blocks consolidation when material or size evidence conflicts', () => {
    const result = resolveProductMasterCandidates({
      productMasters: [
        master('PRODUCT_STEEL', 'drinkware', 'travel mug'),
        master('PRODUCT_GLASS', 'drinkware', 'travel mug'),
      ],
      variants: [
        variant('PRODUCT_STEEL', { ...emptyAttributes, materials: ['stainless steel'], sizes: ['500ml'] }),
        variant('PRODUCT_GLASS', { ...emptyAttributes, materials: ['glass'], sizes: ['350ml'] }),
      ],
      candidatePairs: [{
        candidatePairId: 'PAIR_PHYSICAL_CONFLICT',
        leftProductId: 'PRODUCT_GLASS',
        rightProductId: 'PRODUCT_STEEL',
        cosineScore: 0.97,
        leftRank: 1,
        rightRank: 1,
      }],
    });

    assert.equal(result.resolutions[0]?.decision, 'kept_separate');
    assert.ok(result.resolutions[0]?.hardRules.includes('physical_spec_conflict'));
    assert.equal(result.metrics.hardRuleRejectionCount, 1);
  });

  it('never consolidates an unclassified ProductMaster', () => {
    const result = resolveProductMasterCandidates({
      productMasters: [
        master('PRODUCT_KNOWN', 'bag', 'backpack'),
        master('PRODUCT_UNKNOWN', null, 'unknown item'),
      ],
      variants: [],
      candidatePairs: [{
        candidatePairId: 'PAIR_UNKNOWN',
        leftProductId: 'PRODUCT_KNOWN',
        rightProductId: 'PRODUCT_UNKNOWN',
        cosineScore: 0.99,
        leftRank: 1,
        rightRank: 1,
      }],
    });

    assert.equal(result.resolutions[0]?.decision, 'unclassified');
    assert.equal(result.resolutions[0]?.consolidationEligible, false);
    assert.ok(result.resolutions[0]?.hardRules.includes('unclassified_component'));
  });

  it('rejects a set or bundle that leaks into the atomic ProductMaster input', () => {
    const leakedSet = {
      ...master('PRODUCT_SET', 'gift_set', 'lovers set'),
      productKind: 'set',
    } as unknown as IdentityProductMasterRecord;

    assert.throws(
      () => resolveProductMasterCandidates({
        productMasters: [leakedSet],
        variants: [],
        candidatePairs: [],
      }),
      /only atomic ProductMasters/
    );
  });

  it('keeps semantic-only similarity in review and builds deterministic merge groups', () => {
    const products = [
      master('PRODUCT_A', 'bag', 'backpack'),
      master('PRODUCT_B', 'bag', 'backpack'),
      master('PRODUCT_C', 'bag', 'travel bag'),
    ];
    const candidatePairs = [
      {
        candidatePairId: 'PAIR_AB',
        leftProductId: 'PRODUCT_A',
        rightProductId: 'PRODUCT_B',
        cosineScore: 0.96,
        leftRank: 1,
        rightRank: 1,
      },
      {
        candidatePairId: 'PAIR_AC',
        leftProductId: 'PRODUCT_A',
        rightProductId: 'PRODUCT_C',
        cosineScore: 0.95,
        leftRank: 2,
        rightRank: 1,
      },
    ];

    const first = resolveProductMasterCandidates({
      productMasters: products,
      variants: [],
      candidatePairs,
    });
    const second = resolveProductMasterCandidates({
      productMasters: products,
      variants: [],
      candidatePairs: [...candidatePairs].reverse(),
    });

    assert.deepEqual(first, second);
    assert.equal(first.resolutions.find((row) => row.candidatePairId === 'PAIR_AB')?.decision, 'same_product');
    assert.equal(first.resolutions.find((row) => row.candidatePairId === 'PAIR_AC')?.decision, 'review_required');
    assert.deepEqual(first.mergeGroups[0]?.productIds, ['PRODUCT_A', 'PRODUCT_B']);
    assert.equal(first.metrics.proposedAtomicProductCount, 2);
    assert.equal(first.metrics.reviewQueueCount, 1);
  });
});
