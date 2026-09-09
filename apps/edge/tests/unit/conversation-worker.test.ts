import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createConversationClient, type ConversationClient } from '../../src/conversation/client.js';
import { ConversationError, conversationEnvelope, requireComputeWorker, requireLegacyTransport, transportOwner, type ConversationJob } from '../../src/conversation/contract.js';
import { runConversationOnce, runConversationLoop } from '../../src/conversation/worker.js';
import { createConversationExecutor, headlessProviderHome, validateExecutionPolicy } from '../../src/conversation/executor.js';
import { buildArgs, saveSession, loadSessionId, type HeadlessOptions } from '../../src/answer/headless.js';
import { LinePocClient } from '../../src/line-poc/client.js';
import { createLineWebhookServer } from '../../src/history/webhook-server.js';

const job = (): ConversationJob => ({
  id: '10c0eacf-1e65-413a-a6c1-3f6d125cf123', version: 1, question: 'สินค้าอะไรบ้าง',
  conversationKey: 'server-account:conversation-id', leaseExpiresAt: new Date(Date.now() + 300000).toISOString(),
  policy: { modelAccess: 'LOCAL_ONLY', role: 'sales', retainHistory: false },
});
function fixture(overrides: Partial<ConversationClient> = {}) {
  const calls: unknown[] = [];
  const client: ConversationClient = {
    claim: async () => job(), complete: async (j, text) => { calls.push(['complete', j.version, text]); },
    fail: async (j, code) => { calls.push(['fail', j.version, code]); }, ...overrides,
  };
  return { client, calls };
}

test('default runtime is compute only and rejects contradictory legacy/stack ownership', () => {
  assert.equal(transportOwner({}), 'SERVER');
  assert.throws(() => requireLegacyTransport({}), /LINE_TRANSPORT_OWNED_BY_SERVER/);
  assert.doesNotThrow(() => requireLegacyTransport({ ZURI_LINE_TRANSPORT_OWNER: 'LEGACY_EDGE' }));
  assert.throws(() => requireComputeWorker({ ZURI_LINE_TRANSPORT_OWNER: 'LEGACY_EDGE' }), /REQUIRES_SERVER/);
  assert.throws(() => transportOwner({ ZURI_STACK_REPLY_ENABLED: 'true' }), /REQUIRES_LEGACY/);
  assert.throws(() => transportOwner({ ZURI_LINE_TRANSPORT_OWNER: 'typo' }), /INVALID/);
  assert.throws(() => createLineWebhookServer({ port: 0, channelSecret: '', historyRoot: '', historyHashKey: '', retentionDays: 1, groupAliases: {}, allowedGroupAliases: [] }), /LINE_TRANSPORT_OWNED_BY_SERVER/);
});

test('strict job contract rejects recipient, token, role escalation, retained history and unknown major', () => {
  const good = { contractVersion: '1', job: job() };
  assert.equal(conversationEnvelope.safeParse(good).success, true);
  for (const extra of [{ replyToken: 'secret' }, { userId: 'U123' }, { tenantId: 'tenant' }]) {
    assert.equal(conversationEnvelope.safeParse({ ...good, job: { ...good.job, ...extra } }).success, false);
  }
  assert.equal(conversationEnvelope.safeParse({ ...good, contractVersion: '2' }).success, false);
  for (const policy of [{ role: 'owner' }, { retainHistory: true }, { modelAccess: 'anything' }]) {
    assert.equal(conversationEnvelope.safeParse({ ...good, job: { ...good.job, policy: { ...good.job.policy, ...policy } } }).success, false);
  }
});

test('client exposes only device claim/complete/fail and preserves version fence', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = createConversationClient({ baseUrl: 'https://zuri.example', deviceKey: 'edgk_test',
    fetchFn: async (url, init) => {
      requests.push({ url: String(url), init: init! });
      return String(url).endsWith('/claim') ? Response.json({ contractVersion: '1', job: job() }) : Response.json({ ok: true });
    },
  });
  const claimed = await client.claim(); assert.ok(claimed);
  await client.complete(claimed, 'คำตอบ'); await client.fail(claimed, 'EXECUTION_FAILED');
  assert.deepEqual(requests.map(r => JSON.parse(String(r.init.body))), [{}, { version: 1, text: 'คำตอบ' }, { version: 1, code: 'EXECUTION_FAILED' }]);
  assert.ok(requests.every(r => r.url.startsWith('https://zuri.example/api/edge/conversation-jobs/')));
  assert.ok(requests.every(r => r.init.redirect === 'error'));
  assert.ok(requests.every(r => (r.init.headers as Record<string, string>).Authorization === 'Bearer edgk_test'));
});

test('cloud client rejects remote HTTP, userinfo and path-based origins before sending', () => {
  for (const baseUrl of ['http://cloud.example', 'https://name:password@cloud.example', 'https://cloud.example/path']) {
    assert.throws(() => createConversationClient({ baseUrl, deviceKey: 'edgk_test' }));
  }
  assert.doesNotThrow(() => createConversationClient({ baseUrl: 'http://127.0.0.1:3000', deviceKey: 'edgk_test' }));
});

test('cloud empty queue is idle; errors and oversized malformed bodies do not expose content', async () => {
  const make = (fetchFn: typeof fetch) => createConversationClient({ baseUrl: 'https://zuri.example', deviceKey: 'edgk_test', fetchFn });
  assert.equal(await make(async () => new Response(null, { status: 204 })).claim(), null);
  await assert.rejects(make(async () => new Response('secret transcript', { status: 401 })).claim(), e => e instanceof ConversationError && e.status === 401 && !e.message.includes('secret'));
  await assert.rejects(make(async () => { throw new Error('edgk_test raw question'); }).claim(), /CONVERSATION_NETWORK_FAILED/);
  await assert.rejects(make(async () => new Response('x'.repeat(100001))).claim(), /INVALID_CONVERSATION_CONTRACT/);
});

test('worker computes once and returns text; no delivery authority is part of its dependencies', async () => {
  const { client, calls } = fixture();
  let count = 0;
  const result = await runConversationOnce({ client, answer: async () => { count++; return { text: 'คำตอบ', source: 'rules' }; } });
  assert.equal(result.outcome, 'completed');
  assert.equal(count, 1); assert.deepEqual(calls, [['complete', 1, 'คำตอบ']]);
});

test('execution failure reports only a bounded code, never a transcript or credential', async () => {
  const { client, calls } = fixture();
  await runConversationOnce({ client, answer: async () => { throw new Error('edgk_secret private question'); } });
  assert.deepEqual(calls, [['fail', 1, 'EXECUTION_FAILED']]);
});

test('local-only policy failure is explicit and does not switch provider', async () => {
  const { client, calls } = fixture();
  await runConversationOnce({ client, answer: async () => { throw new ConversationError('LOCAL_POLICY_UNAVAILABLE'); } });
  assert.deepEqual(calls, [['fail', 1, 'LOCAL_POLICY_UNAVAILABLE']]);
});

test('a lease expired before any answer was attempted is reported via fail, not silently dropped', async () => {
  // Nothing was ever sent to the server here — no answer was computed — so this is not the
  // completion-uncertainty case the file's header comment warns about; reporting it is the first
  // and only write (item 4 of the FR-150 defect fix).
  const expired = job(); expired.leaseExpiresAt = new Date(0).toISOString();
  const a = fixture({ claim: async () => expired });
  const result = await runConversationOnce({ client: a.client, answer: async () => { assert.fail('must not execute'); } });
  assert.equal(result.outcome, 'lease_expired');
  assert.deepEqual(a.calls, [['fail', 1, 'EXECUTION_FAILED']]);
});

test('a lease expired while answering (before any send) is also reported via fail', async () => {
  const b = fixture(); let now = Date.now();
  const result = await runConversationOnce({
    client: b.client, now: () => now,
    answer: async () => { now += 400000; return { text: 'answer', source: 'rules' }; },
  });
  assert.equal(result.outcome, 'lease_expired');
  assert.deepEqual(b.calls, [['fail', 1, 'EXECUTION_FAILED']]);
});

test('a lease expired after answer() itself threw is reported via fail once, not the answer\'s own code', async () => {
  const c = fixture(); let now = Date.now();
  const result = await runConversationOnce({
    client: c.client, now: () => now,
    answer: async () => { now += 400000; throw new Error('transient'); },
  });
  assert.equal(result.outcome, 'lease_expired');
  assert.deepEqual(c.calls, [['fail', 1, 'EXECUTION_FAILED']]);
});

test('a 409 while reporting an expired lease is swallowed — the server already treats the claim as stale', async () => {
  const expired = job(); expired.leaseExpiresAt = new Date(0).toISOString();
  const d = fixture({
    claim: async () => expired,
    fail: async () => { throw new ConversationError('CONVERSATION_HTTP_FAILED', 409); },
  });
  const result = await runConversationOnce({ client: d.client, answer: async () => { assert.fail('must not execute'); } });
  assert.equal(result.outcome, 'lease_expired');
});

test('a non-409 failure while reporting an expired lease still propagates', async () => {
  const expired = job(); expired.leaseExpiresAt = new Date(0).toISOString();
  const e = fixture({
    claim: async () => expired,
    fail: async () => { throw new ConversationError('CONVERSATION_HTTP_FAILED', 500); },
  });
  await assert.rejects(
    runConversationOnce({ client: e.client, answer: async () => { assert.fail('must not execute'); } }),
    (error: unknown) => error instanceof ConversationError && error.status === 500,
  );
});

test('ambiguous completion failure never triggers fail or repeats the answer', async () => {
  const { client, calls } = fixture({ complete: async () => { throw new ConversationError('CONVERSATION_NETWORK_FAILED'); } });
  let count = 0;
  await assert.rejects(runConversationOnce({ client, answer: async () => { count++; return { text: 'answer', source: 'rules' }; } }), /NETWORK_FAILED/);
  assert.equal(count, 1); assert.deepEqual(calls, []);
});

test('revoked credential stops polling without repeated authentication attempts', async () => {
  let count = 0;
  const { client } = fixture({ claim: async () => { count++; throw new ConversationError('HTTP_FAILED', 401); } });
  await assert.rejects(runConversationLoop({ client, answer: async () => ({ text: 'answer', source: 'rules' }), signal: new AbortController().signal }), e => e instanceof ConversationError && e.status === 401);
  assert.equal(count, 1);
});

test('local-only jobs reject headless, public provider URLs and missing local model', () => {
  for (const config of [{ headlessEnabled: true }, { llmEnabled: true, llmBaseUrl: 'https://public.example/v1' }, { llmEnabled: true, llmAllowCloud: true }]) {
    assert.throws(() => validateExecutionPolicy(job(), config, 'http://127.0.0.1:8888'), /LOCAL_POLICY_UNAVAILABLE/);
  }
  assert.doesNotThrow(() => validateExecutionPolicy(job(), {}, 'http://127.0.0.1:8888'));
  assert.doesNotThrow(() => validateExecutionPolicy(job(), { llmEnabled: true, llmBaseUrl: 'http://127.0.0.1:11434/v1' }, 'http://127.0.0.1:8888'));
});

test('managed provider home maps to the selected CLI credential variable', () => {
  const home = path.resolve('state', 'providers', 'managed');
  assert.deepEqual(headlessProviderHome({ managedProviderHome: home }, 'codex'), { codexHome: home });
  assert.deepEqual(headlessProviderHome({ managedProviderHome: home }, 'claude'), { claudeConfigDir: home });
  assert.deepEqual(headlessProviderHome({}, 'claude'), { claudeConfigDir: undefined });
});

test('executor needs no LINE token and uses server key as hashed identity without retained history', async () => {
  let memoryRoot = '';
  // Source is 'model' here deliberately: this test is about identity/memory-root plumbing, not
  // about the empty-catalogue guard (covered separately below), and 'model' never trips it.
  const answer = createConversationExecutor({}, { ragUrl: 'http://127.0.0.1:8888', answer: async (text, options) => {
    assert.equal(text, job().question); assert.equal(options.role, 'sales');
    assert.equal(options.retainHistory, false); assert.match(options.conversationKey, /^[0-9a-f]{64}$/);
    assert.equal(options.headless, null); assert.equal(options.llm, null);
    memoryRoot = options.memory.root;
    return { text: 'answer', source: 'model', toolCalls: [] };
  } });
  assert.deepEqual(await answer(job()), { text: 'answer', source: 'model' });
  assert.equal(fs.existsSync(path.dirname(memoryRoot)), false);
});

test('a `rules` answer read against an empty catalogue fails the job instead of completing a holding message', async () => {
  // No catalogRoot exists on disk here, so loadCatalog() returns zero products — the executor
  // must refuse to complete a `rules` answer under that condition (item 2/3 of the FR-150 fix).
  const { client, calls } = fixture();
  const answer = createConversationExecutor(
    { catalogRoot: path.join(os.tmpdir(), 'zuri-empty-catalog-does-not-exist') },
    { ragUrl: 'http://127.0.0.1:8888', answer: async () => ({ text: 'ไม่เจอรหัส TJS23-2 ในแคตตาล็อกค่ะ', source: 'rules', toolCalls: [] }) },
  );
  const result = await runConversationOnce({ client, answer });
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(calls, [['fail', 1, 'EXECUTION_FAILED']]);
});

test('a `rules` answer read against a populated catalogue still completes, with its provenance reported', async () => {
  const catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-populated-catalog-'));
  try {
    fs.writeFileSync(path.join(catalogRoot, 'book.json'), JSON.stringify({
      label: 'test',
      products: [{ code: 'T1', name: 'Test product', rmb: 10, upc: 10, dims: [10, 10, 10], kg: 1, e: false }],
    }));
    const { client, calls } = fixture();
    // A legitimate not-found from a real catalogue — must not regress into the item-2 refusal.
    const answer = createConversationExecutor({ catalogRoot }, {
      ragUrl: 'http://127.0.0.1:8888',
      answer: async () => ({ text: 'ไม่เจอรหัส ZZ99-9 ในแคตตาล็อกค่ะ', source: 'rules', toolCalls: [] }),
    });
    const result = await runConversationOnce({ client, answer });
    assert.equal(result.outcome, 'completed');
    assert.equal(result.source, 'rules');
    assert.deepEqual(calls, [['complete', 1, 'ไม่เจอรหัส ZZ99-9 ในแคตตาล็อกค่ะ']]);
  } finally { fs.rmSync(catalogRoot, { recursive: true, force: true }); }
});

test('a `model` answer completes even from an empty catalogue — the model reads the RAG index instead', async () => {
  const { client, calls } = fixture();
  const answer = createConversationExecutor(
    { catalogRoot: path.join(os.tmpdir(), 'zuri-empty-catalog-does-not-exist-2') },
    { ragUrl: 'http://127.0.0.1:8888', answer: async () => ({ text: 'มีสินค้าตามที่ถามค่ะ', source: 'model', toolCalls: [] }) },
  );
  const result = await runConversationOnce({ client, answer });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.source, 'model');
  assert.deepEqual(calls, [['complete', 1, 'มีสินค้าตามที่ถามค่ะ']]);
});

test('external permission cannot bypass Codex containment or complete through fallback', async () => {
  const external = job(); external.policy.modelAccess = 'EXTERNAL_MODEL_ALLOWED';
  const { client, calls } = fixture({ claim: async () => external });
  const answer = createConversationExecutor({ headlessEnabled: true, headlessBin: 'codex' }, {
    answer: async () => { assert.fail('answer and provider fallback must not run'); },
  });
  assert.equal((await runConversationOnce({ client, answer })).outcome, 'failed');
  assert.deepEqual(calls, [['fail', 1, 'LOCAL_POLICY_UNAVAILABLE']]);
  assert.doesNotThrow(() => validateExecutionPolicy(external, { headlessEnabled: true, headlessBin: 'claude' }, 'http://127.0.0.1:8888'));
});

test('stateless headless has bounded tools, no dangerous bypass, and no local session write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-headless-test-'));
  try {
    const options: HeadlessOptions = { bin: 'codex', model: 'configured-model', maxTurns: 2, timeoutMs: 1000, mcpServerPath: '/approved/server.js', sandboxRoot: root, sessionRoot: path.join(root, 'sessions'), sessionRetentionHours: 0, catalogRoot: root, exchangeRate: 5, webSearch: false, fileAuthoring: false, stateless: true };
    const args = buildArgs('question', 'system', 'sales', null, options);
    assert.ok(args.includes('--ephemeral')); assert.ok(args.includes('read-only'));
    assert.ok(args.includes('features.shell_tool=false')); assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
    const claude = buildArgs('question', 'system', 'sales', 'old-session', { ...options, bin: 'claude' });
    assert.ok(claude.includes('--no-session-persistence')); assert.ok(!claude.includes('--resume'));
    saveSession('key', 'id', [100], options);
    assert.equal(loadSessionId('key', options), null); assert.equal(fs.existsSync(options.sessionRoot), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('low-level LINE client refuses provider requests when server owns transport', async () => {
  let sent = false;
  const client = new LinePocClient({ transportOwner: 'SERVER', channelAccessToken: 'test-token', groupAliases: {}, fetchFn: async () => { sent = true; return Response.json({}); } });
  await assert.rejects(client.replyText('reply-token', 'answer'), /LINE_TRANSPORT_OWNED_BY_SERVER/);
  assert.equal(sent, false);
});

test('CLI round trip claims and completes over HTTP with no LINE credentials or listener', async () => {
  const received: Array<{ url?: string; body: unknown }> = [];
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    received.push({ url: request.url, body: JSON.parse(raw) });
    assert.equal(request.headers.authorization, 'Bearer edgk_test');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url?.endsWith('/claim') ? { contractVersion: '1', job: job() } : { ok: true }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  // A real catalogue, so the `rules` answer this job gets (search finds nothing for its literal
  // question) is a legitimate not-found, not the item-2/3 empty-catalogue refusal — this test is
  // about the CLI/worker plumbing, not catalogue correctness.
  const catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-cli-roundtrip-catalog-'));
  fs.writeFileSync(path.join(catalogRoot, 'book.json'), JSON.stringify({
    label: 'test',
    products: [{ code: 'T1', name: 'Test product', rmb: 10, upc: 10, dims: [10, 10, 10], kg: 1, e: false }],
  }));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/index.ts', 'conversation', 'once'], {
        cwd: path.resolve('.'), env: {
          PATH: process.env.PATH, ZURI_CLOUD_BASE_URL: `http://127.0.0.1:${address.port}`,
          ZURI_EDGE_DEVICE_KEY: 'edgk_test',
          SMARTGIFT_CATALOG_ROOT: catalogRoot,
          /*
           * The child loads the repository's own `.env`, and dotenv only declines to overwrite
           * variables that are already present. `_FILE` beats the plain form in `resolveSecret`
           * unconditionally, so without these the CLI reads the developer's real device key off
           * disk and the assertion below compares against a live credential — passing on CI, which
           * has no `.env`, and failing on every machine configured the way an edge device is.
           * Declaring them empty is what makes dotenv leave them alone.
           */
          ZURI_EDGE_DEVICE_KEY_FILE: '',
          ZURI_CLOUD_BASE_URL_FILE: '',
          /*
           * And the answering configuration the scenario assumes. Inherited, this machine's
           * headless codex setting makes `validateExecutionPolicy` refuse a LOCAL_ONLY job before
           * it is answered — correctly, per the stateless-Codex containment — so the round trip
           * completed only where the developer happened to have headless off. A test whose outcome
           * depends on which machine ran it is not asserting anything.
           */
          ZURI_HEADLESS_ENABLED: 'false',
          ZURI_LLM_ENABLED: 'false',
        }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('CLI timeout')); }, 10000);
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /completed/); assert.ok(!result.stdout.includes(job().question));
    assert.deepEqual(received.map(r => r.url), ['/api/edge/conversation-jobs/claim', `/api/edge/conversation-jobs/${job().id}/complete`]);
    assert.deepEqual(received[0].body, {});
    const output = received[1].body as { version: number; text: string };
    assert.equal(output.version, 1); assert.ok(output.text.length > 0);
    assert.deepEqual(Object.keys(output).sort(), ['text', 'version']);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(catalogRoot, { recursive: true, force: true });
  }
});
