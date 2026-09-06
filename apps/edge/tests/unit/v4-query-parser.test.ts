import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../../src/rag/v4/query-parser.js';
import { aliasIndex, loadTypeAliases } from '../../src/rag/v4/config.js';

const idx = aliasIndex(loadTypeAliases());
describe('v4 query parser', () => {
  it('negative + budget', () => {
    const p = parseQuery('ของขวัญดูดี ไม่ใช่แก้ว งบ 200 บาท', idx);
    assert.deepEqual(p.excludeTypes, ['drinkware']); assert.equal(p.budgetPerUnit, 200); assert.equal(p.qty, null); assert.equal(p.cleanText, 'ของขวัญดูดี');
  });
  it('two negatives + qty', () => {
    const p = parseQuery('ไม่เอาร่ม ไม่เอาปากกา 100 ชิ้น', idx);
    assert.deepEqual(p.excludeTypes, ['umbrella', 'pen']); assert.equal(p.qty, 100);
  });
  it('total budget with headcount becomes per-unit', () => {
    const p = parseQuery('งบ 20,000 สำหรับ 100 คน', idx);
    assert.equal(p.qty, 100); assert.equal(p.budgetTotal, 20000); assert.equal(p.budgetPerUnit, 200);
  });
  it('bare number without unit is not qty', () => {
    assert.equal(parseQuery('powerbank 20000', idx).qty, null);
  });
  it('ไม่เกิน budget', () => { assert.equal(parseQuery('งบไม่เกิน 1,500', idx).budgetPerUnit, 1500); });
  it('no keywords → passthrough', () => {
    const p = parseQuery('แก้วน้ำมีกี่สี', idx);
    assert.deepEqual(p.excludeTypes, []); assert.equal(p.qty, null); assert.equal(p.budgetPerUnit, null); assert.equal(p.cleanText, 'แก้วน้ำมีกี่สี');
  });
});

describe('v4 query parser — negation cues and fillers (NEG eval failures 2026-08-23)', () => {
  const cases: Array<[string, string[]]> = [
    ['หูฟังไร้สายพกพา ใส่ออกกำลังกายได้ ไม่เอาแบบครอบหูนะคะ', ['headset']],
    ['ลำโพงบลูทูธที่มีอยู่ตอนนี้มีกี่รุ่น ไม่นับรุ่นที่เป็นหูฟังในตัวนะคะ', ['headset']],
    ['แท่นชาร์จมีสีให้เลือกกี่สีคะ ไม่นับพาวเวอร์แบงก์นะคะ', ['power_bank']],
    ['อยากได้สมุดโน้ตพร้อมปกแจกลูกค้าใหม่ ไม่ต้องการแค่ไส้ในนะคะ', ['notebook_refill']],
    ['ปากกาลูกลื่นธรรมดา อันไหนดี ไม่ต้องแนะนำที่คั่นหนังสือนะคะ', ['bookmark']],
    ['สมุดโน้ตมีปกสีอะไรบ้าง ไม่ต้องพูดถึงไส้ในนะคะ', ['notebook_refill']],
    ['กระเป๋าเอกสารสั่ง 20 ใบ ไม่เอาแบบมีล้อลากนะคะ', ['bag']],
    ['แก้วเก็บความเย็นสแตนเลส ไม่เอาชุดดริปกาแฟนะคะ', ['coffee_maker']],
    ['อยากได้พัดลมพกพา ไม่เอาเครื่องเพิ่มความชื้นนะคะ', ['humidifier']],
  ];
  for (const [text, expected] of cases) {
    it(`${text} → ${expected.join(',')}`, () => { assert.deepEqual(parseQuery(text, idx).excludeTypes, expected); });
  }
  it('negation without a product alias after it is ignored', () => {
    assert.deepEqual(parseQuery('ไม่เอาของแพง อยากได้ร่ม', idx).excludeTypes, []);
  });
});
