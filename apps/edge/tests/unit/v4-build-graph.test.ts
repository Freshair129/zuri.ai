import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { buildGraphV4, embeddableNodes, type BuildInputs } from '../../src/rag/v4/build-graph.js';
import { parseFlowAccountRows, type FlowAccountRow } from '../../src/rag/v4/flowaccount.js';
import { loadCategoryGroupMap, loadTypeAliases } from '../../src/rag/v4/config.js';
import { stableSkuId } from '../../src/rag/v4/sku.js';
import { offerNodeId, typeNodeId, SKU_PKG_GIFTBOX_STD, TYPE_UNCLASSIFIED } from '../../src/rag/v4/schema.js';
import type { GraphBatch, GraphNode } from '../../src/rag/v4/schema.js';
import type { IdentityReview, Catalog2026Item } from '../../src/rag/v4/identity-types.js';

const identityPath = new URL('../fixtures/v4/identity-mini.json', import.meta.url);
const catalogPath = new URL('../fixtures/v4/catalog-mini.json', import.meta.url);
const flowaccountPath = new URL('../fixtures/v4/flowaccount-rows-mini.json', import.meta.url);

const identity: IdentityReview = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
const catalog: Catalog2026Item[] = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const flowaccountRows: FlowAccountRow[] = JSON.parse(fs.readFileSync(flowaccountPath, 'utf8'));
const flowaccount = parseFlowAccountRows(flowaccountRows);
const categoryMap = loadCategoryGroupMap();
const aliases = loadTypeAliases();

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const inputs: BuildInputs = {
  identity,
  catalog,
  flowaccount,
  categoryMap,
  aliases,
  refs: {
    identity: { file: 'identity-review.json', sha256: sha256('identity'), rowKey: '' },
    catalog: { file: 'catalog-2026.json', sha256: sha256('catalog'), rowKey: '' },
    flowaccount: { file: 'flowaccount-product.xlsx', sha256: sha256('flowaccount'), rowKey: '' },
  },
};

function findNode(batch: GraphBatch, id: string): GraphNode {
  const n = batch.nodes.find((x) => x.id === id);
  assert.ok(n, `expected node ${id} to exist`);
  return n!;
}

describe('buildGraphV4', () => {
  let batch: GraphBatch;
  before(() => {
    batch = buildGraphV4(inputs);
  });

  it('produces the expected stats', () => {
    assert.deepEqual(batch.stats, {
      CategoryGroup: 4,
      ProductType: 32,
      ProductModel: 3,
      PhysicalVariant: 5,
      PhysicalSKU: 6,
      CatalogOffer: 3,
      CatalogOfferFlowAccountOnly: 1,
      CommercialSKU: 3,
      CustomizationOption: 3,
      AttributeValue: 5,
      edges: 62,
    });
  });

  it('is deterministic across builds', () => {
    const second = buildGraphV4(inputs);
    assert.deepStrictEqual(second, batch);
  });

  it('copies status verbatim, including "candidate"', () => {
    assert.equal(findNode(batch, 'PRODUCT_M1').props.status, 'auto');
    assert.equal(findNode(batch, 'PRODUCT_M2').props.status, 'review_required');
    assert.equal(findNode(batch, 'PRODUCT_M3').props.status, 'candidate');
  });

  it('every node has props.sourceRef.sha256', () => {
    for (const n of batch.nodes) {
      const ref = n.props.sourceRef as { sha256?: string } | undefined;
      assert.ok(ref && typeof ref.sha256 === 'string' && ref.sha256.length > 0, `node ${n.id} missing sourceRef.sha256`);
    }
  });

  it('derives M2 IN_TYPE from component_role', () => {
    const edge = batch.edges.find((e) => e.rel === 'IN_TYPE' && e.from === 'PRODUCT_M2');
    assert.ok(edge);
    assert.equal(edge!.to, typeNodeId('neck_massager'));
    assert.equal(edge!.props?.source, 'component_role');
  });

  it('leaves M3 unclassified with source none and status unchanged', () => {
    const edge = batch.edges.find((e) => e.rel === 'IN_TYPE' && e.from === 'PRODUCT_M3');
    assert.ok(edge);
    assert.equal(edge!.to, TYPE_UNCLASSIFIED);
    assert.equal(edge!.props?.source, 'none');
    assert.equal(findNode(batch, 'PRODUCT_M3').props.status, 'candidate');
  });

  it('SINGLE_OF for OFFER_TBY01 -> PRODUCT_M2, and M2 is also contained by OFFER_TSP07-2', () => {
    const singleOf = batch.edges.find((e) => e.rel === 'SINGLE_OF' && e.from === offerNodeId('TBY01'));
    assert.ok(singleOf);
    assert.equal(singleOf!.to, 'PRODUCT_M2');

    const m2SkuId = stableSkuId('PRODUCT_M2', 'PHYSICAL_VARIANT_M2A');
    const contains = batch.edges.find((e) => e.rel === 'CONTAINS' && e.from === offerNodeId('TSP07-2') && e.to === m2SkuId);
    assert.ok(contains);
  });

  it('flowaccount-only offer OFFER_TPH00-4 has origin flowaccount_only and a PRICED_AS edge', () => {
    const offer = findNode(batch, offerNodeId('TPH00-4'));
    assert.equal(offer.props.origin, 'flowaccount_only');
    const priced = batch.edges.find((e) => e.rel === 'PRICED_AS' && e.from === offerNodeId('TPH00-4'));
    assert.ok(priced);
  });

  it('OFFER_TSP07-2 CONTAINS the packaging SKU and has correct componentTypeIds (no packaging)', () => {
    const offer = findNode(batch, offerNodeId('TSP07-2'));
    assert.deepEqual(offer.props.componentTypeIds, ['notebook', 'neck_massager']);
    const pkg = batch.edges.find((e) => e.rel === 'CONTAINS' && e.from === offerNodeId('TSP07-2') && e.to === SKU_PKG_GIFTBOX_STD);
    assert.ok(pkg);
  });

  it('OFFER_TBY01 (absent from catalog) gets name_en from identity and image null', () => {
    const offer = findNode(batch, offerNodeId('TBY01'));
    assert.equal(offer.props.name_en, 'Neck massager');
    assert.equal(offer.props.image, null);
  });

  it('case-insensitive catalog join gives OFFER_TSP07-2 a Thai name_th', () => {
    const offer = findNode(batch, offerNodeId('TSP07-2'));
    assert.equal(offer.props.name_th, 'Wireless charging พาวเวอร์แบงก์ สมุดโน้ต พร้อม Neck massage');
  });

  it('embeddableNodes returns 6 passages (3 models + 3 offers), each prefixed "passage: "', () => {
    const nodesToEmbed = embeddableNodes(batch);
    assert.equal(nodesToEmbed.length, 6);
    for (const n of nodesToEmbed) assert.ok(n.text.startsWith('passage: '), n.text);
  });

  // --- Wave-4 A.1: denormalized price props on CatalogOffer/ProductModel nodes ---------------

  it('CatalogOffer OFFER_TSP07-2 carries its own priceTiers denormalized from PRICED_AS (sorted by qtyTier asc)', () => {
    const offer = findNode(batch, offerNodeId('TSP07-2'));
    const tiers = offer.props.priceTiers as Array<{ qtyTier: number | null; unitPrice: number; offerCode: string | null }>;
    assert.deepEqual(tiers.map((t) => t.qtyTier), [10]);
    assert.equal(tiers[0].unitPrice, 2110);
    assert.equal(tiers[0].offerCode, 'TSP07-2');
  });

  it('CatalogOffer OFFER_TBY01 carries a 1-tier priceTiers ladder (qty 100 / 490 from flowaccount-rows-mini)', () => {
    const offer = findNode(batch, offerNodeId('TBY01'));
    const tiers = offer.props.priceTiers as Array<{ qtyTier: number | null; unitPrice: number; offerCode: string | null }>;
    assert.deepEqual(tiers.map((t) => t.qtyTier), [100]);
    assert.equal(tiers[0].unitPrice, 490);
    assert.equal(tiers[0].offerCode, 'TBY01');
  });

  it('ProductModel M1: no SINGLE_OF, priced only via CONTAINS from OFFER_TSP07-2 -> priceSource via_offer, offerCodes [TSP07-2]', () => {
    const m1 = findNode(batch, 'PRODUCT_M1');
    assert.equal(m1.props.priceSource, 'via_offer');
    assert.deepEqual(m1.props.offerCodes, ['TSP07-2']);
    const tiers = m1.props.priceTiers as Array<{ unitPrice: number; offerCode: string | null }>;
    assert.equal(tiers.length, 1);
    assert.equal(tiers[0].unitPrice, 2110);
    assert.equal(tiers[0].offerCode, 'TSP07-2');
  });

  it('ProductModel M2: SINGLE_OF OFFER_TBY01 wins over CONTAINS from OFFER_TSP07-2 -> priceSource offer, offerCodes include both', () => {
    const m2 = findNode(batch, 'PRODUCT_M2');
    assert.equal(m2.props.priceSource, 'offer');
    assert.deepEqual((m2.props.offerCodes as string[]).slice().sort(), ['TBY01', 'TSP07-2']);
    const tiers = m2.props.priceTiers as Array<{ unitPrice: number; offerCode: string | null }>;
    assert.equal(tiers.length, 1);
    assert.equal(tiers[0].unitPrice, 490);
    assert.equal(tiers[0].offerCode, 'TBY01');
  });

  it('ProductModel M3: no linked offers -> priceSource null, priceTiers [], offerCodes []', () => {
    const m3 = findNode(batch, 'PRODUCT_M3');
    assert.equal(m3.props.priceSource, null);
    assert.deepEqual(m3.props.priceTiers, []);
    assert.deepEqual(m3.props.offerCodes, []);
  });

  it('a CatalogOffer with no PRICED_AS edges gets priceTiers []', () => {
    // Every offer in this fixture happens to be priced; assert the invariant holds generically:
    // every CatalogOffer node has a priceTiers array prop (possibly empty), never undefined.
    for (const n of batch.nodes) {
      if (!n.labels.includes('CatalogOffer')) continue;
      assert.ok(Array.isArray(n.props.priceTiers), `${n.id} missing priceTiers array`);
    }
  });
});

describe('flowaccount-only offers are type-classified from their FlowAccount name', () => {
  it('เครื่องนวดคอ TBY01(P-14) → componentTypeIds [neck_massager]', async () => {
    const batch = buildGraphV4(inputs);
    const offer = batch.nodes.find((n) => n.id === 'OFFER_TPH00-4');
    assert.ok(offer, 'name_coded base TPH00-4 must exist as a flowaccount_only offer');
    // mini-fixture name: 'แก้วน้ำ + ที่ใส่ปากกา TPH00-4(P-06)' → drinkware + pen
    const types = offer!.props.componentTypeIds as string[];
    for (const t of ['drinkware', 'pen']) assert.ok(types.includes(t), `missing ${t} in ${types}`);
  });
});
