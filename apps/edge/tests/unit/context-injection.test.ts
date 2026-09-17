import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { composeModelInvocation } from '../../src/answer/context-injection.js';
import { answerWithModel } from '../../src/answer/llm.js';
import { emptyFakeRag } from '../helpers/fake-rag.js';

// @req FR-234
// @spec ADR-091 D7, SDD-100
// @tested this file
const messages = [{ role: 'system', content: 'trusted policy' }, { role: 'user', content: 'question' }];
test('actual sales prompt and product tool schemas fit the mandatory invocation budget', async () => {
  let used = 0;
  const result = await answerWithModel('แนะนำสินค้า', [], 'sales', {
    catalog: { products: [], byCode: new Map() }, role: 'sales', exchangeRate: 5, rag: emptyFakeRag(),
  }, { timeoutMs: 1000, maxIterations: 3, port: { id: 'test', model: 'no-inference', async generate(request) {
    const composed = composeModelInvocation({ authorized: true,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      tools: request.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) });
    used = composed.receipt.budget.used;
    return { text: 'ขอประเภทสินค้าที่ต้องการ' };
  } } }, 'fallback');
  assert.equal(result.source, 'model', result.reason);
  assert.ok(used > 1000 && used <= 16384);
});
test('CIN hashes the exact composed invocation and each round has its own receipt', () => {
  const tools = [{ name: 'search_products' }];
  const first = composeModelInvocation({ authorized: true, messages, tools, threadId: 'thread', audienceKind: 'DIRECT',
    mspSlices: [{ id: 'memory-1', threadId: 'thread', text: 'private recall' }] });
  assert.equal(first.receipt.hash, createHash('sha256').update(JSON.stringify({ messages: first.messages, tools })).digest('hex'));
  assert.deepEqual(first.receipt.refs.msp, ['memory-1']);
  assert.ok(!JSON.stringify(first.receipt).includes('private recall'));
  const second = composeModelInvocation({ authorized: true, messages: [...messages, { role: 'tool', content: 'price 100', tool_call_id: 'call-1' }] });
  assert.notEqual(first.receipt.receiptId, second.receipt.receiptId);
  assert.notEqual(first.receipt.hash, second.receipt.hash);
  assert.deepEqual(second.receipt.refs.records, ['call-1']);
});
test('CIN rejects missing authorization and mandatory oversize before inference', () => {
  assert.throws(() => composeModelInvocation({ authorized: false, messages }), /AUTHORIZATION/);
  assert.throws(() => composeModelInvocation({ authorized: true, messages, maxBudgetBytes: 4 }), /MANDATORY_BUDGET/);
});
test('CIN withholds wrong thread/group and memory superseded by operational records', () => {
  const result = composeModelInvocation({ authorized: true, messages, threadId: 't', audienceKind: 'DIRECT', recordSubjectKeys: ['sku:1'],
    mspSlices: [{ id: 'foreign', threadId: 'other', text: 'secret' }, { id: 'old-price', threadId: 't', text: 'old', subjectKey: 'sku:1' }] });
  assert.deepEqual(result.messages, messages);
  assert.deepEqual(result.receipt.dropped.map(item => item.reason), ['THREAD_SCOPE_MISMATCH', 'SUPERSEDED_BY_RECORD']);
  const group = composeModelInvocation({ authorized: true, messages, threadId: 't', audienceKind: 'GROUP',
    mspSlices: [{ id: 'private', threadId: 't', text: 'secret' }] });
  assert.deepEqual(group.messages, messages);
  assert.equal(group.receipt.dropped[0].reason, 'AUDIENCE_SCOPE_DENIED');
});
test('CIN budget counts UTF8 Thai, tools and framing, preserves protocol and contiguous memory', () => {
  const result = composeModelInvocation({ authorized: true, messages, threadId: 't', audienceKind: 'DIRECT', maxBudgetBytes: 600,
    mspSlices: [{ id: 'too-big', threadId: 't', text: 'ก'.repeat(300), sequence: 'exchanges' },
      { id: 'older', threadId: 't', text: 'small', sequence: 'exchanges' }, { id: 'fact', threadId: 't', text: 'okay' }] });
  assert.deepEqual(result.receipt.refs.msp, ['fact']);
  assert.equal(result.receipt.budget.trimmed, 2);
  assert.equal(result.receipt.budget.used, Buffer.byteLength(JSON.stringify({ messages: result.messages, tools: [] })));
  assert.deepEqual([result.messages[0], result.messages.at(-1)], messages);
});
