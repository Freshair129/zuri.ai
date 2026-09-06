import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { CanonicalCatalogProduct } from '../../src/rag/catalog-manifest.js';
import {
  buildIdentityReviewFromProducts,
} from '../../src/rag/catalog-identity.js';

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

function edges(review: ReturnType<typeof buildIdentityReviewFromProducts>, rel: string) {
  return review.graph.edges.filter((edge) => edge.rel === rel);
}

describe('Graph-native atomic product identity review', () => {
  it('uses one ProductMaster for color-only SKUs and one directed OFFERS edge per SKU', () => {
    const review = buildIdentityReviewFromProducts([
      product('CUP-RED', '350ml Stainless Cup Red', 'Cup: 350ml stainless steel • Colors: Red'),
      product('CUP-BLUE', '350ml Stainless Cup Blue', 'Cup: 350ml stainless steel • Colors: Blue'),
    ]);

    assert.equal(review.productMasters.length, 1);
    assert.equal(review.counts.atomicProductCount, 1);
    assert.equal(review.counts.offerCount, 2);
    assert.equal(review.counts.componentLinkCount, 0);
    assert.equal(edges(review, 'OFFERS').length, 2);
    assert.equal(edges(review, 'CONTAINS_COMPONENT').length, 0);
    assert.deepEqual(
      review.variants.flatMap((item) => item.attributes.colors || []).sort(),
      ['Blue', 'Red']
    );
  });

  it('decomposes set SKUs into atomic components and supports reverse lookup through one edge type', () => {
    const review = buildIdentityReviewFromProducts([
      product('SET-CUP-PEN', 'Mug + Pen', 'Mug: 350ml stainless steel • Pen: metal'),
      product('SET-CUP-USB', 'Mug + USB flash drive', 'Mug: 350ml stainless steel • USB: 16G'),
    ]);

    assert.equal(review.productMasters.length, 3);
    assert.equal(review.counts.setOfferCount, 2);
    assert.equal(review.counts.componentLinkCount, 4);
    assert.equal(edges(review, 'OFFERS').length, 0);
    assert.equal(edges(review, 'CONTAINS_COMPONENT').length, 4);
    assert.equal(new Set(review.graph.edges.map((edge) => edge.id)).size, review.graph.edges.length);

    const mug = review.productMasters.find((item) => item.displayName === 'Mug');
    assert.ok(mug);
    const mugBacklinks = edges(review, 'CONTAINS_COMPONENT').filter((edge) => edge.to === mug.productId);
    assert.equal(mugBacklinks.length, 2);
    assert.ok(mugBacklinks.every((edge) => edge.props && edge.props.quantity === 1));
    assert.equal(
      review.graph.edges.some(
        (edge) => edge.rel === 'CONTAINS_COMPONENT' &&
          mugBacklinks.some((reverse) => edge.from === reverse.to && edge.to === reverse.from)
      ),
      false
    );
  });

  it('keeps customer branding as customization instead of a new ProductMaster', () => {
    const review = buildIdentityReviewFromProducts([
      product('CUP-SCREEN', 'Stainless Cup', 'Cup: 350ml stainless steel', ['สกรีนโลโก้']),
      product('CUP-LASER', 'Stainless Cup', 'Cup: 350ml stainless steel', ['เลเซอร์โลโก้']),
    ]);

    assert.equal(review.productMasters.length, 1);
    assert.equal(review.variants.length, 1);
    assert.equal(review.customizationProfiles.length, 2);
    assert.equal(edges(review, 'SUPPORTS_CUSTOMIZATION').length, 2);
  });

  it('keeps size and material changes as physical variants under one ProductMaster when the anchor agrees', () => {
    const review = buildIdentityReviewFromProducts([
      product('BOTTLE-350', 'Travel Bottle', 'Bottle: 350ml stainless steel'),
      product('BOTTLE-500', 'Travel Bottle', 'Bottle: 500ml stainless steel'),
    ]);

    assert.equal(review.productMasters.length, 1);
    assert.equal(review.productMasters[0]?.status, 'auto');
    assert.equal(review.variants.length, 2);
    assert.deepEqual(
      review.variants.flatMap((item) => item.attributes.sizes || []).sort(),
      ['350ml', '500ml']
    );
    assert.deepEqual(
      [...new Set(review.variants.flatMap((item) => item.attributes.materials || []))],
      ['stainless steel']
    );
  });

  it('separates conflicting physical anchors into review-required ProductMasters', () => {
    const review = buildIdentityReviewFromProducts([
      product('NOTEBOOK-A', 'A5 Notebook', 'Notebook: PU, silver buckle closure • Colors: Black'),
      product('NOTEBOOK-B', 'A5 Notebook', 'Notebook: leather, magnetic closure • Colors: Black'),
    ]);

    assert.equal(review.productMasters.length, 2);
    assert.ok(review.productMasters.every((item) => item.status === 'review_required'));
    assert.ok(review.productMasters.every((item) => item.reviewReasons.includes('physical_anchor_conflict')));
  });
});
