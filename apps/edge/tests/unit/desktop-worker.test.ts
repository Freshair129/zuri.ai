import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import {
  catalogRootHasCatalog,
  isModelResident,
  parseDesktopWorkerCommand,
  parseDesktopWorkerInit,
} from '../../src/desktop-worker.js';

const init = (overrides: Record<string, unknown> = {}) => ({
  type: 'initialize',
  version: 1,
  deviceId: 'DEV-DESKTOP-01',
  deviceKey: 'edgk_synthetic_test_credential',
  cloudBaseUrl: 'https://zuri.example',
  dataRoot: resolve('synthetic-desktop-runtime'),
  ragUrl: 'http://127.0.0.1:8888',
  pollIntervalMs: 5000,
  heartbeatIntervalMs: 40000,
  provider: { llmEnabled: false, llmAllowCloud: false, headlessEnabled: false, headlessBin: 'claude' },
  ...overrides,
});

test('Desktop init is bounded, loopback-scoped, and keeps the key in the private contract', () => {
  const parsed = parseDesktopWorkerInit(init());
  assert.equal(parsed.deviceKey, 'edgk_synthetic_test_credential');
  assert.equal(parsed.provider.headlessEnabled, false);
  assert.throws(() => parseDesktopWorkerInit(init({ dataRoot: 'relative-runtime' })), /INVALID_INIT/);
  assert.throws(() => parseDesktopWorkerInit(init({ cloudBaseUrl: 'https://user:pass@zuri.example' })), /INVALID_CLOUD_ORIGIN/);
  assert.throws(() => parseDesktopWorkerInit(init({ ragUrl: 'https://public.example' })), /INVALID_INIT/);
  assert.throws(() => parseDesktopWorkerInit(init({ deviceKey: 'not-a-device-key' })), /INVALID_INIT/);
});

test('Desktop control accepts only stop and heartbeat, with a bounded stop deadline', () => {
  assert.deepEqual(parseDesktopWorkerCommand({ type: 'heartbeat', version: 1 }), {
    type: 'heartbeat', version: 1,
  });
  assert.equal(parseDesktopWorkerCommand({ type: 'stop', version: 1, deadlineMs: 1000 }).deadlineMs, 1000);
  assert.throws(() => parseDesktopWorkerCommand({ type: 'stop', version: 1, deadlineMs: 300001 }), /INVALID_MESSAGE/);
  assert.throws(() => parseDesktopWorkerCommand({ type: 'run', version: 1, command: 'format' }), /INVALID_MESSAGE/);
});

// @tested — status() degraded conditions for item 2 (empty catalogue) and item 1 (cold model),
//   exercised here through the two pure helpers status() calls rather than the private status()
//   closure itself, so neither test touches a real disk or a real Ollama.

test('catalogRootHasCatalog reports false for a missing root, an empty root, and a root with no .json file', () => {
  assert.equal(catalogRootHasCatalog('/does/not/exist', {
    existsSync: () => false,
    readdirSync: () => { throw new Error('must not be called when the root does not exist'); },
  }), false);
  assert.equal(catalogRootHasCatalog('/empty', { existsSync: () => true, readdirSync: () => [] }), false);
  assert.equal(catalogRootHasCatalog('/no-json', {
    existsSync: () => true,
    readdirSync: () => ['readme.md', 'notes.txt'],
  }), false);
});

test('catalogRootHasCatalog reports true once at least one .json file is present', () => {
  assert.equal(catalogRootHasCatalog('/has-catalog', {
    existsSync: () => true,
    readdirSync: () => ['notes.txt', 'book.json'],
  }), true);
});

test('isModelResident is false when the selected model is absent from /api/ps', async () => {
  const resident = await isModelResident('http://127.0.0.1:11434', 'qwen3.5:9b', async () => Response.json({ models: [] }));
  assert.equal(resident, false);
});

test('isModelResident is true only when /api/ps names the selected model', async () => {
  const resident = await isModelResident('http://127.0.0.1:11434', 'qwen3.5:9b', async () =>
    Response.json({ models: [{ name: 'qwen3.5:9b' }] }));
  assert.equal(resident, true);
  const other = await isModelResident('http://127.0.0.1:11434', 'qwen3.5:9b', async () =>
    Response.json({ models: [{ name: 'pathumma-thaillm-8b' }] }));
  assert.equal(other, false);
});

test('isModelResident treats a non-OK response or a throw as "not resident", never escaping', async () => {
  const notOk = await isModelResident('http://127.0.0.1:11434', 'qwen3.5:9b', async () => new Response('', { status: 500 }));
  assert.equal(notOk, false);
  const threw = await isModelResident('http://127.0.0.1:11434', 'qwen3.5:9b', async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(threw, false);
});
