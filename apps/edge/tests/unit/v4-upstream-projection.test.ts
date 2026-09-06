// Contract for the upstream projection that regenerates catalog-2026.json and identity-review.json.
//
// These two artifacts used to come from files that no longer exist on any machine, so the whole
// pipeline hinged on them being reproducible from `pricelist_master.json`. The properties pinned
// here are the ones build-graph.ts depends on and would fail loudly (or, worse, silently) without:
// referential integrity between links and masters, determinism across re-exports, and the one
// documented fidelity gap staying visible in the stats rather than being quietly forgotten.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectUpstream,
  variantIdFor,
  offerIdFor,
  type UpstreamPricelistMaster,
} from '../../src/rag/v4/upstream-projection.js';

function fixture(): UpstreamPricelistMaster {
  return {
    product_masters: [
      {
        code: 'PRODUCT_AAA',
        name_th: null,
        name_en: 'Vacuum Flask',
        display_name: 'Vacuum Flask',
        base_signature: 'drinkware|drinkware|vacuum flask',
        product_family_id: 'drinkware',
        source_group_id: 'home_travel',
        source_status: 'auto',
        colors: ['Black', 'Silver'],
      },
      {
        code: 'PRODUCT_BBB',
        name_th: null,
        name_en: 'Notebook',
        display_name: 'Notebook',
        base_signature: 'notebook|notebook|a5 notebook',
        product_family_id: 'notebook',
        source_group_id: 'office',
        source_status: 'review_required',
        colors: [],
      },
      {
        code: 'PRODUCT_CCC',
        name_th: null,
        name_en: 'Mystery Item',
        display_name: 'Mystery Item',
        base_signature: '',
        product_family_id: null,
        source_group_id: null,
        source_status: 'unclassified',
        colors: null,
      },
    ],
    product_families: [
      { code: 'drinkware', source_group_id: 'home_travel', name_th: 'แก้วน้ำ', name_en: 'Drinkware' },
      { code: 'notebook', source_group_id: 'office', name_th: 'สมุดโน้ต', name_en: 'Notebook' },
    ],
    catalog_offers: [
      {
        code: 'SET01',
        name_th: 'ชุดของขวัญ',
        name_en: 'Gift Set',
        name: 'ชุดของขวัญ',
        description: 'Flask + Notebook',
        offer_kind: 'set',
        status: 'auto',
        branding: 'สกรีนโลโก้,การ์ดข้อความ',
        image: '/img/set01.webp',
        rmb: 42,
      },
      {
        code: 'SINGLE01',
        name_th: 'กระติกเดี่ยว',
        name_en: 'Single Flask',
        name: 'กระติกเดี่ยว',
        description: '',
        offer_kind: 'single',
        status: 'auto',
        branding: null,
        image: null,
        rmb: null,
      },
    ],
    offer_product_links: [
      { product_code: 'PRODUCT_BBB', offer_code: 'SET01' },
      { product_code: 'PRODUCT_AAA', offer_code: 'SET01' },
      { product_code: 'PRODUCT_AAA', offer_code: 'SINGLE01' },
    ],
  };
}

describe('v4 upstream projection', () => {
  it('projects masters, variants, offers and links with the counts build-graph expects', () => {
    const { identity, stats } = projectUpstream(fixture());
    assert.equal(stats.productMasters, 3);
    assert.equal(stats.offers, 2);
    assert.equal(stats.componentLinks, 3);
    assert.equal(identity.productMasters.length, 3);
    assert.equal(identity.offers.length, 2);
  });

  it('gives every variant a master — build-graph does mastersById.get(v.productId)! and would crash otherwise', () => {
    const { identity } = projectUpstream(fixture());
    const masterIds = new Set(identity.productMasters.map((m) => m.productId));
    for (const v of identity.variants) assert.ok(masterIds.has(v.productId), `orphan variant ${v.physicalVariantId}`);
  });

  it('gives every component link a resolvable master and variant', () => {
    const { identity } = projectUpstream(fixture());
    const masterIds = new Set(identity.productMasters.map((m) => m.productId));
    const variantIds = new Set(identity.variants.map((v) => v.physicalVariantId));
    for (const l of identity.componentLinks) {
      assert.ok(masterIds.has(l.productId), `link ${l.componentLinkId} names unknown product`);
      assert.ok(variantIds.has(l.physicalVariantId), `link ${l.componentLinkId} names unknown variant`);
    }
  });

  it('orders each offer\'s links deterministically, so a re-export does not force a needless reingest', () => {
    const a = projectUpstream(fixture());
    const shuffled = fixture();
    shuffled.offer_product_links.reverse();
    const b = projectUpstream(shuffled);
    assert.deepEqual(b.identity.componentLinks, a.identity.componentLinks);
    assert.deepEqual(b.catalog, a.catalog);
  });

  it('numbers link positions from 1 within each offer', () => {
    const { identity } = projectUpstream(fixture());
    const set01 = identity.componentLinks.filter((l) => l.offerId === offerIdFor('SET01'));
    assert.deepEqual(set01.map((l) => l.position).sort(), [1, 2]);
  });

  it('carries typeId through from product_family_id, and leaves it null when upstream has none', () => {
    const { identity } = projectUpstream(fixture());
    const byId = new Map(identity.productMasters.map((m) => [m.productId, m]));
    assert.equal(byId.get('PRODUCT_AAA')!.typeId, 'drinkware');
    assert.equal(byId.get('PRODUCT_CCC')!.typeId, null);
    const links = new Map(identity.componentLinks.map((l) => [`${l.offerId}|${l.productId}`, l]));
    assert.equal(links.get(`${offerIdFor('SET01')}|PRODUCT_AAA`)!.typeId, 'drinkware');
  });

  it('binds productId on a single-product offer only when the membership is unambiguous', () => {
    const src = fixture();
    const single = projectUpstream(src).identity.offers.find((o) => o.sourceCode === 'SINGLE01')!;
    assert.equal(single.offerKind, 'single');
    assert.equal(single.productId, 'PRODUCT_AAA');

    // A second component makes the "which product is this a single of?" question unanswerable.
    src.offer_product_links.push({ product_code: 'PRODUCT_BBB', offer_code: 'SINGLE01' });
    const ambiguous = projectUpstream(src).identity.offers.find((o) => o.sourceCode === 'SINGLE01')!;
    assert.equal(ambiguous.productId, null);
  });

  it('maps Thai branding labels to CustomizationOption ids and dedupes identical profiles', () => {
    const src = fixture();
    src.catalog_offers[1].branding = 'การ์ดข้อความ,สกรีนโลโก้'; // same set, different order
    const { identity } = projectUpstream(src);
    assert.equal(identity.customizationProfiles.length, 1, 'identical option sets share one profile');
    assert.deepEqual(identity.customizationProfiles[0].optionIds, ['message_card', 'screen_logo']);
    for (const o of identity.offers) assert.deepEqual(o.customizationProfileIds, [identity.customizationProfiles[0].customizationProfileId]);
  });

  it('emits the two graph facts build-graph reads: HAS_ATTRIBUTE colours and CatalogOffer rmb', () => {
    const { identity } = projectUpstream(fixture());
    const attrEdges = identity.graph.edges.filter((e) => e.rel === 'HAS_ATTRIBUTE');
    assert.equal(attrEdges.length, 2, 'Black and Silver on the flask');
    for (const e of attrEdges) assert.equal(e.from, variantIdFor('PRODUCT_AAA'));
    const attrNodes = identity.graph.nodes.filter((n) => n.label === 'AttributeValue');
    assert.deepEqual(attrNodes.map((n) => n.props.value).sort(), ['Black', 'Silver']);

    const offerNode = identity.graph.nodes.find((n) => n.label === 'CatalogOffer' && n.id === offerIdFor('SET01'));
    assert.equal(offerNode?.props.rmb, 42);
  });

  it('builds the semantic catalog with branding split and image/description carried through', () => {
    const { catalog } = projectUpstream(fixture());
    const set01 = catalog.find((c) => c.code === 'SET01')!;
    assert.deepEqual(set01.branding, ['สกรีนโลโก้', 'การ์ดข้อความ']);
    assert.equal(set01.image, '/img/set01.webp');
    assert.equal(set01.englishName, 'Gift Set');
    assert.equal(set01.description, 'Flask + Notebook');
  });

  it('drops links that name an unknown product or offer, and counts them rather than hiding them', () => {
    const src = fixture();
    src.offer_product_links.push({ product_code: 'PRODUCT_GHOST', offer_code: 'SET01' });
    src.offer_product_links.push({ product_code: 'PRODUCT_AAA', offer_code: 'OFFER_GHOST' });
    const { identity, stats } = projectUpstream(src);
    assert.equal(stats.droppedOrphanLinks, 1);
    assert.equal(stats.droppedOrphanOffers, 1);
    assert.equal(identity.componentLinks.length, 3, 'the three real links survive');
  });

  it('records the one-variant-per-master fidelity gap in the stats', () => {
    const { identity, stats } = projectUpstream(fixture());
    assert.equal(stats.variantsPerMaster, 1);
    assert.equal(identity.variants.length, identity.productMasters.length);
    for (const m of identity.productMasters) assert.equal(m.physicalVariantIds.length, 1);
  });

  it('keeps colours on the variant, and uses null (not []) when there are none', () => {
    const { identity } = projectUpstream(fixture());
    const byProduct = new Map(identity.variants.map((v) => [v.productId, v]));
    assert.deepEqual(byProduct.get('PRODUCT_AAA')!.attributes.colors, ['Black', 'Silver']);
    assert.equal(byProduct.get('PRODUCT_BBB')!.attributes.colors, null);
    assert.equal(byProduct.get('PRODUCT_CCC')!.attributes.colors, null);
  });

  it('lists each master\'s offers without duplicates', () => {
    const src = fixture();
    src.offer_product_links.push({ product_code: 'PRODUCT_AAA', offer_code: 'SET01' }); // duplicate row
    const { identity } = projectUpstream(src);
    const aaa = identity.productMasters.find((m) => m.productId === 'PRODUCT_AAA')!;
    assert.deepEqual(aaa.offerIds, [offerIdFor('SET01'), offerIdFor('SINGLE01')].sort());
  });
});
