import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleStackReplies } from '../../src/history/webhook-server.js';

/**
 * FR-093 — the transport reports what it actually sent.
 *
 * The distinction these tests exist to hold: when the stack cannot answer, this
 * transport sends its OWN fallback text. Recording the stack's version would record a
 * message no customer ever read, which is why the report comes from the sender and
 * why `source` is on the wire at all.
 */

type Receipt = { inboundMessageId: string; text: string; source: 'STACK' | 'TRANSPORT_FALLBACK' };

const STACK_UNAVAILABLE_REPLY =
  'ซูริยังตอบจากข้อมูลธุรกิจไม่ได้ชั่วคราวค่ะ กรุณาลองใหม่อีกครั้งภายหลัง';

let root: string;

const event = (n: number) => ({
  type: 'message',
  webhookEventId: `WEH-${n}`,
  source: { type: 'user', userId: `U${n}` },
  message: { id: `M-${n}`, type: 'text', text: 'ราคาเท่าไร' },
  replyToken: `token-${n}`,
});

const dedupe = () => {
  const seen = new Set<string>();
  return {
    has: (id: string) => seen.has(id),
    remember: (id: string) => void seen.add(id),
    forget: (id: string) => void seen.delete(id),
  };
};

function harness({ results, reportDelivery, replyText }: {
  results: unknown[];
  reportDelivery?: (d: Receipt[], destination?: string, correlationId?: string) => Promise<unknown>;
  replyText?: (token: string, text: string) => Promise<unknown>;
}) {
  const sent: Array<{ token: string; text: string }> = [];
  return {
    sent,
    stack: {
      replyEnabled: true,
      forward: async () => ({ results }),
      replyText: replyText ?? (async (token: string, text: string) => { sent.push({ token, text }); }),
      ...(reportDelivery ? { reportDelivery } : {}),
    },
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-delivery-'));
});

describe('reply delivery receipts (FR-093)', () => {
  it('reports the stack answer it sent, named by the row the stack created', async () => {
    const reported: Receipt[][] = [];
    const { stack, sent } = harness({
      results: [{ ok: true, eventId: 'WEH-1', response: { text: 'ราคา 450 บาทครับ' }, inboundMessageId: 'msg-1' }],
      reportDelivery: async (deliveries) => { reported.push(deliveries); },
    });

    const outcome = await handleStackReplies(
      { destination: 'Uoa', events: [event(1)] } as never,
      stack as never, dedupe(), new Set(), 'corr-1'
    );

    assert.deepStrictEqual(sent, [{ token: 'token-1', text: 'ราคา 450 บาทครับ' }]);
    assert.deepStrictEqual(reported, [[
      { inboundMessageId: 'msg-1', text: 'ราคา 450 บาทครับ', source: 'STACK' },
    ]]);
    // G11 — a real stack answer is not a fallback, and must not be counted as one.
    assert.strictEqual(outcome.fallbackReplied, 0);
  });

  it('reports the TRANSPORT fallback as the fallback, not as the stack answer', async () => {
    // The reason the report comes from here. `ok: false` means the stack produced no
    // usable answer; the customer still received something, and that something is ours.
    const reported: Receipt[][] = [];
    const { stack, sent } = harness({
      results: [{ ok: false, eventId: 'WEH-2', inboundMessageId: 'msg-2' }],
      reportDelivery: async (deliveries) => { reported.push(deliveries); },
    });

    const outcome = await handleStackReplies(
      { destination: 'Uoa', events: [event(2)] } as never,
      stack as never, dedupe(), new Set()
    );

    assert.strictEqual(sent[0].text, STACK_UNAVAILABLE_REPLY);
    assert.strictEqual(reported[0][0].source, 'TRANSPORT_FALLBACK');
    assert.strictEqual(reported[0][0].text, STACK_UNAVAILABLE_REPLY);
    // G11 — the event is still durably consumed (LINE will not redeliver it), but the
    // customer's actual question went unanswered. That has to be visible somewhere
    // other than grepping logs for the fallback string.
    assert.strictEqual(outcome.fallbackReplied, 1);
  });

  it('reports the string that actually went out, including the length slice', async () => {
    const reported: Receipt[][] = [];
    const long = 'ก'.repeat(6000);
    const { stack, sent } = harness({
      results: [{ ok: true, eventId: 'WEH-3', response: { text: long }, inboundMessageId: 'msg-3' }],
      reportDelivery: async (deliveries) => { reported.push(deliveries); },
    });

    await handleStackReplies(
      { destination: 'Uoa', events: [event(3)] } as never,
      stack as never, dedupe(), new Set()
    );

    assert.strictEqual(sent[0].text.length, 5000);
    assert.strictEqual(reported[0][0].text, sent[0].text);
  });

  it('reports nothing for an event it deliberately stayed silent on', async () => {
    // skipReply is a redelivery: no message was sent, so there is nothing to record.
    const reported: Receipt[][] = [];
    const { stack, sent } = harness({
      results: [{ ok: true, eventId: 'WEH-4', skipReply: true, inboundMessageId: 'msg-4' }],
      reportDelivery: async (deliveries) => { reported.push(deliveries); },
    });

    await handleStackReplies(
      { destination: 'Uoa', events: [event(4)] } as never,
      stack as never, dedupe(), new Set()
    );

    assert.strictEqual(sent.length, 0);
    assert.strictEqual(reported.length, 0);
  });

  it('reports after the send, never before', async () => {
    const order: string[] = [];
    const { stack } = harness({
      results: [{ ok: true, eventId: 'WEH-5', response: { text: 'ตอบแล้ว' }, inboundMessageId: 'msg-5' }],
      replyText: async () => { order.push('send'); },
      reportDelivery: async () => { order.push('report'); },
    });

    await handleStackReplies(
      { destination: 'Uoa', events: [event(5)] } as never,
      stack as never, dedupe(), new Set()
    );

    // A receipt written before the send would claim a delivery that had not happened,
    // and would survive a send that then failed.
    assert.deepStrictEqual(order, ['send', 'report']);
  });

  it('a failing report never costs a reply', async () => {
    // The customer already has the message. Losing the record is bad; letting that
    // loss throw and take the next customer's reply with it is worse.
    const { stack, sent } = harness({
      results: [
        { ok: true, eventId: 'WEH-6', response: { text: 'หนึ่ง' }, inboundMessageId: 'msg-6' },
        { ok: true, eventId: 'WEH-7', response: { text: 'สอง' }, inboundMessageId: 'msg-7' },
      ],
      reportDelivery: async () => { throw new Error('stack down'); },
    });

    const outcome = await handleStackReplies(
      { destination: 'Uoa', events: [event(6), event(7)] } as never,
      stack as never, dedupe(), new Set()
    );

    assert.strictEqual(outcome.replied, 2);
    assert.deepStrictEqual(sent.map((item) => item.text), ['หนึ่ง', 'สอง']);
  });

  it('still replies when the stack has no delivery endpoint at all', async () => {
    // An older stack, or observe-only mode. The transport must degrade to exactly the
    // behaviour it had before FR-093 rather than refusing to answer.
    const { stack, sent } = harness({
      results: [{ ok: true, eventId: 'WEH-8', response: { text: 'ตอบได้' }, inboundMessageId: 'msg-8' }],
    });

    const outcome = await handleStackReplies(
      { destination: 'Uoa', events: [event(8)] } as never,
      stack as never, dedupe(), new Set()
    );

    assert.strictEqual(outcome.replied, 1);
    assert.strictEqual(sent[0].text, 'ตอบได้');
  });

  it('reports nothing when the stack named no row, rather than inventing an id', async () => {
    // An older stack does not return `inboundMessageId`. There is no id to guess and
    // no id to derive, so the reply goes unrecorded and says so by its absence.
    const reported: Receipt[][] = [];
    const { stack, sent } = harness({
      results: [{ ok: true, eventId: 'WEH-9', response: { text: 'ตอบแล้ว' } }],
      reportDelivery: async (deliveries) => { reported.push(deliveries); },
    });

    await handleStackReplies(
      { destination: 'Uoa', events: [event(9)] } as never,
      stack as never, dedupe(), new Set()
    );

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(reported.length, 0);
  });

  it('carries the correlation id the stack reported, so the record joins the turn', async () => {
    const seen: Array<string | undefined> = [];
    const stack = {
      replyEnabled: true,
      forward: async () => ({
        results: [{ ok: true, eventId: 'WEH-10', response: { text: 'ตอบ' }, inboundMessageId: 'msg-10' }],
        // The stack replaced ours; its id is the one in its records.
        correlationId: 'stack-minted-id',
      }),
      replyText: async () => {},
      reportDelivery: async (_d: Receipt[], _dest?: string, correlationId?: string) => { seen.push(correlationId); },
    };

    await handleStackReplies(
      { destination: 'Uoa', events: [event(10)] } as never,
      stack as never, dedupe(), new Set(), 'ours'
    );

    assert.deepStrictEqual(seen, ['stack-minted-id']);
    assert.ok(root.length > 0);
  });
});
