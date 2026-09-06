import { describe, it } from 'node:test';
import { buildCodexEvidence } from '../../src/answer/codex-evidence.js';
import { HEADLESS_TOOLS_NOTE, headlessToolsNote } from '../../src/answer/respond.js';
import { suggestsUnseenProducts, unverifiedNumbers } from '../../src/answer/llm.js';
import assert from 'node:assert';

import { parseMessage } from '../../src/answer/parse.js';
import { answerMessage } from '../../src/answer/respond.js';
import { Catalog, CatalogProduct } from '../../src/catalog/store.js';

// @tested SDD-010 — the conversational answer stack across its pattern, API and headless layers.

function catalogOf(products: Omit<CatalogProduct, 'book'>[]): Catalog {
  const withBook = products.map((p) => ({ ...p, book: 'test' }));
  return { products: withBook, byCode: new Map(withBook.map((p) => [p.code.toUpperCase(), p])) };
}

const FAN: Omit<CatalogProduct, 'book'> = {
  code: 'TJS23-2', name: 'Turbo Handheld Fan + Umbrella',
  rmb: 32, upc: 20, dims: [47.5, 45.5, 51], kg: null, e: true,
};
const BOTTLE: Omit<CatalogProduct, 'book'> = {
  code: 'TJS2462', name: '600ml Plastic bottle + Umbrella',
  rmb: 26, upc: 20, dims: [47.5, 45.5, 51], kg: null, e: false,
};
/** An older block: cost known, packing never stated. */
const NO_CARTON: Omit<CatalogProduct, 'book'> = {
  code: 'TSQ02-2', name: 'Light humidifier + Umbrella',
  rmb: 46.5, upc: null, dims: null, kg: null, e: true,
};

const catalog = catalogOf([FAN, BOTTLE, NO_CARTON]);
const base = { catalog, exchangeRate: 5, shipMonth: 11 } as const;

describe('Reading the question', () => {
  it('pulls the item code out of a sentence', () => {
    assert.deepStrictEqual(parseMessage('ขอราคา TJS23-2 หน่อย'), {
      kind: 'price', sku: 'TJS23-2', quantity: null,
    });
  });

  it('reads code and quantity together', () => {
    assert.deepStrictEqual(parseMessage('TJS23-2 100 ชุด'), {
      kind: 'price', sku: 'TJS23-2', quantity: 100,
    });
    assert.deepStrictEqual(parseMessage('tjs2462 1,000 pcs'), {
      kind: 'price', sku: 'TJS2462', quantity: 1000,
    });
  });

  it('reads a quantity and a budget as a search', () => {
    assert.deepStrictEqual(parseMessage('100 ชุด งบ 300'), {
      kind: 'budget', quantity: 100, maxPriceThb: 300,
    });
    assert.deepStrictEqual(parseMessage('อยากได้ 200 ชิ้น ไม่เกิน 250 บาท'), {
      kind: 'budget', quantity: 200, maxPriceThb: 250,
    });
  });

  it('prefers the code when both a code and a budget appear', () => {
    // Someone who typed a code knows which product they mean.
    const intent = parseMessage('TJS23-2 100 ชุด งบ 300');
    assert.strictEqual(intent.kind, 'price');
  });

  it('treats bare words as a product search', () => {
    assert.deepStrictEqual(parseMessage('ร่ม กระติก'), { kind: 'search', query: 'ร่ม กระติก' });
  });

  it('does not invent a search out of a bare number', () => {
    assert.strictEqual(parseMessage('100').kind, 'unknown');
  });

  it('recognises a request for help', () => {
    assert.strictEqual(parseMessage('ช่วย').kind, 'help');
    assert.strictEqual(parseMessage('?').kind, 'help');
  });
});

describe('Answering, by role', () => {
  it('quotes every break for a known code', () => {
    const text = answerMessage('TJS23-2', { ...base, role: 'owner' });
    assert.ok(text.includes('TJS23-2'));
    assert.ok(text.includes('500 ชุด'));
    assert.ok(text.includes('ต้นทุนรวม'), 'the owner sees the cost stack');
  });

  it('never shows cost or margin to sales', () => {
    const text = answerMessage('TJS23-2 100 ชุด', { ...base, role: 'sales' });
    assert.ok(text.includes('ราคาต่อชุด'));
    assert.ok(!text.includes('ต้นทุนรวม'));
    assert.ok(!text.includes('margin'));
    assert.ok(!/ตัวคูณ/.test(text));
  });

  it('answers an off-ladder quantity with the break above it, never below', () => {
    const text = answerMessage('TJS23-2 150 ชุด', { ...base, role: 'sales' });
    assert.match(text, /ใช้ราคาขั้น 300 ชุด/);
  });

  it('says what is missing rather than guessing a price', () => {
    const text = answerMessage('TSQ02-2', { ...base, role: 'owner' });
    assert.match(text, /ยังคำนวณราคาให้ไม่ได้/);
    assert.match(text, /ข้อมูลกล่อง/);
    assert.ok(!/บาท\/ชุด/.test(text), 'no price may appear when the carton is unknown');
  });

  it('lists what fits a budget, dearest first', () => {
    const text = answerMessage('100 ชุด งบ 700', { ...base, role: 'sales' });
    assert.match(text, /เจอ \d+ รายการ/);
    assert.ok(text.includes('TJS2462') || text.includes('TJS23-2'));
  });

  it('suggests a way forward when nothing fits the budget', () => {
    const text = answerMessage('100 ชุด งบ 20', { ...base, role: 'sales' });
    assert.match(text, /ยังไม่มีสินค้าที่เข้างบ/);
  });

  it('keeps cost out of a budget search run by sales', () => {
    const text = answerMessage('100 ชุด งบ 700', { ...base, role: 'sales' });
    assert.ok(!text.includes('ต้นทุน'));
    assert.ok(!text.includes('margin'));
  });

  it('finds products by name, including ones it cannot yet price', () => {
    // All three fixtures carry "Umbrella"; TSQ02-2 has no carton data but should still be findable,
    // so a person can see it exists and ask the factory for the missing figures.
    const text = answerMessage('umbrella', { ...base, role: 'sales' });
    assert.match(text, /เจอ 3 รายการ/);
    assert.ok(text.includes('TSQ02-2'));
  });

  it('narrows as terms are added rather than widening', () => {
    const broad = answerMessage('umbrella', { ...base, role: 'sales' });
    const narrow = answerMessage('umbrella bottle', { ...base, role: 'sales' });
    assert.match(broad, /เจอ 3 รายการ/);
    assert.match(narrow, /เจอ 1 รายการ/);
  });

  it('says plainly when a code is not in the catalog', () => {
    const text = answerMessage('ZZ99-9', { ...base, role: 'owner' });
    assert.match(text, /ไม่เจอรหัส ZZ99-9/);
  });
});

describe('codex evidence block (v4 prompt-carried evidence)', () => {

  const ev = (over: Partial<import('../../src/answer/format-cards.js').SearchEvidenceV4> = {}) => ({
    query: 'แก้วน้ำมีกี่สี', parsed: null, matchCount: 1, nearest: [], priceSource: 'commercial_sku' as const,
    matches: [{
      kind: 'model' as const, id: 'PRODUCT_X', code: 'TBS01-2', name: 'แก้วเก็บอุณหภูมิ', englishName: 'Vacuum flask',
      type: { id: 'drinkware', name_th: 'แก้วน้ำ' }, group: { id: 'home_travel' }, score: 0.9, status: 'auto', image: null,
      variants: [{ skuId: 'S1', displayCode: 'SKU-D', color: 'Black', size: '500', material: null }],
      priceLadder: [{ qtyTier: 100, unitPrice: 780, commercialSku: 'TBS01-2(P-05)-100', priceMissing: false, exportDate: '2026-06-21', offerCode: 'TBS01-2' }],
      selectedPrice: { qtyTier: 100, unitPrice: 780, belowMoq: false, source: 'offer' as const },
      components: [], customizations: [], sourceRef: {},
    }],
    ...over,
  });
  it('carries the card text and the only-from-this rule', () => {
    const b = buildCodexEvidence(ev());
    assert.equal(b.unavailable, false);
    assert.match(b.block, /ข้อมูลจริงจากแคตตาล็อก/);
    assert.match(b.block, /TBS01-2/);
    assert.match(b.block, /780/);
    assert.match(b.block, /ห้ามแต่งเพิ่ม/);
    assert.match(b.evidenceText, /780/);
  });
  it('unavailable service becomes an explicit outage instruction with empty evidence', () => {
    const b = buildCodexEvidence({ ...ev(), matches: [], matchCount: 0, unavailable: true } as never);
    assert.equal(b.unavailable, true);
    assert.equal(b.evidenceText, '');
    assert.match(b.block, /ขัดข้องชั่วคราว/);
    assert.match(b.block, /ห้ามเดา/);
  });
  it('the number check accepts figures present in the evidence and rejects invented ones', () => {

    const b = buildCodexEvidence(ev());
    assert.deepEqual(unverifiedNumbers('รุ่น TBS01-2 100 ชุด ชุดละ 780 บาทค่ะ', b.evidenceText, 'แก้วน้ำมีกี่สี'), []);
    assert.deepEqual(unverifiedNumbers('ชุดละ 555 บาทค่ะ', b.evidenceText, 'แก้วน้ำมีกี่สี'), [555]);
  });
});

describe('headless tools note (claude deferred MCP)', () => {
  it('names every smartgift tool and the exact select incantation', () => {
    for (const t of ['search_products', 'quote_price', 'find_within_budget', 'lead_time', 'explain_policy']) {
      assert.match(HEADLESS_TOOLS_NOTE, new RegExp(`mcp__smartgift__${t}`));
    }
    assert.match(HEADLESS_TOOLS_NOTE, /select:mcp__smartgift__search_products,mcp__smartgift__quote_price/);
    assert.match(HEADLESS_TOOLS_NOTE, /ห้ามสรุปว่าไม่มีเครื่องมือ/);
  });
});

describe('headless tools note is actually reachable by the model', () => {
  it('names every catalog tool for both CLIs', () => {
    for (const bin of ['claude', 'codex']) {
      const note = headlessToolsNote(bin);
      for (const t of ['search_products', 'quote_price', 'find_within_budget', 'lead_time', 'explain_policy']) {
        assert.match(note, new RegExp(`mcp__smartgift__${t}`), `${bin} note is missing ${t}`);
      }
      assert.match(note, /ห้ามสรุปว่าไม่มีเครื่องมือ/, `${bin} note must forbid claiming the tools are absent`);
    }
  });

  it('keeps the ToolSearch step for claude and drops it for codex', () => {
    // claude defers MCP schemas and must load them by exact name first; codex surfaces every
    // mcp__smartgift__* tool on turn one, so telling it to load them sends it after a tool that
    // does not exist.
    assert.match(headlessToolsNote('claude'), /ToolSearch/);
    assert.doesNotMatch(headlessToolsNote('codex'), /ToolSearch/);
    assert.doesNotMatch(headlessToolsNote('codex'), /ต้องโหลดก่อนใช้/);
  });

  it('resolves by binary name, however the path is written', () => {
    assert.equal(headlessToolsNote('C:/tools/codex.exe'), headlessToolsNote('codex'));
    assert.equal(headlessToolsNote('/usr/local/bin/claude'), headlessToolsNote('claude'));
  });
});

describe('a reply may not offer products the model never looked up', () => {
  /*
   * `unverifiedNumbers` refuses an invented price. This is the same promise one level up: asked
   * for a New Year gift with no type named, the model answered without calling a tool and offered
   * เสื้อผ้า, ไฟ LED and ของแต่งโต๊ะทำงาน — none of which SmartGift sells.
   */
  const invented = 'อยากได้ของขวัญปีใหม่ 100 ชุด บอกมาหน่อยนะครับ เช่น กระติกน้ำ เสื้อผ้า ไฟ LED';

  it('catches a menu of products offered with no evidence behind it', () => {
    assert.equal(suggestsUnseenProducts(invented, 0), true);
  });

  it('leaves the same sentence alone once a tool has actually been called', () => {
    // The guard is about *ungrounded* suggestions. With evidence in the turn the numbers check
    // and the catalog itself are what constrain the reply, and this must not second-guess them.
    assert.equal(suggestsUnseenProducts(invented, 1), false);
  });

  it('leaves a bare clarifying question alone, which carries no claim at all', () => {
    // Asking without offering is the behaviour we want when the brief is too vague to search on.
    assert.equal(suggestsUnseenProducts('ต้องการสินค้าประเภทไหนครับ และงบต่อชุดเท่าไหร่', 0), false);
    assert.equal(suggestsUnseenProducts('รบกวนแจ้งจำนวนที่จะสั่งด้วยค่ะ', 0), false);
  });

  it('recognises the other ways Thai introduces a list', () => {
    for (const marker of ['เช่น', 'ตัวอย่างเช่น', 'อาทิ', 'ได้แก่']) {
      assert.equal(suggestsUnseenProducts(`มีหลายแบบ ${marker} ร่ม กระเป๋า`, 0), true, marker);
    }
  });

  it('does not fire on a reply that has no suggestion in it', () => {
    assert.equal(suggestsUnseenProducts('ยังไม่พบสินค้าที่ตรงกับคำค้นนี้ค่ะ', 0), false);
  });
});
