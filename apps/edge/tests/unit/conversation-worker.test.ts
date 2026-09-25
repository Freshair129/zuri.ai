import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConversationExecutor, headlessProviderHome, validateExecutionPolicy } from '../../src/conversation/executor.js';
import { ConversationError, type ConversationJob } from '../../src/conversation/contract.js';
import { runConversationOnce, runConversationLoop, EDGE_CONVERSATION_WORKER_REMOVED } from '../../src/conversation/worker.js';
import { runConversationCommand } from '../../src/cli/conversation.js';
import { buildArgs, saveSession, loadSessionId, type HeadlessOptions } from '../../src/answer/headless.js';
import { GenesisLocalRag } from '../../src/rag/genesis-rag.js';

const job = (): ConversationJob => ({
  id: '10c0eacf-1e65-413a-a6c1-3f6d125cf123', version: 1, question: 'สินค้าอะไรบ้าง',
  conversationKey: 'server-account:conversation-id', leaseExpiresAt: new Date(Date.now() + 300000).toISOString(),
  policy: { modelAccess: 'LOCAL_ONLY', role: 'sales', retainHistory: false },
});

test('retired Edge CLI and queue worker fail closed', async () => {
  await assert.rejects(runConversationCommand('serve'), /EDGE_CONVERSATION_WORKER_REMOVED/);
  await assert.rejects(runConversationOnce(), new RegExp(EDGE_CONVERSATION_WORKER_REMOVED));
  await assert.rejects(runConversationLoop(), new RegExp(EDGE_CONVERSATION_WORKER_REMOVED));
});

test('local RAG launcher never starts the retired dist conversation worker', () => {
  const launcher = fs.readFileSync(path.resolve('scripts/start-edge-stack.ps1'), 'utf8');
  assert.doesNotMatch(launcher, /dist[\\/]cli[\\/]index\.js|conversation\s+serve/i);
  assert.match(launcher, /scripts\\rag-serve\.ts/);
  assert.match(launcher, /scripts\\embed-sidecar\.py/);
});

test('local executor composes the retained Genesis RAG path without a cloud client', async () => {
  let seen: unknown;
  const answer = createConversationExecutor({}, { ragUrl: 'http://127.0.0.1:8888',
    genesisRag17: null,
    answer: async (_question, options) => {
      seen = options.rag;
      assert.equal(options.retainHistory, false);
      return { text: 'คำตอบจากความรู้ในเครื่อง', source: 'model', toolCalls: [] };
    },
  });
  assert.deepEqual(await answer(job()), { text: 'คำตอบจากความรู้ในเครื่อง', source: 'model' });
  assert.ok(seen instanceof GenesisLocalRag);
});

test('empty local catalogue cannot turn a holding rules response into a verified answer', async () => {
  const answer = createConversationExecutor({ catalogRoot: path.join(os.tmpdir(), 'zuri-empty-catalog-retired-worker') }, {
    ragUrl: 'http://127.0.0.1:8888',
    answer: async () => ({ text: 'ไม่พบสินค้า', source: 'rules', toolCalls: [] }),
  });
  await assert.rejects(answer(job()), error => error instanceof ConversationError && error.code === 'EXECUTION_FAILED');
});

test('a populated local catalogue can still produce a checked rules answer', async () => {
  const catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-local-catalog-'));
  try {
    fs.writeFileSync(path.join(catalogRoot, 'book.json'), JSON.stringify({ label: 'test',
      products: [{ code: 'T1', name: 'Test product', rmb: 10, upc: 10, dims: [10, 10, 10], kg: 1, e: false }] }));
    const answer = createConversationExecutor({ catalogRoot }, { ragUrl: 'http://127.0.0.1:8888',
      answer: async () => ({ text: 'ตรวจแคตตาล็อกแล้ว', source: 'rules', toolCalls: [] }),
    });
    assert.deepEqual(await answer(job()), { text: 'ตรวจแคตตาล็อกแล้ว', source: 'rules' });
  } finally { fs.rmSync(catalogRoot, { recursive: true, force: true }); }
});

test('local execution policy rejects headless, public model and external provider paths', () => {
  for (const config of [{ headlessEnabled: true }, { llmEnabled: true, llmBaseUrl: 'https://public.example/v1' },
    { llmEnabled: true, llmAllowCloud: true }]) {
    assert.throws(() => validateExecutionPolicy(job(), config, 'http://127.0.0.1:8888'), /LOCAL_POLICY_UNAVAILABLE/);
  }
  assert.doesNotThrow(() => validateExecutionPolicy(job(), {}, 'http://127.0.0.1:8888'));
  assert.doesNotThrow(() => validateExecutionPolicy(job(), { llmEnabled: true,
    llmBaseUrl: 'http://127.0.0.1:11434/v1' }, 'http://127.0.0.1:8888'));
});

test('managed provider home stays scoped to the selected local CLI', () => {
  const home = path.resolve('state', 'providers', 'managed');
  assert.deepEqual(headlessProviderHome({ managedProviderHome: home }, 'codex'), { codexHome: home });
  assert.deepEqual(headlessProviderHome({ managedProviderHome: home }, 'claude'), { claudeConfigDir: home });
  assert.deepEqual(headlessProviderHome({}, 'claude'), { claudeConfigDir: undefined });
});

test('stateless headless helper remains bounded and does not persist sessions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-headless-test-'));
  try {
    const options: HeadlessOptions = { bin: 'codex', model: 'configured-model', maxTurns: 2, timeoutMs: 1000,
      mcpServerPath: '/approved/server.js', sandboxRoot: root, sessionRoot: path.join(root, 'sessions'),
      sessionRetentionHours: 0, catalogRoot: root, exchangeRate: 5, webSearch: false, fileAuthoring: false, stateless: true };
    const args = buildArgs('question', 'system', 'sales', null, options);
    assert.ok(args.includes('--ephemeral')); assert.ok(args.includes('read-only'));
    assert.ok(args.includes('features.shell_tool=false'));
    const claude = buildArgs('question', 'system', 'sales', 'old-session', { ...options, bin: 'claude' });
    assert.ok(claude.includes('--no-session-persistence')); assert.ok(!claude.includes('--resume'));
    saveSession('key', 'id', [100], options);
    assert.equal(loadSessionId('key', options), null); assert.equal(fs.existsSync(options.sessionRoot), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
