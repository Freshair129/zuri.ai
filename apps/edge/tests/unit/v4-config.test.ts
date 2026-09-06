import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCategoryGroupMap, loadTypeAliases, validateCategoryGroupMap, validateTypeAliases, aliasIndex } from '../../src/rag/v4/config.js';

const OBSERVED = ['power_bank','usb_flash_drive','charger','speaker','earbuds','earphone','headset','mouse','keyboard','smart_bracelet','car_accessory',
  'neck_massager','massage_gun','massage_comb','hair_dryer','humidifier','fan','glove','towel','nail_clipper',
  'notebook','notebook_refill','pen','bookmark','name_card_holder','briefcase','key_chain','lighter','drinkware','coffee_maker','umbrella','bag'];

describe('v4 config', () => {
  it('shipped category map covers all 32 observed typeIds', () => {
    assert.equal(OBSERVED.length, 32);
    assert.doesNotThrow(() => validateCategoryGroupMap(loadCategoryGroupMap(), OBSERVED));
  });
  it('missing type → error naming it', () => {
    const m = loadCategoryGroupMap(); const copy = { ...m, typeToGroup: { ...m.typeToGroup } }; delete copy.typeToGroup.lighter;
    assert.throws(() => validateCategoryGroupMap(copy, OBSERVED), /lighter/);
  });
  it('unknown group → error', () => {
    const m = loadCategoryGroupMap(); const copy = { ...m, typeToGroup: { ...m.typeToGroup, pen: 'nope' } };
    assert.throws(() => validateCategoryGroupMap(copy, OBSERVED), /nope/);
  });
  it('aliases cover 32 types with name_th and at least one Thai alias or name', () => {
    const a = loadTypeAliases();
    assert.doesNotThrow(() => validateTypeAliases(a, OBSERVED));
    const idx = aliasIndex(a);
    assert.equal(idx.get('แก้ว'), 'drinkware'); assert.equal(idx.get('ร่ม'), 'umbrella'); assert.equal(idx.get('mug'), 'drinkware');
  });
  it('duplicate alias across types → error', () => {
    const a = loadTypeAliases(); const copy = { ...a, types: a.types.map((t) => (t.typeId === 'pen' ? { ...t, aliases_th: [...t.aliases_th, 'แก้ว'] } : t)) };
    assert.throws(() => validateTypeAliases(copy, OBSERVED), /แก้ว/);
  });
});
