import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { Catalog, CatalogProduct } from '../../src/catalog/store.js';
import { unverifiedNumbers } from '../../src/answer/llm.js';
import {
  ConversationOptions,
  appendTurns,
  conversationKey,
  forgetConversation,
  loadConversation,
  pruneConversations,
} from '../../src/answer/memory.js';
import { answerConversation } from '../../src/answer/respond.js';
import { findWithinBudget, quotePrice, searchProducts } from '../../src/answer/tools.js';
import { emptyFakeRag, fakeRag, stubResult } from '../helpers/fake-rag.js';

function catalogOf(products: Omit<CatalogProduct, 'book'>[]): Catalog {
  const withBook = products.map((p) => ({ ...p, book: 'test' }));
  return { products: withBook, byCode: new Map(withBook.map((p) => [p.code.toUpperCase(), p])) };
}

const FAN: Omit<CatalogProduct, 'book'> = {
  code: 'TJS23-2', name: 'Turbo Handheld Fan + Umbrella',
  rmb: 32, upc: 20, dims: [47.5, 45.5, 51], kg: null, e: true,
};
const NO_CARTON: Omit<CatalogProduct, 'book'> = {
  code: 'TSQ02-2', name: 'Light humidifier + Umbrella',
  rmb: 46.5, upc: null, dims: null, kg: null, e: true,
};

const catalog = catalogOf([FAN, NO_CARTON]);
/*
 * The catalog graph knows nothing about these fixture SKUs, so `emptyFakeRag()` — a real
 * `GenesisLocalRag` wired to a scripted `fetch` that always answers "not found" (never
 * `unavailable`) — sends `quotePrice` straight through to the rmb-catalog fallback, exactly as
 * before `rag` existed. Tests that need graph-side results build their own fake rag instead.
 */
const evidenceBase = { catalog, exchangeRate: 5, shipMonth: 11, rag: emptyFakeRag() };

let root = '';
let memory: ConversationOptions;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-chat-'));
  memory = { root, hashKey: 'test-key', retentionHours: 24, maxTurns: 4 };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Chat memory', () => {
  it('keys a conversation without ever storing the LINE id', () => {
    const key = conversationKey('U0123456789abcdef', 'test-key');
    appendTurns(key, [{ role: 'user', text: 'TJS23-2', at: new Date().toISOString() }], memory);

    const written = fs.readFileSync(path.join(root, `${key}.json`), 'utf8');
    assert.ok(!written.includes('U0123456789abcdef'));
    assert.strictEqual(key.length, 32);
  });

  it('replays the recent turns and drops the older ones', () => {
    const key = 'k1';
    const at = new Date().toISOString();
    for (let i = 1; i <= 6; i++) {
      appendTurns(key, [{ role: 'user', text: `msg ${i}`, at }], memory);
    }

    const turns = loadConversation(key, memory);
    assert.strictEqual(turns.length, 4);
    assert.strictEqual(turns[0].text, 'msg 3');
    assert.strictEqual(turns[3].text, 'msg 6');
  });

  it('treats an expired conversation as no conversation, and deletes it', () => {
    const key = 'k2';
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    fs.writeFileSync(
      path.join(root, `${key}.json`),
      JSON.stringify({ key, updatedAt: old, turns: [{ role: 'user', text: 'old', at: old }] })
    );

    assert.deepStrictEqual(loadConversation(key, memory), []);
    assert.strictEqual(fs.existsSync(path.join(root, `${key}.json`)), false);
  });

  it('prunes every conversation past retention, and keeps the fresh ones', () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    fs.writeFileSync(path.join(root, 'fresh.json'), JSON.stringify({ updatedAt: now, turns: [] }));
    fs.writeFileSync(path.join(root, 'stale.json'), JSON.stringify({ updatedAt: old, turns: [] }));
    fs.writeFileSync(path.join(root, 'broken.json'), 'not json');

    assert.strictEqual(pruneConversations(memory), 2);
    assert.strictEqual(fs.existsSync(path.join(root, 'fresh.json')), true);
  });

  it('forgets one conversation on request', () => {
    const key = 'k3';
    appendTurns(key, [{ role: 'user', text: 'hi', at: new Date().toISOString() }], memory);
    assert.strictEqual(forgetConversation(key, memory), true);
    assert.strictEqual(forgetConversation(key, memory), false);
  });

  it('reads an unreadable file as an empty conversation rather than throwing', () => {
    fs.writeFileSync(path.join(root, 'bad.json'), '{{{');
    assert.deepStrictEqual(loadConversation('bad', memory), []);
  });
});

describe('The number check', () => {
  const evidence = JSON.stringify({ breaks: [{ quantity: 500, unitPriceThb: 340 }] });

  it('passes a figure that came from the evidence', () => {
    assert.deepStrictEqual(unverifiedNumbers('500 ชุด ชุดละ 340 บาท', evidence, ''), []);
  });

  it('catches a figure the evidence does not contain', () => {
    assert.deepStrictEqual(unverifiedNumbers('ชุดละ 315 บาท', evidence, ''), [315]);
  });

  it('accepts a figure the person themselves typed', () => {
    assert.deepStrictEqual(unverifiedNumbers('งบ 400 ยังไม่มีของที่เข้า', evidence, 'งบ 400'), []);
  });

  it('ignores small numbers, which are days and counts rather than prices', () => {
    assert.deepStrictEqual(unverifiedNumbers('ใช้เวลา 15-20 วัน', evidence, ''), []);
  });

  it('tolerates a rounded reading of an evidence figure', () => {
    const cost = JSON.stringify({ totalThb: 231.74 });
    assert.deepStrictEqual(unverifiedNumbers('ต้นทุน 232 บาท', cost, ''), []);
  });

  it('reads a comma-grouped figure as the same number', () => {
    const big = JSON.stringify({ unitPriceThb: 1200 });
    assert.deepStrictEqual(unverifiedNumbers('ชุดละ 1,200 บาท', big, ''), []);
  });
});

describe('Evidence handed to the model', () => {
  /*
   * `quotePrice` asks the catalog graph first (§5.7); none of these fixture SKUs are in it, so
   * `emptyFakeRag()` reports "not found" (never `unavailable`) and every one of these falls
   * through to the same rmb-catalog path exercised before `rag` existed.
   */
  it('gives a salesperson the price and nothing behind it', async () => {
    const evidence = await quotePrice('TJS23-2', 500, { ...evidenceBase, role: 'sales' });
    assert.strictEqual(evidence.priceSource, 'estimate_rmb');
    assert.strictEqual(evidence.quotable, true);
    assert.strictEqual(evidence.cost, undefined);
    assert.ok(evidence.breaks?.every((b) => b.landedUnitCostThb === undefined));
    assert.ok(evidence.breaks?.every((b) => b.grossMarginPct === undefined));
    /* Nothing the model could paraphrase into a cost: it is not in the packet at all. */
    assert.ok(!JSON.stringify(evidence).includes('markup'));
  });

  it('gives the owner the cost stack', async () => {
    const evidence = await quotePrice('TJS23-2', 500, { ...evidenceBase, role: 'owner' });
    assert.ok(evidence.cost);
    assert.ok(evidence.cost!.totalThb > 0);
  });

  it('answers an off-ladder quantity with the break above it', async () => {
    const evidence = await quotePrice('TJS23-2', 120, { ...evidenceBase, role: 'sales' });
    assert.strictEqual(evidence.priceAtQuantity?.askedQuantity, 120);
    assert.ok(evidence.priceAtQuantity!.usesBreak >= 120);
  });

  it('says plainly when the catalog cannot support a price', async () => {
    const evidence = await quotePrice('TSQ02-2', null, { ...evidenceBase, role: 'sales' });
    assert.strictEqual(evidence.quotable, false);
    assert.ok(evidence.missing?.includes('ข้อมูลกล่อง'));
  });

  it('reports a missing code rather than guessing a near match', async () => {
    const evidence = await quotePrice('NOPE-9', null, { ...evidenceBase, role: 'sales' });
    assert.strictEqual(evidence.found, false);
  });

  it('returns budget matches dearest first, so the best fit leads', async () => {
    const rag = fakeRag({
      search: () => ({
        results: [
          stubResult({
            id: 'm1',
            code: 'A1',
            name: 'Cheap',
            selectedPrice: { qtyTier: 500, unitPrice: 100, belowMoq: false, source: 'offer' },
          }),
          stubResult({
            id: 'm2',
            code: 'A2',
            name: 'Pricey',
            selectedPrice: { qtyTier: 500, unitPrice: 900, belowMoq: false, source: 'offer' },
          }),
        ],
      }),
    });
    const evidence = await findWithinBudget(500, 100000, { ...evidenceBase, role: 'sales', rag });
    const prices = evidence.matches.map((m) => m.unitPriceThb);
    assert.deepStrictEqual(prices, [...prices].sort((a, b) => b - a));
  });

  it('finds a product by name', async () => {
    const rag = fakeRag({
      search: () => ({
        results: [stubResult({ id: 'm1', code: 'TJS23-2', name: 'Turbo Handheld Fan + Umbrella' })],
      }),
    });
    const evidence = await searchProducts('fan', { ...evidenceBase, role: 'sales', rag });
    assert.strictEqual(evidence.matchCount, 1);
    assert.strictEqual(evidence.matches[0].code, 'TJS23-2');
  });
});

describe('Answering a conversation', () => {
  it('uses the pattern reader when no model is configured, and still answers', async () => {
    const result = await answerConversation('TJS23-2 100 ชุด', {
      ...evidenceBase,
      role: 'sales',
      conversationKey: 'k',
      memory,
      llm: null,
    });

    assert.strictEqual(result.source, 'rules');
    assert.strictEqual(result.reason, 'model disabled');
    assert.ok(result.text.includes('TJS23-2'));
  });

  it('does not record a turn when the model layer is off', async () => {
    await answerConversation('TJS23-2', {
      ...evidenceBase,
      role: 'sales',
      conversationKey: 'k',
      memory,
      llm: null,
    });
    /* Nothing was asked of a model, so there is nothing a later turn needs to refer back to. */
    assert.deepStrictEqual(loadConversation('k', memory), []);
  });
});
