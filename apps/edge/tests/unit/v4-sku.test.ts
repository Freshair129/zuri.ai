import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stableSkuId, baseDisplayCode, assignDisplayCodes, type SkuInput } from '../../src/rag/v4/sku.js';

const mk = (o: Partial<SkuInput>): SkuInput => ({
  productId: 'PRODUCT_00A7D1FE671C2AF3B1E6', physicalVariantId: 'PHYSICAL_VARIANT_0D1AA0A992B73892D806',
  typeId: 'notebook', englishName: 'Notebook Powerbank', colors: ['Black'], sizes: ['A5'], materials: [], ...o,
});

describe('v4 sku', () => {
  it('stableId is deterministic and variant-sensitive', () => {
    assert.equal(stableSkuId('P1', 'V1'), stableSkuId('P1', 'V1'));
    assert.notEqual(stableSkuId('P1', 'V1'), stableSkuId('P1', 'V2'));
    assert.match(stableSkuId('P1', 'V1'), /^SKU_[0-9a-f]{20}$/);
  });
  it('Notebook Powerbank / Black / A5 → SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5', () => {
    assert.equal(baseDisplayCode(mk({})), 'SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5');
  });
  it('Vacuum flask / Black / 500ml / SUS304 → modelTok shortened so base ≤ 36', () => {
    const code = baseDisplayCode(mk({ typeId: 'drinkware', englishName: 'Vacuum flask', colors: ['Black'], sizes: ['500ml'], materials: ['SUS304'] }));
    assert.equal(code, 'SKU-DRINKWARE-VACUUM-FL-BLK-500-S304');
    assert.equal(code.length, 36);
  });
  it('no attributes → -STD', () => {
    assert.equal(baseDisplayCode(mk({ colors: [], sizes: [], materials: [] })), 'SKU-NOTEBOOK-NOTEBOOK-POW-STD');
  });
  it('multiple colours → first colour + -MC', () => {
    assert.equal(baseDisplayCode(mk({ colors: ['Black', 'Blue'], sizes: [] })), 'SKU-NOTEBOOK-NOTEBOOK-POW-BLK-MC');
  });
  it('unclassified type → UNCL; Thai-only name → productId hash slice', () => {
    assert.equal(baseDisplayCode(mk({ typeId: null, englishName: 'สมุดโน้ต', colors: [], sizes: [] })), 'SKU-UNCL-00A7D1-STD');
  });
  it('collision suffix ordered by physicalVariantId', () => {
    const a = mk({ physicalVariantId: 'PV_B' }); const b = mk({ physicalVariantId: 'PV_A' });
    const m = assignDisplayCodes([a, b]);
    assert.equal(m.get(stableSkuId(a.productId, 'PV_A')), 'SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5');
    assert.equal(m.get(stableSkuId(a.productId, 'PV_B')), 'SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5-2');
  });
  it('≥100 collisions use hash suffix and stay ≤ 40', () => {
    const inputs = Array.from({ length: 120 }, (_, i) => mk({ physicalVariantId: `PV_${String(i).padStart(3, '0')}` }));
    const m = assignDisplayCodes(inputs);
    for (const code of m.values()) assert.ok(code.length <= 40, code);
    assert.match(m.get(stableSkuId(inputs[0].productId, 'PV_119'))!, /^SKU-NOTEBOOK-NOTEBOOK-POW-BLK-A5-[0-9A-F]{4}$/);
  });
  it('property: 500 random long inputs → ≤ 40, uppercase, no spaces, variantTok intact', () => {
    let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const word = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(rnd() * 26))).join('');
    const inputs: SkuInput[] = [];
    for (let i = 0; i < 500; i++) inputs.push(mk({ physicalVariantId: `PV_${i}`, typeId: word(14), englishName: `${word(20)} ${word(20)} ${word(20)}`, colors: [word(30)], sizes: [`${Math.floor(rnd() * 9999)}ml`], materials: [word(15)] }));
    for (const [, code] of assignDisplayCodes(inputs)) {
      assert.ok(code.length <= 40, code); assert.equal(code, code.toUpperCase()); assert.doesNotMatch(code, /\s/);
    }
  });
  it('changing englishName keeps stableId', () => {
    const a = mk({}); const b = mk({ englishName: 'Renamed' });
    assert.equal(stableSkuId(a.productId, a.physicalVariantId), stableSkuId(b.productId, b.physicalVariantId));
    assert.notEqual(baseDisplayCode(a), baseDisplayCode(b));
  });
});
