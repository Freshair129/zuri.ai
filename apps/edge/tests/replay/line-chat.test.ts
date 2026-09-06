import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';

import type { Catalog } from '../../src/catalog/store.js';
import { answerConversation } from '../../src/answer/respond.js';
import { GenesisLocalRag } from '../../src/rag/genesis-rag.js';
import { formatCards, type SearchEvidenceV4 } from '../../src/answer/format-cards.js';
import type { ModelPort, ModelRequest } from '../../src/answer/model-port.js';
import type { ConversationOptions } from '../../src/answer/memory.js';
import { searchV4, priceV4 } from '../../src/rag/v4/search.js';
import { loadCategoryGroupMap, loadTypeAliases, aliasIndex } from '../../src/rag/v4/config.js';
import { buildSyntheticGraphDb, type Synthetic50Fixture } from '../fixtures/v4/synthetic-db.js';

/** Seventeen authored synthetic turns exercise the production answer/search/graph paths.
 * The model stub and lexical ranking prove wiring and constraints, not semantic model quality
 * or historical LINE behavior. No transcript or customer catalog is read. */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const synthetic50 = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'v4', 'synthetic-50.json'), 'utf8'),
) as Synthetic50Fixture;
const turnsFixture = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'v4', 'line-chat-turns.json'), 'utf8'),
) as Array<{ source: string; text: string }>;

const categoryMap = loadCategoryGroupMap();
const typeAliases = loadTypeAliases();
const { db, embed } = buildSyntheticGraphDb(synthetic50, categoryMap, typeAliases);
// typeNames/typeGroups mirror what `searchV4` needs to decorate a hit's `type`/`group`: every
// typeId known to the alias config, mapped to its Thai name and category group.
const typeNames = new Map<string, string>(typeAliases.types.map((t) => [t.typeId, t.name_th]));
const typeGroups = new Map<string, string>(Object.entries(categoryMap.typeToGroup));
const deps = { db, embed, aliases: aliasIndex(typeAliases), typeNames, typeGroups };

function fetchImplOverRealSearch(): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (u.endsWith('/api/rag/search')) {
      const result = await searchV4(deps, String(body.query ?? ''), {
        limit: body.limit as number | undefined,
        browseAll: body.browseAll === true,
        ...(body.qty !== undefined || body.budgetPerUnit !== undefined
          ? { overrides: { qty: body.qty as number | undefined, budgetPerUnit: body.budgetPerUnit as number | undefined } }
          : {}),
      });
      return new Response(JSON.stringify(result), { status: 200 });
    }
    if (u.endsWith('/api/rag/price')) {
      const result = await priceV4(deps, String(body.code ?? ''), (body.qty as number | null) ?? null);
      return new Response(JSON.stringify(result), { status: 200 });
    }
    if (u.endsWith('/health')) {
      return new Response(JSON.stringify({ ok: true, dbReady: true, embedReady: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }) as typeof fetch;
}

const rag = new GenesisLocalRag({ fetchImpl: fetchImplOverRealSearch() });

/** Turns whose text plausibly names a product/category, per the synthetic fixture text (§5.7 step 1
 * handles the actual exclude/qty/budget parsing; this is only the stub model's routing rule for
 * *whether* to call the search tool at all). */
const PRODUCT_QUERY_RX = /ไม่ใช่|มีกี่สี|มีตัวไหนบ้าง/;

interface Captured {
  tool: string;
  query: string;
  /** What the model was handed: trimmed to what an answer can use (`compactSearchForModel`). */
  shown: { matches?: Array<{ code: string | null; colors: string[] }>; unavailable?: true };
  /** What the system kept: the full record the cards and the number check read. */
  evidence: SearchEvidenceV4;
}

/** The full evidence for a query, recorded straight from the rag the tool also calls. */
const capturedFull = new Map<string, SearchEvidenceV4>();

function stubModelPort(capture: Captured[]): ModelPort {
  return {
    id: 'stub-replay',
    model: 'stub-replay',
    async generate(request: ModelRequest) {
      const userMsg = request.messages[request.messages.length - 1]?.content ?? '';
      if (!PRODUCT_QUERY_RX.test(userMsg)) {
        return { text: 'สวัสดีค่ะ ซูริพร้อมช่วยดูสินค้าหรือราคาได้ค่ะ' };
      }
      const tool = request.tools.find((t) => t.name === 'search_products');
      if (!tool) return { text: 'ขอโทษค่ะ ตอนนี้ยังช่วยไม่ได้ค่ะ' };
      capturedFull.set(userMsg, (await rag.searchProducts(userMsg, 5)) as SearchEvidenceV4);
      const raw = await tool.run({ query: userMsg } as never);
      // The tool's return value is the model's copy, which is deliberately not the full record any
      // more. The card path and the number check read the full one, so the replay holds both and
      // asserts each against the thing it is actually about.
      capture.push({
        tool: 'search_products',
        query: userMsg,
        shown: JSON.parse(raw),
        evidence: capturedFull.get(userMsg) ?? ({} as SearchEvidenceV4),
      });
      return { text: 'เดี๋ยวซูริเช็คตัวเลือกให้ค่ะ' };
    },
  };
}

const emptyCatalog: Catalog = { products: [], byCode: new Map() };

let memoryRoot = '';
let memory: ConversationOptions;

before(() => {
  memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-replay-'));
  memory = { root: memoryRoot, hashKey: 'replay-test-key', retentionHours: 24, maxTurns: 4 };
});

after(() => {
  fs.rmSync(memoryRoot, { recursive: true, force: true });
});

function hasDrinkware(results: SearchEvidenceV4['matches']): boolean {
  return results.some((r) => r.type?.id === 'drinkware' || r.components.some((c) => c.typeId === 'drinkware'));
}

async function runTurn(text: string, index: number): Promise<{ toolCalls: string[]; captured: Captured[] }> {
  const captured: Captured[] = [];
  const result = await answerConversation(text, {
    catalog: emptyCatalog,
    role: 'sales',
    exchangeRate: 5,
    rag,
    conversationKey: `replay-${index}`,
    memory,
    llm: { port: stubModelPort(captured), timeoutMs: 5000, maxIterations: 4 },
    headless: null,
  });
  return { toolCalls: result.toolCalls, captured };
}

describe('Replaying the 17 synthetic line-chat user turns over synthetic-50 (AC-D3)', () => {
  it('the fixture is exactly the 17 synthetic user turns, 4 of which are "ไม่ใช่แก้ว"', () => {
    assert.strictEqual(turnsFixture.length, 17);
    const excludeTurns = turnsFixture.filter((t) => t.text.includes('ไม่ใช่แก้ว'));
    assert.strictEqual(excludeTurns.length, 4);
  });

  it('answers every turn without throwing, recording whichever tools the stub model called', async () => {
    for (let i = 0; i < turnsFixture.length; i++) {
      const { toolCalls } = await runTurn(turnsFixture[i].text, i);
      assert.ok(Array.isArray(toolCalls));
    }
  });

  it('4x "ไม่ใช่แก้ว งบ 200 บาท": no drinkware in evidence, at least one result or nearest, and the positive control (same text minus the exclusion) finds drinkware', async () => {
    const excludeIndices = turnsFixture
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.text.includes('ไม่ใช่แก้ว'))
      .map(({ i }) => i);
    assert.strictEqual(excludeIndices.length, 4);

    for (const i of excludeIndices) {
      const text = turnsFixture[i].text;
      const { toolCalls, captured } = await runTurn(text, i);
      assert.ok(toolCalls.includes('search_products'), `expected turn ${i} ("${text}") to call search_products`);
      assert.strictEqual(captured.length, 1);
      const ev = captured[0].evidence;

      assert.strictEqual(ev.unavailable, undefined, `turn ${i} evidence unexpectedly unavailable: ${ev.reason}`);
      assert.strictEqual(hasDrinkware(ev.matches), false, `turn ${i}: drinkware leaked into matches despite ไม่ใช่แก้ว`);
      assert.strictEqual(hasDrinkware(ev.nearest), false, `turn ${i}: drinkware leaked into nearest despite ไม่ใช่แก้ว`);
      assert.ok(
        ev.nearest.length >= 1,
        `turn ${i}: expected at least one nearest result (budget 200 unmet against synthetic prices), got matches=${ev.matches.length} nearest=${ev.nearest.length}`,
      );

      // Positive control: the same request with the exclusion phrase removed must be able to find
      // drinkware — otherwise "no drinkware" above would be a vacuous pass (the fixture simply has
      // none reachable for this query), not evidence the exclude filter did anything. The real
      // budget (200 baht) is tight enough that even the un-excluded query trips budgetUnmet against
      // synthetic prices (matches=[]), so "surfaces drinkware" means either channel: an in-budget match
      // or a drinkware item in the nearest-3 shown when budget is unmet.
      const positiveQuery = text.replace('ไม่ใช่แก้ว', '').replace(/\s+/g, ' ').trim();
      const positiveEvidence = await rag.searchProducts(positiveQuery, 5);
      assert.strictEqual(positiveEvidence.unavailable, undefined);
      assert.strictEqual(
        hasDrinkware(positiveEvidence.matches) || hasDrinkware(positiveEvidence.nearest),
        true,
        `positive control "${positiveQuery}" (turn ${i} without ไม่ใช่แก้ว) should surface drinkware in matches or nearest`,
      );
    }
  });

  it('"แก้วน้ำมีกี่สี": the top match has at least one variant with a colour', async () => {
    const i = turnsFixture.findIndex((t) => t.text === 'แก้วน้ำมีกี่สี');
    assert.ok(i >= 0, 'fixture must contain the exact turn "แก้วน้ำมีกี่สี"');

    const { toolCalls, captured } = await runTurn(turnsFixture[i].text, i);
    assert.ok(toolCalls.includes('search_products'));
    const ev = captured[0].evidence;
    assert.strictEqual(ev.unavailable, undefined);
    assert.ok(ev.matches.length >= 1, 'expected at least one match for แก้วน้ำมีกี่สี');
    assert.ok(
      ev.matches[0].variants.some((v) => v.color),
      `expected matches[0] (${ev.matches[0].code ?? ev.matches[0].id}) to have at least one variant with a colour`,
    );
    // "how many colours?" is only answerable if the colours survive into the model's copy.
    const shown = captured[0].shown.matches?.[0];
    assert.ok(shown && shown.colors.length >= 1, 'the model must be shown the colours it is asked about');
  });

  it('formatCards(evidence) over the replay evidence never exceeds 5 cards', async () => {
    let sawAtLeastOneCall = false;
    for (let i = 0; i < turnsFixture.length; i++) {
      const { captured } = await runTurn(turnsFixture[i].text, i);
      for (const c of captured) {
        sawAtLeastOneCall = true;
        const cards = formatCards(c.evidence);
        assert.ok(cards.length <= 5, `turn ${i} ("${c.query}") produced ${cards.length} cards, expected <=5`);
      }
    }
    assert.ok(sawAtLeastOneCall, 'expected at least one search_products call across the 17 replayed turns');
  });

  it('greetings never call search_products', async () => {
    const greetingTexts = ['สวัสดี', 'สบายดีไหม', '@ซูริ', 'สวัสดี zuri ทำอะไรได้บ้าง'];
    for (const greeting of greetingTexts) {
      const i = turnsFixture.findIndex((t) => t.text === greeting);
      assert.ok(i >= 0, `fixture must contain the exact greeting turn "${greeting}"`);
      const { toolCalls } = await runTurn(turnsFixture[i].text, i);
      assert.ok(!toolCalls.includes('search_products'), `greeting "${greeting}" unexpectedly called search_products`);
    }
  });
});
