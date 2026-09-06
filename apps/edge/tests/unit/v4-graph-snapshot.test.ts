// Contract for the Live Graph Viewer's data source.
//
// The viewer had been rendering an empty canvas because `/api/graph` was documented but never
// implemented. These tests pin the properties that make the replacement actually usable, each of
// which was a real defect during development: a tree instead of a graph, a hairball around four
// universal nodes, dots with no edges, and captions that were raw store ids.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildGraphSnapshot, DEFAULT_NODE_LIMIT } from '../../src/rag/v4/graph-snapshot.js';
import type { GraphDb } from '../../src/rag/v4/search.js';
import { SKU_PKG_GIFTBOX_STD } from '../../src/rag/v4/schema.js';

interface FakeNode { id: string; labels: string[]; props: Record<string, unknown> }
interface FakeEdge { from: string; to: string; rel: string; props?: Record<string, unknown> }

/**
 * A store stub with the shape that matters: a taxonomy spine plus offers that pull SKUs from more
 * than one type. `neighbors` returns every adjacent node together with the whole adjacency as the
 * path — deliberately NOT pairing path[i] with node[i], because the real engine does not guarantee
 * that pairing and an early version of the walk assumed it did.
 */
function fakeDb(nodes: FakeNode[], edges: FakeEdge[]): GraphDb & { calls: string[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const calls: string[] = [];
  return {
    calls,
    async hybridSearch() {
      throw new Error('not used by buildGraphSnapshot');
    },
    async neighbors(seed: string) {
      calls.push(seed);
      if (!byId.has(seed)) throw new Error(`no such node ${seed}`);
      const touching = edges.filter((e) => e.from === seed || e.to === seed);
      const neighbourIds = [...new Set(touching.map((e) => (e.from === seed ? e.to : e.from)))];
      const path = touching.map((e) => ({ rel: e.rel, from: e.from, to: e.to, props: e.props ?? {} }));
      return neighbourIds
        .map((id) => byId.get(id))
        .filter((n): n is FakeNode => !!n)
        .map((node) => ({ node, path }));
    },
  };
}

/** Two groups, two types, two models, and one offer spanning both types. */
function catalogFixture(): { nodes: FakeNode[]; edges: FakeEdge[] } {
  const nodes: FakeNode[] = [
    { id: 'CATGROUP_smart_tech', labels: ['CategoryGroup'], props: { name_th: 'สมาร์ตเทค', name_en: 'Smart Tech' } },
    { id: 'CATGROUP_office', labels: ['CategoryGroup'], props: { name_th: 'ออฟฟิศ', name_en: 'Office' } },
    { id: 'TYPE_power_bank', labels: ['ProductType'], props: { typeId: 'power_bank', name_th: 'พาวเวอร์แบงก์' } },
    { id: 'TYPE_notebook', labels: ['ProductType'], props: { typeId: 'notebook', name_th: 'สมุดโน้ต' } },
    { id: 'PRODUCT_PB', labels: ['ProductModel'], props: { displayName: 'Power Bank', typeId: 'power_bank', offerCodes: ['SET01'] } },
    { id: 'PRODUCT_NB', labels: ['ProductModel'], props: { displayName: 'Notebook', typeId: 'notebook', offerCodes: ['SET01'] } },
    { id: 'PHYSICAL_VARIANT_PB', labels: ['PhysicalVariant'], props: { colors: ['Black', 'Blue', 'Red'], sizes: [], materials: [] } },
    { id: 'PHYSICAL_VARIANT_NB', labels: ['PhysicalVariant'], props: { colors: [], sizes: [], materials: [] } },
    { id: 'SKU_PB', labels: ['PhysicalSKU'], props: { displayCode: 'SKU-POWER-BANK-BLK' } },
    { id: 'SKU_NB', labels: ['PhysicalSKU'], props: { displayCode: 'SKU-NOTEBOOK-A5' } },
    { id: 'OFFER_SET01', labels: ['CatalogOffer'], props: { code: 'SET01', name_th: 'ชุดของขวัญ' } },
    // The universal nodes: attached to every offer in the real store.
    { id: 'CUSTOM_screen_logo', labels: ['CustomizationOption'], props: { name_th: 'สกรีนโลโก้' } },
    { id: SKU_PKG_GIFTBOX_STD, labels: ['PhysicalSKU'], props: { displayCode: 'SKU-PKG-GIFTBOX-STD', kind: 'packaging' } },
  ];
  const edges: FakeEdge[] = [
    { from: 'TYPE_power_bank', to: 'CATGROUP_smart_tech', rel: 'IN_GROUP' },
    { from: 'TYPE_notebook', to: 'CATGROUP_office', rel: 'IN_GROUP' },
    { from: 'PRODUCT_PB', to: 'TYPE_power_bank', rel: 'IN_TYPE' },
    { from: 'PRODUCT_NB', to: 'TYPE_notebook', rel: 'IN_TYPE' },
    { from: 'PRODUCT_PB', to: 'PHYSICAL_VARIANT_PB', rel: 'HAS_VARIANT' },
    { from: 'PRODUCT_NB', to: 'PHYSICAL_VARIANT_NB', rel: 'HAS_VARIANT' },
    { from: 'PHYSICAL_VARIANT_PB', to: 'SKU_PB', rel: 'HAS_SKU' },
    { from: 'PHYSICAL_VARIANT_NB', to: 'SKU_NB', rel: 'HAS_SKU' },
    { from: 'OFFER_SET01', to: 'SKU_PB', rel: 'CONTAINS' },
    { from: 'OFFER_SET01', to: 'SKU_NB', rel: 'CONTAINS' },
    { from: 'OFFER_SET01', to: 'CUSTOM_screen_logo', rel: 'CUSTOMIZABLE_WITH' },
    { from: 'OFFER_SET01', to: SKU_PKG_GIFTBOX_STD, rel: 'CONTAINS' },
  ];
  return { nodes, edges };
}

describe('v4 graph snapshot', () => {
  it('returns the viewer-shaped payload the page reads', async () => {
    const { nodes, edges } = catalogFixture();
    const snap = await buildGraphSnapshot(fakeDb(nodes, edges));
    assert.ok(Array.isArray(snap.nodes) && Array.isArray(snap.edges));
    for (const n of snap.nodes) {
      for (const key of ['id', 'label', 'name', 'status'] as const) {
        assert.equal(typeof n[key], 'string', `node ${n.id} missing ${key}`);
      }
    }
    for (const e of snap.edges) {
      assert.equal(typeof e.from, 'string');
      assert.equal(typeof e.to, 'string');
      assert.equal(typeof e.rel, 'string');
    }
  });

  it('reaches offers, not just the taxonomy spine — an offer is what links two types together', async () => {
    const { nodes, edges } = catalogFixture();
    const snap = await buildGraphSnapshot(fakeDb(nodes, edges));
    assert.ok(snap.nodes.some((n) => n.id === 'OFFER_SET01'), 'the offer must be in the snapshot');
    const contains = snap.edges.filter((e) => e.rel === 'CONTAINS');
    assert.equal(contains.length, 2, 'both real CONTAINS edges survive (packaging excluded)');
  });

  it('excludes the universal nodes that would collapse the layout', async () => {
    const { nodes, edges } = catalogFixture();
    const snap = await buildGraphSnapshot(fakeDb(nodes, edges));
    assert.ok(!snap.nodes.some((n) => n.label === 'CustomizationOption'), 'branding options are a constant');
    assert.ok(!snap.nodes.some((n) => n.id === SKU_PKG_GIFTBOX_STD), 'the standard gift box is a constant');
    assert.ok(!snap.edges.some((e) => e.rel === 'CUSTOMIZABLE_WITH'));
    assert.ok(!snap.edges.some((e) => e.to === SKU_PKG_GIFTBOX_STD));
  });

  it('emits no isolated node and no dangling edge — both are noise on a canvas', async () => {
    const { nodes, edges } = catalogFixture();
    const snap = await buildGraphSnapshot(fakeDb(nodes, edges));
    const ids = new Set(snap.nodes.map((n) => n.id));
    for (const e of snap.edges) {
      assert.ok(ids.has(e.from) && ids.has(e.to), `dangling edge ${e.from}->${e.to}`);
    }
    const degree = new Map<string, number>();
    for (const e of snap.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    for (const n of snap.nodes) assert.ok((degree.get(n.id) ?? 0) > 0, `isolated node ${n.id}`);
  });

  it('never captions a node with a raw store id', async () => {
    const { nodes, edges } = catalogFixture();
    const snap = await buildGraphSnapshot(fakeDb(nodes, edges));
    for (const n of snap.nodes) assert.notEqual(n.name, n.id, `${n.id} fell through to its raw id`);

    const byId = new Map(snap.nodes.map((n) => [n.id, n]));
    assert.equal(byId.get('OFFER_SET01')?.name, 'ชุดของขวัญ', 'Thai name preferred');
    assert.equal(byId.get('SKU_PB')?.name, 'SKU-POWER-BANK-BLK', 'SKU uses its display code');
    assert.equal(byId.get('PHYSICAL_VARIANT_PB')?.name, 'Black, Blue +1', 'a variant is named by its attributes');
  });

  it('falls back to a readable handle when a node has no nameable prop at all', async () => {
    const { nodes, edges } = catalogFixture();
    const snap = await buildGraphSnapshot(fakeDb(nodes, edges));
    const bare = snap.nodes.find((n) => n.id === 'PHYSICAL_VARIANT_NB');
    assert.ok(bare, 'the attribute-less variant is present');
    assert.notEqual(bare!.name, bare!.id);
    assert.ok(bare!.name.length < bare!.id.length, 'the fallback is shorter than the id');
  });

  it('counts labels over the nodes it actually returns', async () => {
    const { nodes, edges } = catalogFixture();
    const snap = await buildGraphSnapshot(fakeDb(nodes, edges));
    const counted = snap.nodes.reduce<Record<string, number>>((acc, n) => {
      acc[n.label] = (acc[n.label] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(snap.label_counts, counted);
  });

  it('honours the node budget and reports that it truncated', async () => {
    const { nodes, edges } = catalogFixture();
    const snap = await buildGraphSnapshot(fakeDb(nodes, edges), { limit: 4 });
    assert.ok(snap.nodes.length <= 4, `expected <= 4 nodes, got ${snap.nodes.length}`);
    assert.equal(snap.truncated, true);
  });

  it('survives a seed that is not in the store instead of failing the whole request', async () => {
    // Only two of the 32 configured types exist here; the rest throw on neighbors().
    const { nodes, edges } = catalogFixture();
    const db = fakeDb(nodes, edges);
    const snap = await buildGraphSnapshot(db);
    assert.ok(snap.nodes.length > 0, 'missing seeds must not empty the snapshot');
    assert.ok(db.calls.length > 2, 'the walk still attempted every configured root');
  });

  it('defaults to a budget the viewer can actually lay out', () => {
    assert.ok(DEFAULT_NODE_LIMIT > 0 && DEFAULT_NODE_LIMIT <= 700, 'the viewer stops simulating past 700');
  });
});
