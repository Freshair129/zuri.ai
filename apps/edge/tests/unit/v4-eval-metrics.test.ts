import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hit,
  recallAtK,
  mrr,
  negConstraintPass,
  duplicateResultRate,
  percentile,
  priceCoverage,
  variantCoverage,
  traceCoverage,
  priceLinkCoverage,
  type EvalResult,
  type ExpectedTarget,
  type RankedQuery,
  type GraphBatchLike,
} from '../../scripts/lib/eval-metrics.js';
import { offerNodeId } from '../../src/rag/v4/schema.js';

const model = (id: string, typeId: string | null = null): EvalResult => ({
  id,
  kind: 'model',
  type: typeId ? { id: typeId } : null,
  components: [],
});
const offer = (id: string, components: Array<{ modelId: string; typeId: string | null }>): EvalResult => ({
  id,
  kind: 'offer',
  type: components.length === 1 ? { id: components[0].typeId ?? '' } : null,
  components,
});

describe('v4 eval metrics — hit()', () => {
  it('expected model hits a Model result by id', () => {
    const expected: ExpectedTarget = { kind: 'model', ids: ['PRODUCT_A'] };
    assert.equal(hit(model('PRODUCT_A'), expected), true);
    assert.equal(hit(model('PRODUCT_B'), expected), false);
  });

  it('expected model hits an Offer result whose components contain the id', () => {
    const expected: ExpectedTarget = { kind: 'model', ids: ['PRODUCT_A'] };
    const off = offer('OFFER_X', [{ modelId: 'PRODUCT_A', typeId: 'notebook' }, { modelId: 'PRODUCT_Z', typeId: null }]);
    assert.equal(hit(off, expected), true);
    assert.equal(hit(offer('OFFER_Y', [{ modelId: 'PRODUCT_Z', typeId: null }]), expected), false);
  });

  it('expected type hits a Model result by type.id, or an Offer whose components carry the typeId', () => {
    const expected: ExpectedTarget = { kind: 'type', ids: ['neck_massager'] };
    assert.equal(hit(model('PRODUCT_A', 'neck_massager'), expected), true);
    assert.equal(hit(model('PRODUCT_A', 'notebook'), expected), false);
    const off = offer('OFFER_X', [{ modelId: 'PRODUCT_A', typeId: 'neck_massager' }]);
    assert.equal(hit(off, expected), true);
  });

  it('OR semantics: any of several expected ids counts (QS_OFFER_SELF_v1 multi-target offers)', () => {
    const expected: ExpectedTarget = { kind: 'model', ids: ['PRODUCT_A', 'PRODUCT_B'] };
    assert.equal(hit(model('PRODUCT_B'), expected), true);
  });
});

describe('v4 eval metrics — recallAtK / mrr', () => {
  const expected: ExpectedTarget = { kind: 'model', ids: ['PRODUCT_A'] };

  it('recallAtK counts a hit anywhere within the top-K slice', () => {
    const queries: RankedQuery[] = [
      { ranked: [model('PRODUCT_X'), model('PRODUCT_A'), model('PRODUCT_Y')], expected }, // rank 2
      { ranked: [model('PRODUCT_X'), model('PRODUCT_Y')], expected }, // miss
    ];
    assert.deepEqual(recallAtK(queries, 1), { numerator: 0, denominator: 2, value: 0, status: 'measured' });
    assert.deepEqual(recallAtK(queries, 2), { numerator: 1, denominator: 2, value: 0.5, status: 'measured' });
  });

  it('recallAtK with zero queries is no_data, not a divide-by-zero crash', () => {
    assert.deepEqual(recallAtK([], 5), { numerator: 0, denominator: 0, value: 0, status: 'no_data' });
  });

  it('mrr = mean(1/rank of first hit), 0 when no hit', () => {
    const queries: RankedQuery[] = [
      { ranked: [model('PRODUCT_A')], expected }, // rank 1 -> 1
      { ranked: [model('PRODUCT_X'), model('PRODUCT_A')], expected }, // rank 2 -> 0.5
      { ranked: [model('PRODUCT_X')], expected }, // miss -> 0
    ];
    const m = mrr(queries);
    assert.equal(m.denominator, 3);
    assert.ok(Math.abs(m.value - (1 + 0.5 + 0) / 3) < 1e-9);
  });
});

describe('v4 eval metrics — negConstraintPass (non-vacuous)', () => {
  it('passes when results/nearest exist and none violate the exclusion', () => {
    const queries = [
      { excludeTypes: ['drinkware'], results: [model('PRODUCT_A', 'neck_massager')], nearest: [] },
    ];
    assert.deepEqual(negConstraintPass(queries), { numerator: 1, denominator: 1, value: 1, status: 'measured' });
  });

  it('fails when a result is in the excluded type', () => {
    const queries = [
      { excludeTypes: ['drinkware'], results: [model('PRODUCT_A', 'drinkware')], nearest: [] },
    ];
    assert.deepEqual(negConstraintPass(queries), { numerator: 0, denominator: 1, value: 0, status: 'measured' });
  });

  it('a vacuous query (no results AND no nearest) must NOT count as a pass', () => {
    const queries = [
      { excludeTypes: ['drinkware'], results: [], nearest: [] },
    ];
    const r = negConstraintPass(queries);
    assert.equal(r.numerator, 0);
    assert.equal(r.denominator, 1, 'still counted in the denominator — exclude != []');
    assert.equal(r.value, 0);
  });

  it('queries without exclude are not counted in the denominator at all', () => {
    const queries = [
      { excludeTypes: [], results: [], nearest: [] },
      { excludeTypes: ['drinkware'], results: [model('PRODUCT_A')], nearest: [] },
    ];
    assert.equal(negConstraintPass(queries).denominator, 1);
  });

  it('an excluded-type hit inside nearest[] also fails the query', () => {
    const queries = [
      { excludeTypes: ['drinkware'], results: [], nearest: [model('PRODUCT_A', 'drinkware')] },
    ];
    assert.equal(negConstraintPass(queries).numerator, 0);
  });
});

describe('v4 eval metrics — duplicateResultRate', () => {
  it('flags a query whose results repeat an id', () => {
    const queries = [
      { results: [model('PRODUCT_A'), model('PRODUCT_A')] },
      { results: [model('PRODUCT_A'), model('PRODUCT_B')] },
    ];
    assert.deepEqual(duplicateResultRate(queries), { numerator: 1, denominator: 2, value: 0.5, status: 'measured' });
  });
});

describe('v4 eval metrics — percentile', () => {
  it('p50/p95 use nearest-rank on sorted values', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.equal(percentile(values, 50), 50);
    assert.equal(percentile(values, 95), 100);
  });

  it('empty input is 0, not NaN', () => {
    assert.equal(percentile([], 95), 0);
  });
});

describe('v4 eval metrics — graph-level coverage (tiny GraphBatch fixture)', () => {
  const batch: GraphBatchLike = {
    nodes: [
      { id: 'PRODUCT_A', labels: ['ProductModel'], props: { sourceRef: { file: 'x', sha256: 'x', rowKey: 'PRODUCT_A' } } },
      { id: 'PRODUCT_B', labels: ['ProductModel'], props: { sourceRef: { file: 'x', sha256: 'x', rowKey: 'PRODUCT_B' } } },
      { id: 'VARIANT_A1', labels: ['PhysicalVariant'], props: { colors: ['Black'], sourceRef: { file: 'x', sha256: 'x', rowKey: 'v' } } },
      { id: 'VARIANT_B1', labels: ['PhysicalVariant'], props: { colors: [], sourceRef: { file: 'x', sha256: 'x', rowKey: 'v' } } },
      { id: 'OFFER_A', labels: ['CatalogOffer'], props: { sourceRef: { file: 'x', sha256: 'x', rowKey: 'o' } } },
      { id: 'OFFER_B', labels: ['CatalogOffer'], props: { sourceRef: { file: 'x', sha256: 'x', rowKey: 'o' } } },
      { id: 'CSKU_1', labels: ['CommercialSKU'], props: { priceMissing: false, sourceRef: { file: 'x', sha256: 'x', rowKey: 'c' } } },
      { id: 'CSKU_2', labels: ['CommercialSKU'], props: { priceMissing: true, sourceRef: { file: 'x', sha256: 'x', rowKey: 'c' } } },
      // deliberately no sourceRef, to exercise TRACE_COVERAGE < 1
      { id: 'TYPE_x', labels: ['ProductType'], props: {} },
    ],
    edges: [
      { id: 'e1', from: 'PRODUCT_A', to: 'VARIANT_A1', rel: 'HAS_VARIANT' },
      { id: 'e2', from: 'PRODUCT_B', to: 'VARIANT_B1', rel: 'HAS_VARIANT' },
      { id: 'e3', from: 'OFFER_A', to: 'CSKU_1', rel: 'PRICED_AS' },
      { id: 'e4', from: 'OFFER_B', to: 'CSKU_2', rel: 'PRICED_AS' },
    ],
  };

  it('priceCoverage counts offers with >=1 non-missing-price CommercialSKU over a caller-supplied denominator', () => {
    assert.deepEqual(priceCoverage(batch, 4), { numerator: 1, denominator: 4, value: 0.25, status: 'measured' });
  });

  it('variantCoverage counts models with >=1 variant carrying a non-empty colors[]', () => {
    assert.deepEqual(variantCoverage(batch, 2), { numerator: 1, denominator: 2, value: 0.5, status: 'measured' });
  });

  it('traceCoverage counts nodes with a truthy sourceRef prop over all nodes', () => {
    const r = traceCoverage(batch);
    assert.equal(r.denominator, batch.nodes.length);
    assert.equal(r.numerator, batch.nodes.length - 1); // TYPE_x has no sourceRef
  });
});

describe('v4 eval metrics — priceLinkCoverage (Wave-4 F, gate)', () => {
  it('a base with a priced FlowAccount line but no PRICED_AS edge counts in the denominator, not the numerator (1/2)', () => {
    const linkBatch: GraphBatchLike = {
      nodes: [
        { id: offerNodeId('BASE1'), labels: ['CatalogOffer'], props: {} },
        { id: offerNodeId('BASE2'), labels: ['CatalogOffer'], props: {} },
        { id: 'CSKU_1', labels: ['CommercialSKU'], props: { priceMissing: false } },
      ],
      edges: [
        { id: 'e1', from: offerNodeId('BASE1'), to: 'CSKU_1', rel: 'PRICED_AS' },
        // BASE2 has no PRICED_AS edge at all — the case this metric is meant to catch.
      ],
    };
    const lines = [
      { bucket: 'parsed', base: 'BASE1', unitPrice: 100 },
      { bucket: 'name_coded', base: 'BASE2', unitPrice: 200 },
      { bucket: 'unparsed', base: 'BASE3', unitPrice: 300 }, // not parsed/name_coded -> excluded entirely
      { bucket: 'parsed', base: 'BASE1', unitPrice: 0 }, // zero-price line alone wouldn't qualify BASE1, but the other BASE1 line does
    ];
    assert.deepEqual(priceLinkCoverage(linkBatch, lines), { numerator: 1, denominator: 2, value: 0.5, status: 'measured' });
  });

  it('a base whose PRICED_AS edge points at a priceMissing=true CommercialSKU does not count as linked', () => {
    const linkBatch: GraphBatchLike = {
      nodes: [
        { id: offerNodeId('BASE1'), labels: ['CatalogOffer'], props: {} },
        { id: 'CSKU_1', labels: ['CommercialSKU'], props: { priceMissing: true } },
      ],
      edges: [{ id: 'e1', from: offerNodeId('BASE1'), to: 'CSKU_1', rel: 'PRICED_AS' }],
    };
    const lines = [{ bucket: 'parsed', base: 'BASE1', unitPrice: 100 }];
    assert.deepEqual(priceLinkCoverage(linkBatch, lines), { numerator: 0, denominator: 1, value: 0, status: 'measured' });
  });

  it('no priced bases at all -> no_data, not a divide-by-zero crash', () => {
    assert.deepEqual(priceLinkCoverage({ nodes: [], edges: [] }, []), { numerator: 0, denominator: 0, value: 0, status: 'no_data' });
  });
});
