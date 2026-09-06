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
import { handleDirectMessages } from '../../src/history/webhook-server.js';

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

/**
 * A minimal stand-in for the durable `ReplyDedupe` `handleDirectMessages` now takes (G10) — the
 * real one persists to disk with an HMAC-hashed key, which these tests don't need to exercise;
 * they need only the same three-method shape.
 */
function fakeDedupe(): { has(id: string): boolean; remember(id: string): void; forget(id: string): void } {
  const seen = new Set<string>();
  return {
    has: (id) => seen.has(id),
    remember: (id) => void seen.add(id),
    forget: (id) => void seen.delete(id),
  };
}

describe('Webhook routing for direct messages', () => {
  const event = (userId: string, id: string) => ({
    events: [
      {
        webhookEventId: id,
        type: 'message',
        replyToken: `token-${id}`,
        source: { type: 'user', userId },
        message: { type: 'text', text: 'ราคา TJS23-2 100 ชุด' },
      },
    ],
  });

  function harness() {
    const sent: Array<{ token: string; text: string }> = [];
    return {
      sent,
      dm: {
        enabled: true,
        identity: options(),
        replyText: async (token: string, text: string) => {
          sent.push({ token, text });
        },
        answer: (_text: string, role: 'owner' | 'sales') =>
          `ตอบแล้ว (สิทธิ์: ${role === 'owner' ? 'ผู้บริหาร' : 'ฝ่ายขาย'})`,
        getDisplayName: async () => 'สมชาย',
      },
    };
  }

  it('records a request and says nothing else to someone unknown', async () => {
    const h = harness();
    const r = await handleDirectMessages(event('Unew', 'e1'), h.dm, fakeDedupe());

    assert.strictEqual(r.accessRequested, 1);
    assert.strictEqual(r.replied, 1);
    assert.match(h.sent[0].text, /ยังไม่มีสิทธิ์ตอบ/);
    assert.ok(!/ราคา|ต้นทุน|margin/.test(h.sent[0].text), 'an unknown caller learns nothing');
    assert.strictEqual(listIdentities(options())[0].displayName, 'สมชาย');
  });

  it('tells a revoked caller exactly what it tells a stranger', async () => {
    const h = harness();
    requestAccess('Ugone', 'อดีตพนักงาน', options());
    const hash = hashUserId('Ugone', HASH_KEY);
    approve(hash, 'sales', 'x@smartgift.co.th', 'boss', options());
    revoke(hash, 'boss', options());

    await handleDirectMessages(event('Ugone', 'e2'), h.dm, fakeDedupe());
    assert.match(h.sent[0].text, /ยังไม่มีสิทธิ์ตอบ/);
  });

  it('greets an approved caller with their role', async () => {
    const h = harness();
    requestAccess('Uboss', 'พี่เจี๊ยบ', options());
    approve(hashUserId('Uboss', HASH_KEY), 'owner', 'ceo@smartgift.co.th', 'boss', options());

    const r = await handleDirectMessages(event('Uboss', 'e3'), h.dm, fakeDedupe());
    assert.strictEqual(r.accessRequested, 0);
    assert.match(h.sent[0].text, /ผู้บริหาร/);
  });

  it('does not reply twice when LINE retries the same event', async () => {
    const h = harness();
    const dedupe = fakeDedupe();
    await handleDirectMessages(event('Unew', 'same'), h.dm, dedupe);
    const second = await handleDirectMessages(event('Unew', 'same'), h.dm, dedupe);

    assert.strictEqual(second.duplicate, 1);
    assert.strictEqual(second.replied, 0);
    assert.strictEqual(h.sent.length, 1);
  });

  it('lets the event be retried when the reply itself failed', async () => {
    const dedupe = fakeDedupe();
    const failing = {
      enabled: true,
      identity: options(),
      replyText: async () => {
        throw new Error('LINE unavailable');
      },
      answer: () => 'ตอบแล้ว',
      getDisplayName: async () => 'สมชาย',
    };
    await assert.rejects(() => handleDirectMessages(event('Unew', 'e4'), failing, dedupe));
    assert.ok(!dedupe.has('e4'), 'a failed reply must not count as answered');
  });

  it('ignores group traffic entirely', async () => {
    const h = harness();
    const groupEvent = {
      events: [
        {
          webhookEventId: 'g1',
          type: 'message',
          replyToken: 'tok',
          source: { type: 'group', userId: 'Uboss' },
          message: { type: 'text', text: 'สวัสดี' },
        },
      ],
    };
    const r = await handleDirectMessages(groupEvent, h.dm, fakeDedupe());
    assert.strictEqual(r.replied, 0);
    assert.strictEqual(h.sent.length, 0);
  });
});
