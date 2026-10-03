import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindConversationBudget, remainingConversationBudget, withinConversationBudget } from '../../src/conversation/deadline.js';
import { ConversationError, type ConversationJob } from '../../src/conversation/contract.js';

const job = (): ConversationJob => ({
  id: '10c0eacf-1e65-413a-a6c1-3f6d125cf123', version: 1, executionId: '20c0eacf-1e65-413a-a6c1-3f6d125cf123',
  question: 'สินค้าราคาเท่าไร', conversationKey: 'opaque-conversation', leaseExpiresAt: '2026-09-17T00:05:00.000Z',
  policy: { modelAccess: 'LOCAL_ONLY', role: 'sales', retainHistory: false },
  deadline: { issuedAt: '2026-09-17T00:00:00.000Z', answerDeadlineAt: '2026-09-17T00:00:40.000Z',
    remainingBudgetMs: 40000, deliveryMode: 'REPLY' },
});

test('execution budget only decreases on the monotonic clock', () => {
  let mono = 100;
  const input = job();
  bindConversationBudget(input, mono, () => mono);
  mono += 11000;
  assert.equal(remainingConversationBudget(input), 29000);
  mono += 30000;
  assert.equal(remainingConversationBudget(input), 0);
});

test('deadline aborts in-flight work and rejects a late result', async () => {
  const input = job();
  bindConversationBudget(input, 0, () => 37990);
  let aborted = false;
  await assert.rejects(withinConversationBudget(input, signal => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve('late answer'); });
  })), error => error instanceof ConversationError && error.code === 'REPLY_DEADLINE_MISSED');
  assert.equal(aborted, true);
});

test('an unbound deadline cannot bypass the trusted monotonic budget', () => {
  assert.throws(() => remainingConversationBudget(job()), error => error instanceof ConversationError
    && error.code === 'INVALID_CONVERSATION_CONTRACT');
});
