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
