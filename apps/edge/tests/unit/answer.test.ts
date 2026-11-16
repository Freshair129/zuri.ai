import { describe, it } from 'node:test';
import { buildCodexEvidence } from '../../src/answer/codex-evidence.js';
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
  // ADR-119: the local cost-to-price calculator was removed, so the pattern reader no longer
  // quotes or searches by budget; it says so and never prints a price.
  it('does not compute a price for a known code, whatever the role', () => {
    for (const role of ['owner', 'sales'] as const) {
      const text = answerMessage('TJS23-2 100 ชุด', { ...base, role });
      assert.match(text, /ซูริยังคำนวณราคาในโหมดนี้ไม่ได้/);
      assert.ok(!/บาท\/ชุด|ต้นทุน|margin|ตัวคูณ/.test(text), 'no price or cost may appear');
    }
  });

  it('does not compute a budget search either', () => {
    const text = answerMessage('100 ชุด งบ 700', { ...base, role: 'sales' });
    assert.match(text, /ซูริยังคำนวณราคาในโหมดนี้ไม่ได้/);
    assert.ok(!text.includes('TJS2462') && !text.includes('TJS23-2'));
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

  describe('an empty catalogue (no data loaded) is not a lookup that found nothing', () => {
    const empty = { ...base, catalog: catalogOf([]) };

    it('gives the same cannot-answer copy for a search with no catalogue', () => {
      const text = answerMessage('umbrella', empty);
      assert.ok(!/ไม่เจอสินค้าที่ตรงกับ/.test(text));
      assert.match(text, /ตอบคำถามนี้ไม่ได้ตอนนี้/);
    });

    it('still answers help from an empty catalogue', () => {
      assert.match(answerMessage('ช่วย', empty), /ราคาตอบได้จากแคตตาล็อกที่เผยแพร่เท่านั้น/);
    });

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
