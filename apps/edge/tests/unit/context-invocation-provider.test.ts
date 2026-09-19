import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOpenAiCompatiblePort } from '../../src/answer/providers/openai-compatible.js';
import type { ModelRequest } from '../../src/answer/model-port.js';
import type { InvocationReceipt } from '../../src/answer/context-injection.js';

// @req FR-234 — actual provider rounds obey context receipts and submission state.
// @spec ADR-091 D7, SDD-100
// @tested this file
const config = { baseUrl: 'http://127.0.0.1:11434/v1', provider: 'openai-compatible' as const, model: 'qwen3.5:9b', effort: 'low' as const };
const request = (): ModelRequest => ({ system: 'trusted policy', messages: [{ role: 'user', content: 'question' }],
  tools: [], maxIterations: 3, timeoutMs: 1000, signal: new AbortController().signal,
  context: { authorized: true, threadId: 'msp:thread/test', audienceKind: 'DIRECT',
    mspSlices: [{ id: 'exchange:msp:exchange/test', threadId: 'msp:thread/test', text: 'private recalled preference' }] } });

test('each tool/model round hashes exactly the request sent and uses ordered receipt transitions', async () => {
  const receipts: InvocationReceipt[] = [];
  const states: string[] = [];
  const bodies: Array<{ messages: unknown[]; tools?: unknown[] }> = [];
  let validations = 0;
  const input = request();
  input.tools = [{ name: 'search_products', description: 'catalog lookup', inputSchema: { type: 'object' },
    run: async () => '{"price":100}' }];
  input.context = { ...input.context!, beforeInvocation: async () => { validations++; },
    onReceipt: receipt => receipts.push(receipt), lifecycle: async (receipt, state) => { states.push(`${receipt.receiptId}:${state}`); } };
  const port = createOpenAiCompatiblePort(config, { fetchFn: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: bodies.length === 1
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_products', arguments: '{}' } }] }
      : { role: 'assistant', content: 'ราคา 100 บาท' } }] });
  } });
  assert.equal((await port.generate(input)).text, 'ราคา 100 บาท');
  assert.equal(validations, 2);
  assert.equal(receipts.length, 2);
  assert.notEqual(receipts[0].receiptId, receipts[1].receiptId);
  assert.deepEqual(states, receipts.flatMap(receipt => ['RESOLVED', 'SUBMITTED', 'COMPLETED'].map(state => `${receipt.receiptId}:${state}`)));
  receipts.forEach((receipt, i) => assert.equal(receipt.hash, createHash('sha256')
    .update(JSON.stringify({ messages: bodies[i].messages, tools: bodies[i].tools ?? [] })).digest('hex')));
  assert.deepEqual(receipts[1].refs.records, ['call-1']);
});

test('revoked context prevents an invocation and exposes no private prompt', async () => {
  let fetches = 0;
  const input = request();
  input.context!.beforeInvocation = async () => { throw new Error('CONTEXT_REVOKED'); };
  const port = createOpenAiCompatiblePort(config, { fetchFn: async () => { fetches++; return Response.json({}); } });
  await assert.rejects(port.generate(input), /CONTEXT_REVOKED/);
  assert.equal(fetches, 0);
});

test('a refused RESOLVED checkpoint emits no model invocation receipt', async () => {
  const input = request();
  let fetches = 0;
  let receipts = 0;
  input.context!.onReceipt = () => { receipts++; };
  input.context!.lifecycle = async () => { throw new Error('CONTEXT_REVOKED'); };
  const port = createOpenAiCompatiblePort(config, { fetchFn: async () => { fetches++; return Response.json({}); } });
  await assert.rejects(port.generate(input), /CONTEXT_REVOKED/);
  assert.equal(fetches, 0);
  assert.equal(receipts, 0);
});

test('malformed provider JSON records FAILED rather than leaving a submitted injection open', async () => {
  const states: string[] = [];
  const input = request();
  input.context!.lifecycle = async (_receipt, state) => { states.push(state); };
  const port = createOpenAiCompatiblePort(config, { fetchFn: async () => new Response('private malformed payload', { status: 200 }) });
  await assert.rejects(port.generate(input), /MODEL_RESPONSE_INVALID/);
  assert.deepEqual(states, ['RESOLVED', 'SUBMITTED', 'FAILED']);
});

test('unknown SUBMITTED receipt aborts the active fetch and never starts another model call', async () => {
  const input = request();
  let signal: AbortSignal | null | undefined;
  let fetches = 0;
  input.context!.lifecycle = async (_receipt, state) => { if (state === 'SUBMITTED') throw new Error('ack lost'); };
  const port = createOpenAiCompatiblePort(config, { fetchFn: async (_url, init) => {
    fetches++; signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await assert.rejects(port.generate(input), /MSP_INJECTION_RECEIPT_UNKNOWN/);
  assert.equal(signal?.aborted, true);
  assert.equal(fetches, 1);
});

test('unknown failure receipt retains UNKNOWN instead of a retryable model error', async () => {
  const input = request();
  input.context!.lifecycle = async (_receipt, state) => { if (state === 'FAILED') throw new Error('provider receipt unreachable'); };
  const port = createOpenAiCompatiblePort(config, { fetchFn: async () => new Response('', { status: 503 }) });
  await assert.rejects(port.generate(input), /MSP_INJECTION_RECEIPT_UNKNOWN/);
});

test('abort while decoding provider body never records COMPLETED or returns an answer', async () => {
  const controller = new AbortController();
  const input = request();
  const states: string[] = [];
  input.signal = controller.signal;
  input.context!.lifecycle = async (_receipt, state) => { states.push(state); };
  const port = createOpenAiCompatiblePort(config, { fetchFn: async () => ({ ok: true, json: async () => {
    controller.abort(); return { choices: [{ message: { role: 'assistant', content: 'late answer' } }] };
  } } as Response) });
  await assert.rejects(port.generate(input));
  assert.ok(!states.includes('COMPLETED'));
});
