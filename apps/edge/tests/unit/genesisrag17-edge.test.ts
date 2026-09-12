import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GenesisLocalRag, type AnswerRag } from '../../src/rag/genesis-rag.js';
import type { SearchEvidenceV4 } from '../../src/answer/format-cards.js';
import { compactSearchForModel } from '../../src/answer/tools.js';
import { createConversationExecutor } from '../../src/conversation/executor.js';
import type { ConversationJob } from '../../src/conversation/contract.js';
import {
  GenesisRag17ConfigError, loadGenesisRag17Settings, parseFallbackUntil, MODE_ENV,
} from '../../src/rag/genesisrag17/settings.js';
import {
  createGenesisRag17Runtime, parsePublishedQueryResult, wrapAnswerRag,
} from '../../src/rag/genesisrag17/published-rag.js';
import { createRecordStore, readRecords, summarizeRecords, type GenesisRag17Record, type RecordStore } from '../../src/rag/genesisrag17/record-store.js';
import { createMspStdioTransport, mspChildEnvironment, MSP_RUNTIME_ENV_NAMES, MSP_OS_ENV_NAMES, MspTransportError, type MspToolCall } from '../../src/rag/genesisrag17/msp-stdio.js';
import { fileURLToPath } from 'node:url';

// @req FR-189 — off unchanged, shadow never changes the answer, primary reads the published
//   generation and falls back to v4 only before the configured sunset, report aggregation.
// @spec ADR-075 D7, ADR-075 D8 Phase 4

const scope = { portfolioId: 'portfolio-1', tenantId: 'tenant-1', businessId: 'business-1', workspaceId: '', agentId: '', visibility: 'private' as const };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fr189-'));

function env(mode: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const root = tmp();
  const script = path.join(root, 'msp-server.mjs');
  fs.writeFileSync(script, '');
  return {
    [MODE_ENV]: mode,
    ZURI_MSP_COMMAND: process.execPath,
    ZURI_MSP_ARGS: JSON.stringify([script]),
    ZURI_EDGE_GENESISRAG17_CREDENTIAL: 'cred-test',
    ZURI_EDGE_GENESISRAG17_SCOPE: JSON.stringify(scope),
    ZURI_EDGE_GENESISRAG17_RECORD_ROOT: path.join(root, 'records'),
    ...extra,
  };
}

const match = (code: string) => ({
  kind: 'model', id: `model-${code}`, code, name: `สินค้า ${code}`, englishName: null, type: null, group: null,
  score: 0.9, status: 'active', image: null, variants: [], priceLadder: [], selectedPrice: null,
  components: [], customizations: [], sourceRef: null,
}) as unknown as SearchEvidenceV4['matches'][number];

const v4Evidence = (query: string, codes: string[]): SearchEvidenceV4 => ({
  query, parsed: null, matchCount: codes.length, matches: codes.map(match), nearest: [], priceSource: 'commercial_sku',
});

function fakeV4(codes: string[] = ['TMS06-4']) {
  const calls: string[] = [];
  let last: SearchEvidenceV4 | null = null;
  const rag: AnswerRag = {
    async searchProducts(query) { calls.push('search'); last = v4Evidence(query, codes); return last; },
    async searchWithConstraints(params) { calls.push('constraints'); last = v4Evidence(params.query, codes); return last; },
    async priceForCode(code) {
      calls.push('price');
      return { found: true, code, priceLadder: [], selectedPrice: null, exportDate: '2026-09-01', priceSource: 'commercial_sku' };
    },
    async health() { return { ok: true }; },
  };
  return { rag, calls, last: () => last };
}

const hit = (code: string, index = 0) => ({
  id: `hit-${index}`, snapshotId: 'snap-1', generation: '7', score: 0.8 - index / 10,
  text: JSON.stringify({ entityType: 'PRODUCT', externalId: code, name: 'ไม่ควรถูกบันทึก' }),
  citation: { sourceId: `source-${code}`, rawArtifactId: 'raw-1', parsedArtifactId: 'parsed-1', chunkId: `chunk-${index}`, contentHash: 'a'.repeat(64) },
});
const envelope = (codes: string[]) => ({ schemaVersion: 'genesisrag17.v1', scope, snapshotId: 'snap-1', generation: '7', results: codes.map(hit) });

function fakeMsp(respond: () => unknown) {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const call: MspToolCall = async (name, input) => { calls.push({ name, input }); return respond() as Record<string, unknown>; };
  return { call, calls };
}

function memoryStore() {
  const records: GenesisRag17Record[] = [];
  const store: RecordStore = { append(record) { records.push(record); return true; } };
  return { store, records };
}

const at = (iso: string) => () => new Date(iso);

const job = (): ConversationJob => ({
  id: '10c0eacf-1e65-413a-a6c1-3f6d125cf123', version: 1, question: 'สินค้าอะไรบ้าง',
  conversationKey: 'server-account:conversation-id', leaseExpiresAt: new Date(Date.now() + 300000).toISOString(),
  policy: { modelAccess: 'LOCAL_ONLY', role: 'sales', retainHistory: false },
});

test('off is the default, needs nothing, and hands the answer the v4 door itself', async () => {
  assert.equal(loadGenesisRag17Settings({}), null);
  assert.equal(createGenesisRag17Runtime({ [MODE_ENV]: 'off', ZURI_MSP_COMMAND: '' }), null);
  const v4 = fakeV4();
  assert.equal(wrapAnswerRag(v4.rag, null), v4.rag);

  let seen: unknown;
  const execute = createConversationExecutor({ catalogRoot: tmp() }, {
    genesisRag17: createGenesisRag17Runtime({}),
    answer: (async (_question: string, options: { rag: unknown }) => { seen = options.rag; return { text: 'ตอบ', source: 'model' }; }) as never,
  });
  assert.deepEqual(await execute(job()), { text: 'ตอบ', source: 'model' });
  assert.ok(seen instanceof GenesisLocalRag, 'off must pass the unwrapped v4 GenesisLocalRag');

  const compact = compactSearchForModel(v4Evidence('q', ['TMS06-4'])) as Record<string, unknown>;
  assert.equal('passages' in compact, false);
  assert.equal('published' in compact, false);
});

test('a mode other than off refuses to start without its prerequisites, naming the setting and never its value', () => {
  assert.throws(() => loadGenesisRag17Settings({ [MODE_ENV]: 'sometimes' }), GenesisRag17ConfigError);
  assert.throws(() => loadGenesisRag17Settings({ [MODE_ENV]: 'shadow' }), /ZURI_MSP_COMMAND/);
  assert.throws(() => loadGenesisRag17Settings({ ...env('shadow'), ZURI_MSP_ARGS: JSON.stringify([path.join(tmp(), 'absent.mjs')]) }), /entry script/);
  assert.throws(() => loadGenesisRag17Settings({ ...env('shadow'), ZURI_MSP_COMMAND: path.join(tmp(), 'no-msp.exe') }), /executable/);
  assert.throws(() => loadGenesisRag17Settings({ ...env('shadow'), ZURI_EDGE_GENESISRAG17_CREDENTIAL: '' }), /CREDENTIAL/);
  assert.throws(() => loadGenesisRag17Settings({ ...env('shadow'), ZURI_EDGE_GENESISRAG17_SCOPE: JSON.stringify({ ...scope, visibility: 'public' }) }), /visibility/);
  assert.throws(() => loadGenesisRag17Settings(env('primary')), /FALLBACK_UNTIL/);
  try {
    loadGenesisRag17Settings({ ...env('shadow'), ZURI_EDGE_GENESISRAG17_CREDENTIAL: 'secret-value-123', ZURI_EDGE_GENESISRAG17_SCOPE: '' });
    assert.fail('expected a refusal');
  } catch (error) {
    assert.ok(error instanceof GenesisRag17ConfigError);
    assert.equal(String(error.message).includes('secret-value-123'), false);
  }
  assert.ok(loadGenesisRag17Settings(env('shadow')));
  assert.equal(loadGenesisRag17Settings(env('primary', { ZURI_EDGE_GENESISRAG17_FALLBACK_UNTIL: '2027-03-31' }))?.fallbackUntil?.toISOString(), '2027-03-31T16:59:59.999Z');
  assert.equal(parseFallbackUntil('2027-02-28T00:00:00Z').toISOString(), '2027-02-28T00:00:00.000Z');

  // The compute worker reads the mode at start-up, so a half-configured mode stops it from starting.
  const previous = process.env[MODE_ENV];
  const previousCommand = process.env.ZURI_MSP_COMMAND;
  process.env[MODE_ENV] = 'shadow';
  delete process.env.ZURI_MSP_COMMAND;
  try {
    assert.throws(() => createConversationExecutor({}), /ZURI_MSP_COMMAND/);
  } finally {
    if (previous === undefined) delete process.env[MODE_ENV]; else process.env[MODE_ENV] = previous;
    if (previousCommand !== undefined) process.env.ZURI_MSP_COMMAND = previousCommand;
  }
});

test('shadow answers exactly as v4 and records a content-free comparison', async () => {
  const v4 = fakeV4(['TMS06-4', 'ABC-100']);
  const msp = fakeMsp(() => envelope(['TMS06-4']));
  const memory = memoryStore();
  const runtime = createGenesisRag17Runtime(env('shadow'), { call: msp.call, store: memory.store, now: at('2026-12-24T03:00:00Z') });
  const rag = wrapAnswerRag(v4.rag, runtime);

  const question = 'แก้วเก็บความเย็นสำหรับของขวัญปีใหม่';
  const answer = await rag.searchProducts(question, 5);
  assert.equal(answer, v4.last(), 'shadow returns the v4 evidence object itself');
  await runtime!.flush();

  assert.equal(msp.calls.length, 1);
  assert.equal(msp.calls[0].name, 'msp_pipeline_query');
  assert.deepEqual(msp.calls[0].input, { schemaVersion: 'genesisrag17.v1', scope, credential: 'cred-test', query: question, topK: 5 });

  assert.equal(memory.records.length, 1);
  const record = memory.records[0] as Extract<GenesisRag17Record, { outcome: 'compared' }>;
  assert.equal(record.kind, 'shadow');
  assert.equal(record.outcome, 'compared');
  assert.equal(record.generation, '7');
  assert.equal(record.snapshotId, 'snap-1');
  assert.deepEqual(
    { v4Count: record.v4Count, publishedCount: record.publishedCount, overlapCount: record.overlapCount, top1Match: record.top1Match, mismatch: record.mismatch },
    { v4Count: 2, publishedCount: 1, overlapCount: 1, top1Match: true, mismatch: false },
  );
  const serialized = JSON.stringify(memory.records);
  for (const content of [question, 'สินค้า', 'ไม่ควรถูกบันทึก', 'cred-test']) assert.equal(serialized.includes(content), false, content);

  // Price lookups are answered by v4 and not shadowed: there is no published equivalent before FR-188.
  await rag.priceForCode('TMS06-4', 100);
  await runtime!.flush();
  assert.equal(memory.records.length, 1);
});

test('shadow records a mismatch when one side is empty or the two share no product', async () => {
  const memory = memoryStore();
  for (const published of [[], ['OTHER-1']]) {
    const runtime = createGenesisRag17Runtime(env('shadow'), { call: fakeMsp(() => envelope(published)).call, store: memory.store, now: at('2026-12-24T03:00:00Z') });
    const answer = await wrapAnswerRag(fakeV4(['X-100']).rag, runtime).searchProducts('ร่ม', 5);
    assert.equal(answer.matches[0].code, 'X-100');
    await runtime!.flush();
  }
  const [empty, disjoint] = memory.records as Array<Extract<GenesisRag17Record, { outcome: 'compared' }>>;
  assert.equal(empty.mismatch, true);
  assert.equal(empty.publishedEmpty, true);
  assert.equal(disjoint.mismatch, true);
  assert.equal(disjoint.overlapCount, 0);
  assert.equal(summarizeRecords(memory.records).shadow.mismatches, 2);
});

test('a shadow failure never reaches the answer', async () => {
  const failures: Array<[string, () => unknown]> = [
    ['MSP_TRANSPORT_UNAVAILABLE', () => { throw new MspTransportError('MSP process exited with code 1'); }],
    ['MSP_TOOL_ERROR', () => { throw new MspTransportError('vault_scope_denied', 'MSP_TOOL_ERROR'); }],
    ['GENESISRAG17_INVALID_RESPONSE', () => ({ ...envelope(['TMS06-4']), results: [{ ...hit('TMS06-4'), citation: { sourceId: 's' } }] })],
  ];
  for (const [code, respond] of failures) {
    const memory = memoryStore();
    const v4 = fakeV4();
    const runtime = createGenesisRag17Runtime(env('shadow'), { call: fakeMsp(respond).call, store: memory.store });
    const answer = await wrapAnswerRag(v4.rag, runtime).searchProducts('กระติกน้ำ', 5);
    assert.equal(answer, v4.last());
    await runtime!.flush();
    assert.equal(memory.records.length, 1);
    assert.deepEqual({ outcome: (memory.records[0] as { outcome: string }).outcome, errorCode: (memory.records[0] as { errorCode: string }).errorCode }, { outcome: 'error', errorCode: code });
    assert.equal(JSON.stringify(memory.records).includes('vault_scope_denied'), false, 'MSP error text is never recorded');
  }

  // Even a record store that throws cannot change the answer.
  const v4 = fakeV4();
  const throwingStore: RecordStore = { append() { throw new Error('disk full'); } };
  const runtime = createGenesisRag17Runtime(env('shadow'), { call: fakeMsp(() => envelope(['TMS06-4'])).call, store: throwingStore });
  assert.equal(await wrapAnswerRag(v4.rag, runtime).searchProducts('กระติกน้ำ', 5), v4.last());
  await runtime!.flush();
});

test('primary answers from the published generation with its citation, without asking v4', async () => {
  const v4 = fakeV4();
  const memory = memoryStore();
  const runtime = createGenesisRag17Runtime(env('primary', { ZURI_EDGE_GENESISRAG17_FALLBACK_UNTIL: '2027-03-31' }), {
    call: fakeMsp(() => envelope(['TMS06-4', 'ABC-100'])).call, store: memory.store, now: at('2026-12-01T00:00:00Z'),
  });
  const evidence = await wrapAnswerRag(v4.rag, runtime).searchProducts('แก้ว', 5);
  assert.deepEqual(v4.calls, []);
  assert.deepEqual(evidence.published, { schemaVersion: 'genesisrag17.v1', snapshotId: 'snap-1', generation: '7' });
  assert.equal(evidence.matchCount, 2);
  assert.deepEqual(evidence.matches, []);
  assert.deepEqual(evidence.passages?.[0].citation, hit('TMS06-4').citation);
  assert.deepEqual(memory.records.map((r) => r.kind), ['primary']);

  const compact = compactSearchForModel(evidence) as { published: unknown; passages: Array<{ chunkId: string }> };
  assert.deepEqual(compact.published, { snapshotId: 'snap-1', generation: '7' });
  assert.equal(compact.passages[1].chunkId, 'chunk-1');
});

test('primary falls back to v4 only strictly before the configured sunset, and records every fallback', async () => {
  const sunset = '2027-03-31T00:00:00Z';
  const scenario = async (now: string) => {
    const v4 = fakeV4();
    const memory = memoryStore();
    const runtime = createGenesisRag17Runtime(env('primary', { ZURI_EDGE_GENESISRAG17_FALLBACK_UNTIL: sunset }), {
      call: fakeMsp(() => { throw new MspTransportError('MSP request timed out: tools/call'); }).call, store: memory.store, now: at(now),
    });
    const rag = wrapAnswerRag(v4.rag, runtime);
    return { v4, memory, search: await rag.searchProducts('ร่ม', 5), price: await rag.priceForCode('TMS06-4', 50), budget: await rag.searchWithConstraints({ query: '', qty: 100, budgetPerUnit: 300 }) };
  };

  const before = await scenario('2027-03-30T23:59:59Z');
  assert.deepEqual(before.v4.calls, ['search', 'price', 'constraints']);
  assert.equal(before.search.unavailable, undefined);
  assert.equal(before.price.found, true);
  assert.deepEqual(before.memory.records.map((r) => [r.kind, (r as { reason: string }).reason]), [
    ['fallback', 'MSP_TRANSPORT_UNAVAILABLE'], ['fallback', 'UNSUPPORTED_OPERATION'], ['fallback', 'UNSUPPORTED_OPERATION'],
  ]);

  for (const now of [sunset, '2027-06-01T00:00:00Z']) {
    const after = await scenario(now);
    assert.deepEqual(after.v4.calls, [], `no v4 answer at ${now}`);
    assert.equal(after.search.unavailable, true);
    assert.match(String(after.search.reason), /^genesisrag17_unavailable:MSP_TRANSPORT_UNAVAILABLE$/);
    assert.equal(after.price.found, false);
    assert.equal(after.price.unavailable, true);
    assert.equal(after.budget.unavailable, true);
    assert.deepEqual(after.memory.records.map((r) => r.kind), ['primary_unavailable', 'primary_unavailable', 'primary_unavailable']);
  }
});

test('the published response is checked at the edge boundary: one generation, full citations, its own scope', () => {
  assert.equal(parsePublishedQueryResult(envelope(['A-1']), scope, 5).passages.length, 1);
  const bad = [
    { ...envelope(['A-1']), scope: { ...scope, tenantId: 'someone-else' } },
    { ...envelope(['A-1']), results: [{ ...hit('A-1'), generation: '6' }] },
    { ...envelope(['A-1', 'B-2']) },
    { ...envelope(['A-1']), schemaVersion: 'genesisrag17.v0' },
  ];
  assert.throws(() => parsePublishedQueryResult(bad[0], scope, 5), /INVALID_RESPONSE/);
  assert.throws(() => parsePublishedQueryResult(bad[1], scope, 5), /INVALID_RESPONSE/);
  assert.throws(() => parsePublishedQueryResult(bad[2], scope, 1), /INVALID_RESPONSE/);
  assert.throws(() => parsePublishedQueryResult(bad[3], scope, 5), /INVALID_RESPONSE/);
});

test('the report aggregates comparisons, mismatches, errors and fallbacks by Bangkok day', () => {
  const root = tmp();
  const store = createRecordStore({ root, retentionDays: 400, maxRecordsPerDay: 100 });
  const compared = (iso: string, mismatch: boolean, generation = '7'): GenesisRag17Record => ({
    kind: 'shadow', at: iso, operation: 'search', outcome: 'compared', snapshotId: 'snap-1', generation,
    v4Count: 2, publishedCount: mismatch ? 0 : 2, overlapCount: mismatch ? 0 : 2, top1Match: !mismatch,
    v4Empty: false, publishedEmpty: mismatch, v4Unavailable: false, mismatch, v4LatencyMs: 12, publishedLatencyMs: 40,
  });
  // 2026-12-24T18:00Z is already 25 December in Bangkok.
  for (const record of [
    compared('2026-12-24T03:00:00Z', false),
    compared('2026-12-24T04:00:00Z', true),
    { kind: 'shadow', at: '2026-12-24T05:00:00Z', operation: 'search', outcome: 'error', errorCode: 'MSP_TRANSPORT_UNAVAILABLE', publishedLatencyMs: 8000 } as GenesisRag17Record,
    compared('2026-12-24T18:00:00Z', false, '8'),
    { kind: 'fallback', at: '2026-12-24T19:00:00Z', operation: 'price', reason: 'UNSUPPORTED_OPERATION', fallbackUntil: '2027-03-31T16:59:59.999Z' } as GenesisRag17Record,
  ]) assert.equal(store.append(record), true);

  const report = summarizeRecords(readRecords(root));
  assert.equal(report.records, 5);
  assert.deepEqual(report.shadow, { compared: 3, mismatches: 1, emptinessDisagreements: 1, zeroOverlap: 0, top1Agreements: 2, errors: 1 });
  assert.deepEqual(report.primary, { served: 0, fallbacks: 1, unavailable: 0 });
  assert.deepEqual(report.generations, ['7', '8']);
  assert.deepEqual(report.byDay, [
    { day: '2026-12-24', compared: 2, mismatches: 1, shadowErrors: 1, served: 0, fallbacks: 0, unavailable: 0 },
    { day: '2026-12-25', compared: 1, mismatches: 0, shadowErrors: 0, served: 0, fallbacks: 1, unavailable: 0 },
  ]);
  assert.equal(summarizeRecords(readRecords(root, { since: '2026-12-25' })).records, 2);
});

test('the record store is bounded per day and prunes past its retention', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'genesisrag17-2020-01-01.jsonl'), '{}\n');
  fs.writeFileSync(path.join(root, 'genesisrag17-2026-12-01.jsonl'), '');
  const store = createRecordStore({ root, retentionDays: 30, maxRecordsPerDay: 2 });
  const record = { kind: 'fallback', at: '2026-12-24T03:00:00Z', operation: 'price', reason: 'UNSUPPORTED_OPERATION', fallbackUntil: 'x' } as GenesisRag17Record;
  assert.deepEqual([store.append(record), store.append(record), store.append(record)], [true, true, false]);
  assert.equal(fs.readFileSync(path.join(root, 'genesisrag17-2026-12-24.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.equal(fs.existsSync(path.join(root, 'genesisrag17-2020-01-01.jsonl')), false);
  assert.equal(fs.existsSync(path.join(root, 'genesisrag17-2026-12-01.jsonl')), true);
});

const FAKE_MSP = `
import readline from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {} } });
  const { name, arguments: args } = message.params;
  if (name === 'fail') return send({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: 'vault_scope_denied' }] } });
  if (name === 'msp_pipeline_query') return send({ jsonrpc: '2.0', id: message.id, result: { structuredContent: {
    schemaVersion: 'genesisrag17.v1', scope: args.scope, snapshotId: 'snap-9', generation: 3,
    results: [{ id: 'h1', snapshotId: 'snap-9', generation: 3, score: 0.5, text: '{"externalId":"TMS06-4"}',
      citation: { sourceId: 's1', rawArtifactId: 'r1', parsedArtifactId: 'p1', chunkId: 'c1', contentHash: 'b'.repeat(64) } }],
  } } });
  send({ jsonrpc: '2.0', id: message.id, result: { structuredContent: {
    echo: name, query: args.query,
    sawDeviceKey: Boolean(process.env.ZURI_EDGE_DEVICE_KEY),
    sawCredential: Boolean(process.env.ZURI_EDGE_GENESISRAG17_CREDENTIAL),
  } } });
});
`;

test('the MSP stdio transport speaks initialize then tools/call, and keeps edge secrets from the child', async () => {
  const script = path.join(tmp(), 'fake-msp.mjs');
  fs.writeFileSync(script, FAKE_MSP);
  const call = createMspStdioTransport({ command: process.execPath, args: [script], timeoutMs: 10000 }, {
    ...process.env, ZURI_EDGE_DEVICE_KEY: 'edgk_secret', ZURI_EDGE_GENESISRAG17_CREDENTIAL: 'cred-test',
  });
  assert.deepEqual(await call('echo_tool', { query: 'q' }), { echo: 'echo_tool', query: 'q', sawDeviceKey: false, sawCredential: false });
  await assert.rejects(call('fail', {}), (error: unknown) => error instanceof MspTransportError && error.code === 'MSP_TOOL_ERROR' && /vault_scope_denied/.test(error.message));
  const missing = createMspStdioTransport({ command: path.join(tmp(), 'no-such-msp.exe'), args: [], timeoutMs: 5000 });
  await assert.rejects(missing('msp_pipeline_query', {}), (error: unknown) => error instanceof MspTransportError && error.code === 'MSP_TRANSPORT_UNAVAILABLE');

  // End to end through a real child process: primary mode, real transport, published passage cited.
  const memory = memoryStore();
  const runtime = createGenesisRag17Runtime(
    env('primary', { ZURI_MSP_ARGS: JSON.stringify([script]), ZURI_EDGE_GENESISRAG17_FALLBACK_UNTIL: '2027-03-31' }),
    { store: memory.store, now: at('2026-12-01T00:00:00Z') },
  );
  const evidence = await wrapAnswerRag(fakeV4().rag, runtime).searchProducts('แก้ว', 5);
  assert.deepEqual(evidence.published, { schemaVersion: 'genesisrag17.v1', snapshotId: 'snap-9', generation: '3' });
  assert.equal(evidence.passages?.[0].citation.chunkId, 'c1');
});

// @req SEC — the MSP child gets an allowlisted environment, never this process's environment minus
//   a list of secrets someone remembered to name. zuri-ai's server transport was converted first
//   (apps/server/src/modules/agent/msp-stdio-transport.js); this is the same boundary from edge.
// @spec ADR-075 D7
const MSP_ALLOWLISTED_ENV = {
  MSP_DB_PATH: '/edge-test/msp.sqlite',
  MSP_GKS_COMMAND: 'node',
  MSP_GKS_ARGS: '["gks.mjs"]',
  MSP_GKS_CWD: '/gks',
  MSP_PIPELINE_PRINCIPALS: '[]',
  MSP_GKS_PIPELINE_CREDENTIAL: 'relay-credential',
  MSP_PIPELINE_WORKER_URL: 'http://127.0.0.1:1234/query',
  MSP_PIPELINE_WORKER_TOKEN: 'worker-token',
  OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
  GKS_DB_PATH: '/edge-test/gks.sqlite',
  GKS_PIPELINE_RELAY_CREDENTIAL: 'gks-relay-credential',
  GKS_DEFAULT_PORTFOLIO_ID: 'portfolio-1',
  GKS_AUTOMERGE_FLOOR: '0.91',
  PATH: process.env.PATH ?? '/usr/bin',
  TEMP: '/tmp',
  LANG: 'C.UTF-8',
};

// What this device actually holds, and what MSP has no business seeing. AWS_SECRET_ACCESS_KEY is
// the point of an allowlist: nobody ever withheld it, and it still must not reach the child.
const EDGE_SECRETS = {
  ZURI_EDGE_DEVICE_KEY: 'device-key',
  ZURI_AGENT_DEVICE_TOKEN: 'device-token',
  ANTHROPIC_API_KEY: 'sk-decoy',
  LINE_CHANNEL_SECRET: 'line-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
  ZURI_EDGE_GENESISRAG17_CREDENTIAL: 'edge-credential',
  ZURI_EDGE_ADMIN_KEY_HASH: 'admin-hash',
  DATABASE_URL: 'postgres://decoy',
  AWS_SECRET_ACCESS_KEY: 'aws-decoy',
  NODE_OPTIONS: '--require ./evil.js',
  ZURI_MSP_COMMAND: 'node',
  ZURI_MSP_TIMEOUT_MS: '15000',
};

test('the MSP child environment is an allowlist: every edge secret is withheld, including one nobody named', () => {
  const child = mspChildEnvironment({ ...MSP_ALLOWLISTED_ENV, ...EDGE_SECRETS });
  assert.deepEqual(new Set(Object.keys(child)), new Set(Object.keys(MSP_ALLOWLISTED_ENV)));
  for (const name of Object.keys(EDGE_SECRETS)) assert.equal(child[name], undefined, `${name} must not reach MSP`);
  for (const [name, value] of Object.entries(MSP_ALLOWLISTED_ENV)) assert.equal(child[name], value);
});

test('allowlisted names are matched without case and copied as the caller spelled them', () => {
  const child = mspChildEnvironment({ Path: '/usr/bin', SystemRoot: 'C:/Windows', windir: 'C:/Windows', msp_db_path: '/msp.sqlite', database_url: 'postgres://decoy' });
  assert.deepEqual(child, { Path: '/usr/bin', SystemRoot: 'C:/Windows', windir: 'C:/Windows', msp_db_path: '/msp.sqlite' });
});

test('the edge allowlist matches zuri-ai server transport name for name', () => {
  const serverTransport = fs.readFileSync(fileURLToPath(new URL('../../../server/src/modules/agent/msp-stdio-transport.js', import.meta.url)), 'utf8');
  const namesIn = (constant: string) => {
    const start = serverTransport.indexOf(`export const ${constant} = Object.freeze([`);
    assert.ok(start >= 0, `${constant} not found in the server transport`);
    const end = serverTransport.indexOf('])', start);
    return serverTransport.slice(start, end).match(/'([A-Z0-9_]+)'/g)?.map((quoted) => quoted.slice(1, -1)) ?? [];
  };
  assert.deepEqual([...MSP_RUNTIME_ENV_NAMES].sort(), namesIn('MSP_RUNTIME_ENV_NAMES').sort());
  assert.deepEqual([...MSP_OS_ENV_NAMES].sort(), namesIn('MSP_OS_ENV_NAMES').sort());
});

test('a spawned MSP child really receives the allowlist and none of the edge secrets', async () => {
  const fixture = fileURLToPath(new URL('../fixtures/env-report-msp.mjs', import.meta.url));
  const call = createMspStdioTransport({ command: process.execPath, args: [fixture], timeoutMs: 15_000 }, { ...MSP_ALLOWLISTED_ENV, ...EDGE_SECRETS });
  const reported = await call('msp_env_report', {}) as { names?: string[] };
  const received = new Set(reported.names ?? []);
  assert.ok(received.size > 0, 'the fixture reported no environment at all');
  for (const name of Object.keys(EDGE_SECRETS)) assert.equal(received.has(name), false, `${name} reached the spawned MSP child`);
  for (const name of ['MSP_DB_PATH', 'MSP_GKS_PIPELINE_CREDENTIAL', 'GKS_DB_PATH', 'OLLAMA_BASE_URL']) {
    assert.equal(received.has(name), true, `${name} must reach the spawned MSP child`);
  }
});
