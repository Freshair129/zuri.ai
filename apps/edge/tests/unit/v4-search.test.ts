import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cosineFromEngineScore, searchV4, priceV4, selectTier, type SearchDeps, type PriceTier } from '../../src/rag/v4/search.js';
import { RagUnavailableError } from '../../src/rag/v4/http-client.js';
import {
  FIXTURE_BATCH, buildFakeDb, buildFakeEmbedClient, TYPE_NAMES, TYPE_GROUPS, ALIASES,
} from '../fixtures/v4/fake-db.js';
import { buildGraphV4, embeddableNodes, type BuildInputs } from '../../src/rag/v4/build-graph.js';
import { parseFlowAccountRows } from '../../src/rag/v4/flowaccount.js';
import { loadCategoryGroupMap, loadTypeAliases, aliasIndex } from '../../src/rag/v4/config.js';
import type { FlowAccountRow } from '../../src/rag/v4/flowaccount.js';

const identityMiniFixture = new URL('../fixtures/v4/identity-mini.json', import.meta.url);
const catalogMiniFixture = new URL('../fixtures/v4/catalog-mini.json', import.meta.url);
const flowaccountRowsMiniFixture = new URL('../fixtures/v4/flowaccount-rows-mini.json', import.meta.url);

function deps(script: Array<Array<{ id: string; score: number }>>, opts?: { throwOnSearch?: boolean }) {
  const db = buildFakeDb(FIXTURE_BATCH, script, opts);
  const d: SearchDeps = { db, embed: buildFakeEmbedClient(), aliases: ALIASES, typeNames: TYPE_NAMES, typeGroups: TYPE_GROUPS };
  return { db, deps: d };
}

describe('v4 search — cosineFromEngineScore', () => {
  it('matches 1 - (1-s)^2/2', () => {
    assert.equal(cosineFromEngineScore(0.9), 1 - 0.1 ** 2 / 2);
    assert.equal(cosineFromEngineScore(0.7), 1 - 0.3 ** 2 / 2);
  });
});

describe('v4 search — searchV4', () => {
  it('excludes SKU/Variant hits from results', async () => {
    const { deps: d } = deps([[{ id: 'SKU_M1_BLACK', score: 0.9 }, { id: 'VARIANT_M1_BLACK', score: 0.85 }, { id: 'PRODUCT_M1', score: 0.8 }]]);
    const res = await searchV4(d, 'ของขวัญ');
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].id, 'PRODUCT_M1');
  });

  it('two hits with distinct engine scores get distinct cosine scores', async () => {
    const { deps: d } = deps([[{ id: 'PRODUCT_M1', score: 0.9 }, { id: 'PRODUCT_M2', score: 0.7 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 2 });
    assert.equal(res.results.length, 2);
    assert.equal(res.results[0].score, 1 - 0.1 ** 2 / 2);
    assert.equal(res.results[1].score, 1 - 0.3 ** 2 / 2);
    assert.notEqual(res.results[0].score, res.results[1].score);
  });

  it('exclude [drinkware] drops Model M3 and the Offer whose componentTypeIds contains drinkware', async () => {
    const { deps: d } = deps([[
      { id: 'PRODUCT_M3', score: 0.9 }, { id: 'OFFER_TDRINK01', score: 0.85 }, { id: 'PRODUCT_M1', score: 0.6 },
    ]]);
    const res = await searchV4(d, 'ของขวัญ ไม่ใช่แก้วน้ำ', { limit: 1 });
    assert.deepEqual(res.parsed.excludeTypes, ['drinkware']);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].id, 'PRODUCT_M1');
  });

  it('re-queries with k:160 once when filtered hits are below limit', async () => {
    const { db, deps: d } = deps([
      [{ id: 'PRODUCT_M1', score: 0.9 }, { id: 'PRODUCT_M2', score: 0.8 }],
      [{ id: 'PRODUCT_M1', score: 0.9 }, { id: 'PRODUCT_M2', score: 0.8 }, { id: 'OFFER_TDRINK01', score: 0.5 }],
    ]);
    const res = await searchV4(d, 'ของขวัญ'); // default limit 5, first call yields 2 < 5
    assert.equal(db.calls.hybridSearch.length, 2);
    assert.equal(db.calls.hybridSearch[0].k, 40);
    assert.equal(db.calls.hybridSearch[1].k, 160);
    assert.equal(res.timing.k, 160);
  });

  it('selectTier: 100 -> tier 100, 30 -> tier 20, 5 -> tier 10 + belowMoq, null -> lowest', () => {
    const ladder: PriceTier[] = [
      { qtyTier: 10, unitPrice: 690, commercialSku: 'A', priceMissing: false },
      { qtyTier: 20, unitPrice: 550, commercialSku: 'B', priceMissing: false },
      { qtyTier: 100, unitPrice: 490, commercialSku: 'C', priceMissing: false },
    ];
    assert.deepEqual(selectTier(ladder, 100), { qtyTier: 100, unitPrice: 490, belowMoq: false, source: 'offer' });
    assert.deepEqual(selectTier(ladder, 30), { qtyTier: 20, unitPrice: 550, belowMoq: false, source: 'offer' });
    assert.deepEqual(selectTier(ladder, 5), { qtyTier: 10, unitPrice: 690, belowMoq: true, source: 'offer' });
    assert.deepEqual(selectTier(ladder, null), { qtyTier: 10, unitPrice: 690, belowMoq: false, source: 'offer' });
  });

  it('budget 200 removes the priced Offer but keeps a priceless Model', async () => {
    const { deps: d } = deps([[{ id: 'OFFER_TDRINK01', score: 0.9 }, { id: 'PRODUCT_M3', score: 0.8 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 2, overrides: { budgetPerUnit: 200 } });
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].id, 'PRODUCT_M3');
    assert.equal(res.results[0].selectedPrice, null);
    assert.equal(res.parsed.budgetUnmet, false);
  });

  it('budget filter drops an unpriced Offer but keeps an unpriced Model (AC-C4: only Model is exempt)', async () => {
    const { deps: d } = deps([[{ id: 'OFFER_TSET99', score: 0.9 }, { id: 'PRODUCT_M3', score: 0.8 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 2, overrides: { budgetPerUnit: 200 } });
    assert.deepEqual(res.results.map((r) => r.id), ['PRODUCT_M3']);
    assert.equal(res.parsed.budgetUnmet, false);
  });

  it('budget filter drops an unpriced Offer entirely, tripping budgetUnmet when nothing else survives', async () => {
    const { deps: d } = deps([[{ id: 'OFFER_TSET99', score: 0.9 }, { id: 'OFFER_TDRINK01', score: 0.5 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 2, overrides: { budgetPerUnit: 100 } });
    assert.deepEqual(res.results, []);
    assert.equal(res.parsed.budgetUnmet, true);
    assert.deepEqual(res.nearest.map((r) => r.id), ['OFFER_TDRINK01']);
  });

  it('budget that removes everything sets budgetUnmet and returns nearest sorted by unitPrice', async () => {
    const { deps: d } = deps([[
      { id: 'OFFER_TDRINK01', score: 0.9 }, { id: 'OFFER_TBY01', score: 0.85 }, { id: 'OFFER_TSP07-2', score: 0.7 },
    ]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 3, overrides: { budgetPerUnit: 100 } });
    assert.deepEqual(res.results, []);
    assert.equal(res.parsed.budgetUnmet, true);
    assert.equal(res.nearest.length, 3);
    assert.deepEqual(res.nearest.map((r) => r.id), ['OFFER_TDRINK01', 'OFFER_TBY01', 'OFFER_TSP07-2']);
    assert.deepEqual(res.nearest.map((r) => r.selectedPrice?.unitPrice), [470, 690, 2110]);
  });

  it('widens to k=2000 once when the first hits hold nothing priced outside the excluded types (AC-C5 non-vacuous nearest)', async () => {
    // script: call 1 (k 40) → only a drinkware offer (excluded) and a priceless model; call 2 (k 160) same;
    // call 3 (k 2000) → the priced non-drinkware offers appear.
    const { db, deps: d } = deps([
      [{ id: 'OFFER_TDRINK01', score: 0.9 }, { id: 'PRODUCT_M3', score: 0.8 }],
      [{ id: 'OFFER_TDRINK01', score: 0.9 }, { id: 'PRODUCT_M3', score: 0.8 }],
      [{ id: 'OFFER_TDRINK01', score: 0.9 }, { id: 'OFFER_TBY01', score: 0.85 }, { id: 'OFFER_TSP07-2', score: 0.7 }],
    ]);
    const res = await searchV4(d, 'ของขวัญดูดี ไม่ใช่แก้ว งบ 200 บาท', { limit: 5 });
    assert.deepEqual(res.parsed.excludeTypes, ['drinkware']);
    assert.equal(res.parsed.budgetUnmet, true);
    assert.ok(db.calls.hybridSearch.some((c) => c.k === 2000), 'must widen to the whole collection');
    assert.deepEqual(res.nearest.map((r) => r.id), ['OFFER_TBY01', 'OFFER_TSP07-2']);
    assert.ok(res.nearest.every((r) => r.type?.id !== 'drinkware' && !r.components.some((c) => c.typeId === 'drinkware')));
    assert.equal(res.timing.k, 2000);
  });

  it('nearest[] is top-3 by SEMANTIC rank (not the 3 globally cheapest), then price-sorted (AC-C5)', async () => {
    // Engine order (score desc): TDRINK01(470), TBY01(690), TSP07-2(2110), TTOY01(300, rank 4, cheapest of all).
    // A pure "3 globally cheapest" sort would pick TTOY01/TDRINK01/TBY01 and drop TSP07-2.
    // The correct rule takes the top-3 by semantic rank first (dropping TTOY01), then price-sorts those 3.
    const { deps: d } = deps([[
      { id: 'OFFER_TDRINK01', score: 0.9 }, { id: 'OFFER_TBY01', score: 0.85 },
      { id: 'OFFER_TSP07-2', score: 0.7 }, { id: 'OFFER_TTOY01', score: 0.6 },
    ]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 4, overrides: { budgetPerUnit: 100 } });
    assert.deepEqual(res.results, []);
    assert.equal(res.parsed.budgetUnmet, true);
    assert.equal(res.nearest.length, 3);
    assert.deepEqual(res.nearest.map((r) => r.id), ['OFFER_TDRINK01', 'OFFER_TBY01', 'OFFER_TSP07-2']);
    assert.deepEqual(res.nearest.map((r) => r.selectedPrice?.unitPrice), [470, 690, 2110]);
    assert.ok(!res.nearest.some((r) => r.id === 'OFFER_TTOY01'));
  });

  it('Model M2 gets priceLadder via SINGLE_OF (source offer); Model M1 via CONTAINS (source via_offer)', async () => {
    const { deps: d } = deps([[{ id: 'PRODUCT_M1', score: 0.9 }, { id: 'PRODUCT_M2', score: 0.8 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 2 });
    const m1 = res.results.find((r) => r.id === 'PRODUCT_M1')!;
    const m2 = res.results.find((r) => r.id === 'PRODUCT_M2')!;
    assert.equal(m1.selectedPrice?.source, 'via_offer');
    assert.equal(m1.selectedPrice?.unitPrice, 2110);
    assert.equal(m2.selectedPrice?.source, 'offer');
    assert.equal(m2.selectedPrice?.unitPrice, 690);
  });

  it('Model results carry the orderable offer code and the price export date (wave-2 gate defects 1-2)', async () => {
    const { deps: d } = deps([[{ id: 'PRODUCT_M1', score: 0.9 }, { id: 'PRODUCT_M2', score: 0.8 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 2 });
    const m1 = res.results.find((r) => r.id === 'PRODUCT_M1')!;
    const m2 = res.results.find((r) => r.id === 'PRODUCT_M2')!;
    assert.equal(m2.code, 'TBY01');
    assert.equal(m1.code, 'TSP07-2');
    for (const t of [...m1.priceLadder, ...m2.priceLadder]) {
      assert.equal(t.exportDate, '2026-06-21');
      assert.ok(t.offerCode, 'tier must name its offer');
    }
  });

  it('expands Model neighbors with explicit rels/direction (HAS_VARIANT out)', async () => {
    const { db, deps: d } = deps([[{ id: 'PRODUCT_M1', score: 0.9 }]]);
    await searchV4(d, 'ของขวัญ', { limit: 1 });
    const call = db.calls.neighbors.find((c) => c.seed === 'PRODUCT_M1' && c.a.direction === 'out');
    assert.ok(call);
    assert.deepEqual(call!.a.rels, ['HAS_VARIANT']);
  });

  it('dedupes duplicate hit ids to one result', async () => {
    const { deps: d } = deps([[{ id: 'PRODUCT_M1', score: 0.9 }, { id: 'PRODUCT_M1', score: 0.5 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 5 });
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].id, 'PRODUCT_M1');
  });

  it('hybridSearch throwing rejects with RagUnavailableError', async () => {
    const { deps: d } = deps([[]], { throwOnSearch: true });
    await assert.rejects(() => searchV4(d, 'ของขวัญ'), RagUnavailableError);
  });

  it('positive control: query without exclude returns >= 1 drinkware result', async () => {
    const { deps: d } = deps([[{ id: 'PRODUCT_M3', score: 0.9 }, { id: 'PRODUCT_M1', score: 0.8 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 2 });
    assert.ok(res.results.some((r) => r.type?.id === 'drinkware'));
  });

  it('Wave-4 A.2: neighbors() calls are proportional to `limit`, not to the number of hits (12 hits, limit 5)', async () => {
    const localBatch = {
      nodes: Array.from({ length: 12 }, (_, i) => ({
        id: `PRODUCT_T${i}`,
        labels: ['ProductModel'],
        props: {
          displayName: `Test model ${i}`, englishName: null, typeId: null, status: 'auto',
          sourceRef: null, priceTiers: [], priceSource: null, offerCodes: [],
        },
      })),
      edges: [],
      stats: {},
    };
    const script = [Array.from({ length: 12 }, (_, i) => ({ id: `PRODUCT_T${i}`, score: 0.99 - i * 0.01 }))];
    const { db, deps: d } = deps(script as any);
    // Swap in a batch with 12 distinct, edge-less nodes so every hit is a real candidate.
    const { buildFakeDb } = await import('../fixtures/v4/fake-db.js');
    const localDb = buildFakeDb(localBatch as any, script);
    const d2 = { ...d, db: localDb };
    const res = await searchV4(d2, 'ของขวัญ', { limit: 5 });
    assert.equal(res.results.length, 5);
    // Phase 2 (neighbors expansion) runs only for the final `results` (+ `nearest`, empty here):
    // one HAS_VARIANT neighbors() call per sliced result, never per raw hit.
    assert.equal(localDb.calls.neighbors.length, 5);
    void db;
  });

  it('Wave-4 A.2: a node missing props.priceTiers (pre-Wave-4 store) rejects with store_schema_outdated', async () => {
    const localBatch = {
      nodes: [
        { id: 'PRODUCT_OLD', labels: ['ProductModel'], props: { displayName: 'Old', englishName: null, typeId: null, status: 'auto', sourceRef: null } },
      ],
      edges: [],
      stats: {},
    };
    const { buildFakeDb } = await import('../fixtures/v4/fake-db.js');
    const localDb = buildFakeDb(localBatch as any, [[{ id: 'PRODUCT_OLD', score: 0.9 }]]);
    const d2 = { db: localDb, embed: buildFakeEmbedClient(), aliases: ALIASES, typeNames: TYPE_NAMES, typeGroups: TYPE_GROUPS };
    await assert.rejects(
      () => searchV4(d2, 'ของขวัญ'),
      (err: unknown) => err instanceof RagUnavailableError && err.reason === 'store_schema_outdated',
    );
  });
});

describe('v4 search — browseAll (gate defect 3)', () => {
  it('browseAll: hybridSearch called once with k 2000, never re-queries even if filtered < limit', async () => {
    const { db, deps: d } = deps([[{ id: 'OFFER_TDRINK01', score: 0.9 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 5, browseAll: true });
    assert.equal(db.calls.hybridSearch.length, 1);
    assert.equal(db.calls.hybridSearch[0].k, 2000);
    assert.equal(res.timing.k, 2000);
  });

  it('browseAll + budget: priced results sorted by selectedPrice.unitPrice DESCENDING (closest to budget first)', async () => {
    const { deps: d } = deps([[
      { id: 'OFFER_TSP07-2', score: 0.5 }, { id: 'OFFER_TDRINK01', score: 0.9 }, { id: 'OFFER_TBY01', score: 0.7 },
    ]]);
    const res = await searchV4(d, '', { limit: 5, browseAll: true, overrides: { budgetPerUnit: 3000 } });
    assert.deepEqual(res.results.map((r) => r.id), ['OFFER_TSP07-2', 'OFFER_TBY01', 'OFFER_TDRINK01']);
    assert.deepEqual(res.results.map((r) => r.selectedPrice?.unitPrice), [2110, 690, 470]);
  });

  it('empty query + budgetPerUnit auto-enables browseAll (k 2000, single hybridSearch call)', async () => {
    const { db, deps: d } = deps([[{ id: 'OFFER_TDRINK01', score: 0.9 }]]);
    const res = await searchV4(d, '', { limit: 5, overrides: { budgetPerUnit: 3000 } });
    assert.equal(db.calls.hybridSearch.length, 1);
    assert.equal(db.calls.hybridSearch[0].k, 2000);
    assert.equal(res.timing.k, 2000);
  });

  it('nearest[] semantics stay unchanged under browseAll when budget removes everything', async () => {
    const { deps: d } = deps([[
      { id: 'OFFER_TDRINK01', score: 0.9 }, { id: 'OFFER_TBY01', score: 0.85 }, { id: 'OFFER_TSP07-2', score: 0.7 },
    ]]);
    const res = await searchV4(d, '', { limit: 5, browseAll: true, overrides: { budgetPerUnit: 100 } });
    assert.deepEqual(res.results, []);
    assert.equal(res.parsed.budgetUnmet, true);
    assert.deepEqual(res.nearest.map((r) => r.id), ['OFFER_TDRINK01', 'OFFER_TBY01', 'OFFER_TSP07-2']);
  });
});

describe('v4 search — labelFilter (Wave-4 B)', () => {
  it('labelFilter set -> first hybridSearch call uses k = max(opts.k ?? 40, 400)', async () => {
    const { db, deps: d } = deps([[{ id: 'PRODUCT_M1', score: 0.9 }]]);
    await searchV4(d, 'ของขวัญ', { limit: 5, labelFilter: ['model'] });
    assert.equal(db.calls.hybridSearch.length, 1);
    assert.equal(db.calls.hybridSearch[0].k, 400);
  });

  it('labelFilter respects an explicit opts.k larger than 400', async () => {
    const { db, deps: d } = deps([[{ id: 'PRODUCT_M1', score: 0.9 }]]);
    await searchV4(d, 'ของขวัญ', { limit: 5, labelFilter: ['model'], k: 500 });
    assert.equal(db.calls.hybridSearch[0].k, 500);
  });

  it('labelFilter: [\'model\'] drops Offer hits before exclude/budget/dedupe', async () => {
    const { deps: d } = deps([[
      { id: 'PRODUCT_M1', score: 0.9 }, { id: 'OFFER_TBY01', score: 0.85 }, { id: 'PRODUCT_M2', score: 0.7 },
    ]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 5, labelFilter: ['model'] });
    assert.deepEqual(res.results.map((r) => r.kind), ['model', 'model']);
    assert.ok(!res.results.some((r) => r.id === 'OFFER_TBY01'));
  });

  it('labelFilter: [\'offer\'] drops Model hits', async () => {
    const { deps: d } = deps([[
      { id: 'PRODUCT_M1', score: 0.9 }, { id: 'OFFER_TBY01', score: 0.85 },
    ]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 5, labelFilter: ['offer'] });
    assert.deepEqual(res.results.map((r) => r.id), ['OFFER_TBY01']);
  });

  it('no labelFilter -> k stays at the default (40), unaffected', async () => {
    const { db, deps: d } = deps([[{ id: 'PRODUCT_M1', score: 0.9 }]]);
    await searchV4(d, 'ของขวัญ', { limit: 5 });
    assert.equal(db.calls.hybridSearch[0].k, 40);
  });
});

describe('v4 search — priceV4', () => {
  it('known code TBY01 qty 100 -> found, 3-tier ladder, unitPrice 490, exportDate 2026-06-21', async () => {
    const { deps: d } = deps([[]]);
    const res = await priceV4(d, 'TBY01', 100);
    assert.equal(res.found, true);
    assert.equal(res.code, 'TBY01');
    assert.equal(res.priceLadder.length, 3);
    assert.deepEqual(res.priceLadder.map((t) => t.qtyTier), [10, 20, 100]);
    assert.equal(res.selectedPrice?.unitPrice, 490);
    assert.equal(res.selectedPrice?.qtyTier, 100);
    assert.equal(res.exportDate, '2026-06-21');
  });

  it('unknown code -> found false, empty ladder, selectedPrice null', async () => {
    const { deps: d } = deps([[]]);
    const res = await priceV4(d, 'NOPE99', 10);
    assert.equal(res.found, false);
    assert.equal(res.code, 'NOPE99');
    assert.deepEqual(res.priceLadder, []);
    assert.equal(res.selectedPrice, null);
  });
});

// --- Wave-2 follow-up, moved out of the RUN_STORE_TESTS gate (Wave-4 D) so it always runs: "T16
// must add one test that runs searchV4 over buildGraphV4(identity-mini.json) so the real
// builder's node/edge shape (not the hand-written tests/fixtures/v4/fake-db.ts, which was written
// before T9 landed and can drift from it) is exercised end-to-end through the search pipeline."
// This test is pure/in-memory (buildFakeDb + a fake embed client, no real store) and never needed
// the real GenesisDatabase/embed sidecar RUN_STORE_TESTS gates it previously sat behind.
describe('v4 search — searchV4 over the real buildGraphV4(identity-mini.json) output (Wave-2 follow-up)', () => {
  it('exercises the real builder node/edge shape, not the hand-written fake-db fixture', async () => {
    const identity = JSON.parse(fs.readFileSync(identityMiniFixture, 'utf8')) as BuildInputs['identity'];
    const catalog = JSON.parse(fs.readFileSync(catalogMiniFixture, 'utf8')) as BuildInputs['catalog'];
    const rows: FlowAccountRow[] = JSON.parse(fs.readFileSync(flowaccountRowsMiniFixture, 'utf8'));
    const flowaccount = parseFlowAccountRows(rows);
    const categoryMap = loadCategoryGroupMap();
    const typeAliases = loadTypeAliases();
    const batch = buildGraphV4({
      identity,
      catalog,
      flowaccount,
      categoryMap,
      aliases: typeAliases,
      refs: {
        identity: { file: 'identity-review.json', sha256: 'x', rowKey: '' },
        catalog: { file: 'catalog-2026.json', sha256: 'x', rowKey: '' },
        flowaccount: { file: 'flowaccount.xlsx', sha256: 'x', rowKey: '' },
      },
    });
    const toEmbed = embeddableNodes(batch);
    assert.equal(toEmbed.length, 6, 'models(3) + offers(3) from the real builder over identity-mini.json');

    // Script hybridSearch to surface PRODUCT_M1 (the real builder's notebook model) first.
    const db = buildFakeDb(batch as any, [[{ id: 'PRODUCT_M1', score: 0.95 }, { id: 'PRODUCT_M2', score: 0.7 }]]);
    const fakeEmbed = { async embed(texts: string[]) { return texts.map(() => [1, 0, 0]); }, async health() { return { ok: true }; } };
    const searchDeps: SearchDeps = {
      db,
      embed: fakeEmbed as any,
      aliases: aliasIndex(typeAliases),
      typeNames: new Map(typeAliases.types.map((tt) => [tt.typeId, tt.name_th])),
      typeGroups: new Map(Object.entries(categoryMap.typeToGroup)),
    };
    const res = await searchV4(searchDeps, 'สมุดโน้ต power bank', { limit: 5 });
    assert.equal(res.results[0]?.id, 'PRODUCT_M1');
    assert.equal(res.results[0]?.englishName, 'Notebook Powerbank');
    // Real builder's PhysicalVariant/PhysicalSKU shape must round-trip through search.ts's
    // HAS_VARIANT/HAS_SKU expansion (this is exactly what fake-db.ts's hand-written batch could
    // silently diverge from — see the Wave-2 follow-up note this test exists to close).
    assert.ok(res.results[0]!.variants.length >= 1, 'expected >=1 variant expanded from the real builder output');
    assert.ok(res.results[0]!.variants.some((v) => v.color === 'Black'));
  });
});

describe('result ordering: unorderable sink, priced-first nudge', () => {
  // OFFER_TBY01 is priced; OFFER_TSET99 has a code but no price; PRODUCT_M3 (drinkware
  // model) has neither a code nor a price in the fixture — nothing to quote or order.
  it('under commercial intent a priced result overtakes an unpriced near-tie (measured gap 0.02), but not a clear winner', async () => {
    const near = deps([[{ id: 'OFFER_TSET99', score: 0.90 }, { id: 'OFFER_TBY01', score: 0.88 }]]);
    const resNear = await searchV4(near.deps, 'ของขวัญ 100 ชุด', { limit: 2 });
    assert.equal(resNear.results[0].id, 'OFFER_TBY01', 'priced item must win a near-tie');
    assert.equal(resNear.results[0].score, cosineFromEngineScore(0.88), 'reported score stays raw');

    // Engine scores are squashed by cosineFromEngineScore (1 - (1-s)^2/2): 0.95 vs 0.85 is only a
    // 0.010 reported gap, i.e. still a near-tie; 0.95 vs 0.70 is 0.044, beyond the 0.03 nudge.
    const far = deps([[{ id: 'OFFER_TSET99', score: 0.95 }, { id: 'OFFER_TBY01', score: 0.70 }]]);
    const resFar = await searchV4(far.deps, 'ของขวัญ 100 ชุด', { limit: 2 });
    assert.equal(resFar.results[0].id, 'OFFER_TSET99', 'a clear semantic winner with a code keeps its rank');
  });

  it('a result with no code and no price sinks below every orderable result, whatever its score', async () => {
    const commercial = deps([[{ id: 'PRODUCT_M3', score: 0.95 }, { id: 'OFFER_TBY01', score: 0.85 }]]);
    const resC = await searchV4(commercial.deps, 'ของขวัญ 100 ชุด', { limit: 2 });
    assert.deepEqual(resC.results.map((r) => r.id), ['OFFER_TBY01', 'PRODUCT_M3']);

    const browse = deps([[{ id: 'PRODUCT_M3', score: 0.95 }, { id: 'OFFER_TSET99', score: 0.80 }]]);
    const resB = await searchV4(browse.deps, 'ของขวัญ', { limit: 2 });
    assert.deepEqual(resB.results.map((r) => r.id), ['OFFER_TSET99', 'PRODUCT_M3'], 'browsing too: a coded item beats an unorderable one');
    assert.equal(resB.results[1].score, cosineFromEngineScore(0.95), 'the sunk result still reports its raw score');
  });

  it('a browse query (no qty/budget) keeps pure semantic order among orderable results', async () => {
    const { deps: d } = deps([[{ id: 'OFFER_TSET99', score: 0.884 }, { id: 'OFFER_TBY01', score: 0.882 }]]);
    const res = await searchV4(d, 'ของขวัญ', { limit: 2 });
    assert.equal(res.results[0].id, 'OFFER_TSET99', 'browsing must not reorder by price');
  });
});
