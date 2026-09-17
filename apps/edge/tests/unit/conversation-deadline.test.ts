import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConversationClient } from '../../src/conversation/client.js';
import { bindConversationBudget, remainingConversationBudget, withinConversationBudget } from '../../src/conversation/deadline.js';
import { runConversationOnce } from '../../src/conversation/worker.js';
import { ConversationError, conversationEnvelope } from '../../src/conversation/contract.js';
import type { InvocationReceipt } from '../../src/answer/context-injection.js';

// @spec ZAI:FR-150 — negotiated reply budgets include transit and use a monotonic clock.
const envelope = () => ({
  contractVersion: '2',
  job: {
    id: '10c0eacf-1e65-413a-a6c1-3f6d125cf123', version: 1,
    executionId: '20c0eacf-1e65-413a-a6c1-3f6d125cf123',
    question: 'สินค้าราคาเท่าไร', conversationKey: 'opaque-conversation',
    leaseExpiresAt: '2026-09-17T00:05:00.000Z',
    policy: { modelAccess: 'LOCAL_ONLY', role: 'sales', retainHistory: false },
    deadline: { issuedAt: '2026-09-17T00:00:00.000Z', answerDeadlineAt: '2026-09-17T00:00:40.000Z',
      remainingBudgetMs: 40000, deliveryMode: 'REPLY' },
  },
});

test('v2 claim accounts for the entire round trip and elapsed time without relying on wall clock', async () => {
  let mono = 100;
  const client = createConversationClient({
    baseUrl: 'https://zuri.test', deviceKey: 'edgk_1234567890', monotonicNow: () => mono,
    fetchFn: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('x-zuri-conversation-versions'), '2,1');
      mono += 4000;
      return new Response(JSON.stringify(envelope()));
    },
  });
  const job = await client.claim();
  assert.ok(job);
  assert.equal(remainingConversationBudget(job), 36000);
  mono += 11000;
  assert.equal(remainingConversationBudget(job), 25000);
  mono += 30000;
  assert.equal(remainingConversationBudget(job), 0);
});

test('v2 refuses inconsistent clocks, inflated reply budget and sensitive fields', () => {
  const value = envelope();
  assert.equal(conversationEnvelope.safeParse(value).success, true);
  for (const deadline of [
    { ...value.job.deadline, remainingBudgetMs: 41000 },
    { ...value.job.deadline, answerDeadlineAt: '2026-09-16T00:00:00.000Z' },
  ]) {
    assert.equal(conversationEnvelope.safeParse({ ...value, job: { ...value.job, deadline } }).success, false);
  }
  assert.equal(conversationEnvelope.safeParse({ ...value, job: { ...value.job, replyToken: 'forbidden' } }).success, false);
});

test('new client accepts old-server v1 without claiming a reply deadline guarantee', async () => {
  const value = envelope();
  const { deadline: _deadline, executionId: _executionId, ...job } = value.job;
  const client = createConversationClient({
    baseUrl: 'https://zuri.test', deviceKey: 'edgk_1234567890',
    fetchFn: async () => new Response(JSON.stringify({ contractVersion: '1', job })),
  });
  const result = await client.claim();
  assert.ok(result);
  assert.equal(remainingConversationBudget(result), null);
});

test('expired completion is refused before any outbound request', async () => {
  let mono = 0;
  let calls = 0;
  const client = createConversationClient({
    baseUrl: 'https://zuri.test', deviceKey: 'edgk_1234567890', monotonicNow: () => mono,
    fetchFn: async () => { calls++; return new Response(JSON.stringify(envelope())); },
  });
  const job = await client.claim();
  mono = 40001;
  await assert.rejects(client.complete(job!, 'answer'), /REPLY_DEADLINE_MISSED/);
  assert.equal(calls, 1);
});

test('deadline aborts in-flight computation and rejects its later result', async () => {
  const job = conversationEnvelope.parse(envelope()).job;
  bindConversationBudget(job, 0, () => 37990);
  let aborted = false;
  await assert.rejects(withinConversationBudget(job, signal => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve('late answer'); });
  })), /REPLY_DEADLINE_MISSED/);
  assert.equal(aborted, true);
});

test('rules fallback after the budget is spent cannot become a completed answer', async () => {
  const job = conversationEnvelope.parse(envelope()).job;
  let mono = 0;
  bindConversationBudget(job, 0, () => mono);
  const settled: string[] = [];
  const result = await runConversationOnce({
    now: () => Date.parse('2026-09-17T00:00:00Z'),
    client: { claim: async () => job, complete: async () => { settled.push('complete'); },
      fail: async (_job, code) => { settled.push(code); } },
    answer: async () => { mono = 40001; return { text: 'fallback', source: 'rules' }; },
  });
  assert.equal(result.outcome, 'deadline_missed');
  assert.deepEqual(settled, ['REPLY_DEADLINE_MISSED']);
});

test('failed inference preserves actual invocation evidence on its single failure settlement', async () => {
  const job = conversationEnvelope.parse(envelope()).job;
  bindConversationBudget(job, 0, () => 0);
  const receipt: InvocationReceipt = { receiptId: 'ctxrcpt_20c0eacf-1e65-413a-a6c1-3f6d125cf123',
    refs: { msp: [], citations: [], records: [] }, hash: 'a'.repeat(64),
    budget: { max: 32768, used: 100, trimmed: 0, unit: 'utf8-bytes' }, dropped: [] };
  let sent: unknown;
  const failure = new ConversationError('MSP_INJECTION_RECEIPT_UNKNOWN');
  failure.contextReceipts = [receipt];
  const result = await runConversationOnce({ now: () => Date.parse('2026-09-17T00:00:00Z'),
    client: { claim: async () => job, complete: async () => { assert.fail('must not complete'); },
      fail: async (_job, code, receipts) => { sent = { code, receipts }; } },
    answer: async () => { throw failure; } });
  assert.equal(result.outcome, 'unknown');
  assert.deepEqual(sent, { code: 'MSP_INJECTION_RECEIPT_UNKNOWN', receipts: [receipt] });
});
