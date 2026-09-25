import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  approve,
  hashUserId,
  listIdentities,
  requestAccess,
  resolveIdentity,
  revoke,
} from '../../src/identity/registry.js';
import { formatQuoteForLine, scopeQuote } from '../../src/identity/scope.js';
import { buildPriceQuote } from '../../src/pricing/index.js';

// @tested SDD-009 — the deny-by-default chat register and its role scoping.

const HASH_KEY = 'test-hash-key';
let root: string;

function options() {
  return { root, hashKey: HASH_KEY };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-identity-'));
});

const SKU = {
  sku: 'TJS23-2',
  factoryCostRmb: 32,
  exchangeRate: 5,
  carton: { unitsPerCarton: 20, cartonCbm: 0.1102 },
  freight: { mode: 'auto' as const, shipMonth: 11, goodsClass: 'electronic_tisi' as const },
};

describe('LINE identity register', () => {
  it('answers nobody until a person has been approved', () => {
    assert.strictEqual(resolveIdentity('Uabc', options()), null, 'an unknown caller is not known');

    requestAccess('Uabc', 'พี่เจี๊ยบ', options());
    assert.strictEqual(resolveIdentity('Uabc', options()), null, 'pending is still not approved');

    const hash = hashUserId('Uabc', HASH_KEY);
    approve(hash, 'owner', 'ceo@smartgift.co.th', 'boss', options());
    assert.strictEqual(resolveIdentity('Uabc', options())?.role, 'owner');
  });

  it('stops answering a revoked person', () => {
    requestAccess('Uabc', 'สมชาย', options());
    const hash = hashUserId('Uabc', HASH_KEY);
    approve(hash, 'sales', 'sales@smartgift.co.th', 'boss', options());
    assert.ok(resolveIdentity('Uabc', options()));

    revoke(hash, 'boss', options());
    assert.strictEqual(resolveIdentity('Uabc', options()), null);
  });

  it('never writes the raw LINE user id anywhere', () => {
    requestAccess('U1234567890abcdef', 'สมหญิง', options());
    const onDisk = fs.readFileSync(path.join(root, 'identities.json'), 'utf8');

    assert.ok(!onDisk.includes('U1234567890abcdef'), 'the raw id must not reach the file');
    assert.ok(onDisk.includes(hashUserId('U1234567890abcdef', HASH_KEY)));
  });

  it('does not pile up duplicate requests when someone messages again', () => {
    requestAccess('Uabc', 'สมชาย', options());
    requestAccess('Uabc', 'สมชาย', options());
    requestAccess('Uabc', 'สมชาย', options());
    assert.strictEqual(listIdentities(options()).length, 1);
  });

  it('leaves an approved person alone if they message again', () => {
    requestAccess('Uabc', 'สมชาย', options());
    const hash = hashUserId('Uabc', HASH_KEY);
    approve(hash, 'owner', 'ceo@smartgift.co.th', 'boss', options());

    requestAccess('Uabc', 'สมชาย', options());
    assert.strictEqual(resolveIdentity('Uabc', options())?.status, 'approved');
  });

  it('refuses to store anything without a hash key', () => {
    assert.throws(
      () => requestAccess('Uabc', 'x', { root, hashKey: '' }),
      /hash key is required/
    );
  });

  it('refuses to treat a corrupt register as empty', () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'identities.json'), '{not json', 'utf8');
    assert.throws(() => listIdentities(options()), /unreadable/);
  });
});

describe('What each role is told', () => {
  const quote = buildPriceQuote(SKU);

  it('gives sales the customer price and nothing commercial', () => {
    const scoped = scopeQuote(quote, 'sales');

    assert.ok(scoped.breaks.length > 0);
    assert.ok(scoped.breaks.every((b) => b.unitPriceThb > 0));
    assert.strictEqual(scoped.cost, undefined, 'the cost stack must not be present at all');
    for (const b of scoped.breaks) {
      assert.strictEqual(b.landedUnitCostThb, undefined);
      assert.strictEqual(b.orderGrossProfitThb, undefined);
      assert.strictEqual(b.grossMarginPct, undefined);
    }
  });

  it('gives the owner the whole picture', () => {
    const scoped = scopeQuote(quote, 'owner');
    assert.ok(scoped.cost);
    assert.ok(scoped.breaks.every((b) => b.grossMarginPct !== undefined));
  });

  it('passes no engine note to sales unless it was allowed deliberately', () => {
    const sales = scopeQuote(quote, 'sales');
    const owner = scopeQuote(quote, 'owner');

    assert.ok(owner.notes.length > 0, 'the owner still sees the engine notes');
    assert.deepStrictEqual(sales.notes, [], 'nothing reaches sales by default');
  });

  it('lets no cost figure through to sales in any form', () => {
    // The engine states costs in THB per set inside its warnings; a block-list once let one past.
    const text = formatQuoteForLine(scopeQuote(quote, 'sales'), 'พัดลม + ร่ม');
    assert.ok(!/THB per set/i.test(text));
    assert.ok(!/freight/i.test(text));
    assert.ok(!/premium/i.test(text));
    assert.ok(!/บาท\/ชุด/.test(text.split('ราคาต่อชุด')[1] || ''));
  });

  it('never prints a cost figure in the sales reply', () => {
    const text = formatQuoteForLine(scopeQuote(quote, 'sales'), 'พัดลม + ร่ม');

    assert.ok(text.includes('ราคาต่อชุด'));
    assert.ok(!text.includes('ต้นทุนรวม'));
    assert.ok(!text.includes('margin'));
    assert.ok(!text.includes('ตัวคูณ'));
  });

  it('prints the cost stack for the owner', () => {
    const text = formatQuoteForLine(scopeQuote(quote, 'owner'), 'พัดลม + ร่ม');
    assert.ok(text.includes('ต้นทุนรวม'));
    assert.ok(text.includes('margin'));
  });
});
