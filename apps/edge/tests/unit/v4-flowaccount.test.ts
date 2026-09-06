import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCode, parseFlowAccountRows, readFlowAccountXlsx, buildUnpricedWorklist, FlowAccountSchemaError, type FlowAccountRow } from '../../src/rag/v4/flowaccount.js';

const rows: FlowAccountRow[] = JSON.parse(fs.readFileSync(new URL('../fixtures/v4/flowaccount-rows.json', import.meta.url), 'utf8'));

describe('v4 flowaccount parseCode', () => {
  it('parses code, group and qty', () => {
    assert.deepEqual(parseCode('SXY01(P-14)-100'), { base: 'SXY01', group: 'P-14', qty: 100 });
    assert.deepEqual(parseCode('SXY03-2(P-20)-500'), { base: 'SXY03-2', group: 'P-20', qty: 500 });
    assert.deepEqual(parseCode('SXY0762(P-PT)-10'), { base: 'SXY0762', group: 'P-PT', qty: 10 });
    assert.deepEqual(parseCode('SXY04'), { base: 'SXY04', group: null, qty: null });
    assert.deepEqual(parseCode(' sxy1x-4(P-02)-50 '), { base: 'SXY1X-4', group: 'P-02', qty: 50 });
  });
  it('rejects the known unparseable shapes', () => {
    for (const c of ['BAD-801-(400)100', 'W258', 'CK-003']) assert.equal(parseCode(c), null, c);
  });

  // RCA-PRICE-DATA-LOSS follow-up: these two shapes were previously in the "rejects" list above —
  // priced rows with bare-letter suffixes and five-digit bases previously fell into the
  // 'unparsed' bucket and never reached the graph, purely because CODE_RX couldn't read them.
  it('recovers a base with no digits before its dash-variant suffix, when a group follows (SYN-2)', () => {
    // "SYN-2" has no digit run at all between the letters and the dash — unlike SXY03-2 (digits
    // "03" then "-2"), there is nothing before the dash here. The base regex only accepts this
    // shape when a "(P-...)" group immediately follows, which is what distinguishes it from a
    // plain "BASE-003" quantity suffix (see the CK-003 rejection above and the false-positive
    // note below).
    assert.deepEqual(parseCode('SYN-2(P-02)-500'), { base: 'SYN-2', group: 'P-02', qty: 500 });
    assert.deepEqual(parseCode('SYN-2(P-02)-10'), { base: 'SYN-2', group: 'P-02', qty: 10 });
  });

  it('recovers a 5-digit numeric run in the base (SY05601)', () => {
    // The digit run was capped at 4 digits, one short of SY05601's 5.
    assert.deepEqual(parseCode('SY05601(P-09)-20'), { base: 'SY05601', group: 'P-09', qty: 20 });
  });

  it('does not turn a plain "BASE-digits" quantity code into a false base+qty split', () => {
    // CK-003 has no group and no digit run before the dash — exactly SYN-2's shape without the
    // "(P-...)" that SYN-2 requires. Without the lookahead requiring a group to follow, "-003"
    // would greedily read as a 1-2 digit base suffix "-00" plus a leftover "3" absorbed into the
    // qty capture, inventing a base "CK-00" and qty 3 that mean nothing. It must still reject.
    assert.equal(parseCode('CK-003'), null);
    assert.equal(parseCode('CK-003(P-01)-10'), null, 'CK-003 is not a real base even with a group appended');
  });
});

describe('v4 flowaccount buckets', () => {
  const parsed = parseFlowAccountRows(rows);
  it('buckets sum to input count', () => {
    assert.equal(parsed.total, rows.length);
    // Rows 7 (SYN-2) and 19 (SY05601) moved from 'unparsed' to 'parsed' — see the CODE_RX
    // recovery tests above. Row 6 (BAD-801-(400)100) stays unparsed: it uses a different,
    // non-"(P-...)"-group shape that the recovered patterns don't cover.
    assert.deepEqual(parsed.counts, { parsed: 10, name_coded: 2, unparsed: 1, non_giftset: 2, blank: 4, inactive: 1 });
    const sum = Object.values(parsed.counts).reduce((a, b) => a + b, 0);
    assert.equal(sum, rows.length);
  });
  it('the recovered SYN-2 and SY05601 rows carry their synthetic price and qty ladder, not a placeholder', () => {
    const tfa500 = parsed.lines.find((x) => x.rowIndex === 7)!;
    assert.equal(tfa500.bucket, 'parsed');
    assert.deepEqual(
      { base: tfa500.base, group: tfa500.priceListGroup, qty: tfa500.qtyTier, price: tfa500.unitPrice, missing: tfa500.priceMissing },
      { base: 'SYN-2', group: 'P-02', qty: 500, price: 670, missing: false }
    );
    const dy = parsed.lines.find((x) => x.rowIndex === 19)!;
    assert.equal(dy.bucket, 'parsed');
    assert.deepEqual(
      { base: dy.base, group: dy.priceListGroup, qty: dy.qtyTier, price: dy.unitPrice },
      { base: 'SY05601', group: 'P-09', qty: 20, price: 790 }
    );
  });
  it('BAD-801-(400)100 stays unparsed — a different shape, not covered by this fix', () => {
    const r = parsed.review.find((x) => x.rowIndex === 6)!;
    assert.equal(r.bucket, 'unparsed');
    assert.equal(r.reason, 'regex');
  });
  it('name_coded rows carry the code from the end of the name and qtyTier null', () => {
    const l = parsed.lines.find((x) => x.rowIndex === 8)!;
    assert.equal(l.bucket, 'name_coded'); assert.equal(l.base, 'SYN08-4'); assert.equal(l.priceListGroup, 'P-06'); assert.equal(l.qtyTier, null); assert.equal(l.flowAccountCode, null);
    const l9 = parsed.lines.find((x) => x.rowIndex === 9)!;
    assert.equal(l9.base, 'SYN09-2'); assert.equal(l9.priceListGroup, null);
  });
  it('blank Gift Set row with a price is flagged for review', () => {
    const r = parsed.review.find((x) => x.rowIndex === 10)!;
    assert.equal(r.bucket, 'blank'); assert.equal(r.hasPrice, true);
  });
  it('inactive rows are counted, not parsed', () => {
    assert.equal(parsed.review.find((x) => x.rowIndex === 16)!.bucket, 'inactive');
    assert.ok(!parsed.lines.some((x) => x.rowIndex === 16));
  });
  it('UnitPrice 0 → priceMissing', () => {
    assert.equal(parsed.lines.find((x) => x.rowIndex === 5)!.priceMissing, true);
    assert.equal(parsed.lines.find((x) => x.rowIndex === 1)!.priceMissing, false);
  });
  it('every unparsed row has a reason', () => {
    for (const r of parsed.review.filter((x) => x.bucket === 'unparsed')) assert.equal(r.reason, 'regex');
  });
});

// Regression: missing category requires both a Model marker and a positive price.
describe('v4 flowaccount category gate — an untagged Gift Set recovered via "Model:" + a real price', () => {
  const row = (over: Partial<FlowAccountRow>): FlowAccountRow => ({
    rowIndex: 1, productCode: '', name: '', unit: 'ชุด', category: null,
    unitPrice: 0, unitPriceWithVat: 0, buyPrice: 0, ...over,
  });

  it('recovers a category=null row whose name carries "Model:<code>" and a real price', () => {
    const parsed = parseFlowAccountRows([
      row({ rowIndex: 1, name: 'ชุดทดสอบสังเคราะห์ Model:SYN21-2', unitPrice: 620, unitPriceWithVat: 663.4 }),
      row({ rowIndex: 2, name: 'ชุดทดสอบสังเคราะห์ Model : SYN22-1', unitPrice: 630, unitPriceWithVat: 674.1 }),
    ]);
    assert.deepEqual(parsed.counts.name_coded, 2);
    const l1 = parsed.lines.find((x) => x.rowIndex === 1)!;
    assert.equal(l1.bucket, 'name_coded'); assert.equal(l1.base, 'SYN21-2'); assert.equal(l1.priceMissing, false);
    const l2 = parsed.lines.find((x) => x.rowIndex === 2)!;
    assert.equal(l2.bucket, 'name_coded'); assert.equal(l2.base, 'SYN22-1'); assert.equal(l2.priceMissing, false);
  });

  it('does NOT recover the same shape when the price is 0 — a "Model:" marker alone is not enough', () => {
    // A marker on an unpriced draft must not bypass the category gate.
    const parsed = parseFlowAccountRows([
      row({ rowIndex: 1, name: 'ชุดทดสอบยังไม่ตั้งราคา Model:ZZQ00-1', unitPrice: 0, unitPriceWithVat: 0 }),
    ]);
    assert.deepEqual(parsed.counts, { parsed: 0, name_coded: 0, unparsed: 0, non_giftset: 0, blank: 1, inactive: 0 });
  });

  it('does NOT recover a code-like tail with no "Model:" marker, even with a real price', () => {
    // The real false positive this guards against: "สาย USB 3 in1" ends in a token ("IN1") that
    // matches the same base shape as a real code, with a real (non-zero) price on the row, but
    // is a cable description, not a gift-set SKU.
    const parsed = parseFlowAccountRows([
      row({ rowIndex: 1, name: 'สาย USB 3 in1', unitPrice: 45, unitPriceWithVat: 48.15 }),
    ]);
    assert.deepEqual(parsed.counts, { parsed: 0, name_coded: 0, unparsed: 0, non_giftset: 0, blank: 1, inactive: 0 });
  });

  it('an explicit non-Gift-Set category tag is never overridden by the marker, even priced', () => {
    // category === null means "never classified"; an explicit tag like "Other" is a deliberate
    // classification and must not be second-guessed by a name heuristic.
    const parsed = parseFlowAccountRows([
      row({ rowIndex: 1, category: 'Other', name: 'อุปกรณ์เสริม Model:XYZ12-3', unitPrice: 99, unitPriceWithVat: 105.93 }),
    ]);
    assert.deepEqual(parsed.counts, { parsed: 0, name_coded: 0, unparsed: 0, non_giftset: 0, blank: 1, inactive: 0 });
  });

  it('accepts the full-width Thai colon after "Model" as well', () => {
    const parsed = parseFlowAccountRows([
      row({ rowIndex: 1, name: 'ชุดทดสอบ Model：QWE99-2', unitPrice: 150, unitPriceWithVat: 160.5 }),
    ]);
    assert.equal(parsed.lines.find((x) => x.rowIndex === 1)?.base, 'QWE99-2');
  });
});

describe('v4 flowaccount xlsx reader', () => {
  it('throws FlowAccountSchemaError on a workbook without the expected header', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('products');
    ws.addRow(['wrong']); ws.addRow([]); ws.addRow(['A', 'B']);
    const tmp = `${process.env.TEMP || '/tmp'}/v4-bad-${Date.now()}.xlsx`; await wb.xlsx.writeFile(tmp);
    await assert.rejects(() => readFlowAccountXlsx(tmp), FlowAccountSchemaError);
  });
  it('reads a minimal valid workbook (header on row 3)', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('products');
    ws.addRow(['รายการสินค้า']); ws.addRow([]);
    ws.addRow(['BarCode', 'ProductCode', 'Name', 'Unit', 'Category', 'Description', 'UnitPrice', 'UnitPriceWithVat', 'BuyPrice', 'BuyPriceWithVat']);
    ws.addRow(['', 'SXY01(P-14)-100', 'เครื่องนวดคอ SXY01(P-14)', 'ชุด', 'Gift Set', '', 600, 642, 0, 0]);
    const tmp = `${process.env.TEMP || '/tmp'}/v4-ok-${Date.now()}.xlsx`; await wb.xlsx.writeFile(tmp);
    const got = await readFlowAccountXlsx(tmp);
    assert.equal(got.length, 1); assert.equal(got[0].productCode, 'SXY01(P-14)-100'); assert.equal(got[0].unitPrice, 600); assert.equal(got[0].rowIndex, 4);
  });
});

describe('v4 flowaccount buildUnpricedWorklist (RCA-PRICE-DATA-LOSS prevention #5)', () => {
  const row = (over: Partial<FlowAccountRow>): FlowAccountRow => ({
    rowIndex: 1, productCode: '', name: '', unit: 'ชุด', category: 'Gift Set',
    unitPrice: 0, unitPriceWithVat: 0, buyPrice: 0, ...over,
  });

  it('returns bases where every line is priceMissing, sorted by base', () => {
    const parsed = parseFlowAccountRows([
      row({ rowIndex: 1, productCode: 'ZZX01(P-01)-10', name: 'ชุดทดสอบ ZZX01(P-01)' }),
      row({ rowIndex: 2, productCode: 'ZZX01(P-01)-100', name: 'ชุดทดสอบ ZZX01(P-01)' }),
      row({ rowIndex: 3, name: 'ชุดทดสอบสอง AAB02(P-02)' }),
    ]);
    const got = buildUnpricedWorklist(parsed.lines);
    assert.deepEqual(got.map((e) => e.base), ['AAB02', 'ZZX01']);
    const zzx = got.find((e) => e.base === 'ZZX01')!;
    assert.equal(zzx.name, 'ชุดทดสอบ ZZX01(P-01)');
    assert.deepEqual(zzx.buckets, ['parsed']);
    assert.deepEqual(zzx.rowIndexes, [1, 2]);
    assert.deepEqual(zzx.qtyTiers, [10, 100]);
    assert.deepEqual(zzx.priceListRefs, []);
    const aab = got.find((e) => e.base === 'AAB02')!;
    assert.deepEqual(aab.buckets, ['name_coded']);
    assert.deepEqual(aab.qtyTiers, []);
  });

  it('excludes bases with at least one priced line (mixed bases are not "unpriced")', () => {
    const parsed = parseFlowAccountRows([
      row({ rowIndex: 1, productCode: 'SXY01(P-14)-10', name: 'เครื่องนวดคอ SXY01(P-14)' }),
      row({ rowIndex: 2, productCode: 'SXY01(P-14)-100', name: 'เครื่องนวดคอ SXY01(P-14)', unitPrice: 600, unitPriceWithVat: 642 }),
    ]);
    assert.deepEqual(buildUnpricedWorklist(parsed.lines), []);
  });

  it('excludes non_giftset lines entirely', () => {
    const parsed = parseFlowAccountRows([
      row({ rowIndex: 1, productCode: 'NG01-1', name: 'ไม่ใช่ gift set', category: 'อื่นๆ' }),
    ]);
    assert.deepEqual(buildUnpricedWorklist(parsed.lines), []);
  });

  it('joins priceListRefs from a price-PDF index when provided', () => {
    const parsed = parseFlowAccountRows([
      row({ rowIndex: 1, productCode: 'ZZX01(P-01)-10', name: 'ชุดทดสอบ ZZX01(P-01)' }),
      row({ rowIndex: 2, name: 'ชุดทดสอบสอง AAB02(P-02)' }),
    ]);
    const idx = { ZZX01: [{ file: '01-ใบเสนอราคา.pdf', pages: [78, 79] }] };
    const got = buildUnpricedWorklist(parsed.lines, idx);
    assert.deepEqual(got.find((e) => e.base === 'ZZX01')!.priceListRefs, idx.ZZX01);
    assert.deepEqual(got.find((e) => e.base === 'AAB02')!.priceListRefs, []);
  });
});
