import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { CanonicalCatalogProduct } from '../../src/rag/catalog-manifest.js';
import {
  buildOwnerLogicReviewFromProducts,
} from '../../src/rag/catalog-user-logic-review.js';

function product(
  code: string,
  name: string,
  description: string | null,
  branding: string[] = []
): CanonicalCatalogProduct {
  return {
    offerId: `OFFER_${code}`,
    code,
    name,
    englishName: name,
    description,
    category: null,
    branding,
    mode: 'quote',
    moq: null,
    tiers: null,
    visual: null,
    rmb: 10,
    upc: null,
    dims: null,
    kg: null,
    e: false,
    img: null,
    sourceRowCount: 1,
    duplicateSourceRows: 0,
    sourceRefs: ['semantic', 'pricing'],
    sourceNames: { semantic: name, pricing: name },
  };
}

describe('Owner-logic side-by-side catalog review', () => {
  it('applies the owner type mapping to every offer in one physical-product group', () => {
    const review = buildOwnerLogicReviewFromProducts([
      product('EARPHONE-A', 'Wireless Earphone', 'Wireless earphone, black'),
      product('EARPHONE-B', 'Wireless Earphone', 'Wireless earphone, white'),
    ]);

    assert.equal(review.productMasters.length, 1);
    assert.equal(review.productMasters[0]?.typeId, 'earphone');
    assert.equal(review.productMasters[0]?.parentTypeId, 'audio');
    assert.equal(review.productMasters[0]?.typeStatus, 'classified');
    assert.equal(review.productMasters[0]?.decisionSource, 'user_logic_v1');
    assert.equal(review.counts.newClassifiedTypeCount, 1);
    assert.equal(review.offers.every((offer) => offer.typeId === 'earphone'), true);
    assert.equal(review.comparisons.length, 2);
    assert.equal(review.comparisons.every((row) => row.newProductIds.length === 1), true);
  });

  it('treats an explicit set as an offer and does not count the set as a ProductMaster', () => {
    const review = buildOwnerLogicReviewFromProducts([
      product('VAL-SET', "Happy Valentine's Day Lovers Set", 'Gift set'),
    ]);

    assert.equal(review.productMasters.length, 0);
    assert.equal(review.offers[0]?.offerKind, 'set');
    assert.equal(review.offers[0]?.productId, null);
    assert.deepEqual(review.offers[0]?.componentLinkIds, []);
    assert.ok(review.offers[0]?.hardRules.includes('explicit_set_offer'));
    assert.equal(review.counts.newAtomicProductCount, 0);
  });

  it('keeps atomic components that are only referenced by other set offers', () => {
    const review = buildOwnerLogicReviewFromProducts([
      product('CUP-PEN-SET', 'Mug + Pen', 'Mug: 350ml stainless steel • Pen: metal'),
    ]);

    assert.equal(review.productMasters.length, 2);
    assert.equal(review.counts.setOfferCount, 1);
    assert.equal(review.componentLinks.length, 2);
    assert.equal(review.offers[0]?.productId, null);
  });

  it('decomposes a set description into evidenced components with quantity', () => {
    const review = buildOwnerLogicReviewFromProducts([
      product(
        'TEA-SET',
        'Portable Tea Pot Gift Set',
        'Tea pot: capacity 250ml, ceramic • Tea cup: 3 Pieces, ceramic • Colors: white'
      ),
    ]);

    assert.equal(review.productMasters.length, 2);
    assert.equal(review.offers[0]?.offerKind, 'set');
    assert.equal(review.componentLinks.length, 2);
    assert.deepEqual(
      review.componentLinks.map((link) => link.quantity).sort(),
      [1, 3]
    );
    assert.ok(review.componentLinks.every((link) => link.typeId === 'drinkware'));
  });

  it('preserves the scoring formula and deterministic replay', () => {
    const products = [product('BAG-A', 'Backpack', 'Backpack, polyester')];
    const first = buildOwnerLogicReviewFromProducts(products);
    const second = buildOwnerLogicReviewFromProducts(products);

    assert.deepEqual(first, second);
    assert.deepEqual(first.weights.identity, {
      anchorAgreement: 0.35,
      componentAgreement: 0.25,
      physicalSpecAgreement: 0.20,
      nameDescriptionAgreement: 0.10,
      brandingPackagingCompatibility: 0.05,
      sourceLineageSupport: 0.05,
    });
    assert.equal(first.productMasters[0]?.typeId, 'bag');
    assert.equal(first.productMasters[0]?.subtypeId, 'backpack');
    assert.equal(first.productMasters[0]?.typeScore, 100);
  });
});
