import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraphV4, embeddableNodes } from '../../src/rag/v4/build-graph.js';
import { loadCategoryGroupMap, loadTypeAliases } from '../../src/rag/v4/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface QuerySetLine {
  id: string;
  text: string;
  expected: { kind: 'model' | 'type'; id: string };
  exclude: string[];
  qty: number | null;
  budget: number | null;
  group: string;
  intent: 'find' | 'compare' | 'color' | 'price';
}

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/v4/querysets');
const NL_PATH = path.join(FIXTURES_DIR, 'QS_NL_SYNTHETIC_v1.jsonl');
const LINE_PATH = path.join(FIXTURES_DIR, 'QS_LINE_SYNTHETIC_v1.jsonl');

// The 4 CategoryGroup ids from spec §5.1 / category-group-map.v1.json (AC-A1: CategoryGroup 4).
const VALID_GROUPS = new Set(['smart_tech', 'care_wellness', 'office', 'home_travel']);

function loadJsonl(p: string): QuerySetLine[] {
  const raw = readFileSync(p, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as QuerySetLine);
}

function assertSchema(line: QuerySetLine, file: string) {
  assert.equal(typeof line.id, 'string', `${file}: id must be a string`);
  assert.ok(line.id.length > 0, `${file}: id must be non-empty`);
  assert.equal(typeof line.text, 'string', `${file}: text must be a string`);
  assert.ok(line.text.length > 0, `${file}: text must be non-empty`);
  assert.ok(line.expected && typeof line.expected === 'object', `${file}: expected must be an object`);
  assert.ok(
    line.expected.kind === 'model' || line.expected.kind === 'type',
    `${file}: expected.kind must be 'model' | 'type'`
  );
  assert.equal(typeof line.expected.id, 'string', `${file}: expected.id must be a string`);
  assert.ok(Array.isArray(line.exclude), `${file}: exclude must be an array`);
  assert.ok(
    line.qty === null || typeof line.qty === 'number',
    `${file}: qty must be number|null`
  );
  assert.ok(
    line.budget === null || typeof line.budget === 'number',
    `${file}: budget must be number|null`
  );
  assert.equal(typeof line.group, 'string', `${file}: group must be a string`);
  assert.ok(
    VALID_GROUPS.has(line.group),
    `${file}: group must be one of ${[...VALID_GROUPS].join('|')}, got '${line.group}' (${line.id})`
  );
  assert.ok(
    ['find', 'compare', 'color', 'price'].includes(line.intent),
    `${file}: intent must be one of find|compare|color|price`
  );
  // no product codes leaking into customer-facing text
  assert.ok(
    !/\b[A-Z]{2,5}\d{2,4}(-\d+)?(\(P-\d+\))?-?\d*\b/.test(line.text),
    `${file}: text must not contain product codes: ${line.text}`
  );
}

describe('v4 query set fixtures', () => {
  it('QS_NL_SYNTHETIC_v1.jsonl exists with 60 well-formed lines', () => {
    assert.ok(existsSync(NL_PATH), `missing fixture ${NL_PATH}`);
    const lines = loadJsonl(NL_PATH);
    assert.equal(lines.length, 60, 'QS_NL_SYNTHETIC_v1 must have exactly 60 lines');

    const ids = new Set<string>();
    for (const line of lines) {
      assertSchema(line, 'QS_NL_SYNTHETIC_v1');
      assert.ok(!ids.has(line.id), `duplicate id ${line.id}`);
      ids.add(line.id);
    }
  });

  it('QS_LINE_SYNTHETIC_v1.jsonl exists with >= 6 lines', () => {
    assert.ok(existsSync(LINE_PATH), `missing fixture ${LINE_PATH}`);
    const lines = loadJsonl(LINE_PATH);
    assert.ok(lines.length >= 6, 'QS_LINE_SYNTHETIC_v1 must have at least 6 lines');
    for (const line of lines) {
      assertSchema(line, 'QS_LINE_SYNTHETIC_v1');
    }
    const uniqueTexts = new Set(lines.map((l) => l.text));
    assert.ok(uniqueTexts.size >= 3, 'QS_LINE_SYNTHETIC_v1 must contain at least 3 unique texts');
  });

  it('QS_NL_SYNTHETIC_v1 meets exclude/qty/budget coverage thresholds', () => {
    const lines = loadJsonl(NL_PATH);
    const excludeCount = lines.filter((l) => l.exclude.length > 0).length;
    const qtyCount = lines.filter((l) => l.qty !== null).length;
    const budgetCount = lines.filter((l) => l.budget !== null).length;
    assert.ok(excludeCount >= 12, `exclude coverage ${excludeCount} < 12`);
    assert.ok(qtyCount >= 12, `qty coverage ${qtyCount} < 12`);
    assert.ok(budgetCount >= 12, `budget coverage ${budgetCount} < 12`);
  });

  it('synthetic expected.id resolves against the bundled identity without a customer data root', () => {
    const { identity } = JSON.parse(readFileSync(path.join(FIXTURES_DIR, '..', 'synthetic-50.json'), 'utf8')) as { identity: {
      productMasters: Array<{ productId: string; typeId: string | null }>;
      componentLinks: Array<{ typeId: string | null }>;
    } };
    const productIds = new Set(identity.productMasters.map((m) => m.productId));
    const typeIds = new Set<string>();
    for (const m of identity.productMasters) {
      if (m.typeId) typeIds.add(m.typeId);
    }
    for (const c of identity.componentLinks) {
      if (c.typeId) typeIds.add(c.typeId);
    }

    const nlLines = loadJsonl(NL_PATH);
    const lineLines = loadJsonl(LINE_PATH);
    for (const line of [...nlLines, ...lineLines]) {
      if (line.expected.kind === 'model') {
        assert.ok(
          productIds.has(line.expected.id),
          `${line.id}: expected.id ${line.expected.id} not found in productMasters`
        );
      } else {
        assert.ok(
          typeIds.has(line.expected.id),
          `${line.id}: expected.id ${line.expected.id} not found in observed typeIds`
        );
      }
    }
  });

  it('retains group, intent and specific-model query coverage', () => {
    const lines = loadJsonl(NL_PATH);
    for (const group of VALID_GROUPS) {
      const groupLines = lines.filter(l => l.group === group);
      assert.equal(groupLines.length, 15);
      for (const intent of ['find', 'compare', 'color', 'price']) {
        assert.ok(groupLines.filter(l => l.intent === intent).length >= 3);
      }
    }
    assert.equal(lines.filter(l => l.expected.kind === 'model').length, 18);
    for (const intent of ['find', 'compare', 'color', 'price']) {
      assert.equal(lines.filter(l => l.intent === intent).length, 15);
    }
  });

  it('synthetic graph and offer queries have complete references and price tiers', () => {
    const fixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, '..', 'synthetic-50.json'), 'utf8'));
    const ref = { file: 'synthetic-50.json', sha256: 'synthetic', rowKey: 'root' };
    const batch = buildGraphV4({ ...fixture, categoryMap: loadCategoryGroupMap(), aliases: loadTypeAliases(), refs: { identity: ref, catalog: ref, flowaccount: ref } });
    assert.equal(batch.stats.ProductModel, 50);
    assert.equal(batch.stats.PhysicalVariant, 319);
    assert.equal(batch.stats.CatalogOffer, 82);
    assert.equal(batch.stats.CommercialSKU, 142);
    assert.equal(fixture.identity.componentLinks.length, 188);
    assert.equal(embeddableNodes(batch).length, 132);
    const ids = new Set(batch.nodes.map(n => n.id));
    assert.equal(ids.size, batch.nodes.length);
    assert.equal(new Set(batch.edges.map(e => e.id)).size, batch.edges.length);
    for (const edge of batch.edges) {
      assert.ok(ids.has(edge.from), `missing source ${edge.from}`);
      assert.ok(ids.has(edge.to), `missing target ${edge.to}`);
    }
    const offers = new Map<string, any>(fixture.identity.offers.map((o: any) => [o.offerId, o]));
    const queryRows = readFileSync(path.join(FIXTURES_DIR, 'QS_OFFER_SYNTHETIC_v1.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(queryRows.length, 1005);
    assert.equal(new Set(queryRows.map(q => q.id)).size, 1005);
    for (const q of queryRows) {
      assert.equal(offers.get(q.offerId)?.sourceCode, q.sourceCode);
      const expected = [...new Set(fixture.identity.componentLinks.filter((l: any) => l.offerId === q.offerId).map((l: any) => l.productId))].sort();
      assert.deepEqual([...q.expected.ids].sort(), expected);
      for (const id of q.expected.ids) assert.ok(ids.has(id));
    }
    for (const offer of offers.values()) {
      const tiers = fixture.flowaccount.lines.filter((l: any) => l.base === offer.sourceCode);
      assert.ok(tiers.length >= 1);
      assert.ok(tiers.every((l: any) => l.unitPrice > 200 && l.qtyTier > 0));
      if (tiers.length === 2) {
        assert.ok(tiers[1].qtyTier > tiers[0].qtyTier);
        assert.ok(tiers[1].unitPrice < tiers[0].unitPrice);
      }
    }
  });
});
