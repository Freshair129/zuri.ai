import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slug, cut, sha1Hex, catGroupId, typeNodeId, offerNodeId, cskuId, customId, edgeId, TYPE_UNCLASSIFIED, COLLECTION, VECTOR_DIM } from '../../src/rag/v4/schema.js';

describe('v4 schema helpers', () => {
  it('slug uppercases ASCII and collapses non-alphanumerics to single dashes', () => {
    assert.equal(slug('Notebook Powerbank'), 'NOTEBOOK-POWERBANK');
    assert.equal(slug('  usb_flash-drive!! '), 'USB-FLASH-DRIVE');
    assert.equal(slug('สมุดโน้ต'), '');
  });
  it('cut truncates and strips a trailing dash', () => {
    assert.equal(cut('NOTEBOOK-POWERBANK', 12), 'NOTEBOOK-POW');
    assert.equal(cut('USB-FLASH-DRIVE', 10), 'USB-FLASH');
    assert.equal(cut('ABC', 10), 'ABC');
  });
  it('ids are deterministic and namespaced', () => {
    assert.equal(catGroupId('smart_tech'), 'CATGROUP_smart_tech');
    assert.equal(typeNodeId('power_bank'), 'TYPE_power_bank');
    assert.equal(offerNodeId('fxd1x-4'), 'OFFER_FXD1X-4');
    assert.equal(customId('screen_logo'), 'CUSTOM_screen_logo');
    assert.match(cskuId('TBY01(P-14)-100'), /^CSKU_[0-9A-F]{20}$/);
    assert.equal(cskuId('x'), cskuId('x'));
    assert.notEqual(edgeId('CONTAINS', 'A', 'B'), edgeId('CONTAINS', 'A', 'B', 'link2'));
    assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  });
  it('constants', () => {
    assert.equal(TYPE_UNCLASSIFIED, 'TYPE_unclassified');
    assert.equal(COLLECTION, 'e5_v4');
    assert.equal(VECTOR_DIM, 384);
  });
});
