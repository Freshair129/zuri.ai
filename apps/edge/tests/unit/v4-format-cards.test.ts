import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCards, cardsToText, type CardPayload } from '../../src/answer/format-cards.js';
import type { SearchEvidenceV4 } from '../../src/answer/format-cards.js';
import type { ResultV4, SelectedPrice } from '../../src/rag/v4/search.js';

const mkResult = (o: Partial<ResultV4>): ResultV4 => ({
  kind: 'model',
  id: 'MODEL_001',
  code: 'TBY01',
  name: 'เครื่องนวดคอ',
  englishName: 'Neck Massager',
  type: { id: 'neck_massager', name_th: 'เครื่องนวดคอ' },
  group: { id: 'care_wellness' },
  score: 0.95,
  status: 'active',
  image: 'https://example.com/image.jpg',
  variants: [
    { skuId: 'SKU_1', displayCode: 'SKU-NM-BLK-STD', color: 'Black', size: null, material: null },
    { skuId: 'SKU_2', displayCode: 'SKU-NM-WHT-STD', color: 'White', size: null, material: null },
    { skuId: 'SKU_3', displayCode: 'SKU-NM-RED-STD', color: null, size: null, material: null },
  ],
  priceLadder: [
    { qtyTier: 10, unitPrice: 690, commercialSku: 'TBY01(P-14)-10', priceMissing: false, exportDate: '2026-06-21', offerCode: 'TBY01' },
    { qtyTier: 100, unitPrice: 490, commercialSku: 'TBY01(P-14)-100', priceMissing: false, exportDate: '2026-06-21', offerCode: 'TBY01' },
  ],
  selectedPrice: { qtyTier: 100, unitPrice: 490, belowMoq: false, source: 'offer' },
  components: [],
  customizations: [],
  sourceRef: {},
  ...o,
});

const mkEvidence = (o: Partial<SearchEvidenceV4>): SearchEvidenceV4 => ({
  query: 'เครื่องนวดคอ',
  parsed: { cleanText: 'เครื่องนวดคอ', excludeTypes: [], qty: null, budgetPerUnit: null, budgetTotal: null, budgetUnmet: false },
  matchCount: 0,
  matches: [],
  nearest: [],
  priceSource: 'commercial_sku',
  ...o,
});

describe('v4 format-cards', () => {
  it('7 matches → 5 cards (truncated)', () => {
    const matches = Array.from({ length: 7 }, (_, i) =>
      mkResult({ id: `MODEL_${i}`, code: `CODE${i}`, name: `Product ${i}` }),
    );
    const ev = mkEvidence({ matches, matchCount: 7 });
    const cards = formatCards(ev, 5);
    assert.equal(cards.length, 5);
    assert.deepEqual(
      cards.map((c) => c.id),
      matches.slice(0, 5).map((r) => r.id),
    );
  });

  it('colors = unique variants[].color non-null', () => {
    const result = mkResult({
      variants: [
        { skuId: '1', displayCode: 'A', color: 'Black', size: null, material: null },
        { skuId: '2', displayCode: 'B', color: 'Black', size: null, material: null },
        { skuId: '3', displayCode: 'C', color: 'White', size: null, material: null },
        { skuId: '4', displayCode: 'D', color: null, size: null, material: null },
      ],
    });
    const ev = mkEvidence({ matches: [result] });
    const cards = formatCards(ev);
    assert.deepEqual(cards[0].colors, ['Black', 'White']);
  });

  it('selectedPrice.qtyTier === parsed.qty when qty set', () => {
    const result = mkResult({
      selectedPrice: { qtyTier: 50, unitPrice: 550, belowMoq: false, source: 'offer' },
    });
    const ev = mkEvidence({
      matches: [result],
      parsed: { cleanText: '', excludeTypes: [], qty: 50, budgetPerUnit: null, budgetTotal: null, budgetUnmet: false },
    });
    const cards = formatCards(ev);
    assert.equal(cards[0].selectedPrice?.qtyTier, 50);
  });

  it('selectedPrice.qtyTier = min tier when qty not set', () => {
    const result = mkResult({
      priceLadder: [
        { qtyTier: 20, unitPrice: 600, commercialSku: 'C1', priceMissing: false },
        { qtyTier: 100, unitPrice: 490, commercialSku: 'C2', priceMissing: false },
      ],
      selectedPrice: { qtyTier: 20, unitPrice: 600, belowMoq: false, source: 'offer' },
    });
    const ev = mkEvidence({ matches: [result], parsed: { cleanText: '', excludeTypes: [], qty: null, budgetPerUnit: null, budgetTotal: null, budgetUnmet: false } });
    const cards = formatCards(ev);
    assert.equal(cards[0].selectedPrice?.qtyTier, 20);
  });

  it('status:review_required → reviewNote:ข้อมูลรอตรวจสอบ', () => {
    const result = mkResult({ status: 'review_required' });
    const ev = mkEvidence({ matches: [result] });
    const cards = formatCards(ev);
    assert.equal(cards[0].status, 'review_required');
    assert.equal(cards[0].reviewNote, 'ข้อมูลรอตรวจสอบ');
  });

  it('belowMoq → priceNote contains ขั้นต่ำ', () => {
    const result = mkResult({
      selectedPrice: { qtyTier: 10, unitPrice: 690, belowMoq: true, source: 'offer' },
    });
    const ev = mkEvidence({ matches: [result] });
    const cards = formatCards(ev);
    assert.ok(cards[0].priceNote?.includes('ขั้นต่ำ'));
  });

  it('unavailable:true → formatCards returns [] and cardsToText contains ขัดข้องชั่วคราว', () => {
    const ev = mkEvidence({ unavailable: true, reason: 'timeout' });
    const cards = formatCards(ev);
    assert.equal(cards.length, 0);
    const text = cardsToText([], ev);
    assert.ok(text.includes('ขัดข้องชั่วคราว'));
    assert.ok(!text.includes('SKU'));
    assert.ok(!text.match(/\(.*?\)/)); // no code in parentheses
  });

  it('budgetUnmet → text lists nearest with real prices and phrase ไม่มีสินค้าในงบ', () => {
    const nearest = [
      mkResult({ id: 'N1', code: 'C1', name: 'Product 1', selectedPrice: { qtyTier: 100, unitPrice: 1200, belowMoq: false, source: 'offer' } }),
      mkResult({ id: 'N2', code: 'C2', name: 'Product 2', selectedPrice: { qtyTier: 50, unitPrice: 950, belowMoq: false, source: 'offer' } }),
    ];
    const ev = mkEvidence({
      matches: [],
      nearest,
      parsed: { cleanText: '', excludeTypes: [], qty: 100, budgetPerUnit: 500, budgetTotal: null, budgetUnmet: true },
    });
    const cards = formatCards(ev);
    assert.equal(cards.length, 0);
    const text = cardsToText([], ev);
    assert.ok(text.includes('ไม่มีสินค้าในงบ'));
    assert.ok(text.includes('1200'));
    assert.ok(text.includes('950'));
  });

  it('cardsToText formats cards deterministically with Thai text', () => {
    const result = mkResult({
      code: 'TBY01',
      name: 'เครื่องนวดคอ',
      variants: [
        { skuId: '1', displayCode: 'A', color: 'White', size: null, material: null },
      ],
      selectedPrice: { qtyTier: 100, unitPrice: 490, belowMoq: false, source: 'offer' },
    });
    const card: CardPayload = {
      id: result.id,
      kind: result.kind,
      code: result.code,
      name: result.name,
      typeNameTh: 'เครื่องนวดคอ',
      colors: ['White'],
      sizes: [],
      selectedPrice: result.selectedPrice,
      priceNote: null,
      status: 'active',
      image: null,
      reviewNote: null,
    };
    const ev = mkEvidence({ parsed: { cleanText: '', excludeTypes: [], qty: 100, budgetPerUnit: null, budgetTotal: null, budgetUnmet: false } });
    const text = cardsToText([card], ev);
    assert.ok(text.includes('เครื่องนวดคอ'));
    assert.ok(text.includes('TBY01'));
    assert.ok(text.includes('White'));
    assert.ok(text.includes('490'));
  });

  it('cardsToText with no cards and no budgetUnmet returns meaningful message', () => {
    const ev = mkEvidence({ parsed: { cleanText: '', excludeTypes: [], qty: null, budgetPerUnit: null, budgetTotal: null, budgetUnmet: false } });
    const text = cardsToText([], ev);
    assert.ok(text.length > 0);
  });

  it('extracts sizes and materials from variants', () => {
    const result = mkResult({
      variants: [
        { skuId: '1', displayCode: 'A', color: 'Black', size: 'M', material: 'Plastic' },
        { skuId: '2', displayCode: 'B', color: 'White', size: 'L', material: 'Steel' },
        { skuId: '3', displayCode: 'C', color: 'Red', size: null, material: null },
      ],
    });
    const ev = mkEvidence({ matches: [result] });
    const cards = formatCards(ev);
    assert.deepEqual(cards[0].sizes.sort(), ['L', 'M'].sort());
  });

  it('offer kind is preserved', () => {
    const result = mkResult({ kind: 'offer', id: 'OFFER_001' });
    const ev = mkEvidence({ matches: [result] });
    const cards = formatCards(ev);
    assert.equal(cards[0].kind, 'offer');
  });

  it('null priceNote when not belowMoq', () => {
    const result = mkResult({
      selectedPrice: { qtyTier: 100, unitPrice: 490, belowMoq: false, source: 'offer' },
    });
    const ev = mkEvidence({ matches: [result] });
    const cards = formatCards(ev);
    assert.equal(cards[0].priceNote, null);
  });

  it('null reviewNote when status is not review_required', () => {
    const result = mkResult({ status: 'active' });
    const ev = mkEvidence({ matches: [result] });
    const cards = formatCards(ev);
    assert.equal(cards[0].reviewNote, null);
  });
});

describe('v4 format-cards text provenance (wave-2 gate defects)', () => {
  it('renders the export date from the price ladder, per-set units and the plan example format', () => {
    const ev: SearchEvidenceV4 = { query: 'q', parsed: null, matchCount: 1, matches: [mkResult({ variants: [{ skuId: 'S', displayCode: 'X', color: 'ขาว', size: null, material: null }] })], nearest: [], priceSource: 'commercial_sku' };
    const text = cardsToText(formatCards(ev), ev);
    assert.equal(text, '1) เครื่องนวดคอ (TBY01) — สี: ขาว — 100 ชุด: 490 บาท/ชุด (ราคาอ้างอิง ณ 21 มิ.ย. 2026)');
  });
  it('omits the as-of clause when the ladder has no export date', () => {
    const r = mkResult({}); r.priceLadder = r.priceLadder.map((t) => ({ ...t, exportDate: null }));
    const ev: SearchEvidenceV4 = { query: 'q', parsed: null, matchCount: 1, matches: [r], nearest: [], priceSource: 'commercial_sku' };
    const cards = formatCards(ev);
    assert.equal(cards[0].priceExportDate, null);
    assert.doesNotMatch(cardsToText(cards, ev), /ราคาอ้างอิง/);
  });
});
