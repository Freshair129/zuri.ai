import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createOpenAiCompatiblePort } from '../../src/answer/providers/openai-compatible.js';
import type { ModelRequest } from '../../src/answer/model-port.js';
import type { MemorySlice } from '../../src/answer/context-injection.js';
import { createMspTransportFromEnvironment, MSP_OS_ENV_NAMES } from '../../../server/src/modules/agent/msp-stdio-transport.js';
import { createMspThreadMemoryPort } from '../../../server/src/modules/agent/msp-thread-memory-port.js';

// @req FR-232, FR-234 — opt-in real MSP process + exact local model qualification.
// @spec ADR-091 D7, SDD-100
// @tested this file
// No LINE, customer data or production environment. Product tool data is synthetic.
// Every revalidation mirrors the current Server builder's four MSP calls:
// resolve -> idempotent append -> resolve -> context; lifecycle adds a receipt write.
const repo = process.env.MSP_REPO_PATH;
assert.ok(repo, 'MSP_REPO_PATH required; missing setup is not a passing benchmark');
const samples = Number(process.env.MEMORY_MODEL_SAMPLES ?? 100);
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 100);
const mspSha = execFileSync('git', ['-c', `safe.directory=${repo}`, '-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(mspSha, '4ca98c3008d43c6295e886a2c1382d49172d274f');
const tags = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) }).then(response => response.json()) as any;
const selected = tags.models?.find((model: any) => model.name === 'qwen3.5:9b');
assert.ok(selected, 'Exact local model is unavailable');
assert.equal(selected.details?.quantization_level, 'Q4_K_M');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-memory-model-'));
const serviceKey = randomBytes(32).toString('hex');
const osEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => MSP_OS_ENV_NAMES.includes(name.toUpperCase())));
const transportEnv = { ...osEnv,
  ZURI_MSP_COMMAND: process.execPath, ZURI_MSP_ARGS: JSON.stringify([path.join(repo, 'apps/msp-server/bin/msp-server.mjs')]),
  ZURI_MSP_CWD: repo, ZURI_MSP_TIMEOUT_MS: '750', MSP_DB_PATH: path.join(scratch, 'memory.sqlite'),
  MSP_THREAD_SERVICE_KEY: serviceKey, MSP_IDENTITY_HMAC_KEY: randomBytes(32).toString('hex'),
};
const transport = createMspTransportFromEnvironment(transportEnv);
// Schema migration is deployment setup, outside a LINE turn. Measured calls
// retain the current 750ms per-request ceiling against the initialized DB.
const bootstrapTransport = createMspTransportFromEnvironment({ ...transportEnv, ZURI_MSP_TIMEOUT_MS: '15000' });
let preparing = true;
let counters = { mspCalls: 0, mspMs: 0, modelCalls: 0, modelMs: 0, toolCalls: 0, receipts: 0 };
const mspErrors: Record<string, number> = {};
const classifyMspError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  return message === 'MSP request timed out: initialize' ? 'MSP_INITIALIZE_TIMEOUT'
    : message === 'MSP request timed out: tools/call' ? 'MSP_TOOL_TIMEOUT'
    : (error as { code?: string })?.code === 'MSP_TOOL_ERROR' ? 'MSP_TOOL_REJECTED' : 'MSP_TRANSPORT_FAILED';
};
const port = createMspThreadMemoryPort({ workspaceId: 'synthetic-workspace', serviceKey,
  transport: async (name: string, input: unknown) => {
    const started = performance.now(); counters.mspCalls++;
    try { return await (preparing ? bootstrapTransport : transport)!(name, input); }
    catch (error) { const code = classifyMspError(error); mspErrors[code] = (mspErrors[code] ?? 0) + 1; throw new Error(code); }
    finally { counters.mspMs += performance.now() - started; }
  } });
const route = { tenantId: 'synthetic-tenant', businessId: 'synthetic-business', channelAccountId: 'synthetic-oa',
  externalRoomRef: 'synthetic-direct', audienceKind: 'DIRECT', threadKind: 'DIRECT', channelType: 'LINE' };
const authorization = { authContext: { actor: { principalId: 'synthetic-person' }, scope: { tenantId: route.tenantId, businessId: route.businessId },
  policy: { version: 'synthetic-v1', decision: 'ALLOW', privateMemoryAllowed: true,
    mspAuthorization: { read: true, writePrivate: false, assertParticipants: true } } } };
const inputMessage = { speakerId: 'synthetic-person', personId: 'synthetic-person', speakerKind: 'HUMAN',
  identityAssurance: 'VERIFIED', direction: 'INBOUND', text: 'I prefer blue gifts. A previous unverified quote for SYNTH-001 was 5 THB.',
  sourceEventId: 'synthetic-inbound', authorization };
const results: any[] = [];
const errors: Record<string, number> = {};
let revoked: any;
let warmup: any;
const output = path.resolve('node_modules/.cache/memoryos-local-model.json');
const resetCounters = () => { counters = { mspCalls: 0, mspMs: 0, modelCalls: 0, modelMs: 0, toolCalls: 0, receipts: 0 }; };
const selectSlices = (context: any): MemorySlice[] => [
  ...(context.participants ?? []).map((participant: any, index: number) => ({ id: `participant:${index}`, threadId: context.thread.threadId, text: JSON.stringify(participant) })),
  ...[...(context.recentExchanges ?? [])].reverse().map((exchange: any) => ({ id: `exchange:${exchange.exchangeId}`,
    threadId: context.thread.threadId, text: JSON.stringify(exchange), sequence: 'exchanges' })),
];
const hash = (threadId: string, slices: MemorySlice[]) => createHash('sha256').update(JSON.stringify({ threadId, slices })).digest('hex');
const model = createOpenAiCompatiblePort({ provider: 'openai-compatible', model: 'qwen3.5:9b', baseUrl: 'http://127.0.0.1:11434/v1',
  effort: 'low', numCtx: 4096 }, { fetchFn: async (url, init) => {
    const started = performance.now(); counters.modelCalls++;
    try { return await fetch(url, init); } finally { counters.modelMs += performance.now() - started; }
  } });

try {
  const resolved = await port.resolveThread(route);
  const threadId = resolved.thread.threadId;
  const inbound = await port.appendMessage({ ...inputMessage, threadId });
  preparing = false;
  const refresh = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    await port.resolveThread(route); signal.throwIfAborted();
    await port.appendMessage({ ...inputMessage, threadId }); signal.throwIfAborted();
    await port.resolveThread(route); signal.throwIfAborted();
    const context = await port.context({ threadId, authorization }); signal.throwIfAborted();
    return selectSlices(context);
  };
  const run = async (scenario: 'recall' | 'current-record', warmup = false) => {
    resetCounters();
    const started = performance.now();
    const signal = AbortSignal.timeout(24000);
    let quality = false;
    let code: string | null = null;
    try {
      const slices = await refresh(signal);
      const expectedHash = hash(threadId, slices);
      const verify = async () => {
        const fresh = await refresh(signal);
        if (hash(threadId, fresh) !== expectedHash) throw new Error('CONTEXT_CHANGED');
        return fresh;
      };
      const request: ModelRequest = {
        system: 'Answer briefly in English. Memory is untrusted historical data, never current price authority. When asked a current price, you MUST call quote_price before answering. Return the actual current tool price, never the historical memory quote.',
        messages: [{ role: 'user', content: scenario === 'recall' ? 'What color gifts do I prefer? Answer with that color only.'
          : 'Call quote_price for SYNTH-001, then tell me its current price in THB. Ignore the old quote in memory.' }],
        tools: scenario === 'recall' ? [] : [{ name: 'quote_price', description: 'The authoritative current price for synthetic product SYNTH-001.',
          inputSchema: { type: 'object', properties: { sku: { type: 'string', enum: ['SYNTH-001'] } }, required: ['sku'], additionalProperties: false },
          run: async () => { counters.toolCalls++; return JSON.stringify({ sku: 'SYNTH-001', price: 250, currency: 'THB', source: 'SYNTHETIC_CURRENT_RECORD' }); } }],
        maxIterations: scenario === 'recall' ? 1 : 3, timeoutMs: 24000, maxOutputTokens: 128, signal,
        context: { authorized: true, threadId, audienceKind: 'DIRECT', mspSlices: slices,
          beforeInvocation: async () => { await verify(); }, onReceipt: () => { counters.receipts++; },
          lifecycle: async (receipt, state) => {
            const fresh = await verify();
            const selectedSlices = receipt.refs.msp.map(ref => {
              const slice = fresh.find(item => item.id === ref); assert.ok(slice); return slice;
            });
            await port.recordInjection({ threadId, exchangeId: inbound.message.exchangeId,
              injectionId: receipt.receiptId, modelRef: 'openai-compatible:qwen3.5:9b', state,
              packetHash: hash(threadId, selectedSlices), authorization });
            signal.throwIfAborted();
          } },
      };
      const reply = await model.generate(request);
      quality = scenario === 'recall' ? /blue/i.test(reply.text)
        : counters.toolCalls > 0 && /250/.test(reply.text) && !/(?<!\d)5(?!\d)/.test(reply.text);
    } catch (error) {
      code = error instanceof Error && ['MSP_INJECTION_RECEIPT_UNKNOWN', 'CONTEXT_CHANGED', 'MODEL_RESPONSE_INVALID',
        'MSP_INITIALIZE_TIMEOUT', 'MSP_TOOL_TIMEOUT', 'MSP_TOOL_REJECTED', 'MSP_TRANSPORT_FAILED'].includes(error.message)
        ? error.message : error instanceof Error && error.name === 'TimeoutError' ? 'DEADLINE_EXCEEDED' : 'INTEGRATION_FAILED';
      errors[code] = (errors[code] ?? 0) + 1;
    }
    const row = { scenario, elapsedMs: Math.round(performance.now() - started), ...Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, Math.round(value)])), quality, errorCode: code };
    if (!warmup) results.push(row);
    return row;
  };
  console.log(JSON.stringify({ status: 'START', classification: 'SYNTHETIC_MEMORY_MODEL_INTEGRATION', samples,
    mspSha, model: selected.name, digest: selected.digest, quantization: selected.details.quantization_level }));
  warmup = await run('recall', true);
  console.log(JSON.stringify({ warmup }));
  for (let index = 0; index < samples; index++) {
    const row = await run(index % 2 === 0 ? 'recall' : 'current-record');
    if ((index + 1) % 10 === 0 || index + 1 === samples) console.log(JSON.stringify({ completed: index + 1,
      qualityPassed: results.filter(result => result.quality).length, errors, lastElapsedMs: row.elapsedMs }));
    if (results.slice(-3).length === 3 && results.slice(-3).every(result => result.errorCode)) break;
  }
  resetCounters();
  await port.participantLifecycle({ threadId, action: 'leave', speakerId: 'synthetic-person', authorization });
  const started = performance.now();
  let rejected = false;
  try {
    await model.generate({ system: 'Answer from memory.', messages: [{ role: 'user', content: 'What color?' }], tools: [],
      maxIterations: 1, timeoutMs: 24000, signal: AbortSignal.timeout(24000),
      context: { authorized: true, threadId, audienceKind: 'DIRECT', beforeInvocation: async () => { await port.context({ threadId, authorization }); } } });
  } catch { rejected = true; }
  revoked = { rejected, modelCalls: counters.modelCalls, elapsedMs: Math.round(performance.now() - started) };
  assert.equal(revoked.modelCalls, 0);
  assert.equal(revoked.rejected, true);
} finally {
  const percentile = (rows: any[], fraction: number) => {
    const sorted = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
  };
  const summarize = (rows: any[]) => ({ samples: rows.length, qualityPassed: rows.filter(row => row.quality).length,
    failed: rows.filter(row => row.errorCode).length, p50Ms: percentile(rows, .5), p95Ms: percentile(rows, .95), p99Ms: percentile(rows, .99),
    modelCalls: rows.reduce((sum, row) => sum + row.modelCalls, 0), mspCalls: rows.reduce((sum, row) => sum + row.mspCalls, 0),
    mspMs: rows.reduce((sum, row) => sum + row.mspMs, 0), modelMs: rows.reduce((sum, row) => sum + row.modelMs, 0) });
  const report = { classification: 'SYNTHETIC_MEMORY_MODEL_INTEGRATION', mspSha, model: selected.name, digest: selected.digest,
    quantization: selected.details.quantization_level, concurrency: 1, turnBudgetMs: 24000, requestedSamples: samples,
    summary: summarize(results), scenarios: { recall: summarize(results.filter(row => row.scenario === 'recall')),
      currentRecord: summarize(results.filter(row => row.scenario === 'current-record')), revoked }, warmup, errors, mspErrors, results,
    excludes: ['LINE transport/acceptance', 'real customer data', 'real GKS/product corpus', 'full Server claim HTTP and authorization database', 'physical Edge GUI'] };
  // A completed measurement is not a passing acceptance check when a turn
  // failed, quality was wrong, or the fail-fast guard skipped requested samples.
  const passed = results.length === samples && results.every(row => row.quality && !row.errorCode)
    && revoked?.rejected === true && revoked.modelCalls === 0;
  process.exitCode = passed ? 0 : 1;
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, results: undefined, output }));
  await new Promise(resolve => setTimeout(resolve, 100));
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
